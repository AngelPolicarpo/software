// `relay` — chave de relay e prova de posse (§17.7, A21, R-19).
//
// `relayPk` é **derivada da identidade**:
//   seed    = BLAKE2b('ns/relay/1' ‖ identitySeed ‖ communityId)
//   relayPk = Ed25519(seed).publicKey
// Apontar o relay para um terceiro é impossível (`T-14`): a chave não existe fora do par
// (identidade, comunidade).
//
// A prova de posse que acompanha `relay.volunteer` é
//   possession = Ed25519(identitySk, BLAKE2b('relay-possession/1' ‖ relayPublicKey))
// e o `fold` a verifica com a MESMA hash sobre a chave de identidade do autor (R-19).
// O helper de hash é reproduzido aqui byte a byte com `opCodec.relayPossessionSigningHash`
// porque §4 não declara `opCodec` nas dependências deste módulo — uma constante/domínio
// nunca é transcrita com divergência, e o teste cruza as duas implementações.

import sodium from 'sodium-native';

function blake2b256(domain: string, ...parts: Uint8Array[]): Buffer {
  const out = Buffer.allocUnsafe(32);
  sodium.crypto_generichash_batch(out, [Buffer.from(domain, 'utf8'), ...parts]);
  return out;
}

export interface RelayKeyPair {
  readonly publicKey: Buffer;
  readonly secretKey: Buffer;
}

/**
 * Deriva o par Ed25519 do relay da identidade do voluntário para UMA comunidade.
 * `identitySeed` tem 32 B (§5.1) e chega injetado pela composição — quem o possui é
 * `identity` (L0), e §4 não declara essa dependência. `communityId` entra em UTF-8,
 * sem prefixo de comprimento (campos separados pelo domínio BLAKE2b, como nos tickets).
 */
export function deriveRelayKeyPair(identitySeed: Buffer, communityId: string): RelayKeyPair {
  if (identitySeed.length !== sodium.crypto_sign_SEEDBYTES) {
    throw new Error(`seed de identidade deve ter ${sodium.crypto_sign_SEEDBYTES} bytes`);
  }
  const seed = blake2b256('ns/relay/1', identitySeed, Buffer.from(communityId, 'utf8'));
  const publicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
  const secretKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
  sodium.crypto_sign_seed_keypair(publicKey, secretKey, seed);
  return { publicKey, secretKey };
}

/** Hash assinável da prova de posse — idêntico a `opCodec.relayPossessionSigningHash` (R-19). */
export function relayPossessionHash(relayPublicKey: Buffer): Buffer {
  return blake2b256('relay-possession/1', relayPublicKey);
}

/** Prova de posse: Ed25519 da chave de identidade do autor sobre a hash acima (A21). */
export function signPossession(identitySecretKey: Buffer, relayPublicKey: Buffer): Buffer {
  const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, relayPossessionHash(relayPublicKey), identitySecretKey);
  return sig;
}
