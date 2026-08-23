// §45 — o transporte real: dois nós de verdade, uma DHT de verdade, um socket de verdade.
//
// Tudo aqui já existia como peça: o `fold`, o projector, a outbox, o `HostAdmission`, o
// `RpcServer`/`RpcClient` e o boot. O que este arquivo prova é que, trocando o canal de
// memória por `Hyperswarm` + `Protomux`, nada acima precisa saber — e que as regras de §14.3
// valem contra um par que chega pela rede, não contra um par simulado.
//
// A DHT é um `hyperdht/testnet` local: nada sai da máquina.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import createTestnet from 'hyperdht/testnet.js';

import { createCore, deriveCommunityKeyPairs, openCore, type WritableCoreHandle } from '../src/l0/corestore/index.ts';
import { ManifestDb } from '../src/l0/manifest/index.ts';
import { openViewDb } from '../src/l0/view/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import { HyperswarmBackend } from '../src/l0/swarm/hyperswarm.ts';
import { MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import { bootCore, type CoreRuntime } from '../src/composition/boot.ts';
import { storeCommunitySeed } from '../src/composition/ports.ts';
import { startCommunityTransport, type CommunityTransport } from '../src/composition/transport.ts';
import { tempDir } from './helpers/composition.ts';
import { T0, World, genesis, joinMember, keypairFromSeed } from './helpers/world.ts';

const SEED = Buffer.alloc(32, 21);
const DATA_KEY = Buffer.alloc(32, 5);
const PARES = deriveCommunityKeyPairs(SEED);
const COMMUNITY_ID = PARES.log.publicKey.toString('hex');

type Bootstrap = ReadonlyArray<{ readonly host: string; readonly port: number }>;

type No = {
  readonly runtime: CoreRuntime;
  readonly transport: CommunityTransport;
  readonly dir: string;
  close(): Promise<void>;
};

/** Um nó completo: manifest, view, core em disco, boot e transporte real. */
async function no(opts: {
  readonly rotulo: string;
  readonly bootstrap: Bootstrap;
  readonly identity: { publicKey: Buffer; secretKey: Buffer };
  readonly hosted: boolean;
  /** Blocos de gênese — só o host os escreve; o membro recebe pela replicação. */
  readonly genesisBlocks?: readonly Uint8Array[];
}): Promise<No> {
  const dir = tempDir(opts.rotulo);
  const corePath = path.join(dir, 'core');
  const core = opts.hosted ? await createCore(corePath, PARES.log) : await openCore(corePath, PARES.log.publicKey);
  if (opts.hosted && opts.genesisBlocks !== undefined) {
    await (core as WritableCoreHandle).append(opts.genesisBlocks);
  }

  const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
  if (opts.hosted) {
    storeCommunitySeed(
      manifest,
      { communityId: COMMUNITY_ID, coreKey: PARES.log.publicKey, blobsKey: PARES.blobs.publicKey, communitySeed: SEED, isHost: true, joinedAt: T0 },
      DATA_KEY,
    );
  } else {
    manifest.upsertCommunity({
      communityId: COMMUNITY_ID,
      coreKey: PARES.log.publicKey,
      blobsKey: PARES.blobs.publicKey,
      isHost: false,
      joinedAt: T0,
    });
  }
  const view = openViewDb(path.join(dir, 'view.db'));
  const [coreSide] = MemoryIpcPort.createPair();

  // §14.3(1) — o keypair do swarm é a identidade: é por `remotePublicKey` que o outro lado
  // decide se abre o canal.
  const backend = new HyperswarmBackend({ bootstrap: opts.bootstrap, keyPair: opts.identity });
  const swarm = new Swarm({ backend });

  const runtime = await bootCore({
    dataDir: dir,
    manifest,
    view,
    swarm,
    dataKey: DATA_KEY,
    identity: () => opts.identity,
    foldBuildId: 'transporte-real',
    ipcPort: coreSide,
    epoch: 1,
    tokenVerifier: { consume: () => true },
    hostTurnSecret: () => Buffer.alloc(32, 7),
    now: () => T0 + 5_000,
    // Sem temporizador de verdade: a cadência de §17.4 tem teste próprio, e cinco minutos
    // de `setInterval` manteriam o processo vivo depois do último assert.
    schedule: () => 0,
    cancel: () => {},
    openCore: async () => core,
  });

  const transport = startCommunityTransport({ runtime, swarm });
  await transport.flush();

  return {
    runtime,
    transport,
    dir,
    async close() {
      await transport.stop();
      await runtime.close();
      view.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    },
  };
}

/** Espera a condição, ou falha com a mensagem. A DHT local é rápida, mas não é síncrona. */
async function ate(cond: () => boolean, msg: string, timeoutMs = 20_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`${msg} (esperou ${timeoutMs} ms)`);
}

