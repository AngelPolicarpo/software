// Ponte para o núcleo REAL (@comunidade/core) — mesmo padrão do poc-09-g8. O dist não
// emite .d.ts; a superfície usada está declarada aqui e os módulos compilados são
// importados por caminho relativo ao ARQUIVO COMPILADO (dist/src → 4 níveis). Descartável.

// ─── superfície mínima usada ────────────────────────────────────────────────────────────

export interface DecisionState {
  readonly communityId: string;
  interpretedSeq: number;
  lastHostTs: number;
  community: {
    exists: boolean;
    hostKey: Buffer;
    name: string;
    iconColor: number;
    endedAt?: number;
    successorKeys: Buffer[];
    originCommunityId?: string;
    originFinalSeq?: number;
  };
  members: Map<string, { state: 'active' | 'left' | 'banned'; displayName: string }>;
  roles: Map<string, { name: string; deletedAt?: number }>;
  categories: Map<string, { name: string; deletedAt?: number }>;
  channels: Map<string, { name: string; deletedAt?: number }>;
  messages: Map<string, unknown>;
  invites: Map<string, unknown>;
  relays: Map<string, unknown>;
}

export interface FoldResultLike {
  decision: 'APPLIED' | 'REJECTED' | 'IGNORED' | 'ABSORBED';
  reason?: string;
  next: DecisionState;
}

function dist(rel: string): string {
  return new URL(rel, import.meta.url).href;
}

const foldMod = (await import(dist('../../../../core/dist/src/l1/fold/index.js'))) as unknown as {
  emptyState(communityKey: Buffer, communityId?: string): DecisionState;
  foldRecord(prev: DecisionState, rec: Uint8Array, seq: number, metrics?: unknown): FoldResultLike;
  newMetrics(): Record<string, number>;
};

const worldMod = (await import(dist('../../../../core/dist/test/helpers/world.js'))) as unknown as {
  genesis(world?: unknown, founder?: unknown): {
    world: {
      state: DecisionState;
      core: { publicKey: Buffer; secretKey: Buffer };
      log: readonly Uint8Array[];
      seq: number;
      next(author: { publicKey: Buffer }): number;
      push(rec: Buffer): void;
      submit(o: { kind: string; author: { publicKey: Buffer }; hostTs: number; payload: Record<string, unknown> }): unknown;
      id(kind: string, author: { publicKey: Buffer }, seq: number): string;
    };
    founder: { publicKey: Buffer; secretKey: Buffer };
    categoryId: string;
    channelId: string;
  };
  joinMember(g: ReturnType<typeof worldMod.genesis>, label: string, hostTs?: number): { publicKey: Buffer; secretKey: Buffer };
  keypairFromSeed(label: string): { publicKey: Buffer; secretKey: Buffer };
};

const successionMod = (await import(dist('../../../../core/dist/src/l2/succession/index.js'))) as unknown as {
  sealSeedFor(targetIdentityPublicKey: Buffer, communitySeed: Buffer): Buffer;
  openSealedSeed(wrappedSeed: Uint8Array, identityPublicKey: Buffer, identitySecretKey: Buffer): Buffer | null;
  InactivityWatch: new (opts: { ttlMs: number }) => {
    ttlMs: number;
    isInactive(lastOriginLogTs: number, now: number): boolean;
    graceRemainingMs(lastOriginLogTs: number, now: number): number;
  };
  planContinuation(input: {
    originState: DecisionState;
    originCoreSecretKey: Buffer;
    successorIdentity: { publicKey: Buffer; secretKey: Buffer };
    newCoreSeed?: Buffer;
    newBlobsSeed?: Buffer;
    hostTs?: number;
  }): {
    newCoreKeyPair: { publicKey: Buffer; secretKey: Buffer };
    records: Buffer[];
    originCommunityIdHex: string;
    originFinalSeq: number;
    proof: Buffer;
    roleIdByOld: ReadonlyMap<string, string>;
    categoryIdByOld: ReadonlyMap<string, string>;
    channelIdByOld: ReadonlyMap<string, string>;
  };
  evaluateLayerB(args: {
    claim: { communityIdHex: string; originCommunityIdHex: string; originFinalSeq: number; assumedByHex: string };
    origin: { communityIdHex: string; successorKeysHex: readonly string[]; lastHostTs: number; endedAt?: number };
    ttlMs: number;
    now: number;
  }): { ok: true; priorityIndex: number } | { ok: false; reason: string };
  chooseContinuation<T extends { claim: { communityIdHex: string; assumedByHex: string }; priorityIndex: number }>(
    candidates: readonly T[],
  ): { chosen: T; orphans: T[] } | null;
  dispositionFor(args: {
    claim: { communityIdHex: string; originCommunityIdHex: string; originFinalSeq: number; assumedByHex: string };
    origin: { communityIdHex: string; successorKeysHex: readonly string[]; lastHostTs: number; endedAt?: number } | null;
    ttlMs: number;
    now: number;
  }): { migrate: true } | { migrate: false; disputed: true; reason: string };
};

const opCodecMod = (await import(dist('../../../../core/dist/src/l1/opCodec/index.js'))) as unknown as {
  verifySignature(sig: Uint8Array, digest: Uint8Array, publicKey: Uint8Array): boolean;
  decodeHostRecord(buf: Uint8Array): { envelope: Uint8Array; hostTs: number; flags: number; hostSig: Uint8Array } | null;
  decodeEnvelope(e: Uint8Array): { op: Uint8Array; sig: Uint8Array } | null;
  decodeOp(bytes: Uint8Array): { kind: number; author: Uint8Array; authorSeq: number; payload: Uint8Array } | null;
  decodePayload(kind: 'community.escrow', buf: Uint8Array): { targetKey: Buffer; wrappedSeed: Buffer } | null;
  relayPossessionSigningHash(relayPublicKey: Uint8Array): Buffer;
  opSigningHash(op: Uint8Array): Buffer;
};

const constantsMod = (await import(dist('../../../../core/dist/src/l1/fold/constants.js'))) as unknown as {
  HOST_INACTIVITY_MS: number;
  MAX_SUCCESSORS: number;
};

const sodiumMod = (await import(dist('../../../../core/node_modules/sodium-native/index.js')).catch(() =>
  import('sodium-native'),
)) as unknown as typeof import('sodium-native');

export const core = {
  emptyState: foldMod.emptyState,
  foldRecord: foldMod.foldRecord,
  newMetrics: foldMod.newMetrics,
  genesis: worldMod.genesis,
  joinMember: worldMod.joinMember,
  keypairFromSeed: worldMod.keypairFromSeed,
  sealSeedFor: successionMod.sealSeedFor,
  openSealedSeed: successionMod.openSealedSeed,
  InactivityWatch: successionMod.InactivityWatch,
  planContinuation: successionMod.planContinuation,
  evaluateLayerB: successionMod.evaluateLayerB,
  chooseContinuation: successionMod.chooseContinuation,
  dispositionFor: successionMod.dispositionFor,
  verifySignature: opCodecMod.verifySignature,
  decodeHostRecord: opCodecMod.decodeHostRecord,
  decodeEnvelope: opCodecMod.decodeEnvelope,
  decodeOp: opCodecMod.decodeOp,
  decodePayload: opCodecMod.decodePayload,
  relayPossessionSigningHash: opCodecMod.relayPossessionSigningHash,
  opSigningHash: opCodecMod.opSigningHash,
  HOST_INACTIVITY_MS: constantsMod.HOST_INACTIVITY_MS,
  MAX_SUCCESSORS: constantsMod.MAX_SUCCESSORS,
  sodium: sodiumMod,
};
