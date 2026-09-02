/**
 * `dmProjector` — §31.12 (persistência), §31.13 (reinterpretação por inserção retroativa),
 * §31.16.2 (eventos), sob §10.5/§10.6/§10.7.
 *
 * **O teste que fecha o item é o oráculo que G14 usou:** a projeção precisa ser igual à que
 * sai de um nó que recebeu os dois logs inteiros de uma vez — hash de dump idêntico —, depois
 * de inserção retroativa, com snapshot e sem, e com `fold_build_id` trocado.
 *
 * Um oráculo que não pudesse falhar não mediria nada, e por isso cada cenário de
 * reinterpretação vem com o seu **contrafactual**: um nó que recebeu os mesmos blocos na
 * mesma ordem e **não** reinterpretou. O corpus é escolhido para que os dois divirjam — uma
 * reação cujo alvo chega depois muda de `REJECTED` para `APPLIED`, e a linha de
 * `dm_rejected_records` que a primeira leitura escreveu precisa **sumir**.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { dmDumpHash, dmDumpText, openViewDb } from '../src/l0/view/index.ts';
import { dmFoldLogs, dmFoldRecord, type DmState } from '../src/l1/dmFold/index.ts';
import { DmProjector } from '../src/l1/dmProjector/index.ts';
import { loadDmSnapshot } from '../src/l1/dmProjector/snapshot.ts';

import { dmHello, dmRecord, dmWorld, type DmWorld } from './helpers/dm.ts';
import {
  DM_BUILD_A,
  DM_BUILD_B,
  harness,
  projetor,
  referencia,
  tempDirDm,
  type DmHarness,
} from './helpers/dmProjector.ts';

// ─── Corpus ──────────────────────────────────────────────────────────────────────────────

/**
 * O par de logs do empate: a mensagem de `lo` e a reação de `hi` têm o **mesmo** `ordSum`, e
 * o desempate de §31.6 (chave do autor, `lo` primeiro) é o que decide a ordem.
 *
 * Escolhido assim de propósito: se `hi` chegar antes, a reação é interpretada sem alvo e vira
 * `REJECTED` com linha em `dm_rejected_records`; quando a mensagem de `lo` chega, ela se
 * insere **antes** dela — retroativa por desempate, não por `ordSum` menor —, e a
 * reinterpretação precisa transformar a recusa em reação aplicada. Um projetor que comparasse
 * só `ordSum` não veria inserção nenhuma aqui.
 */
function corpusEmpate(w: DmWorld): { lo: Buffer[]; hi: Buffer[]; messageId: string } {
  const msg = dmRecord(w, w.lo, {
    kind: 'dm.message',
    authorSeq: 2,
    ack: 0,
    payload: { content: 'oi' },
  });
  const lo = [dmHello(w, w.lo), msg];
  const idDaMensagem = idDe(w, lo, []);
  const hi = [
    dmHello(w, w.hi),
    dmRecord(w, w.hi, {
      kind: 'dm.react',
      authorSeq: 2,
      ack: 0,
      payload: { messageId: idDaMensagem, emoji: '👍', present: true },
    }),
  ];
  return { lo, hi, messageId: idDaMensagem };
}

/** O id que o `dmFold` deriva para a única mensagem de um par de logs (§31.4). */
function idDe(w: DmWorld, lo: readonly Uint8Array[], hi: readonly Uint8Array[]): string {
  const r = dmFoldLogs(w.state(), lo, hi, w.ctx);
  const id = r.results.find((x) => x.messageId !== undefined)?.messageId;
  assert.ok(id !== undefined, 'o corpus precisa ter uma mensagem aplicada');
  return id;
}

/**
 * O par de logs longo: `lo` escreve seis registros sem reconhecer nada, `hi` escreve dois que
 * reconhecem o primeiro. Os de `hi` caem **no meio** da ordem de `lo` (`ordSum` 3 e 4 contra
 * 2..7), que é o caso em que o snapshot de §31.13 tem alguma chance de servir.
 */
