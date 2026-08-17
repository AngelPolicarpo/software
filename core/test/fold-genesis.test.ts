/**
 * §28.1 — R-27, o lote de gênese. As quatro alíneas:
 *
 *   (a) principal de gênese — o autor dos `seq` 0..5 é avaliado como membro ativo, com as 17
 *       permissões e `topRank = RANK_GENESIS`, **sem nenhum estágio suspenso** exceto R-9;
 *   (b) forma dos payloads — `seq` 1 é o Fundador, `seq` 2 é o cargo base, `seq` 3 atribui os
 *       dois ao autor;
 *   (c) verificação por registro, sem retroação — o desvio marca `invalid`, que é absorvente;
 *   (d) a gênese **não** emite auditoria.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RANK_BOTTOM, RANK_GENESIS, RANK_TOP, ALL_PERMISSIONS, permissionNumber } from '../src/l1/permissions/index.ts';
import { isValidRank } from '../src/l1/permissions/index.ts';
import { GENESIS_LAST_SEQ } from '../src/l1/fold/index.ts';
import { World, genesis, keypairFromSeed, T0, ZERO32, ZERO64 } from './helpers/world.ts';

const TODAS = ALL_PERMISSIONS.map(permissionNumber);
const BASE = [3, 4, 5, 9];
const BLOBS = keypairFromSeed('blobs').publicKey;

/** Os cinco primeiros registros da gênese, para os testes que só desviam no sexto. */
function ateSeq(n: number, world = new World(), founder = keypairFromSeed('founder')) {
  const hostTs = T0;
  const passos = [
    () => world.submit({ kind: 'community.create' as const, author: founder, hostTs, payload: { name: 'Comunidade', iconColor: 0, blobsKey: BLOBS } }),
    () => world.submit({ kind: 'role.create' as const, author: founder, hostTs, payload: { name: 'Fundador', color: 0, permissions: TODAS, mentionable: true } }),
    () => world.submit({ kind: 'role.create' as const, author: founder, hostTs, payload: { name: 'Membro', color: 6, permissions: BASE, mentionable: false } }),
    () => world.submit({ kind: 'member.join' as const, author: founder, hostTs, payload: { invitePublicKey: ZERO32, joinProof: ZERO64, displayName: 'Fundador', avatarColor: 0, blobsCoreKey: BLOBS } }),
    () => world.submit({ kind: 'category.create' as const, author: founder, hostTs, payload: { name: 'GERAL' } }),
  ];
  for (let i = 0; i < n; i++) passos[i]?.();
  return { world, founder };
}

describe('R-27(b) — forma dos payloads', () => {
  it('o `seq` 1 recebe `isFounder`, as 17 permissões e `RANK_TOP`', () => {
    const g = genesis();
    const fundador = g.world.state.roles.get(g.founderRoleId);
    assert.ok(fundador);
    assert.equal(fundador.isFounder, true);
    assert.equal(fundador.rank, RANK_TOP);
    assert.equal(fundador.permissions.size, 17);
  });

  it('o `seq` 2 recebe `isDefault` e `RANK_BOTTOM`', () => {
    const g = genesis();
    const base = g.world.state.roles.get(g.baseRoleId);
    assert.ok(base);
    assert.equal(base.isDefault, true);
    assert.equal(base.rank, RANK_BOTTOM);
  });

  it('o `seq` 3 atribui ao autor `roleIds = {Fundador, base}`', () => {
    const g = genesis();
    const m = g.world.state.members.get(g.founder.publicKey.toString('hex'));
    assert.ok(m);
    assert.deepEqual([...m.roleIds].sort(), [g.founderRoleId, g.baseRoleId].sort());
  });

  it('o cargo base no fundo é o que mantém a moderação funcionando (fecha `HOLE-14`)', () => {
    // Com o default natural (cargo novo entra no fim), todo membro comum superaria todo
    // moderador na hierarquia de §9.3 e a moderação inteira pararia de funcionar.
    const g = genesis();
    const base = g.world.state.roles.get(g.baseRoleId)?.rank ?? '';
    const fundador = g.world.state.roles.get(g.founderRoleId)?.rank ?? '';
    assert.ok(base < fundador);
  });

  it('o Fundador com menos que as 17 permissões derruba a comunidade', () => {
    const { world, founder } = ateSeq(1);
    const r = world.submit({
      kind: 'role.create',
      author: founder,
      hostTs: T0,
      payload: { name: 'Fundador', color: 0, permissions: TODAS.slice(0, 16), mentionable: true },
    });
    assert.equal(r.reason, 'E_GENESIS_MISPLACED');
    assert.equal(world.state.communityInvalid, true);
  });

  it('o cargo base com permissão fora da lista de R-27(b) derruba a comunidade', () => {
    const { world, founder } = ateSeq(2);
    const r = world.submit({
      kind: 'role.create',
      author: founder,
      hostTs: T0,
      payload: { name: 'Membro', color: 6, permissions: [...BASE, 14], mentionable: false }, // ban_members
    });
    assert.equal(r.reason, 'E_GENESIS_MISPLACED');
    assert.equal(world.state.communityInvalid, true);
  });

  it('`pin_messages` é a única permissão a mais que o cargo base pode ter', () => {
    const { world, founder } = ateSeq(2);
    const r = world.submit({
      kind: 'role.create',
      author: founder,
      hostTs: T0,
      payload: { name: 'Membro', color: 6, permissions: [...BASE, 7], mentionable: false },
    });
    assert.equal(r.decision, 'APPLIED');
  });
});

