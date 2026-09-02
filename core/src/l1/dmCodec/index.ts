// `dmCodec` — L1. Encode/decode de `DmOp` e `DmEnvelope` por `DM_VERSION`, a forma canônica,
// e a verificação de assinatura e de AEAD **sobre material que ele mesmo constrói** (§31.4).
//
// §4 dá a este módulo a coluna "Depende de" vazia e uma única proibição: **validar
// semântica**. Aqui só se decide se os bytes casam o layout e se as duas provas
// criptográficas fecham sobre os bytes dados; se a op *pode* o que pede é assunto do
// `dmFold`.
//
//   DmOp       = { v:uint8, conversationId:bytes[32], kind:uint16, author:bytes[32],
//                  authorSeq:uint64, ts:uint64, ack:uint64, payload:bytes }
//   DmEnvelope = { op:bytes, sig:bytes[64] }
//                sig     = Ed25519(author, BLAKE2b('dm-op/1' ‖ op))
//                payload = XChaCha20-Poly1305(dmContentKey, dmNonce(op),
//                                             plaintext, aad = cabeçalho do DmOp)
//
// **Não há `HostRecord`, não há `hostTs`, não há `hostSig` e não há `flags`**: não existe
// host para carimbar coisa nenhuma (§31.4, §31.10). O índice no core faz o papel que o `seq`
// faz em §7.1, mas **não é ordem canônica** — a ordem canônica é §31.6, e mora no `dmFold`.
//
// Nenhuma função deste módulo lança: `decode*` e `open*` devolvem `null` (§31.7.1).

import sodium from 'sodium-native';

import { Reader, Writer } from './wire.ts';

export { Reader, Writer } from './wire.ts';
export {
  DM_KINDS,
  DM_KIND_NAMES,
  DM_OWN_ONLY,
  DM_PAYLOAD_LAYOUT,
  dmKindName,
  dmKindNumber,
  isKnownDmKind,
  type DmKindName,
  type DmKindNumber,
} from './kinds.ts';
export {
  DM_PAYLOAD_FIELDS,
  decodeDmPayload,
  encodeDmPayload,
  parseDmLayout,
  type DmAttachment,
  type DmBlobRef,
  type DmPayloadOf,
  type Field,
} from './payloads.ts';

// ─── Hash com prefixo de domínio (§5.2) ────────────────────────────────────────────────

/** §5.2: prefixo de domínio em todo hash. Reaproveitar prefixo é bug de segurança. */
function blake2b(outLen: number, domain: string, ...parts: Uint8Array[]): Buffer {
  const out = Buffer.allocUnsafe(outLen);
  sodium.crypto_generichash_batch(out, [Buffer.from(domain, 'utf8'), ...parts]);
  return out;
}

const SIG_LEN = sodium.crypto_sign_BYTES;
const KEY_LEN = sodium.crypto_sign_PUBLICKEYBYTES;
const NONCE_LEN = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
const AEAD_KEY_LEN = sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES;
const AEAD_TAG_LEN = sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES;

/**
 * Ed25519 (§5.1) sobre um digest já construído. **Nunca lança**, nem para tamanho errado: é
 * chamada do estágio 4 de §31.7.3, onde os bytes vêm do log e podem ser qualquer coisa.
 *
 * Mesma justificativa de `opCodec.verifySignature`: §4 dá a "verificação" a `identity`, que é
 * L0, e o `dmFold` não tem caminho declarado até lá. `dmCodec` é onde o material assinável é
 * construído, tem "Depende de" vazio, e conferir uma curva sobre bytes dados não é semântica.
 */
