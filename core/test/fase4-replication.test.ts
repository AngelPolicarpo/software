// Fase 4 — Replicação e rede visível (§29, §14.2/§14.3/§14.5, §6.15, §6.16, §17.6)
//
// Cobertura mínima para as entregas que a fase libera:
// - Autorização de canal por comunidade (§14.3) + firewall corrigido
// - Escalonador multicomunidade (§14.2) com reservas e anti-starvation
// - Estados de replicação e watchdog (§14.5)
// - Presença/typing efêmeros com agregação e assinatura por interesse (§17.6)
// - Não-lidas locais por watermark (§6.15)

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FixedClock } from '../src/l0/clock/index.ts';
import {
  Swarm,
  allocateConnections,
  authorizeReplicationChannel,
  firewallShouldRejectConnection,
} from '../src/l0/swarm/index.ts';
import type { SwarmBackendPort } from '../src/l0/swarm/ports.ts';
import {
  CommunityClient,
  computeReplicationState,
  computeUnreadForChannel,
  lagOf,
} from '../src/l2/communityClient/index.ts';
import { PresenceManager } from '../src/l2/presence/index.ts';

// ── helpers ────────────────────────────────────────────────────────────────────

function mockCore(keyHex: string, length: number): any {
  return {
    key: Buffer.from(keyHex, 'hex'),
    length,
    get: async () => null,
    onAppend: () => () => {},
    close: async () => {},
  };
}

function mockProjector(seq: number): any {
  let s = seq;
  return {
    get interpretedSeq() {
      return s;
    },
    set interpretedSeq(v: number) {
      s = v;
    },
  };
}

// ── Swarm — autorização §14.3 ───────────────────────────────────────────────

describe('Fase 4 — §14.3 Autorização de replicação e firewall', () => {
  it('abre canal só para membro ativo não banido', () => {
    assert.equal(authorizeReplicationChannel({ isMemberActive: true, banned: false }), true);
    assert.equal(authorizeReplicationChannel({ isMemberActive: false, banned: false }), false);
    assert.equal(authorizeReplicationChannel({ isMemberActive: true, banned: true }), false);
    assert.equal(authorizeReplicationChannel({ isMemberActive: false, banned: true }), false);
  });

  it('firewall só recusa quando banido em TODAS as comunidades em comum (T-25)', () => {
    const bannedIn = (id: string) => id === 'A';
    assert.equal(firewallShouldRejectConnection({ commonCommunityIds: ['A', 'B'], bannedIn, isPreMemberChannel: false }), false);
    assert.equal(firewallShouldRejectConnection({ commonCommunityIds: ['A'], bannedIn, isPreMemberChannel: false }), true);
    assert.equal(firewallShouldRejectConnection({ commonCommunityIds: ['B'], bannedIn, isPreMemberChannel: false }), false);
    assert.equal(firewallShouldRejectConnection({ commonCommunityIds: [], bannedIn, isPreMemberChannel: false }), false);
  });

  it('canal pré-membro é exceto do firewall (preview banned alcançável §12.3)', () => {
    const bannedIn = () => true;
    assert.equal(firewallShouldRejectConnection({ commonCommunityIds: ['A'], bannedIn, isPreMemberChannel: true }), false);
  });
});

// ── Swarm — escalonador §14.2 ───────────────────────────────────────────────

