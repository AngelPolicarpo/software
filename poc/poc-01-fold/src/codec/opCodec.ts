/**
 * `opCodec` — backend-v2.md §7.1 (estruturas assinadas), §7.2 (encoding), §7.2.1
 * (layout dos primitivos), §7.3 (forma canonica e `opId`).
 *
 *   Op         = { v:uint8, communityId:bytes[32], kind:uint16, author:bytes[32],
 *                  authorSeq:uint64, ts:uint64, payload:bytes }
 *   Envelope   = { op:bytes, sig:bytes[64] }
 *                sig = Ed25519(author, BLAKE2b('op/1' ‖ op))
 *   HostRecord = { envelope:bytes, hostTs:uint64, flags:uint8, hostSig:bytes[64] }
 *                hostSig = Ed25519(coreKeyPair, BLAKE2b('hostrec/1' ‖ envelope ‖ hostTs ‖ flags))
 *
 * FORMA CANONICA (§7.2): campos na ordem declarada, sem padding, campo opcional ausente
 * nao e escrito (so o byte de presenca). Como o layout e totalmente determinado, a forma
 * canonica E o encoding: `opId = BLAKE2b-256('opid/1' ‖ encodeEnvelope(env))`.
 *
 * NENHUMA funcao deste modulo lanca. `decode*` devolve `null` em vez de excecao.
 */
import { Reader, Writer } from './wire.ts';
import { K } from '../protocol/kinds.ts';
import { OP_VERSION } from '../protocol/constants.ts';
import { blake2b256 } from '../crypto/index.ts';
import { opId } from './idgen.ts';

// ---------------------------------------------------------------------------------
// Estruturas de §7.1
// ---------------------------------------------------------------------------------

export type Op = {
  v: number;
  communityId: Buffer; // bytes[32] — a chave publica do core (§6.2)
  kind: number;
  author: Buffer; // bytes[32]
  authorSeq: number;
  ts: number;
  payload: Buffer;
};

export type Envelope = { op: Buffer; sig: Buffer };

export type HostRecord = { envelope: Buffer; hostTs: number; flags: number; hostSig: Buffer };

/** §7.1: bit 0 `clockSkewed`; bits 1–7 reservados. Leitores ignoram bits desconhecidos. */
export const FLAG_CLOCK_SKEWED = 1;

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
  // §7.2 regra 2 — leitor tolerante: bytes sobrando no fim sao ignorados.
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

// ---------------------------------------------------------------------------------
// Material assinavel (§5.2, separacao de dominio)
// ---------------------------------------------------------------------------------

/** BLAKE2b('op/1' ‖ op) — o que o autor assina. */
export function opSigningHash(opBytes: Uint8Array): Buffer {
  return blake2b256('op/1', opBytes);
}

/**
 * BLAKE2b('hostrec/1' ‖ envelope ‖ hostTs ‖ flags) — o que o host assina.
 * `hostTs` e `flags` entram no layout do registry (u64 LE e u8), unica leitura possivel
 * de §7.1 combinada com §7.2.1.
 */
export function hostRecSigningHash(envelope: Uint8Array, hostTs: number, flags: number): Buffer {
  const tail = new Writer().u64(hostTs).u8(flags).toBuffer();
  return blake2b256('hostrec/1', envelope, tail);
}

/** §7.3 — `opId` sobre o envelope canonico. */
export function opIdOf(env: Envelope): string {
  return opId(encodeEnvelope(env));
}

// ---------------------------------------------------------------------------------
// Registry de payload por `kind` (§7.4). 15 dos 38 (escopo do POC-01).
// ---------------------------------------------------------------------------------

export type BlobRef = {
  blobsCoreKey: Buffer;
  byteOffset: number;
  blockOffset: number;
  blockLength: number;
  byteLength: number;
};

export type AttachmentRef = {
  blob: BlobRef;
  name: string;
  sizeBytes: number;
  kind: number;
  hash: Buffer;
};