describe('R-27(c) — verificação por registro, sem retroação', () => {
  it('`kind` fora de ordem derruba **aquele** registro e marca `invalid`', () => {
    const { world, founder } = ateSeq(1);
    const r = world.submit({
      kind: 'category.create', // esperado: role.create
      author: founder,
      hostTs: T0,
      payload: { name: 'Xis' },
    });
    assert.equal(r.reason, 'E_GENESIS_MISPLACED');
    assert.equal(world.state.communityInvalid, true);
  });

  it('autor diferente no meio do lote derruba a comunidade', () => {
    const { world } = ateSeq(1);
    const outro = keypairFromSeed('outro');
    const r = world.submit({
      kind: 'role.create',
      author: outro,
      hostTs: T0,
      payload: { name: 'Fundador', color: 0, permissions: TODAS, mentionable: true },
    });
    assert.equal(r.reason, 'E_GENESIS_MISPLACED');
  });

  it('`authorSeq` fora de 1..6 derruba a comunidade', () => {
    const { world, founder } = ateSeq(1);
    const r = world.submit({
      kind: 'role.create',
      author: founder,
      authorSeq: 7,
      hostTs: T0,
      payload: { name: 'Fundador', color: 0, permissions: TODAS, mentionable: true },
    });
    assert.equal(r.reason, 'E_GENESIS_MISPLACED');
  });

  it('`seq` 0 que não é `community.create` derruba a comunidade na largada', () => {
    const world = new World();
    const founder = keypairFromSeed('founder');
    const r = world.submit({
      kind: 'message.send',
      author: founder,
      hostTs: T0,
      payload: { channelId: 'ch-X', content: 'oi', mentions: [] },
    });
    assert.equal(r.reason, 'E_GENESIS_MISPLACED');
    assert.equal(world.state.communityInvalid, true);
  });

  it('`invalid` é absorvente: os `seq` restantes da gênese também caem', () => {
    const { world, founder } = ateSeq(1);
    world.submit({ kind: 'category.create', author: founder, hostTs: T0, payload: { name: 'Xis' } });
    for (let i = 0; i < 4; i++) {
      const r = world.submit({
        kind: 'role.create',
        author: founder,
        hostTs: T0,
        payload: { name: 'Erre', color: 0, permissions: TODAS, mentionable: true },
      });
      assert.equal(r.reason, 'E_GENESIS_MISPLACED', `seq ${world.seq - 1}`);
    }
  });

  it('§8.4.1 — op em `seq ≥ 6` numa gênese rejeitada é `E_NOT_MEMBER`', () => {
    const { world, founder } = ateSeq(1);
    world.submit({ kind: 'category.create', author: founder, hostTs: T0, payload: { name: 'Xis' } });
    while (world.seq <= GENESIS_LAST_SEQ) {
      world.submit({ kind: 'member.leave', author: founder, hostTs: T0, payload: {} });
    }
    const r = world.submit({ kind: 'member.leave', author: founder, hostTs: T0, payload: {} });
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_NOT_MEMBER', 'não há membro nenhum');
  });

  it('sem retroação: o que já foi `APPLIED` continua no `DS`', () => {
    const { world, founder } = ateSeq(1);
    assert.equal(world.state.community.exists, true);
    world.submit({ kind: 'category.create', author: founder, hostTs: T0, payload: { name: 'Xis' } });
    // O `fold` interpreta um registro por vez (§8.0) e não tem retroação: `community.create`
    // do `seq` 0 continua aplicado. A garantia de R-27(c) é que **toda** réplica marca
    // `invalid` no mesmo `seq`, e a comunidade fica inútil de forma idêntica em todo lugar.
    assert.equal(world.state.community.exists, true);
    assert.equal(world.state.communityInvalid, true);
  });

  it('`community.create` em `seq ≠ 0` é gênese fora de lugar', () => {
    const g = genesis();
    const r = g.world.submit({
      kind: 'community.create',
      author: g.founder,
      hostTs: T0,
      payload: { name: 'Outra', iconColor: 0, blobsKey: BLOBS },
    });
    assert.equal(r.reason, 'E_GENESIS_MISPLACED');
  });
});