export function verifyDmSignature(
  sig: Uint8Array,
  digest: Uint8Array,
  publicKey: Uint8Array,
): boolean {
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

// ─── §31.2 — identidade da conversa ────────────────────────────────────────────────────

/**
 * §31.2 — `lo`/`hi` são as duas chaves públicas de identidade **ordenadas por byte,
 * ascendente**. Ordenar é o que torna `id(A,B) = id(B,A)` verdade sem convenção de "quem
 * começou". Devolve `null` quando `lo = hi`: conversa consigo mesmo não é conversa
 * (`E_VALIDATION.peerKey`).
 */
export function dmPairOrder(
  a: Uint8Array,
  b: Uint8Array,
): { lo: Buffer; hi: Buffer } | null {
  if (a.length !== KEY_LEN || b.length !== KEY_LEN) return null;
  const ba = Buffer.from(a.buffer, a.byteOffset, a.length);
  const bb = Buffer.from(b.buffer, b.byteOffset, b.length);
  const c = Buffer.compare(ba, bb);
  if (c === 0) return null;
  return c < 0 ? { lo: ba, hi: bb } : { lo: bb, hi: ba };
}

/** §31.2 — `BLAKE2b-256('dm-conv/1' ‖ lo ‖ hi)`, 32 B. Derivado, nunca atribuído. */
export function dmConversationKey(a: Uint8Array, b: Uint8Array): Buffer | null {
  const p = dmPairOrder(a, b);
  if (p === null) return null;
  return blake2b(32, 'dm-conv/1', p.lo, p.hi);
}

/** O mesmo identificador em hex64, que é a forma que atravessa o IPC (§31.2). */
export function dmConversationId(a: Uint8Array, b: Uint8Array): string | null {
  return dmConversationKey(a, b)?.toString('hex') ?? null;
}

// ─── §31.4 — estruturas assinadas ──────────────────────────────────────────────────────

export type DmOp = {
  readonly v: number;
  /** Os 32 bytes de §31.2, não o texto hex. */
  readonly conversationId: Buffer;
  readonly kind: number;
  readonly author: Buffer;
  readonly authorSeq: number;
  /** Relógio do autor, ms UTC. **Só exibição** — §31.6. */
  readonly ts: number;
  /** Quantos registros do log do par o autor havia interpretado. §31.6, §31.11. */
  readonly ack: number;
  /** Ciphertext AEAD (§31.3). */
  readonly payload: Buffer;
};

export type DmEnvelope = { readonly op: Buffer; readonly sig: Buffer };

/** O cabeçalho em claro de §31.4 — tudo menos o `payload`. É também a AAD do AEAD. */
export type DmHeader = Omit<DmOp, 'payload'>;

function writeHeader(w: Writer, h: DmHeader): Writer {
  return w
    .u8(h.v)
    .key(h.conversationId)
    .u16(h.kind)
    .key(h.author)
    .u64(h.authorSeq)
    .u64(h.ts)
    .u64(h.ack);
}

/**
 * Forma canônica de §31.4 (as cinco regras de §7.2, com `DM_VERSION` no lugar de
 * `opVersion`): campos na ordem declarada, sem padding, opcional ausente não é escrito. Como
 * o layout é inteiramente determinado, **a forma canônica é o encoding**.
 */
export function encodeDmOp(op: DmOp): Buffer {
  return writeHeader(new Writer(), op).bytes(op.payload).toBuffer();
}

export function decodeDmOp(buf: Uint8Array): DmOp | null {
  const r = new Reader(buf);
  const op: DmOp = {
    v: r.u8(),
    conversationId: r.key(),
    kind: r.u16(),
    author: r.key(),
    authorSeq: r.u64(),
    ts: r.u64(),
    ack: r.u64(),
    payload: r.bytes(),
  };
  // §7.2 regra 2 — leitor tolerante: bytes sobrando no fim são ignorados.
  return r.failed ? null : op;
}

export function encodeDmEnvelope(e: DmEnvelope): Buffer {
  return new Writer().bytes(e.op).sig(e.sig).toBuffer();
}

export function decodeDmEnvelope(buf: Uint8Array): DmEnvelope | null {
  const r = new Reader(buf);
  const op = r.bytes();
  const sig = r.sig();
  return r.failed ? null : { op, sig };
}

/**
 * O cabeçalho em claro, sem tocar no `payload` nem na AEAD.
 *
 * Existe porque **a ordem de §31.6 é computável sem a chave de conteúdo**, e é isso que o
 * cabeçalho em claro compra (§31.4). O planejador do merge precisa só de `ack`, e pagar um
 * decode de payload e um Ed25519 por registro para descobrir o `ack` transformaria o merge
 * de dois ponteiros num fold completo.
 */
export function peekDmHeader(rec: Uint8Array): DmHeader | null {
  const env = decodeDmEnvelope(rec);
  if (env === null) return null;
  const op = decodeDmOp(env.op);
  if (op === null) return null;
  const { v, conversationId, kind, author, authorSeq, ts, ack } = op;
  return { v, conversationId, kind, author, authorSeq, ts, ack };
}

// ─── Material assinável e derivações de §31.3 ──────────────────────────────────────────

/** `BLAKE2b('dm-op/1' ‖ op)` — o que o autor assina (§31.4). */
export function dmOpSigningHash(opBytes: Uint8Array): Buffer {
  return blake2b(32, 'dm-op/1', opBytes);
}

/**
 * `BLAKE2b('dm-core-possession/1' ‖ conversationId ‖ dmPublicKey)` — a prova de que aquele
 * core foi designado por aquela identidade para aquela conversa (§31.3, RD-1). Mesma forma
 * de R-19, e é o par durável do `coreProof` vivo do handshake de §31.8(3).
 */
export function dmCorePossessionHash(
  conversationId: Uint8Array,
  dmPublicKey: Uint8Array,
): Buffer {
  return blake2b(32, 'dm-core-possession/1', conversationId, dmPublicKey);
}

/**
 * `BLAKE2b-192('dm-nonce/1' ‖ conversationId ‖ author ‖ authorSeq)` — §31.3.
 *
 * **Derivado, nunca armazenado.** `(author, authorSeq)` é único por construção (RD-3), então
 * não há reuso de nonce e o registro não carrega 24 bytes que qualquer um dos dois lados
 * recomputa. `authorSeq` entra little-endian, o mesmo layout do campo na `DmOp`.
 */
export function dmNonce(
  conversationId: Uint8Array,
  author: Uint8Array,
  authorSeq: number,
): Buffer {
  return blake2b(NONCE_LEN, 'dm-nonce/1', conversationId, author, new Writer().u64(authorSeq).toBuffer());
}

/**
 * `dmShared     = X25519(x25519_from_ed25519_sk(sk_próprio), x25519_from_ed25519_pk(pk_do_par))`
 * `dmContentKey = BLAKE2b-256('dm-content/1' ‖ dmShared ‖ conversationId)` — §31.3.
 *
 * **Simétrica e estática**: os dois lados a computam do próprio segredo de identidade e da
 * chave pública do outro, e ela nunca é transmitida, cifrada nem embrulhada — não existe em
 * repouso em lugar nenhum (§31.3 regra 3). O `conversationId` entra como os **32 bytes** de
 * §31.2, não como o hex64 do IPC, pelo mesmo motivo que em `dmNonce`.
 *
 * Mora aqui, e não no `directMessages`, porque é material de AEAD: os únicos consumidores são
 * `sealDmPayload`/`openDmPayload` e o `DmContext` do `dmFold`. §4 dá a `dmCodec` a coluna
 * "Depende de" vazia, e derivar uma chave sobre bytes dados não é "validar semântica" — é o
 * mesmo argumento que põe `verifyDmSignature` neste módulo.
 *
 * `dmShared` é **zerado** antes do retorno (§31.3 regra 5, item 4 de §3.2). Devolve `null`
 * para tamanho errado ou chave de identidade que não converte para X25519 — nunca lança.
 */
export function dmContentKey(
  identitySecretKey: Uint8Array,
  peerIdentityPublicKey: Uint8Array,
  conversationId: Uint8Array,
): Buffer | null {
  if (identitySecretKey.length !== sodium.crypto_sign_SECRETKEYBYTES) return null;
  if (peerIdentityPublicKey.length !== KEY_LEN) return null;
  if (conversationId.length !== 32) return null;
  const curveSk = Buffer.alloc(sodium.crypto_box_SECRETKEYBYTES);
  const curvePk = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES);
  const shared = Buffer.alloc(sodium.crypto_scalarmult_BYTES);
  try {
    sodium.crypto_sign_ed25519_sk_to_curve25519(
      curveSk,
      Buffer.from(identitySecretKey.buffer, identitySecretKey.byteOffset, identitySecretKey.length),
    );
    sodium.crypto_sign_ed25519_pk_to_curve25519(
      curvePk,
      Buffer.from(peerIdentityPublicKey.buffer, peerIdentityPublicKey.byteOffset, peerIdentityPublicKey.length),
    );
    sodium.crypto_scalarmult(shared, curveSk, curvePk);
    return blake2b(AEAD_KEY_LEN, 'dm-content/1', shared, conversationId);
  } catch {
    return null;
  } finally {
    sodium.sodium_memzero(curveSk);
    sodium.sodium_memzero(shared);
  }
}