export type PMessageSend = {
  channelId: string;
  content: string;
  mentions: string[];
  attachment?: AttachmentRef;
  replyToId?: string;
  threadId?: string;
};
export type PMessageDelete = { messageId: string; reason?: string };
export type PReactionSet = { messageId: string; emoji: string; present: boolean };
export type PChannelCreate = {
  categoryId: string;
  type: number;
  name: string;
  topic?: string;
  readOnlyForRoleIds: string[];
  afterRank?: string;
  beforeRank?: string;
};
export type PChannelUpdate = {
  channelId: string;
  name?: string;
  topic?: string;
  readOnlyForRoleIds?: string[];
};
export type PChannelDelete = { channelId: string };
export type PCategoryCreate = { name: string; afterRank?: string; beforeRank?: string };
export type PCategoryDelete = {
  categoryId: string;
  moveChannelsTo?: string;
  deleteChannels: boolean;
};
export type PRoleCreate = {
  name: string;
  color: number;
  permissions: number[];
  mentionable: boolean;
  afterRank?: string;
  beforeRank?: string;
};
export type PRoleUpdate = {
  roleId: string;
  name?: string;
  color?: number;
  permissions?: number[];
  mentionable?: boolean;
};
export type PRoleDelete = { roleId: string };
export type PMemberSetRoles = { targetKey: Buffer; roleIds: string[] };
export type PMemberJoin = {
  invitePublicKey: Buffer;
  joinProof: Buffer;
  displayName: string;
  avatarColor: number;
  blobsCoreKey: Buffer;
};
export type PModBan = { targetKey: Buffer; reason?: string };
export type PInviteCreate = {
  invitePublicKey: Buffer;
  expiresAt?: number;
  maxUses?: number;
  label?: string;
};
export type PCommunityCreate = {
  name: string;
  iconEmoji?: string;
  iconColor: number;
  description?: string;
  blobsKey: Buffer;
  originCommunityId?: string;
  originFinalSeq?: number;
};

export type Payload =
  | PMessageSend
  | PMessageDelete
  | PReactionSet
  | PChannelCreate
  | PChannelUpdate
  | PChannelDelete
  | PCategoryCreate
  | PCategoryDelete
  | PRoleCreate
  | PRoleUpdate
  | PRoleDelete
  | PMemberSetRoles
  | PMemberJoin
  | PModBan
  | PInviteCreate
  | PCommunityCreate;

type Codec<T> = { encode: (w: Writer, v: T) => void; decode: (r: Reader) => T };

const rStr = (r: Reader): string => r.str();
const rId = (r: Reader): string => r.str(); // `id` = str (§7.2.1)
const rRank = (r: Reader): string => r.str(); // `rank` = str base62
const rU8 = (r: Reader): number => r.u8();
const wStr = (w: Writer, v: string): void => void w.str(v);
const wU8 = (w: Writer, v: number): void => void w.u8(v);

const blobRef: Codec<BlobRef> = {
  encode: (w, v) =>
    void w.key(v.blobsCoreKey).u64(v.byteOffset).u64(v.blockOffset).u64(v.blockLength).u64(v.byteLength),
  decode: (r) => ({
    blobsCoreKey: r.key(),
    byteOffset: r.u64(),
    blockOffset: r.u64(),
    blockLength: r.u64(),
    byteLength: r.u64(),
  }),
};

const attachment: Codec<AttachmentRef> = {
  encode: (w, v) => {
    blobRef.encode(w, v.blob);
    w.str(v.name).u64(v.sizeBytes).u8(v.kind).key(v.hash);
  },
  decode: (r) => ({
    blob: blobRef.decode(r),
    name: r.str(),
    sizeBytes: r.u64(),
    kind: r.u8(),
    hash: r.key(),
  }),
};

const REGISTRY = new Map<number, Codec<never>>();

function reg<T>(kind: number, codec: Codec<T>): void {
  REGISTRY.set(kind, codec as unknown as Codec<never>);
}

