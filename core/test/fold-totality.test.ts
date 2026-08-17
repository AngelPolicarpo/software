/**
 * §8.5 (totalidade) e §28.4 (determinismo) — as duas propriedades que sustentam A02.
 *
 * §8.5: *"o `fold` nunca lança, nunca aborta, nunca para, e não tem estado `degraded` causado
 * por dado. Toda entrada possível — inclusive bytes aleatórios, `kind` desconhecido, payload
 * truncado, referência inexistente, assinatura falsa, ordem impossível — mapeia para
 * `APPLIED`, `REJECTED` ou `IGNORED`."*
 *
 * O fuzzer do gate G1 é de 10⁷ entradas e vive num harness dedicado (`poc/poc-01-fold`); este
 * aqui é a versão de suíte unitária — determinística por semente, alguns milhares de entradas,
 * rodando a cada `npm test`. `CORE_FUZZ_N` aumenta o volume sem mudar a semente.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clearPanic,
  emptyState,
  foldRecord,
  lastPanic,
  newMetrics,
  type DecisionState,
} from '../src/l1/fold/index.ts';
import { KINDS } from '../src/l1/opCodec/index.ts';
import { World, genesis, joinMember, keypairFromSeed, makeRecord, T0 } from './helpers/world.ts';

const N = Number(process.env['CORE_FUZZ_N'] ?? 4000);
const TS = T0 + 100;

/** PRNG determinístico: mesma semente, mesmas entradas — o fuzzer precisa ser reproduzível. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const DESFECHOS = new Set(['APPLIED', 'REJECTED', 'IGNORED']);

/** Um corpus de registros válidos, para servir de base às mutações. */
function corpus(): { rec: Buffer; state: DecisionState }[] {
  const g = genesis();
  const ana = joinMember(g, 'ana');
  const base = g.world.state;
  const out: { rec: Buffer; state: DecisionState }[] = [];
  const mk = <K extends Parameters<typeof makeRecord>[1]['kind']>(o: {
    kind: K;
    author: typeof ana;
    payload: unknown;
  }): void => {
    out.push({
      rec: makeRecord(g.world.core, {
        kind: o.kind,
        author: o.author,
        authorSeq: 50 + out.length,
        hostTs: TS,
        payload: o.payload as never,
      }),
      state: base,
    });
  };
  mk({ kind: 'message.send', author: ana, payload: { channelId: g.channelId, content: 'oi', mentions: [] } });
  mk({ kind: 'message.pin', author: ana, payload: { messageId: 'msg-AAAAAAAAAAAAAAAAAAAAAAAAAA', pinned: true } });
  mk({ kind: 'reaction.set', author: ana, payload: { messageId: 'msg-AAAAAAAAAAAAAAAAAAAAAAAAAA', emoji: '👍', present: true } });
  mk({ kind: 'member.leave', author: ana, payload: {} });
  mk({ kind: 'role.create', author: g.founder, payload: { name: 'Cargo', color: 1, permissions: [3], mentionable: true } });
  mk({ kind: 'channel.create', author: g.founder, payload: { categoryId: g.categoryId, type: 0, name: 'novo', readOnlyForRoleIds: [] } });
  mk({ kind: 'category.delete', author: g.founder, payload: { categoryId: g.categoryId, deleteChannels: true } });
  mk({ kind: 'mod.ban', author: g.founder, payload: { targetKey: ana.publicKey } });
  mk({ kind: 'community.update', author: g.founder, payload: { name: 'Outro nome' } });
  mk({ kind: 'invite.create', author: g.founder, payload: { invitePublicKey: keypairFromSeed('z').publicKey } });
  return out;
}

