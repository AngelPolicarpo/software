/**
 * §31.7.3 — o pipeline de admissão da conversa direta, estágio a estágio, na ordem fixa.
 *
 * Cada teste alcança **um** estágio e prova que o desfecho é o que a tabela declara. Os
 * testes de ordem — um registro que falharia em dois estágios — são os que importam de
 * verdade: a ordem é normativa e trocar dois estágios muda o código que o cliente recebe.
 *
 * Duas ausências também são testadas, porque são decisões e não esquecimentos: **não existe
 * estágio de duplicata** (a deduplicação é estrutural) e **não existe estágio de
 * autorização** (uma conversa tem dois participantes e cada um escreve o próprio log).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DM_KINDS, DM_VERSION } from '../src/l1/dmCodec/index.ts';
import {
  DM_MAX_ENVELOPE_BYTES,
  DM_MAX_ENVELOPE_BYTES_ATTACHMENT,
  dmFoldRecord,
  newDmMetrics,
  type DmFoldResult,
  type DmState,
} from '../src/l1/dmFold/index.ts';

import { DM_T0, dmHello, dmKeypair, dmRecord, dmWorld, type DmWorld } from './helpers/dm.ts';

/** A conversa com as duas gêneses interpretadas — o ponto de partida da maioria dos testes. */
function aberta(w: DmWorld): DmState {
  let s = w.state();
  s = dmFoldRecord(s, dmHello(w, w.lo), 'lo', 0, w.ctx).next;
  s = dmFoldRecord(s, dmHello(w, w.hi), 'hi', 0, w.ctx).next;
  return s;
}

function texto(n: number): string {
  return 'a'.repeat(n);
}

describe('§31.7.3 estágio 0 — teto de bytes antes de qualquer decode', () => {
  const w = dmWorld();

  it('registro acima de MAX_ENVELOPE_BYTES_ATTACHMENT é REJECTED sem decodificar nada', () => {
    const r = dmFoldRecord(
      w.state(),
      Buffer.alloc(DM_MAX_ENVELOPE_BYTES_ATTACHMENT + 1),
      'lo',
      0,
      w.ctx,
    );
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_PAYLOAD_TOO_LARGE');
    // Nada foi decodificado: sem `kind`, sem `author`. É o que torna `dm_rejected_records.kind`
    // anulável (§31.12).
    assert.equal(r.kind, undefined);
    assert.equal(r.author, undefined);
  });

  it('o número é queimado mesmo assim: o comprimento do lado avança', () => {
    const r = dmFoldRecord(w.state(), Buffer.alloc(DM_MAX_ENVELOPE_BYTES_ATTACHMENT + 1), 'lo', 0, w.ctx);
    assert.equal(r.next.sides.lo.length, 1);
    assert.equal(r.next.interpretedOrdSum, 1);
  });
});

describe('§31.7.3 estágio 1 — decode, versão e kind', () => {
  const w = dmWorld();

  it('bytes que não decodificam são IGNORED / E_MALFORMED, sem partialInterpretation', () => {
    const r = dmFoldRecord(w.state(), Buffer.from([1, 2, 3]), 'lo', 0, w.ctx);
    assert.equal(r.decision, 'IGNORED');
    assert.equal(r.reason, 'E_MALFORMED');
    assert.equal(r.next.partialInterpretation, false);
  });

  it('DM_VERSION desconhecida é IGNORED / E_VERSION_UNSUPPORTED e liga partialInterpretation', () => {
    const rec = dmHello(w, w.lo, { v: DM_VERSION + 1 });
    const r = dmFoldRecord(w.state(), rec, 'lo', 0, w.ctx);
    assert.equal(r.decision, 'IGNORED');
    assert.equal(r.reason, 'E_VERSION_UNSUPPORTED');
    assert.equal(r.next.partialInterpretation, true);
    // A projeção **não** para: o próximo registro continua sendo interpretado.
    assert.equal(r.next.interpretedOrdSum, 1);
  });

  it('kind desconhecido é IGNORED / E_UNKNOWN_KIND e liga partialInterpretation', () => {
    const rec = dmHello(w, w.lo, { kindNumber: 99 });
    const r = dmFoldRecord(w.state(), rec, 'lo', 0, w.ctx);
    assert.equal(r.decision, 'IGNORED');
    assert.equal(r.reason, 'E_UNKNOWN_KIND');
    assert.equal(r.next.partialInterpretation, true);
    assert.equal(r.kind, 99, 'o kind é reportado mesmo desconhecido — diagnóstico de versão');
  });

  it('payload que não casa o layout do kind é IGNORED / E_MALFORMED (estágio 9)', () => {
    // Um `dm.delete` cujo payload é o de `dm.message`: abre a AEAD, não casa o layout.
    const s = aberta(w);
    const rec = dmRecord(w, w.lo, {
      kind: 'dm.message',
      kindNumber: DM_KINDS['dm.hello'],
      authorSeq: 2,
      ack: 1,
      payload: { content: 'oi' },
    });
    const r = dmFoldRecord(s, rec, 'lo', 1, w.ctx);
    assert.equal(r.decision, 'IGNORED');
    assert.equal(r.reason, 'E_MALFORMED');
  });
});