reg<PMessageSend>(K.MESSAGE_SEND, {
  encode: (w, v) => {
    w.str(v.channelId).str(v.content).arr(v.mentions, wStr);
    w.opt(v.attachment, (ww, a) => attachment.encode(ww, a));
    w.opt(v.replyToId, wStr).opt(v.threadId, wStr);
  },
  decode: (r) => ({
    channelId: rId(r),
    content: r.str(),
    mentions: r.arr(rStr),
    attachment: r.opt((rr) => attachment.decode(rr)),
    replyToId: r.opt(rId),
    threadId: r.opt(rId),
  }),
});

reg<PMessageDelete>(K.MESSAGE_DELETE, {
  encode: (w, v) => void w.str(v.messageId).opt(v.reason, wStr),
  decode: (r) => ({ messageId: rId(r), reason: r.opt(rStr) }),
});

reg<PReactionSet>(K.REACTION_SET, {
  encode: (w, v) => void w.str(v.messageId).str(v.emoji).bool(v.present),
  decode: (r) => ({ messageId: rId(r), emoji: r.str(), present: r.bool() }),
});

reg<PChannelCreate>(K.CHANNEL_CREATE, {
  encode: (w, v) => {
    w.str(v.categoryId).u8(v.type).str(v.name).opt(v.topic, wStr);
    w.arr(v.readOnlyForRoleIds, wStr).opt(v.afterRank, wStr).opt(v.beforeRank, wStr);
  },
  decode: (r) => ({
    categoryId: rId(r),
    type: r.u8(),
    name: r.str(),
    topic: r.opt(rStr),
    readOnlyForRoleIds: r.arr(rId),
    afterRank: r.opt(rRank),
    beforeRank: r.opt(rRank),
  }),
});

reg<PChannelUpdate>(K.CHANNEL_UPDATE, {
  encode: (w, v) => {
    w.str(v.channelId).opt(v.name, wStr).opt(v.topic, wStr);
    w.opt(v.readOnlyForRoleIds, (ww, ids) => void ww.arr(ids, wStr));
  },
  decode: (r) => ({
    channelId: rId(r),
    name: r.opt(rStr),
    topic: r.opt(rStr),
    readOnlyForRoleIds: r.opt((rr) => rr.arr(rId)),
  }),
});

reg<PChannelDelete>(K.CHANNEL_DELETE, {
  encode: (w, v) => void w.str(v.channelId),
  decode: (r) => ({ channelId: rId(r) }),
});

reg<PCategoryCreate>(K.CATEGORY_CREATE, {
  encode: (w, v) => void w.str(v.name).opt(v.afterRank, wStr).opt(v.beforeRank, wStr),
  decode: (r) => ({ name: r.str(), afterRank: r.opt(rRank), beforeRank: r.opt(rRank) }),
});

reg<PCategoryDelete>(K.CATEGORY_DELETE, {
  encode: (w, v) => void w.str(v.categoryId).opt(v.moveChannelsTo, wStr).bool(v.deleteChannels),
  decode: (r) => ({
    categoryId: rId(r),
    moveChannelsTo: r.opt(rId),
    deleteChannels: r.bool(),
  }),
});

reg<PRoleCreate>(K.ROLE_CREATE, {
  encode: (w, v) => {
    w.str(v.name).u8(v.color).arr(v.permissions, wU8).bool(v.mentionable);
    w.opt(v.afterRank, wStr).opt(v.beforeRank, wStr);
  },
  decode: (r) => ({
    name: r.str(),
    color: r.u8(),
    permissions: r.arr(rU8),
    mentionable: r.bool(),
    afterRank: r.opt(rRank),
    beforeRank: r.opt(rRank),
  }),
});