describe('§8.5 — totalidade sobre entrada hostil', () => {
  it(`${N} registros de bytes aleatórios: nenhum lança, todos caem nos três desfechos`, () => {
    clearPanic();
    const rnd = prng(0xc0ffee);
    const state = emptyState(keypairFromSeed('core').publicKey);
    const metrics = newMetrics();
    for (let i = 0; i < N; i++) {
      const len = Math.floor(rnd() * 400);
      const buf = Buffer.allocUnsafe(len);
      for (let j = 0; j < len; j++) buf[j] = Math.floor(rnd() * 256);
      const r = foldRecord(state, buf, i, metrics);
      assert.ok(DESFECHOS.has(r.decision), `entrada ${i}: ${r.decision}`);
      assert.notEqual(r.next, undefined);
    }
    assert.equal(metrics.panic, 0, `fold.panic ${metrics.panic}: ${lastPanic?.err ?? ''}`);
  });

  it(`${N} mutações de registros válidos: nenhuma lança`, () => {
    clearPanic();
    const rnd = prng(0xbadc0de);
    const base = corpus();
    const metrics = newMetrics();
    for (let i = 0; i < N; i++) {
      const alvo = base[Math.floor(rnd() * base.length)];
      assert.ok(alvo);
      const buf = Buffer.from(alvo.rec);
      // Uma a quatro mutações de byte por entrada: vira assinatura falsa, prefixo de tamanho
      // hostil, `kind` inexistente, payload truncado — sem saber qual, que é o ponto.
      const quantas = 1 + Math.floor(rnd() * 4);
      for (let m = 0; m < quantas && buf.length > 0; m++) {
        const pos = Math.floor(rnd() * buf.length);
        buf[pos] = Math.floor(rnd() * 256);
      }
      const corte = rnd() < 0.2 ? Math.floor(rnd() * buf.length) : buf.length;
      const r = foldRecord(alvo.state, buf.subarray(0, corte), 100 + i, metrics);
      assert.ok(DESFECHOS.has(r.decision), `mutação ${i}: ${r.decision}`);
    }
    assert.equal(metrics.panic, 0, `fold.panic ${metrics.panic}: ${lastPanic?.err ?? ''}`);
  });

  it('prefixo de tamanho hostil não aloca — o custo continua O(entrada)', () => {
    clearPanic();
    const state = emptyState(keypairFromSeed('core').publicKey);
    // `uint` = 2³²−1 anunciando bytes que não existem. Foi o `ACHADO-01` do fuzzer de G1:
    // devolver `Buffer.alloc(n)` com o `n` **pedido** alocava 4 GiB antes de concluir que a
    // entrada é malformada. Não viola a totalidade, mas é negação de serviço trivial.
    const hostil = Buffer.concat([Buffer.from([0xfe, 0xff, 0xff, 0xff, 0xff]), Buffer.alloc(16)]);
    const antes = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200; i++) foldRecord(state, hostil, i);
    const depois = process.memoryUsage().heapUsed;
    assert.ok(depois - antes < 50 * 1024 * 1024, `heap cresceu ${depois - antes} B`);
  });

  it('payload de um `kind` carimbado com o número de **outro** é total nos 38', () => {
    // §28.1 pede exatamente este caso. Os bytes decodificam perfeitamente para o `kind` que os
    // gerou e são lixo estruturado para o `kind` anunciado — que é o formato de um host
    // adversário montando um registro à mão.
    clearPanic();
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const metrics = newMetrics();
    const doadores = [
      { kind: 'message.send' as const, payload: { channelId: g.channelId, content: 'oi', mentions: [] } },
      { kind: 'mod.ban' as const, payload: { targetKey: ana.publicKey } },
      { kind: 'member.leave' as const, payload: {} },
      { kind: 'message.pin' as const, payload: { messageId: 'msg-AAAAAAAAAAAAAAAAAAAAAAAAAA', pinned: true } },
    ];
    let n = 0;
    for (const alvo of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
      for (const doador of doadores) {
        const rec = makeRecord(g.world.core, {
          kind: doador.kind,
          payload: doador.payload as never,
          kindNumber: KINDS[alvo],
          author: ana,
          authorSeq: 100 + n++,
          hostTs: TS,
        });
        const r = foldRecord(g.world.state, rec, 1000 + n, metrics);
        assert.ok(DESFECHOS.has(r.decision), `${doador.kind} → ${alvo}: ${r.decision}`);
      }
    }
    assert.equal(metrics.panic, 0, lastPanic?.err ?? '');
  });

  it('§8.5 item 1: não existe `projector.failed` — o estado de saúde é só `partialInterpretation`', () => {
    const g = genesis();
    const chaves = Object.keys(g.world.state);
    assert.ok(chaves.includes('partialInterpretation'));
    assert.ok(!chaves.some((k) => k.toLowerCase().includes('degraded')));
    assert.ok(!chaves.some((k) => k.toLowerCase().includes('failed')));
  });
});

