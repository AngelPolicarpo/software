// `manifest` — L0. Estado local durável de §10.2 e §11.2.
//
// Este módulo conhece apenas armazenamento local. A regra de domínio da outbox vive em L2;
// aqui ficam o schema, as transações e a ordem local persistida.

import Database from 'better-sqlite3';
import crypto from 'node:crypto';

export type OutboxState = 'queued' | 'sending' | 'awaiting-confirmation' | 'failed' | 'dropped';

export type DropReason =
  | 'channel-deleted'
  | 'community-ended'
  | 'left-community'
  | 'banned'
  | 'kicked'
  | 'permission-lost'
  | 'expired'
  | 'client-outdated'
  | 'cancelled';

export type OutboxRow = {
  readonly local_seq: number;
  readonly op_id: string;
  readonly community_id: string;
  readonly channel_id: string | null;
  readonly sequence_scope: string;
  readonly kind: number;
  readonly author_seq: number;
  readonly envelope: Buffer;
  readonly client_ref: string | null;
  readonly created_at: number;
  readonly attempts: number;
  readonly next_attempt_at: number;
  readonly state: OutboxState;
  readonly acked_seq: number | null;
  readonly last_error: string | null;
  readonly dropped_reason: DropReason | null;
};

export type EnqueueInput = {
  readonly opId: string;
  readonly communityId: string;
  readonly channelId: string | null;
  readonly sequenceScope: string;
  readonly kind: number;
  readonly authorSeq: number;
  readonly envelope: Buffer;
  readonly clientRef: string | null;
  readonly now: number;
};

export type EnqueueResult = { readonly enqueued: boolean; readonly localSeq: number | null };

