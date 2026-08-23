// §47 — anexo ponta a ponta na rede: pick → stage → message.send com attachment →
// outro nó baixa o blob pelos blocos replicados (§13.2, §13.4, §13.7, §14.1).
//
// Dois nós numa `hyperdht/testnet`, mesma régua de §45/§46: nenhuma linha plantada —
// a comunidade nasce por `community.create`, o candidato entra pelo código. O host escolhe
// um arquivo (o diálogo do main chega injetado, §13.3), faz `blob.stage`, manda a mensagem
// com anexo pela outbox e o candidato — que nunca viu os bytes — projeta a mensagem e baixa
// o conteúdo DO CORE DE BLOBS do autor, pela mesma conexão da comunidade, com hash
// verificado contra o que a mensagem projetou.

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

async function no(opts: {
  readonly rotulo: string;
  readonly bootstrap: Bootstrap;
  readonly identity: { publicKey: Buffer; secretKey: Buffer };
  readonly displayName: string;
  /** O diálogo nativo do main (§13.3/§15.7). Só quem anexa precisa dele. */
  readonly pickFile?: (communityId: string) => { readonly path: string; readonly sizeBytes: number } | null;
}): Promise<No> {
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
    foldBuildId: 'anexos-rede',
    ipcPort: coreSide,
    epoch: 1,
    tokenVerifier: { consume: () => true },
    hostTurnSecret: () => Buffer.alloc(32, 7),
    ...(opts.pickFile !== undefined ? { pickFile: opts.pickFile } : {}),
    now: () => T0 + 5_000,
    schedule: () => 0,
    cancel: () => {},
  });
  const transport = startCommunityTransport({ runtime, swarm });
  await transport.flush();

  async function request(cmd: string, arg: unknown): Promise<{ ok: boolean; data: unknown; code: string | null; field: string | null }> {
    const id = 9000 + Math.floor(Math.random() * 1000);
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
async function ate(cond: () => boolean, msg: string, timeoutMs = 30_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`${msg} (esperou ${timeoutMs} ms)`);
}

