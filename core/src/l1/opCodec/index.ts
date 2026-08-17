// `opCodec` — L1. Encode/decode de `Op`, `Envelope` e `HostRecord` por versão, e a forma
// canônica (§7.1, §7.2, §7.2.1).
//
// §4: não depende de nenhum módulo — nem de `idgen`, que consome a forma canônica. Por isso
// `opId` **não** mora aqui: este módulo produz o envelope canônico, e `idgen.opId()` o
// transforma em id. §4 também diz o que ele não pode fazer: **validar semântica**. Aqui só
// se decide se os bytes casam o layout; se a op *pode* o que pede é assunto do `fold`.
//
//   Op         = { v:uint8, communityId:bytes[32], kind:uint16, author:bytes[32],
//                  authorSeq:uint64, ts:uint64, payload:bytes }
//   Envelope   = { op:bytes, sig:bytes[64] }
//                sig = Ed25519(author, BLAKE2b('op/1' ‖ op))
//   HostRecord = { envelope:bytes, hostTs:uint64, flags:uint8, hostSig:bytes[64] }
//                hostSig = Ed25519(coreKeyPair, BLAKE2b('hostrec/1' ‖ envelope ‖ hostTs ‖ flags))
//
// Nenhuma função deste módulo lança: `decode*` devolve `null` (§8.5).

import sodium from 'sodium-native';

import { Reader, Writer } from './wire.ts';

export { Reader, Writer } from './wire.ts';
export {
  KINDS,
  KIND_NAMES,
  PAYLOAD_LAYOUT,
  isKnownKind,
  kindName,
  kindNumber,
  type KindName,
  type KindNumber,
} from './kinds.ts';
export {
  PAYLOAD_FIELDS,
  decodePayload,
  encodePayload,
  parseLayout,
  type Attachment,
  type BlobRef,
  type Field,
  type PayloadOf,
} from './payloads.ts';

/** §5.2: prefixo de domínio em todo hash. Reaproveitar prefixo é bug de segurança. */
export function blake2b256(domain: string, ...parts: Uint8Array[]): Buffer {
  const out = Buffer.allocUnsafe(32);
  sodium.crypto_generichash_batch(out, [Buffer.from(domain, 'utf8'), ...parts]);
  return out;
}

const SIG_LEN = sodium.crypto_sign_BYTES;
const KEY_LEN = sodium.crypto_sign_PUBLICKEYBYTES;

/**
 * Ed25519 (§5.1) sobre um digest já construído. **Nunca lança**, nem para tamanho errado:
 * é chamada dos estágios 1 e 4 de §8.2, onde os bytes vêm do log e podem ser qualquer coisa.
 *
 * **Por que a verificação mora aqui.** §4 dá a "verificação" a `identity`, que é L0, e dá ao
 * `fold` exatamente quatro dependências — `opCodec`, `permissions`, `idgen`, `errors`. Não há
 * caminho declarado do `fold` até `identity`, e sem verificar assinatura os estágios 1 e 4 não
 * existem. `opCodec` é onde o material assinável de §7.1 é construído (`opSigningHash`,
 * `hostRecordSigningHash`), tem `Depende de` vazio e a única proibição de "validar semântica" —
 * conferir uma curva sobre bytes dados não é semântica. Registrado em
 * `docs/sequenciamento-pos-fase-0.md` §17.
 */
export function verifySignature(sig: Uint8Array, digest: Uint8Array, publicKey: Uint8Array): boolean {
  if (sig.length !== SIG_LEN || publicKey.length !== KEY_LEN) return false;
  try {
    return sodium.crypto_sign_verify_detached(
      Buffer.from(sig.buffer, sig.byteOffset, sig.length),
      Buffer.from(digest.buffer, digest.byteOffset, digest.length),
      Buffer.from(publicKey.buffer, publicKey.byteOffset, publicKey.length),
    );
  } catch {
    return false;
  }
}

// ─── §7.1 — estruturas assinadas ───────────────────────────────────────────────────────

export type Op = {
  readonly v: number;
  /** Os 32 bytes da chave pública do core (§6.2), não o texto hex. */
  readonly communityId: Buffer;
  readonly kind: number;
  readonly author: Buffer;
  readonly authorSeq: number;
  readonly ts: number;
  readonly payload: Buffer;
};

