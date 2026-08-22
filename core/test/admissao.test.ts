// §46 — nascer, convidar, resolver e resgatar: o fechamento da fase de admissão.
//
// Dois nós numa `hyperdht/testnet`, **nenhuma linha plantada em `manifest.communities`**:
// o host cria a comunidade pelo comando `community.create` (§5.3/§19.1), emite um convite
// (`invite.create`, §12.2), e o candidato resolve (`invite.resolve`) e resgata
// (`invite.redeem`) **pelo código** — o rendezvous de §12.1 é o código de 16 caracteres,
// nada mais. Do outro lado do resgate, o caminho de §45 inteiro: a comunidade entra no
// runtime sem reiniciar o processo, replica o log pela DHT, e uma op sai da outbox do novo
// membro, atravessa o canal `p2p-community/1`, é admitida pelo host e volta projetada.

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
  readonly dir: string;
  request(cmd: string, arg: unknown): Promise<{ ok: boolean; data: unknown; code: string | null; field: string | null }>;
  close(): Promise<void>;
};

/** Um nó sem comunidade nenhuma: o estado `awaiting-community` que este fase elimina. */
async function no(opts: {
  readonly rotulo: string;
  readonly bootstrap: Bootstrap;
  readonly identity: { publicKey: Buffer; secretKey: Buffer };
  readonly displayName: string;
}): Promise<No> {
  (globalThis as { __rotulo?: string }).__rotulo = opts.rotulo;
  const dir = tempDir(opts.rotulo);
  const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
  const view = openViewDb(path.join(dir, 'view.db'));
  const [coreSide, rendererSide] = MemoryIpcPort.createPair();
  const backend = new HyperswarmBackend({ bootstrap: opts.bootstrap, keyPair: opts.identity });
  const swarm = new Swarm({ backend });

  const runtime = await bootCore({
    dataDir: dir,
    manifest,
    view,
    swarm,
    dataKey: DATA_KEY,
    identity: () => opts.identity,
    identityProfile: () => ({ displayName: opts.displayName, avatarColor: 2 }),
    foldBuildId: 'admissao',
    ipcPort: coreSide,
    epoch: 1,
    tokenVerifier: { consume: () => true },
    hostTurnSecret: () => Buffer.alloc(32, 7),
    now: () => T0 + 5_000,
    schedule: () => 0,
    cancel: () => {},
  });
  const transport = startCommunityTransport({ runtime, swarm });
  await transport.flush();

  async function request(cmd: string, arg: unknown): Promise<{ ok: boolean; data: unknown; code: string | null; field: string | null }> {
    const id = 7000 + Math.floor(Math.random() * 1000);
    const resposta = new Promise<{ ok: boolean; data: unknown; code: string | null; field: string | null }>((resolve) => {
      rendererSide.onMessage((frame) => {
        if (frame.t === 'res' && frame.id === id) {
          resolve({ ok: frame.ok, data: frame.data, code: frame.err?.code ?? null, field: frame.err?.field ?? null });
        }
      });
    });
    rendererSide.postMessage({ t: 'req', epoch: 1, id, cmd, arg, authToken: 'ok' });
    return await resposta;
  }

  return {
    runtime,
    transport,
    manifest,
    dir,
    request,
    async close() {
      await transport.stop();
      await runtime.close();
      view.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Espera a condição — a DHT local é rápida, mas não é síncrona (mesma régua de §45). */
async function ate(cond: () => boolean, msg: string, timeoutMs = 25_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`${msg} (esperou ${timeoutMs} ms)`);
}

describe('§46 admissão — criar, convidar, resolver e resgatar pela rede', { timeout: 180_000 }, () => {
  let testnet: Awaited<ReturnType<typeof createTestnet>> | null = null;
  const abertos: No[] = [];

  after(async () => {
    for (const n of abertos.reverse()) await n.close();
    await testnet?.destroy();
  });

  it('a comunidade nasce pelo IPC, o convite sai pelo log e o candidato entra pelo código', async () => {
    testnet = await createTestnet(3);
    // Aquecimento: os nós de bootstrap da testnet precisam de um instante antes de
    // rotear anúncios — sem isto, o primeiro announce/lookup corre contra uma tabela
    // de roteamento ainda vazia.
    await new Promise((r) => setTimeout(r, 1_000));

    // ── Host: identidade existe, comunidades não ────────────────────────────────────────
    const fundador = keypairFromSeed('fundador-46');
    const host = await no({ rotulo: 'host-46', bootstrap: testnet.bootstrap, identity: fundador, displayName: 'Dona' });
    abertos.push(host);
    assert.equal(host.runtime.communities().length, 0);

    // §19.1 — community.create: semente → manifest FULL → gênese em um append.
    const criada = await host.request('community.create', { name: 'Raiz', iconEmoji: '🌱', iconColor: 3 });
    assert.ok(criada.ok, `community.create recusou: ${JSON.stringify(criada)}`);
    const { communityId, defaultChannelId } = criada.data as { communityId: string; defaultChannelId: string };
    assert.match(communityId, /^[0-9a-f]{64}$/);
    assert.match(defaultChannelId, /^ch-[0-9A-Z]+$/);

    const aberta = host.runtime.get(communityId)!;
    assert.equal(aberta.isHost, true);
    assert.equal(aberta.core.length, 6, 'a gênese não tem os seis registros');
    assert.equal(aberta.projector.interpretedSeq, 5);
    assert.equal(aberta.projector.ds.community.name, 'Raiz');
    assert.equal(aberta.projector.ds.members.size, 1);
    // §5.3 passo 2 — a linha existe com semente cifrada, ANTES de qualquer coisa ter dado errado.
    const linhaHost = host.manifest.getCommunity(communityId) as { is_host: number; community_seed_enc: Buffer | null };
    assert.equal(linhaHost.is_host, 1);
    assert.notEqual(linhaHost.community_seed_enc, null);

    // §12.2 — invite.create: op síncrona pelo caminho local (host tem fila agora), code só aqui.
    const convidado = await host.request('invite.create', { communityId, maxUses: 2, label: 'amigos' });
    assert.ok(convidado.ok, `invite.create recusou: ${JSON.stringify(convidado)}`);
    const { code, seq: seqConvite } = convidado.data as { code: string; seq: number };
    assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    assert.equal(seqConvite, 6, 'o convite é o registro seguinte ao da gênese');
    // O anúncio do tópico (§12.2 passo 3) sai no lote projetado; dá a ele um instante
    // para estar na DHT antes de o candidato procurar.
    await host.transport.flush();

    // ── Candidato: nenhuma linha no manifest, só o código ────────────────────────────────
    const bea = keypairFromSeed('bea-46');
    const cand = await no({ rotulo: 'cand-46', bootstrap: testnet.bootstrap, identity: bea, displayName: 'Bea' });
    abertos.push(cand);
    assert.equal(cand.runtime.communities().length, 0);

    // §12.3 — preview pelos seis desfechos possíveis; aqui, ok com quem convidou.
    const prev = await cand.request('invite.resolve', { codeOrLink: code.toLowerCase() });
    assert.ok(prev.ok, `invite.resolve falhou: ${JSON.stringify(prev)}`);
    const preview = prev.data as { status: string; community?: { name: string }; invitedBy?: { displayName: string } };
    assert.equal(preview.status, 'ok');
    assert.equal(preview.community?.name, 'Raiz');
    assert.equal(preview.invitedBy?.displayName, 'Dona');

    // §12.4/§5.3 — redeem: participação no manifest, comunidade no runtime, sem reiniciar.
    const red = await cand.request('invite.redeem', { codeOrLink: `comunidadep2p://join/${code}` });
    assert.ok(red.ok, `invite.redeem falhou: ${JSON.stringify(red)}`);
    const resgate = red.data as { communityId: string; defaultChannelId: string; seq: number };
    assert.equal(resgate.communityId, communityId);
    assert.equal(resgate.defaultChannelId, defaultChannelId);
    assert.equal(resgate.seq, 7, 'o member.join entra depois da gênese (0–5) e do convite (6)');

    const linhaCand = cand.manifest.getCommunity(communityId) as { is_host: number };
    assert.equal(linhaCand.is_host, 0, 'o resgatado não é host');
    assert.notEqual(cand.runtime.get(communityId), undefined, 'a comunidade não entrou no runtime');

    // §14.1/§14.2 — e a réplica alcança o log inteiro pela mesma conexão da DHT. O log
    // chega em rajada: compare com `>=`, nunca com igualdade exata de um `seq` intermediário.
    const c = cand.runtime.get(communityId)!;
    await ate(() => c.projector.interpretedSeq >= 7, `a réplica parou em ${c.projector.interpretedSeq}`);

    // ── O caminho de §45 inteiro: op pela outbox, ida e volta pela rede ──────────────────
    // Log esperado: 6 da gênese + invite.create + member.join = 8 registros.
    const enfileirada = cand.runtime.client.submitQueued(communityId, {
      kindName: 'message.send',
      payload: { channelId: defaultChannelId, content: 'entrei pelo convite', mentions: [] },
    });
    assert.ok(enfileirada.ok, `submitQueued recusou: ${JSON.stringify(enfileirada)}`);
    const outbox = c.outbox!;
    await outbox.flush();
    await ate(() => host.runtime.get(communityId)!.core.length >= 9, 'a op não chegou ao host');
    await ate(() => c.core.length >= 9, 'a op não voltou replicada');
    await ate(() => c.projector.interpretedSeq >= 8, `a réplica não projetou a op (${c.projector.interpretedSeq})`);
    const minhas = [...c.projector.ds.messages.values()].filter((m) => m.authorKey === bea.publicKey.toString('hex'));
    assert.equal(minhas.length, 1);
    // §11.6 — a reconciliação vê a própria op observada e limpa a fila.
    outbox.reconcile();
    assert.equal(outbox.retry(enfileirada.opId).ok, false);
  });
});
