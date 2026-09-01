// Ponte para o núcleo REAL (`@comunidade/core`) — mesmo padrão do `poc-12-g12/src/core.ts`.
//
// **É a regra do gate.** §31.26 mede o `dmFold` e o merge do PRODUTO; um segundo `dmFold`
// dentro do `poc/` mediria o harness. Tudo o que interpreta registro aqui vem de
// `core/dist/src/l1/`. O que o harness constrói é só o que ainda não existe como produto —
// o projetor de §31.12 e o `self_high_water` de §31.13 são B56 e B57, e os dois estão
// bloqueados por este gate.
//
// O `dist` do núcleo não emite `.d.ts`; a superfície usada está declarada aqui e os módulos
// compilados são importados por caminho relativo ao ARQUIVO COMPILADO (`dist/src` → 4
// níveis). Descartável.

// ─── superfície mínima usada ────────────────────────────────────────────────────────────

export type DmOrigin = 'lo' | 'hi';

export type DmDecision = 'APPLIED' | 'REJECTED' | 'IGNORED';

export type DmPrimitive = string | number | null | Buffer;

export type DmEffect =
  | { t: 'upsert'; table: string; key: readonly DmPrimitive[]; row: Record<string, DmPrimitive> }
  | { t: 'patch'; table: string; key: readonly DmPrimitive[]; fields: Record<string, DmPrimitive> }
  | { t: 'delete'; table: string; key: readonly DmPrimitive[] }
  | { t: 'notify'; topic: string; data: object };

export type DmMessageMeta = {
  author: Buffer;
  ordSum: number;
  authorSeq: number;
  deletedAt?: number;
  editedAt?: number;
  replyToId?: string;
  hasAttachment: boolean;
  reactionEmojis: Set<string>;
};

export type DmSideState = {
  identityKey: Buffer;
  coreKey?: Buffer;
  displayName: string;
  avatarColor: number;
  length: number;
  lastAuthorSeq: number;
  lastAck: number;
  lastTs: number;
  invalid: boolean;
  blobsCoreKey?: Buffer;
  tsWindow: readonly number[];
  tsWindowBase: number;
};

export type DmState = {
  readonly conversationId: string;
  readonly conversationKey: Buffer;
  interpretedOrdSum: number;
  dmVersionSeen: number;
  partialInterpretation: boolean;
  sides: { readonly lo: DmSideState; readonly hi: DmSideState };
  messages: Map<string, DmMessageMeta>;
};

export type DmContext = {
  readonly conversationId: string;
  readonly conversationKey: Buffer;
  readonly loKey: Buffer;
  readonly hiKey: Buffer;
  readonly contentKey: Uint8Array;
  readonly loCoreKey?: Buffer;
  readonly hiCoreKey?: Buffer;
};

export type DmFoldResult = {
  readonly decision: DmDecision;
  readonly reason?: string;
  readonly field?: string;
  readonly kind?: number;
  readonly author?: Buffer;
  readonly messageId?: string;
  readonly ordSum: number;
  readonly tsClamped?: boolean;
  readonly ackAhead?: boolean;
  readonly clockSkewed?: boolean;
  readonly effects: readonly DmEffect[];
  readonly next: DmState;
};

export type DmOrdRef = { readonly origin: DmOrigin; readonly index: number; readonly ordSum: number };

export type DmFoldMetrics = {
  panic: number;
  tsClamped: number;
  ackAhead: number;
  clockSkewed: number;
  idCollision: number;
  applied: number;
  rejected: number;
  ignored: number;
  rejectedBy: Map<string, number>;
  ignoredBy: Map<string, number>;
};

export type Keypair = { publicKey: Buffer; secretKey: Buffer };

export type DmSide = {
  readonly origin: DmOrigin;
  readonly identity: Keypair;
  readonly core: Keypair;
  readonly blobs: Keypair;
};

export type DmWorld = {
  readonly conversationKey: Buffer;
  readonly conversationId: string;
  readonly contentKey: Buffer;
  readonly lo: DmSide;
  readonly hi: DmSide;
  readonly ctx: DmContext;
  state(): DmState;
  side(o: DmOrigin): DmSide;
};