describe('Fase 4 — §14.2 Escalonador multicomunidade', () => {
  it('reserva 40% para ativa, mínimo 8 (§14.2)', () => {
    const alloc = allocateConnections({
      communityIds: ['active', 'bg1', 'bg2'],
      activeCommunityId: 'active',
      hostedCommunityIds: new Set(),
      budget: { swarmMaxConnections: 128, hostMaxPeers: 256, bgRotationMs: 60_000, preMemberBudget: 8 },
    });
    assert.ok((alloc.get('active') ?? 0) >= 51);
    assert.equal(alloc.get('active'), Math.max(8, Math.floor(128 * 0.4)));
  });

  it('reserva 40% por hospedada com teto HOST_MAX_PEERS', () => {
    const alloc = allocateConnections({
      communityIds: ['h1', 'bg1', 'bg2'],
      activeCommunityId: null,
      hostedCommunityIds: new Set(['h1']),
    });
    assert.ok((alloc.get('h1') ?? 0) >= 1);
    assert.ok((alloc.get('h1') ?? 0) <= 256);
  });

  it('round-robin para background e anti-starvation BG_ROTATION_MS', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `c${i}`);
    const alloc = allocateConnections({
      communityIds: ids,
      activeCommunityId: ids[0]!,
      hostedCommunityIds: new Set(),
      budget: { swarmMaxConnections: 10, hostMaxPeers: 256, bgRotationMs: 60_000, preMemberBudget: 8 },
    });
    // 10 conexões para 50 comunidades: anti-starvation garante ≥1 para pelo menos as primeiras 10
    // e redistribui roubando de quem tem >1 até todos os backgrounds terem ≥1 quando possível
    // Com 10 budget e ativa pegando 8, sobram 2 para 49 backgrounds → nem todos ganham 1, mas
    // a lógica garante que quem tem 0 rouba de quem tem >1.
    const total = [...alloc.values()].reduce((a, b) => a + b, 0);
    assert.equal(total, 10);
    for (const [cid, n] of alloc) {
      assert.ok(n >= 1, `${cid} ficou com 0`);
    }
  });

  it('Swarm.join/leave expõe byCommunity e degraded (§14.5)', () => {
    const swarm = new Swarm();
    swarm.join('a'.repeat(64), { topicHex: 'a'.repeat(64), kind: 'community-log', communityId: 'c1' });
    swarm.simulatePeer('a'.repeat(64), 'peer1'.repeat(16));
    swarm.simulatePeer('a'.repeat(64), 'peer2'.repeat(16));
    const stats = swarm.getStats();
    assert.equal(stats.peerCount, 2);
    assert.equal(stats.byCommunity[0]?.communityId, 'c1');
    assert.equal(stats.byCommunity[0]?.peers, 2);
    assert.equal(stats.degraded, false);
    swarm.setBootstrapReachable(false);
    assert.equal(swarm.getStats().degraded, true);
    swarm.leave('a'.repeat(64));
    assert.equal(swarm.isJoined('a'.repeat(64)), false);
  });

  it('attachBackend repete os tópicos pedidos antes da rede existir, com o papel de §14.1', () => {
    const swarm = new Swarm();
    const topicoLog = 'b'.repeat(64);
    const topicoConvite = 'c'.repeat(64);
    // Boot sem identidade: o shell pede tópicos sem backend — ficam na fachada.
    swarm.join(topicoLog, { topicHex: topicoLog, kind: 'community-log', communityId: 'c1' }, { server: true, client: false });
    swarm.join(topicoConvite, { topicHex: topicoConvite, kind: 'invite', communityId: null });

    const joins: Array<{ topicHex: string; role: { server: boolean; client: boolean } }> = [];
    const leaves: string[] = [];
    const backend: SwarmBackendPort = {
      join(topicHex, _topic, role) {
        joins.push({ topicHex, role });
      },
      leave(topicHex) {
        leaves.push(topicHex);
      },
      flush: async () => {},
      onConnection: () => () => {},
      connectionCount: () => 0,
      destroy: async () => {},
    };
    swarm.attachBackend(backend);

    // A repetição preserva a assimetria de §14.1: host anuncia o log, candidato procura o convite.
    assert.deepEqual(
      joins.map((j) => ({ topicHex: j.topicHex.slice(0, 1), ...j.role })),
      [
        { topicHex: 'b', server: true, client: false },
        { topicHex: 'c', server: false, client: true },
      ],
    );

    // Idempotente: um segundo backend não substitui nem repete o primeiro.
    swarm.attachBackend({ ...backend });
    assert.equal(joins.length, 2);

    // Depois do anexo, join/leave falam direto com o backend.
    swarm.leave(topicoLog);
    assert.deepEqual(leaves, [topicoLog]);
  });
});

// ── Replication states §14.5 ─────────────────────────────────────────────────

