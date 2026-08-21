// Testes do lado host do `voiceCoordinator` — sessões de voz, tickets e revogação
// derivada do log (§17.4, §RPC `voiceJoin`/`voiceLeave`/`voiceState`/`voiceTicket`, A22).
// O `DecisionState` real das fixtures prova que a porta `VoiceStatePort` é satisfeita
// pela estrutura de L1 sem importá-la (§4).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  VoiceHostSessions,
  verifyMediaTicket,
  type RevokedTarget,
  type RosterSnapshot,
} from '../src/l2/voiceCoordinator/index.ts';
import { issueTurnCredential } from '../src/l2/communityHost/stunTurn.ts';
import {
  MAX_CAMERAS,
  MAX_VOICE_PARTICIPANTS,
  MEDIA_TICKET_TTL_MS,
} from '../src/l1/fold/constants.ts';
import { genesis, joinMember, keypairFromSeed, makeRecord, T0, type Genesis } from './helpers/world.ts';

const HOST = keypairFromSeed('host-sessoes');

function fakeClock(): { now(): number; advance(ms: number): void } {
  let t = T0 + 500_000;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

interface Rig {
  clock: ReturnType<typeof fakeClock>;
  sessions: VoiceHostSessions;
  revoked: RevokedTarget[];
  rosters: RosterSnapshot[];
}

function rig(overrides: Partial<ConstructorParameters<typeof VoiceHostSessions>[0]> = {}): Rig {
  const clock = fakeClock();
  const revoked: RevokedTarget[] = [];
  const rosters: RosterSnapshot[] = [];
  let n = 0;
  const sessions = new VoiceHostSessions({
    hostSecretKey: HOST.secretKey,
    hostTurnSecret: Buffer.alloc(32, 5),
    clock,
    ttlMs: MEDIA_TICKET_TTL_MS,
    maxParticipants: MAX_VOICE_PARTICIPANTS,
    maxCameras: MAX_CAMERAS,
    isVoiceChannelType: (type) => type === 1,
    sessionIdFactory: () => `sess-${++n}`,
    iceServers: () => [{ urls: 'stun:203.0.113.1:3478' }],
    onRevoked: (targets) => revoked.push(...targets),
    onRosterChanged: (snapshot) => rosters.push(snapshot),
    ...overrides,
  });
  return { clock, sessions, revoked, rosters };
}

/** Canal de voz com authorSeq explícito — `world.id` exige o mesmo número do submit. */
function addVoiceChannel(g: Genesis, name: string, hostTs: number): string {
  const seq = g.world.next(g.founder);
  g.world.push(
    makeRecord(g.world.core, {
      kind: 'channel.create',
      author: g.founder,
      authorSeq: seq,
      hostTs,
      payload: { categoryId: g.categoryId, type: 1, name, readOnlyForRoleIds: [] },
    }),
  );
  return g.world.id('channel', g.founder, seq);
}

/** Gênese real + canal de voz próprio; membros com o cargo base têm `voice_speak`. */
function voiceWorld(): { g: Genesis; vozId: string; alice: ReturnType<typeof keypairFromSeed>; bob: ReturnType<typeof keypairFromSeed> } {
  const g = genesis();
  const vozId = addVoiceChannel(g, 'voz', T0 + 50);
  const alice = joinMember(g, 'alice');
  const bob = joinMember(g, 'bob');
  return { g, vozId, alice, bob };
}

/** Canal de voz num estado mínimo da porta — para casos que não precisam do log. */
function miniPort(overrides: Partial<Parameters<VoiceHostSessions['join']>[0]['state']> = {}): Parameters<VoiceHostSessions['join']>[0]['state'] {
  const alice = keypairFromSeed('mini-alice').publicKey.toString('hex');
  return {
    community: { exists: true },
    channels: new Map([['ch-voz', { type: 1 }]]),
    members: new Map([[alice, { state: 'active', roleIds: ['r-voz'] }]]),
    roles: new Map([['r-voz', { permissions: [9] }]]), // 9 = voice_speak (§9.1)
    ...overrides,
  };
}

/** Estreteita o desfecho para leitura do código em asserções. */
function codeOf(result: { ok: true } | { ok: false; code: string }): 'ok' | string {
  return result.ok ? 'ok' : result.code;
}

// ─── voiceJoin — validação de §17.4 passo 1 ─────────────────────────────────────────────

describe('voiceJoin — validação de §17.4 passo 1', () => {
  it('entra com DecisionState real: sessão, roster, credencial TURN e gelo', () => {
    const { g, vozId, alice } = voiceWorld();
    const r = rig();
    const joined = r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') });
    assert.equal(joined.ok, true);
    if (!joined.ok) return;
    assert.equal(joined.sessionId, 'sess-1');
    assert.deepEqual(joined.roster.map((e) => e.keyHex), [alice.publicKey.toString('hex')]);
    assert.deepEqual(joined.tickets, []);
    assert.equal(joined.turnCredential.username, `${joined.sessionId}:${r.clock.now() + MEDIA_TICKET_TTL_MS}`);
    assert.deepEqual(joined.iceServers, [{ urls: 'stun:203.0.113.1:3478' }]);
    assert.deepEqual(
      issueTurnCredential(Buffer.alloc(32, 5), joined.sessionId, alice.publicKey, r.clock.now() + MEDIA_TICKET_TTL_MS),
      joined.turnCredential,
    );
    assert.equal(r.rosters.length, 1);
    assert.equal(r.sessions.participantKeys(joined.sessionId).size, 1);
  });

  it('canal de texto é E_CHANNEL_NOT_VOICE; canal ausente é E_CHANNEL_NOT_FOUND', () => {
    const { g, alice } = voiceWorld();
    const r = rig();
    assert.equal(codeOf(r.sessions.join({ state: g.world.state, channelId: g.channelId, memberKeyHex: alice.publicKey.toString('hex') })), 'E_CHANNEL_NOT_VOICE');
    assert.equal(codeOf(r.sessions.join({ state: g.world.state, channelId: 'canal-fantasma', memberKeyHex: alice.publicKey.toString('hex') })), 'E_CHANNEL_NOT_FOUND');
  });

  it('quem nunca entrou é E_NOT_MEMBER; banido é E_BANNED mesmo com cargo válido', () => {
    const { g, vozId, alice, bob } = voiceWorld();
    const r = rig();
    const fantasma = keypairFromSeed('fantasma');
    assert.equal(codeOf(r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: fantasma.publicKey.toString('hex') })), 'E_NOT_MEMBER');

    g.world.submit({ kind: 'mod.ban', author: g.founder, hostTs: T0 + 400, payload: { targetKey: bob.publicKey } });
    assert.equal(g.world.state.members.get(bob.publicKey.toString('hex'))?.state, 'banned');
    assert.equal(codeOf(r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: bob.publicKey.toString('hex') })), 'E_BANNED');
    void alice;
  });

  it('timeout ativo é E_TIMED_OUT e expira sozinho', () => {
    const { g, vozId, alice } = voiceWorld();
    const r = rig();
    const hostTs = r.clock.now();
    g.world.submit({
      kind: 'mod.timeout',
      author: g.founder,
      hostTs,
      payload: { targetKey: alice.publicKey, until: hostTs + 120_000 },
    });
    assert.equal(codeOf(r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') })), 'E_TIMED_OUT');
    r.clock.advance(121_000);
    assert.equal(r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') }).ok, true);
  });

  it('comunidade ended e inexistente são recusadas; falta de voice_speak é E_PERMISSION_DENIED', () => {
    const r = rig();
    const hex = keypairFromSeed('mini-alice').publicKey.toString('hex');
    assert.equal(codeOf(r.sessions.join({ state: miniPort({ community: { exists: false } }), channelId: 'ch-voz', memberKeyHex: hex })), 'E_NOT_FOUND');
    assert.equal(codeOf(r.sessions.join({ state: miniPort({ community: { exists: true, endedAt: 1 } }), channelId: 'ch-voz', memberKeyHex: hex })), 'E_COMMUNITY_ENDED');
    assert.equal(
      codeOf(
        r.sessions.join({
          state: miniPort({ roles: new Map([['r-voz', { permissions: [] }]]) }),
          channelId: 'ch-voz',
          memberKeyHex: hex,
        }),
      ),
      'E_PERMISSION_DENIED',
    );
  });
});

// ─── Sessão, roster e renovação ────────────────────────────────────────────────────────

describe('sessão de voz — roster, pares e tetos', () => {
  it('segundo participante recebe ticket par-a-par verificável pelo cliente', () => {
    const { g, vozId, alice, bob } = voiceWorld();
    const r = rig();
    const a = r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') });
    const b = r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: bob.publicKey.toString('hex') });
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    assert.equal(a.sessionId, b.sessionId);
    // alice recebeu ticket para bob; verifica na orientação dela
    const ticketDeBobParaAlice = b.tickets.find((t) =>
      verifyMediaTicket(HOST.publicKey, t, {
        sessionId: b.sessionId,
        channelId: vozId,
        localPeer: bob.publicKey,
        remotePeer: alice.publicKey,
      }, r.clock.now()).ok,
    );
    assert.ok(ticketDeBobParaAlice !== undefined);
    // o roster vivo tem os dois; o snapshot de cada resposta também
    const vivos = r.sessions.sessionOf(vozId)!.participants.map((e) => e.keyHex).sort();
    assert.deepEqual(vivos, [alice.publicKey.toString('hex'), bob.publicKey.toString('hex')].sort());
    assert.deepEqual(a.roster.map((e) => e.keyHex), [alice.publicKey.toString('hex')]);
    // roster ordena determinístico
    assert.deepEqual(b.roster, [...b.roster].sort((x, y) => x.keyHex.localeCompare(y.keyHex)));
  });

  it('re-entrada no mesmo canal devolve a mesma sessão com material fresco', () => {
    const { g, vozId, alice, bob } = voiceWorld();
    const r = rig();
    const primeira = r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') });
    r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: bob.publicKey.toString('hex') });
    r.clock.advance(60_000);
    const segunda = r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') });
    assert.ok(primeira.ok && segunda.ok);
    if (!primeira.ok || !segunda.ok) return;
    assert.equal(segunda.sessionId, primeira.sessionId);
    assert.equal(segunda.tickets.length, 1);
    assert.equal(segunda.tickets[0]!.expiresAt, r.clock.now() + MEDIA_TICKET_TTL_MS);
    assert.notEqual(segunda.tickets[0]!.sig.toString('hex'), primeira.tickets[0]?.sig.toString('hex'));
  });

  it('teto de participantes injetado produz E_VOICE_FULL', () => {
    const { g, vozId, alice, bob } = voiceWorld();
    const r = rig({ maxParticipants: 1 });
    assert.equal(r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') }).ok, true);
    assert.equal(codeOf(r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: bob.publicKey.toString('hex') })), 'E_VOICE_FULL');
  });

  it('entrar noutra chamada sai da anterior e revoga aos que ficaram', () => {
    const { g, vozId, alice, bob } = voiceWorld();
    const voz2 = addVoiceChannel(g, 'voz-2', T0 + 200);
    const r = rig();
    r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') });
    r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: bob.publicKey.toString('hex') });
    r.revoked.length = 0;
    const nova = r.sessions.join({ state: g.world.state, channelId: voz2, memberKeyHex: alice.publicKey.toString('hex') });
    assert.ok(nova.ok);
    assert.equal(r.revoked.length, 1);
    assert.equal(r.revoked[0]!.targetKeyHex, alice.publicKey.toString('hex'));
    assert.equal(r.revoked[0]!.channelId, vozId);
    assert.equal(r.sessions.participantKeys(nova.ok ? nova.sessionId : '').has(alice.publicKey.toString('hex')), true);
  });
});