/** A AAD do AEAD: o cabeçalho de §31.4, na forma canônica. */
export function dmAad(h: DmHeader): Buffer {
  return writeHeader(new Writer(), h).toBuffer();
}

/**
 * XChaCha20-Poly1305 sobre `plaintext`, com o nonce derivado e o cabeçalho como AAD (§31.3,
 * §31.4). Devolve `null` quando a chave tem tamanho errado — nunca lança.
 */
export function sealDmPayload(
  contentKey: Uint8Array,
  h: DmHeader,
  plaintext: Uint8Array,
): Buffer | null {
  if (contentKey.length !== AEAD_KEY_LEN) return null;
  try {
    const out = Buffer.allocUnsafe(plaintext.length + AEAD_TAG_LEN);
    sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      out,
      Buffer.from(plaintext.buffer, plaintext.byteOffset, plaintext.length),
      dmAad(h),
      null,
      dmNonce(h.conversationId, h.author, h.authorSeq),
      Buffer.from(contentKey.buffer, contentKey.byteOffset, contentKey.length),
    );
    return out;
  } catch {
    return null;
  }
}

/**
 * O inverso. Devolve `null` quando a AEAD não abre — que o estágio 8 de §31.7.3 mapeia para
 * `REJECTED`/`E_BAD_SIGNATURE`, **não** para `E_MALFORMED`: a AEAD falhar é falha de
 * autenticidade, não de sintaxe.
 */
