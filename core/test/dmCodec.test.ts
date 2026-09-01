/**
 * §31.2, §31.3, §31.4, §31.5 — o codec da conversa direta.
 *
 * Duas propriedades mandam aqui: **a forma canônica é o encoding** (não há segunda
 * serialização a manter em dia) e **nada lança** (§31.7.1) — `decode*` e `open*` devolvem
 * `null` para qualquer sequência de bytes.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DM_KINDS,
  DM_KIND_NAMES,
  DM_PAYLOAD_LAYOUT,
  DM_VERSION,
  decodeDmEnvelope,
  decodeDmOp,
  decodeDmPayload,
  dmConversationId,
  dmConversationKey,
  dmKindName,
  dmNonce,
  dmPairOrder,
  encodeDmEnvelope,
  encodeDmOp,
  encodeDmPayload,
  isKnownDmKind,
  isSupportedDmVersion,
  openDmPayload,
  peekDmHeader,
  sealDmPayload,
} from '../src/l1/dmCodec/index.ts';
import { dmEntityId, dmEntityTypeOf, entityId } from '../src/l1/idgen/index.ts';
import { KINDS } from '../src/l1/opCodec/index.ts';

import { DM_T0, dmKeypair, dmRecord, dmWorld } from './helpers/dm.ts';

describe('§31.5 — catálogo de ops', () => {
  it('tem exatamente 6 kinds, e o número é normativo e fechado para DM_VERSION = 1', () => {
    assert.equal(DM_KIND_NAMES.length, 6);
    assert.equal(Object.keys(DM_PAYLOAD_LAYOUT).length, 6);
    assert.equal(DM_VERSION, 1);
  });

  it('todo kind tem linha de payload, e nenhum kind existe sem ela', () => {
    for (const nome of DM_KIND_NAMES) {
      assert.equal(typeof DM_PAYLOAD_LAYOUT[nome], 'string');
      assert.ok(isKnownDmKind(DM_KINDS[nome]));
    }
  });

  it('kind fora da tabela é desconhecido — E_UNKNOWN_KIND na escrita, IGNORED na leitura', () => {
    for (const n of [0, 7, 8, 40, 65535]) {
      assert.equal(isKnownDmKind(n), false);
      assert.equal(dmKindName(n), null);
    }
  });

  it('§31.0 — o catálogo de DM não é o de §7.4: os números colidem e não se confundem', () => {
    // `dm.message` = 3 e `message.delete` = 3. Espaços disjuntos, separados pelo core em que
    // o registro vive e pelo `v` do envelope: é isso que "NÃO REUTILIZADO e NÃO TOCADO" quer
    // dizer, e o teste existe para que ninguém "conserte" a colisão unificando os catálogos.
    assert.equal(DM_KINDS['dm.message'], 3);
    assert.equal(KINDS['message.delete'], 3);
  });
});

describe('§31.2 — identidade da conversa', () => {
  const a = dmKeypair('alice').publicKey;
  const b = dmKeypair('bob').publicKey;

  it('é simétrica: id(A,B) = id(B,A)', () => {
    assert.equal(dmConversationId(a, b), dmConversationId(b, a));
  });

  it('ordena por byte, ascendente — a definição não depende de quem lê', () => {
    const p = dmPairOrder(a, b);
    const q = dmPairOrder(b, a);
    assert.ok(p !== null && q !== null);
    assert.ok(p.lo.equals(q.lo) && p.hi.equals(q.hi));
    assert.ok(Buffer.compare(p.lo, p.hi) < 0);
  });

  it('conversa consigo mesmo não é conversa (E_VALIDATION.peerKey)', () => {
    assert.equal(dmPairOrder(a, a), null);
    assert.equal(dmConversationKey(a, a), null);
    assert.equal(dmConversationId(a, a), null);
  });

  it('é 32 bytes, hex64 no IPC, e estável', () => {
    const k = dmConversationKey(a, b);
    assert.ok(k !== null);
    assert.equal(k.length, 32);
    assert.equal(dmConversationId(a, b), k.toString('hex'));
    assert.equal(dmConversationId(a, b), dmConversationId(a, b));
  });
});

describe('§31.4 — envelope, forma canônica e ids', () => {
  const w = dmWorld();

  it('encode/decode é ida e volta, e o encoding É a forma canônica', () => {
    const op = {
      v: DM_VERSION,
      conversationId: w.conversationKey,
      kind: DM_KINDS['dm.message'],
      author: w.lo.identity.publicKey,
      authorSeq: 7,
      ts: DM_T0,
      ack: 3,
      payload: Buffer.from('cifrado'),
    };
    const bytes = encodeDmOp(op);
    const back = decodeDmOp(bytes);
    assert.ok(back !== null);
    assert.deepEqual(encodeDmOp(back), bytes);
  });

  it('o cabeçalho é legível sem a chave de conteúdo — é o que a ordem de §31.6 exige', () => {
    const rec = dmRecord(w, w.lo, {
      kind: 'dm.message',
      authorSeq: 4,
      ack: 9,
      payload: { content: 'oi' },
    });
    const h = peekDmHeader(rec);
    assert.ok(h !== null);
    assert.equal(h.ack, 9);
    assert.equal(h.authorSeq, 4);
    assert.equal(h.kind, DM_KINDS['dm.message']);
  });

  it('§31.3 — o nonce é derivado de (conversationId, author, authorSeq) e tem 24 bytes', () => {
    const n1 = dmNonce(w.conversationKey, w.lo.identity.publicKey, 1);
    const n2 = dmNonce(w.conversationKey, w.lo.identity.publicKey, 2);
    const n3 = dmNonce(w.conversationKey, w.hi.identity.publicKey, 1);
    assert.equal(n1.length, 24);
    assert.ok(!n1.equals(n2), 'authorSeq distinto ⇒ nonce distinto (RD-3 garante unicidade)');
    assert.ok(!n1.equals(n3), 'autor distinto ⇒ nonce distinto');
  });

  it('a AEAD fecha sobre o cabeçalho: mexer nele impede a abertura', () => {
    const h = {
      v: DM_VERSION,
      conversationId: w.conversationKey,
      kind: DM_KINDS['dm.message'],
      author: w.lo.identity.publicKey,
      authorSeq: 2,
      ts: DM_T0,
      ack: 1,
    };
    const ct = sealDmPayload(w.contentKey, h, encodeDmPayload('dm.message', { content: 'oi' }));
    assert.ok(ct !== null);
    assert.ok(openDmPayload(w.contentKey, h, ct) !== null);
    assert.equal(openDmPayload(w.contentKey, { ...h, ts: DM_T0 + 1 }, ct), null);
    assert.equal(openDmPayload(w.contentKey, { ...h, ack: 2 }, ct), null);
    assert.equal(openDmPayload(Buffer.alloc(32, 9), h, ct), null);
  });

  it('§31.4 — o id de mensagem de DM é determinístico, escopado e não colide com o de §7.3', () => {
    const id = dmEntityId('message', w.conversationKey, w.lo.identity.publicKey, 5);
    assert.equal(id, dmEntityId('message', w.conversationKey, w.lo.identity.publicKey, 5));
    assert.ok(id.startsWith('dmsg-'));
    assert.equal(dmEntityTypeOf(id), 'message');
    const outraConversa = dmEntityId('message', Buffer.alloc(32, 1), w.lo.identity.publicKey, 5);
    assert.notEqual(id, outraConversa);
    // Prefixo de domínio próprio: o mesmo trio nunca produz o id de comunidade.
    assert.notEqual(id.slice(5), entityId('message', w.conversationKey, w.lo.identity.publicKey, 5).slice(4));
  });

  it('§31.4 — DM_VERSION é própria e não é opVersion', () => {
    assert.ok(isSupportedDmVersion(1));
    assert.equal(isSupportedDmVersion(2), false);
    assert.equal(isSupportedDmVersion(0), false);
  });
});

describe('§31.7.1 — o codec nunca lança', () => {
  const w = dmWorld();

  it('bytes arbitrários devolvem null, nunca exceção', () => {
    let rng = 1;
    const proximo = (): number => {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      return rng;
    };
    for (let i = 0; i < 20000; i++) {
      const n = proximo() % 300;
      const buf = Buffer.alloc(n);
      for (let j = 0; j < n; j++) buf[j] = proximo() & 0xff;
      assert.doesNotThrow(() => {
        decodeDmEnvelope(buf);
        decodeDmOp(buf);
        peekDmHeader(buf);
        for (const nome of DM_KIND_NAMES) decodeDmPayload(nome, buf);
        const h = peekDmHeader(buf);
        if (h !== null) openDmPayload(w.contentKey, h, buf);
      });
    }
  });

  it('prefixo de tamanho hostil não aloca e não lança', () => {
    // `uint` = 0xff seguido de 2⁵³−1: a leitura precisa concluir "malformado" sem alocar.
    const hostil = Buffer.concat([Buffer.from([0xff]), Buffer.alloc(8, 0xfe)]);
    assert.equal(decodeDmEnvelope(hostil), null);
    assert.equal(decodeDmOp(hostil), null);
  });

  it('envelope truncado em todo comprimento devolve null e não lança', () => {
    const rec = dmRecord(w, w.lo, {
      kind: 'dm.message',
      authorSeq: 1,
      ack: 0,
      payload: { content: 'oi' },
    });
    for (let n = 0; n < rec.length; n++) {
      assert.doesNotThrow(() => peekDmHeader(rec.subarray(0, n)));
    }
    assert.ok(peekDmHeader(rec) !== null);
  });

  it('a AEAD que não abre devolve null — nunca lança, nunca entrega plaintext', () => {
    const rec = dmRecord(w, w.lo, {
      kind: 'dm.message',
      authorSeq: 1,
      ack: 0,
      payload: { content: 'oi' },
    });
    const env = decodeDmEnvelope(rec);
    assert.ok(env !== null);
    const op = decodeDmOp(env.op);
    assert.ok(op !== null);
    const { payload, ...h } = op;
    const corrompido = Buffer.from(payload);
    corrompido[0] = corrompido[0] === 0 ? 1 : 0;
    assert.equal(openDmPayload(w.contentKey, h, corrompido), null);
    assert.equal(openDmPayload(w.contentKey, h, Buffer.alloc(0)), null);
  });
});

describe('§31.4 — não existe HostRecord', () => {
  it('o envelope é `{op, sig}` e nada mais: sem hostTs, sem hostSig, sem flags', () => {
    const w = dmWorld();
    const rec = dmRecord(w, w.lo, {
      kind: 'dm.message',
      authorSeq: 1,
      ack: 0,
      payload: { content: 'oi' },
    });
    const env = decodeDmEnvelope(rec);
    assert.ok(env !== null);
    assert.deepEqual(Object.keys(env).sort(), ['op', 'sig']);
    assert.deepEqual(encodeDmEnvelope(env), rec);
  });
});