describe('§45 transporte real — Hyperswarm + Protomux', { timeout: 120_000 }, () => {
  const world = new World(PARES.log);
  const g = genesis(world);
  const ana = joinMember(g, 'ana-rede');
  const blocks = [...world.log].map((b) => Buffer.from(b));
  const forasteiro = keypairFromSeed('forasteiro-rede');

  let testnet: Awaited<ReturnType<typeof createTestnet>> | null = null;
  const abertos: No[] = [];

  after(async () => {
    for (const n of abertos.reverse()) await n.close();
    await testnet?.destroy();
  });

  it('o membro descobre o host pela DHT e replica o log inteiro (§14.1, §14.2)', async () => {
    testnet = await createTestnet(3);
    const host = await no({ rotulo: 'host', bootstrap: testnet.bootstrap, identity: g.founder, hosted: true, genesisBlocks: blocks });
    abertos.push(host);
    assert.equal(host.runtime.get(COMMUNITY_ID)!.projector.interpretedSeq, blocks.length - 1);

    const membro = await no({ rotulo: 'membro', bootstrap: testnet.bootstrap, identity: ana, hosted: false });
    abertos.push(membro);

    const p = membro.runtime.get(COMMUNITY_ID)!.projector;
    await ate(() => p.interpretedSeq === blocks.length - 1, `réplica parou em interpretedSeq=${p.interpretedSeq}`);
    // O log replicado é o mesmo estado: a comunidade existe e os dois membros estão lá.
    assert.equal(p.ds.community.name, 'Comunidade');
    assert.equal(p.ds.members.size, 2);
    // §16.1 — e o canal de RPC abriu junto, sobre a mesma conexão.
    await ate(() => membro.transport.channelCount() === 1, 'o canal de §16.1 não abriu no membro');
    await ate(() => host.transport.channelCount() === 1, 'o canal de §16.1 não abriu no host');
  });

  it('uma op sai da outbox, atravessa o socket e volta replicada (§11.1 caminho A, §16.2)', async () => {
    const membro = abertos[1]!;
    const host = abertos[0]!;
    const c = membro.runtime.get(COMMUNITY_ID)!;

    const enfileirada = membro.runtime.client.submitQueued(COMMUNITY_ID, {
      kindName: 'message.send',
      payload: { channelId: g.channelId, content: 'atravessou a rede', mentions: [] },
    });
    assert.ok(enfileirada.ok, `submitQueued recusou: ${JSON.stringify(enfileirada)}`);

    const enviadas = await c.outbox!.flush();
    assert.equal(enviadas, 1, 'a outbox não conseguiu submeter pelo canal real');

    // O host admitiu e appendou no core dele...
    await ate(() => host.runtime.get(COMMUNITY_ID)!.core.length === blocks.length + 1, 'o host não appendou a op');
    // ...e a réplica a interpretou de volta, pela mesma conexão.
    await ate(
      () => c.projector.interpretedSeq === blocks.length,
      `a réplica não projetou a op (interpretedSeq=${c.projector.interpretedSeq})`,
    );
    const minhas = [...c.projector.ds.messages.values()].filter((m) => m.authorKey === ana.publicKey.toString('hex'));
    assert.equal(minhas.length, 1);

    // §11.6 — a reconciliação vê a op observada e limpa a fila.
    c.outbox!.reconcile();
    assert.equal(c.outbox!.retry(enfileirada.opId).ok, false);
  });

  it('quem não é membro ativo não abre canal nem recebe bloco (§14.3(1), T-25)', async () => {
    const intruso = await no({ rotulo: 'intruso', bootstrap: testnet!.bootstrap, identity: forasteiro, hosted: false });
    abertos.push(intruso);

    // Ele acha o tópico — discovery key é público — e a conexão até abre: o firewall de
    // §14.3(4) só recusa quem está banido em TODAS as comuns, e ele não tem nenhuma. O que
    // não acontece é a replicação: o `DS` do host não o conhece como membro ativo, e quem
    // tem o dado é quem autoriza (§14.3(1)).
    await new Promise((r) => setTimeout(r, 5_000));
    const host = abertos[0]!;
    assert.equal(intruso.runtime.get(COMMUNITY_ID)!.core.length, 0, 'o intruso recebeu bloco');
    assert.equal(intruso.transport.channelCount(), 0, 'o intruso abriu canal de §16.1 sem saber quem é o host');
    // E o host continua com o canal do membro legítimo, e só ele.
    assert.equal(host.transport.channelCount(), 1, 'o host abriu canal para o intruso');
  });
});