describe('§31.7.3 estágio 2 — vínculo com a conversa (A07)', () => {
  it('envelope de outra conversa é REJECTED / E_WRONG_COMMUNITY', () => {
    const w = dmWorld();
    const outra = dmWorld('carol', 'dave');
    const rec = dmHello(w, w.lo, { conversationKey: outra.conversationKey });
    const r = dmFoldRecord(w.state(), rec, 'lo', 0, w.ctx);
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_WRONG_COMMUNITY');
  });

  it('vem antes do estágio 3: conversa errada ganha do autor errado', () => {
    const w = dmWorld();
    const outra = dmWorld('carol', 'dave');
    const rec = dmRecord(w, w.lo, {
      kind: 'dm.hello',
      authorSeq: 1,
      ack: 0,
      conversationKey: outra.conversationKey,
      payload: {
        peerKey: w.hi.identity.publicKey,
        coreProof: Buffer.alloc(64),
        displayName: 'xx',
        avatarColor: 0,
      },
    });
    // Vindo do core de `hi`, o autor também está errado. O código é o do estágio 2.
    const r = dmFoldRecord(w.state(), rec, 'hi', 0, w.ctx);
    assert.equal(r.reason, 'E_WRONG_COMMUNITY');
  });
});

describe('§31.7.3 estágio 3 — o autor é o dono do core de origem', () => {
  const w = dmWorld();

  it('registro de lo replicado no core de hi é REJECTED / E_AUTHOR_MISMATCH', () => {
    const r = dmFoldRecord(w.state(), dmHello(w, w.lo), 'hi', 0, w.ctx);
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_AUTHOR_MISMATCH');
  });

  it('é a deduplicação estrutural: não existe estágio de duplicata', () => {
    // O mesmo envelope no core certo, no índice certo, é APPLIED — e não há como ele aparecer
    // duas vezes no mesmo índice num Hypercore. Copiado para o outro core, cai no estágio 3.
    const rec = dmHello(w, w.lo);
    assert.equal(dmFoldRecord(w.state(), rec, 'lo', 0, w.ctx).decision, 'APPLIED');
    assert.equal(dmFoldRecord(w.state(), rec, 'hi', 0, w.ctx).reason, 'E_AUTHOR_MISMATCH');
  });
});

describe('§31.7.3 estágio 4 — assinatura do autor', () => {
  const w = dmWorld();

  it('assinatura corrompida é REJECTED / E_BAD_SIGNATURE', () => {
    const r = dmFoldRecord(w.state(), dmHello(w, w.lo, { corruptSig: true }), 'lo', 0, w.ctx);
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_BAD_SIGNATURE');
  });

  it('assinada por outra chave é REJECTED / E_BAD_SIGNATURE', () => {
    const intruso = dmKeypair('mallory');
    const r = dmFoldRecord(w.state(), dmHello(w, w.lo, { signWith: intruso.secretKey }), 'lo', 0, w.ctx);
    assert.equal(r.reason, 'E_BAD_SIGNATURE');
  });

  it('vem antes do estágio 5: assinatura ruim ganha de authorSeq errado', () => {
    const rec = dmHello(w, w.lo, { authorSeq: 9, corruptSig: true });
    assert.equal(dmFoldRecord(w.state(), rec, 'lo', 0, w.ctx).reason, 'E_BAD_SIGNATURE');
  });
});

describe('§31.7.3 estágio 5 — RD-3, authorSeq === index + 1', () => {
  const w = dmWorld();

  it('desvio é REJECTED / E_VALIDATION.authorSeq e marca o LADO invalid', () => {
    const s = aberta(w);
    const rec = dmRecord(w, w.lo, { kind: 'dm.message', authorSeq: 5, ack: 1, payload: { content: 'oi' } });
    const r = dmFoldRecord(s, rec, 'lo', 1, w.ctx);
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_VALIDATION');
    assert.equal(r.field, 'authorSeq');
    assert.equal(r.next.sides.lo.invalid, true);
    assert.equal(r.next.sides.hi.invalid, false, 'o outro lado não é afetado');
  });
});

