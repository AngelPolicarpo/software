// `succession` — escrow da semente (§18.8, A23).
//
// O host sela o `communitySeed` para cada sucessor com `crypto_box_seal(communitySeed,
// x25519(targetKey))`: só o sucessor abre, e a semente **nunca** aparece em claro no log.
// A conversão Ed25519 → X25519 é a de §7.x ("Cifra para um destinatário") e é a mesma nos
// dois lados. Abrir com chave errada devolve `null` — quem mapeia para erro nomeado é a
// fronteira (`E_SUCCESSION_DENIED`/catálogo).

import sodium from 'sodium-native';

/** Sela o seed da comunidade para a chave de identidade Ed25519 do sucessor. */
export function sealSeedFor(targetIdentityPublicKey: Buffer, communitySeed: Buffer): Buffer {
  if (targetIdentityPublicKey.length !== sodium.crypto_sign_PUBLICKEYBYTES) {
    throw new Error('chave pública do sucessor deve ter 32 bytes');
  }
  const curvePk = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES);
  sodium.crypto_sign_ed25519_pk_to_curve25519(curvePk, targetIdentityPublicKey);
  const out = Buffer.alloc(sodium.crypto_box_SEALBYTES + communitySeed.length);
  sodium.crypto_box_seal(out, communitySeed, curvePk);
  return out;
}

/**
 * Abre um escrow com a identidade própria. Falha (selo adulterado, chave errada,
 * tamanho impossível) → `null`, nunca exceção para dados vindos do log.
 * As conversões e o `crypto_box_seal_open` usam a convenção out-param do sodium-native
 * (sem retorno); falha real sinaliza por exceção/lixo de comprimento — capturada abaixo.
 */
export function openSealedSeed(
  wrappedSeed: Uint8Array,
  identityPublicKey: Buffer,
  identitySecretKey: Buffer,
): Buffer | null {
  if (wrappedSeed.length <= sodium.crypto_box_SEALBYTES) return null;
  const curvePk = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES);
  const curveSk = Buffer.alloc(sodium.crypto_box_SECRETKEYBYTES);
  try {
    sodium.crypto_sign_ed25519_pk_to_curve25519(curvePk, identityPublicKey);
    sodium.crypto_sign_ed25519_sk_to_curve25519(curveSk, identitySecretKey);
    const out = Buffer.alloc(wrappedSeed.length - sodium.crypto_box_SEALBYTES);
    if (sodium.crypto_box_seal_open(out, wrappedSeed, curvePk, curveSk) !== true) return null;
    if (out.length !== 32) return null;
    return out;
  } catch {
    return null;
  }
}
