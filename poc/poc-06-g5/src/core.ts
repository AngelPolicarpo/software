// Carregador do código de produto (core/dist) — o gate exercita o módulo publicado
// pela fase 6, não uma reimplementação. Os tipos aqui são duplicatas locais mínimas:
// o core não emite .d.ts e este harness é descartável.

import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export const CORE_DIST = join(process.cwd(), '..', '..', 'core', 'dist', 'src');

// ── Duplicatas locais das superfícies usadas (backend-v2.md §13, §11) ─────────

export type BlobKindNumber = 0 | 1 | 2 | 3 | 4 | 5;

export interface StagingTicket {
  readonly ticketId: string;
  readonly path: string;
  readonly sizeBytes: number;
  readonly communityId: string;
  readonly createdAt: number;
  readonly name: string;
  readonly kind: BlobKindNumber;
}

export interface TicketIssue {
  readonly ticketId: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly kind: BlobKindNumber;
}

export interface StageResult {
  readonly blobsCoreKey: Buffer;
  readonly blobId: { byteOffset: number; blockOffset: number; blockLength: number; byteLength: number };
  readonly blobIdHex: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly kind: BlobKindNumber;
  readonly hash: Buffer;
}

export interface CacheRow {
  blobsCoreKeyHex: string;
  blobIdHex: string;
  bytesDownloaded: number;
  state: string;
  path: string | null;
  verifiedAt: number | null;
  declaredSize: number | null;
}

export interface StagingRow {
  ticketId: string;
  path: string;
  bytesWritten: number;
  state: string;
  communityId: string | null;
  sizeBytes: number | null;
  name: string | null;
  kind: number | null;
  hash: Buffer | null;
  createdAt: number | null;
}

export interface BlobManagerLike {
  manifest: { raw: unknown };
  tickets: {
    issue(communityId: string, filePath: string, sizeBytes: number): TicketIssue;
    ingest(ticket: StagingTicket): void;
    consume(ticketId: string, expectedCommunityId?: string): StagingTicket;
    peek(ticketId: string): StagingTicket | null;
    pruneExpired(now?: number): number;
    size(): number;
  };
  staging: {
    get(ticketId: string): StagingRow | null;
    list(): StagingRow[];
    listByState(state: string): StagingRow[];
    updateProgress(ticketId: string, bytesWritten: number, rollingHashState?: Buffer | null): void;
    markDone(ticketId: string, hash: Buffer, bytesWritten: number): void;
    markFailed(ticketId: string): void;
    remove(ticketId: string): void;
  };
  cache: {
    get(blobsCoreKey: Buffer | string, blobIdHex: string): CacheRow | null;
    upsert(row: { blobsCoreKey: Buffer; blobIdHex: string; state: string; bytesDownloaded?: number; declaredSize?: number | null; path?: string | null }): void;
    setState(blobsCoreKey: Buffer | string, blobIdHex: string, state: string, extra?: { bytesDownloaded?: number; path?: string | null; declaredSize?: number }): void;
  };
  ingestTicket(ticket: StagingTicket): TicketIssue;
  createTicketForMain(communityId: string, filePath: string, sizeBytes: number): StagingTicket;
  stage(
    ticketId: string,
    opts?: { blobsCoreKey?: Buffer; identitySeed?: Buffer; communityId?: string },
  ): Promise<StageResult>;
  assertReadyForMessage(ticketId: string): void;
  isStagedDone(ticketId: string): boolean;
  download(opts: { blobsCoreKey: Buffer; blobIdHex: string; declaredSize: number; hash: Buffer; name: string }): Promise<{ path: string }>;
  cancelDownload(blobsCoreKey: Buffer | string, blobIdHex: string): void;
  getDownloadState(blobsCoreKey: Buffer | string, blobIdHex: string): string | null;
  resumeOnBoot(): { stagingResumed: number; stagingDiscarded: number; downloadsResumed: number };
  gcStaging(opts: { hasReference: (row: StagingRow) => boolean; clearBlobs: (row: StagingRow) => void; now?: number }): { removed: number; cleared: number };
  gcCache(opts: { isProtected: (row: CacheRow) => boolean; now?: number }): { removed: number; freedBytes: number };
  canReveal(blobsCoreKey: Buffer | string, blobIdHex: string): { allowed: boolean; reason?: string };
}