export function openDmPayload(
  contentKey: Uint8Array,
  h: DmHeader,
  ciphertext: Uint8Array,
): Buffer | null {
  if (contentKey.length !== AEAD_KEY_LEN) return null;
  if (ciphertext.length < AEAD_TAG_LEN) return null;
  try {
    const out = Buffer.allocUnsafe(ciphertext.length - AEAD_TAG_LEN);
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      out,
      null,
      Buffer.from(ciphertext.buffer, ciphertext.byteOffset, ciphertext.length),
      dmAad(h),
      dmNonce(h.conversationId, h.author, h.authorSeq),
      Buffer.from(contentKey.buffer, contentKey.byteOffset, contentKey.length),
    );
    return out;
  } catch {
    return null;
  }
}

// ─── Versão ────────────────────────────────────────────────────────────────────────────

/**
 * §31.4 — **versão de protocolo própria da conversa direta, independente de `opVersion`**.
 * O escritor é estrito: só se escreve `v` que este binário conhece por inteiro. `v`
 * desconhecido na leitura é `IGNORED` no estágio 1 de §31.7.3 — nunca para a projeção — e
 * leva **aquela conversa** a `partialInterpretation = true`, o que bloqueia escrita local
 * nela com `E_VERSION_UNSUPPORTED`.
 */
export const DM_VERSION = 1;

export function isSupportedDmVersion(v: number): boolean {
  return v === DM_VERSION;
}