// ─── voiceLeave e derivação de revogação ────────────────────────────────────────────────

describe('voiceLeave e sweepAgainst — revogação de §17.4', () => {
  it('leave emite voice.revoked{targetKey} e encerra sessão vazia', () => {
    const { g, vozId, alice, bob } = voiceWorld();
    const r = rig();
    const a = r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') });
    r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: bob.publicKey.toString('hex') });
    assert.ok(a.ok);
    if (!a.ok) return;
    r.revoked.length = 0;
    const left = r.sessions.leave({ sessionId: a.sessionId, memberKeyHex: alice.publicKey.toString('hex') });
    assert.deepEqual(left, { ok: true });
    assert.deepEqual(r.revoked, [{ sessionId: a.sessionId, channelId: vozId, targetKeyHex: alice.publicKey.toString('hex') }]);
    assert.equal(r.sessions.sessionOf(vozId)!.participants.length, 1);
    r.sessions.leave({ sessionId: a.sessionId, memberKeyHex: bob.publicKey.toString('hex') });
    assert.equal(r.sessions.sessionCount, 0);
    assert.equal(codeOf(r.sessions.leave({ sessionId: a.sessionId, memberKeyHex: bob.publicKey.toString('hex') })), 'E_SESSION_GONE');
  });

  it('ban no meio da chamada derruba só o alvo no sweep', () => {
    const { g, vozId, alice, bob } = voiceWorld();
    const r = rig();
    const a = r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') });
    r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: bob.publicKey.toString('hex') });
    assert.ok(a.ok);
    if (!a.ok) return;
    r.revoked.length = 0;
    g.world.submit({ kind: 'mod.ban', author: g.founder, hostTs: r.clock.now(), payload: { targetKey: alice.publicKey } });
    const emitted = r.sessions.sweepAgainst(g.world.state);
    assert.deepEqual(emitted, [{ sessionId: a.sessionId, channelId: vozId, targetKeyHex: alice.publicKey.toString('hex') }]);
    assert.equal(r.sessions.participantKeys(a.sessionId).has(alice.publicKey.toString('hex')), false);
    assert.equal(codeOf(r.sessions.renewTicket({ state: g.world.state, sessionId: a.sessionId, memberKeyHex: alice.publicKey.toString('hex'), peerKeyHex: bob.publicKey.toString('hex') })), 'E_TICKET_DENIED');
  });

  it('channel.delete encerra a sessão inteira; fim da comunidade também', () => {
    const { g, vozId, alice, bob } = voiceWorld();
    const r = rig();
    const a = r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') });
    r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: bob.publicKey.toString('hex') });
    assert.ok(a.ok);
    if (!a.ok) return;
    g.world.submit({ kind: 'channel.delete', author: g.founder, hostTs: r.clock.now(), payload: { channelId: vozId } });
    const emitted = r.sessions.sweepAgainst(g.world.state);
    assert.equal(emitted.length, 2);
    assert.equal(r.sessions.sessionCount, 0);
  });

  it('fim da comunidade derruba qualquer sessão restante', () => {
    const { g, vozId, alice } = voiceWorld();
    const r = rig();
    const a = r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') });
    assert.ok(a.ok);
    if (!a.ok) return;
    const emitted = r.sessions.sweepAgainst({
      community: { exists: false },
      channels: new Map(),
      members: new Map(),
      roles: new Map(),
    });
    assert.deepEqual(emitted, [{ sessionId: a.sessionId, channelId: vozId, targetKeyHex: alice.publicKey.toString('hex') }]);
    assert.equal(r.sessions.sessionCount, 0);
  });
});

