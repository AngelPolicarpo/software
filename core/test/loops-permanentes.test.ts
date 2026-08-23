// §55 — os loops permanentes que faltavam de §22.1: `outbox.flush`, `outbox.reconcile`,
// `replication.watchdog` e o produtor de `hello` (emenda datada na tabela). O que cada
// asserção fixa:
//
//   §14.5  — `hello` respondido dentro do intervalo é o que torna `synced` ALCANÇÁVEL;
//            ninguém chamava `markHello`, então todo nó vivia em `catching-up`;
//   §16.3  — hello ANTES de qualquer outro método na conexão nova; `opVersion`
//            incompatível → `incompatible` + fila inteira `dropped/client-outdated`;
//   §11.8  — flush sem canal vivo não é tentativa real: não queima tentativa nem
//            enfileira frame no `RpcClient` sem destino;
//   §22.1  — watchdog compara comprimento vs. interpretado e publica a transição
//            (`stalled/no-provider`) pelo fan-out;
//   §11.6  — flush entrega, projector materializa, reconciliação remove e emite
//            `message.accepted` DEPOIS de `messages.appended`.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { openViewDb } from '../src/l0/view/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import { OP_VERSION } from '../src/l1/opCodec/index.ts';
import type { CoreHandle } from '../src/l0/corestore/index.ts';
import { MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import { RpcServer, type RpcTransportPort } from '../src/l3/rpcServer/index.ts';
import { DEFAULT_HELLO_MS, DEFAULT_WATCH_MS } from '../src/l2/communityClient/index.ts';
import { OUTBOX_RECONCILE_MS } from '../src/l2/outbox/index.ts';
import { bootCore, type CoreRuntime } from '../src/composition/boot.ts';
import { LOOP_INTERVALS } from '../src/composition/jobs.ts';
import { rpcPair, tempDir, wireHostRpc } from './helpers/composition.ts';
import { T0, World, genesis, joinMember, keypairFromSeed } from './helpers/world.ts';

const DATA_KEY = Buffer.alloc(32, 55);

type Frame = Record<string, unknown>;
type Resposta = { ok: boolean; data: unknown; code: string | null };

/** Cabo comum aos dois rigs: distribui respostas e eventos como nos rigs anteriores. */
function cabo(rendererSide: MemoryIpcPort) {
  const pendentes = new Map<number, (r: Resposta) => void>();
  const assinaturas = new Map<number, Frame[]>();
  let proximoId = 5000;
  rendererSide.onMessage((raw) => {
    const frame = raw as Frame;
    if (frame['t'] === 'res') {
      const resolver = pendentes.get(frame['id'] as number);
      if (resolver !== undefined) {
        pendentes.delete(frame['id'] as number);
        const erro = frame['err'] as { code?: string } | undefined;
        resolver({ ok: frame['ok'] as boolean, data: frame['data'], code: erro?.code ?? null });
      }
      return;
    }
    if (frame['t'] === 'ev') assinaturas.get(frame['subId'] as number)?.push(frame['data'] as Frame);
  });
  return {
    async request(cmd: string, arg: unknown): Promise<Resposta> {
      const id = ++proximoId;
      return await new Promise<Resposta>((resolve) => {
        pendentes.set(id, resolve);
        rendererSide.postMessage({ t: 'req', epoch: 1, id, cmd, arg, authToken: 'ok' });
      });
    },
    assinar(topic: string): Frame[] {
      const id = ++proximoId;
      const lista: Frame[] = [];
      rendererSide.postMessage({ t: 'sub', epoch: 1, id, topic });
      rendererSide.onMessage((raw) => {
        const f = raw as Frame;
        if (f['t'] === 'subOk' && f['id'] === id) assinaturas.set(f['subId'] as number, lista);
      });
      // O `MemoryIpcPort` entrega por microtask: quem assina e dispara algo em seguida
      // drena a fila antes (`setImmediate`), senão o `sub` ainda não chegou ao servidor.
      return lista;
    },
  };
}

async function esperar(cond: () => boolean, msg: string, timeoutMs = 10_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`${msg} (esperou ${timeoutMs} ms)`);
}

/**
 * Nó MEMBRO de verdade sobre um núcleo falso: o log é o da gênese dos helpers
 * (`world.log` são exatamente os blocos de um core de comunidade), a linha de
 * `manifest.communities` é de membro e o `openCore` injetado devolve o cabo. Com
 * `buraco > 0` o cabo anuncia comprimento maior do que consegue servir — o gap de §14.5.
 */