describe('Fase 4 — §14.5 Estados de replicação e watchdog', () => {
  it('computeReplicationState: synced só com lag 0 e hello no intervalo', () => {
    const now = 1_000_000;
    assert.equal(
      computeReplicationState({
        coreLength: 5,
        interpretedSeq: 4,
        now,
        lastProgressAt: now,
        lastHelloAt: now - 5_000,
        helloIntervalMs: 30_000,
        stallMs: 20_000,
        unauthorized: false,
        forked: false,
        blocked: false,
      }),
      'synced',
    );
    assert.equal(
      computeReplicationState({
        coreLength: 5,
        interpretedSeq: 4,
        now,
        lastProgressAt: now,
        lastHelloAt: now - 60_000,
        helloIntervalMs: 30_000,
        stallMs: 20_000,
        unauthorized: false,
        forked: false,
        blocked: false,
      }),
      'catching-up',
    );
  });

  it('lag > 0 e avançando → catching-up', () => {
    const now = 1_000_000;
    assert.equal(
      computeReplicationState({
        coreLength: 10,
        interpretedSeq: 4,
        now,
        lastProgressAt: now - 1_000,
        lastHelloAt: null,
        helloIntervalMs: 30_000,
        stallMs: 20_000,
        unauthorized: false,
        forked: false,
        blocked: false,
      }),
      'catching-up',
    );
  });

  it('lag > 0 e sem avanço por STALL_MS → stalled', () => {
    const now = 1_000_000;
    assert.equal(
      computeReplicationState({
        coreLength: 10,
        interpretedSeq: 4,
        now,
        lastProgressAt: now - 25_000,
        lastHelloAt: null,
        helloIntervalMs: 30_000,
        stallMs: 20_000,
        unauthorized: false,
        forked: false,
        blocked: false,
      }),
      'stalled',
    );
  });

  it('unauthorized, forked, blocked têm prioridade', () => {
    const base = {
      coreLength: 5,
      interpretedSeq: 4,
      now: 1_000_000,
      lastProgressAt: 1_000_000,
      lastHelloAt: 1_000_000,
      helloIntervalMs: 30_000,
      stallMs: 20_000,
      unauthorized: false,
      forked: false,
      blocked: false,
    };
    assert.equal(computeReplicationState({ ...base, forked: true }), 'forked');
    assert.equal(computeReplicationState({ ...base, unauthorized: true }), 'unauthorized');
    assert.equal(computeReplicationState({ ...base, blocked: true }), 'blocked');
  });

  it('lagOf', () => {
    assert.equal(lagOf(5, 4), 0);
    assert.equal(lagOf(10, 4), 5);
    assert.equal(lagOf(0, -1), 0);
  });

  it('CommunityClient watchdog publica transição e lag', () => {
    const clock = new FixedClock(1_000_000);
    const swarm = new Swarm();
    const events: unknown[] = [];
    const client = new CommunityClient({
      swarm,
      clock,
      onEvent: (e) => events.push(e),
    });
    const core = mockCore('aa'.repeat(32), 10);
    const proj = mockProjector(4);
    client.addCommunity({ communityId: 'c1', core, projector: proj });
    // começa catching-up (lag 5)
    assert.equal(client.getState('c1')?.state, 'catching-up');
    assert.equal(client.getState('c1')?.lag, 5);

    // avança projeção: deve virar synced se hello recente
    proj.interpretedSeq = 9;
    client.markHello('c1', clock.now());
    client.notifyProgress('c1');
    assert.equal(client.getState('c1')?.state, 'synced');

    // faz lag sem progresso por 25s → stalled via watchdogTick
    core.length = 20;
    clock.advance(25_000);
    const evs = client.watchdogTick();
    assert.equal(evs[0]?.topic, 'community.replication');
    assert.equal((evs[0] as any).data.state, 'stalled');
    assert.equal(client.getState('c1')?.state, 'stalled');

    // unauthorized sobrepõe
    client.markUnauthorized('c1', true);
    assert.equal(client.getState('c1')?.state, 'unauthorized');
    client.markUnauthorized('c1', false);
    // volta a stalled porque ainda sem progresso
    assert.equal(client.getState('c1')?.state, 'stalled');

    client.close();
  });

  it('allocationFor delega ao swarm (§14.2)', () => {
    const swarm = new Swarm({ budget: { swarmMaxConnections: 128, hostMaxPeers: 256, bgRotationMs: 60_000, preMemberBudget: 8 } });
    const client = new CommunityClient({ swarm });
    client.addCommunity({ communityId: 'active', core: mockCore('aa'.repeat(32), 1), projector: mockProjector(0) });
    client.addCommunity({ communityId: 'bg1', core: mockCore('bb'.repeat(32), 1), projector: mockProjector(0) });
    client.addCommunity({ communityId: 'bg2', core: mockCore('cc'.repeat(32), 1), projector: mockProjector(0) });
    const alloc = client.allocationFor('active', new Set());
    assert.ok(alloc.has('active'));
    assert.ok(alloc.has('bg1'));
    client.close();
  });
});

