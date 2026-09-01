// O segundo convite do mesmo host para o mesmo par (§12.3).
//
// Dois nós numa `hyperdht/testnet`. O candidato entra na primeira comunidade pelo código —
// o caminho de §46 — e, com a conexão ENTRE OS DOIS já viva por causa da replicação, tenta
// resolver o convite de uma SEGUNDA comunidade do mesmo host.
//
// O hyperswarm não emite `connection` de novo para um par já conectado: `_handlePeer`
// registra o tópico no `PeerInfo` (que é vivo) e sai cedo quando `_allConnections` já tem
// aquela chave. Enquanto `SwarmConnection.topicsHex` era uma cópia do instante da conexão,
// o tópico do segundo convite não existia para ninguém: o candidato esperava as rodadas de
// descoberta e caía em `E_HOST_UNAVAILABLE` — que, atrás do prazo de 30 s do renderer
// (§16.1), chegava à tela como `E_TIMEOUT`. Hospedar uma comunidade e convidar de novo
// quem já é membro de outra era, portanto, impossível.
//
// A lista passou a ser lida na hora e o backend avisa por `onPeerTopics`; o transporte
// reavalia a conexão e o canal de admissão abre sobre a conexão que já existia.
//
// Verificado por mutação: congelar `topicsHex` no instante da conexão (ou não assinar
// `onPeerTopics`) derruba o caso — e só ele: o primeiro convite continua passando, que é o
// que torna o defeito difícil de ver.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import createTestnet from 'hyperdht/testnet.js';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { openViewDb } from '../src/l0/view/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import { HyperswarmBackend } from '../src/l0/swarm/hyperswarm.ts';
import { MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import { bootCore, type CoreRuntime } from '../src/composition/boot.ts';
import { startCommunityTransport, type CommunityTransport } from '../src/composition/transport.ts';
import { tempDir } from './helpers/composition.ts';
import { T0, keypairFromSeed } from './helpers/world.ts';

const DATA_KEY = Buffer.alloc(32, 11);
type Bootstrap = ReadonlyArray<{ readonly host: string; readonly port: number }>;
type No = {
  readonly runtime: CoreRuntime;
  readonly transport: CommunityTransport;
  readonly manifest: ManifestDb;
  request(cmd: string, arg: unknown): Promise<{ ok: boolean; data: unknown; code: string | null }>;
  close(): Promise<void>;
};

async function no(opts: { rotulo: string; bootstrap: Bootstrap; identity: { publicKey: Buffer; secretKey: Buffer }; displayName: string }): Promise<No> {
  const dir = tempDir(opts.rotulo);
  const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
  const view = openViewDb(path.join(dir, 'view.db'));
  const [coreSide, rendererSide] = MemoryIpcPort.createPair();
  const backend = new HyperswarmBackend({ bootstrap: opts.bootstrap, keyPair: opts.identity });
  const swarm = new Swarm({ backend });
  const runtime = await bootCore({
    dataDir: dir, manifest, view, swarm, dataKey: DATA_KEY,
    identity: () => opts.identity,
    identityProfile: () => ({ displayName: opts.displayName, avatarColor: 2 }),
    foldBuildId: 'segundo-convite', ipcPort: coreSide, epoch: 1,
    tokenVerifier: { consume: () => true }, hostTurnSecret: () => Buffer.alloc(32, 7),
    now: () => T0 + 5_000, schedule: () => 0, cancel: () => {},
  });
  const transport = startCommunityTransport({ runtime, swarm });
  await transport.flush();
  async function request(cmd: string, arg: unknown) {
    const id = 7000 + Math.floor(Math.random() * 100000);
    const resposta = new Promise<{ ok: boolean; data: unknown; code: string | null }>((resolve) => {
      rendererSide.onMessage((frame) => {
        if (frame.t === 'res' && frame.id === id) resolve({ ok: frame.ok, data: frame.data, code: frame.err?.code ?? null });
      });
    });
    rendererSide.postMessage({ t: 'req', epoch: 1, id, cmd, arg, authToken: 'ok' });
    return await resposta;
  }
  return {
    runtime, transport, manifest, request,
    async close() {
      await transport.stop();
      await runtime.close();
      view.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    },
  };
}

async function ate(cond: () => boolean, msg: string, timeoutMs = 25_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`${msg} (esperou ${timeoutMs} ms)`);
}

describe('§12.3 — o segundo convite do mesmo host, sobre a conexão que já existe', { timeout: 240_000 }, () => {
  let testnet: Awaited<ReturnType<typeof createTestnet>> | null = null;
  const abertos: No[] = [];
  after(async () => {
    for (const n of abertos.reverse()) await n.close();
    await testnet?.destroy();
  });

  it('resolve e resgata a segunda comunidade depois de já ser membro da primeira', async () => {
    testnet = await createTestnet(3);
    await new Promise((r) => setTimeout(r, 1_000));

    const host = await no({ rotulo: 'host-2conv', bootstrap: testnet.bootstrap, identity: keypairFromSeed('host-2conv'), displayName: 'Dona' });
    abertos.push(host);
    const bea = keypairFromSeed('bea-2conv');
    const cand = await no({ rotulo: 'cand-2conv', bootstrap: testnet.bootstrap, identity: bea, displayName: 'Bea' });
    abertos.push(cand);

    const c1 = await host.request('community.create', { name: 'Primeira', iconColor: 3 });
    assert.ok(c1.ok, JSON.stringify(c1));
    const cid1 = (c1.data as { communityId: string }).communityId;
    const i1 = await host.request('invite.create', { communityId: cid1, maxUses: 2 });
    assert.ok(i1.ok, JSON.stringify(i1));
    const code1 = (i1.data as { code: string }).code;
    await host.transport.flush();

    const p1 = await cand.request('invite.resolve', { codeOrLink: code1 });
    assert.ok(p1.ok, 'o primeiro convite já não resolve');
    const r1 = await cand.request('invite.redeem', { codeOrLink: code1 });
    assert.ok(r1.ok, JSON.stringify(r1));
    await ate(() => (cand.runtime.get(cid1)?.projector.interpretedSeq ?? -1) >= 7, 'a réplica da primeira não chegou');

    const c2 = await host.request('community.create', { name: 'Segunda', iconColor: 5 });
    assert.ok(c2.ok, JSON.stringify(c2));
    const cid2 = (c2.data as { communityId: string }).communityId;
    const i2 = await host.request('invite.create', { communityId: cid2, maxUses: 2 });
    assert.ok(i2.ok, JSON.stringify(i2));
    const code2 = (i2.data as { code: string }).code;
    await host.transport.flush();

    // Nenhuma conexão nova é possível aqui: o hyperswarm já tem uma com esta chave. O que
    // o candidato precisa é que o tópico novo apareça na conexão viva.
    const p2 = await cand.request('invite.resolve', { codeOrLink: code2 });
    assert.ok(p2.ok, `o segundo convite não resolveu: ${p2.code}`);
    const preview = p2.data as { status: string; community?: { name: string } };
    assert.equal(preview.status, 'ok');
    assert.equal(preview.community?.name, 'Segunda');

    // E o resgate fecha o ciclo: duas comunidades do mesmo host, na mesma instalação.
    const r2 = await cand.request('invite.redeem', { codeOrLink: code2 });
    assert.ok(r2.ok, `o segundo resgate falhou: ${r2.code}`);
    assert.notEqual(cand.runtime.get(cid2), undefined, 'a segunda não entrou no runtime');
    assert.notEqual(cand.runtime.get(cid1), undefined, 'a primeira saiu do runtime');
  });
});