describe('§31.7.3 estágio 6 — RD-1/RD-2, a forma da gênese', () => {
  const w = dmWorld();

  it('índice 0 que não é dm.hello marca o lado invalid', () => {
    const rec = dmRecord(w, w.lo, { kind: 'dm.message', authorSeq: 1, ack: 0, payload: { content: 'oi' } });
    const r = dmFoldRecord(w.state(), rec, 'lo', 0, w.ctx);
    assert.equal(r.reason, 'E_GENESIS_MISPLACED');
    assert.equal(r.next.sides.lo.invalid, true);
  });

  it('índice 0 com ack ≠ 0 marca o lado invalid', () => {
    const r = dmFoldRecord(w.state(), dmHello(w, w.lo, { ack: 3 }), 'lo', 0, w.ctx);
    assert.equal(r.reason, 'E_GENESIS_MISPLACED');
    assert.equal(r.next.sides.lo.invalid, true);
  });

  it('RD-2 — dm.hello fora do índice 0 é REJECTED SEM marcar invalid', () => {
    const s = aberta(w);
    const rec = dmHello(w, w.lo, { authorSeq: 2, ack: 1 });
    const r = dmFoldRecord(s, rec, 'lo', 1, w.ctx);
    assert.equal(r.reason, 'E_GENESIS_MISPLACED');
    assert.equal(r.next.sides.lo.invalid, false);
  });
});

describe('§31.7.3 estágio 7 — o lado invalid é absorvente, e só ele', () => {
  const w = dmWorld();

  it('a partir do desvio, todo registro daquele lado é REJECTED — e o outro segue legível', () => {
    let s = aberta(w);
    // `lo` reescreve o core: `authorSeq` fora de RD-3 no índice 1.
    s = dmFoldRecord(
      s,
      dmRecord(w, w.lo, { kind: 'dm.message', authorSeq: 7, ack: 1, payload: { content: 'x' } }),
      'lo',
      1,
      w.ctx,
    ).next;
    assert.equal(s.sides.lo.invalid, true);

    const depois = dmFoldRecord(
      s,
      dmRecord(w, w.lo, { kind: 'dm.message', authorSeq: 3, ack: 1, payload: { content: 'y' } }),
      'lo',
      2,
      w.ctx,
    );
    assert.equal(depois.decision, 'REJECTED');
    assert.equal(depois.reason, 'E_VALIDATION');

    const outro = dmFoldRecord(
      depois.next,
      dmRecord(w, w.hi, { kind: 'dm.message', authorSeq: 2, ack: 1, payload: { content: 'z' } }),
      'hi',
      1,
      w.ctx,
    );
    assert.equal(outro.decision, 'APPLIED', 'RD-1: o outro lado NÃO é afetado');
  });
});

describe('§31.7.3 estágio 8 — a AEAD', () => {
  const w = dmWorld();

  it('AEAD que não abre é REJECTED / E_BAD_SIGNATURE, não E_MALFORMED', () => {
    const s = aberta(w);
    const rec = dmRecord(w, w.lo, {
      kind: 'dm.message',
      authorSeq: 2,
      ack: 1,
      contentKey: Buffer.alloc(32, 7),
      payload: { content: 'oi' },
    });
    const r = dmFoldRecord(s, rec, 'lo', 1, w.ctx);
    assert.equal(r.decision, 'REJECTED');
    assert.equal(
      r.reason,
      'E_BAD_SIGNATURE',
      'a AEAD falhar é falha de autenticidade, não de sintaxe',
    );
  });

  it('vem depois do estágio 7: o lado invalid recusa antes de tentar abrir', () => {
    let s = aberta(w);
    s = dmFoldRecord(
      s,
      dmRecord(w, w.lo, { kind: 'dm.message', authorSeq: 9, ack: 1, payload: { content: 'x' } }),
      'lo',
      1,
      w.ctx,
    ).next;
    const rec = dmRecord(w, w.lo, {
      kind: 'dm.message',
      authorSeq: 3,
      ack: 1,
      contentKey: Buffer.alloc(32, 7),
      payload: { content: 'oi' },
    });
    assert.equal(dmFoldRecord(s, rec, 'lo', 2, w.ctx).reason, 'E_VALIDATION');
  });
});

describe('§31.7.3 estágio 10 — limites de campo (§31.7.5)', () => {
  const w = dmWorld();

  it('content vazio e content acima de 4000 code points são REJECTED / E_VALIDATION.content', () => {
    const s = aberta(w);
    for (const conteudo of ['', texto(4001)]) {
      const rec = dmRecord(w, w.lo, {
        kind: 'dm.message',
        authorSeq: 2,
        ack: 1,
        payload: { content: conteudo },
      });
      const r = dmFoldRecord(s, rec, 'lo', 1, w.ctx);
      assert.equal(r.decision, 'REJECTED');
      assert.equal(r.reason, 'E_VALIDATION');
      assert.equal(r.field, 'content');
    }
  });

  it('registro SEM anexo acima de MAX_ENVELOPE_BYTES é REJECTED / E_PAYLOAD_TOO_LARGE', () => {
    const s = aberta(w);
    // Um registro grande sem anexo: o estágio 0 (64 KiB) não pega, e o teto condicional de
    // §31.7.5 (32 KiB, "registro **sem** anexo") pega — antes de qualquer limite de campo.
    const rec = dmRecord(w, w.lo, {
      kind: 'dm.message',
      authorSeq: 2,
      ack: 1,
      payload: { content: 'oi', replyToId: 'x'.repeat(40000) },
    });
    assert.ok(rec.length > DM_MAX_ENVELOPE_BYTES);
    assert.ok(rec.length < DM_MAX_ENVELOPE_BYTES_ATTACHMENT);
    const r = dmFoldRecord(s, rec, 'lo', 1, w.ctx);
    assert.equal(r.reason, 'E_PAYLOAD_TOO_LARGE');
  });
});

