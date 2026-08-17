// Envelope e registro do log — o **subconjunto** de §7.1/§7.2 que G4 exercita.
//
// O que este harness mede é durabilidade e idempotência do caminho de escrita (§11), não a
// semântica do `fold`. Por isso o envelope carrega só o que a idempotência precisa —
// `(author, authorSeq)` de §7.5, `communityId` de §7.1 e o `opId` de §5.2 — e a verificação
// de assinatura Ed25519 **não** entra: ela é o estágio 4 de §8.2 e já é evidência de G1
// (10⁷ entradas hostis, `poc-01-fold`). Repeti-la aqui custaria `sodium-native` e não moveria
// nenhum critério de aprovação deste gate. Está declarado como limitação no artefato.
//
// O layout é fixo e little-endian, como §7.2.1: mudar um campo muda o `opId`, que é o que
// torna "reenviar o mesmo envelope" (§11.3, `failed → queued`) uma operação sem ambiguidade.

import { createHash } from 'node:crypto';

export const KEY_LEN = 32;

export type Envelope = {
  readonly author: Buffer;
  readonly authorSeq: number;
  readonly communityId: Buffer;
  readonly kind: number;
  readonly payload: Buffer;
};

/** `BLAKE2b-256(prefix ‖ partes)` — a separação de domínio de §5.2. */
export function blake2b256(prefix: string, ...parts: Uint8Array[]): Buffer {
  const h = createHash('blake2b512');
  h.update(Buffer.from(prefix, 'utf8'));
  for (const p of parts) h.update(p);
  // BLAKE2b-256 de verdade é outro bloco de parâmetros, não um truncamento — aqui o valor
  // só precisa ser uma função determinística e sem colisão prática, e o harness não
  // interopera com o produto. Declarado no artefato.
  return h.digest().subarray(0, 32);
}

export function encodeEnvelope(e: Envelope): Buffer {
  if (e.author.length !== KEY_LEN) throw new Error('author precisa de 32 bytes');
  if (e.communityId.length !== KEY_LEN) throw new Error('communityId precisa de 32 bytes');
  const b = Buffer.allocUnsafe(KEY_LEN + 4 + KEY_LEN + 2 + 4 + e.payload.length);
  let o = 0;
  e.author.copy(b, o);
  o += KEY_LEN;
  b.writeUInt32LE(e.authorSeq, o);
  o += 4;
  e.communityId.copy(b, o);
  o += KEY_LEN;
  b.writeUInt16LE(e.kind, o);
  o += 2;
  b.writeUInt32LE(e.payload.length, o);
  o += 4;
  e.payload.copy(b, o);
  return b;
}

/** Total: entrada malformada devolve `null`, nunca lança (§8.5 vale para todo decodificador). */
export function decodeEnvelope(b: Buffer): Envelope | null {
  try {
    if (b.length < KEY_LEN + 4 + KEY_LEN + 2 + 4) return null;
    let o = 0;
    const author = b.subarray(o, o + KEY_LEN);
    o += KEY_LEN;
    const authorSeq = b.readUInt32LE(o);
    o += 4;
    const communityId = b.subarray(o, o + KEY_LEN);
    o += KEY_LEN;
    const kind = b.readUInt16LE(o);
    o += 2;
    const len = b.readUInt32LE(o);
    o += 4;
    if (b.length < o + len) return null;
    return { author, authorSeq, communityId, kind, payload: b.subarray(o, o + len) };
  } catch {
    return null;
  }
}

/** §5.2 — `'opid/1'` sobre o envelope canônico. É a chave `UNIQUE` de `local_outbox`. */
export function opIdOf(envelope: Buffer): string {
  return blake2b256('opid/1', envelope).toString('hex');
}

// ─── Registro do log ────────────────────────────────────────────────────────────────────

export type HostRecord = {
  readonly envelope: Buffer;
  readonly hostTs: number;
};

/** O que o host appenda: envelope + carimbo dele (§7.1, sem `hostSig` — ver o cabeçalho). */
export function encodeRecord(r: HostRecord): Buffer {
  const b = Buffer.allocUnsafe(8 + 4 + r.envelope.length);
  b.writeBigUInt64LE(BigInt(r.hostTs), 0);
  b.writeUInt32LE(r.envelope.length, 8);
  r.envelope.copy(b, 12);
  return b;
}

export function decodeRecord(b: Buffer): HostRecord | null {
  try {
    if (b.length < 12) return null;
    const hostTs = Number(b.readBigUInt64LE(0));
    const len = b.readUInt32LE(8);
    if (b.length < 12 + len) return null;
    return { envelope: b.subarray(12, 12 + len), hostTs };
  } catch {
    return null;
  }
}
