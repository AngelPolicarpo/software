// §65 — reconexão do canal de §16.1: o par cai, o par VOLTA (mesmo peerKey), e sem
// reiniciar a instalação que ficou de pé o canal reabre e a outbox flui.
//
// O smoke de §63.4/§64.4 provou o defeito em produto: o host reiniciou, a replicação do
// membro voltou sozinha (`catching-up` 7 s depois da queda) mas o canal de RPC não
// desbloqueou nada — op `queued, attempts:0` por horas até um restart do guest. Este
// arquivo reproduz os DOIS sentidos da queda contra rede real (hyperdht/testnet):
//
//   host morre e volta  — o membro precisa sair de `reconnecting` quando o canal reanexa
//                         (channelAttached → connecting → contato observado → online);
//   membro morre e volta — o host precisa registrar o aceitador de §16.1 na CONEXÃO NOVA:
//                         o par `(protocolo, id)` é de um mux, e o mux que morreu levou
//                         o registro junto.
//
// O "loop de outbox" deste arquivo replica o MESMO portão do boot (`outbox.flush` de
// §22.1 só gira com `connecting|online`) — é exatamente esse portão que travava.

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

const SEED = Buffer.alloc(32, 31);
const DATA_KEY = Buffer.alloc(32, 15);
const PARES = deriveCommunityKeyPairs(SEED);
const COMMUNITY_ID = PARES.log.publicKey.toString('hex');

type Bootstrap = ReadonlyArray<{ readonly host: string; readonly port: number }>;

type No = {
  readonly runtime: CoreRuntime;
  readonly transport: CommunityTransport;
  readonly dir: string;
  readonly view: ReturnType<typeof openViewDb>;
  readonly manifest: ManifestDb;
  /** Conexões vivas do backend — é o que §18.1 manda derrubar no ban. */
  conexoes(): number;
  /** Fecha tudo SEM apagar o diretório — o nó volta pelo mesmo disco na sequência. */
  fechar(): Promise<void>;
};

async function no(opts: {
  readonly rotulo: string;
  readonly bootstrap: Bootstrap;
  readonly identity: { publicKey: Buffer; secretKey: Buffer };
  readonly hosted: boolean;
  readonly dir?: string;
  readonly genesisBlocks?: readonly Uint8Array[];
}): Promise<No> {
  const dir = opts.dir ?? tempDir(opts.rotulo);
  const corePath = path.join(dir, 'core');
  const core =
    opts.hosted && !fs.existsSync(corePath)
      ? await createCore(corePath, PARES.log)
      : await openCore(corePath, PARES.log.publicKey);
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

  const backend = new HyperswarmBackend({ bootstrap: opts.bootstrap, keyPair: opts.identity });
  const swarm = new Swarm({ backend });

  const runtime = await bootCore({
    dataDir: dir,
    manifest,
    view,
    swarm,
    dataKey: DATA_KEY,
    identity: () => opts.identity,
    foldBuildId: 'reconexao-65',
    ipcPort: coreSide,
    epoch: 1,
    tokenVerifier: { consume: () => true },
    hostTurnSecret: () => Buffer.alloc(32, 7),
    now: () => T0 + 5_000,
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
    view,
    manifest,
    conexoes: () => swarm.getStats().peerCount,
    async fechar() {
      await transport.stop();
      await runtime.close();
      // O fechamento dos cores é assíncrono por trás do `await` (lição de §54): um fôlego
      // antes de fechar os bancos, senão o flush recria arquivo sob os pés do sqlite.
      await new Promise((r) => setTimeout(r, 25));
      view.close();
      manifest.close();
    },
  };
}

/** Espera a condição girando o portão de outbox do boot a cada tentativa. */
async function ateComFila(membro: No, cond: () => boolean, msg: string, timeoutMs = 30_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    // O MESMO portão do loop `outbox.flush` de §22.1 no boot: membro só tenta com canal.
    for (const c of membro.runtime.communities()) {
      if (c.outbox === null || c.isHost) continue;
      const estado = membro.runtime.hostStatus?.statusOf(c.communityId) ?? 'unknown';
      if (estado !== 'online' && estado !== 'connecting') continue;
      await c.outbox.flush().catch(() => {});
    }
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`${msg} (esperou ${timeoutMs} ms; status=${membro.runtime.hostStatus?.statusOf(COMMUNITY_ID)}, canais=${membro.transport.channelCount()})`);
}

