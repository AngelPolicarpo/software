/**
 * §28.1 — indexação fracionária de §6.4.1, aplicada por R-20.
 *
 * Os vetores vêm de `poc-01-fold/src/fold/rank.ts`, a implementação sobre a qual o
 * `CONFIRMADO` de G1 foi obtido. A definição normativa de §6.4.1 foi escrita **a partir**
 * dela justamente para que a evidência de G1 transferisse sem nova corrida; se este arquivo
 * divergir, essa transferência deixa de valer.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  RANK_BOTTOM,
  RANK_DIGITS,
  RANK_GENESIS,
  RANK_MAX_LEN,
  RANK_TOP,
  compareRank,
  isValidRank,
} from '../src/l1/permissions/index.ts';
import { midpoint, needsRenormalization, renormalize } from '../src/l1/fold/rank.ts';

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'docs', 'backend-v2.md'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('docs/backend-v2.md não encontrado');
}

describe('constantes de rank (§27.1) — paridade com o normativo', () => {
  const md = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');

  it('§27.1 declara os três valores que o código usa', () => {
    assert.match(md, /`RANK_TOP` `'zz'`/, 'RANK_TOP sumiu de §27.1');
    assert.match(md, /`RANK_BOTTOM` `'1'`/, 'RANK_BOTTOM sumiu de §27.1');
    assert.match(md, /`RANK_GENESIS` `'z'` × 65/, 'RANK_GENESIS sumiu de §27.1');
    assert.match(md, /`RANK_MAX_LEN` 64/);
  });

  it('os valores batem', () => {
    assert.equal(RANK_TOP, 'zz');
    assert.equal(RANK_BOTTOM, '1');
    assert.equal(RANK_GENESIS, 'z'.repeat(65));
    assert.equal(RANK_MAX_LEN, 64);
    assert.equal(RANK_DIGITS.length, 62);
  });

  it('RANK_TOP e RANK_BOTTOM são ranks válidos; RANK_GENESIS não é (R-27a)', () => {
    assert.equal(isValidRank(RANK_TOP), true);
    assert.equal(isValidRank(RANK_BOTTOM), true);
    assert.equal(isValidRank(RANK_GENESIS), false, 'RANK_GENESIS nunca pode ser gravado');
  });

  it('RANK_GENESIS é estritamente maior que todo rank válido', () => {
    for (const r of [RANK_TOP, RANK_BOTTOM, 'z'.repeat(RANK_MAX_LEN), 'zy', '9', 'zzzz']) {
      assert.ok(compareRank(RANK_GENESIS, r) > 0, r);
    }
  });

  it('RANK_BOTTOM < RANK_TOP, com folga muito acima de MAX_ROLES', () => {
    assert.ok(compareRank(RANK_BOTTOM, RANK_TOP) < 0);
    // 98 = MAX_ROLES − 2 (o Fundador e o base já ocupam dois)
    const entre = new Set<string>();
    let cur = RANK_BOTTOM;
    for (let i = 0; i < 98; i++) {
      cur = midpoint(cur, RANK_TOP);
      assert.ok(cur > RANK_BOTTOM && cur < RANK_TOP, `${cur} saiu da faixa`);
      entre.add(cur);
    }
    assert.equal(entre.size, 98);
  });
});

describe('isValidRank (§7.2.1)', () => {
  it('aceita base62 de 1 a 64 caracteres', () => {
    assert.equal(isValidRank('1'), true);
    assert.equal(isValidRank('aZ9'), true);
    assert.equal(isValidRank('z'.repeat(64)), true);
  });

  it('recusa vazio, longo demais, fora do alfabeto e terminando em 0', () => {
    assert.equal(isValidRank(''), false);
    assert.equal(isValidRank('z'.repeat(65)), false);
    assert.equal(isValidRank('a-b'), false);
    assert.equal(isValidRank('ação'), false);
    assert.equal(isValidRank('10'), false, 'nunca termina em 0');
    assert.equal(isValidRank('0'), false);
  });
});

describe('midpoint (§6.4.1) — paridade com a implementação de G1', () => {
  const vetores: Array<[string | null, string | null, string]> = [
    [null, null, 'V'],
    [null, '1', '0V'],
    ['1', null, 'W'],
    ['1', 'zz', 'V'],
    ['1', '2', '1V'],
    ['a', 'b', 'aV'],
    ['zz', null, 'zzV'],
    [null, '0001', '0000V'],
    ['abc', 'abd', 'abcV'],
  ];

  it('reproduz os vetores', () => {
    for (const [a, b, esperado] of vetores) {
      assert.equal(midpoint(a, b), esperado, `midpoint(${a}, ${b})`);
    }
  });

  it('entrada incoerente é normalizada, nunca recusada (§8.5)', () => {
    assert.equal(midpoint('1', '1'), 'W', 'a = b vira "entra no fim"');
    assert.equal(midpoint('zz', '1'), 'zzV', 'a > b vira "entra no fim"');
  });
});

describe('midpoint — as propriedades que §6.4.1 promete', () => {
  it('é sempre estritamente entre os vizinhos', () => {
    const pares: Array<[string, string]> = [
      ['1', 'zz'], ['1', '2'], ['a', 'b'], ['abc', 'abd'], ['1', 'V'], ['V', 'zz'],
    ];
    for (const [a, b] of pares) {
      const m = midpoint(a, b);
      assert.ok(m > a, `${m} não é > ${a}`);
      assert.ok(m < b, `${m} não é < ${b}`);
    }
  });

  it('inserções repetidas no meio continuam ordenadas', () => {
    let a = RANK_BOTTOM;
    const b = RANK_TOP;
    const gerados: string[] = [];
    for (let i = 0; i < 60; i++) {
      const m = midpoint(a, b);
      gerados.push(m);
      a = m;
    }
    assert.deepEqual(gerados, [...gerados].sort(), 'a sequência saiu da ordem');
  });

  it('é determinístico — toda réplica produz a mesma chave', () => {
    for (let i = 0; i < 50; i++) assert.equal(midpoint('1', 'zz'), 'V');
  });

  it('nunca produz chave terminando em 0', () => {
    let cur: string | null = null;
    for (let i = 0; i < 200; i++) {
      cur = midpoint(null, cur);
      assert.ok(!cur.endsWith('0'), `${cur} termina em 0`);
    }
  });

  it('é total: nenhuma entrada lança', () => {
    const estranhos = ['', '0', '000', 'z'.repeat(70), '!!', 'ação'];
    for (const a of [...estranhos, null]) {
      for (const b of [...estranhos, null]) {
        assert.doesNotThrow(() => midpoint(a, b), `midpoint(${a}, ${b})`);
      }
    }
  });

  it('cresce no fundo até estourar RANK_MAX_LEN por volta de 383, como §6.4.1 mede', () => {
    let cur: string | null = null;
    let estourouEm = -1;
    for (let i = 0; i < 400; i++) {
      cur = midpoint(null, cur);
      if (estourouEm < 0 && cur.length > RANK_MAX_LEN) estourouEm = i;
    }
    assert.ok(estourouEm > 370 && estourouEm < 395, `estourou em ${estourouEm}, esperado ~383`);
    assert.equal(needsRenormalization('z'.repeat(65)), true);
    assert.equal(needsRenormalization('zz'), false);
  });
});

describe('renormalize (§6.4.1)', () => {
  it('reproduz os vetores de G1', () => {
    assert.deepEqual(renormalize(5), ['11', '12', '13', '14', '15']);
    assert.deepEqual(renormalize(62).slice(59, 62), ['1y', '21', '22']);
  });

  it('preserva a ordem e cabe em MAX_CHANNELS', () => {
    const r = renormalize(500);
    assert.equal(r.length, 500);
    assert.deepEqual(r, [...r].sort(), 'a renormalização saiu da ordem');
    assert.equal(new Set(r).size, 500, 'houve colisão');
  });

  it('todo valor é rank válido e fica estritamente entre RANK_BOTTOM e RANK_TOP', () => {
    for (const v of renormalize(500)) {
      assert.equal(isValidRank(v), true, v);
      assert.ok(v >= RANK_BOTTOM, `${v} abaixo de RANK_BOTTOM`);
      assert.ok(v < RANK_TOP, `${v} não está abaixo de RANK_TOP`);
    }
  });

  it('é total: entrada inválida devolve lista vazia, não lança', () => {
    for (const n of [-1, 1.5, NaN, 60 * 61 + 1]) {
      assert.doesNotThrow(() => renormalize(n));
      assert.deepEqual(renormalize(n), []);
    }
    assert.deepEqual(renormalize(0), []);
  });
});
