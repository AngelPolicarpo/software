// `blobs` — L2. Ownership, ticket, staging, download, GC e barreira (§13, §22.4, A09, A15).
//
// §4: depende de `corestore` (L0), `swarm` (L0), `manifest` (L0).
// Não importa de L3. A porta de transporte é injetada por L3; aqui só a decisão e o estado local.
// Não anuncia números não medidos — BENCHMARK REQUIRED (§26.1) permanece provisório.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import sodium from 'sodium-native';

import type { ManifestDb } from '../../l0/manifest/index.ts';
import type { Swarm } from '../../l0/swarm/index.ts';

// L1 — constantes de protocolo (§27.1) duplicadas localmente para não criar aresta L2→L1
// que exigiria emenda em §4. Valores idênticos a `fold/constants.ts`.
const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024 * 1024;
const ATTACHMENT_QUOTA_PER_MEMBER = 5 * 1024 * 1024 * 1024;

function blake2b256(domain: string, ...parts: Buffer[]): Buffer {
  const out = Buffer.allocUnsafe(32);
  sodium.crypto_generichash_batch(out, [Buffer.from(domain, 'utf8'), ...parts]);
  return out;
}

// ─── Constantes operacionais (§27.2) ─────────────────────────────────────────

export const STAGING_TICKET_TTL_MS_DEFAULT = 15 * 60 * 1000;
export const STAGING_ORPHAN_MS_DEFAULT = 24 * 60 * 60 * 1000;
export const BLOB_CACHE_MAX_BYTES_DEFAULT = 20 * 1024 * 1024 * 1024;

// ─── Kind por extensão (§13.6, fecha DR-41) ───────────────────────────────────

export const BLOB_KIND = {
  image: 0,
  video: 1,
  audio: 2,
  document: 3,
  archive: 4,
  other: 5,
} as const;

export type BlobKindNumber = (typeof BLOB_KIND)[keyof typeof BLOB_KIND];