describe('§31.7.3 estágio 12 — efeitos e avanço do DmState', () => {
  const w = dmWorld();

  it('dm.message APPLIED emite upsert em dm_messages e notify de dm.appended', () => {
    const s = aberta(w);
    const r = dmFoldRecord(
      s,
      dmRecord(w, w.lo, { kind: 'dm.message', authorSeq: 2, ack: 1, payload: { content: 'oi' } }),
      'lo',
      1,
      w.ctx,
    );
    assert.equal(r.decision, 'APPLIED');
    assert.ok(typeof r.messageId === 'string' && r.messageId.startsWith('dmsg-'));
    const upsert = r.effects.find((e) => e.t === 'upsert' && e.table === 'dm_messages');
    assert.ok(upsert !== undefined);
    assert.ok(r.effects.some((e) => e.t === 'notify' && e.topic === 'dm.appended'));
    assert.equal(r.next.messages.size, 1);
  });

  it('o DmState não tem members, roles, channels, invites nem cota', () => {
    const s = aberta(w) as unknown as Record<string, unknown>;
    for (const ausente of ['members', 'roles', 'channels', 'categories', 'invites', 'relays', 'lastAuthorSeq']) {
      assert.equal(s[ausente], undefined, `§31.7.2: \`${ausente}\` não existe no DmState`);
    }
  });
});

describe('§31.7.3 — o estágio final roda em TODO desfecho', () => {
  const w = dmWorld();

  it('um registro recusado queima o número: ordSum, length, lastAck e lastTs avançam', () => {
    const s = aberta(w);
    const antes = s.sides.lo;
    const rec = dmRecord(w, w.lo, {
      kind: 'dm.message',
      authorSeq: 2,
      ack: 4,
      ts: DM_T0 + 5000,
      payload: { content: '' }, // recusado no estágio 10
    });
    const r = dmFoldRecord(s, rec, 'lo', 1, w.ctx);
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.next.sides.lo.length, 2);
    assert.equal(r.next.sides.lo.lastAuthorSeq, 2);
    assert.equal(r.next.sides.lo.lastAck, 4);
    assert.equal(r.next.sides.lo.lastTs, DM_T0 + 5000);
    assert.equal(r.next.interpretedOrdSum, 1 + 1 + 4);
    assert.ok(r.next.sides.lo.length > antes.length);
  });

  it('o desfecho não-APPLIED não toca em `messages`', () => {
    let s = aberta(w);
    s = dmFoldRecord(
      s,
      dmRecord(w, w.lo, { kind: 'dm.message', authorSeq: 2, ack: 1, payload: { content: 'oi' } }),
      'lo',
      1,
      w.ctx,
    ).next;
    const r = dmFoldRecord(
      s,
      dmRecord(w, w.lo, { kind: 'dm.message', authorSeq: 3, ack: 1, payload: { content: '' } }),
      'lo',
      2,
      w.ctx,
    );
    assert.equal(r.next.messages, s.messages, 'mesma referência: copy-on-write não copiou');
  });
});

describe('§31.7.3 — não existe estágio de autorização', () => {
  it('os dois lados escrevem sem permissão, cargo, membresia ou cota', () => {
    const w = dmWorld();
    let s = aberta(w);
    const metrics = newDmMetrics();
    const resultados: DmFoldResult[] = [];
    for (let i = 1; i <= 40; i++) {
      const lado = i % 2 === 0 ? w.lo : w.hi;
      const idx = Math.floor((i - 1) / 2) + 1;
      const r = dmFoldRecord(
        s,
        dmRecord(w, lado, {
          kind: 'dm.message',
          authorSeq: idx + 1,
          ack: idx,
          payload: { content: `m${i}` },
        }),
        lado.origin,
        idx,
        w.ctx,
        metrics,
      );
      resultados.push(r);
      s = r.next;
    }
    assert.equal(metrics.applied, 40, 'nenhuma recusa por cota: R-15 não tem análogo (§31.18)');
    assert.equal(resultados.filter((r) => r.decision !== 'APPLIED').length, 0);
  });
});
