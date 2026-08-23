// Testes de integração da fase de integração — as juntas entre módulos reais, com
// transporte simulado (§16 RPC sobre canais em memória; IPC-R sobre `MemoryIpcPort`).
//
// O que aqui é REAL: HostAdmission, Projector + view.db, ManifestDb (+ outbox e
// consentimento de relay), RpcServer/RpcClient, IpcServer + registro de comandos,
// Diagnostics, SearchService, RelayVolunteer, VoiceHostSessions, ShareHostSessions e o
// codec STUN (probe UDP de loopback contra o MediaServer).
// O que aqui é SIMULADO: a socket do Hyperswarm/protomux (par de canais em memória), o
// probe NAT (facade do DHT) e o processo main (tokens/identityStatus).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { openViewDb } from '../src/l0/view/index.ts';
import { createCore, deriveCommunityKeyPairs, openCore } from '../src/l0/corestore/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import type { DecisionState } from '../src/l1/fold/index.ts';
import { KINDS, OP_VERSION, decodeHostRecord, encodeHostRecord, hostRecordSigningHash } from '../src/l1/opCodec/index.ts';
import { HOST_INACTIVITY_MS, MAX_CAMERAS, MAX_VOICE_PARTICIPANTS, MAX_REACTION_EMOJIS, MEDIA_TICKET_TTL_MS, RELAY_TTL_MS, SHARE_MAX_VIEWERS } from '../src/l1/fold/constants.ts';
import { entityId } from '../src/l1/idgen/index.ts';
import { CommunityClient } from '../src/l2/communityClient/index.ts';
import type { SubmissionLimits } from '../src/l2/communityClient/index.ts';
import { HostAdmission } from '../src/l2/communityHost/index.ts';
import { Diagnostics } from '../src/l2/diagnostics/index.ts';
import { Outbox, type OutboxObservation } from '../src/l2/outbox/index.ts';
import { RelayVolunteer, type RelayOpSubmission, type RelaySubmitPort } from '../src/l2/relay/index.ts';
import { SearchService } from '../src/l2/search/index.ts';
import { ShareHostSessions } from '../src/l2/shareStar/index.ts';
import { SuccessionService, openSealedSeed } from '../src/l2/succession/index.ts';
import { VoiceHostSessions } from '../src/l2/voiceCoordinator/index.ts';
import { Projector } from '../src/l1/projector/index.ts';
import {
  IpcClient,
  IpcServer,
  MemoryIpcPort,
} from '../src/l3/ipcRenderer/index.ts';
import { registerCoreCommands, type MediaSurfaceDeps } from '../src/l3/ipcRenderer/commands.ts';
import { localMediaDispatcher } from '../src/l3/ipcRenderer/media.ts';
import { RpcClient } from '../src/l3/rpcClient/index.ts';
import { PROTOCOL_PARITY_SOURCE, RPC_NOTIFICATIONS as RPC_NOTIFICATIONS_CLIENT } from '../src/l3/rpcClient/index.ts';
import { RPC_FRAME_MAX_BYTES, RPC_METHODS, RPC_NOTIFICATIONS, RpcServer } from '../src/l3/rpcServer/index.ts';
import { World, genesis, joinMember, keypairFromSeed, makeRecord, sign, T0 } from './helpers/world.ts';
import {
  SUBMISSION_LIMITS,
  UdpStunProbe,
  aggregateMetricsPort,
  bridgeSubmitSyncPort,
  communityLeavePort,
  corestoreContinuationCorePort,
  envelopeTargetResolver,
  logEscrowPort,
  manifestCommunitySeedPort,
  manifestRelayConsentPort,
  migrateRail,
  opCodecSignPort,
  queryCommunityPort,
  rpcHostSubmitPort,
  rpcPair,
  rpcSubmitPort,
  storeCommunitySeed,
  swarmNatProbe,
  tempDir,
  voiceStateOf,
  wireHostRpc,
} from './helpers/composition.ts';

const COMMUNITY = 'comunidade-integracao';

/** Porta de submissão do relay que só conta — o destino real do op é a outbox (§17.7). */
function countingRelaySubmit(): RelaySubmitPort {
  let n = 0;
  return {
    submit(submission: RelayOpSubmission) {
      void submission;
      n += 1;
      return n;
    },
  };
}