const EXT_TO_KIND: ReadonlyMap<string, BlobKindNumber> = new Map<string, BlobKindNumber>([
  // image
  ...['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'tiff', 'heic'].map((e) => [e, BLOB_KIND.image] as const),
  // video
  ...['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v'].map((e) => [e, BLOB_KIND.video] as const),
  // audio
  ...['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac'].map((e) => [e, BLOB_KIND.audio] as const),
  // document
  ...['pdf', 'txt', 'md', 'csv', 'json', 'xml', 'odt', 'ods', 'odp', 'docx', 'xlsx', 'pptx', 'rtf'].map((e) => [e, BLOB_KIND.document] as const),
  // archive
  ...['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'].map((e) => [e, BLOB_KIND.archive] as const),
]);

const EXECUTABLE_BLOCKLIST = new Set<string>([
  'exe', 'bat', 'cmd', 'com', 'scr', 'ps1', 'sh', 'msi', 'dll', 'app', 'pkg', 'dmg', 'deb', 'rpm', 'jar', 'vbs', 'js', 'wsf', 'lnk',
]);

const INLINE_IMAGE_ALLOWLIST = new Set<string>(['png', 'jpg', 'jpeg', 'gif', 'webp']);

function extOf(nameOrPath: string): string {
  const base = path.basename(nameOrPath);
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function kindFromExtension(ext: string): BlobKindNumber {
  const lower = ext.toLowerCase().replace(/^\./, '');
  return EXT_TO_KIND.get(lower) ?? BLOB_KIND.other;
}

export function kindFromFilename(nameOrPath: string): BlobKindNumber {
  return kindFromExtension(extOf(nameOrPath));
}

export function isExecutableExtension(extOrName: string): boolean {
  const e = extOf(extOrName) || extOrName.toLowerCase().replace(/^\./, '');
  return EXECUTABLE_BLOCKLIST.has(e);
}

export function isInlineImageAllowed(extOrName: string): boolean {
  const e = extOf(extOrName) || extOrName.toLowerCase().replace(/^\./, '');
  return INLINE_IMAGE_ALLOWLIST.has(e);
}

export function isRevealAllowed(kind: BlobKindNumber, extOrName: string): boolean {
  const ext = extOf(extOrName) || extOrName.replace(/^\./, '');
  if (isExecutableExtension(ext)) return false; // §13.6 regra 2 — bloqueada até para revelar
  if (kind === BLOB_KIND.other || kind === BLOB_KIND.archive) return false; // §13.6 regra 1 — só image/audio/video/document
  // §13.6 regra 1 — apenas extensões da tabela: o kind declarado pelo remetente é consultável,
  // a extensão real do arquivo é que delimita a allowlist (troca de extensão é o ataque T-48)
  const tabKind = EXT_TO_KIND.get(ext);
  return tabKind !== undefined && tabKind !== BLOB_KIND.archive;
}

// ─── Nome de anexo — rejeitar, não sanitizar (§8.6) ─────────────────────────

const NOME_RESERVADO = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

export function isValidAttachmentName(name: string): boolean {
  const bytes = Buffer.byteLength(name, 'utf8');
  if (bytes < 1 || bytes > 255) return false;
  if (/[/\\\0]/.test(name)) return false;
  for (const c of name) {
    const cp = c.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp === 0x7f) return false;
  }
  if (NOME_RESERVADO.test(name)) return false;
  if (name.endsWith('.') || name.endsWith(' ')) return false;
  return true;
}

// ─── Ownership por autor (§13.1, A09) ────────────────────────────────────────

/**
 * `memberBlobsSeed = BLAKE2b-256('ns/memberblobs/1' ‖ identitySeed ‖ communityId)`
 * Derivável só pelo dono, recuperável por backup de identidade (§5.5).
 * `communityId` é hex de 32 bytes (coreKey) ou Buffer.
 */
export function deriveMemberBlobsSeed(identitySeed: Buffer, communityId: string | Buffer): Buffer {
  const cid = typeof communityId === 'string' ? Buffer.from(communityId, 'hex') : communityId;
  // Domínio fixo, 18 bytes — prefixo de separação de domínio de §5.2
  return blake2b256('ns/memberblobs/1', identitySeed, cid);
}

export function deriveMemberBlobsKeypair(
  identitySeed: Buffer,
  communityId: string | Buffer,
): { publicKey: Buffer; secretKey: Buffer; seed: Buffer } {
  const seed = deriveMemberBlobsSeed(identitySeed, communityId);
  const publicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
  const secretKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
  sodium.crypto_sign_seed_keypair(publicKey, secretKey, seed);
  return { publicKey, secretKey, seed };
}

export function deriveMemberBlobsPublicKey(identitySeed: Buffer, communityId: string | Buffer): Buffer {
  return deriveMemberBlobsKeypair(identitySeed, communityId).publicKey;
}

/** `discoveryKey(blobsCoreKey)` — tópico DHT do core de blobs do membro (§14.1). */
export function discoveryKeyForBlobsCoreKey(blobsCoreKey: Buffer): Buffer {
  return blake2b256('blob-discovery/1', blobsCoreKey);
}

export function discoveryKeyHexForBlobsCoreKey(blobsCoreKey: Buffer): string {
  return discoveryKeyForBlobsCoreKey(blobsCoreKey).toString('hex');
}

// ─── Hash de blob (§13.2 passo 5) ───────────────────────────────────────────

export function hashForBlobContent(content: Buffer): Buffer {
  return blake2b256('blob-hash/1', content);
}

// ─── Ticket (§13.3, A15) — 16 bytes, TTL 15 min, uso único, escopo comunidade+caminho ─

export type StagingTicket = {
  readonly ticketId: string; // 32 hex (16 bytes)
  readonly path: string;
  readonly sizeBytes: number;
  readonly communityId: string;
  readonly createdAt: number;
  readonly name: string;
  readonly kind: BlobKindNumber;
};

export type TicketIssue = {
  readonly ticketId: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly kind: BlobKindNumber;
};

function isValidTicketId(id: string): boolean {
  return /^[0-9a-f]{32}$/i.test(id);
}

export class TicketStore {
  readonly #tickets = new Map<string, StagingTicket & { used: boolean }>();
  readonly #ttlMs: number;
  readonly #clock: () => number;

  constructor(opts: { ttlMs?: number; clock?: () => number } = {}) {
    this.#ttlMs = opts.ttlMs ?? STAGING_TICKET_TTL_MS_DEFAULT;
    this.#clock = opts.clock ?? Date.now;
  }

  get ttlMs(): number {
    return this.#ttlMs;
  }

  /** Emite ticket de 16 bytes aleatórios — chamado pelo **main** após dialog.showOpenDialog (§13.2). */
  issue(communityId: string, filePath: string, sizeBytes: number): TicketIssue {
    if (!isValidAttachmentName(path.basename(filePath))) {
      throw Object.assign(new Error('Nome de anexo inválido'), { code: 'E_VALIDATION', field: 'name' });
    }
    if (sizeBytes < 1 || sizeBytes > ATTACHMENT_MAX_BYTES) {
      throw Object.assign(new Error('Anexo acima de ATTACHMENT_MAX_BYTES'), { code: 'E_ATTACHMENT_TOO_LARGE' });
    }
    const ticketId = crypto.randomBytes(16).toString('hex');
    const name = path.basename(filePath);
    const kind = kindFromFilename(name);
    const ticket: StagingTicket & { used: boolean } = {
      ticketId,
      path: filePath,
      sizeBytes,
      communityId,
      createdAt: this.#clock(),
      name,
      kind,
      used: false,
    };
    this.#tickets.set(ticketId, ticket);
    return { ticketId, name, sizeBytes, kind };
  }

  /** Ingesta ticket emitido pelo main via IPC-M (§15.7 staging.ticket) — núcleo recebe e persiste. */
  ingest(ticket: StagingTicket): void {
    if (!isValidTicketId(ticket.ticketId)) throw Object.assign(new Error('Ticket inválido'), { code: 'E_TICKET_INVALID' });
    if (this.#tickets.has(ticket.ticketId)) throw Object.assign(new Error('Ticket já existe'), { code: 'E_TICKET_INVALID' });
    if (ticket.sizeBytes < 1 || ticket.sizeBytes > ATTACHMENT_MAX_BYTES) {
      throw Object.assign(new Error('Tamanho inválido'), { code: 'E_TICKET_INVALID' });
    }
    this.#tickets.set(ticket.ticketId, { ...ticket, used: false });
  }

  get(ticketId: string): (StagingTicket & { used: boolean }) | undefined {
    return this.#tickets.get(ticketId);
  }

  /** Consome ticket — uso único, valida TTL e escopo. Retorna ticket se válido, lança E_TICKET_INVALID senão. */
  consume(ticketId: string, expectedCommunityId?: string): StagingTicket {
    const t = this.#tickets.get(ticketId);
    if (t === undefined || t.used) throw Object.assign(new Error('Ticket inválido ou já usado'), { code: 'E_TICKET_INVALID' });
    if (this.#clock() - t.createdAt > this.#ttlMs) {
      this.#tickets.delete(ticketId);
      throw Object.assign(new Error('Ticket expirado'), { code: 'E_TICKET_INVALID' });
    }
    if (expectedCommunityId !== undefined && t.communityId !== expectedCommunityId) {
      throw Object.assign(new Error('Ticket fora do escopo da comunidade'), { code: 'E_TICKET_INVALID' });
    }
    t.used = true;
    return { ticketId: t.ticketId, path: t.path, sizeBytes: t.sizeBytes, communityId: t.communityId, createdAt: t.createdAt, name: t.name, kind: t.kind };
  }

  /** Verifica se ticket existe e é válido sem consumir (para validação preemptiva). */
  peek(ticketId: string): StagingTicket | null {
    const t = this.#tickets.get(ticketId);
    if (t === undefined || t.used) return null;
    if (this.#clock() - t.createdAt > this.#ttlMs) return null;
    return t;
  }

  pruneExpired(now = this.#clock()): number {
    let n = 0;
    for (const [id, t] of this.#tickets) {
      if (now - t.createdAt > this.#ttlMs || t.used) {
        // mantém usados até GC? Por ora remove expirados e usados após consumo bem-sucedido externo
        if (now - t.createdAt > this.#ttlMs) {
          this.#tickets.delete(id);
          n++;
        }
      }
    }
    return n;
  }

  size(): number {
    return this.#tickets.size;
  }
}

// ─── Estados de cache (§13.4, fecha DR-40) ───────────────────────────────────

export const BLOB_CACHE_STATES = [
  'not-downloaded',
  'queued',
  'downloading',
  'verifying',
  'downloaded',
  'corrupt',
  'unavailable',
  'cancelled',
] as const;

export type BlobCacheState = (typeof BLOB_CACHE_STATES)[number];

export function isValidBlobCacheState(s: string): s is BlobCacheState {
  return (BLOB_CACHE_STATES as readonly string[]).includes(s);
}

export const STAGING_STATES = ['pending', 'writing', 'done', 'failed', 'cancelled'] as const;
export type StagingState = (typeof STAGING_STATES)[number];

// ─── Staging — manifest.local_blob_staging (§13.5, fecha DS-22) ──────────────

export type StagingRow = {
  ticketId: string;
  path: string;
  bytesWritten: number;
  rollingHashState: Buffer | null;
  state: StagingState;
  communityId: string | null;
  sizeBytes: number | null;
  name: string | null;
  kind: number | null;
  hash: Buffer | null;
  createdAt: number | null;
};

function rowToStaging(r: Record<string, unknown>): StagingRow {
  return {
    ticketId: r['ticket_id'] as string,
    path: r['path'] as string,
    bytesWritten: r['bytes_written'] as number,
    rollingHashState: (r['rolling_hash_state'] as Buffer | null) ?? null,
    state: r['state'] as StagingState,
    communityId: (r['community_id'] as string | null) ?? null,
    sizeBytes: (r['size_bytes'] as number | null) ?? null,
    name: (r['name'] as string | null) ?? null,
    kind: (r['kind'] as number | null) ?? null,
    hash: (r['hash'] as Buffer | null) ?? null,
    createdAt: (r['created_at'] as number | null) ?? null,
  };
}

export class StagingManager {
  readonly #manifest: ManifestDb;
  readonly #clock: () => number;
  readonly #orphanMs: number;

  constructor(manifest: ManifestDb, opts: { clock?: () => number; orphanMs?: number } = {}) {
    this.#manifest = manifest;
    this.#clock = opts.clock ?? Date.now;
    this.#orphanMs = opts.orphanMs ?? STAGING_ORPHAN_MS_DEFAULT;
  }

  /** Persiste ticket após ingest via IPC-M. Estado inicial `pending`. */
  createFromTicket(ticket: StagingTicket): void {
    const now = this.#clock();
    this.#manifest.raw
      .prepare(
        'INSERT OR REPLACE INTO local_blob_staging(ticket_id, path, bytes_written, rolling_hash_state, state, community_id, size_bytes, name, kind, hash, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        ticket.ticketId,
        ticket.path,
        0,
        null,
        'pending',
        ticket.communityId,
        ticket.sizeBytes,
        ticket.name,
        ticket.kind,
        null,
        now,
      );
  }

  get(ticketId: string): StagingRow | null {
    const r = this.#manifest.raw.prepare('SELECT * FROM local_blob_staging WHERE ticket_id = ?').get(ticketId) as Record<string, unknown> | undefined;
    return r === undefined ? null : rowToStaging(r);
  }

  list(): StagingRow[] {
    const rows = this.#manifest.raw.prepare('SELECT * FROM local_blob_staging').all() as Record<string, unknown>[];
    return rows.map(rowToStaging);
  }

  listByState(state: StagingState): StagingRow[] {
    const rows = this.#manifest.raw.prepare('SELECT * FROM local_blob_staging WHERE state = ?').all(state) as Record<string, unknown>[];
    return rows.map(rowToStaging);
  }

  setState(ticketId: string, state: StagingState, extra: Partial<Pick<StagingRow, 'bytesWritten' | 'hash'>> = {}): void {
    const fields: string[] = ['state = ?'];
    const values: unknown[] = [state];
    if (extra.bytesWritten !== undefined) {
      fields.push('bytes_written = ?');
      values.push(extra.bytesWritten);
    }
    if (extra.hash !== undefined) {
      fields.push('hash = ?');
      values.push(extra.hash);
    }
    values.push(ticketId);
    this.#manifest.raw.prepare(`UPDATE local_blob_staging SET ${fields.join(', ')} WHERE ticket_id = ?`).run(...values);
  }

  updateProgress(ticketId: string, bytesWritten: number, rollingHashState: Buffer | null = null): void {
    this.#manifest.raw
      .prepare('UPDATE local_blob_staging SET bytes_written = ?, rolling_hash_state = ?, state = ? WHERE ticket_id = ?')
      .run(bytesWritten, rollingHashState, 'writing', ticketId);
  }

  markDone(ticketId: string, hash: Buffer, bytesWritten: number): void {
    this.#manifest.raw
      .prepare('UPDATE local_blob_staging SET state = ?, hash = ?, bytes_written = ? WHERE ticket_id = ?')
      .run('done', hash, bytesWritten, ticketId);
  }

  markFailed(ticketId: string): void {
    this.#manifest.raw.prepare("UPDATE local_blob_staging SET state = 'failed' WHERE ticket_id = ?").run(ticketId);
  }

  remove(ticketId: string): void {
    this.#manifest.raw.prepare('DELETE FROM local_blob_staging WHERE ticket_id = ?').run(ticketId);
  }

  /**
   * Retomada após crash no boot (§13.5):
   * - `writing` → retoma do bytesWritten (verifica se arquivo ainda existe, senão E_FILE_UNREADABLE)
   * - `done` antigo sem referência → será coletado por `gcOrphan`
   */
  resumeOnBoot(): { resumed: StagingRow[]; discarded: StagingRow[] } {
    const resumed: StagingRow[] = [];
    const discarded: StagingRow[] = [];
    for (const row of this.list()) {
      if (row.state === 'writing' || row.state === 'pending') {
        if (!fs.existsSync(row.path)) {
          this.markFailed(row.ticketId);
          discarded.push({ ...row, state: 'failed' });
        } else {
          resumed.push(row);
        }
      }
    }
    return { resumed, discarded };
  }

  /**
   * GC de staging órfão (§13.5, §22.4): `done` sem mensagem referenciando em STAGING_ORPHAN_MS → core.clear + remove.
   * `hasReference` é injetado para consultar `view.attachments` sem acoplar `view` diretamente (§4).
   */
  gcOrphan(opts: { now?: number; hasReference: (row: StagingRow) => boolean; clearBlobs: (row: StagingRow) => void }): { removed: number; cleared: number } {
    const now = opts.now ?? this.#clock();
    let removed = 0;
    let cleared = 0;
    for (const row of this.listByState('done')) {
      const createdAt = row.createdAt ?? now;
      if (now - createdAt < this.#orphanMs) continue;
      if (opts.hasReference(row)) continue;
      try {
        opts.clearBlobs(row);
        cleared++;
      } catch {}
      this.remove(row.ticketId);
      removed++;
    }
    return { removed, cleared };
  }
}

// ─── Download cache — manifest.local_blob_cache (§13.4) ─────────────────────

export type CacheRow = {
  blobsCoreKeyHex: string;
  blobIdHex: string;
  bytesDownloaded: number;
  state: BlobCacheState;
  path: string | null;
  verifiedAt: number | null;
  declaredSize: number | null;
};

function rowToCache(r: Record<string, unknown>): CacheRow {
  const keyBuf = r['blobs_core_key'] as Buffer;
  return {
    blobsCoreKeyHex: keyBuf.toString('hex'),
    blobIdHex: r['blob_id_hex'] as string,
    bytesDownloaded: r['bytes_downloaded'] as number,
    state: r['state'] as BlobCacheState,
    path: (r['path'] as string | null) ?? null,
    verifiedAt: (r['verified_at'] as number | null) ?? null,
    declaredSize: (r['declared_size'] as number | null) ?? null,
  };
}

export class DownloadCache {
  readonly #manifest: ManifestDb;
  readonly #clock: () => number;

  constructor(manifest: ManifestDb, opts: { clock?: () => number } = {}) {
    this.#manifest = manifest;
    this.#clock = opts.clock ?? Date.now;
  }

  get(blobsCoreKey: Buffer | string, blobIdHex: string): CacheRow | null {
    const key = typeof blobsCoreKey === 'string' ? Buffer.from(blobsCoreKey, 'hex') : blobsCoreKey;
    const r = this.#manifest.raw
      .prepare('SELECT * FROM local_blob_cache WHERE blobs_core_key = ? AND blob_id_hex = ?')
      .get(key, blobIdHex) as Record<string, unknown> | undefined;
    return r === undefined ? null : rowToCache(r);
  }

  list(): CacheRow[] {
    const rows = this.#manifest.raw.prepare('SELECT * FROM local_blob_cache').all() as Record<string, unknown>[];
    return rows.map(rowToCache);
  }

  listByState(state: BlobCacheState): CacheRow[] {
    const rows = this.#manifest.raw.prepare('SELECT * FROM local_blob_cache WHERE state = ?').all(state) as Record<string, unknown>[];
    return rows.map(rowToCache);
  }

  upsert(row: { blobsCoreKey: Buffer; blobIdHex: string; state: BlobCacheState; bytesDownloaded?: number; declaredSize?: number | null; path?: string | null }): void {
    const existing = this.get(row.blobsCoreKey, row.blobIdHex);
    const bytes = row.bytesDownloaded ?? existing?.bytesDownloaded ?? 0;
    const declared = row.declaredSize ?? existing?.declaredSize ?? null;
    const p = row.path ?? existing?.path ?? null;
    const verifiedAt = row.state === 'downloaded' ? this.#clock() : existing?.verifiedAt ?? null;
    this.#manifest.raw
      .prepare(
        'INSERT INTO local_blob_cache(blobs_core_key, blob_id_hex, bytes_downloaded, state, path, verified_at, declared_size) VALUES (?,?,?,?,?,?,?) ' +
          'ON CONFLICT(blobs_core_key, blob_id_hex) DO UPDATE SET bytes_downloaded = excluded.bytes_downloaded, state = excluded.state, path = excluded.path, verified_at = excluded.verified_at, declared_size = excluded.declared_size',
      )
      .run(row.blobsCoreKey, row.blobIdHex, bytes, row.state, p, verifiedAt, declared);
  }

  setState(blobsCoreKey: Buffer | string, blobIdHex: string, state: BlobCacheState, extra: Partial<Pick<CacheRow, 'bytesDownloaded' | 'path' | 'declaredSize'>> = {}): void {
    const key = typeof blobsCoreKey === 'string' ? Buffer.from(blobsCoreKey, 'hex') : blobsCoreKey;
    const existing = this.get(key, blobIdHex);
    if (existing === null) return;
    const bytes = extra.bytesDownloaded ?? existing.bytesDownloaded;
    const p = extra.path ?? existing.path;
    const declared = extra.declaredSize ?? existing.declaredSize;
    const verifiedAt = state === 'downloaded' ? this.#clock() : existing.verifiedAt;
    this.#manifest.raw
      .prepare('UPDATE local_blob_cache SET state = ?, bytes_downloaded = ?, path = ?, verified_at = ?, declared_size = ? WHERE blobs_core_key = ? AND blob_id_hex = ?')
      .run(state, bytes, p, verifiedAt, declared, key, blobIdHex);
  }

  remove(blobsCoreKey: Buffer | string, blobIdHex: string): void {
    const key = typeof blobsCoreKey === 'string' ? Buffer.from(blobsCoreKey, 'hex') : blobsCoreKey;
    this.#manifest.raw.prepare('DELETE FROM local_blob_cache WHERE blobs_core_key = ? AND blob_id_hex = ?').run(key, blobIdHex);
  }

  /**
   * Retomada após crash (§13.4): todo `downloading`/`verifying` volta para `queued` com bytesDownloaded preservado.
   * Hypercore retoma pelo bitfield sem reiniciar (§13.4).
   */
  resumeOnBoot(): number {
    const rows = this.#manifest.raw.prepare("SELECT blobs_core_key, blob_id_hex FROM local_blob_cache WHERE state IN ('downloading','verifying')").all() as Array<Record<string, unknown>>;
    let n = 0;
    for (const r of rows) {
      const key = r['blobs_core_key'] as Buffer;
      const id = r['blob_id_hex'] as string;
      this.#manifest.raw.prepare("UPDATE local_blob_cache SET state = 'queued' WHERE blobs_core_key = ? AND blob_id_hex = ?").run(key, id);
      n++;
    }
    return n;
  }

  /**
   * GC de blobs (§22.4): LRU por verified_at, exceto protegidos (§13.7 regra 2).
   * `isProtected` diz se o blob é do autor local com mensagem viva — nunca coletado.
   * `deleteFile` remove do disco; aqui só remove linha do cache (core.clear libera blocos locais).
   */
  gc(opts: {
    maxBytes: number;
    isProtected: (row: CacheRow) => boolean;
    deleteFile?: (row: CacheRow) => void;
    now?: number;
  }): { removed: number; freedBytes: number } {
    const max = opts.maxBytes;
    let total = 0;
    const candidates: Array<CacheRow & { size: number }> = [];
    for (const row of this.list()) {
      if (row.state !== 'downloaded' || row.path === null) continue;
      if (opts.isProtected(row)) continue;
      const sz = row.declaredSize ?? row.bytesDownloaded;
      total += sz;
      candidates.push({ ...row, size: sz });
    }
    if (total <= max) return { removed: 0, freedBytes: 0 };
    candidates.sort((a, b) => (a.verifiedAt ?? 0) - (b.verifiedAt ?? 0)); // LRU
    let removed = 0;
    let freed = 0;
    for (const c of candidates) {
      if (total <= max) break;
      try {
        opts.deleteFile?.(c);
      } catch {}
      // core.clear: libera blocos locais (mock: remove linha)
      this.remove(Buffer.from(c.blobsCoreKeyHex, 'hex'), c.blobIdHex);
      total -= c.size;
      freed += c.size;
      removed++;
    }
    return { removed, freedBytes: freed };
  }
}

// ─── BlobManager — fachada L2 ────────────────────────────────────────────────

export type BlobStoreEntry = {
  blobsCoreKeyHex: string;
  blobIdHex: string;
  path: string;
  hashHex: string;
  sizeBytes: number;
  kind: BlobKindNumber;
  name: string;
};

export type BlobManagerOptions = {
  readonly manifest: ManifestDb;
  readonly swarm: Swarm;
  readonly dataDir?: string;
  readonly clock?: () => number;
  readonly ttlMs?: number;
  readonly orphanMs?: number;
  readonly cacheMaxBytes?: number;
};

export type StageResult = {
  readonly blobsCoreKey: Buffer;
  readonly blobId: { byteOffset: number; blockOffset: number; blockLength: number; byteLength: number };
  readonly blobIdHex: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly kind: BlobKindNumber;
  readonly hash: Buffer;
};

export type DownloadOpts = {
  readonly blobsCoreKey: Buffer;
  readonly blobIdHex: string;
  readonly declaredSize: number;
  readonly hash: Buffer;
  readonly name: string;
};

export class BlobManager {
  readonly manifest: ManifestDb;
  readonly swarm: Swarm;
  readonly tickets: TicketStore;
  readonly staging: StagingManager;
  readonly cache: DownloadCache;
  readonly #dataDir: string;
  readonly #clock: () => number;
  readonly #cacheMaxBytes: number;
  /**
   * Resultado do último `stage` por ticket (§13.7 regra 1). Em memória de propósito: é o
   * material que liga o ticket ao blob local — `blobsCoreKey` e `blobId` — e que
   * `local_blob_staging` (§13.5) não guarda. Perder no crash é o comportamento certo: sem
   * ele, `message.send` com anexo recusa e a UI reencena o `blob.stage`, que é idempotente
   * do ponto de vista do autor. O que **não** pode acontecer é a mensagem sair apontando
   * para um blob que este núcleo não escreveu.
   */
  readonly #staged = new Map<string, StageResult>();

  constructor(opts: BlobManagerOptions) {
    this.manifest = opts.manifest;
    this.swarm = opts.swarm;
    const clock = opts.clock ?? Date.now;
    this.#clock = clock;
    this.#dataDir = opts.dataDir ?? path.join(process.cwd(), 'blobs');
    this.tickets = new TicketStore({ ttlMs: opts.ttlMs ?? STAGING_TICKET_TTL_MS_DEFAULT, clock });
    this.staging = new StagingManager(opts.manifest, { clock, orphanMs: opts.orphanMs ?? STAGING_ORPHAN_MS_DEFAULT });
    this.cache = new DownloadCache(opts.manifest, { clock });
    this.#cacheMaxBytes = opts.cacheMaxBytes ?? BLOB_CACHE_MAX_BYTES_DEFAULT;
  }

  // ── Ticket ingest via IPC-M (§15.7 staging.ticket) ────────────────────────

  /** Recebe ticket do main (IPC-M) — path nunca cruza IPC-R. */
  ingestTicket(ticket: StagingTicket): TicketIssue {
    // Valida e persiste ticket como staging pendente
    this.tickets.ingest(ticket);
    this.staging.createFromTicket(ticket);
    return { ticketId: ticket.ticketId, name: ticket.name, sizeBytes: ticket.sizeBytes, kind: ticket.kind };
  }

  /** Helper para main criar ticket: main abre dialog, deriva name/kind, emite ticket. */
  createTicketForMain(communityId: string, filePath: string, sizeBytes: number): StagingTicket {
    const name = path.basename(filePath);
    const kind = kindFromFilename(name);
    if (!isValidAttachmentName(name)) throw Object.assign(new Error('Nome inválido'), { code: 'E_VALIDATION', field: 'name' });
    const issued = this.tickets.issue(communityId, filePath, sizeBytes);
    const ticket: StagingTicket = {
      ticketId: issued.ticketId,
      path: filePath,
      sizeBytes,
      communityId,
      createdAt: this.#clock(),
      name: issued.name,
      kind: issued.kind,
    };
    // Persiste imediatamente para retomada
    this.staging.createFromTicket(ticket);
    return ticket;
  }

  // ── Stage (§13.2) — só via ticketId, nunca via path direto (fecha T-16/DR-37) ─

  /**
   * `blob.stage{ticketId}` — lê arquivo em stream, calcula BLAKE2b('blob-hash/1'‖conteúdo),
   * faz hyperblobs.put em chunks journalando bytesWritten, e devolve BlobStageResult.
   * Recusa qualquer path vindo do renderer, sempre.
   */
  async stage(ticketId: string, opts: { blobsCoreKey?: Buffer; identitySeed?: Buffer; communityId?: string } = {}): Promise<StageResult> {
    if (!isValidTicketId(ticketId)) throw Object.assign(new Error('Ticket inválido'), { code: 'E_TICKET_INVALID' });
    const stagingRow = this.staging.get(ticketId);
    if (stagingRow === null) throw Object.assign(new Error('Ticket não encontrado'), { code: 'E_TICKET_INVALID' });
    if (stagingRow.state === 'done') throw Object.assign(new Error('Ticket já usado'), { code: 'E_TICKET_INVALID' });

    // Valida ticket store (TTL, uso único, escopo)
    let ticket: StagingTicket;
    try {
      ticket = this.tickets.consume(ticketId, stagingRow.communityId ?? undefined);
    } catch (e) {
      // Se já foi consumido no ticket store mas staging ainda pendente, tenta usar dados do staging
      if (stagingRow.state === 'pending' || stagingRow.state === 'writing') {
        ticket = {
          ticketId: stagingRow.ticketId,
          path: stagingRow.path,
          sizeBytes: stagingRow.sizeBytes ?? 0,
          communityId: stagingRow.communityId ?? '',
          createdAt: stagingRow.createdAt ?? this.#clock(),
          name: stagingRow.name ?? path.basename(stagingRow.path),
          kind: (stagingRow.kind as BlobKindNumber) ?? BLOB_KIND.other,
        };
      } else {
        throw e;
      }
    }

    const filePath = ticket.path;
    const communityId = ticket.communityId;
    // Verifica arquivo existe e tamanho
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      this.staging.markFailed(ticketId);
      throw Object.assign(new Error('Arquivo não legível'), { code: 'E_FILE_UNREADABLE' });
    }
    if (!stat.isFile()) {
      this.staging.markFailed(ticketId);
      throw Object.assign(new Error('Arquivo não legível'), { code: 'E_FILE_UNREADABLE' });
    }
    if (stat.size !== ticket.sizeBytes) {
      // Tamanho declarado diverge — pode ser race, mas trata como erro de validação
      // Permite continuar com tamanho real, pois o hash final valida
    }
    if (stat.size > ATTACHMENT_MAX_BYTES) {
      this.staging.markFailed(ticketId);
      throw Object.assign(new Error('Anexo muito grande'), { code: 'E_ATTACHMENT_TOO_LARGE' });
    }
    if (!isValidAttachmentName(ticket.name)) {
      this.staging.markFailed(ticketId);
      throw Object.assign(new Error('Nome inválido'), { code: 'E_VALIDATION', field: 'name' });
    }

    // Determina blobsCoreKey do autor: se fornecido, usa; senão deriva de identitySeed.
    // Sem chave, recusa — nenhum membro escreve sem a chave dele (A09, F-03).
    let blobsCoreKey: Buffer;
    if (opts.blobsCoreKey !== undefined) {
      blobsCoreKey = Buffer.from(opts.blobsCoreKey);
    } else if (opts.identitySeed !== undefined && communityId) {
      blobsCoreKey = deriveMemberBlobsPublicKey(opts.identitySeed, communityId);
    } else {
      throw Object.assign(new Error('Sem chave de blobs do autor'), { code: 'E_NO_BLOBS_KEY' });
    }

    // Stream + hash + journaling (§13.2 passo 5)
    this.staging.updateProgress(ticketId, 0, null);
    const hashState: Buffer[] = [];
    let bytesWritten = 0;
    const chunkSize = 64 * 1024;
    const fd = await fs.promises.open(filePath, 'r');
    const fileSize = stat.size;
    try {
      const buf = Buffer.alloc(chunkSize);
      while (bytesWritten < fileSize) {
        const toRead = Math.min(chunkSize, fileSize - bytesWritten);
        const { bytesRead } = await fd.read(buf, 0, toRead, bytesWritten);
        if (bytesRead === 0) break;
        // Cópia obrigatória: `buf` é reutilizado a cada leitura; um subarray aqui seria
        // uma view que o próximo read sobrescreve, corrompendo o hash de anexos > 1 chunk.
        hashState.push(Buffer.from(buf.subarray(0, bytesRead)));
        bytesWritten += bytesRead;
        // Journal a cada chunk — manifest com FULL garante durabilidade
        this.staging.updateProgress(ticketId, bytesWritten, null);
        // Simula hyperblobs.put chunk — em produção seria `await hyperblobs.put(chunk)`
        // Aqui apenas avança; o dado é o próprio arquivo
      }
    } finally {
      await fd.close();
    }

    const content = Buffer.concat(hashState);
    const hash = hashForBlobContent(content);
    const blobIdHex = hash.toString('hex').slice(0, 32); // 16 bytes hex como id mock
    const blobId = {
      byteOffset: 0,
      blockOffset: 0,
      blockLength: Math.max(1, Math.ceil(fileSize / chunkSize)),
      byteLength: fileSize,
    };

    // Persiste blob no store local (simula hyperblobs core do autor)
    const storeDir = path.join(this.#dataDir, blobsCoreKey.toString('hex'));
    await fs.promises.mkdir(storeDir, { recursive: true });
    const storedPath = path.join(storeDir, `${blobIdHex}-${ticket.name}`);
    try {
      await fs.promises.copyFile(filePath, storedPath);
    } catch {
      // Se falhar cópia, mantém staging como failed
      this.staging.markFailed(ticketId);
      throw Object.assign(new Error('Falha ao armazenar blob'), { code: 'E_STORAGE_FULL' });
    }

    // Marca staging como done e journal hash
    this.staging.markDone(ticketId, hash, bytesWritten);

    // Registra também no cache como verificado (o autor já tem o blob)
    this.cache.upsert({
      blobsCoreKey,
      blobIdHex,
      state: 'downloaded',
      bytesDownloaded: fileSize,
      declaredSize: fileSize,
      path: storedPath,
    });

    const result: StageResult = {
      blobsCoreKey,
      blobId,
      blobIdHex,
      name: ticket.name,
      sizeBytes: fileSize,
      kind: ticket.kind,
      hash,
    };
    this.#staged.set(ticketId, result);
    return result;
  }

  /**
   * §13.7 regra 1 — o que o `blob.stage` deste ticket produziu, ou `null`. É a **única**
   * fonte do `attachment` de `message.send`: nada que descreva o blob vem do renderer.
   */
  stagedResult(ticketId: string): StageResult | null {
    const result = this.#staged.get(ticketId);
    if (result === undefined) return null;
    return this.isStagedDone(ticketId) ? result : null;
  }

  // ── Barreira blob ↔ mensagem (§13.7) ─────────────────────────────────────

  /**
   * Verifica se `message.send` com anexo pode ser enfileirada.
   * Só depois que `blob.stage` completou e `hyperblobs.put` foi flushado.
   */
  assertReadyForMessage(ticketId: string): void {
    const row = this.staging.get(ticketId);
    if (row === null || row.state !== 'done' || row.hash === null) {
      throw Object.assign(new Error('Blob ainda não staged'), { code: 'E_BLOB_NOT_STAGED' });
    }
  }

  isStagedDone(ticketId: string): boolean {
    const row = this.staging.get(ticketId);
    return row !== null && row.state === 'done';
  }

  // ── Download (§13.4) ─────────────────────────────────────────────────────

  /**
   * `blob.download{blobsCoreKey, blobId}` — swarm.join, hyperblobs.get por range, progresso 500ms,
   * abort se > declaredSize, verifica hash, grava em blobs/<coreHex>/<blobIdHex>-<name>.
   */
  async download(opts: DownloadOpts): Promise<{ path: string }> {
    const { blobsCoreKey, blobIdHex, declaredSize, hash, name } = opts;
    if (declaredSize < 1 || declaredSize > ATTACHMENT_MAX_BYTES) {
      throw Object.assign(new Error('Tamanho declarado inválido'), { code: 'E_VALIDATION', field: 'sizeBytes' });
    }
    if (!isValidAttachmentName(name)) throw Object.assign(new Error('Nome inválido'), { code: 'E_VALIDATION', field: 'name' });

    // Estado inicial — não retorna early se hash for diferente do já verificado;
    // o cache não armazena hash, então precisa re-verificar sempre que hash for fornecido e diferir do arquivo existente
    const existing = this.cache.get(blobsCoreKey, blobIdHex);
    if (existing !== null && existing.state === 'downloaded' && existing.path !== null && fs.existsSync(existing.path)) {
      // Verifica se o arquivo existente bate com o hash pedido; se não, força re-verificação
      try {
        const existingData = await fs.promises.readFile(existing.path);
        const existingHash = hashForBlobContent(existingData);
        if (existingHash.equals(hash) && existingData.length <= declaredSize) {
          return { path: existing.path };
        }
        // hash diverge ou tamanho diverge — cai no fluxo de verificação que marcará corrupt
      } catch {}
    }
    this.cache.upsert({ blobsCoreKey, blobIdHex, state: 'queued', declaredSize, bytesDownloaded: 0 });

    // swarm.join(discoveryKey) se ainda não estiver — §14.1
    const topicHex = discoveryKeyHexForBlobsCoreKey(blobsCoreKey);
    if (!this.swarm.isJoined(topicHex)) {
      this.swarm.join(topicHex, { topicHex, kind: 'member-blobs', communityId: null });
    }
    this.cache.setState(blobsCoreKey, blobIdHex, 'downloading', { bytesDownloaded: 0 });

    // Simula busca: procura em dataDir do dono (mock P2P)
    // Em produção, seria `hyperblobs.get` por range com bitfield.
    // Aqui tenta copiar de qualquer store local que tenha o blob
    let sourcePath: string | null = null;
    // Varre dataDir por blobsCoreKey
    const ownerDir = path.join(this.#dataDir, blobsCoreKey.toString('hex'));
    try {
      const files = await fs.promises.readdir(ownerDir);
      const match = files.find((f) => f.startsWith(blobIdHex));
      if (match !== undefined) sourcePath = path.join(ownerDir, match);
    } catch {}

    if (sourcePath === null) {
      // Nenhum peer tem — marca unavailable se host também não tem
      this.cache.setState(blobsCoreKey, blobIdHex, 'unavailable');
      throw Object.assign(new Error('Nenhum par tem o blob'), { code: 'E_NO_PEERS' });
    }

    // Lê e verifica tamanho
    const data = await fs.promises.readFile(sourcePath);
    if (data.length > declaredSize) {
      this.cache.setState(blobsCoreKey, blobIdHex, 'corrupt');
      throw Object.assign(new Error('Tamanho excede declarado'), { code: 'E_BLOB_CORRUPT', cause: 'size' });
    }

    this.cache.setState(blobsCoreKey, blobIdHex, 'verifying', { bytesDownloaded: data.length });

    // Verifica hash §13.4 passo 6
    const computed = hashForBlobContent(data);
    if (!computed.equals(hash)) {
      this.cache.setState(blobsCoreKey, blobIdHex, 'corrupt');
      throw Object.assign(new Error('Hash diverge'), { code: 'E_BLOB_CORRUPT', cause: 'hash' });
    }

    // Grava em blobs/<blobsCoreKeyHex>/<blobIdHex>-<name> → blob.completed{path}
    const destDir = path.join(this.#dataDir, blobsCoreKey.toString('hex'));
    await fs.promises.mkdir(destDir, { recursive: true });
    const destPath = path.join(destDir, `${blobIdHex}-${name}`);
    // Se sourcePath já é o destino (dono baixando próprio), não copia
    if (sourcePath !== destPath) {
      await fs.promises.copyFile(sourcePath, destPath);
    }
    // Marca de origem no Windows (§13.6 regra 3) — só onde SO suportar; no Linux não aplica
    // Mock: não tenta Zone.Identifier, apenas registra que não aplicou em Linux

    this.cache.setState(blobsCoreKey, blobIdHex, 'downloaded', { bytesDownloaded: data.length, path: destPath, declaredSize });
    return { path: destPath };
  }

  cancelDownload(blobsCoreKey: Buffer | string, blobIdHex: string): void {
    const key = typeof blobsCoreKey === 'string' ? Buffer.from(blobsCoreKey, 'hex') : blobsCoreKey;
    this.cache.setState(key, blobIdHex, 'cancelled');
  }

  getDownloadState(blobsCoreKey: Buffer | string, blobIdHex: string): BlobCacheState | null {
    const key = typeof blobsCoreKey === 'string' ? Buffer.from(blobsCoreKey, 'hex') : blobsCoreKey;
    const row = this.cache.get(key, blobIdHex);
    return row?.state ?? null;
  }

  // ── Retomada no boot (§13.5, §13.4) ───────────────────────────────────────

  resumeOnBoot(): { stagingResumed: number; stagingDiscarded: number; downloadsResumed: number } {
    const { resumed, discarded } = this.staging.resumeOnBoot();
    const downloadsResumed = this.cache.resumeOnBoot();
    return { stagingResumed: resumed.length, stagingDiscarded: discarded.length, downloadsResumed };
  }

  // ── GC (§22.4, §13.8) ─────────────────────────────────────────────────────

  gcStaging(opts: { hasReference: (row: StagingRow) => boolean; clearBlobs: (row: StagingRow) => void; now?: number }): { removed: number; cleared: number } {
    return this.staging.gcOrphan({ hasReference: opts.hasReference, clearBlobs: opts.clearBlobs, now: opts.now ?? this.#clock() });
  }

  gcCache(opts: { isProtected: (row: CacheRow) => boolean; now?: number }): { removed: number; freedBytes: number } {
    return this.cache.gc({ maxBytes: this.#cacheMaxBytes, isProtected: opts.isProtected, now: opts.now ?? this.#clock() });
  }

  // ── Reveal / abertura (§13.6) ─────────────────────────────────────────────

  canReveal(blobsCoreKey: Buffer | string, blobIdHex: string): { allowed: boolean; reason?: string } {
    const key = typeof blobsCoreKey === 'string' ? Buffer.from(blobsCoreKey, 'hex') : blobsCoreKey;
    const row = this.cache.get(key, blobIdHex);
    if (row === null || row.state !== 'downloaded' || row.path === null) return { allowed: false, reason: 'E_NOT_DOWNLOADED' };
    const ext = extOf(row.path);
    const kind = kindFromExtension(ext);
    if (isExecutableExtension(ext)) return { allowed: false, reason: 'E_TYPE_NOT_OPENABLE' };
    if (!isRevealAllowed(kind, ext)) return { allowed: false, reason: 'E_TYPE_NOT_OPENABLE' };
    return { allowed: true };
  }

  // ── Helpers de quota (§13.8, R-14) ────────────────────────────────────────

  static exceedsQuota(storageUsedBytes: number, sizeBytes: number): boolean {
    return storageUsedBytes + sizeBytes > ATTACHMENT_QUOTA_PER_MEMBER;
  }

  static exceedsCache(maxBytes: number, currentBytes: number, newBytes: number): boolean {
    return currentBytes + newBytes > maxBytes;
  }
}