// ─── voiceState ─────────────────────────────────────────────────────────────────────────

describe('voiceState — estado próprio e teto de câmeras', () => {
  it('aplica o patch e reflete no roster; sessão alheia é E_SESSION_GONE', () => {
    const { g, vozId, alice } = voiceWorld();
    const r = rig();
    const a = r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') });
    assert.ok(a.ok);
    if (!a.ok) return;
    r.rosters.length = 0;
    const patched = r.sessions.setSelf({
      sessionId: a.sessionId,
      memberKeyHex: alice.publicKey.toString('hex'),
      patch: { muted: true, deafened: true, speaking: true },
    });
    assert.deepEqual(patched, { ok: true });
    assert.equal(r.rosters.at(-1)?.participants[0]?.muted, true);
    assert.equal(codeOf(r.sessions.setSelf({ sessionId: 'outra', memberKeyHex: alice.publicKey.toString('hex'), patch: { muted: true } })), 'E_SESSION_GONE');
  });

  it('teto de câmeras injetado produz E_CAMERA_LIMIT', () => {
    const { g, vozId, alice, bob } = voiceWorld();
    const r = rig({ maxCameras: 1 });
    const a = r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') });
    r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: bob.publicKey.toString('hex') });
    assert.ok(a.ok);
    if (!a.ok) return;
    assert.equal(r.sessions.setSelf({ sessionId: a.sessionId, memberKeyHex: alice.publicKey.toString('hex'), patch: { cameraOn: true } }).ok, true);
    assert.equal(codeOf(r.sessions.setSelf({ sessionId: a.sessionId, memberKeyHex: bob.publicKey.toString('hex'), patch: { cameraOn: true } })), 'E_CAMERA_LIMIT');
  });
});