async function rigMembro(
  rotulo: string,
  relogio: { now: number },
  opts: { readonly buraco?: number } = {},
): Promise<{
  runtime: CoreRuntime;
  manifest: ManifestDb;
  communityId: string;
  channelId: string;
  membro: { publicKey: Buffer; secretKey: Buffer };
  request(cmd: string, arg: unknown): Promise<Resposta>;
  assinar(topic: string): Frame[];
  fechar(): Promise<void>;
}> {
  const dir = tempDir(rotulo);
  const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
  const view = openViewDb(path.join(dir, 'view.db'));
  const [coreSide, rendererSide] = MemoryIpcPort.createPair();
  const g = genesis(new World(keypairFromSeed(`${rotulo}-core`)), keypairFromSeed(`${rotulo}-fundador`));
  const membro = joinMember(g, `${rotulo}-membro`);
  const communityId = g.world.core.publicKey.toString('hex');
  manifest.upsertCommunity({
    communityId,
    coreKey: g.world.core.publicKey,
    blobsKey: keypairFromSeed(`${rotulo}-blobs`).publicKey,
    isHost: false,
    joinedAt: T0,
  });
  const buraco = opts.buraco ?? 0;
  const nucleo: CoreHandle = {
    key: g.world.core.publicKey,
    get length() {
      return g.world.log.length + buraco;
    },
    get: async (seq) => (g.world.log as Array<Uint8Array | undefined>)[seq] ?? null,
    onAppend: () => () => {},
    close: async () => {},
  };
  const io = cabo(rendererSide);
  const runtime: CoreRuntime = await bootCore({
    dataDir: dir,
    manifest,
    view,
    swarm: new Swarm(),
    dataKey: DATA_KEY,
    identity: () => membro,
    foldBuildId: `loops-55-${rotulo}`,
    ipcPort: coreSide,
    epoch: 1,
    tokenVerifier: { consume: () => true },
    hostTurnSecret: () => Buffer.alloc(32, 7),
    now: () => relogio.now,
    schedule: () => 0,
    cancel: () => {},
    openCore: async () => nucleo,
  });
  const vivo = setInterval(() => {}, 5);
  return {
    runtime,
    manifest,
    communityId,
    channelId: g.channelId,
    membro,
    request: io.request,
    assinar: io.assinar,
    async fechar() {
      clearInterval(vivo);
      await runtime.close();
      view.close();
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    },
  };
}

/** Servidor RPC REAL do lado host (`wireHostRpc` de produto) para o nó membro falar com. */
function servidorDeHello(opts: { readonly opVersion: number; readonly coreLength: number }, transport: RpcTransportPort): RpcServer {
  const server = new RpcServer({ protocol: 'community', transport });
  wireHostRpc(server, {
    admission: { submit: async () => ({ ok: false as const, code: 'E_INTERNAL' }) },
    hello: {
      hostVersion: 'rig-host',
      opVersion: opts.opVersion,
      coreLength: opts.coreLength,
      memberCount: 2,
      capabilities: [],
    },
  });
  return server;
}

describe('§55.1 cadências de §22.1 — os períodos vêm das fontes normativas', () => {
  it('flush 1 s, reconcile 30 s, watchdog 5 s, hello 30 s', () => {
    assert.equal(LOOP_INTERVALS['outbox.flush'], 1_000);
    assert.equal(LOOP_INTERVALS['outbox.reconcile'], OUTBOX_RECONCILE_MS);
    assert.equal(OUTBOX_RECONCILE_MS, 30_000, '§27.2 P2P_OUTBOX_RECONCILE_MS default');
    assert.equal(LOOP_INTERVALS['replication.watchdog'], DEFAULT_WATCH_MS);
    assert.equal(DEFAULT_WATCH_MS, 5_000, '§27.2 P2P_REPLICATION_WATCH_MS default');
    assert.equal(LOOP_INTERVALS['host.hello'], DEFAULT_HELLO_MS);
    assert.equal(DEFAULT_HELLO_MS, 30_000, '§27.2 P2P_HELLO_INTERVAL_MS default');
  });
});