describe('§65 reconexão do canal de §16.1 — par cai, par volta, a fila anda', { timeout: 180_000 }, () => {
  const world = new World(PARES.log);
  const g = genesis(world);
  const ana = joinMember(g, 'ana-reconexao');
  const blocks = [...world.log].map((b) => Buffer.from(b));

  let testnet: Awaited<ReturnType<typeof createTestnet>> | null = null;
  const abertos: No[] = [];
  /** A rede local nasce no primeiro uso — os testes são independentes entre si. */
  async function rede(): Promise<Bootstrap> {
    if (testnet === null) testnet = await createTestnet(3);
    return testnet.bootstrap;
  }

  after(async () => {
    for (const n of abertos.reverse()) await n.fechar().catch(() => {});
    await testnet?.destroy();
  });

  it('o host morre e volta: o membro NÃO reinicia — sai de reconnecting, canal reabre e a op flui', async () => {
    testnet = await createTestnet(3);
    const host = await no({ rotulo: 'host-caiu', bootstrap: testnet.bootstrap, identity: g.founder, hosted: true, genesisBlocks: blocks });
    abertos.push(host);
    const membro = await no({ rotulo: 'membro-fiel', bootstrap: testnet.bootstrap, identity: ana, hosted: false });
    abertos.push(membro);

    const p = membro.runtime.get(COMMUNITY_ID)!.projector;
    await ateComFila(membro, () => p.interpretedSeq === blocks.length - 1, 'réplica inicial não completou');
    await ateComFila(
      membro,
      () => membro.transport.channelCount() === 1 && host.transport.channelCount() === 1,
      'canal de §16.1 não abriu no baseline',
    );

    // ── Queda: o host inteiro morre; o membro fica de pé, com uma op nova na fila ──────
    const dirDoHost = host.dir;
    await host.fechar();
    abertos.splice(abertos.indexOf(host), 1);

    const enfileirada = membro.runtime.client.submitQueued(COMMUNITY_ID, {
      kindName: 'message.send',
      payload: { channelId: g.channelId, content: 'sobreviveu à queda', mentions: [] },
    });
    assert.ok(enfileirada.ok, `submitQueued recusou: ${JSON.stringify(enfileirada)}`);

    // ── Volta: MESMO disco, MESMA identidade — e o membro intocado ────────────────────
    const host2 = await no({ rotulo: 'host-volta', bootstrap: testnet.bootstrap, identity: g.founder, hosted: true, dir: dirDoHost });
    abertos.push(host2);

    // Sem tocar no membro: o anexo do canal tem de devolvê-lo a `connecting` e o contato
    // observado a `online` — é isso que reabre o portão da outbox (defeto de §63.4).
    await ateComFila(
      membro,
      () => membro.runtime.hostStatus?.statusOf(COMMUNITY_ID) === 'online' && membro.transport.channelCount() === 1,
      'membro não voltou ao online com o host de volta',
    );

    // E a fila andou: o host novo appendou a op e a réplica interpretou de volta.
    await ateComFila(
      membro,
      () => host2.runtime.get(COMMUNITY_ID)!.core.length === blocks.length + 1,
      'o host novo não recebeu a op enfileirada na queda',
    );
    await ateComFila(membro, () => p.interpretedSeq === blocks.length, 'a réplica não projetou a op');
    membro.runtime.get(COMMUNITY_ID)!.outbox!.reconcile(T0 + 6_000);
    assert.equal(membro.runtime.get(COMMUNITY_ID)!.outbox!.retry(enfileirada.opId).ok, false, 'a op não foi reconciliada como entregue');
  });

  it('o membro morre e volta contra o host de pé: o aceitador renasce na conexão nova', async () => {
    const host = await no({ rotulo: 'host-pesado', bootstrap: await rede(), identity: g.founder, hosted: true, genesisBlocks: blocks });
    abertos.push(host);
    const membro1 = await no({ rotulo: 'membro-um', bootstrap: await rede(), identity: ana, hosted: false });
    abertos.push(membro1);

    const p1 = membro1.runtime.get(COMMUNITY_ID)!.projector;
    await ateComFila(membro1, () => p1.interpretedSeq === blocks.length - 1, 'réplica inicial não completou');
    await ateComFila(
      membro1,
      () => membro1.transport.channelCount() === 1 && host.transport.channelCount() === 1,
      'canal de §16.1 não abriu no baseline',
    );

    // O MEMBRO morre (o host fica). Na volta, o par (protocolo, id) do aceitador tem de
    // nascer de novo sobre o mux da conexão nova — o velho morreu com ela.
    const dirDoMembro = membro1.dir;
    await membro1.fechar();
    abertos.splice(abertos.indexOf(membro1), 1);

    const membro2 = await no({ rotulo: 'membro-dois', bootstrap: await rede(), identity: ana, hosted: false, dir: dirDoMembro });
    abertos.push(membro2);

    await ateComFila(
      membro2,
      () => membro2.transport.channelCount() === 1 && host.transport.channelCount() === 1,
      'o canal não reabriu para o membro que voltou',
    );

    const enfileirada = membro2.runtime.client.submitQueued(COMMUNITY_ID, {
      kindName: 'message.send',
      payload: { channelId: g.channelId, content: 'voltei', mentions: [] },
    });
    assert.ok(enfileirada.ok, `submitQueued recusou: ${JSON.stringify(enfileirada)}`);
    await ateComFila(
      membro2,
      () => host.runtime.get(COMMUNITY_ID)!.core.length === blocks.length + 1,
      'a op do membro que voltou não chegou ao host',
    );
    membro2.runtime.get(COMMUNITY_ID)!.outbox!.reconcile(T0 + 6_000);
    assert.equal(membro2.runtime.get(COMMUNITY_ID)!.outbox!.retry(enfileirada.opId).ok, false);
  });

  it('ban corta a conexão: canal fecha, a conexão cai e bloco novo não chega ao banido (§18.1)', async () => {
    // Um mundo com uma terceira membro, que será banida.
    const mundo2 = new World(PARES.log);
    const g2 = genesis(mundo2);
    const duda = joinMember(g2, 'duda-banida');
    const blocks2 = [...mundo2.log].map((b) => Buffer.from(b));

    const hostB = await no({ rotulo: 'host-ban', bootstrap: await rede(), identity: g2.founder, hosted: true, genesisBlocks: blocks2 });
    abertos.push(hostB);
    const alvo = await no({ rotulo: 'alvo-ban', bootstrap: await rede(), identity: duda, hosted: false });
    abertos.push(alvo);

    const pAlvo = alvo.runtime.get(COMMUNITY_ID)!.projector;
    await ateComFila(alvo, () => pAlvo.interpretedSeq === blocks2.length - 1, 'réplica inicial não completou');
    await ateComFila(
      alvo,
      () => alvo.transport.channelCount() === 1 && hostB.transport.channelCount() === 1 && alvo.conexoes() === 1,
      'baseline não saudou',
    );

    // O host projeta o `mod.ban`: no MESMO lote o canal fecha e a conexão cai (§14.3(3),
    // §18.1) — sem isto o hypercore segue alimentando bloco novo a quem foi banido.
    const r = mundo2.submit({
      kind: 'mod.ban',
      payload: { targetKey: duda.publicKey, reason: 'smoke-65' },
      author: g2.founder,
      hostTs: T0 + 200,
    });
    assert.equal(r.decision, 'APPLIED', `mod.ban não aplicou: ${JSON.stringify(r.decision)}`);
    const blocoBan = mundo2.log.at(-1)!;
    await (hostB.runtime.get(COMMUNITY_ID)!.core as WritableCoreHandle).append([Buffer.from(blocoBan)]);

    await ateComFila(alvo, () => hostB.conexoes() === 0 && hostB.transport.channelCount() === 0, 'a conexão do banido não caiu no host');

    // E o corte vale nos dois sentidos: o outro lado da conexão também se vê sem ela.
    await ateComFila(alvo, () => alvo.conexoes() === 0, 'o banido ainda se vê conectado');

    // Bloco NOVO pós-ban não chega ao banido — leitura futura é o que §18.3 promete.
    const antes = alvo.runtime.get(COMMUNITY_ID)!.core.length;
    mundo2.submit({
      kind: 'message.send',
      payload: { channelId: g2.channelId, content: 'segredo pos-ban', mentions: [] },
      author: g2.founder,
      hostTs: T0 + 300,
    });
    const blocoNovo = mundo2.log.at(-1)!;
    await (hostB.runtime.get(COMMUNITY_ID)!.core as WritableCoreHandle).append([Buffer.from(blocoNovo)]);
    await new Promise((r2) => setTimeout(r2, 6_000));
    assert.equal(
      alvo.runtime.get(COMMUNITY_ID)!.core.length,
      antes,
      'o banido recebeu bloco depois do corte (§18.3 leitura futura vazou)',
    );
  });

  it('forasteiro continua sem canal nem bloco após as reinicializações (§14.3(1))', async () => {
    const forasteiro = keypairFromSeed('forasteiro-reconexao');
    const intruso = await no({ rotulo: 'intruso-65', bootstrap: await rede(), identity: forasteiro, hosted: false });
    abertos.push(intruso);
    await new Promise((r) => setTimeout(r, 5_000));
    const host = abertos.find((n) => n.runtime.get(COMMUNITY_ID)?.isHost)!;
    assert.equal(intruso.runtime.get(COMMUNITY_ID)!.core.length, 0, 'o intruso recebeu bloco');
    assert.equal(intruso.transport.channelCount(), 0, 'o intruso abriu canal');
    assert.equal(host.transport.channelCount(), 1, 'o host ganhou canal além do membro legítimo');
  });
});