reg<PRoleUpdate>(K.ROLE_UPDATE, {
  encode: (w, v) => {
    w.str(v.roleId).opt(v.name, wStr).opt(v.color, wU8);
    w.opt(v.permissions, (ww, ps) => void ww.arr(ps, wU8)).opt(v.mentionable, (ww, b) => void ww.bool(b));
  },
  decode: (r) => ({
    roleId: rId(r),
    name: r.opt(rStr),
    color: r.opt(rU8),
    permissions: r.opt((rr) => rr.arr(rU8)),
    mentionable: r.opt((rr) => rr.bool()),
  }),
});

reg<PRoleDelete>(K.ROLE_DELETE, {
  encode: (w, v) => void w.str(v.roleId),
  decode: (r) => ({ roleId: rId(r) }),
});

reg<PMemberSetRoles>(K.MEMBER_SET_ROLES, {
  encode: (w, v) => void w.key(v.targetKey).arr(v.roleIds, wStr),
  decode: (r) => ({ targetKey: r.key(), roleIds: r.arr(rId) }),
});

reg<PMemberJoin>(K.MEMBER_JOIN, {
  encode: (w, v) =>
    void w.key(v.invitePublicKey).sig(v.joinProof).str(v.displayName).u8(v.avatarColor).key(v.blobsCoreKey),
  decode: (r) => ({
    invitePublicKey: r.key(),
    joinProof: r.sig(),
    displayName: r.str(),
    avatarColor: r.u8(),
    blobsCoreKey: r.key(),
  }),
});

reg<PModBan>(K.MOD_BAN, {
  encode: (w, v) => void w.key(v.targetKey).opt(v.reason, wStr),
  decode: (r) => ({ targetKey: r.key(), reason: r.opt(rStr) }),
});

reg<PInviteCreate>(K.INVITE_CREATE, {
  encode: (w, v) => {
    w.key(v.invitePublicKey)
      .opt(v.expiresAt, (ww, n) => void ww.u64(n))
      .opt(v.maxUses, (ww, n) => void ww.u32(n))
      .opt(v.label, wStr);
  },
  decode: (r) => ({
    invitePublicKey: r.key(),
    expiresAt: r.opt((rr) => rr.u64()),
    maxUses: r.opt((rr) => rr.u32()),
    label: r.opt(rStr),
  }),
});

reg<PCommunityCreate>(K.COMMUNITY_CREATE, {
  encode: (w, v) => {
    w.str(v.name).opt(v.iconEmoji, wStr).u8(v.iconColor).opt(v.description, wStr);
    w.key(v.blobsKey).opt(v.originCommunityId, wStr).opt(v.originFinalSeq, (ww, n) => void ww.u64(n));
  },
  decode: (r) => ({
    name: r.str(),
    iconEmoji: r.opt(rStr),
    iconColor: r.u8(),
    description: r.opt(rStr),
    blobsKey: r.key(),
    originCommunityId: r.opt(rStr),
    originFinalSeq: r.opt((rr) => rr.u64()),
  }),
});

export function isKnownKind(kind: number): boolean {
  return REGISTRY.has(kind);
}

export function encodePayload<T extends Payload>(kind: number, v: T): Buffer {
  const c = REGISTRY.get(kind);
  if (!c) throw new Error(`encodePayload: kind ${kind} sem layout (§7.2.1 fecha DR-10)`);
  const w = new Writer();
  (c as unknown as Codec<T>).encode(w, v);
  return w.toBuffer();
}

/**
 * Decodifica o payload de um `kind` conhecido. Devolve `null` quando o payload nao casa
 * o layout de §7.4 (estagio 2 -> `IGNORED` / `E_MALFORMED`). Bytes sobrando no fim sao
 * ignorados (§7.2 regra 2, leitor tolerante).
 */
export function decodePayload(kind: number, buf: Uint8Array): Payload | null {
  const c = REGISTRY.get(kind);
  if (!c) return null;
  const r = new Reader(buf);
  const v = (c as unknown as Codec<Payload>).decode(r);
  return r.failed ? null : v;
}

export function isSupportedVersion(v: number): boolean {
  return v === OP_VERSION;
}
