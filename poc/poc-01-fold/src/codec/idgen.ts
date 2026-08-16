/**
 * Identificadores deterministicos — backend-v2.md §7.3.
 *
 *   opId        = BLAKE2b-256('opid/1' ‖ envelopeCanonico)              -> 32 B, hex
 *   entityId(t) = 'PREFIXO' + crockford32(BLAKE2b-128('id/' ‖ t ‖ '/1'
 *                              ‖ communityId ‖ author ‖ authorSeq))     -> prefixo + 26 chars
 *
 * `communityId` entra como os 32 BYTES da chave publica do core (§6.2: `id` e o hex64
 * dessa chave; o material de hash e a chave, nao o texto hex). `authorSeq` entra como
 * uint64 little-endian, o mesmo layout do campo na `Op` (§7.2.1).
 *
 * NOTA — INCONSISTENCIA MINOR (HOLE-07): §7.2.1 descreve o tipo `id` do registry como
 * "string de 26 caracteres", enquanto §7.3 define `entityId` como PREFIXO + 26 chars de
 * crockford32 (16 bytes -> 26 chars). Aqui vale §7.3, que traz a formula. O tipo do
 * registry e `str` com prefixo de tamanho, entao o comprimento nao e estrutural.
 */
import { blake2b128, blake2b256, hex } from '../crypto/index.ts';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Crockford base32 de 16 bytes -> 26 caracteres (128 bits / 5 = 25.6 -> 26). */
export function crockford32(bytes: Uint8Array): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    acc = (acc << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(acc >>> bits) & 31];
    }
  }
  if (bits > 0) out += CROCKFORD[(acc << (5 - bits)) & 31];
  return out;
}

export const ENTITY = {
  message: { t: 'message', prefix: 'msg-' },
  channel: { t: 'channel', prefix: 'ch-' },
  category: { t: 'category', prefix: 'cat-' },
  role: { t: 'role', prefix: 'role-' },
  thread: { t: 'thread', prefix: 'thr-' },
  modentry: { t: 'modentry', prefix: 'mod-' },
} as const;

export type EntityType = keyof typeof ENTITY;

function u64le(n: number | bigint): Buffer {
  const b = Buffer.allocUnsafe(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

export function entityId(
  t: EntityType,
  communityKey: Uint8Array,
  author: Uint8Array,
  authorSeq: number | bigint,
): string {
  const h = blake2b128(`id/${ENTITY[t].t}/1`, communityKey, author, u64le(authorSeq));
  return ENTITY[t].prefix + crockford32(h);
}

/** §7.3 — opId sobre o envelope canonico (§7.2 "forma canonica"). */
export function opId(canonicalEnvelope: Uint8Array): string {
  return hex(blake2b256('opid/1', canonicalEnvelope));
}