export interface BlobsApi {
  BLOB_KIND: { image: 0; video: 1; audio: 2; document: 3; archive: 4; other: 5 };
  STAGING_TICKET_TTL_MS_DEFAULT: number;
  STAGING_ORPHAN_MS_DEFAULT: number;
  deriveMemberBlobsSeed(identitySeed: Buffer, communityId: string | Buffer): Buffer;
  deriveMemberBlobsKeypair(identitySeed: Buffer, communityId: string | Buffer): { publicKey: Buffer; secretKey: Buffer; seed: Buffer };
  deriveMemberBlobsPublicKey(identitySeed: Buffer, communityId: string | Buffer): Buffer;
  discoveryKeyForBlobsCoreKey(blobsCoreKey: Buffer): Buffer;
  hashForBlobContent(content: Buffer): Buffer;
  kindFromExtension(ext: string): BlobKindNumber;
  kindFromFilename(nameOrPath: string): BlobKindNumber;
  isExecutableExtension(extOrName: string): boolean;
  isInlineImageAllowed(extOrName: string): boolean;
  isRevealAllowed(kind: BlobKindNumber, extOrName: string): boolean;
  isValidAttachmentName(name: string): boolean;
  TicketStore: new (opts?: { ttlMs?: number; clock?: () => number }) => BlobManagerLike['tickets'];
  BlobManager: BlobManagerCtor;
}

export interface BlobManagerCtor {
  new (opts: {
    manifest: { raw: unknown };
    swarm: SwarmLike;
    dataDir?: string;
    clock?: () => number;
    ttlMs?: number;
    orphanMs?: number;
    cacheMaxBytes?: number;
  }): BlobManagerLike;
  exceedsQuota(storageUsedBytes: number, sizeBytes: number): boolean;
  exceedsCache(maxBytes: number, currentBytes: number, newBytes: number): boolean;
}

export interface SwarmLike {
  join(topicHex: string, topic: unknown): void;
  leave(topicHex: string): void;
  isJoined(topicHex: string): boolean;
}

export interface ManifestDbLike {
  raw: {
    prepare(sql: string): { run(...v: unknown[]): unknown; get(...v: unknown[]): unknown; all(...v: unknown[]): unknown[] };
  };
  close(): void;
  enqueue(input: Record<string, unknown>): { enqueued: boolean; localSeq: number | null };
  nextAuthorSeq(communityId: string, sequenceScope: string): number;
  countActive(communityId: string): number;
}

export interface OutboxLike {
  metrics: Record<string, unknown>;
  nextAuthorSeq(sequenceScope: string): number;
  enqueue(envelope: Buffer, meta: Record<string, unknown>, now?: number): { enqueued: boolean; localSeq: number | null; code?: string };
  flush(): Promise<number>;
  reconcile(now?: number): { removed: number; mismatch: number; expired: number };
}

export interface CoreApi {
  blobs: BlobsApi;
  ManifestDb: new (path: string) => ManifestDbLike;
  Swarm: new (opts?: Record<string, unknown>) => SwarmLike;
  Outbox: new (opts: {
    manifest: ManifestDbLike;
    communityId: string;
    submit: (envelopes: readonly Buffer[]) => Promise<readonly { ok: true; seq: number }[] | readonly { ok: false; code: string }[] | null>;
    observation: { observedOp(opId: string): { seq: number } | null; watermark(item: unknown): number; interpretedSeq(): number };
    now?: () => number;
    random?: () => number;
    maxItems?: number;
  }) => OutboxLike;
}

async function importCoreModule(rel: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(join(CORE_DIST, rel)).href)) as Record<string, unknown>;
}

/** Carrega os módulos de produto compilados (npm run build do core roda antes, no run-all). */
export async function loadCore(): Promise<CoreApi> {
  const blobs = (await importCoreModule('l2/blobs/index.js')) as unknown as BlobsApi;
  const manifest = await importCoreModule('l0/manifest/index.js');
  const swarm = await importCoreModule('l0/swarm/index.js');
  const outbox = await importCoreModule('l2/outbox/index.js');
  return {
    blobs,
    ManifestDb: manifest['ManifestDb'] as CoreApi['ManifestDb'],
    Swarm: swarm['Swarm'] as CoreApi['Swarm'],
    Outbox: outbox['Outbox'] as CoreApi['Outbox'],
  };
}