function fakeClock() {
  let t = T0 + 900_000;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe('rpc §16 — paridade das tabelas de protocolo', () => {
  it('servidor e cliente enxergam os mesmos tetos e métodos de §16.1/§16.2', () => {
    for (const protocol of ['community', 'admission'] as const) {
      assert.equal(PROTOCOL_PARITY_SOURCE[protocol].frameMaxBytes, RPC_FRAME_MAX_BYTES[protocol]);
      assert.deepEqual([...PROTOCOL_PARITY_SOURCE[protocol].methods].sort(), [...RPC_METHODS[protocol]].sort());
    }
  });
});

describe('rpc §16.3 — paridade da tabela de notificações', () => {
  it('cliente e servidor conhecem exatamente os mesmos tópicos', () => {
    assert.deepEqual([...RPC_NOTIFICATIONS_CLIENT].sort(), [...RPC_NOTIFICATIONS].sort());
  });

  it('todo tópico de §16.3 é um evento de §15.5 de mesmo nome', () => {
    // §16.3 é a direção host → membro dos eventos que só o host conhece; nenhum nome novo.
    const md = fs.readFileSync(path.join(process.cwd(), '..', 'docs', 'backend-v2.md'), 'utf8');
    const eventos = md.slice(md.indexOf('### 15.5'), md.indexOf('### 15.6'));
    for (const topico of RPC_NOTIFICATIONS) {
      assert.ok(eventos.includes('`' + topico + '`'), topico + ' não está na tabela de §15.5');
    }
  });
});

describe('rpc §16 — escrita ponta a ponta: outbox → rpc → host → réplica', () => {
  /**
   * Cabo da ponte de submissão assinada (§29.2 item 1): o grafo de §4 montado com os
   * módulos reais — CommunityClient + outbox sobre RPC, HostAdmission, Projector — e o
   * codec/assinatura injetados pela porta (`opCodecSignPort`). O mesmo cabo serve ao
   * caminho A (outbox) e ao ⏱ (submitOp), e à superfície IPC-R de mensagens.
   */
  async function submissionRig(opts?: { readonly limits?: SubmissionLimits }) {
    const dir = tempDir('ponte');
    const g = genesis();
    const ana = joinMember(g, 'ana-ponte');
    const blocks = [...g.world.log].map((block) => Buffer.from(block));
    const listeners = new Set<() => void>();
    const core = {
      key: g.world.core.publicKey,
      get length() {
        return blocks.length;
      },
      get: async (seq: number) => blocks[seq] ?? null,
      onAppend: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      append: async (newBlocks: readonly Uint8Array[]) => {
        blocks.push(...newBlocks.map((block) => Buffer.from(block)));
        for (const listener of listeners) listener();
      },
      close: async () => {},
    };

    const view = openViewDb(path.join(dir, 'view.db'));
    const projector = new Projector(view, core, { foldBuildId: 'integracao-ponte' });
    await projector.boot();

    const admission = new HostAdmission({
      core,
      state: projector.ds,
      makeHostRecord: (envelope, hostTs) => {
        const hostSig = sign(hostRecordSigningHash(envelope, hostTs, 0), g.world.core.secretKey);
        return encodeHostRecord({ envelope: Buffer.from(envelope), hostTs, flags: 0, hostSig });
      },
      now: () => T0 + 200,
      groupWindowMs: 4,
      groupMax: 8,
    });

    const [hostSide, memberSide] = rpcPair();
    const server = new RpcServer({ protocol: 'community', transport: hostSide });
    wireHostRpc(server, {
      admission,
      hello: { hostVersion: '0.0.0', opVersion: OP_VERSION, coreLength: core.length, memberCount: 2, capabilities: [] },
    });
    const rpc = new RpcClient({ protocol: 'community', transport: memberSide, role: 'member' });
    const hello = await rpc.call('hello', new Uint8Array());
    assert.ok(hello.ok);

    const communityId = g.world.core.publicKey.toString('hex');
    const manifest = new ManifestDb(path.join(dir, 'manifest-membro.db'));
    // §10.2: communities é a enumeração autoritativa de participação — quem entrou tem linha.
    manifest.upsertCommunity({
      communityId,
      coreKey: g.world.core.publicKey,
      blobsKey: keypairFromSeed('blobs-membro').publicKey,
      isHost: false,
      joinedAt: T0,
    });
    // O fan-out de §15.5 mora no IpcServer, criado mais abaixo; o laço é fechado ali.
    let emitir: ((topic: string, data: unknown) => void) | null = null;
    const observation: OutboxObservation = {
      observedOp: (id) => projector.observedOp(id),
      watermark: (item) => projector.authorWatermark(ana.publicKey, item.sequence_scope),
      interpretedSeq: () => projector.interpretedSeq,
      resolveTarget: envelopeTargetResolver(),
    };
    const clock = fakeClock();
    const outbox = new Outbox({
      manifest,
      communityId,
      submit: rpcSubmitPort(rpc),
      observation,
      onOutcome: (ev) => emitir?.(ev.topic, ev.data),
      now: () => T0 + 300,
      random: () => 0.5,
    });
    // Reconciliação de boot de §7.5: next = max(manifest, lastAuthorSeq observado no log) + 1.
    // O rig nasce com o join da ana já no log e o contador local vazio — sem isto, a primeira
    // op em escopo `community` reutilizaria o número do member.join e seria ignorada (estágio 6).
    for (const scope of ['community', `channel:${g.channelId}`]) {
      const next = Math.max(manifest.nextAuthorSeq(communityId, scope) - 1, projector.authorWatermark(ana.publicKey, scope)) + 1;
      manifest.raw
        .prepare(
          'INSERT INTO local_author_seq(community_id, sequence_scope, next_author_seq) VALUES (?, ?, ?) ' +
            'ON CONFLICT(community_id, sequence_scope) DO UPDATE SET next_author_seq = excluded.next_author_seq',
        )
        .run(communityId, scope, next);
    }
    const client = new CommunityClient({
      swarm: new Swarm(),
      clock,
      signing: {
        authorKey: ana,
        codec: opCodecSignPort(),
        opVersion: OP_VERSION,
        limits: opts?.limits ?? SUBMISSION_LIMITS,
      },
    });
    client.addCommunity({ communityId, core, projector, outbox, hostSubmit: rpcHostSubmitPort(rpc) });

    // IPC-R: message.send na frente da mesma ponte (§15.4 Mensagens)
    const ipcSwarm = new Swarm();
    const diagnostics = new Diagnostics({
      swarm: ipcSwarm,
      nat: swarmNatProbe('moderate'),
      stun: { probe: async () => true },
      relay: { available: () => false },
      metrics: aggregateMetricsPort({ swarm: ipcSwarm, natType: 'moderate' }),
      clock,
    });
    const search = new SearchService({ view, clock });
    const [ipcCoreSide, ipcRendererSide] = MemoryIpcPort.createPair();
    const ipcServer = new IpcServer({
      epoch: 1,
      port: ipcCoreSide,
      tokenVerifier: { consume: () => false },
      identityStatus: { isLoaded: true },
    });
    // Ciclo de vida e consulta (§11.1 exceção, §15.6): identidade comutável para exercitar
    // a recusa do host na mesma superfície.
    let atorSaida = ana.publicKey.toString('hex');
    const portaSaida = communityLeavePort({
      client,
      manifest,
      outboxOf: () => outbox,
      selfKeyHex: () => atorSaida,
    });

    registerCoreCommands(ipcServer, {
      diagnostics,
      search,
      messages: {
        writeStateFor: (cid) => client.writeStateFor(cid),
        selfKeyHex: () => ana.publicKey.toString('hex'),
        submitQueued: (cid, input) => client.submitQueued(cid, input),
        retryQueued: (opId) => outbox.retry(opId),
        cancelQueued: (opId) => outbox.cancelQueued(opId),
      },
      community: { leave: (cid) => portaSaida(cid) },
      communityQuery: queryCommunityPort({
        stateFor: (cid) => (cid === communityId ? projector.ds : null),
        selfKeyHex: () => ana.publicKey.toString('hex'),
        replicationOf: (cid) => client.getState(cid) ?? { state: 'catching-up', lag: 0 },
      }),
    });
    emitir = (topic, data) => ipcServer.emit(topic, data);
    const ipc = new IpcClient();
    ipc.attach(ipcRendererSide);
    const ipcHello = ipc.waitForHello(1_000);
    ipcServer.sendHello('integracao', OP_VERSION);
    await ipcHello;

    return {
      g,
      ana,
      dir,
      core,
      blocks,
      projector,
      admission,
      outbox,
      manifest,
      client,
      rpc,
      ipc,
      communityId,
      channelId: g.channelId,
      sairComo(keyHex: string): void {
        atorSaida = keyHex;
      },
      cleanup() {
        client.close();
        view.close();
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
      },
    };
  }

  it('ponte real no lugar do makeRecord: submitQueued sela, enfileira e a observação local remove (§19.3)', async () => {
    const r = await submissionRig();
    try {
      for (let i = 0; i < 4; i++) {
        const result = r.client.submitQueued(r.communityId, {
          kindName: 'message.send',
          payload: { channelId: r.channelId, content: `ponte-${i}`, mentions: [] },
          clientRef: `ref-${i}`,
        });
        assert.deepEqual(result, {
          ok: true,
          opId: (result as { ok: true; opId: string }).opId,
          state: 'queued',
        });
        assert.equal((result as { opId: string }).opId.length, 64); // BLAKE2b-256 em hex (§7.3)
      }

      // meta completa de §11.2, escopo por kind e authorSeq reservado antes de assinar
      const rows = r.manifest.all(r.communityId);
      assert.equal(rows.length, 4);
      assert.deepEqual(
        rows.map((row) => row.author_seq),
        [1, 2, 3, 4],
      );
      assert.ok(
        rows.every(
          (row) =>
            row.sequence_scope === `channel:${r.channelId}` &&
            row.channel_id === r.channelId &&
            row.kind === KINDS['message.send'] &&
            row.state === 'queued' &&
            row.client_ref !== null,
        ),
      );

      await r.outbox.flush();
      assert.equal(r.manifest.all(r.communityId).length, 4); // acked ≠ removido: falta observar (§11.6)

      await r.projector.catchUp(); // a réplica interpreta os blocos appendados pelo host
      assert.deepEqual(r.outbox.reconcile(), { removed: 4, mismatch: 0, expired: 0 });
      assert.equal(r.manifest.all(r.communityId).length, 0);
    } finally {
      r.cleanup();
    }
  });

  it('validação advisória produz os erros síncronos de §15.4 sem queimar authorSeq (§8.7)', async () => {
    const r = await submissionRig();
    try {
      // conteúdo fora dos tetos de campo (§8.6) — nada enfileirado
      assert.deepEqual(
        r.client.submitQueued(r.communityId, {
          kindName: 'message.send',
          payload: { channelId: r.channelId, content: '   ', mentions: [] },
        }),
        { ok: false, code: 'E_VALIDATION', field: 'content' },
      );
      assert.deepEqual(
        r.client.submitQueued(r.communityId, {
          kindName: 'message.send',
          payload: { channelId: r.channelId, content: 'x'.repeat(4001), mentions: [] },
        }),
        { ok: false, code: 'E_VALIDATION', field: 'content' },
      );
      assert.deepEqual(
        r.client.submitQueued(r.communityId, {
          kindName: 'message.send',
          payload: { channelId: r.channelId, content: 'ok', mentions: Array.from({ length: 65 }, (_, i) => `m${i}`) },
        }),
        { ok: false, code: 'E_VALIDATION', field: 'mentions' },
      );
      // kind fora do catálogo fechado de §7.4 (DR-10)
      assert.deepEqual(
        r.client.submitQueued(r.communityId, { kindName: 'nao.existe', payload: {} }),
        { ok: false, code: 'E_UNKNOWN_KIND' },
      );
      // domínio errado para o caminho: estrutura é síncrona por contrato (§11.1)
      assert.deepEqual(
        r.client.submitQueued(r.communityId, { kindName: 'channel.create', payload: {} }),
        { ok: false, code: 'E_VALIDATION', field: 'kind' },
      );

      // nenhuma recusa acima consumiu número: o próximo envio ainda é o authorSeq 1
      const queued = r.client.submitQueued(r.communityId, {
        kindName: 'message.send',
        payload: { channelId: r.channelId, content: 'primeiro de verdade', mentions: [] },
      });
      assert.equal(queued.ok, true);
      assert.deepEqual(
        r.manifest.all(r.communityId).map((row) => row.author_seq),
        [1],
      );

      // canal somente-leitura para TODOS os cargos da ana → E_CHANNEL_READ_ONLY (R-22).
      // O canal entra pelo host real, via submitOp de §162: quem decide continua sendo o
      // fold, na admissão.
      const readOnlyRecord = makeRecord(r.g.world.core, {
        kind: 'channel.create',
        author: r.g.founder,
        authorSeq: r.g.world.next(r.g.founder),
        hostTs: T0 + 250,
        payload: { categoryId: r.g.categoryId, type: 0, name: 'trancado', readOnlyForRoleIds: [r.g.baseRoleId] },
      });
      const viaRpc = await rpcHostSubmitPort(r.rpc)(decodeHostRecord(readOnlyRecord)!.envelope);
      assert.deepEqual(viaRpc, { ok: true, seq: r.blocks.length - 1 });
      await r.projector.catchUp();
      const readOnlyEntry = [...r.projector.ds.channels.entries()].find(([, ch]) => ch.name === 'trancado');
      assert.ok(readOnlyEntry !== undefined);
      assert.deepEqual(
        r.client.submitQueued(r.communityId, {
          kindName: 'message.send',
          payload: { channelId: readOnlyEntry[0], content: 'não passa', mentions: [] },
        }),
        { ok: false, code: 'E_CHANNEL_READ_ONLY' },
      );
      assert.deepEqual(
        r.manifest.all(r.communityId).map((row) => row.author_seq),
        [1],
      );
    } finally {
      r.cleanup();
    }
  });

  it('caminho ⏱: submitSync pela porta submitOp devolve {seq} e a recusa queima o número (§7.5)', async () => {
    const r = await submissionRig();
    try {
      const ok = await r.client.submitSync(r.communityId, {
        kindName: 'identity.update',
        payload: { displayName: 'Ana Ponte' },
      });
      assert.ok(ok.ok);
      assert.equal(ok.ok ? ok.seq : -1, r.blocks.length - 1); // seq relativo à cabeça do log
      await r.projector.catchUp();
      assert.equal(r.projector.authorWatermark(r.ana.publicKey, 'community'), 2); // join=1, update=2

      // domínio errado para o caminho síncrono: mensagem enfileira, não submete (§11.1)
      assert.deepEqual(
        await r.client.submitSync(r.communityId, {
          kindName: 'message.send',
          payload: { channelId: r.channelId, content: 'x', mentions: [] },
        }),
        { ok: false, code: 'E_VALIDATION', field: 'kind' },
      );

      // recusa vinculante do host: payload que não casa a linha de §7.4 nem chega a sair
      assert.deepEqual(
        await r.client.submitSync(r.communityId, { kindName: 'category.create', payload: {} }),
        { ok: false, code: 'E_VALIDATION', field: 'payload' },
      );

      // comunidade que esta instalação não conhece: nada local para escrever (§20.2 estado)
      assert.deepEqual(
        await r.client.submitSync('comunidade-inexistente', {
          kindName: 'identity.update',
          payload: { displayName: 'Ninguém' },
        }),
        { ok: false, code: 'E_NOT_FOUND' },
      );
    } finally {
      r.cleanup();
    }
  });

  it('IPC-R message.send: classe standard, perm send_messages pelo recorte do DS, resposta {opId,state} (§15.4)', async () => {
    const r = await submissionRig();
    try {
      const sent = (await r.ipc.request('message.send', {
        communityId: r.communityId,
        channelId: r.channelId,
        content: 'via IPC-R',
        mentions: [],
        clientRef: 'ipc-1',
      })) as { opId: string; state: string };
      assert.equal(sent.state, 'queued');
      assert.equal(sent.opId.length, 64);
      assert.equal(r.manifest.byOpId(sent.opId)?.client_ref, 'ipc-1');

      // comunidade desconhecida no recorte → E_NOT_FOUND antes de qualquer decisão
      await assert.rejects(
        r.ipc.request('message.send', { communityId: 'outra', channelId: r.channelId, content: 'x', mentions: [] }),
        (err: NodeJS.ErrnoException) => err.code === 'E_NOT_FOUND',
      );
      // argumento obrigatório ausente → E_VALIDATION cru, da fronteira
      await assert.rejects(
        r.ipc.request('message.send', { communityId: r.communityId, channelId: r.channelId, mentions: [] }),
        (err: NodeJS.ErrnoException) => err.code === 'E_VALIDATION',
      );

      await r.outbox.flush();
      await r.projector.catchUp();
      assert.deepEqual(r.outbox.reconcile(), { removed: 1, mismatch: 0, expired: 0 });
    } finally {
      r.cleanup();
    }
  });

  it('E_QUOTA_EXCEEDED na janela R-14/R-15 lida do recorte do DS (§8.7, tetos injetados)', async () => {
    const r = await submissionRig({ limits: { ...SUBMISSION_LIMITS, quotaOpsPerWindow: 2 } });
    try {
      const send = (content: string) =>
        r.client.submitQueued(r.communityId, {
          kindName: 'message.send',
          payload: { channelId: r.channelId, content, mentions: [] },
        });
      assert.equal(send('um').ok, true);
      await r.outbox.flush();
      await r.projector.catchUp(); // a janela de cota é estado do DS: só avança ao projetar
      r.outbox.reconcile(); // observação remove o item e libera o canal (§11.3/§11.6)
      assert.equal(send('dois').ok, true);
      await r.outbox.flush();
      await r.projector.catchUp();
      r.outbox.reconcile();
      assert.deepEqual(send('três'), { ok: false, code: 'E_QUOTA_EXCEEDED' });
    } finally {
      r.cleanup();
    }
  });

  it('E_OUTBOX_FULL quando a fila atinge o teto (§15.4)', async () => {
    const r = await submissionRig();
    try {
      // teto de fila é propriedade da outbox; aqui exercitamos via segunda instância mínima
      const tiny = new Outbox({
        manifest: r.manifest,
        communityId: r.communityId,
        submit: async () => null,
        observation: { observedOp: () => null, watermark: () => 0, interpretedSeq: () => -1 },
        maxItems: 1,
        now: () => T0 + 300,
        random: () => 0.5,
      });
      const tightClient = new CommunityClient({
        swarm: new Swarm(),
        signing: {
          authorKey: r.ana,
          codec: opCodecSignPort(),
          opVersion: OP_VERSION,
          limits: SUBMISSION_LIMITS,
        },
      });
      tightClient.addCommunity({
        communityId: r.communityId,
        core: r.core,
        projector: r.projector,
        outbox: tiny,
      });
      const first = tightClient.submitQueued(r.communityId, {
        kindName: 'message.send',
        payload: { channelId: r.channelId, content: 'cabe', mentions: [] },
      });
      assert.equal(first.ok, true);
      assert.deepEqual(
        tightClient.submitQueued(r.communityId, {
          kindName: 'message.send',
          payload: { channelId: r.channelId, content: 'não cabe', mentions: [] },
        }),
        { ok: false, code: 'E_OUTBOX_FULL' },
      );
      tightClient.close();
    } finally {
      r.cleanup();
    }
  });

  it('eixo otimista de A25 inteiro: edit/react/thread pela fronteira e desfecho por evento (§15.4, §15.5)', async () => {
    const r = await submissionRig();
    try {
      const eventos: Array<{ topic: string; data: Record<string, unknown> }> = [];
      r.ipc.subscribe('message.accepted', (data) =>
        eventos.push({ topic: 'message.accepted', data: data as Record<string, unknown> }),
      );
      r.ipc.subscribe('message.dropped', (data) =>
        eventos.push({ topic: 'message.dropped', data: data as Record<string, unknown> }),
      );

      // send → accepted com o payload exato da tabela de §15.5
      const sent = (await r.ipc.request('message.send', {
        communityId: r.communityId,
        channelId: r.channelId,
        content: 'raiz',
        mentions: [],
        clientRef: 'c0',
      })) as { opId: string; state: string };
      assert.equal(sent.state, 'queued');
      await r.outbox.flush();
      await r.projector.catchUp();
      assert.deepEqual(r.outbox.reconcile(), { removed: 1, mismatch: 0, expired: 0 });
      await new Promise((resolve) => setImmediate(resolve)); // MemoryIpcPort entrega em microtask
      const aceito0 = eventos.find((e) => e.topic === 'message.accepted');
      assert.ok(aceito0 !== undefined);
      const messageId = aceito0.data.messageId;
      assert.equal(typeof messageId, 'string');
      assert.equal(aceito0.data.channelId, r.channelId);
      assert.equal(aceito0.data.clientRef, 'c0');
      assert.equal(aceito0.data.opId, sent.opId);
      eventos.length = 0;

      // edit da própria e reação passam pela coluna Perm. (send_messages/add_reactions no cargo base)
      await r.ipc.request('message.edit', { communityId: r.communityId, messageId, content: 'editada' });
      await r.ipc.request('message.react', {
        communityId: r.communityId,
        messageId,
        emoji: '🎉',
        present: true,
      });
      await r.ipc.request('thread.create', { communityId: r.communityId, rootMessageId: messageId });
      await r.outbox.flush();
      await r.projector.catchUp();
      assert.deepEqual(r.outbox.reconcile(), { removed: 3, mismatch: 0, expired: 0 });
      await new Promise((resolve) => setImmediate(resolve));
      // todo desfecho aponta a MESMA mensagem afetada, inclusive o da thread (a raiz)
      assert.equal(eventos.filter((e) => e.topic === 'message.accepted').length, 3);
      assert.ok(eventos.every((e) => e.data.messageId === messageId));

      // R-24 na coluna síncrona: segunda thread na mesma raiz nem sai da máquina
      await assert.rejects(
        r.ipc.request('thread.create', { communityId: r.communityId, rootMessageId: messageId }),
        (e: NodeJS.ErrnoException) => e.code === 'E_THREAD_EXISTS',
      );
      assert.equal(r.manifest.all(r.communityId).length, 0);

      // mensagem de OUTRO autor no log pelo host real; editar a alheia é E_CANNOT_EDIT_OTHERS
      const authorSeqHost = r.g.world.next(r.g.founder);
      const doHost = makeRecord(r.g.world.core, {
        kind: 'message.send',
        author: r.g.founder,
        authorSeq: authorSeqHost,
        hostTs: T0 + 260,
        payload: { channelId: r.channelId, content: 'do host', mentions: [] },
      });
      const viaHost = await rpcHostSubmitPort(r.rpc)(decodeHostRecord(doHost)!.envelope);
      assert.ok(viaHost !== null && viaHost.ok);
      await r.projector.catchUp();
      const alheia = entityId(
        'message',
        r.g.world.core.publicKey,
        r.g.founder.publicKey,
        authorSeqHost,
        `channel:${r.channelId}`,
      );
      await assert.rejects(
        r.ipc.request('message.edit', { communityId: r.communityId, messageId: alheia, content: 'minha' }),
        (e: NodeJS.ErrnoException) => e.code === 'E_CANNOT_EDIT_OTHERS',
      );

      // pin sem pin_messages no cargo base → recusa da fronteira, nada enfileirado
      await assert.rejects(
        r.ipc.request('message.pin', { communityId: r.communityId, messageId, pinned: true }),
        (e: NodeJS.ErrnoException) => e.code === 'E_PERMISSION_DENIED',
      );
      assert.equal(r.manifest.all(r.communityId).length, 0);

      // delete da própria; depois, edit sobre a tombada é E_MESSAGE_DELETED da coluna
      await r.ipc.request('message.delete', { communityId: r.communityId, messageId });
      await r.outbox.flush();
      await r.projector.catchUp();
      r.outbox.reconcile();
      await new Promise((resolve) => setImmediate(resolve));
      await assert.rejects(
        r.ipc.request('message.edit', { communityId: r.communityId, messageId, content: 'zumbi' }),
        (e: NodeJS.ErrnoException) => e.code === 'E_MESSAGE_DELETED',
      );
      // ...mas o delete idempotente sobre a tombada atravessa a ponte e o fold aplica (§8.x)
      await r.ipc.request('message.delete', { communityId: r.communityId, messageId });
      await r.outbox.flush();
      await r.projector.catchUp();
      assert.deepEqual(r.outbox.reconcile(), { removed: 1, mismatch: 0, expired: 0 });
    } finally {
      r.cleanup();
    }
  });

  it('R-23 na coluna síncrona: a 21ª reação distinta não sai da máquina; reafirmar emoji existente passa', async () => {
    const r = await submissionRig();
    try {
      await r.ipc.request('message.send', {
        communityId: r.communityId,
        channelId: r.channelId,
        content: 'para reagir',
        mentions: [],
      });
      await r.outbox.flush();
      await r.projector.catchUp();
      assert.deepEqual(r.outbox.reconcile(), { removed: 1, mismatch: 0, expired: 0 });
      // primeira op da ana no escopo do canal → authorSeq 1
      const messageId = entityId(
        'message',
        r.g.world.core.publicKey,
        r.ana.publicKey,
        1,
        `channel:${r.channelId}`,
      );
      // As vinte primeiras emojis distintas entram num único lote; a advisória lê o DS
      // ainda sem nenhuma delas, então nada é recusado localmente aqui.
      for (let i = 0; i < MAX_REACTION_EMOJIS; i++) {
        const enfileirada = r.client.submitQueued(r.communityId, {
          kindName: 'reaction.set',
          payload: { messageId, emoji: `emoji-${i}`, present: true },
        });
        assert.equal(enfileirada.ok, true);
      }
      await r.outbox.flush();
      await r.projector.catchUp();
      assert.deepEqual(r.outbox.reconcile(), { removed: MAX_REACTION_EMOJIS, mismatch: 0, expired: 0 });

      // teto cheio: uma emoji NOVA estoura R-23 e nem assina
      assert.deepEqual(
        r.client.submitQueued(r.communityId, {
          kindName: 'reaction.set',
          payload: { messageId, emoji: 'emoji-nova', present: true },
        }),
        { ok: false, code: 'E_REACTION_LIMIT' },
      );
      // reafirmar as que já estão não conta de novo (R-23)
      const reafirma = r.client.submitQueued(r.communityId, {
        kindName: 'reaction.set',
        payload: { messageId, emoji: 'emoji-0', present: true },
      });
      assert.equal(reafirma.ok, true);
    } finally {
      r.cleanup();
    }
  });

  it('message.retry/cancelQueued na fronteira: mesmos códigos da outbox e desfecho dropped por evento (§11.3, §11.7)', async () => {
    const r = await submissionRig();
    try {
      const drops: Array<Record<string, unknown>> = [];
      r.ipc.subscribe('message.dropped', (data) => drops.push(data as Record<string, unknown>));

      // cancelamento de item em fila: {} na hora + message.dropped{reason:'cancelled'}
      const a = (await r.ipc.request('message.send', {
        communityId: r.communityId,
        channelId: r.channelId,
        content: 'vai ser cancelada',
        mentions: [],
        clientRef: 'cancela',
      })) as { opId: string };
      assert.deepEqual(await r.ipc.request('message.cancelQueued', { opId: a.opId }), {});
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(r.manifest.byOpId(a.opId)?.state, 'dropped');
      assert.deepEqual(drops, [
        { opId: a.opId, clientRef: 'cancela', reason: 'cancelled', channelId: r.channelId },
      ]);

      // terminal é terminal: nem cancelar de novo, nem ressuscitar (§11.3/§11.7)
      await assert.rejects(
        r.ipc.request('message.cancelQueued', { opId: a.opId }),
        (e: NodeJS.ErrnoException) => e.code === 'E_NOT_FOUND',
      );
      await assert.rejects(
        r.ipc.request('message.retry', { opId: a.opId }),
        (e: NodeJS.ErrnoException) => e.code === 'E_NOT_FOUND',
      );

      // entregue ao host não se cancela nem reenvia — E_ALREADY_SENT (DS-28)
      const b = (await r.ipc.request('message.send', {
        communityId: r.communityId,
        channelId: r.channelId,
        content: 'foi pro host',
        mentions: [],
      })) as { opId: string };
      await r.outbox.flush();
      assert.equal(r.manifest.byOpId(b.opId)?.state, 'awaiting-confirmation');
      await assert.rejects(
        r.ipc.request('message.cancelQueued', { opId: b.opId }),
        (e: NodeJS.ErrnoException) => e.code === 'E_ALREADY_SENT',
      );
      await assert.rejects(
        r.ipc.request('message.retry', { opId: b.opId }),
        (e: NodeJS.ErrnoException) => e.code === 'E_ALREADY_SENT',
      );
      // reconciliação observa e remove
      await r.projector.catchUp();
      assert.deepEqual(r.outbox.reconcile(), { removed: 1, mismatch: 0, expired: 0 });

      // failed → retry → accepted: o MESMO envelope, mesmo authorSeq, mesmo opId (DS-16)
      const c = (await r.ipc.request('message.send', {
        communityId: r.communityId,
        channelId: r.channelId,
        content: 'vai falhar e voltar',
        mentions: [],
        clientRef: 'falha',
      })) as { opId: string };
      const linhaC = r.manifest.all(r.communityId).find((row) => row.op_id === c.opId);
      assert.ok(linhaC !== undefined);
      r.manifest.setState(linhaC.local_seq, 'failed', { last_error: 'E_HOST_UNAVAILABLE' });
      assert.deepEqual(await r.ipc.request('message.retry', { opId: c.opId }), { state: 'queued' });
      await r.outbox.flush();
      await r.projector.catchUp();
      assert.deepEqual(r.outbox.reconcile(), { removed: 1, mismatch: 0, expired: 0 });
      // só resta a linha terminal do cancelamento; entregues saem por observação
      const restantes = r.manifest.all(r.communityId);
      assert.deepEqual(restantes.map((row) => row.state), ['dropped']);

      // op desconhecida é E_NOT_FOUND na fronteira
      await assert.rejects(
        r.ipc.request('message.retry', { opId: 'nao-existe' }),
        (e: NodeJS.ErrnoException) => e.code === 'E_NOT_FOUND',
      );
    } finally {
      r.cleanup();
    }
  });

  it('community.leave é local imediato: descarta a fila com motivo nomeado e o member.leave segue para os demais (§11.1, L-22)', async () => {
    const r = await submissionRig();
    try {
      // o host da origem não sai — recusa síncrona sem gastar authorSeq
      r.sairComo(r.g.founder.publicKey.toString('hex'));
      await assert.rejects(
        r.ipc.request('community.leave', { communityId: r.communityId }),
        (e: NodeJS.ErrnoException) => e.code === 'E_HOST_CANNOT_LEAVE',
      );
      r.sairComo(r.ana.publicKey.toString('hex'));

      const drops: Array<Record<string, unknown>> = [];
      r.ipc.subscribe('message.dropped', (data) => drops.push(data as Record<string, unknown>));
      for (const conteudo of ['fica para trás 1', 'fica para trás 2']) {
        assert.ok(
          r.client.submitQueued(r.communityId, {
            kindName: 'message.send',
            payload: { channelId: r.channelId, content: conteudo, mentions: [] },
          }).ok,
        );
      }

      const saida = (await r.ipc.request('community.leave', { communityId: r.communityId })) as {
        leftLocally: boolean;
        opId: string;
        droppedQueued: number;
      };
      assert.equal(saida.leftLocally, true);
      assert.equal(saida.droppedQueued, 2);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(drops.length, 2);
      assert.ok(drops.every((d) => d.reason === 'left-community' && d.channelId === r.channelId));

      // na fila restam os dois descartes terminais e a saída enfileirada por último
      const linhas = r.manifest.all(r.communityId);
      assert.deepEqual(linhas.map((l) => l.state), ['dropped', 'dropped', 'queued']);
      assert.equal(linhas[2]!.kind, KINDS['member.leave']);
      const linhaComunidade = r.manifest.getCommunity(r.communityId) as { left_at: number | null };
      assert.ok(linhaComunidade.left_at !== null && linhaComunidade.left_at > 0);
      // fora do recorte: comandos seguintes nem chegam à ponte
      await assert.rejects(
        r.ipc.request('message.send', {
          communityId: r.communityId,
          channelId: r.channelId,
          content: 'depois',
          mentions: [],
        }),
        (e: NodeJS.ErrnoException) => e.code === 'E_NOT_FOUND',
      );

      // L-22 pelo lado bom: com host vivo a saída é entregue e todos veem
      await r.outbox.flush();
      await r.projector.catchUp();
      const anaNoLog = r.projector.ds.members.get(r.ana.publicKey.toString('hex'));
      assert.ok(anaNoLog !== undefined && anaNoLog.state === 'left');
      assert.deepEqual(r.outbox.reconcile(), { removed: 1, mismatch: 0, expired: 0 });
    } finally {
      r.cleanup();
    }
  });

  it('query.community devolve o recorte de §15.6 com fonte real; sem origem replicada não há pendingReentry', async () => {
    const r = await submissionRig();
    try {
      const view = (await r.ipc.request('query.community', { communityId: r.communityId })) as Record<string, unknown>;
      assert.equal(view['id'], r.communityId);
      assert.equal(view['name'], 'Comunidade');
      assert.equal(view['isHost'], false, 'quem consulta é a ana, não o host');
      assert.equal((view['hostRef'] as { key: string }).key, r.g.founder.publicKey.toString('hex'));
      assert.equal((view['hostRef'] as { displayName: string }).displayName, 'Fundador');
      assert.deepEqual(view['successorKeys'], []);
      const permissoes = view['myPermissions'] as string[];
      assert.ok(permissoes.includes('send_messages') && permissoes.includes('add_reactions'));
      assert.ok(!permissoes.includes('manage_messages'), 'o cargo base não tem permissão de moderação');
      assert.equal(typeof view['myTopRank'], 'string');
      assert.equal((view['replication'] as { lag: number }).lag, 0);
      assert.ok(!('pendingReentry' in view), 'não é continuação');

      await assert.rejects(
        r.ipc.request('query.community', { communityId: 'outra-comunidade' }),
        (e: NodeJS.ErrnoException) => e.code === 'E_NOT_FOUND',
      );
    } finally {
      r.cleanup();
    }
  });

  it('frame acima do teto falha localmente com E_PAYLOAD_TOO_LARGE, sem cruzar a rede (§16.1)', async () => {
    const [hostSide, memberSide] = rpcPair();
    let crossed = 0;
    const spied = {
      send: (frame: Uint8Array) => {
        crossed++;
        memberSide.send(frame);
      },
      onFrame: (cb: (f: Uint8Array) => void) => memberSide.onFrame(cb),
      onDown: (cb: () => void) => memberSide.onDown(cb),
    };
    const client = new RpcClient({ protocol: 'community', transport: spied, role: 'member' });
    const result = await client.call('submitOp', new Uint8Array(RPC_FRAME_MAX_BYTES.community + 1));
    assert.deepEqual(result, { ok: false, code: 'E_PAYLOAD_TOO_LARGE' });
    assert.equal(crossed, 0);
    void hostSide;
  });

  it('método fora da tabela de §16.2 é recusado com E_UNKNOWN_COMMAND', async () => {
    const [hostSide, memberSide] = rpcPair();
    const server = new RpcServer({ protocol: 'community', transport: hostSide });
    wireHostRpc(server, {
      admission: dummyAdmission(),
      hello: { hostVersion: 'x', opVersion: OP_VERSION, coreLength: 0, memberCount: 0, capabilities: [] },
    });
    const client = new RpcClient({ protocol: 'community', transport: memberSide });
    const result = await client.call('deleteAll', new Uint8Array());
    assert.deepEqual(result, { ok: false, code: 'E_UNKNOWN_COMMAND' });
  });

  it('queda da conexão falha os pedidos em voo com E_HOST_UNAVAILABLE (§16.1)', async () => {
    const [hostSide, memberSide] = rpcPair();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const server = new RpcServer({ protocol: 'community', transport: hostSide });
    server.register('submitOps', async () => {
      await gate;
      return new Uint8Array();
    });
    const client = new RpcClient({ protocol: 'community', transport: memberSide });
    const pending = client.call('submitOps', new Uint8Array(Buffer.from('{}')));
    await Promise.resolve();
    memberSide.drop();
    const result = await pending;
    assert.deepEqual(result, { ok: false, code: 'E_HOST_UNAVAILABLE' });
    release();
  });

  it('timeout sem resposta vira E_HOST_UNAVAILABLE — quem reenvia é a outbox (§11.6)', async () => {
    // par sem servidor do outro lado: ninguém responde jamais
    const [, orphanSide] = rpcPair();
    const client = new RpcClient({ protocol: 'admission', transport: orphanSide, role: 'pre-member' });
    const t0 = Date.now();
    const result = await client.call('inviteResolve', new Uint8Array(), { timeoutMs: 40 });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'E_HOST_UNAVAILABLE');
    assert.ok(Date.now() - t0 < 2_000);
  });

  it('orçamento de requests em voo de pré-membro é 2 — o excedente espera em fila (§16.1)', async () => {
    const [hostSide, memberSide] = rpcPair();
    const releases: Array<() => void> = [];
    const server = new RpcServer({ protocol: 'community', transport: hostSide });
    server.register('presencePublish', async () => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return new Uint8Array();
    });
    const client = new RpcClient({ protocol: 'community', transport: memberSide, role: 'pre-member' });
    const calls = [
      client.call('presencePublish', new Uint8Array()),
      client.call('presencePublish', new Uint8Array()),
      client.call('presencePublish', new Uint8Array()),
    ];
    await Promise.resolve();
    assert.equal(client.inFlight, 2);
    assert.equal(client.queued, 1);
    // libera os dois em voo; o terceiro entra pela bomba e precisa ser solto também
    for (const release of releases.splice(0)) release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (const release of releases.splice(0)) release();
    const results = await Promise.all(calls);
    assert.ok(results.every((r) => r.ok));
  });
});

