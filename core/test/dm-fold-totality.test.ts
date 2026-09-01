/**
 * §31.7.1 e o **critério 2 de G14** (§31.26): totalidade.
 *
 * "Toda entrada — bytes aleatórios, `kind` desconhecido, AEAD que não abre, `ack` absurdo —
 * termina em `APPLIED`, `REJECTED` ou `IGNORED`." Não existe um quarto desfecho, e uma
 * exceção lançada de dentro do `dmFold` é bug de severidade máxima: `panic` precisa ser **0**.
 *
 * Este é o **ensaio** do gate, não o gate. Ele roda no `npm test` com um orçamento que cabe
 * numa suíte de unidade; G14 mede a mesma propriedade com o volume que §28.1 exige. O PRNG é
 * determinístico de propósito: uma falha aqui é reproduzível pela semente.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DM_VERSION } from '../src/l1/dmCodec/index.ts';
import {
  DM_MAX_ENVELOPE_BYTES_ATTACHMENT,
  dmFoldRecord,
  limparPanico,
  newDmMetrics,
  ultimoPanico,
  type DmFoldMetrics,
  type DmOrigin,
  type DmState,
} from '../src/l1/dmFold/index.ts';

import { DM_T0, dmHello, dmKeypair, dmRecord, dmWorld, type DmWorld } from './helpers/dm.ts';

/** PRNG determinístico — a semente é o que torna uma falha reproduzível. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

const DESFECHOS = new Set(['APPLIED', 'REJECTED', 'IGNORED']);

function aberta(w: DmWorld): DmState {
  let s = w.state();
  s = dmFoldRecord(s, dmHello(w, w.lo), 'lo', 0, w.ctx).next;
  s = dmFoldRecord(s, dmHello(w, w.hi), 'hi', 0, w.ctx).next;
  return s;
}

/** O corpus de sabotagens: cada gerador ataca um estágio diferente de §31.7.3. */
function corpus(w: DmWorld, next: () => number): Buffer {
  const escolha = next() % 12;
  const lado = next() % 2 === 0 ? w.lo : w.hi;
  const authorSeq = next() % 8;
  const ack = next() % 10_000;
  const ts = next() % 2 === 0 ? 0 : DM_T0 + (next() % 1_000_000) - 500_000;

  switch (escolha) {
    case 0: {
      // Bytes aleatórios puros.
      const n = next() % 400;
      const b = Buffer.alloc(n);
      for (let i = 0; i < n; i++) b[i] = next() & 0xff;
      return b;
    }
    case 1:
      // `DM_VERSION` desconhecida.
      return dmRecord(w, lado, {
        kind: 'dm.message',
        authorSeq,
        ack,
        ts,
        v: (next() % 255) + DM_VERSION + 1,
        payload: { content: 'x' },
      });
    case 2:
      // `kind` fora do catálogo fechado de §31.5.
      return dmRecord(w, lado, {
        kind: 'dm.message',
        authorSeq,
        ack,
        ts,
        kindNumber: 7 + (next() % 60_000),
        payload: { content: 'x' },
      });
    case 3: {
      // Payload truncado: o envelope é válido, os bytes de dentro não casam o layout.
      const rec = dmRecord(w, lado, { kind: 'dm.message', authorSeq, ack, ts, payload: { content: 'x'.repeat(50) } });
      return rec.subarray(0, Math.max(1, rec.length - (next() % 40)));
    }
    case 4:
      // AEAD que não abre: cifrado com outra chave de conteúdo.
      return dmRecord(w, lado, {
        kind: 'dm.message',
        authorSeq,
        ack,
        ts,
        contentKey: Buffer.alloc(32, next() & 0xff),
        payload: { content: 'x' },
      });
    case 5:
      // Assinatura corrompida.
      return dmRecord(w, lado, { kind: 'dm.message', authorSeq, ack, ts, corruptSig: true, payload: { content: 'x' } });
    case 6:
      // Assinada por um terceiro.
      return dmRecord(w, lado, {
        kind: 'dm.message',
        authorSeq,
        ack,
        ts,
        signWith: dmKeypair(`intruso-${next() % 7}`).secretKey,
        payload: { content: 'x' },
      });
    case 7:
      // Envelope de outra conversa (A07).
      return dmRecord(w, lado, {
        kind: 'dm.message',
        authorSeq,
        ack,
        ts,
        conversationKey: Buffer.alloc(32, next() & 0xff),
        payload: { content: 'x' },
      });
    case 8:
      // Autor que não é o dono do core.
      return dmRecord(w, lado, {
        kind: 'dm.message',
        authorSeq,
        ack,
        ts,
        author: dmKeypair(`estranho-${next() % 7}`).publicKey,
        payload: { content: 'x' },
      });
    case 9:
      // Referências quebradas: alvo que não existe.
      return dmRecord(w, lado, {
        kind: next() % 2 === 0 ? 'dm.edit' : 'dm.delete',
        authorSeq,
        ack,
        ts,
        payload: { messageId: `dmsg-${'Z'.repeat(next() % 40)}`, content: 'x' },
      } as never);
    case 10:
      // Campos fora dos limites de §31.7.5.
      return dmRecord(w, lado, {
        kind: 'dm.message',
        authorSeq,
        ack,
        ts,
        payload: { content: 'x'.repeat(next() % 9000) },
      });
    default:
      // Gênese fora da forma, e `dm.hello` fora do índice 0.
      return dmHello(w, lado, { authorSeq, ack, ts });
  }
}