// ── Não-lidas §6.15 ──────────────────────────────────────────────────────────

describe('Fase 4 — §6.15 Não-lidas por watermark', () => {
  it('unreadCount filtra autor local, deleted, hiddenByBan e usa seq > lastReadSeq', () => {
    const res = computeUnreadForChannel({
      lastReadSeq: 10,
      localKeyHex: 'aaaa',
      localRoleIds: new Set(['role1']),
      messages: [
        { seq: 5, authorKeyHex: 'bbbb', deleted: false, hiddenByBan: false, mentionEveryoneEffective: false, mentions: [] },
        { seq: 11, authorKeyHex: 'bbbb', deleted: false, hiddenByBan: false, mentionEveryoneEffective: false, mentions: [] },
        { seq: 12, authorKeyHex: 'aaaa', deleted: false, hiddenByBan: false, mentionEveryoneEffective: false, mentions: [] },
        { seq: 13, authorKeyHex: 'bbbb', deleted: true, hiddenByBan: false, mentionEveryoneEffective: false, mentions: [] },
        { seq: 14, authorKeyHex: 'bbbb', deleted: false, hiddenByBan: true, mentionEveryoneEffective: false, mentions: [] },
        { seq: 15, authorKeyHex: 'bbbb', deleted: false, hiddenByBan: false, mentionEveryoneEffective: false, mentions: [] },
      ],
    });
    assert.equal(res.unreadCount, 2);
    assert.equal(res.firstUnreadSeq, 11);
  });

  it('pendingMentions conta everyone, chave local e cargo (§6.15)', () => {
    const res = computeUnreadForChannel({
      lastReadSeq: 0,
      localKeyHex: 'aaaa',
      localRoleIds: new Set(['role1', 'role2']),
      messages: [
        { seq: 1, authorKeyHex: 'bbbb', deleted: false, hiddenByBan: false, mentionEveryoneEffective: false, mentions: ['aaaa'] },
        { seq: 2, authorKeyHex: 'bbbb', deleted: false, hiddenByBan: false, mentionEveryoneEffective: true, mentions: [] },
        { seq: 3, authorKeyHex: 'bbbb', deleted: false, hiddenByBan: false, mentionEveryoneEffective: false, mentions: ['role1'] },
        { seq: 4, authorKeyHex: 'bbbb', deleted: false, hiddenByBan: false, mentionEveryoneEffective: false, mentions: ['role9'] },
        { seq: 5, authorKeyHex: 'aaaa', deleted: false, hiddenByBan: false, mentionEveryoneEffective: true, mentions: [] },
      ],
    });
    assert.equal(res.unreadCount, 4);
    assert.equal(res.pendingMentions, 3);
  });

  it('firstUnreadSeq é o menor seq do conjunto', () => {
    const res = computeUnreadForChannel({
      lastReadSeq: 10,
      localKeyHex: 'aaaa',
      localRoleIds: new Set(),
      messages: [
        { seq: 20, authorKeyHex: 'bbbb', deleted: false, hiddenByBan: false, mentionEveryoneEffective: false, mentions: [] },
        { seq: 11, authorKeyHex: 'bbbb', deleted: false, hiddenByBan: false, mentionEveryoneEffective: false, mentions: [] },
        { seq: 15, authorKeyHex: 'bbbb', deleted: false, hiddenByBan: false, mentionEveryoneEffective: false, mentions: [] },
      ],
    });
    assert.equal(res.firstUnreadSeq, 11);
  });
});

// ── Presence §6.16/§17.6 ─────────────────────────────────────────────────────