// ─── voiceTicket ────────────────────────────────────────────────────────────────────────

describe('voiceTicket — renovação par-a-par (§26.2)', () => {
  it('renova para par presente e elegível; recusa fora da sessão e a si mesmo', () => {
    const { g, vozId, alice, bob } = voiceWorld();
    const r = rig();
    const a = r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: alice.publicKey.toString('hex') });
    r.sessions.join({ state: g.world.state, channelId: vozId, memberKeyHex: bob.publicKey.toString('hex') });
    assert.ok(a.ok);
    if (!a.ok) return;
    const renewed = r.sessions.renewTicket({
      state: g.world.state,
      sessionId: a.sessionId,
      memberKeyHex: alice.publicKey.toString('hex'),
      peerKeyHex: bob.publicKey.toString('hex'),
    });
    assert.equal(renewed.ok, true);
    if (!renewed.ok) return;
    assert.equal(renewed.expiresAt, r.clock.now() + MEDIA_TICKET_TTL_MS);
    assert.equal(renewed.ticketId.length > 0, true);
    assert.equal(
      verifyMediaTicket(HOST.publicKey, renewed.ticket, {
        sessionId: a.sessionId,
        channelId: vozId,
        localPeer: alice.publicKey,
        remotePeer: bob.publicKey,
      }, r.clock.now()).ok,
      true,
    );

    const estranho = keypairFromSeed('estranho').publicKey.toString('hex');
    assert.equal(codeOf(r.sessions.renewTicket({ state: g.world.state, sessionId: a.sessionId, memberKeyHex: alice.publicKey.toString('hex'), peerKeyHex: estranho })), 'E_TICKET_DENIED');
    assert.equal(codeOf(r.sessions.renewTicket({ state: g.world.state, sessionId: a.sessionId, memberKeyHex: alice.publicKey.toString('hex'), peerKeyHex: alice.publicKey.toString('hex') })), 'E_TICKET_DENIED');
  });
});

describe('constantes §27.1 de voz', () => {
  it('tetos normativos', () => {
    assert.equal(MAX_VOICE_PARTICIPANTS, 24);
    assert.equal(MAX_CAMERAS, 6);
  });
});