describe('§31.26 critério 2 — totalidade sob fuzzer', () => {
  it('60 000 registros hostis, zero pânico, zero desfecho fora dos três', () => {
    limparPanico();
    const w = dmWorld();
    const metrics: DmFoldMetrics = newDmMetrics();
    const next = rng(0x5eed);
    let s = aberta(w);

    for (let i = 0; i < 60_000; i++) {
      const rec = corpus(w, next);
      const origin: DmOrigin = next() % 2 === 0 ? 'lo' : 'hi';
      const index = next() % 5;
      const r = dmFoldRecord(s, rec, origin, index, w.ctx, metrics);
      assert.ok(DESFECHOS.has(r.decision), `desfecho fora dos três: ${r.decision}`);
      assert.ok(Number.isInteger(r.ordSum), 'ordSum é sempre um número');
      assert.ok(r.next !== undefined, 'next existe em todo desfecho');
      if (r.decision !== 'APPLIED') assert.equal(r.effects.length, 0);
      s = r.next;
    }

    assert.equal(metrics.panic, 0, `dmFold.panic ≠ 0 — ${ultimoPanico?.err ?? ''}`);
    assert.equal(ultimoPanico, null);
    assert.equal(metrics.applied + metrics.rejected + metrics.ignored, 60_000);
    // O corpus precisa ter alcançado os três desfechos, senão ele não mede o que promete.
    assert.ok(metrics.rejected > 0 && metrics.ignored > 0);
  });

  it('o registro no teto exato e um byte acima dele são tratados, não explodem', () => {
    const w = dmWorld();
    const s = aberta(w);
    for (const n of [0, 1, DM_MAX_ENVELOPE_BYTES_ATTACHMENT, DM_MAX_ENVELOPE_BYTES_ATTACHMENT + 1]) {
      const r = dmFoldRecord(s, Buffer.alloc(n), 'lo', 1, w.ctx);
      assert.ok(DESFECHOS.has(r.decision));
    }
  });

  it('índice absurdo não quebra o estado nem a contabilidade', () => {
    const w = dmWorld();
    const s = aberta(w);
    for (const index of [0, 1, 1_000_000, Number.MAX_SAFE_INTEGER - 1]) {
      const r = dmFoldRecord(s, Buffer.from([1, 2, 3]), 'lo', index, w.ctx);
      assert.equal(r.decision, 'IGNORED');
      assert.ok(Number.isFinite(r.ordSum));
      assert.equal(r.next.sides.lo.length, Math.max(s.sides.lo.length, index + 1));
    }
  });

  it('a interpretação nunca para: o mesmo registro hostil repetido continua avançando', () => {
    const w = dmWorld();
    let s = aberta(w);
    const antes = s.interpretedOrdSum;
    for (let i = 1; i <= 50; i++) {
      const r = dmFoldRecord(s, Buffer.from([0xff, 0xff]), 'lo', i, w.ctx);
      assert.equal(r.decision, 'IGNORED');
      s = r.next;
    }
    assert.ok(s.interpretedOrdSum > antes, 'sem avanço, o mesmo registro voltaria para sempre');
    assert.equal(s.sides.lo.length, 51);
  });

  it('a janela de ts não cresce com a conversa — ela é do tamanho do atraso', () => {
    // Sem isso, a estrutura que RD-5 exige para `clockSkewed` seria O(conversa) e §31.7.2
    // deixaria de valer.
    const w = dmWorld();
    let s = aberta(w);
    for (let i = 1; i <= 300; i++) {
      const lado = i % 2 === 0 ? w.lo : w.hi;
      const idx = Math.floor((i - 1) / 2) + 1;
      s = dmFoldRecord(
        s,
        dmRecord(w, lado, { kind: 'dm.message', authorSeq: idx + 1, ack: idx, payload: { content: `m${i}` } }),
        lado.origin,
        idx,
        w.ctx,
      ).next;
    }
    assert.ok(s.sides.lo.tsWindow.length <= 4, `janela de lo: ${s.sides.lo.tsWindow.length}`);
    assert.ok(s.sides.hi.tsWindow.length <= 4, `janela de hi: ${s.sides.hi.tsWindow.length}`);
  });
});
