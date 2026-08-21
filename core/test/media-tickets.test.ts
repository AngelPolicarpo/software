// Testes dos tickets de mídia — autorização de sessão e revogação (§17.4, A22).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  VoiceTicketManager,
  issueSessionTicket,
  mediaTicketMessage,
  orderedPair,
  verifyMediaTicket,
  type MediaTicket,
} from '../src/l2/voiceCoordinator/index.ts';
import { MEDIA_TICKET_TTL_MS } from '../src/l1/fold/constants.ts';
import { keypairFromSeed } from './helpers/world.ts';

function fakeClock(): { now(): number; advance(ms: number): void } {
  let t = 1_000_000;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

const HOST = keypairFromSeed('host-comunidade');
const OUTRO_HOST = keypairFromSeed('host-invasor');
const ALICE = keypairFromSeed('alice');
const BOB = keypairFromSeed('bob');
const SESSION = 'sess-voz-42';
const CHANNEL = 'channel-voz-1';

interface ClientFixture {
  clock: ReturnType<typeof fakeClock>;
  alice: VoiceTicketManager;
  bob: VoiceTicketManager;
}

function clients(): ClientFixture {
  const clock = fakeClock();
  return {
    clock,
    alice: new VoiceTicketManager({ hostPublicKey: HOST.publicKey, localPeer: ALICE.publicKey, clock }),
    bob: new VoiceTicketManager({ hostPublicKey: HOST.publicKey, localPeer: BOB.publicKey, clock }),
  };
}

// ─── Codec do ticket ────────────────────────────────────────────────────────────────────

describe('codec do ticket de mídia (A22, §17.4)', () => {
  it('mensagem é determinística e sensível a cada campo do escopo', () => {
    const base = { sessionId: SESSION, channelId: CHANNEL, peerA: ALICE.publicKey, peerB: BOB.publicKey, expiresAt: 5_000 };
    assert.deepEqual(mediaTicketMessage(base), mediaTicketMessage(base));
    assert.notDeepEqual(mediaTicketMessage(base), mediaTicketMessage({ ...base, sessionId: 'outra' }));
    assert.notDeepEqual(mediaTicketMessage(base), mediaTicketMessage({ ...base, channelId: 'outro' }));
    assert.notDeepEqual(mediaTicketMessage(base), mediaTicketMessage({ ...base, peerA: BOB.publicKey, peerB: ALICE.publicKey }));
    assert.notDeepEqual(mediaTicketMessage(base), mediaTicketMessage({ ...base, expiresAt: 5_001 }));
  });

  it('par canônico é independente da orientação local', () => {
    const ab = orderedPair(ALICE.publicKey, BOB.publicKey);
    const ba = orderedPair(BOB.publicKey, ALICE.publicKey);
    assert.ok(ab.peerA.equals(ba.peerA));
    assert.ok(ab.peerB.equals(ba.peerB));
  });

  it('emissão e verificação funcionam nas duas orientações do par', () => {
    const ticket = issueSessionTicket(HOST.secretKey, {
      sessionId: SESSION,
      channelId: CHANNEL,
      selfKey: ALICE.publicKey,
      otherKey: BOB.publicKey,
      now: 1_000_000,
      ttlMs: MEDIA_TICKET_TTL_MS,
    });
    assert.deepEqual(ticket.expiresAt - 1_000_000, MEDIA_TICKET_TTL_MS);
    // Alice verifica contra (local=ALICE, remoto=BOB); Bob, na orientação invertida
    assert.equal(
      verifyMediaTicket(HOST.publicKey, ticket, {
        sessionId: SESSION,
        channelId: CHANNEL,
        localPeer: ALICE.publicKey,
        remotePeer: BOB.publicKey,
      }, 1_000_500).ok,
      true,
    );
    assert.equal(
      verifyMediaTicket(HOST.publicKey, ticket, {
        sessionId: SESSION,
        channelId: CHANNEL,
        localPeer: BOB.publicKey,
        remotePeer: ALICE.publicKey,
      }, 1_000_500).ok,
      true,
    );
  });

  it('forjado com outra chave de host é E_TICKET_INVALID', () => {
    const ticket = issueSessionTicket(OUTRO_HOST.secretKey, {
      sessionId: SESSION,
      channelId: CHANNEL,
      selfKey: ALICE.publicKey,
      otherKey: BOB.publicKey,
      now: 0,
      ttlMs: MEDIA_TICKET_TTL_MS,
    });
    const r = verifyMediaTicket(HOST.publicKey, ticket, {
      sessionId: SESSION,
      channelId: CHANNEL,
      localPeer: ALICE.publicKey,
      remotePeer: BOB.publicKey,
    }, 1);
    assert.deepEqual(r, { ok: false, code: 'E_TICKET_INVALID' });
  });

  it('adulteração de qualquer campo do escopo invalida o ticket', () => {
    const ticket = issueSessionTicket(HOST.secretKey, {
      sessionId: SESSION,
      channelId: CHANNEL,
      selfKey: ALICE.publicKey,
      otherKey: BOB.publicKey,
      now: 0,
      ttlMs: MEDIA_TICKET_TTL_MS,
    });
    const expected = {
      channelId: CHANNEL,
      localPeer: ALICE.publicKey,
      remotePeer: BOB.publicKey,
    };
    assert.equal(verifyMediaTicket(HOST.publicKey, ticket, { ...expected, sessionId: 'outra-sessão' }, 1).ok, false);
    assert.equal(verifyMediaTicket(HOST.publicKey, ticket, { ...expected, sessionId: SESSION, channelId: 'outro-canal' }, 1).ok, false);
    assert.equal(
      verifyMediaTicket(HOST.publicKey, ticket, {
        sessionId: SESSION,
        channelId: CHANNEL,
        localPeer: keypairFromSeed('estranho').publicKey,
        remotePeer: BOB.publicKey,
      }, 1).ok,
      false,
    );
  });

  it('expirado é E_TICKET_INVALID — pior caso de ban sem voice.revoked (T-32)', () => {
    const now = 1_000_000;
    const ticket = issueSessionTicket(HOST.secretKey, {
      sessionId: SESSION,
      channelId: CHANNEL,
      selfKey: ALICE.publicKey,
      otherKey: BOB.publicKey,
      now,
      ttlMs: MEDIA_TICKET_TTL_MS,
    });
    const antes = verifyMediaTicket(HOST.publicKey, ticket, {
      sessionId: SESSION,
      channelId: CHANNEL,
      localPeer: ALICE.publicKey,
      remotePeer: BOB.publicKey,
    }, now + MEDIA_TICKET_TTL_MS - 1);
    assert.equal(antes.ok, true);
    const noLimite = verifyMediaTicket(HOST.publicKey, ticket, {
      sessionId: SESSION,
      channelId: CHANNEL,
      localPeer: ALICE.publicKey,
      remotePeer: BOB.publicKey,
    }, now + MEDIA_TICKET_TTL_MS);
    assert.deepEqual(noLimite, { ok: false, code: 'E_TICKET_INVALID' });
  });

  it('assinatura com tamanho errado é recusada sem verificar', () => {
    const ticket = issueSessionTicket(HOST.secretKey, {
      sessionId: SESSION,
      channelId: CHANNEL,
      selfKey: ALICE.publicKey,
      otherKey: BOB.publicKey,
      now: 0,
      ttlMs: MEDIA_TICKET_TTL_MS,
    });
    const truncado: MediaTicket = { ...ticket, sig: ticket.sig.subarray(0, 32) };
    assert.equal(
      verifyMediaTicket(HOST.publicKey, truncado, {
        sessionId: SESSION,
        channelId: CHANNEL,
        localPeer: ALICE.publicKey,
        remotePeer: BOB.publicKey,
      }, 1).ok,
      false,
    );
  });
});

// ─── Aplicação client-side: aceite, renovação, revogação ────────────────────────────────

describe('VoiceTicketManager — sinalização, DTLS e revogação (§17.4 passos 3–4)', () => {
  it('sinalização só entra com ticket válido para esta sessão e este par', () => {
    const f = clients();
    const ticket = issueSessionTicket(HOST.secretKey, {
      sessionId: SESSION,
      channelId: CHANNEL,
      selfKey: BOB.publicKey,
      otherKey: ALICE.publicKey,
      now: f.clock.now(),
      ttlMs: MEDIA_TICKET_TTL_MS,
    });
    assert.deepEqual(f.alice.acceptSignaling({ sessionId: SESSION, channelId: CHANNEL, remotePeer: BOB.publicKey, ticket }), { ok: true });
    assert.equal(f.alice.canInitiateDtls(SESSION, BOB.publicKey), true);

    const estranho = keypairFromSeed('estranho');
    assert.deepEqual(f.alice.acceptSignaling({ sessionId: SESSION, channelId: CHANNEL, remotePeer: estranho.publicKey, ticket }), {
      ok: false,
      code: 'E_TICKET_INVALID',
    });
    assert.equal(f.alice.canInitiateDtls(SESSION, estranho.publicKey), false);

    // ticket válido, mas de outra sessão
    const outraSessao = issueSessionTicket(HOST.secretKey, {
      sessionId: 'sess-outra',
      channelId: CHANNEL,
      selfKey: BOB.publicKey,
      otherKey: ALICE.publicKey,
      now: f.clock.now(),
      ttlMs: MEDIA_TICKET_TTL_MS,
    });
    assert.deepEqual(f.alice.acceptSignaling({ sessionId: SESSION, channelId: CHANNEL, remotePeer: BOB.publicKey, ticket: outraSessao }), {
      ok: false,
      code: 'E_TICKET_INVALID',
    });
  });

  it('renovação estende a validade; expiração encerra o DTLS permitido', () => {
    const f = clients();
    const t0 = f.clock.now();
    const emitir = (): MediaTicket =>
      issueSessionTicket(HOST.secretKey, {
        sessionId: SESSION,
        channelId: CHANNEL,
        selfKey: BOB.publicKey,
        otherKey: ALICE.publicKey,
        now: f.clock.now(),
        ttlMs: MEDIA_TICKET_TTL_MS,
      });
    f.alice.acceptSignaling({ sessionId: SESSION, channelId: CHANNEL, remotePeer: BOB.publicKey, ticket: emitir() });
    assert.deepEqual(f.alice.ticketExpiry(SESSION, BOB.publicKey), t0 + MEDIA_TICKET_TTL_MS);

    f.clock.advance(MEDIA_TICKET_TTL_MS - 60_000);
    f.alice.renew({ sessionId: SESSION, channelId: CHANNEL, remotePeer: BOB.publicKey, ticket: emitir() });
    assert.deepEqual(f.alice.ticketExpiry(SESSION, BOB.publicKey), f.clock.now() + MEDIA_TICKET_TTL_MS);
    assert.equal(f.alice.sweep(), 0);

    f.clock.advance(MEDIA_TICKET_TTL_MS + 1);
    assert.equal(f.alice.canInitiateDtls(SESSION, BOB.publicKey), false);
    assert.equal(f.alice.sweep(), 1);
  });

  it('voice.revoked força fechamento imediato e bloqueia novo aceite/renovação', () => {
    const f = clients();
    const emitir = (): MediaTicket =>
      issueSessionTicket(HOST.secretKey, {
        sessionId: SESSION,
        channelId: CHANNEL,
        selfKey: BOB.publicKey,
        otherKey: ALICE.publicKey,
        now: f.clock.now(),
        ttlMs: MEDIA_TICKET_TTL_MS,
      });
    f.bob.acceptSignaling({ sessionId: SESSION, channelId: CHANNEL, remotePeer: ALICE.publicKey, ticket: emitir() });
    assert.equal(f.bob.canInitiateDtls(SESSION, ALICE.publicKey), true);

    // mod.ban/kick/timeout/channel.delete/voice.leave → host emite voice.revoked{ALICE}
    assert.deepEqual(f.bob.revoke(ALICE.publicKey, SESSION), [
      { sessionId: SESSION, remotePeerHex: ALICE.publicKey.toString('hex') },
    ]);
    assert.equal(f.bob.canInitiateDtls(SESSION, ALICE.publicKey), false);
    // mesmo com ticket fresco e válido, a sessão revogada não reabre
    assert.deepEqual(f.bob.acceptSignaling({ sessionId: SESSION, channelId: CHANNEL, remotePeer: ALICE.publicKey, ticket: emitir() }), {
      ok: false,
      code: 'E_TICKET_INVALID',
    });
    assert.deepEqual(f.bob.revoke(ALICE.publicKey, SESSION), []); // idempotente

    // outra sessão não é alcançada pela revogação desta
    const novaSessao = 'sess-voz-43';
    const ticket2 = issueSessionTicket(HOST.secretKey, {
      sessionId: novaSessao,
      channelId: CHANNEL,
      selfKey: BOB.publicKey,
      otherKey: ALICE.publicKey,
      now: f.clock.now(),
      ttlMs: MEDIA_TICKET_TTL_MS,
    });
    assert.deepEqual(f.bob.acceptSignaling({ sessionId: novaSessao, channelId: CHANNEL, remotePeer: ALICE.publicKey, ticket: ticket2 }), {
      ok: true,
    });
  });

  it('dropSession limpa tickets e marcações de revogação da sessão', () => {
    const f = clients();
    const ticket = issueSessionTicket(HOST.secretKey, {
      sessionId: SESSION,
      channelId: CHANNEL,
      selfKey: BOB.publicKey,
      otherKey: ALICE.publicKey,
      now: f.clock.now(),
      ttlMs: MEDIA_TICKET_TTL_MS,
    });
    f.bob.acceptSignaling({ sessionId: SESSION, channelId: CHANNEL, remotePeer: ALICE.publicKey, ticket });
    f.bob.revoke(ALICE.publicKey, SESSION);
    f.bob.dropSession(SESSION);
    assert.deepEqual(f.bob.ticketExpiry(SESSION, ALICE.publicKey), null);
    assert.equal(f.bob.sweep(), 0);
  });
});

describe('constante §27.1 do ticket', () => {
  it('MEDIA_TICKET_TTL_MS é 5 min', () => {
    assert.equal(MEDIA_TICKET_TTL_MS, 300_000);
  });
});