const PRAGMAS: readonly (readonly [string, string | number])[] = [
  ['journal_mode', 'WAL'],
  ['synchronous', 'FULL'],
  ['foreign_keys', 'OFF'],
  ['busy_timeout', 5000],
  ['temp_store', 'MEMORY'],
  ['cache_size', -8000],
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS local_outbox (
  local_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id TEXT UNIQUE NOT NULL,
  community_id TEXT NOT NULL,
  channel_id TEXT,
  sequence_scope TEXT NOT NULL,
  kind INT NOT NULL,
  author_seq INT NOT NULL,
  envelope BLOB NOT NULL,
  client_ref TEXT,
  created_at INT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at INT NOT NULL,
  state TEXT NOT NULL,
  acked_seq INT,
  last_error TEXT,
  dropped_reason TEXT);
CREATE INDEX IF NOT EXISTS idx_outbox_ready
  ON local_outbox(community_id, state, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_channel
  ON local_outbox(community_id, channel_id, local_seq);

CREATE TABLE IF NOT EXISTS local_author_seq (
  community_id TEXT NOT NULL,
  sequence_scope TEXT NOT NULL,
  next_author_seq INT NOT NULL,
  PRIMARY KEY (community_id, sequence_scope));

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  nonce BLOB
);

CREATE TABLE IF NOT EXISTS communities (
  community_id TEXT PRIMARY KEY,
  core_key BLOB NOT NULL,
  blobs_key BLOB NOT NULL,
  community_seed_enc BLOB,
  community_seed_nonce BLOB,
  is_host INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  removed_reason TEXT,
  retain_until INTEGER,
  origin_community_id TEXT
);

CREATE TABLE IF NOT EXISTS member_blobs_core (
  community_id TEXT PRIMARY KEY,
  core_key BLOB,
  secret_seed_enc BLOB
);

CREATE TABLE IF NOT EXISTS invite_secrets (
  invite_public_key BLOB PRIMARY KEY,
  community_id TEXT,
  secret BLOB,
  label TEXT
);

CREATE TABLE IF NOT EXISTS local_read_state (
  community_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  last_read_seq INTEGER NOT NULL,
  first_unread_seq INTEGER,
  unread_count INTEGER NOT NULL,
  pending_mentions INTEGER NOT NULL,
  PRIMARY KEY (community_id, channel_id)
);

CREATE TABLE IF NOT EXISTS local_thread_read_state (
  community_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  last_read_seq INTEGER NOT NULL,
  unread_count INTEGER NOT NULL,
  PRIMARY KEY (community_id, thread_id)
);

CREATE TABLE IF NOT EXISTS local_channel_pref (
  channel_id TEXT PRIMARY KEY,
  muted INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS local_community_pref (
  community_id TEXT PRIMARY KEY,
  notification_level TEXT,
  collapsed_categories TEXT,
  recent_channels TEXT,
  last_host_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS local_navigation (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_relay_consent (
  community_id TEXT PRIMARY KEY,
  decision TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS local_device_pref (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_participant_volume (
  community_id TEXT NOT NULL,
  identity_key BLOB NOT NULL,
  volume INTEGER NOT NULL,
  PRIMARY KEY (community_id, identity_key)
);

CREATE TABLE IF NOT EXISTS local_blob_cache (
  blobs_core_key BLOB NOT NULL,
  blob_id_hex TEXT NOT NULL,
  bytes_downloaded INTEGER NOT NULL,
  state TEXT NOT NULL,
  path TEXT,
  verified_at INTEGER,
  declared_size INTEGER,
  PRIMARY KEY (blobs_core_key, blob_id_hex)
);

CREATE TABLE IF NOT EXISTS local_blob_staging (
  ticket_id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  bytes_written INTEGER NOT NULL,
  rolling_hash_state BLOB,
  state TEXT NOT NULL,
  community_id TEXT,
  size_bytes INTEGER,
  name TEXT,
  kind INTEGER,
  hash BLOB,
  created_at INTEGER
);
`;

export const MANIFEST_SCHEMA_VERSION = '2';

function channelKey(channelId: string | null): string {
  return channelId ?? '';
}

export class ManifestDb {
  readonly #db: Database.Database;

  constructor(path: string) {
    this.#db = new Database(path);
    for (const [key, value] of PRAGMAS) this.#db.pragma(`${key} = ${value}`);
    this.#db.exec(SCHEMA);
    const outboxColumns = this.#db.pragma('table_info(local_outbox)') as Array<{ name: string }>;
    const authorSeqColumns = this.#db.pragma('table_info(local_author_seq)') as Array<{ name: string }>;
    if (!outboxColumns.some((column) => column.name === 'sequence_scope') || !authorSeqColumns.some((column) => column.name === 'sequence_scope')) {
      throw new Error('manifest schema requires the scoped authorSeq migration');
    }
    // Migração incremental de fase 5 — staging por ticket (A15) + ownership por autor (A09)
    // DBs criados antes de 4709493 têm local_blob_staging com 5 colunas; novos têm 11.
    // ALTER é idempotente e preserva dados existentes.
    const stagingCols = this.#db.pragma('table_info(local_blob_staging)') as Array<{ name: string }>;
    const stagingNames = new Set(stagingCols.map((c) => c.name));
    const addStagingCol = (col: string, def: string): void => {
      if (!stagingNames.has(col)) this.#db.exec(`ALTER TABLE local_blob_staging ADD COLUMN ${col} ${def}`);
    };
    addStagingCol('community_id', 'TEXT');
    addStagingCol('size_bytes', 'INTEGER');
    addStagingCol('name', 'TEXT');
    addStagingCol('kind', 'INTEGER');
    addStagingCol('hash', 'BLOB');
    addStagingCol('created_at', 'INTEGER');
    const version = this.metaGet('manifest_schema_version');
    if (version !== null && Number(version) > Number(MANIFEST_SCHEMA_VERSION)) {
      throw new Error('manifest schema is ahead of this binary');
    }
    if (version === null) this.metaSet('manifest_schema_version', MANIFEST_SCHEMA_VERSION);
  }

  get raw(): Database.Database {
    return this.#db;
  }

  pragma(name: string): unknown {
    return this.#db.pragma(name);
  }

  /** Consome um número somente no escopo persistido; números queimados são permitidos. */
  /**
   * §7.5 — fixa o contador em `next` sem entregar número nenhum. É o caso da gênese
   * (§19.1): os `authorSeq` 1..6 do fundador foram consumidos direto no core, fora da
   * ponte de submissão; sem isto, o primeiro op síncrono reusaria o 1 e viraria E_DUPLICATE.
   */
  advanceAuthorSeq(communityId: string, sequenceScope: string, next: number): void {
    this.#db
      .prepare(
        'INSERT INTO local_author_seq(community_id, sequence_scope, next_author_seq) VALUES (?, ?, ?) ' +
          'ON CONFLICT(community_id, sequence_scope) DO UPDATE SET next_author_seq = MAX(next_author_seq, excluded.next_author_seq)',
      )
      .run(communityId, sequenceScope, next);
  }

  nextAuthorSeq(communityId: string, sequenceScope: string): number {
    const tx = this.#db.transaction((cid: string, scope: string): number => {
      const row = this.#db
        .prepare('SELECT next_author_seq AS n FROM local_author_seq WHERE community_id = ? AND sequence_scope = ?')
        .get(cid, scope) as { n: number } | undefined;
      const n = row?.n ?? 1;
      this.#db
        .prepare(
          'INSERT INTO local_author_seq(community_id, sequence_scope, next_author_seq) VALUES (?, ?, ?) ' +
            'ON CONFLICT(community_id, sequence_scope) DO UPDATE SET next_author_seq = excluded.next_author_seq',
        )
        .run(cid, scope, n + 1);
      return n;
    });
    return tx(communityId, sequenceScope);
  }

  /** Grava o envelope completo de forma durável e idempotente por `op_id`. */
  enqueue(item: EnqueueInput): EnqueueResult {
    const tx = this.#db.transaction(() => {
      const result = this.#db
        .prepare(
          'INSERT OR IGNORE INTO local_outbox(op_id, community_id, channel_id, sequence_scope, kind, author_seq, ' +
            'envelope, client_ref, created_at, attempts, next_attempt_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, \'queued\')',
        )
        .run(
          item.opId,
          item.communityId,
          item.channelId,
          item.sequenceScope,
          item.kind,
          item.authorSeq,
          item.envelope,
          item.clientRef,
          item.now,
          item.now,
        );
      return result.changes > 0 ? Number(result.lastInsertRowid) : null;
    });
    const localSeq = tx();
    return { enqueued: localSeq !== null, localSeq };
  }

  /**
   * Retorna a cabeça pronta de cada canal, agrupada por canal. Um estado não pronto bloqueia
   * somente o próprio canal; `sending` já ocupado também não é duplicado.
   */
  ready(communityId: string, now: number, maxPerChannel: number): Map<string, OutboxRow[]> {
    const readyRows = this.#db
      .prepare(
        "SELECT * FROM local_outbox WHERE community_id = ? AND state = 'queued' AND next_attempt_at <= ? ORDER BY local_seq",
      )
      .all(communityId, now) as OutboxRow[];
    const readyIds = new Set(readyRows.map((row) => row.local_seq));
    const occupied = new Set(
      (
        this.#db
          .prepare("SELECT DISTINCT channel_id FROM local_outbox WHERE community_id = ? AND state = 'sending'")
          .all(communityId) as Array<{ channel_id: string | null }>
      ).map((row) => channelKey(row.channel_id)),
    );
    const rows = this.#db
      .prepare("SELECT * FROM local_outbox WHERE community_id = ? AND state != 'dropped' ORDER BY local_seq")
      .all(communityId) as OutboxRow[];
    const blocked = new Set<string>();
    const groups = new Map<string, OutboxRow[]>();
    for (const row of rows) {
      const key = channelKey(row.channel_id);
      if (occupied.has(key) || blocked.has(key)) continue;
      if (row.state !== 'queued' || !readyIds.has(row.local_seq)) {
        blocked.add(key);
        continue;
      }
      const group = groups.get(key) ?? [];
      if (group.length >= maxPerChannel) {
        blocked.add(key);
        continue;
      }
      group.push(row);
      groups.set(key, group);
    }
    return groups;
  }

  all(communityId: string): OutboxRow[] {
    return this.#db.prepare('SELECT * FROM local_outbox WHERE community_id = ? ORDER BY local_seq').all(communityId) as OutboxRow[];
  }

  byOpId(opId: string): OutboxRow | undefined {
    return this.#db.prepare('SELECT * FROM local_outbox WHERE op_id = ?').get(opId) as OutboxRow | undefined;
  }

  countActive(communityId: string): number {
    return (
      this.#db
        .prepare("SELECT COUNT(*) AS n FROM local_outbox WHERE community_id = ? AND state != 'dropped'")
        .get(communityId) as { n: number }
    ).n;
  }

  setState(localSeq: number, state: OutboxState, extra: Partial<Pick<OutboxRow, 'acked_seq' | 'last_error' | 'dropped_reason' | 'attempts' | 'next_attempt_at'>> = {}): void {
    const fields: string[] = ['state = ?'];
    const values: unknown[] = [state];
    for (const field of ['acked_seq', 'last_error', 'dropped_reason', 'attempts', 'next_attempt_at'] as const) {
      if (Object.hasOwn(extra, field)) {
        fields.push(`${field} = ?`);
        values.push(extra[field]);
      }
    }
    values.push(localSeq);
    this.#db.prepare(`UPDATE local_outbox SET ${fields.join(', ')} WHERE local_seq = ?`).run(...values);
  }

  /** Recupera somente estados que pertenciam ao processo encerrado. */
  recoverSending(now: number): number {
    return this.#db
      .prepare("UPDATE local_outbox SET state = 'queued', next_attempt_at = ? WHERE state = 'sending'")
      .run(now).changes;
  }

  remove(localSeq: number): void {
    this.#db.prepare('DELETE FROM local_outbox WHERE local_seq = ?').run(localSeq);
  }

  metaGet(key: string): string | null {
    const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  metaSet(key: string, value: string): void {
    this.#db
      .prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  // --- secrets (§10.2) -----------------------------------------------------------

  setSecret(name: string, ciphertext: Buffer, nonce: Buffer | null = null): void {
    this.#db
      .prepare('INSERT INTO secrets(name, ciphertext, nonce) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET ciphertext = excluded.ciphertext, nonce = excluded.nonce')
      .run(name, ciphertext, nonce);
  }

  getSecret(name: string): { ciphertext: Buffer; nonce: Buffer | null } | null {
    const row = this.#db.prepare('SELECT ciphertext, nonce FROM secrets WHERE name = ?').get(name) as
      | { ciphertext: Buffer; nonce: Buffer | null }
      | undefined;
    return row ?? null;
  }

  deleteSecret(name: string): void {
    this.#db.prepare('DELETE FROM secrets WHERE name = ?').run(name);
  }

  hasSecret(name: string): boolean {
    const row = this.#db.prepare('SELECT 1 FROM secrets WHERE name = ?').get(name) as unknown | undefined;
    return row !== undefined;
  }

  // --- local_relay_consent (§6.15 — estado local, nunca replica) ------------------

  /** Decisão persistida do consentimento de relay; `null` quando nunca perguntado. */
  getRelayConsent(communityId: string): { decision: 'accepted' | 'declined'; at: number } | null {
    const row = this.#db
      .prepare('SELECT decision, at FROM local_relay_consent WHERE community_id = ?')
      .get(communityId) as { decision: string; at: number } | undefined;
    if (row === undefined) return null;
    if (row.decision !== 'accepted' && row.decision !== 'declined') return null;
    return { decision: row.decision, at: row.at };
  }

  setRelayConsent(communityId: string, decision: 'accepted' | 'declined', at: number): void {
    this.#db
      .prepare(
        'INSERT INTO local_relay_consent(community_id, decision, at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(community_id) DO UPDATE SET decision = excluded.decision, at = excluded.at',
      )
      .run(communityId, decision, at);
  }

  forgetRelayConsent(communityId: string): void {
    this.#db.prepare('DELETE FROM local_relay_consent WHERE community_id = ?').run(communityId);
  }

  // --- wipe_state (§18.6, §10.8) ------------------------------------------------

  getWipeState(): string {
    return this.metaGet('wipe_state') ?? 'none';
  }  setWipeState(state: string): void {
    this.metaSet('wipe_state', state);
  }

  // --- install_id (§10.8) ------------------------------------------------------

  getInstallId(): string | null {
    return this.metaGet('install_id');
  }

  setInstallId(id: string): void {
    this.metaSet('install_id', id);
  }

  ensureInstallId(): string {
    let id = this.getInstallId();
    if (id === null || id.length === 0) {
      id = crypto.randomBytes(16).toString('hex');
      this.setInstallId(id);
    }
    return id;
  }

  // --- communities (§10.2) -----------------------------------------------------

  upsertCommunity(row: {
    communityId: string;
    coreKey: Buffer;
    blobsKey: Buffer;
    communitySeedEnc?: Buffer | null;
    communitySeedNonce?: Buffer | null;
    isHost: boolean;
    joinedAt: number;
    leftAt?: number | null;
    removedReason?: string | null;
    retainUntil?: number | null;
    originCommunityId?: string | null;
  }): void {
    this.#db
      .prepare(
        'INSERT INTO communities(community_id, core_key, blobs_key, community_seed_enc, community_seed_nonce, is_host, joined_at, left_at, removed_reason, retain_until, origin_community_id) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(community_id) DO UPDATE SET core_key = excluded.core_key, blobs_key = excluded.blobs_key, community_seed_enc = excluded.community_seed_enc, community_seed_nonce = excluded.community_seed_nonce, is_host = excluded.is_host, joined_at = excluded.joined_at, left_at = excluded.left_at, removed_reason = excluded.removed_reason, retain_until = excluded.retain_until, origin_community_id = excluded.origin_community_id',
      )
      .run(
        row.communityId,
        row.coreKey,
        row.blobsKey,
        row.communitySeedEnc ?? null,
        row.communitySeedNonce ?? null,
        row.isHost ? 1 : 0,
        row.joinedAt,
        row.leftAt ?? null,
        row.removedReason ?? null,
        row.retainUntil ?? null,
        row.originCommunityId ?? null,
      );
  }

  getCommunity(communityId: string): unknown | null {
    const row = this.#db.prepare('SELECT * FROM communities WHERE community_id = ?').get(communityId) as unknown | undefined;
    return row ?? null;
  }

  /** §11.1 exceção — saída local imediata: marca `left_at` na linha da comunidade. */
  markCommunityLeft(communityId: string, leftAt: number): void {
    this.#db.prepare('UPDATE communities SET left_at = ? WHERE community_id = ?').run(leftAt, communityId);
  }

  /**
   * §5.3 passo 2 — a linha órfã de uma criação que morreu entre gravar a semente e criar o
   * core é **descartada**, não marcada: nunca houve comunidade ali. Também usada pelo
   * rollback de `community.create` quando o append da gênese falha (§19.1 "Falhas").
   */
  deleteCommunity(communityId: string): void {
    this.#db.prepare('DELETE FROM communities WHERE community_id = ?').run(communityId);
  }

  /**
   * Core de blobs local do membro (§13.1, §10.2): a semente cifrada pela Data Key é o que
   * torna o core recuperável sem depender de estado em memória. `community.create` grava a
   * linha do fundador; `invite.redeem`, a de quem entra.
   */
  setMemberBlobsCore(row: { communityId: string; coreKey: Buffer; secretSeedEnc: Buffer }): void {
    this.#db
      .prepare(
        'INSERT INTO member_blobs_core(community_id, core_key, secret_seed_enc) VALUES (?, ?, ?) ' +
          'ON CONFLICT(community_id) DO UPDATE SET core_key = excluded.core_key, secret_seed_enc = excluded.secret_seed_enc',
      )
      .run(row.communityId, row.coreKey, row.secretSeedEnc);
  }

  getMemberBlobsCore(communityId: string): { communityId: string; coreKey: Buffer; secretSeedEnc: Buffer } | null {
    const row = this.#db
      .prepare('SELECT community_id AS communityId, core_key AS coreKey, secret_seed_enc AS secretSeedEnc FROM member_blobs_core WHERE community_id = ?')
      .get(communityId) as { communityId: string; coreKey: Buffer; secretSeedEnc: Buffer } | undefined;
    return row ?? null;
  }

  listCommunities(): unknown[] {
    return this.#db.prepare('SELECT * FROM communities').all() as unknown[];
  }

  // --- invite_secrets (§12.2, §10.2) ------------------------------------------

  setInviteSecret(row: { invitePublicKey: Buffer; communityId: string; secret: Buffer; label?: string | null }): void {
    this.#db
      .prepare(
        'INSERT INTO invite_secrets(invite_public_key, community_id, secret, label) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(invite_public_key) DO UPDATE SET community_id = excluded.community_id, secret = excluded.secret, label = excluded.label',
      )
      .run(row.invitePublicKey, row.communityId, row.secret, row.label ?? null);
  }

  getInviteSecret(invitePublicKeyHex: string): { invitePublicKey: Buffer; communityId: string; secret: Buffer; label: string | null } | null {
    const row = this.#db
      .prepare('SELECT invite_public_key AS invitePublicKey, community_id AS communityId, secret, label FROM invite_secrets WHERE invite_public_key = ?')
      .get(Buffer.from(invitePublicKeyHex, 'hex')) as
      | { invitePublicKey: Buffer; communityId: string; secret: Buffer; label: string | null }
      | undefined;
    return row ?? null;
  }

  getInviteSecretBySecret(secret: Buffer): { invitePublicKey: Buffer; communityId: string; secret: Buffer; label: string | null } | null {
    const row = this.#db
      .prepare('SELECT invite_public_key AS invitePublicKey, community_id AS communityId, secret, label FROM invite_secrets WHERE secret = ?')
      .get(secret) as
      | { invitePublicKey: Buffer; communityId: string; secret: Buffer; label: string | null }
      | undefined;
    return row ?? null;
  }

  listInviteSecrets(communityId?: string): Array<{ invitePublicKey: Buffer; communityId: string; secret: Buffer; label: string | null }> {
    if (communityId === undefined) {
      return this.#db.prepare('SELECT invite_public_key AS invitePublicKey, community_id AS communityId, secret, label FROM invite_secrets').all() as Array<{
        invitePublicKey: Buffer;
        communityId: string;
        secret: Buffer;
        label: string | null;
      }>;
    }
    return this.#db
      .prepare('SELECT invite_public_key AS invitePublicKey, community_id AS communityId, secret, label FROM invite_secrets WHERE community_id = ?')
      .all(communityId) as Array<{ invitePublicKey: Buffer; communityId: string; secret: Buffer; label: string | null }>;
  }

  deleteInviteSecret(invitePublicKeyHex: string): void {
    this.#db.prepare('DELETE FROM invite_secrets WHERE invite_public_key = ?').run(Buffer.from(invitePublicKeyHex, 'hex'));
  }

  checkpoint(): void {
    this.#db.pragma('wal_checkpoint(TRUNCATE)');
  }

  // --- estado local de leitura e preferência de exibição (§10.2) ------------------
  //
  // Estas quatro tabelas são **locais e não replicam**: quem as escreve são as preferências
  // de §15.4 (`channel.markRead`, `channel.setMuted`, `category.setCollapsed`) e nada mais.
  // Aqui há só leitura por chave — a derivação de "não lidas" pertence a quem escreve.

  /** `local_read_state` — linha ausente é o estado inicial: nada lido, nada por ler. */
  getReadState(communityId: string, channelId: string): { lastReadSeq: number; firstUnreadSeq: number | null; unreadCount: number; pendingMentions: number } {
    const row = this.#db
      .prepare(
        'SELECT last_read_seq AS lastReadSeq, first_unread_seq AS firstUnreadSeq, unread_count AS unreadCount, ' +
          'pending_mentions AS pendingMentions FROM local_read_state WHERE community_id = ? AND channel_id = ?',
      )
      .get(communityId, channelId) as
      | { lastReadSeq: number; firstUnreadSeq: number | null; unreadCount: number; pendingMentions: number }
      | undefined;
    return row ?? { lastReadSeq: -1, firstUnreadSeq: null, unreadCount: 0, pendingMentions: 0 };
  }

  /** `local_thread_read_state` — mesma regra da linha ausente. */
  getThreadReadState(communityId: string, threadId: string): { lastReadSeq: number; unreadCount: number } {
    const row = this.#db
      .prepare('SELECT last_read_seq AS lastReadSeq, unread_count AS unreadCount FROM local_thread_read_state WHERE community_id = ? AND thread_id = ?')
      .get(communityId, threadId) as { lastReadSeq: number; unreadCount: number } | undefined;
    return row ?? { lastReadSeq: -1, unreadCount: 0 };
  }

  /** `local_channel_pref.muted` — a chave é o canal, que já é único por comunidade (§7.3). */
  isChannelMuted(channelId: string): boolean {
    const row = this.#db.prepare('SELECT muted FROM local_channel_pref WHERE channel_id = ?').get(channelId) as { muted: number } | undefined;
    return row !== undefined && row.muted !== 0;
  }

  /** `local_community_pref.collapsed_categories` — JSON de ids; forma inválida é lista vazia. */
  collapsedCategories(communityId: string): ReadonlySet<string> {
    const row = this.#db.prepare('SELECT collapsed_categories AS collapsed FROM local_community_pref WHERE community_id = ?').get(communityId) as
      | { collapsed: string | null }
      | undefined;
    if (row?.collapsed == null) return new Set();
    try {
      const parsed: unknown = JSON.parse(row.collapsed);
      return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  }

  close(): void {
    this.#db.close();
  }
}

export function openManifestDb(path: string): ManifestDb {
  return new ManifestDb(path);
}