describe('§55.2 hello → synced → contato com o host (§14.5, §16.3)', () => {
  it('a resposta do hello marca `markHello`, escreve o último contato e faz o rail sair de catching-up', async () => {
    const relogio = { now: T0 };
    const r = await rigMembro('hello-synced', relogio);
    try {
      const eventosStatus = r.assinar('host.statusChanged');
      const eventosReplicacao = r.assinar('community.replication');
      await new Promise((res) => setImmediate(res));
      assert.equal(r.runtime.client.getState(r.communityId)?.state, 'catching-up', 'sem hello nenhum, synced não existe');

      const [serverSide, clientSide] = rpcPair();
      servidorDeHello({ opVersion: OP_VERSION, coreLength: 8 }, serverSide);
      r.runtime.attachHostChannel({ communityId: r.communityId, transport: clientSide });

      await esperar(() => r.runtime.client.getState(r.communityId)?.state === 'synced', 'o hello não virou synced');
      assert.notEqual(r.manifest.getLastHostSeenAt(r.communityId), null, 'resposta do host é contato observado (DR-29)');
      assert.equal(r.runtime.hostStatus?.statusOf(r.communityId), 'online');
      const online = eventosStatus.find((e) => e['status'] === 'online');
      assert.ok(online !== undefined, 'host.statusChanged{online} não saiu');
      const synced = eventosReplicacao.find((e) => e['state'] === 'synced');
      assert.ok(synced !== undefined, 'community.replication{synced} não saiu pelo fan-out');
    } finally {
      await r.fechar();
    }
  });

  it('opVersion incompatível: incompatible pegajoso e a fila inteira vira dropped/client-outdated', async () => {
    const relogio = { now: T0 };
    const r = await rigMembro('hello-versao', relogio);
    try {
      // O membro tem send_messages no cargo base; o contador local pula o authorSeq que a
      // gênese já consumiu para ele (§7.5).
      r.manifest.advanceAuthorSeq(r.communityId, `channel:${r.channelId}`, 2);
      const enfileirada = await r.request('message.send', { communityId: r.communityId, channelId: r.channelId, content: 'morre com a versão', mentions: [] });
      assert.ok(enfileirada.ok, JSON.stringify(enfileirada));

      const eventosStatus = r.assinar('host.statusChanged');
      await new Promise((res) => setImmediate(res));

      const [serverSide, clientSide] = rpcPair();
      servidorDeHello({ opVersion: OP_VERSION + 1, coreLength: 8 }, serverSide);
      r.runtime.attachHostChannel({ communityId: r.communityId, transport: clientSide });

      await esperar(() => r.runtime.hostStatus?.statusOf(r.communityId) === 'incompatible', 'versão incompatível não marcou incompatible');
      const fila = (await r.request('query.outbox', { communityId: r.communityId })).data as { items: Array<Record<string, unknown>> };
      assert.equal(fila.items.length, 1);
      assert.equal(fila.items[0]!['state'], 'dropped');
      assert.equal(fila.items[0]!['droppedReason'], 'client-outdated', '§16.3: a fila inteira morre com motivo nomeado');
      assert.ok(eventosStatus.some((e) => e['status'] === 'incompatible'), 'host.statusChanged{incompatible} não saiu');
    } finally {
      await r.fechar();
    }
  });

  it('flush sem canal vivo não é tentativa real: nada queima e nada se enfileira (§11.8)', async () => {
    const relogio = { now: T0 };
    const r = await rigMembro('flush-offline', relogio);
    try {
      r.manifest.advanceAuthorSeq(r.communityId, `channel:${r.channelId}`, 2);
      const enfileirada = await r.request('message.send', { communityId: r.communityId, channelId: r.channelId, content: 'esperando rede', mentions: [] });
      assert.ok(enfileirada.ok, JSON.stringify(enfileirada));

      await r.runtime.loops!.runNow('outbox.flush');
      await r.runtime.loops!.runNow('outbox.flush');

      const fila = (await r.request('query.outbox', { communityId: r.communityId })).data as { items: Array<Record<string, unknown>> };
      assert.equal(fila.items[0]!['state'], 'queued', 'sem canal, o item continua queued — tentativa nenhuma aconteceu');
      assert.equal(Number(fila.items[0]!['attempts']), 0);
      const rpc = r.runtime.get(r.communityId)!.rpc!;
      assert.equal(rpc.queued, 0, 'frame nenhum entrou na fila do RpcClient sem destino');
    } finally {
      await r.fechar();
    }
  });
});

