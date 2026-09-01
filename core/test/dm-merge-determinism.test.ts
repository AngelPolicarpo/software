/**
 * §31.6 — a ordem canônica, e o critério 1 de G14 (§31.26): dois nós com os mesmos dois logs,
 * chegando em ordens de replicação diferentes, produzem o mesmo estado.
 *
 * A propriedade que dá isso é estrutural, não estatística: `ordKey(r)` é função só do próprio
 * registro e da sua posição no próprio log, então **um registro nunca muda de chave**. A
 * ordem de entrega não é entrada da função — a entrada é o par de logs. Este arquivo é o
 * ensaio do gate; o gate mede a mesma coisa com hash de dump da projeção.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareOrdKey,
  dmFoldLogs,
  dmFoldRecord,
  mergeOrder,
  mergeRecords,
  ordSumOf,
  type DmOrdRef,
  type DmState,
} from '../src/l1/dmFold/index.ts';

import { dmHello, dmRecord, dmWorld, type DmSide, type DmWorld } from './helpers/dm.ts';

/** Um par de logs: a gênese de cada lado mais `n` mensagens alternadas, com `ack` verdadeiro. */
function logs(w: DmWorld, roteiro: readonly { side: 'lo' | 'hi'; ack: number }[]) {
  const lo: Buffer[] = [dmHello(w, w.lo)];
  const hi: Buffer[] = [dmHello(w, w.hi)];
  for (const [i, passo] of roteiro.entries()) {
    const side: DmSide = passo.side === 'lo' ? w.lo : w.hi;
    const destino = passo.side === 'lo' ? lo : hi;
    destino.push(
      dmRecord(w, side, {
        kind: 'dm.message',
        authorSeq: destino.length + 1,
        ack: passo.ack,
        payload: { content: `m${i}` },
      }),
    );
  }
  return { lo, hi };
}

/** Uma leitura estável do estado, para comparar dois nós sem depender de identidade de objeto. */
function retrato(s: DmState): string {
  const msgs = [...s.messages.entries()]
    .map(([id, m]) => ({
      id,
      ordSum: m.ordSum,
      author: m.author.toString('hex'),
      deletedAt: m.deletedAt ?? null,
      editedAt: m.editedAt ?? null,
      replyToId: m.replyToId ?? null,
      hasAttachment: m.hasAttachment,
      reactions: [...m.reactionEmojis].sort(),
    }))
    .sort((a, b) => (a.ordSum - b.ordSum) || a.id.localeCompare(b.id));
  const lado = (o: 'lo' | 'hi') => {
    const x = s.sides[o];
    return {
      identity: x.identityKey.toString('hex'),
      coreKey: x.coreKey?.toString('hex') ?? null,
      displayName: x.displayName,
      avatarColor: x.avatarColor,
      length: x.length,
      lastAuthorSeq: x.lastAuthorSeq,
      lastAck: x.lastAck,
      lastTs: x.lastTs,
      invalid: x.invalid,
      blobsCoreKey: x.blobsCoreKey?.toString('hex') ?? null,
    };
  };
  return JSON.stringify({
    interpretedOrdSum: s.interpretedOrdSum,
    dmVersionSeen: s.dmVersionSeen,
    partialInterpretation: s.partialInterpretation,
    lo: lado('lo'),
    hi: lado('hi'),
    msgs,
  });
}

describe('§31.6 — a chave de ordem', () => {
  it('ordSum é índice + 1 + ack, nos dois lados', () => {
    assert.equal(ordSumOf(0, 0), 1);
    assert.equal(ordSumOf(3, 7), 11);
  });

  it('o desempate é pela chave do autor, e `lo` sempre vence', () => {
    const a: DmOrdRef = { origin: 'lo', index: 5, ordSum: 9 };
    const b: DmOrdRef = { origin: 'hi', index: 2, ordSum: 9 };
    assert.ok(compareOrdKey(a, b) < 0);
    assert.ok(compareOrdKey(b, a) > 0);
  });

  it('RD-4 garante ordSum estritamente crescente dentro de cada log', () => {
    // `ack` cru fora de ordem: o clamp do planejador é o mesmo do `dmFold`.
    const ordem = mergeOrder([0, 5, 2, 9], [], );
    const lo = ordem.filter((r) => r.origin === 'lo');
    for (let i = 1; i < lo.length; i++) {
      const anterior = lo[i - 1];
      const atual = lo[i];
      assert.ok(anterior !== undefined && atual !== undefined);
      assert.ok(atual.ordSum > anterior.ordSum, `${atual.ordSum} > ${anterior.ordSum}`);
    }
  });

  it('a saída do merge está em ordKey ascendente — é um merge, não uma ordenação', () => {
    const ordem = mergeOrder([0, 1, 2, 3, 4], [0, 1, 2]);
    for (let i = 1; i < ordem.length; i++) {
      const a = ordem[i - 1];
      const b = ordem[i];
      assert.ok(a !== undefined && b !== undefined);
      assert.ok(compareOrdKey(a, b) < 0);
    }
  });

  it('cabeçalho ilegível não tira o registro da ordem: ele herda o ack anterior', () => {
    const ordem = mergeOrder([0, null, null], []);
    assert.deepEqual(
      ordem.map((r) => r.ordSum),
      [1, 2, 3],
    );
  });
});