describe('sucessão §18.8 — as quatro portas compostas dos módulos reais (§34.2 item 1)', () => {
  const SEMENTE_HOST = Buffer.alloc(32, 0x77);
  const SEMENTE_CONTINUACAO = Buffer.alloc(32, 0x7c);
  const DATA_KEY_HOST = Buffer.alloc(32, 0x11);
  const BRUNO = keypairFromSeed('bruno-sucessao');
  const ESTRANHO = keypairFromSeed('estranho-sucessao');
  const CARLOS = keypairFromSeed('carlos-sucessao');
  /** Carimbo fixo do admission do host — o `lastHostTs` de onde o grace period conta. */
  const HOST_TS = T0 + 200;
  const DEPOIS_DO_GRACE = HOST_TS + HOST_INACTIVITY_MS + 1;

  /**
   * Duas máquinas sobre o mesmo log, com os módulos de produto no lugar dos cabos:
   * o HOST (fundador) com hypercore em disco (corestore), view.db + Projector,
   * ManifestDb com a semente cifrada pela Data Key (§5.3) e ponte de §30 real
   * (outbox → rpcClient → HostAdmission → append); a RÉPLICA do sucessor, aberta
   * somente leitura pela chave pública depois do escritor sair. O que aqui é
   * SIMULADO: o swarm (a réplica herda os blocos já gravados) e o RPC, que continua
   * sendo o par em memória das seções acima.
   */
  async function sucessaoRig() {
    const dir = tempDir('sucessao');
    const parOrigem = deriveCommunityKeyPairs(SEMENTE_HOST);
    const origemId = parOrigem.log.publicKey.toString('hex');

    // Conteúdo inicial planejado no World — bytes idênticos aos que o host appenda.
    // O ban preventivo de R-28 entra na origem e é o que o lote estendido carrega.
    const g = genesis(new World(parOrigem.log));
    const ana = joinMember(g, 'ana-sucessao');
    g.world.submit({
      kind: 'mod.ban',
      author: g.founder,
      hostTs: T0 + 150,
      payload: { targetKey: CARLOS.publicKey },
    });

    // Máquina do host: core REAL criado pelo corestore com o par derivado da semente (§5.3).
    const coreOrigem = await createCore(path.join(dir, 'cores', 'origem'), parOrigem.log);
    await coreOrigem.append([...g.world.log].map((b) => Buffer.from(b)));
    const viewHost = openViewDb(path.join(dir, 'view-host.db'));
    const projHost = new Projector(viewHost, coreOrigem, { foldBuildId: 'integracao-sucessao' });
    await projHost.boot();

    const manifestHost = new ManifestDb(path.join(dir, 'manifest-host.db'));
    storeCommunitySeed(
      manifestHost,
      {
        communityId: origemId,
        coreKey: parOrigem.log.publicKey,
        blobsKey: parOrigem.blobs.publicKey,
        communitySeed: SEMENTE_HOST,
        isHost: true,
        joinedAt: T0,
      },
      DATA_KEY_HOST,
    );

    const admission = new HostAdmission({
      core: coreOrigem,
      state: projHost.ds,
      makeHostRecord: (envelope, hostTs) => {
        const hostSig = sign(hostRecordSigningHash(envelope, hostTs, 0), parOrigem.log.secretKey);
        return encodeHostRecord({ envelope: Buffer.from(envelope), hostTs, flags: 0, hostSig });
      },
      now: () => HOST_TS,
      groupWindowMs: 4,
      groupMax: 8,
    });
    const [hostSide, memberSide] = rpcPair();
    const server = new RpcServer({ protocol: 'community', transport: hostSide });
    wireHostRpc(server, {
      admission,
      hello: { hostVersion: '0.0.0', opVersion: OP_VERSION, coreLength: coreOrigem.length, memberCount: 2, capabilities: [] },
    });
    const rpc = new RpcClient({ protocol: 'community', transport: memberSide, role: 'member' });
    assert.ok((await rpc.call('hello', new Uint8Array())).ok);

    const observation: OutboxObservation = {
      observedOp: (id) => projHost.observedOp(id),
      watermark: (item) => projHost.authorWatermark(g.founder.publicKey, item.sequence_scope),
      interpretedSeq: () => projHost.interpretedSeq,
    };
    const outbox = new Outbox({
      manifest: manifestHost,
      communityId: origemId,
      submit: rpcSubmitPort(rpc),
      observation,
      now: () => T0 + 300,
      random: () => 0.5,
    });
    // Reconciliação de boot de §7.5 para o fundador (autor de toda a fase planejada).
    const nextFounder =
      Math.max(
        manifestHost.nextAuthorSeq(origemId, 'community') - 1,
        projHost.authorWatermark(g.founder.publicKey, 'community'),
      ) + 1;
    manifestHost.raw
      .prepare(
        'INSERT INTO local_author_seq(community_id, sequence_scope, next_author_seq) VALUES (?, ?, ?) ' +
          'ON CONFLICT(community_id, sequence_scope) DO UPDATE SET next_author_seq = excluded.next_author_seq',
      )
      .run(origemId, 'community', nextFounder);

    const clientHost = new CommunityClient({
      swarm: new Swarm(),
      clock: fakeClock(),
      signing: { authorKey: g.founder, codec: opCodecSignPort(), opVersion: OP_VERSION, limits: SUBMISSION_LIMITS },
    });
    clientHost.addCommunity({ communityId: origemId, core: coreOrigem, projector: projHost, outbox, hostSubmit: rpcHostSubmitPort(rpc) });

    // Comunidade nova registrada quando a porta real cria o core — o que o boot fará.
    const continuacoes = new Map<string, { projector: Projector; view: ReturnType<typeof openViewDb> }>();
    const vistasAbertas: ReturnType<typeof openViewDb>[] = [viewHost];
    const portaContinuacao = corestoreContinuationCorePort(path.join(dir, 'cores'), (core) => {
      const view = openViewDb(path.join(dir, `view-cont-${core.key.toString('hex').slice(0, 8)}.db`));
      vistasAbertas.push(view);
      const projector = new Projector(view, core, { foldBuildId: 'integracao-sucessao' });
      return projector.boot().then(() => {
        continuacoes.set(core.key.toString('hex'), { projector, view });
      });
    });

    const svcHost = new SuccessionService({
      stateFor: (id) => (id === origemId ? projHost.ds : continuacoes.get(id)?.projector.ds ?? null),
      identity: () => g.founder,
      communitySeed: manifestCommunitySeedPort(manifestHost, DATA_KEY_HOST),
      sealedSeedFor: logEscrowPort(coreOrigem, g.founder.publicKey),
      submitSync: bridgeSubmitSyncPort(clientHost),
      createContinuationCore: async () => {
        throw new Error('o host da origem não assume nesta cena');
      },
      now: () => HOST_TS,
    });

    let replica: { core: Awaited<ReturnType<typeof openCore>>; projector: Projector } | null = null;

    return {
      dir,
      g,
      ana,
      origemId,
      coreOrigem,
      projHost,
      manifestHost,
      svcHost,
      portaContinuacao,
      continuacoes,
      /** O sucessor recebeu os blocos e abre o log SEM par de escrita — só leitura pela chave pública (§5.3 item 5). */
      async replicar(): Promise<{ core: Awaited<ReturnType<typeof openCore>>; projector: Projector }> {
        // Um core não abre duas instâncias sobre o mesmo storage: a do escritor é fechada,
        // como aconteceria com o host offline depois do grace period.
        await coreOrigem.close();
        const coreReplica = await openCore(path.join(dir, 'cores', 'origem'), parOrigem.log.publicKey);
        const viewReplica = openViewDb(path.join(dir, 'view-replica.db'));
        vistasAbertas.push(viewReplica);
        const projector = new Projector(viewReplica, coreReplica, { foldBuildId: 'integracao-sucessao' });
        await projector.boot();
        replica = { core: coreReplica, projector };
        return replica;
      },
      svcDeBruno(agora: number, quem = BRUNO): SuccessionService {
        if (replica === null) throw new Error('chame replicar() antes');
        const { core, projector } = replica;
        return new SuccessionService({
          stateFor: (id) => (id === origemId ? projector.ds : continuacoes.get(id)?.projector.ds ?? null),
          identity: () => quem,
          communitySeed: () => null, // o sucessor não hospeda a origem; a semente dele vem do escrow
          sealedSeedFor: logEscrowPort(core, quem.publicKey),
          submitSync: async () => ({ ok: false as const, code: 'E_HOST_UNAVAILABLE' }),
          createContinuationCore: portaContinuacao,
          now: () => agora,
          newCoreSeed: () => SEMENTE_CONTINUACAO,
        });
      },
      async cleanup(): Promise<void> {
        clientHost.close();
        if (replica !== null) await replica.core.close();
        await portaContinuacao.close();
        for (const view of vistasAbertas) view.close();
        manifestHost.close();
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
      },
    };
  }

  it('host designa pela ponte real; sucessor assume sobre a réplica e cria a continuação em disco (§18.8)', async () => {
    const r = await sucessaoRig();
    try {
      // ── designação: as duas ops ⏱ entram no core REAL pela ponte de §30 ──────────────
      const antes = r.coreOrigem.length;
      const designou = await r.svcHost.setSuccessors({ communityId: r.origemId, successorKeys: [BRUNO.publicKey] });
      assert.ok(designou.ok, designou.ok ? '' : designou.code);
      if (!designou.ok) return;
      assert.equal(designou.seq, antes, 'o seq devolvido é o bloco do core real');
      assert.deepEqual(designou.escrowSeqs, [antes + 1]);
      await r.projHost.catchUp();
      assert.deepEqual(
        r.projHost.ds.community.successorKeys.map((k) => k.toString('hex')),
        [BRUNO.publicKey.toString('hex')],
      );
      // caminho ⏱ não enfileira: a fila do host segue vazia (§11.1)
      assert.equal(r.manifestHost.all(r.origemId).length, 0);

      // porta `communitySeed` composta com o manifest: decifra com a Data Key certa;
      // chave errada ou comunidade sem linha hospedada → null (§5.3)
      assert.ok(manifestCommunitySeedPort(r.manifestHost, DATA_KEY_HOST)(r.origemId)?.equals(SEMENTE_HOST));
      assert.equal(manifestCommunitySeedPort(r.manifestHost, Buffer.alloc(32, 0x12))(r.origemId), null);
      assert.equal(manifestCommunitySeedPort(r.manifestHost, DATA_KEY_HOST)('outra-comunidade'), null);

      // porta `sealedSeedFor` composta com o log: só o alvo encontra o escrow e abre (§18.8)
      const wrapped = await logEscrowPort(r.coreOrigem, BRUNO.publicKey)(r.origemId);
      assert.ok(wrapped !== null);
      const aberto = openSealedSeed(wrapped!, BRUNO.publicKey, BRUNO.secretKey);
      assert.ok(aberto !== null && aberto.equals(SEMENTE_HOST));
      assert.equal(await logEscrowPort(r.coreOrigem, ESTRANHO.publicKey)(r.origemId), null);
      assert.equal(await logEscrowPort(r.coreOrigem, BRUNO.publicKey)('nao-e-este-core'), null);

      // ── réplica do sucessor: mesmos blocos, nenhuma chave de escrita ──────────────────
      const rep = await r.replicar();
      assert.deepEqual(
        rep.projector.ds.community.successorKeys.map((k) => k.toString('hex')),
        [BRUNO.publicKey.toString('hex')],
      );

      // camada b com grace period aberto: recusada, nenhum core criado
      const cedo = r.svcDeBruno(HOST_TS + 1);
      assert.deepEqual(await cedo.assumeHost({ communityId: r.origemId }), { ok: false, code: 'E_SUCCESSION_DENIED' });
      assert.equal(r.portaContinuacao.created.length, 0);

      // fora da lista de sucessores: recusada também
      const intruso = r.svcDeBruno(DEPOIS_DO_GRACE, ESTRANHO);
      assert.deepEqual(await intruso.assumeHost({ communityId: r.origemId }), { ok: false, code: 'E_SUCCESSION_DENIED' });

      // ── assunção: escrow lido da réplica, continuação criada pelo corestore real ──────
      const comprimentoReplica = rep.core.length;
      const assumiu = await r.svcDeBruno(DEPOIS_DO_GRACE).assumeHost({ communityId: r.origemId });
      assert.ok(assumiu.ok, assumiu.ok ? '' : assumiu.code);
      if (!assumiu.ok) return;
      assert.equal(assumiu.seq, 6, 'assumeHost é o seq 6, logo após a gênese de R-27');
      assert.equal(rep.core.length, comprimentoReplica, 'nada foi escrito no core antigo');

      const coreNovo = r.portaContinuacao.created[0]!;
      assert.equal(assumiu.newCommunityId, coreNovo.key.toString('hex'));
      assert.equal(coreNovo.length, assumiu.plan.records.length, 'o lote inteiro está no core em disco');
      const cont = r.continuacoes.get(assumiu.newCommunityId);
      assert.ok(cont !== undefined, 'a porta registrou a comunidade nova para o stateFor');
      assert.equal(cont.projector.interpretedSeq, assumiu.plan.records.length - 1);

      // o fold REAL interpretou a continuação sobre o core em disco
      const ds = cont.projector.ds;
      assert.ok(ds.community.hostKey.equals(BRUNO.publicKey));
      assert.equal(ds.community.originCommunityId, r.origemId);
      assert.deepEqual(
        [...ds.roles.values()].filter((role) => role.deletedAt === undefined).map((role) => role.name).sort(),
        ['Fundador', 'Membro'],
      );
      assert.ok([...ds.channels.values()].some((c) => c.name === 'geral'));
      assert.ok([...ds.categories.values()].some((cat) => cat.name === 'GERAL'));
      // R-28 via lote estendido: o banido preventivo da origem nasce banido na continuação
      const carlos = ds.members.get(CARLOS.publicKey.toString('hex'));
      assert.ok(carlos !== undefined && carlos.state === 'banned' && carlos.preBan === true);
      assert.equal(
        [...ds.members.values()].filter((m) => m.state === 'active').length,
        1,
        'o roster nasce com o sucessor sozinho (L-23)',
      );

      // reentradas pendentes saem do DS real das duas comunidades (§18.8.1)
      assert.deepEqual(
        r.svcDeBruno(DEPOIS_DO_GRACE).pendingReentry(assumiu.newCommunityId).map((k) => k.toString('hex')).sort(),
        [r.g.founder.publicKey.toString('hex'), r.ana.publicKey.toString('hex')].sort(),
      );
    } finally {
      await r.cleanup();
    }
  });

  it('U-18c e rail: pendingReentry na consulta da continuação; dispositionFor decide a migração por réplica (L-16)', async () => {
    const c = await sucessaoRig();
    try {
      await c.svcHost.setSuccessors({ communityId: c.origemId, successorKeys: [BRUNO.publicKey] });
      const rep = await c.replicar();
      const assumiu = await c.svcDeBruno(DEPOIS_DO_GRACE).assumeHost({ communityId: c.origemId });
      assert.ok(assumiu.ok, assumiu.ok ? '' : assumiu.code);
      if (!assumiu.ok) return;
      const contId = assumiu.newCommunityId;

      // consulta montada sobre o DS REAL do sucessor (§15.6 emendado)
      const consultar = queryCommunityPort({
        stateFor: (id) => (id === c.origemId ? rep.projector.ds : c.continuacoes.get(id)?.projector.ds ?? null),
        selfKeyHex: () => BRUNO.publicKey.toString('hex'),
        replicationOf: () => ({ state: 'synced', lag: 0 }),
        pendingReentryOf: (id) => c.svcDeBruno(DEPOIS_DO_GRACE).pendingReentry(id),
      });
      const vista = consultar(contId);
      assert.ok(vista !== null);
      assert.equal(vista.isHost, true, 'o sucessor é o host da continuação');
      assert.equal(vista.originCommunityId, c.origemId);
      const pendentes = vista.pendingReentry;
      assert.ok(pendentes !== undefined, 'é continuação com origem replicada: o campo existe');
      assert.deepEqual(
        [...pendentes].map((p) => p.key).sort(),
        [c.g.founder.publicKey.toString('hex'), c.ana.publicKey.toString('hex')].sort(),
      );
      assert.deepEqual(
        [...pendentes].map((p) => p.displayName).sort(),
        ['Fundador', 'ana-sucessao'],
        'os nomes vêm do roster da ORIGEM',
      );
      // quem consulta a origem sem ser membro dela não recebe vista nenhuma
      assert.equal(consultar(c.origemId), null);

      // rail: antes do grace a continuação é disputada e NADA entra no cliente
      const clienteBruno = new CommunityClient({ swarm: new Swarm() });
      try {
        clienteBruno.addCommunity({
          communityId: c.origemId,
          core: rep.core,
          projector: rep.projector,
        });
        const coreCont = c.portaContinuacao.created.find((k) => k.key.toString('hex') === contId)!;
        const contProjector = c.continuacoes.get(contId)!.projector;
        const tentativa = { core: coreCont as Awaited<ReturnType<typeof openCore>>, projector: contProjector };
        assert.deepEqual(
          migrateRail({
            client: clienteBruno,
            originProjector: rep.projector,
            continuation: tentativa,
            ttlMs: HOST_INACTIVITY_MS,
            now: () => HOST_TS + 1,
          }),
          { migrated: false, disputed: true, reason: 'grace-period' },
        );
        assert.equal(clienteBruno.getState(contId), null);

        // depois do grace: migra; a origem permanece no cliente, legível em histórico
        assert.deepEqual(
          migrateRail({
            client: clienteBruno,
            originProjector: rep.projector,
            continuation: tentativa,
            ttlMs: HOST_INACTIVITY_MS,
            now: () => DEPOIS_DO_GRACE,
          }),
          { migrated: true },
        );
        assert.ok(clienteBruno.getState(contId) !== null);
        assert.ok(clienteBruno.getState(c.origemId) !== null);
        assert.ok(rep.projector.ds.community.successorKeys.length === 1, 'a origem segue legível');
      } finally {
        clienteBruno.close();
      }
    } finally {
      await c.cleanup();
    }
  });
});