describe('R-27(a) — o principal de gênese, e o que ele **não** suspende', () => {
  it('`RANK_GENESIS` é maior que todo `rank` válido e nunca é um `rank` válido', () => {
    assert.equal(isValidRank(RANK_GENESIS), false);
    assert.ok(RANK_GENESIS > RANK_TOP);
  });

  it('`RANK_GENESIS` não é gravado em cargo nenhum nem sobrevive à gênese', () => {
    const g = genesis();
    for (const r of g.world.state.roles.values()) assert.notEqual(r.rank, RANK_GENESIS);
    // E não vira `topRank` de ninguém depois do `seq` 5: o autor passa a ser medido pelos
    // cargos reais dele.
    const r = g.world.submit({
      kind: 'role.create',
      author: g.founder,
      hostTs: T0,
      payload: { name: 'Acima', color: 1, permissions: [], mentionable: true },
    });
    assert.equal(r.decision, 'APPLIED');
    const novo = g.world.state.roles.get(g.world.id('role', g.founder, 7));
    assert.ok(novo);
    assert.ok(novo.rank < RANK_TOP, 'nada nasce acima do Fundador depois da gênese');
  });

  it('R-9 é a única regra suspensa: o `member.join` do fundador vem com zeros', () => {
    const g = genesis();
    assert.equal(g.world.results[3]?.decision, 'APPLIED');
    // Fora da gênese, os mesmos zeros são recusados.
    const forasteiro = keypairFromSeed('forasteiro');
    const r = g.world.submit({
      kind: 'member.join',
      author: forasteiro,
      hostTs: T0,
      payload: {
        invitePublicKey: ZERO32,
        joinProof: ZERO64,
        displayName: 'Forasteiro',
        avatarColor: 0,
        blobsCoreKey: BLOBS,
      },
    });
    assert.equal(r.reason, 'E_INVITE_INVALID');
  });

  it('o estágio 13 **não** é suspenso: payload inválido na gênese derruba a comunidade', () => {
    const world = new World();
    const founder = keypairFromSeed('founder');
    const r = world.submit({
      kind: 'community.create',
      author: founder,
      hostTs: T0,
      payload: { name: 'Comunidade', iconColor: 99, blobsKey: BLOBS }, // §6.4.2: fora de 0..7
    });
    assert.equal(r.decision, 'REJECTED');
    assert.equal(r.reason, 'E_VALIDATION');
    assert.equal(r.field, 'iconColor');
  });
});

describe('R-27(d) — a gênese não emite auditoria (fecha `HOLE-17`)', () => {
  it('nenhum dos seis registros produz entrada de auditoria', () => {
    const g = genesis();
    const auditorias = g.world.results.flatMap((r) => r.effects.filter((e) => e.t === 'audit'));
    assert.equal(auditorias.length, 0);
  });

  it('mas a mesma op **depois** da gênese audita normalmente', () => {
    const g = genesis();
    g.world.submit({
      kind: 'category.create',
      author: g.founder,
      hostTs: T0,
      payload: { name: 'OUTRA' },
    });
    const ultimo = g.world.results.at(-1);
    assert.ok(ultimo?.effects.some((e) => e.t === 'audit' && e.entry.type === 'createCategory'));
  });

  it('o motivo: nos `seq` 1, 2, 4 e 5 o autor ainda não é membro', () => {
    // §6.13 exige `byLabel` congelado no momento da aplicação, e o `member.join` do fundador
    // é o `seq` 3. Sem R-27(d), o log de auditoria de **toda** comunidade nasceria com quatro
    // entradas cujo `byLabel` é um fragmento de chave em hexadecimal.
    const { world, founder } = ateSeq(3);
    assert.equal(world.state.members.get(founder.publicKey.toString('hex')), undefined);
    assert.equal(world.state.roles.size, 2, 'os dois cargos já existem');
  });
});