describe('§28.4 — determinismo', () => {
  /** Roda a mesma história duas vezes e devolve os dois mundos. */
  function duasCorridas(): [World, World] {
    return [0, 1].map(() => {
      const g = genesis();
      const ana = joinMember(g, 'ana');
      const bia = joinMember(g, 'bia');
      g.world.submit({ kind: 'message.send', author: ana, hostTs: TS, payload: { channelId: g.channelId, content: 'oi', mentions: [] } });
      g.world.submit({ kind: 'role.create', author: g.founder, hostTs: TS, payload: { name: 'Mod', color: 1, permissions: [13], mentionable: true } });
      g.world.submit({ kind: 'category.create', author: g.founder, hostTs: TS, payload: { name: 'OUTRA' } });
      g.world.submit({ kind: 'mod.ban', author: g.founder, hostTs: TS, payload: { targetKey: bia.publicKey } });
      g.world.submit({ kind: 'community.update', author: g.founder, hostTs: TS, payload: { name: 'Renomeada' } });
      return g.world;
    }) as [World, World];
  }

  /** Forma canônica do `DS`, com chaves ordenadas — sem isso o blob diverge sem o estado divergir. */
  function canonico(v: unknown): unknown {
    if (v instanceof Map) {
      return { '#map': [...v.entries()].map(([k, x]) => [k, canonico(x)]).sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)) };
    }
    if (v instanceof Set) return { '#set': [...v].map(canonico).sort() };
    if (Buffer.isBuffer(v)) return { '#buf': v.toString('hex') };
    if (Array.isArray(v)) return v.map(canonico);
    if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canonico(o[k])]));
    }
    return v;
  }

  const hash = (v: unknown): string => JSON.stringify(canonico(v));

  it('duas réplicas com o mesmo log chegam ao mesmo `DecisionState`', () => {
    const [a, b] = duasCorridas();
    assert.equal(hash(a.state), hash(b.state));
  });

  it('e à mesma lista de efeitos, na mesma ordem', () => {
    const [a, b] = duasCorridas();
    assert.equal(hash(a.results.map((r) => r.effects)), hash(b.results.map((r) => r.effects)));
  });

  it('e aos mesmos desfechos, registro a registro', () => {
    const [a, b] = duasCorridas();
    assert.deepEqual(
      a.results.map((r) => [r.decision, r.reason]),
      b.results.map((r) => [r.decision, r.reason]),
    );
  });

  it('§10.5 — reprojeção total reconstrói o estado byte a byte', () => {
    const [a] = duasCorridas();
    const re = a.reproject();
    assert.equal(re.results.length, a.results.length);
    assert.equal(hash(re.state), hash(a.state), 'reprojetar divergiu do incremental');
    assert.deepEqual(
      re.results.map((r) => [r.decision, r.reason]),
      a.results.map((r) => [r.decision, r.reason]),
    );
    assert.equal(hash(re.results.map((r) => r.effects)), hash(a.results.map((r) => r.effects)));
  });

  it('a reprojeção reproduz os **mesmos ids** — nenhum é gerado pelo host', () => {
    // Era isto que quebrava a reprojeção determinística em v1: id gerado no momento da
    // aplicação. §7.3 deriva tudo de `(communityId, author, authorSeq)`.
    const [a] = duasCorridas();
    const re = a.reproject();
    assert.deepEqual([...re.state.roles.keys()].sort(), [...a.state.roles.keys()].sort());
    assert.deepEqual([...re.state.messages.keys()].sort(), [...a.state.messages.keys()].sort());
    assert.deepEqual([...re.state.channels.keys()].sort(), [...a.state.channels.keys()].sort());
  });

  it('interpretar o log em dois pedaços dá o mesmo que de uma vez', () => {
    // O `fold` recebe um registro por vez (§8.0) e o `projector` trabalha em lotes de
    // `P2P_PROJECTOR_BATCH`: onde o lote é cortado não pode mudar o resultado.
    const [a] = duasCorridas();
    const meio = Math.floor(a.log.length / 2);
    let state = emptyState(a.core.publicKey);
    a.log.slice(0, meio).forEach((rec, i) => {
      state = foldRecord(state, rec, i).next;
    });
    a.log.slice(meio).forEach((rec, i) => {
      state = foldRecord(state, rec, meio + i).next;
    });
    assert.equal(hash(state), hash(a.state));
  });

  it('o `DS` não guarda nada que dependa do ambiente', () => {
    // §1.5: a interpretação do log não pode ser função do ambiente. Se algum campo do `DS`
    // carregasse relógio local, `Date.now()` ou configuração, dois nós divergiriam — e o
    // serializado canônico é onde isso apareceria.
    const [a] = duasCorridas();
    const serial = hash(a.state);
    assert.ok(!serial.includes(String(Date.now()).slice(0, 8)), 'relógio local vazou para o DS');
  });

  it('`midpoint` e `entityId` são estáveis entre corridas — os dois pontos de geração', () => {
    const [a, b] = duasCorridas();
    assert.deepEqual([...a.state.roles.keys()].sort(), [...b.state.roles.keys()].sort());
    assert.deepEqual(
      [...a.state.roles.values()].map((r) => r.rank).sort(),
      [...b.state.roles.values()].map((r) => r.rank).sort(),
    );
  });
});

describe('§8.0 — a assinatura, e o que `next` promete', () => {
  it('`next` está sempre presente, em todos os desfechos', () => {
    const state = emptyState(keypairFromSeed('core').publicKey);
    for (const entrada of [Buffer.alloc(0), Buffer.from([1]), Buffer.alloc(70_000)]) {
      const r = foldRecord(state, entrada, 0);
      assert.notEqual(r.next, undefined);
      assert.equal(r.next.interpretedSeq, 0);
    }
  });

  it('`effects` é vazio quando não `APPLIED`', () => {
    const g = genesis();
    const r = g.world.push(Buffer.from([1, 2, 3]));
    assert.notEqual(r.decision, 'APPLIED');
    assert.equal(r.effects.length, 0);
  });

  it('`reason` está presente em `REJECTED` e `IGNORED`, e ausente em `APPLIED`', () => {
    const g = genesis();
    for (const r of g.world.results) {
      assert.equal(r.decision, 'APPLIED');
      assert.equal(r.reason, undefined);
    }
    const ruim = g.world.push(Buffer.from([1, 2, 3]));
    assert.notEqual(ruim.reason, undefined);
  });
});