export type Envelope = { readonly op: Buffer; readonly sig: Buffer };

export type HostRecord = {
  readonly envelope: Buffer;
  readonly hostTs: number;
  readonly flags: number;
  readonly hostSig: Buffer;
};

/** §7.1: bit 0 `clockSkewed`; bits 1–7 reservados. Leitores ignoram bits desconhecidos. */
export const FLAG_CLOCK_SKEWED = 1;

export function isClockSkewed(flags: number): boolean {
  return (flags & FLAG_CLOCK_SKEWED) !== 0;
}

// ─── Codec ─────────────────────────────────────────────────────────────────────────────

/**
 * Forma canônica de §7.2: campos na ordem declarada, sem padding, opcional ausente não é
 * escrito. Como o layout é inteiramente determinado, **a forma canônica é o encoding** — não
 * há uma segunda serialização a manter em dia.
 */
export function encodeOp(op: Op): Buffer {
  return new Writer()
    .u8(op.v)
    .key(op.communityId)
    .u16(op.kind)
    .key(op.author)
    .u64(op.authorSeq)
    .u64(op.ts)
    .bytes(op.payload)
    .toBuffer();
}

export function decodeOp(buf: Uint8Array): Op | null {
  const r = new Reader(buf);
  const op: Op = {
    v: r.u8(),
    communityId: r.key(),
    kind: r.u16(),
    author: r.key(),
    authorSeq: r.u64(),
    ts: r.u64(),
    payload: r.bytes(),
  };
  // §7.2 regra 2 — leitor tolerante: bytes sobrando no fim são ignorados.
  return r.failed ? null : op;
}

export function encodeEnvelope(e: Envelope): Buffer {
  return new Writer().bytes(e.op).sig(e.sig).toBuffer();
}

export function decodeEnvelope(buf: Uint8Array): Envelope | null {
  const r = new Reader(buf);
  const op = r.bytes();
  const sig = r.sig();
  return r.failed ? null : { op, sig };
}

export function encodeHostRecord(h: HostRecord): Buffer {
  return new Writer().bytes(h.envelope).u64(h.hostTs).u8(h.flags).sig(h.hostSig).toBuffer();
}

export function decodeHostRecord(buf: Uint8Array): HostRecord | null {
  const r = new Reader(buf);
  const envelope = r.bytes();
  const hostTs = r.u64();
  const flags = r.u8();
  const hostSig = r.sig();
  return r.failed ? null : { envelope, hostTs, flags, hostSig };
}

// ─── Material assinável (§5.2) ─────────────────────────────────────────────────────────

/** `BLAKE2b('op/1' ‖ op)` — o que o autor assina. */
export function opSigningHash(opBytes: Uint8Array): Buffer {
  return blake2b256('op/1', opBytes);
}

/**
 * `BLAKE2b('hostrec/1' ‖ envelope ‖ hostTs ‖ flags)` — o que o host assina. `hostTs` e
 * `flags` entram no layout do registry (u64 LE e u8), a única leitura possível de §7.1
 * combinada com §7.2.1.
 *
 * É isto que fecha `T-27`/`DS-13`: um host não reescreve carimbo nem `clockSkewed` sem que
 * a assinatura falhe.
 */
export function hostRecordSigningHash(
  envelope: Uint8Array,
  hostTs: number,
  flags: number,
): Buffer {
  return blake2b256('hostrec/1', envelope, new Writer().u64(hostTs).u8(flags).toBuffer());
}

/**
 * O envelope na forma canônica, pronto para `idgen.opId()`. Existe para que o `fold` não
 * precise saber que "canônico" e "encodado" são a mesma coisa neste layout.
 */
export function canonicalEnvelope(e: Envelope): Buffer {
  return encodeEnvelope(e);
}

// ─── Versão ────────────────────────────────────────────────────────────────────────────

/**
 * §7.2 regra 3, escritor estrito: o cliente só escreve `v` que conhece por inteiro. `v`
 * desconhecido na leitura é `IGNORED` no estágio 2 de §8.2 — nunca para a projeção — e leva
 * a comunidade a `partialInterpretation = true`, o que bloqueia escrita local com
 * `E_VERSION_UNSUPPORTED` (regra 5).
 */
export const OP_VERSION = 1;

export function isSupportedVersion(v: number): boolean {
  return v === OP_VERSION;
}
