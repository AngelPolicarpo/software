/**
 * §28.1 — `idgen` é puro (§4): sem rede, sem relógio, sem banco.
 *
 * Os vetores de `paridade com G1` foram gerados pela implementação de `poc-01-fold`, que é
 * a que produziu o veredito `CONFIRMADO` de G1 sobre 10⁷ entradas hostis. Se o produto
 * divergir dela, a evidência do gate deixa de valer para este código — por isso os valores
 * estão fixos aqui, e não recalculados.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ENTITY,
  ENTITY_ID_BODY_LEN,
  ENTITY_TYPES,
  crockford32,
  entityId,
  entityTypeOf,
  opId,
} from '../src/l1/idgen/index.ts';

const KEY = Buffer.alloc(32, 0xab);
const AUTHOR = Buffer.alloc(32, 0x11);

describe('paridade com a implementação do protocolo escopado', () => {
  it('entityId reproduz os vetores de poc-01-fold', () => {
    assert.deepEqual(
      Object.fromEntries(ENTITY_TYPES.map((t) => [t, entityId(t, KEY, AUTHOR, 42)])),
      {
        message: 'msg-3CRPT5SYZS2Y25F28S5JX85JMG',
        channel: 'ch-VFY83EANZQXVM4JAPA7ZZAA590',
        category: 'cat-C7YD2H4HJ7E1YP30A76549ABWM',
        role: 'role-Y9EXZ22T7GFS732EVNN59C1GT8',
        thread: 'thr-BP3VZXA8J6XCFV85Q8X6P7Q4RW',
        modentry: 'mod-K753MHXB4TCBAVNDHHCFD8YQR8',
      },
    );
  });

  it('authorSeq 0 e 2^53 batem', () => {
    assert.equal(entityId('message', KEY, AUTHOR, 0), 'msg-6SST5JE48HJJ7RP4VD5R0KASZ0');
    assert.equal(entityId('message', KEY, AUTHOR, 2n ** 53n), 'msg-0H32C3FVF6T009E1CMVK6E3G5R');
  });

  it('opId bate', () => {
    assert.equal(
      opId(Buffer.from('envelope-canonico-de-teste')),
      '1df5727da1fe6eb6855ae8f86625df1d1767e9e2e5a8af10e0be106f3c458181',
    );
  });

  it('crockford32 bate', () => {
    assert.equal(
      crockford32(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')),
      '000G40R40M30E209185GR38E1W',
    );
  });
});

describe('crockford32 (§7.3)', () => {
  it('16 bytes viram 26 caracteres', () => {
    assert.equal(crockford32(Buffer.alloc(16)).length, ENTITY_ID_BODY_LEN);
    assert.equal(crockford32(Buffer.alloc(16, 0xff)).length, ENTITY_ID_BODY_LEN);
  });

  it('nunca emite I, L, O nem U', () => {
    for (let i = 0; i < 256; i++) {
      const s = crockford32(Buffer.alloc(16, i));
      assert.ok(!/[ILOU]/.test(s), `byte ${i} produziu ${s}`);
    }
  });

  it('é injetiva em bytes distintos', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 256; i++) {
      const b = Buffer.alloc(16);
      b[15] = i;
      vistos.add(crockford32(b));
    }
    assert.equal(vistos.size, 256);
  });
});

describe('entityId (§7.3) — as propriedades que a spec promete', () => {
  it('é determinístico: a mesma op produz o mesmo id em toda reprojeção', () => {
    const a = entityId('message', KEY, AUTHOR, 7);
    for (let i = 0; i < 50; i++) assert.equal(entityId('message', KEY, AUTHOR, 7), a);
  });

  it('duas ops distintas não colidem: authorSeq diferente muda o id', () => {
    const vistos = new Set<string>();
    for (let seq = 0; seq < 500; seq++) vistos.add(entityId('message', KEY, AUTHOR, seq));
    assert.equal(vistos.size, 500);
  });

  it('o escopo diferencia ids quando authorSeq coincide', () => {
    assert.notEqual(
      entityId('message', KEY, AUTHOR, 7, 'channel:ch-a'),
      entityId('message', KEY, AUTHOR, 7, 'channel:ch-b'),
    );
    assert.notEqual(
      entityId('message', KEY, AUTHOR, 7, 'channel:ch-a'),
      entityId('message', KEY, AUTHOR, 7, 'community'),
    );
  });

  it('autor diferente muda o id', () => {
    const outro = Buffer.alloc(32, 0x22);
    assert.notEqual(entityId('message', KEY, AUTHOR, 1), entityId('message', KEY, outro, 1));
  });

  it('é escopado por comunidade: id não atravessa fronteira (§7.3)', () => {
    const outraComunidade = Buffer.alloc(32, 0xcd);
    assert.notEqual(
      entityId('message', KEY, AUTHOR, 1),
      entityId('message', outraComunidade, AUTHOR, 1),
    );
  });

  it('o prefixo de domínio separa as entidades (§5.2)', () => {
    const ids = ENTITY_TYPES.map((t) => entityId(t, KEY, AUTHOR, 1).split('-').slice(1).join('-'));
    assert.equal(new Set(ids).size, ENTITY_TYPES.length, 'dois tipos produziram o mesmo corpo');
  });

  it('todo id tem prefixo declarado + 26 caracteres', () => {
    for (const t of ENTITY_TYPES) {
      const id = entityId(t, KEY, AUTHOR, 3);
      assert.ok(id.startsWith(ENTITY[t].prefix), id);
      assert.equal(id.length, ENTITY[t].prefix.length + ENTITY_ID_BODY_LEN, id);
    }
  });

  it('recusa chave de tamanho errado — é erro de programação, não entrada do log', () => {
    assert.throws(() => entityId('message', Buffer.alloc(31), AUTHOR, 1), RangeError);
    assert.throws(() => entityId('message', KEY, Buffer.alloc(33), 1), RangeError);
  });

  it('recusa authorSeq fora de uint64 ou com perda de precisão', () => {
    assert.throws(() => entityId('message', KEY, AUTHOR, -1), RangeError);
    assert.throws(() => entityId('message', KEY, AUTHOR, 2n ** 64n), RangeError);
    assert.throws(() => entityId('message', KEY, AUTHOR, Number.MAX_SAFE_INTEGER + 2), RangeError);
  });

  it('aceita o topo de uint64', () => {
    assert.equal(entityId('message', KEY, AUTHOR, 2n ** 64n - 1n).length, 30);
  });
});

describe('entityTypeOf', () => {
  it('reconhece todo id que entityId produz', () => {
    for (const t of ENTITY_TYPES) assert.equal(entityTypeOf(entityId(t, KEY, AUTHOR, 9)), t);
  });

  it('recusa prefixo desconhecido, comprimento errado e alfabeto fora de Crockford', () => {
    assert.equal(entityTypeOf('user-HVDMWKXAD1045Q59TQN01BX7RR'), null);
    assert.equal(entityTypeOf('msg-HVDMWKXAD1045Q59TQN01BX7R'), null);
    assert.equal(entityTypeOf('msg-HVDMWKXAD1045Q59TQN01BX7RI'), null, 'I não é Crockford');
    assert.equal(entityTypeOf(''), null);
  });
});

describe('opId (§7.3)', () => {
  it('são 32 bytes em hex minúsculo', () => {
    const id = opId(Buffer.from('x'));
    assert.match(id, /^[0-9a-f]{64}$/);
  });

  it('é determinístico e sensível a um bit', () => {
    const a = opId(Buffer.from([1, 2, 3]));
    assert.equal(opId(Buffer.from([1, 2, 3])), a);
    assert.notEqual(opId(Buffer.from([1, 2, 4])), a);
  });

  it('não colide com entityId no domínio: prefixos diferentes, saídas diferentes', () => {
    // 'opid/1' vs 'id/message/1' — §5.2 proíbe reaproveitar prefixo entre contextos.
    const env = Buffer.concat([KEY, AUTHOR]);
    assert.notEqual(opId(env), entityId('message', KEY, AUTHOR, 0).slice(4));
  });
});