describe('IPC-R §15.4/§15.6 — superfícies de diagnóstico, busca, relay e mídia', () => {
  interface Rig {
    cleanup(): void;
    client: IpcClient;
    swarm: Swarm;
    manifest: ManifestDb;
    setPartial(partial: 'host-offline' | 'catching-up' | 'stalled' | 'partial-interpretation' | undefined): void;
    /** Troca a identidade local exposta aos handlers (founder ⇄ membro sem permissão). */
    actAs(who: 'founder' | 'basic'): string;
  }

  async function rig(): Promise<Rig> {
    const clock = fakeClock();
    const dir = tempDir('ipcr');

    const swarm = new Swarm();
    const topic = 'c'.repeat(64);
    swarm.join(topic, { topicHex: topic, kind: 'community-log', communityId: COMMUNITY });
    swarm.simulatePeer(topic, 'p1');
    swarm.simulatePeer(topic, 'p2');

    const metricsPort = aggregateMetricsPort({ swarm, natType: 'moderate' });
    const diagnostics = new Diagnostics({
      swarm,
      nat: swarmNatProbe('moderate'),
      stun: { probe: async () => true },
      relay: { available: () => false },
      metrics: metricsPort,
      clock,
    });

    // view.db semeada para a busca
    const view = openViewDb(path.join(dir, 'view.db'));
    view.prepare(
      "INSERT INTO channels (community_id,id,category_id,type,name,topic,rank,read_only_role_ids) VALUES ('" +
        COMMUNITY + "','ch-geral','cat',0,'geral',NULL,'a0','[]')",
    ).run();
    view.prepare(
      'INSERT INTO messages (community_id,id,seq,channel_id,author_key,content,author_ts,host_ts,clock_skewed,pinned,hidden_by_ban,orphaned)' +
        " VALUES ('" + COMMUNITY + "','m1',1,'ch-geral',x'" + 'ab'.repeat(32) + "','plano de revisão da integração',1,1,0,0,0,0)",
    ).run();
    view.prepare(
      "INSERT INTO messages_fts(rowid,content) SELECT rowid,'plano de revisão da integração' FROM messages WHERE community_id='" +
        COMMUNITY + "' AND id='m1'",
    ).run();
    const search = new SearchService({ view, clock });

    // relay sobre consentimento REAL em manifest.db
    const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
    const identity = keypairFromSeed('fundador-relay');
    const relay = new RelayVolunteer({
      identitySeed: Buffer.from(identity.secretKey.subarray(0, 32)),
      identitySecretKey: identity.secretKey,
      consent: manifestRelayConsentPort(manifest),
      submit: countingRelaySubmit(),
      clock,
      ttlMs: RELAY_TTL_MS,
      maxBytesPerDay: 1024,
      maxAllocs: 4,
    });

    // mídia: recorte estrutural fixo + sessões host reais
    const FOUNDER = 'aa'.repeat(32);
    const BASIC = 'bb'.repeat(32);
    const stateFixture = {
      community: { exists: true },
      channels: new Map([
        ['ch-voz', { type: 1 }],
        ['ch-texto', { type: 0 }],
      ]),
      members: new Map([
        [FOUNDER, { state: 'active' as const, roleIds: ['r-mod'] }],
        [BASIC, { state: 'active' as const, roleIds: ['r-basic'] }],
      ]),
      roles: new Map([
        ['r-mod', { permissions: [9, 10, 11] }],
        ['r-basic', { permissions: [9] }],
      ]),
    };
    const hostKeys = keypairFromSeed('host-midia');
    const voiceHost = new VoiceHostSessions({
      hostSecretKey: hostKeys.secretKey,
      hostTurnSecret: Buffer.alloc(32, 5),
      clock,
      ttlMs: MEDIA_TICKET_TTL_MS,
      maxParticipants: MAX_VOICE_PARTICIPANTS,
      maxCameras: MAX_CAMERAS,
      isVoiceChannelType: (type) => type === 1,
    });
    const shareHost = new ShareHostSessions({
      hostSecretKey: hostKeys.secretKey,
      clock,
      ttlMs: MEDIA_TICKET_TTL_MS,
      captureTokenTtlMs: 60_000,
      maxViewers: SHARE_MAX_VIEWERS,
      isVoiceChannelType: (type) => type === 1,
      voiceParticipants: (channelId) => {
        const session = voiceHost.sessionOf(channelId);
        return session === null ? null : new Set(session.participants.map((p) => p.keyHex));
      },
    });

    let actor = 'aa'.repeat(32);
    const media: MediaSurfaceDeps = {
      dispatcher: localMediaDispatcher({
        voiceStateFor: () => voiceStateOf(stateFixture as unknown as DecisionState),
        selfKeyHex: () => actor,
        currentSessionId: () => voiceHost.currentSessionOf(actor)?.sessionId ?? null,
        host: voiceHost,
        share: shareHost,
      }),
    };

    let partial: 'host-offline' | 'catching-up' | 'stalled' | 'partial-interpretation' | undefined = undefined;

    const [coreSide, rendererSide] = MemoryIpcPort.createPair();
    const server = new IpcServer({
      epoch: 1,
      port: coreSide,
      tokenVerifier: { consume: () => false },
      identityStatus: { isLoaded: true },
    });
    registerCoreCommands(server, {
      diagnostics,
      search,
      partialReason: () => partial,
      relay,
      relayConsent: manifestRelayConsentPort(manifest),
      media,
    });
    const client = new IpcClient();
    client.attach(rendererSide);
    // Handshake de §15.1/§15.2: o hello carrega o epoch do núcleo; sem ele, os requests
    // saem com epoch 0 e são descartados silenciosamente pelo servidor.
    const hello = client.waitForHello(1_000);
    server.sendHello('integracao', OP_VERSION);
    await hello;

    return {
      client,
      swarm,
      manifest,
      setPartial(p) {
        partial = p;
      },
      actAs(who) {
        actor = who === 'founder' ? FOUNDER : BASIC;
        return actor;
      },
      cleanup() {
        view.close();
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
      },
    };
  }

  it('diag.run devolve o contrato exato de §15.4 com dados das portas', async () => {
    const r = await rig();
    try {
      const result = (await r.client.request('diag.run', {})) as { natType: string; peerCount: number; stunReachable: boolean; ranAt: number };
      assert.equal(result.natType, 'moderate');
      assert.equal(result.peerCount, 2);
      assert.equal(result.stunReachable, true);
      assert.equal(typeof result.ranAt, 'number');
      const snap = (await r.client.request('diag.snapshot', {})) as { gauges: Record<string, number> };
      assert.equal(snap.gauges['swarm.peers'], 2);
    } finally {
      r.cleanup();
    }
  });

  it('query.search é open, encontra por prefixo e ecoa a causa parcial da composição', async () => {
    const r = await rig();
    try {
      r.setPartial(undefined);
      const plain = (await r.client.request('query.search', { communityId: COMMUNITY, query: 'revis' })) as {
        partial: boolean;
        messages: Array<{ snippet: string }>;
      };
      assert.equal(plain.partial, false);
      assert.equal(plain.messages.length, 1);
      assert.match(plain.messages[0]!.snippet, /revis/);

      r.setPartial('catching-up');
      const partialResult = (await r.client.request('query.search', { communityId: COMMUNITY, query: '' })) as {
        partial: boolean;
        partialReason?: string;
      };
      assert.equal(partialResult.partial, true);
      assert.equal(partialResult.partialReason, 'catching-up');
    } finally {
      r.cleanup();
    }
  });

  it('relay: enable sem consentimento recusa; respondConsent persiste; enable volta com material novo (§17.7)', async () => {
    const r = await rig();
    try {
      await assert.rejects(
        r.client.request('relay.enable', { communityId: COMMUNITY }),
        (err: NodeJS.ErrnoException) => err.code === 'E_CONSENT_REQUIRED',
      );
      await r.client.request('relay.respondConsent', { communityId: COMMUNITY, accept: true, remember: true });
      assert.equal(r.manifest.getRelayConsent(COMMUNITY)?.decision, 'accepted');
      const enabled = (await r.client.request('relay.enable', { communityId: COMMUNITY })) as {
        seq: number;
        expiresAt: number;
        relayPublicKey: Buffer;
      };
      assert.equal(enabled.seq, 1);
      assert.ok(enabled.relayPublicKey.length === 32);
    } finally {
      r.cleanup();
    }
  });

  it('voz: join entra com roster/credencial; muteParticipant exige sessão e voice_mute_others (§17.4)', async () => {
    const r = await rig();
    try {
      const joined = (await r.client.request('voice.join', { communityId: COMMUNITY, channelId: 'ch-voz' })) as {
        sessionId: string;
        turnCredential: { username: string };
        roster: Array<{ keyHex: string }>;
      };
      assert.ok(joined.sessionId.length > 0);
      assert.equal(joined.roster.length, 1);
      assert.ok(joined.turnCredential.username.includes(':'));
      assert.equal(r.swarm.getStats().peerCount, 2); // diagnóstico segue vivo paralelo à mídia

      await r.client.request('voice.setSelf', { muted: true });
      assert.deepEqual(await r.client.request('voice.leave', {}), {});

      // membro comum entra e tenta mutar o fundador — tem sessão, não tem a permissão
      const founderKey = r.actAs('founder');
      r.actAs('basic');
      await r.client.request('voice.join', { communityId: COMMUNITY, channelId: 'ch-voz' });
      await assert.rejects(
        r.client.request('voice.muteParticipant', { communityId: COMMUNITY, identityKey: founderKey, muted: true }),
        (err: NodeJS.ErrnoException) => err.code === 'E_PERMISSION_DENIED',
      );
    } finally {
      r.cleanup();
    }
  });

  it('tela: start dentro da chamada; espectador da chamada entra e apresenta credencial (§17.5)', async () => {
    const r = await rig();
    try {
      const founderKey = r.actAs('founder');
      await r.client.request('voice.join', { communityId: COMMUNITY, channelId: 'ch-voz' });
      const started = (await r.client.request('share.start', {
        communityId: COMMUNITY,
        channelId: 'ch-voz',
        quality: 'balanced',
      })) as { sessionId: string; captureToken: { token: string } };
      assert.ok(started.sessionId.length > 0);
      assert.equal(started.captureToken.token.length, 64);

      // fora da chamada é recusado (A19)
      r.actAs('basic');
      await assert.rejects(
        r.client.request('share.join', { sessionId: started.sessionId }),
        (err: NodeJS.ErrnoException) => err.code === 'E_PERMISSION_DENIED',
      );

      // entrando na chamada, o mesmo espectador recebe ticket do apresentador
      await r.client.request('voice.join', { communityId: COMMUNITY, channelId: 'ch-voz' });
      const joinedShare = (await r.client.request('share.join', { sessionId: started.sessionId })) as {
        ticketId: string;
        presenterKey: string;
      };
      assert.ok(joinedShare.ticketId.length > 0);
      assert.equal(joinedShare.presenterKey, founderKey);
      assert.deepEqual(await r.client.request('share.setQuality', { sessionId: started.sessionId, quality: 'low' }), {
        applied: true,
      });
    } finally {
      r.cleanup();
    }
  });

  it('probe STUN real: Binding Request pela socket UDP recebe Binding Success do MediaServer (§17.3)', async () => {
    const { probe, responderClose } = await UdpStunProbe.createPair();
    try {
      assert.equal(await probe.probe(2_000), true);
    } finally {
      await responderClose();
    }
  });
});

// ─── auxiliares locais ──────────────────────────────────────────────────────────────────

function dummyAdmission(): { submit(envelope: Uint8Array): Promise<{ ok: false; code: string }> } {
  return { submit: async () => ({ ok: false, code: 'E_NOT_MEMBER' }) };
}
