// Shims de tipos para dependências sem .d.ts — o harness tipa no ponto de uso.
declare module 'sodium-native' {
  const sodium: {
    crypto_sign_PUBLICKEYBYTES: number;
    crypto_sign_SECRETKEYBYTES: number;
    crypto_sign_BYTES: number;
    crypto_sign_SEEDBYTES: number;
    crypto_box_PUBLICKEYBYTES: number;
    crypto_box_SECRETKEYBYTES: number;
    crypto_box_SEALBYTES: number;
    crypto_sign_seed_keypair(pk: Buffer, sk: Buffer, seed: Buffer): void;
    crypto_sign_detached(sig: Buffer, msg: Buffer, sk: Buffer): void;
    crypto_sign_verify_detached(sig: Buffer, msg: Buffer, pk: Buffer): boolean;
    crypto_sign_ed25519_pk_to_curve25519(curvePk: Buffer, edPk: Uint8Array): void;
    crypto_sign_ed25519_sk_to_curve25519(curveSk: Buffer, edSk: Uint8Array): void;
    crypto_box_seal(out: Buffer, message: Uint8Array, curvePk: Uint8Array): void;
    crypto_box_seal_open(out: Buffer, sealed: Uint8Array, curvePk: Uint8Array, curveSk: Uint8Array): boolean;
    crypto_generichash_batch(out: Buffer, parts: readonly Uint8Array[]): void;
    randombytes_buf(out: Buffer): void;
  };
  export default sodium;
}
