/**
 * Primitivas — backend-v2.md §5.1, com a separacao de dominio de §5.2.
 * Ed25519 (sodium-native), BLAKE2b-256/128, aleatoriedade por sodium.randombytes_buf.
 * `Math.random` e proibido em todo o harness (§5.1).
 */
import sodium from 'sodium-native';
import b4a from 'b4a';

export type KeyPair = { publicKey: Buffer; secretKey: Buffer };

export function randomBytes(n: number): Buffer {
  const b = Buffer.allocUnsafe(n);
  sodium.randombytes_buf(b);
  return b;
}

export function keyPairFromSeed(seed: Buffer): KeyPair {
  const publicKey = Buffer.allocUnsafe(sodium.crypto_sign_PUBLICKEYBYTES);
  const secretKey = Buffer.allocUnsafe(sodium.crypto_sign_SECRETKEYBYTES);
  sodium.crypto_sign_seed_keypair(publicKey, secretKey, seed);
  return { publicKey, secretKey };
}

export function keyPair(): KeyPair {
  return keyPairFromSeed(randomBytes(32));
}

/** BLAKE2b-256 com prefixo de dominio (§5.2). */
export function blake2b256(domain: string, ...parts: Uint8Array[]): Buffer {
  const out = Buffer.allocUnsafe(32);
  sodium.crypto_generichash_batch(out, [b4a.from(domain), ...parts]);
  return out;
}

/** BLAKE2b-128 com prefixo de dominio — usado por `entityId` (§7.3). */
export function blake2b128(domain: string, ...parts: Uint8Array[]): Buffer {
  const out = Buffer.allocUnsafe(16);
  sodium.crypto_generichash_batch(out, [b4a.from(domain), ...parts]);
  return out;
}

export function sign(message: Uint8Array, secretKey: Uint8Array): Buffer {
  const sig = Buffer.allocUnsafe(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, message, secretKey);
  return sig;
}

/**
 * Verificacao Ed25519. NUNCA lanca: entrada de tamanho errado devolve `false`.
 * O `fold` e total (§8.5) e depende disso.
 */
export function verify(sig: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  if (sig.length !== sodium.crypto_sign_BYTES) return false;
  if (publicKey.length !== sodium.crypto_sign_PUBLICKEYBYTES) return false;
  try {
    return sodium.crypto_sign_verify_detached(sig, message, publicKey);
  } catch {
    return false;
  }
}

export function hex(b: Uint8Array): string {
  return b4a.toString(b as Buffer, 'hex');
}

export function fromHex(s: string): Buffer {
  return b4a.from(s, 'hex') as Buffer;
}

export const ZERO32: Buffer = Buffer.alloc(32);
export const ZERO64: Buffer = Buffer.alloc(64);
