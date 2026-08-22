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
import { opId } from '../src/l1/idgen/index.ts';
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
  UdpStunProbe,
  aggregateMetricsPort,
  manifestRelayConsentPort,
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
  it('flush sai pela porta RPC, o host admite em grupo e a observação local remove os itens (§11.6)', async () => {
    const dir = tempDir('escrita');
    try {
      const g = genesis();
      const ana = joinMember(g, 'ana-rpc');
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
      const projector = new Projector(view, core, { foldBuildId: 'integracao-host' });
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
      const client = new RpcClient({ protocol: 'community', transport: memberSide, role: 'member' });

      // hello obrigatório antes de qualquer outro método na primeira conexão (§16.2)
      const hello = await client.call('hello', new Uint8Array());
      assert.ok(hello.ok);
      assert.equal(JSON.parse(Buffer.from(hello.body).toString('utf8')).opVersion, OP_VERSION);

      const communityId = g.world.core.publicKey.toString('hex');
      const manifest = new ManifestDb(path.join(dir, 'manifest-membro.db'));
      const observation: OutboxObservation = {
        observedOp: (id) => projector.observedOp(id),
        watermark: (item) => projector.authorWatermark(ana.publicKey, item.sequence_scope),
        interpretedSeq: () => projector.interpretedSeq,
      };
      const outbox = new Outbox({
        manifest,
        communityId,
        submit: rpcSubmitPort(client),
        observation,
        now: () => T0 + 300,
        random: () => 0.5,
      });

      for (let i = 0; i < 4; i++) {
        const authorSeq = outbox.nextAuthorSeq(`channel:${g.channelId}`);
        const record = makeRecord(g.world.core, {
          kind: 'message.send',
          author: ana,
          authorSeq,
          sequenceScope: { kind: 'channel', channelId: g.channelId },
          hostTs: T0 + 301 + i,
          payload: { channelId: g.channelId, content: `integracao-${i}`, mentions: [] },
        });
        const envelope = decodeHostRecord(record)!.envelope;
        const result = outbox.enqueue(envelope, {
          opId: opId(envelope),
          channelId: g.channelId,
          sequenceScope: `channel:${g.channelId}`,
          kind: KINDS['message.send'],
          authorSeq,
        });
        assert.equal(result.enqueued, true);
      }

      await outbox.flush();
      assert.equal(manifest.all(communityId).length, 4); // acked ≠ removido: falta observar (§11.6)

      await projector.catchUp(); // a réplica interpreta os blocos appendados pelo host
      assert.deepEqual(outbox.reconcile(), { removed: 4, mismatch: 0, expired: 0 });
      assert.equal(manifest.all(communityId).length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
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