function corpusMeio(w: DmWorld): { lo: Buffer[]; hi: Buffer[] } {
  const lo: Buffer[] = [dmHello(w, w.lo)];
  for (let i = 0; i < 5; i++) {
    lo.push(
      dmRecord(w, w.lo, {
        kind: 'dm.message',
        authorSeq: lo.length + 1,
        ack: 0,
        payload: { content: `lo-${i}` },
      }),
    );
  }
  const hi: Buffer[] = [dmHello(w, w.hi)];
  for (let i = 0; i < 2; i++) {
    hi.push(
      dmRecord(w, w.hi, {
        kind: 'dm.message',
        authorSeq: hi.length + 1,
        ack: 1,
        payload: { content: `hi-${i}` },
      }),
    );
  }
  return { lo, hi };
}

/** Leitura estável do `DmState`, para comparar o estado em memória com o do `dmFoldLogs`. */
function retrato(s: DmState): string {
  const lado = (o: 'lo' | 'hi'): unknown => {
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
    };
  };
  return JSON.stringify({
    interpretedOrdSum: s.interpretedOrdSum,
    dmVersionSeen: s.dmVersionSeen,
    partialInterpretation: s.partialInterpretation,
    lo: lado('lo'),
    hi: lado('hi'),
    msgs: [...s.messages.entries()]
      .map(([id, m]) => ({
        id,
        ordSum: m.ordSum,
        deletedAt: m.deletedAt ?? null,
        editedAt: m.editedAt ?? null,
        reactions: [...m.reactionEmojis].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

function fechar(...hs: DmHarness[]): void {
  for (const h of hs) h.close();
}

// ─── §31.12 — a projeção de um lote ──────────────────────────────────────────────────────

describe('§31.12 — projeção de um lote', () => {
  it('as quatro tabelas de conteúdo saem dos DmEffect, na ordem', async () => {
    const w = dmWorld();
    const { lo, hi, messageId } = corpusEmpate(w);
    const h = harness(w);
    try {
      h.cores.lo.push(...lo);
      h.cores.hi.push(...hi);
      await projetor(h).boot();

      const msg = h.view
        .prepare('SELECT * FROM dm_messages WHERE conversation_id = ?')
        .all(w.conversationId) as Array<Record<string, unknown>>;
      assert.equal(msg.length, 1);
      assert.equal(msg[0]?.id, messageId);
      assert.equal(msg[0]?.content, 'oi');
      assert.equal(msg[0]?.ord_sum, 2);

      const react = h.view
        .prepare('SELECT * FROM dm_reactions WHERE conversation_id = ?')
        .all(w.conversationId) as Array<Record<string, unknown>>;
      assert.equal(react.length, 1, 'a reação chegou depois da mensagem e foi aplicada');
      assert.equal(react[0]?.emoji, '👍');

      // §31.12 — `length`/`invalid` são estado de lado, materializados pelo projetor.
      const part = h.view
        .prepare('SELECT identity_key, display_name, length, invalid FROM dm_participants WHERE conversation_id = ? ORDER BY identity_key')
        .all(w.conversationId) as Array<{ display_name: string; length: number; invalid: number }>;
      assert.equal(part.length, 2);
      assert.deepEqual(part.map((p) => p.length).sort(), [2, 2]);
      assert.deepEqual(part.map((p) => p.invalid), [0, 0]);
      assert.deepEqual(part.map((p) => p.display_name).sort(), ['nome-hi', 'nome-lo']);
    } finally {
      fechar(h);
    }
  });

  it('o estado em memória é o do dmFoldLogs — o projetor não interpreta nada por conta', async () => {
    const w = dmWorld();
    const { lo, hi } = corpusMeio(w);
    const h = harness(w);
    try {
      h.cores.lo.push(...lo);
      h.cores.hi.push(...hi);
      const p = projetor(h);
      await p.boot();
      assert.equal(retrato(p.state), retrato(dmFoldLogs(w.state(), lo, hi, w.ctx).state));
    } finally {
      fechar(h);
    }
  });

  it('meta.dm_interpreted carrega as três coordenadas do último lote commitado', async () => {
    const w = dmWorld();
    const { lo, hi } = corpusMeio(w);
    const h = harness(w);
    try {
      h.cores.lo.push(...lo);
      h.cores.hi.push(...hi);
      const p = projetor(h);
      await p.boot();
      assert.deepEqual(h.view.dmInterpretedMarker(w.conversationId), {
        ordSum: p.state.interpretedOrdSum,
        loLength: lo.length,
        hiLength: hi.length,
      });
    } finally {
      fechar(h);
    }
  });

  it('dm_rejected_records: kind é NULL exatamente quando o cabeçalho não decodificou', async () => {
    const w = dmWorld();
    const h = harness(w);
    try {
      // `lo`: gênese boa, depois um envelope que não decodifica (IGNORED, estágio 1) e um
      // registro de outra conversa (REJECTED, estágio 2 — o cabeçalho decodificou).
      const outra = dmWorld('carol', 'dave');
      h.cores.lo.push(
        dmHello(w, w.lo),
        Buffer.from('nao é envelope nenhum'),
        dmRecord(w, w.lo, {
          kind: 'dm.message',
          authorSeq: 3,
          ack: 0,
          conversationKey: outra.conversationKey,
          payload: { content: 'x' },
        }),
      );
      h.cores.hi.push(dmHello(w, w.hi));
      await projetor(h).boot();

      const linhas = h.view
        .prepare('SELECT origin, idx, kind, reason FROM dm_rejected_records WHERE conversation_id = ? ORDER BY idx')
        .all(w.conversationId) as Array<{ origin: string; idx: number; kind: number | null; reason: string }>;
      assert.deepEqual(
        linhas.map((l) => [l.origin, l.idx, l.kind === null, l.reason]),
        [
          ['lo', 1, true, 'E_MALFORMED'],
          ['lo', 2, false, 'E_WRONG_COMMUNITY'],
        ],
      );
    } finally {
      fechar(h);
    }
  });

  it('§10.5 passo 6 — buraco de replicação para o lote, e não consome o outro lado', async () => {
    const w = dmWorld();
    const { lo, hi } = corpusMeio(w);
    const h = harness(w);
    try {
      // `lo` tem um buraco no índice 1: o `length` conta, o bloco não está lá.
      h.cores.lo.push(lo[0] as Uint8Array, null);
      h.cores.hi.push(...hi);
      const p = projetor(h);
      await p.boot();
      // A gênese de `hi` (`ordSum` 1) passa: o piso de RD-4 para o bloco que falta em `lo` é
      // `ordSum` 2, e nada que chegue depois pode se inserir antes dela. Os outros registros
      // de `hi` (`ordSum` 3 e 4) ficam atrás da barreira.
      assert.equal(p.state.sides.lo.length, 1);
      assert.equal(p.state.sides.hi.length, 1);

      h.cores.lo.fill(1, lo[1] as Uint8Array);
      await p.catchUp();
      assert.equal(p.state.sides.lo.length, 2);
      assert.equal(p.state.sides.hi.length, 3, 'com o buraco preenchido, os dois lados andam');
    } finally {
      fechar(h);
    }
  });
});

// ─── §31.13 — o oráculo da reinterpretação ───────────────────────────────────────────────

describe('§31.13 — inserção retroativa: a projeção é função do par de logs', () => {
  it('empate de ordSum desempatado por autor: a recusa vira reação, e o hash bate', async () => {
    const w = dmWorld();
    const { lo, hi } = corpusEmpate(w);
    const { hash: esperado, h: ref } = await referencia(w, lo, hi);

    // Chegada fora de ordem: `hi` inteiro primeiro, `lo` depois.
    const h = harness(w);
    try {
      h.cores.hi.push(...hi);
      const p = projetor(h);
      await p.boot();
      p.start();

      // Contrafactual: sem a mensagem, a reação é recusada e a linha de diagnóstico existe.
      const antes = h.view
        .prepare('SELECT COUNT(*) AS n FROM dm_rejected_records WHERE conversation_id = ?')
        .get(w.conversationId) as { n: number };
      assert.equal(antes.n, 1, 'a reação sem alvo é recusada — é isto que a reinterpretação desfaz');
      assert.notEqual(h.hash(), esperado, 'o oráculo precisa poder falhar');

      h.cores.lo.push(...lo);
      await p.catchUp();

      assert.equal(h.hash(), esperado, dmDumpText(h.view, w.conversationId));
      const sobrou = h.view
        .prepare('SELECT COUNT(*) AS n FROM dm_rejected_records WHERE conversation_id = ?')
        .get(w.conversationId) as { n: number };
      assert.equal(sobrou.n, 0, 'a linha de recusa antiga precisa SUMIR, não sobreviver');
      assert.equal(retrato(p.state), retrato(dmFoldLogs(w.state(), lo, hi, w.ctx).state));
    } finally {
      fechar(h, ref);
    }
  });

  it('dm.reordered{fromOrdSum} sai DEPOIS do commit, com a projeção já corrente', async () => {
    const w = dmWorld();
    const { lo, hi } = corpusEmpate(w);
    const { hash: esperado, h: ref } = await referencia(w, lo, hi);
    const h = harness(w);
    try {
      let hashNoEvento: string | null = null;
      const p = projetor(h, {
        onEvent: (evs) => {
          h.eventos.push(...evs);
          if (evs.some((e) => e.topic === 'dm.reordered')) hashNoEvento = h.hash();
        },
      });
      h.cores.hi.push(...hi);
      await p.boot();
      h.cores.lo.push(...lo);
      await p.catchUp();

      const ev = h.eventos.filter((e) => e.topic === 'dm.reordered');
      assert.equal(ev.length, 1);
      // O ponto de inserção é a **gênese** de `lo` (`ordSum` 1), não a mensagem: quando o log
      // de `lo` chega inteiro, o primeiro registro dele já precede tudo o que `hi` escreveu.
      assert.deepEqual(ev[0]?.data, { conversationId: w.conversationId, fromOrdSum: 1 });
      // §10.7 — evento é sinal, e quem o recebe precisa achar no banco o que ele anuncia.
      assert.equal(hashNoEvento, esperado);
    } finally {
      fechar(h, ref);
    }
  });

  it('ACHADO-G14-03 — com snapshot e sem, a reinterpretação converge para o mesmo hash', async () => {
    const w = dmWorld();
    const { lo, hi } = corpusMeio(w);
    const { hash: esperado, h: ref } = await referencia(w, lo, hi);
    const abertos: DmHarness[] = [ref];
    try {
      for (const intervalo of [1, 2, 3, 5, Number.MAX_SAFE_INTEGER]) {
        const h = harness(w);
        abertos.push(h);
        const p = projetor(h, { snapshotInterval: intervalo });
        // `lo` inteiro e a gênese de `hi`: a interpretação chega ao fim de `lo`…
        h.cores.lo.push(...lo);
        h.cores.hi.push(hi[0] as Uint8Array);
        await p.boot();
        assert.equal(p.state.interpretedOrdSum, 6);
        // …e então os registros de `hi` que caem no MEIO da ordem chegam.
        h.cores.hi.push(...hi.slice(1));
        await p.catchUp();
        assert.equal(h.hash(), esperado, `intervalo ${intervalo}: ${dmDumpText(h.view, w.conversationId)}`);
        assert.equal(retrato(p.state), retrato(dmFoldLogs(w.state(), lo, hi, w.ctx).state));
      }
    } finally {
      fechar(...abertos);
    }
  });

  it('o snapshot que deixou de ser prefixo da ordem canônica é descartado, não reusado', async () => {
    const w = dmWorld();
    const { lo, hi } = corpusMeio(w);
    const { hash: esperado, h: ref } = await referencia(w, lo, hi);
    const h = harness(w);
    try {
      // Snapshot a cada 5: o único que existe fica em `ordSum` 5 (lo_length 5), depois do
      // ponto de inserção (3). Ele **não** pode ser recarregado.
      const p = projetor(h, { snapshotInterval: 5 });
      h.cores.lo.push(...lo);
      h.cores.hi.push(hi[0] as Uint8Array);
      await p.boot();
      const antes = loadDmSnapshot(h.view, w.conversationId, DM_BUILD_A);
      assert.ok(antes !== null && antes.interpretedOrdSum >= 5, 'o cenário exige snapshot adiante do ponto');

      h.cores.hi.push(...hi.slice(1));
      await p.catchUp();
      assert.equal(h.hash(), esperado, dmDumpText(h.view, w.conversationId));
    } finally {
      fechar(h, ref);
    }
  });

  it('fold_build_id trocado descarta o snapshot e reprojeta do zero (§10.6)', async () => {
    const w = dmWorld();
    const { lo, hi } = corpusMeio(w);
    const { hash: esperado, h: ref } = await referencia(w, lo, hi);
    const dir = tempDirDm();
    try {
      const viewPath = path.join(dir, 'view.db');
      const view = openViewDb(viewPath);
      const cores = harness(w).cores;
      cores.lo.push(...lo);
      cores.hi.push(...hi);

      const a = new DmProjector(view, cores, w.ctx, {
        foldBuildId: DM_BUILD_A,
        snapshotInterval: 2,
        now: () => 1,
      });
      await a.boot();
      assert.equal(dmDumpHash(view, w.conversationId).hash, esperado);
      assert.ok(loadDmSnapshot(view, w.conversationId, DM_BUILD_A) !== null);
      assert.equal(loadDmSnapshot(view, w.conversationId, DM_BUILD_B), null, 'procedência que não bate ⇒ null');

      // Boot com outro binário do `dmFold`: o snapshot não é herdável, e o resultado é o mesmo.
      const b = new DmProjector(view, cores, w.ctx, {
        foldBuildId: DM_BUILD_B,
        snapshotInterval: 2,
        now: () => 1,
      });
      await b.boot();
      assert.equal(dmDumpHash(view, w.conversationId).hash, esperado);
      assert.equal(retrato(b.state), retrato(dmFoldLogs(w.state(), lo, hi, w.ctx).state));
      view.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
      fechar(ref);
    }
  });

  it('reprojetar a conversa do zero dá o mesmo hash — §28.4 teste 1, no escopo de §31.12', async () => {
    const w = dmWorld();
    const { lo, hi } = corpusMeio(w);
    const h = harness(w);
    try {
      h.cores.lo.push(...lo);
      h.cores.hi.push(...hi);
      const p = projetor(h, { snapshotInterval: 2 });
      await p.boot();
      const antes = h.hash();
      await p.reproject();
      assert.equal(h.hash(), antes, dmDumpText(h.view, w.conversationId));
    } finally {
      fechar(h);
    }
  });
});

// ─── §31.7.1 — pânico, e o boot seguinte ─────────────────────────────────────────────────

describe('§31.7.1 — a rede de segurança do dmFold, vista do projetor', () => {
  it('um fold que lança vira IGNORED, marca dm_fold_panic e o boot seguinte reprojeta', async () => {
    const w = dmWorld();
    const { lo, hi } = corpusMeio(w);
    const { hash: esperado, h: ref } = await referencia(w, lo, hi);
    const h = harness(w);
    try {
      h.cores.lo.push(...lo);
      h.cores.hi.push(...hi);
      let panico: { ordSum: number; kind: number | null } | null = null;
      let lancou = false;
      const p = projetor(h, {
        onPanic: (ordSum, kind) => {
          panico = { ordSum, kind };
        },
        fold: (state, rec, origin, index, ctx, metrics) => {
          if (origin === 'lo' && index === 2 && !lancou) {
            lancou = true;
            throw new Error('bug de implementação');
          }
          return dmFoldRecord(state, rec, origin, index, ctx, metrics);
        },
      });
      await p.boot();
      assert.ok(panico !== null, '§31.7.1 — o pânico é contado, nunca engolido');
      // O `fold` injetado lançou para FORA: não há `DmFoldResult`, e portanto não há `kind`.
      assert.equal((panico as { kind: number | null }).kind, null);
      assert.equal(h.view.dmFoldPanicOrdSum(w.conversationId), (panico as { ordSum: number }).ordSum);
      assert.equal(p.metrics.panic, 1);
      // A interpretação **continua**: um bug nunca vira perda de conversa.
      assert.equal(p.state.sides.lo.length, lo.length);

      // O marcador sobrevive ao processo, e o boot seguinte reprojeta (§10.5, §31.12).
      const q = projetor(h);
      await q.boot();
      assert.equal(h.view.dmFoldPanicOrdSum(w.conversationId), null, 'a reprojeção limpa o marcador');
      assert.equal(h.hash(), esperado, dmDumpText(h.view, w.conversationId));
    } finally {
      fechar(h, ref);
    }
  });
});