describe('§47 anexos — o blob atravessa a rede entre o autor e quem lê', { timeout: 240_000 }, () => {
  let testnet: Awaited<ReturnType<typeof createTestnet>> | null = null;
  const abertos: No[] = [];

  after(async () => {
    for (const n of abertos.reverse()) await n.close();
    await testnet?.destroy();
  });

  it('pick → stage → message.send com anexo → o outro nó baixa o blob com hash verificado', async () => {
    testnet = await createTestnet(3);
    // Aquecimento dos bootstrap nodes (mesma lição da admissão).
    await new Promise((r) => setTimeout(r, 1_000));

    // ── Host: cria a comunidade, com o diálogo injetado apontando para o fixture ────────
    const conteudo = Buffer.alloc(70_000, 7); // dois blocos de 64 KiB — fatia cheia + resto
    const fundador = keypairFromSeed('fundador-47');
    const dirFixture = tempDir('host-47-fixture');
    const fixturePath = path.join(dirFixture, 'relatorio-grande.pdf');
    fs.writeFileSync(fixturePath, conteudo);

    const host = await no({
      rotulo: 'host-47',
      bootstrap: testnet.bootstrap,
      identity: fundador,
      displayName: 'Dona',
      pickFile: () => ({ path: fixturePath, sizeBytes: conteudo.byteLength }),
    });
    abertos.push(host);

    const criada = await host.request('community.create', { name: 'Raiz', iconEmoji: '📎', iconColor: 1 });
    assert.ok(criada.ok, `community.create recusou: ${JSON.stringify(criada)}`);
    const { communityId, defaultChannelId } = criada.data as { communityId: string; defaultChannelId: string };

    const convidado = await host.request('invite.create', { communityId, maxUses: 1 });
    assert.ok(convidado.ok, `invite.create recusou: ${JSON.stringify(convidado)}`);
    const { code } = convidado.data as { code: string };
    await host.transport.flush();

    // ── Candidato: entra pelo código, replica o log, e NÃO tem o core de blobs do autor ──
    const bea = keypairFromSeed('bea-47');
    const cand = await no({
      rotulo: 'cand-47',
      bootstrap: testnet.bootstrap,
      identity: bea,
      displayName: 'Bea',
    });
    abertos.push(cand);

    const red = await cand.request('invite.redeem', { codeOrLink: code });
    assert.ok(red.ok, `invite.redeem falhou: ${JSON.stringify(red)}`);
    const c = cand.runtime.get(communityId)!;
    // O log chega em rajada: compare com `>=` (lição de §45).
    await ate(() => c.projector.interpretedSeq >= 7, `a réplica parou em ${c.projector.interpretedSeq}`);

    // O candidato tem core de blobs LOCAL (o seu), mas não o do autor.
    assert.notEqual(cand.runtime.blobs.localCoreKey(communityId), null, 'o resgatado saiu sem core de blobs próprio');
    assert.equal(cand.runtime.blobs.localCoreKey(communityId)?.equals(host.runtime.blobs.localCoreKey(communityId)!), false);

    // ── Host: pick → stage → message.send com anexo (§13.2 passos 1–7) ───────────────────
    const ticket = ((await host.request('file.pickForAttachment', { communityId })).data ?? {}) as unknown as { ticketId: string };
    assert.match(ticket.ticketId, /^[0-9a-f]{32}$/);
    const staged = ((await host.request('blob.stage', { ticketId: ticket.ticketId })).data ?? {}) as unknown as {
      blobsCoreKey: string;
      blobId: { byteOffset: number; blockOffset: number; blockLength: number; byteLength: number };
      name: string;
      hash: string;
      sizeBytes: number;
    };
    assert.equal(staged.blobId.blockLength, 2, 'o conteúdo não entrou como duas fatias');
    assert.equal(staged.sizeBytes, conteudo.byteLength);

    const enviada = await host.request('message.send', {
      communityId,
      channelId: defaultChannelId,
      content: 'segue o relatório',
      mentions: [],
      attachment: { ticketId: ticket.ticketId },
    });
    assert.ok(enviada.ok, `message.send recusou: ${JSON.stringify(enviada)}`);
    await host.runtime.get(communityId)!.outbox!.flush();

    // A mensagem cruza a rede e o candidato projeta o anexo.
    // Log esperado: 6 da gênese + invite.create + member.join + message.send = 9 registros
    // (índices 0..8); a réplica chega em rajada — compare com `>=` (lição de §45).
    await ate(() => host.runtime.get(communityId)!.core.length >= 9, 'a op não chegou ao host');
    await ate(() => c.core.length >= 9, 'a op não voltou replicada');
    await ate(() => c.projector.interpretedSeq >= 8, `a réplica não projetou a mensagem (${c.projector.interpretedSeq})`);

    // ── Candidato: baixa o blob DO AUTOR pela rede (§13.4) ───────────────────────────────
    const blobIdHex = staged.hash.slice(0, 32);
    const antes = cand.runtime.blobs.getDownloadState(staged.blobsCoreKey, blobIdHex);
    assert.notEqual(antes, 'downloaded', 'o candidato já tinha o blob antes de pedir');

    const pedido = await cand.request('blob.download', {
      communityId,
      blobsCoreKey: staged.blobsCoreKey,
      blobId: staged.blobId,
    });
    assert.ok(pedido.ok, `blob.download recusou: ${JSON.stringify(pedido)}`);

    await ate(
      () => cand.runtime.blobs.getDownloadState(staged.blobsCoreKey, blobIdHex) === 'downloaded',
      `o download não completou (estado: ${String(cand.runtime.blobs.getDownloadState(staged.blobsCoreKey, blobIdHex))})`,
    );

    // Os bytes que chegaram são os bytes originais, e o caminho é o cache de §10.1.
    const linhaCache = cand.runtime.blobs.cache.get(Buffer.from(staged.blobsCoreKey, 'hex'), blobIdHex);
    assert.ok(linhaCache?.path, 'o cache não registrou o caminho do arquivo');
    assert.ok(linhaCache.path!.includes(staged.blobsCoreKey.slice(0, 16)), 'o arquivo não está sob o cache do core do autor');
    assert.ok(fs.readFileSync(linhaCache.path!).equals(conteudo), 'os blocos chegados divergem do original');
    assert.equal(linhaCache.declaredSize, conteudo.byteLength);

    fs.rmSync(dirFixture, { recursive: true, force: true });
  });
});