describe('Fase 4 — §6.16/§17.6 Presença e digitando efêmeros', () => {
  it('presence 45s TTL, refresh 15s, invisible não publica', () => {
    const clock = new FixedClock(1_000_000);
    const mgr = new PresenceManager({ clock, isHost: () => true });
    assert.equal(mgr.publishPresence({ communityId: 'c1', identityKey: 'aaaa', status: 'online' }).ok, true);
    assert.equal(mgr.getPresenceEntries('c1').length, 1);
    // invisible não publica
    assert.equal(mgr.publishPresence({ communityId: 'c1', identityKey: 'bbbb', status: 'invisible' }).ok, true);
    assert.equal(mgr.getPresenceEntries('c1').length, 1);
    clock.advance(46_000);
    mgr.tick();
    assert.equal(mgr.getPresenceEntries('c1').length, 0);
  });

  it('rate limit presença 1/5s por autor (§17.6)', () => {
    const clock = new FixedClock(0);
    const mgr = new PresenceManager({ clock });
    assert.equal(mgr.publishPresence({ communityId: 'c1', identityKey: 'aaaa', status: 'online' }).ok, true);
    const res = mgr.publishPresence({ communityId: 'c1', identityKey: 'aaaa', status: 'idle' });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, 'E_RATE_LIMITED');
    clock.advance(5_100);
    assert.equal(mgr.publishPresence({ communityId: 'c1', identityKey: 'aaaa', status: 'idle' }).ok, true);
  });

  it('typing TTL 5s, rate limit 1/2s por canal, só para quem assinou (§17.6)', () => {
    const clock = new FixedClock(0);
    const deltas: unknown[] = [];
    const mgr = new PresenceManager({ clock, onTypingChanged: (d) => deltas.push(d) });
    mgr.subscribeChannel({ communityId: 'c1', subscriberKey: 'subA', channelId: 'ch1', on: true });
    assert.equal(mgr.publishTyping({ communityId: 'c1', identityKey: 'aaaa', channelId: 'ch1' }).ok, true);
    assert.deepEqual(mgr.getTypingForChannel('c1', 'ch1'), ['aaaa']);
    // sem assinatura em ch2 não emite delta, mas guarda
    mgr.publishTyping({ communityId: 'c1', identityKey: 'aaaa', channelId: 'ch2' });
    assert.deepEqual(mgr.getTypingForChannel('c1', 'ch2'), ['aaaa']);
    // rate limit
    const res = mgr.publishTyping({ communityId: 'c1', identityKey: 'aaaa', channelId: 'ch1' });
    assert.equal(res.ok, false);
    clock.advance(6_000);
    mgr.tick();
    assert.equal(mgr.getTypingForChannel('c1', 'ch1').length, 0);
  });

  it('host agrega presença em delta consolidado a cada PRESENCE_TICK_MS', () => {
    const clock = new FixedClock(0);
    const deltas: import('../src/l2/presence/index.ts').PresenceDelta[] = [];
    const mgr = new PresenceManager({ clock, isHost: (cid) => cid === 'c1', onPresenceChanged: (d) => deltas.push(d) });
    mgr.publishPresence({ communityId: 'c1', identityKey: 'aaaa', status: 'online' });
    clock.advance(100);
    mgr.tick();
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0]?.entries.length, 1);
    // segundo tick sem mudança não reemite
    clock.advance(2_000);
    const n = mgr.tick();
    assert.equal(n.presence.length, 0);
  });

  it('typing é por interesse: só quem assinou recebe delta', () => {
    const clock = new FixedClock(0);
    const emitted: string[] = [];
    const mgr = new PresenceManager({
      clock,
      onTypingChanged: (d) => emitted.push(d.channelId),
      isHost: () => true,
    });
    mgr.subscribeChannel({ communityId: 'c1', subscriberKey: 'bob', channelId: 'ch1', on: true });
    mgr.publishTyping({ communityId: 'c1', identityKey: 'aaaa', channelId: 'ch1' });
    assert.ok(emitted.includes('ch1'));
    emitted.length = 0;
    mgr.publishTyping({ communityId: 'c1', identityKey: 'aaaa', channelId: 'ch2' });
    // ch2 sem assinante não emite
    assert.equal(emitted.length, 0);
  });
});