export type DmRecordOptions = {
  kind: string;
  payload: Record<string, unknown>;
  authorSeq: number;
  ack: number;
  ts?: number;
  v?: number;
  kindNumber?: number;
  conversationKey?: Buffer;
  author?: Buffer;
  signWith?: Buffer;
  contentKey?: Buffer;
  corruptSig?: boolean;
};

function dist(rel: string): string {
  return new URL(rel, import.meta.url).href;
}

// ─── `dmFold` e `dmCodec` do PRODUTO ────────────────────────────────────────────────────

const foldMod = (await import(dist('../../../../core/dist/src/l1/dmFold/index.js'))) as unknown as {
  dmFoldRecord(
    prev: DmState,
    rec: Uint8Array,
    origin: DmOrigin,
    index: number,
    dm: DmContext,
    metrics?: DmFoldMetrics,
  ): DmFoldResult;
  dmFoldLogs(
    inicial: DmState,
    lo: readonly Uint8Array[],
    hi: readonly Uint8Array[],
    dm: DmContext,
    metrics?: DmFoldMetrics,
  ): { order: readonly DmOrdRef[]; results: readonly DmFoldResult[]; state: DmState };
  mergeRecords(lo: readonly Uint8Array[], hi: readonly Uint8Array[]): DmOrdRef[];
  newDmMetrics(): DmFoldMetrics;
  countDmResult(m: DmFoldMetrics, r: DmFoldResult): void;
  limparPanico(): void;
  emptyDmState(conversationKey: Buffer, lo: Buffer, hi: Buffer, conversationId?: string): DmState;
  readonly ultimoPanico: { ordSum: number; err: string } | null;
  DM_MAX_ENVELOPE_BYTES_ATTACHMENT: number;
};

const codecMod = (await import(dist('../../../../core/dist/src/l1/dmCodec/index.js'))) as unknown as {
  DM_VERSION: number;
  peekDmHeader(rec: Uint8Array): { ack: number; authorSeq: number; ts: number; kind: number } | null;
};

/**
 * O **cabo de escrita** dos testes do núcleo (`core/test/helpers/dm.ts`). Ele escreve o
 * registro que o produto só lê, e a derivação segue §31.2/§31.3 literalmente. Reusá-lo é o
 * que garante que o corpus deste gate e o do ensaio de unidade falem do mesmo material;
 * reimplementá-lo aqui abriria a porta para o harness medir a própria fixture.
 */
const cabo = (await import(dist('../../../../core/dist/test/helpers/dm.js'))) as unknown as {
  dmWorld(a?: string, b?: string): DmWorld;
  dmKeypair(label: string): Keypair;
  dmRecord(world: DmWorld, side: DmSide, o: DmRecordOptions): Buffer;
  dmHello(world: DmWorld, side: DmSide, extra?: Record<string, unknown>): Buffer;
  DM_T0: number;
};

export const dmFoldRecord = foldMod.dmFoldRecord;
export const dmFoldLogs = foldMod.dmFoldLogs;
export const mergeRecords = foldMod.mergeRecords;
export const newDmMetrics = foldMod.newDmMetrics;
export const countDmResult = foldMod.countDmResult;
export const limparPanico = foldMod.limparPanico;
export const emptyDmState = foldMod.emptyDmState;
export const DM_MAX_ENVELOPE_BYTES_ATTACHMENT = foldMod.DM_MAX_ENVELOPE_BYTES_ATTACHMENT;
export const DM_VERSION = codecMod.DM_VERSION;
export const peekDmHeader = codecMod.peekDmHeader;

export const dmWorld = cabo.dmWorld;
export const dmKeypair = cabo.dmKeypair;
export const dmRecord = cabo.dmRecord;
export const dmHello = cabo.dmHello;
export const DM_T0 = cabo.DM_T0;

/** O último pânico registrado pelo `dmFold`, lido do módulo do produto (é um `let`). */
export function ultimoPanico(): { ordSum: number; err: string } | null {
  return foldMod.ultimoPanico;
}
