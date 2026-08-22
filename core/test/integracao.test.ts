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
import { Swarm } from '../src/l0/swarm/index.ts';
import type { DecisionState } from '../src/l1/fold/index.ts';
import { KINDS, OP_VERSION, decodeHostRecord, encodeHostRecord, hostRecordSigningHash } from '../src/l1/opCodec/index.ts';
import { MAX_CAMERAS, MAX_VOICE_PARTICIPANTS, MEDIA_TICKET_TTL_MS, RELAY_TTL_MS, SHARE_MAX_VIEWERS } from '../src/l1/fold/constants.ts';
import { CommunityClient } from '../src/l2/communityClient/index.ts';
import type { SubmissionLimits } from '../src/l2/communityClient/index.ts';
import { HostAdmission } from '../src/l2/communityHost/index.ts';
import { Diagnostics } from '../src/l2/diagnostics/index.ts';
import { Outbox, type OutboxObservation } from '../src/l2/outbox/index.ts';
import { RelayVolunteer, type RelayOpSubmission, type RelaySubmitPort } from '../src/l2/relay/index.ts';
import { SearchService } from '../src/l2/search/index.ts';
import { ShareHostSessions } from '../src/l2/shareStar/index.ts';
import { VoiceHostSessions } from '../src/l2/voiceCoordinator/index.ts';
import { Projector } from '../src/l1/projector/index.ts';
import {
  IpcClient,
  IpcServer,
  MemoryIpcPort,
} from '../src/l3/ipcRenderer/index.ts';
import { registerCoreCommands, type MediaSurfaceDeps } from '../src/l3/ipcRenderer/commands.ts';
import { RpcClient } from '../src/l3/rpcClient/index.ts';
import { PROTOCOL_PARITY_SOURCE } from '../src/l3/rpcClient/index.ts';
import { RPC_FRAME_MAX_BYTES, RPC_METHODS, RpcServer } from '../src/l3/rpcServer/index.ts';
import { genesis, joinMember, keypairFromSeed, makeRecord, sign, T0 } from './helpers/world.ts';
import {
  SUBMISSION_LIMITS,
  UdpStunProbe,
  aggregateMetricsPort,
  manifestRelayConsentPort,
  opCodecSignPort,
  rpcHostSubmitPort,
  rpcPair,
  rpcSubmitPort,
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
    const observation: OutboxObservation = {
      observedOp: (id) => projector.observedOp(id),
      watermark: (item) => projector.authorWatermark(ana.publicKey, item.sequence_scope),
      interpretedSeq: () => projector.interpretedSeq,
    };
    const clock = fakeClock();
    const outbox = new Outbox({
      manifest,
      communityId,
      submit: rpcSubmitPort(rpc),
      observation,
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
    registerCoreCommands(ipcServer, {
      diagnostics,
      search,
      messages: {
        writeStateFor: (cid) => client.writeStateFor(cid),
        selfKeyHex: () => ana.publicKey.toString('hex'),
        submitQueued: (cid, input) => client.submitQueued(cid, input),
      },
    });
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
      cleanup() {
        client.close();
        view.close();
        fs.rmSync(dir, { recursive: true, force: true });
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
      voiceStateFor: () => voiceStateOf(stateFixture as unknown as DecisionState),
      selfKeyHex: () => actor,
      currentSessionId: () => voiceHost.currentSessionOf(actor)?.sessionId ?? null,
      host: voiceHost,
      share: shareHost,
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
        fs.rmSync(dir, { recursive: true, force: true });
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