describe('§31.26 critério 1 — determinismo do merge sob ordens de entrega permutadas', () => {
  const roteiro = [
    { side: 'lo' as const, ack: 1 },
    { side: 'hi' as const, ack: 2 },
    { side: 'hi' as const, ack: 2 },
    { side: 'lo' as const, ack: 3 },
    { side: 'lo' as const, ack: 3 },
    { side: 'hi' as const, ack: 4 },
  ];

  it('a ordem canônica é função do par de logs, não da ordem de chegada', () => {
    const w = dmWorld();
    const { lo, hi } = logs(w, roteiro);
    const referencia = mergeRecords(lo, hi);

    // Entregar por prefixos crescentes, em qualquer intercalação, produz a mesma ordem final.
    for (let corte = 0; corte <= lo.length; corte++) {
      const parcial = mergeRecords(lo.slice(0, corte), hi);
      const completo = mergeRecords(lo, hi);
      assert.deepEqual(completo, referencia);
      // O prefixo é um subconjunto da ordem final, com os mesmos ordSum.
      for (const r of parcial) {
        const igual = referencia.find((x) => x.origin === r.origin && x.index === r.index);
        assert.ok(igual !== undefined);
        assert.equal(igual.ordSum, r.ordSum, 'um registro NUNCA muda de chave');
      }
    }
  });

  it('dois nós com os mesmos logs chegam ao mesmo estado', () => {
    const w = dmWorld();
    const { lo, hi } = logs(w, roteiro);
    const a = dmFoldLogs(w.state(), lo, hi, w.ctx);
    const b = dmFoldLogs(w.state(), lo, hi, w.ctx);
    assert.equal(retrato(a.state), retrato(b.state));
    assert.equal(a.results.filter((r) => r.decision !== 'APPLIED').length, 0);
  });

  it('a inserção retroativa reordena, e a reinterpretação converge para o mesmo estado', () => {
    const w = dmWorld();
    const { lo, hi } = logs(w, roteiro);

    // O nó A recebeu `hi` inteiro só no fim: interpretou `lo` sozinho e depois reinterpretou.
    const soLo = dmFoldLogs(w.state(), lo, [], w.ctx);
    const reinterpretado = dmFoldLogs(w.state(), lo, hi, w.ctx);
    const completo = dmFoldLogs(w.state(), lo, hi, w.ctx);

    assert.notEqual(retrato(soLo.state), retrato(completo.state), 'a chegada muda a história');
    assert.equal(
      retrato(reinterpretado.state),
      retrato(completo.state),
      '§31.13: reinterpretar do início converge para o mesmo estado',
    );
  });

  it('registros hostis no meio não mudam a ordem dos registros bons', () => {
    const w = dmWorld();
    const { lo, hi } = logs(w, roteiro);
    const referencia = dmFoldLogs(w.state(), lo, hi, w.ctx);
    const ordemBoa = referencia.order.map((r) => `${r.origin}:${r.index}:${r.ordSum}`);

    // Um envelope de outra conversa, um kind desconhecido e lixo puro, todos no log de `hi`.
    const outra = dmWorld('carol', 'dave');
    const sujo = [
      ...hi,
      dmRecord(w, w.hi, {
        kind: 'dm.message',
        authorSeq: hi.length + 1,
        ack: 4,
        conversationKey: outra.conversationKey,
        payload: { content: 'intruso' },
      }),
      Buffer.from([9, 9, 9]),
    ];
    const comLixo = dmFoldLogs(w.state(), lo, sujo, w.ctx);
    const ordemSuja = comLixo.order
      .filter((r) => !(r.origin === 'hi' && r.index >= hi.length))
      .map((r) => `${r.origin}:${r.index}:${r.ordSum}`);
    assert.deepEqual(ordemSuja, ordemBoa);
  });
});

describe('§31.6 — causalidade', () => {
  it('uma resposta nunca aparece antes do que ela responde', () => {
    const w = dmWorld();
    let s = w.state();
    s = dmFoldRecord(s, dmHello(w, w.lo), 'lo', 0, w.ctx).next;
    s = dmFoldRecord(s, dmHello(w, w.hi), 'hi', 0, w.ctx).next;

    const pergunta = dmFoldRecord(
      s,
      dmRecord(w, w.lo, { kind: 'dm.message', authorSeq: 2, ack: 1, payload: { content: 'pergunta' } }),
      'lo',
      1,
      w.ctx,
    );
    assert.equal(pergunta.decision, 'APPLIED');
    assert.ok(typeof pergunta.messageId === 'string');

    // `hi` responde tendo interpretado os 2 registros de `lo`: ack = 2.
    const resposta = dmFoldRecord(
      pergunta.next,
      dmRecord(w, w.hi, {
        kind: 'dm.message',
        authorSeq: 2,
        ack: 2,
        payload: { content: 'resposta', replyToId: pergunta.messageId },
      }),
      'hi',
      1,
      w.ctx,
    );
    assert.equal(resposta.decision, 'APPLIED');
    assert.ok(resposta.ordSum > pergunta.ordSum, 'V(r) ≤ V(s) e as duas não são iguais');
  });
});