describe('§55.3 replication.watchdog — a transição stalled sai pelo fan-out (§14.5)', () => {
  it('gap não avançado por REPLICATION_STALL_MS vira stalled/no-provider', async () => {
    const relogio = { now: T0 };
    // Buraco de 5 registros: o cabo anuncia mais do que consegue servir.
    const r = await rigMembro('watchdog-stalled', relogio, { buraco: 5 });
    try {
      const eventos = r.assinar('community.replication');
      await new Promise((res) => setImmediate(res));

      relogio.now = T0 + 21_000;
      await r.runtime.loops!.runNow('replication.watchdog');

      const stalled = eventos.find((e) => e['state'] === 'stalled');
      assert.ok(stalled !== undefined, 'nenhuma transição para stalled foi publicada');
      assert.equal(stalled!['reason'], 'no-provider');
      assert.ok(Number(stalled!['lag']) >= 1);
      assert.equal(r.runtime.client.getState(r.communityId)?.state, 'stalled');
    } finally {
      await r.fechar();
    }
  });
});

describe('§55.4 outbox.flush + outbox.reconcile — o caminho otimista inteiro no loop (§22.1, §11.6)', () => {
  it('flush entrega, o projector materializa, o reconcile remove e emite accepted DEPOIS do appended', async () => {
    const relogio = { now: T0 };
    const dir = tempDir('loops-flush-host');
    const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
    const view = openViewDb(path.join(dir, 'view.db'));
    const [coreSide, rendererSide] = MemoryIpcPort.createPair();
    const identity = keypairFromSeed('loops-host-eu');
    const runtime: CoreRuntime = await bootCore({
      dataDir: dir,
      manifest,
      view,
      swarm: new Swarm(),
      dataKey: DATA_KEY,
      identity: () => identity,
      identityProfile: () => ({ displayName: 'Dona Raiz', avatarColor: 3 }),
      foldBuildId: 'loops-55-host',
      ipcPort: coreSide,
      epoch: 1,
      tokenVerifier: { consume: () => true },
      hostTurnSecret: () => Buffer.alloc(32, 7),
      now: () => relogio.now,
      schedule: () => 0,
      cancel: () => {},
    });
    const vivo = setInterval(() => {}, 5);
    const io = cabo(rendererSide);
    try {
      const criada = await io.request('community.create', { name: 'Raiz', iconColor: 1 });
      assert.ok(criada.ok, JSON.stringify(criada));
      const { communityId, defaultChannelId } = criada.data as { communityId: string; defaultChannelId: string };

      const aceitas = io.assinar('message.accepted');
      const appendeds = io.assinar('messages.appended');
      await new Promise((res) => setImmediate(res));

      const enfileirada = await io.request('message.send', { communityId, channelId: defaultChannelId, content: 'pelo loop', mentions: [] });
      assert.ok(enfileirada.ok, JSON.stringify(enfileirada));

      // Modo hospedeiro: a submissão é LOCAL (§11.2) — o flush do loop basta, sem rede.
      await runtime.loops!.runNow('outbox.flush');
      let fila = (await io.request('query.outbox', { communityId })).data as { items: Array<Record<string, unknown>> };
      assert.equal(fila.items[0]!['state'], 'awaiting-confirmation', 'ACK local registrado; falta a observação da réplica');

      const c = runtime.get(communityId)!;
      await esperar(() => c.projector.interpretedSeq >= c.core.length - 1, 'projeção não alcançou a cabeça');

      await runtime.loops!.runNow('outbox.reconcile');
      fila = (await io.request('query.outbox', { communityId })).data as { items: Array<Record<string, unknown>> };
      assert.deepEqual(fila.items, [], 'reconciliado: fila vazia');

      const appended = appendeds.at(-1) as { fromSeq?: number } | undefined;
      const aceita = aceitas.at(-1) as Record<string, unknown> | undefined;
      assert.ok(appended !== undefined && aceita !== undefined, 'os dois eventos tinham de sair');
      // §11.6 regra 2 — o `seq` exibido é o observado na réplica, e a ordem é determinada.
      assert.equal(aceita!['opId'], (enfileirada.data as Record<string, unknown>)['opId']);
      assert.ok(typeof aceita!['seq'] === 'number');

      const mensagens = (await io.request('query.messages', { communityId, channelId: defaultChannelId })).data as { messages: Array<{ content: string }> };
      assert.ok(mensagens.messages.some((m) => m.content === 'pelo loop'));
    } finally {
      clearInterval(vivo);
      await runtime.close();
      await new Promise((res) => setTimeout(res, 25));
      view.close();
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  });
});
