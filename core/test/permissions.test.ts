/**
 * §28.1 — `permissions` é puro (§4).
 *
 * Como em `errors`, o teste de paridade relê o normativo: a numeração de §9.1 é constante
 * de protocolo que viaja dentro de material assinado, então um deslocamento silencioso faria
 * duas réplicas concederem permissões diferentes lendo o mesmo log.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  ALL_PERMISSIONS,
  BASE_ROLE_FORBIDDEN,
  PERMISSIONS,
  PERMISSION_BY_NUMBER,
  RANK_GENESIS,
  type Permission,
  type RoleLookup,
  type RoleView,
  authorizeOverTarget,
  baseRoleViolation,
  compareRank,
  effectivePermissions,
  escalation,
  hasPermission,
  isReadOnlyFor,
  permissionFromNumber,
  topRank,
} from '../src/l1/permissions/index.ts';

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'docs', 'backend-v2.md'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('docs/backend-v2.md não encontrado');
}

function docSlice(from: string, to: string): string {
  const md = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');
  const a = md.indexOf(from);
  assert.notEqual(a, -1, `${from} sumiu de backend-v2.md`);
  const b = md.indexOf(to, a);
  assert.notEqual(b, -1, `${to} sumiu de backend-v2.md`);
  return md.slice(a, b);
}

function papel(o: Partial<RoleView> & { id: string }): RoleView {
  return { rank: 'M', permissions: [], isFounder: false, isDefault: false, ...o };
}

function tabela(...rs: RoleView[]): RoleLookup {
  const m = new Map(rs.map((r) => [r.id, r]));
  return (id) => m.get(id);
}

describe('catálogo (§9.1) — paridade com o normativo', () => {
  const linhas = [...docSlice('### 9.1 Catálogo', '### 9.2').matchAll(/^\|\s*(\d+)\s*\|[^|]*\|\s*`(\w+)`/gm)]
    .map((m) => ({ n: Number(m[1]), nome: m[2] as Permission }));

  it('são 17 permissões', () => {
    assert.equal(linhas.length, 17);
    assert.equal(ALL_PERMISSIONS.length, 17);
  });

  it('cada nome tem o número exato de §9.1 — é constante de protocolo', () => {
    for (const { n, nome } of linhas) {
      assert.equal(PERMISSIONS[nome], n, `${nome} deveria ser ${n}`);
    }
  });

  it('a ordem do índice reverso é a ordem da tabela', () => {
    assert.deepEqual([...PERMISSION_BY_NUMBER], linhas.map((l) => l.nome));
  });

  it('nenhum número repetido, faixa contínua 0..16', () => {
    const ns = ALL_PERMISSIONS.map((p) => PERMISSIONS[p]).sort((a, b) => a - b);
    assert.deepEqual(ns, Array.from({ length: 17 }, (_, i) => i));
  });

  it('R-11 lista exatamente as permissões proibidas no cargo base', () => {
    const r11 = docSlice('| R-11 |', '| R-12 |');
    const citadas = new Set([...r11.matchAll(/`(\w+)`/g)].map((m) => m[1]).filter((s) => s !== undefined && s in PERMISSIONS));
    assert.deepEqual([...BASE_ROLE_FORBIDDEN].sort(), [...citadas].sort());
  });
});

describe('permissionFromNumber (§9.1)', () => {
  it('resolve 0..16', () => {
    for (let n = 0; n <= 16; n++) assert.equal(permissionFromNumber(n), PERMISSION_BY_NUMBER[n]);
  });

  it('recusa fora da faixa — não ignora em silêncio', () => {
    for (const n of [-1, 17, 255, 1.5, NaN]) assert.equal(permissionFromNumber(n), null, String(n));
  });
});

describe('permissão efetiva (§9.2)', () => {
  const roles = tabela(
    papel({ id: 'base', isDefault: true, rank: '1', permissions: ['send_messages'] }),
    papel({ id: 'mod', rank: 'M', permissions: ['kick_members', 'send_messages'] }),
    papel({ id: 'admin', rank: 'W', permissions: ['manage_roles'] }),
  );

  it('é a união dos cargos ativos, sem duplicata', () => {
    const e = effectivePermissions(['base', 'mod'], roles);
    assert.deepEqual([...e].sort(), ['kick_members', 'send_messages']);
  });

  it('ignora roleId que não resolve — referência pendurada não concede nada', () => {
    assert.deepEqual([...effectivePermissions(['base', 'sumiu'], roles)], ['send_messages']);
    assert.equal(effectivePermissions(['sumiu'], roles).size, 0);
  });

  it('não há negação nem herança: cargos só somam', () => {
    const todos = effectivePermissions(['base', 'mod', 'admin'], roles);
    assert.equal(todos.size, 3);
  });

  it('hasPermission concorda com effectivePermissions', () => {
    for (const p of ALL_PERMISSIONS) {
      assert.equal(
        hasPermission(['base', 'mod'], roles, p),
        effectivePermissions(['base', 'mod'], roles).has(p),
        p,
      );
    }
  });
});

describe('rank (§6.4.1) e topRank (§9.3)', () => {
  it('a ordem base62 coincide com a ordem nativa de string', () => {
    const ordenado = ['0', '9', 'A', 'Z', 'a', 'z'];
    for (let i = 1; i < ordenado.length; i++) {
      assert.ok(compareRank(ordenado[i - 1]!, ordenado[i]!) < 0, `${ordenado[i - 1]} < ${ordenado[i]}`);
    }
  });

  it('RANK_GENESIS é estritamente maior que qualquer rank atribuível (R-27a)', () => {
    for (const r of ['0', 'z', 'zzzz', 'z'.repeat(64)]) {
      assert.ok(compareRank(RANK_GENESIS, r) > 0, r);
      assert.ok(compareRank(r, RANK_GENESIS) < 0, r);
    }
    assert.equal(compareRank(RANK_GENESIS, RANK_GENESIS), 0);
  });

  it('topRank é o maior entre os cargos ativos', () => {
    const roles = tabela(papel({ id: 'a', rank: '1' }), papel({ id: 'b', rank: 'W' }), papel({ id: 'c', rank: 'M' }));
    assert.equal(topRank(['a', 'b', 'c'], roles), 'W');
    assert.equal(topRank(['a', 'c'], roles), 'M');
    assert.equal(topRank(['sumiu'], roles), null);
    assert.equal(topRank([], roles), null);
  });
});

describe('ordem do estágio 12 (§9.3) — fecha HOLE-16', () => {
  it('o cargo Fundador recusa com E_FOUNDER_IMMUTABLE, não E_HIERARCHY', () => {
    // O Fundador tem sempre o rank máximo: sem a ordem, R-4 recusaria antes com E_HIERARCHY
    // e este código do catálogo seria inalcançável — inclusive para o próprio Fundador.
    assert.equal(
      authorizeOverTarget({ authorTopRank: 'z', targetTopRank: 'z', targetIsFounderRole: true }),
      'E_FOUNDER_IMMUTABLE',
    );
    assert.equal(
      authorizeOverTarget({ authorTopRank: RANK_GENESIS, targetTopRank: 'z', targetIsFounderRole: true }),
      'E_FOUNDER_IMMUTABLE',
    );
  });

  it('E_FOUNDER_TOP é alcançável em role.move', () => {
    assert.equal(
      authorizeOverTarget({ authorTopRank: 'z', targetTopRank: '1', moveReachesFounderRank: true }),
      'E_FOUNDER_TOP',
    );
  });

  it('imunidade de pessoa vem antes do rank', () => {
    const alto = { authorTopRank: 'z', targetTopRank: '1' } as const;
    assert.equal(authorizeOverTarget({ ...alto, targetIsOriginalFounder: true }), 'E_FOUNDER_IMMUNE');
    assert.equal(authorizeOverTarget({ ...alto, targetIsCurrentHost: true }), 'E_HOST_IMMUNE');
    assert.equal(authorizeOverTarget({ ...alto, targetIsSelf: true }), 'E_SELF_TARGET');
  });

  it('a precedência entre os passos é a de §9.3', () => {
    assert.equal(
      authorizeOverTarget({
        authorTopRank: 'z', targetTopRank: '1',
        targetIsFounderRole: true, targetIsOriginalFounder: true, targetIsSelf: true,
      }),
      'E_FOUNDER_IMMUTABLE',
    );
    assert.equal(
      authorizeOverTarget({
        authorTopRank: 'z', targetTopRank: '1', targetIsOriginalFounder: true, targetIsSelf: true,
      }),
      'E_FOUNDER_IMMUNE',
    );
  });

  it('rank estritamente menor: nunca igual, nunca maior', () => {
    assert.equal(authorizeOverTarget({ authorTopRank: 'W', targetTopRank: 'M' }), null);
    assert.equal(authorizeOverTarget({ authorTopRank: 'M', targetTopRank: 'M' }), 'E_HIERARCHY');
    assert.equal(authorizeOverTarget({ authorTopRank: 'M', targetTopRank: 'W' }), 'E_HIERARCHY');
  });

  it('autor sem cargo não age; alvo sem cargo está abaixo de qualquer autor', () => {
    assert.equal(authorizeOverTarget({ authorTopRank: null, targetTopRank: '1' }), 'E_HIERARCHY');
    assert.equal(authorizeOverTarget({ authorTopRank: null, targetTopRank: null }), 'E_HIERARCHY');
    assert.equal(authorizeOverTarget({ authorTopRank: '1', targetTopRank: null }), null);
  });

  it('o principal de gênese age sobre qualquer rank (R-27a)', () => {
    assert.equal(authorizeOverTarget({ authorTopRank: RANK_GENESIS, targetTopRank: 'z'.repeat(64) }), null);
  });
});

describe('anti-escalada (R-5, R-11)', () => {
  it('R-5 nomeia a primeira permissão escalada, na ordem de §9.1', () => {
    const efetiva = new Set<Permission>(['send_messages']);
    assert.equal(escalation(['manage_roles', 'manage_channels'], efetiva), 'manage_channels');
    assert.equal(escalation(['send_messages'], efetiva), null);
    assert.equal(escalation([], efetiva), null);
  });

  it('R-5 é determinística: a ordem do argumento não muda a resposta', () => {
    const efetiva = new Set<Permission>();
    assert.equal(escalation(['manage_roles', 'manage_community'], efetiva), 'manage_community');
    assert.equal(escalation(['manage_community', 'manage_roles'], efetiva), 'manage_community');
  });

  it('R-11 recusa toda permissão de gestão, moderação e menção global no cargo base', () => {
    for (const p of BASE_ROLE_FORBIDDEN) assert.equal(baseRoleViolation([p]), p);
  });

  it('R-11 aceita o subconjunto que a gênese cria (R-27b)', () => {
    const base: Permission[] = ['send_messages', 'attach_files', 'add_reactions', 'voice_speak', 'pin_messages'];
    assert.equal(baseRoleViolation(base), null);
  });

  it('R-11 e o catálogo não se sobrepõem no que sobra', () => {
    const permitidas = ALL_PERMISSIONS.filter((p) => !BASE_ROLE_FORBIDDEN.has(p));
    assert.equal(baseRoleViolation(permitidas), null);
    assert.deepEqual(permitidas.sort(), ['add_reactions', 'attach_files', 'pin_messages', 'send_messages', 'voice_share_screen', 'voice_speak']);
  });
});

describe('canal somente-leitura (R-22)', () => {
  it('recusa só quando TODOS os cargos estão na lista', () => {
    assert.equal(isReadOnlyFor(['a', 'b'], ['a', 'b']), true);
    assert.equal(isReadOnlyFor(['a', 'b'], ['a']), false, 'basta um cargo de fora');
    assert.equal(isReadOnlyFor(['a'], ['a', 'b']), true);
  });

  it('lista vazia dos dois lados não silencia ninguém', () => {
    assert.equal(isReadOnlyFor(['a'], []), false);
    assert.equal(isReadOnlyFor([], ['a']), false);
    assert.equal(isReadOnlyFor([], []), false);
  });
});
