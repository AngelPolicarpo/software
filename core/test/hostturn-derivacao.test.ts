// §59 — a derivação de 'ns/hostturn/1' saiu do shell para o núcleo. O que se fixa aqui:
//
//   §5.2   — a canônica é BLAKE2b-256 via sodium (`crypto_generichash_batch`), a mesma de
//            todas as entradas da tabela; o `node:crypto` do Electron não tem blake2b512
//            ("Digest method not supported" derrubava o `community.create` com E_INTERNAL);
//   §17.3  — o segredo muda por instalação (`dataKey`) e por comunidade hospedeira.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sodium from 'sodium-native';

import { hostTurnSecretFrom } from '../src/l0/corestore/index.ts';

describe('§5.2/§17.3 hostTurnSecretFrom — a derivação que o Electron não podia fazer', () => {
  const dataKey = Buffer.alloc(32, 9);

  it('é determinística e tem 32 bytes', () => {
    const a = hostTurnSecretFrom(dataKey, 'ab'.repeat(32));
    const b = hostTurnSecretFrom(dataKey, 'ab'.repeat(32));
    assert.equal(a.length, 32);
    assert.deepEqual(a, b);
  });

  it('é exatamente a BLAKE2b-256 do material de §5.2 — sem atalho de outro hash', () => {
    const communityId = 'cd'.repeat(32);
    const esperado = Buffer.allocUnsafe(32);
    sodium.crypto_generichash_batch(esperado, [Buffer.from('ns/hostturn/1', 'utf8'), dataKey, Buffer.from(communityId, 'utf8')]);
    assert.deepEqual(hostTurnSecretFrom(dataKey, communityId), esperado);
  });

  it('muda com a instalação e com a comunidade', () => {
    const communityId = 'cd'.repeat(32);
    assert.notDeepEqual(hostTurnSecretFrom(dataKey, communityId), hostTurnSecretFrom(Buffer.alloc(32, 10), communityId));
    assert.notDeepEqual(hostTurnSecretFrom(dataKey, communityId), hostTurnSecretFrom(dataKey, 'ef'.repeat(32)));
  });
});
