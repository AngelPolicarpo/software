/**
 * `view.db` — backend-v2.md §10.3 (schema), §10.4 (PRAGMAs).
 *
 * TOTALMENTE DERIVADO: apagar e reprojetar reconstroi byte a byte. Toda PK inclui
 * `community_id`. O `projector` e o UNICO escritor (§21.1).
 *
 * ESCOPO DO POC-01: as tabelas alcancadas pelos 16 `kind`s implementados. Fora:
 * `messages_fts` (busca), `attachments` (blobs), `threads`, `message_links`,
 * `timeouts`, `relay_volunteers` — todos explicitamente fora do escopo do gate.
 */
import Database from 'better-sqlite3';
import { blake2b256 } from '../crypto/index.ts';
import type { CsTable, EntityKey, Primitive } from '../fold/effects.ts';

export type DB = Database.Database;

/** Colunas de chave por tabela, depois de `community_id`. */
export const KEY_COLS: Record<CsTable, readonly string[]> = {
  communities: ['id'],
  members: ['identity_key'],
  member_roles: ['identity_key', 'role_id'],
  roles: ['id'],
  categories: ['id'],
  channels: ['id'],
  messages: ['id'],
  reactions: ['message_id', 'emoji', 'identity_key'],
  bans: ['target_key'],
  invites: ['invite_public_key'],
  moderation_log: ['id'],
};

/** Ordem canonica de dump: tabelas e colunas fixas, para o hash de §28.4. */
export const DUMP_TABLES: ReadonlyArray<{ table: string; cols: readonly string[]; order: readonly string[] }> = [
  {
    table: 'communities',
    cols: ['id', 'core_key', 'blobs_key', 'host_key', 'founder_key', 'name', 'icon_emoji', 'icon_color', 'description', 'created_at', 'member_count', 'ended_at', 'origin_community_id'],
    order: ['community_id', 'id'],
  },
  {
    table: 'members',
    cols: ['identity_key', 'display_name', 'avatar_color', 'nickname', 'blobs_core_key', 'joined_at', 'left_at', 'banned', 'timeout_until', 'storage_used_bytes'],
    order: ['community_id', 'identity_key'],
  },
  { table: 'member_roles', cols: ['identity_key', 'role_id'], order: ['community_id', 'identity_key', 'role_id'] },
  {
    table: 'roles',
    cols: ['id', 'name', 'color', 'rank', 'permissions', 'mentionable', 'is_founder', 'is_default', 'member_count', 'deleted_at'],
    order: ['community_id', 'id'],
  },
  { table: 'categories', cols: ['id', 'name', 'rank', 'deleted_at'], order: ['community_id', 'id'] },
  {
    table: 'channels',
    cols: ['id', 'category_id', 'type', 'name', 'topic', 'rank', 'read_only_role_ids', 'deleted_at'],
    order: ['community_id', 'id'],
  },
  {
    table: 'messages',
    cols: ['id', 'seq', 'channel_id', 'author_key', 'content', 'author_ts', 'host_ts', 'clock_skewed', 'edited_at', 'pinned', 'reply_to_id', 'thread_id', 'mentions', 'mention_everyone_effective', 'deleted_at', 'hidden_by_ban', 'orphaned'],
    order: ['community_id', 'id'],
  },
  { table: 'reactions', cols: ['message_id', 'emoji', 'identity_key', 'at'], order: ['community_id', 'message_id', 'emoji', 'identity_key'] },
  { table: 'bans', cols: ['target_key', 'by_key', 'at', 'reason', 'revoked_at'], order: ['community_id', 'target_key'] },
  {
    table: 'invites',
    cols: ['invite_public_key', 'created_by', 'created_at', 'expires_at', 'max_uses', 'uses', 'revoked_at', 'label'],
    order: ['community_id', 'invite_public_key'],
  },
  {
    table: 'moderation_log',
    cols: ['id', 'seq', 'type', 'target_id', 'target_label', 'by_key', 'by_label', 'reason', 'at'],
    order: ['community_id', 'id'],
  },
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS communities (
  community_id TEXT NOT NULL, id TEXT NOT NULL, core_key BLOB NOT NULL, blobs_key BLOB NOT NULL,
  host_key BLOB NOT NULL, founder_key BLOB NOT NULL, name TEXT NOT NULL, icon_emoji TEXT,
  icon_color INT NOT NULL, description TEXT, created_at INT NOT NULL,
  member_count INT NOT NULL DEFAULT 0, ended_at INT, origin_community_id TEXT,
  PRIMARY KEY (community_id, id));

CREATE TABLE IF NOT EXISTS members (
  community_id TEXT NOT NULL, identity_key BLOB NOT NULL, display_name TEXT NOT NULL,
  avatar_color INT NOT NULL, nickname TEXT, blobs_core_key BLOB, joined_at INT NOT NULL,
  left_at INT, banned INT NOT NULL DEFAULT 0, timeout_until INT,
  storage_used_bytes INT NOT NULL DEFAULT 0,
  PRIMARY KEY (community_id, identity_key));
CREATE INDEX IF NOT EXISTS idx_members_active ON members(community_id, left_at, banned);

CREATE TABLE IF NOT EXISTS member_roles (
  community_id TEXT NOT NULL, identity_key BLOB NOT NULL, role_id TEXT NOT NULL,
  PRIMARY KEY (community_id, identity_key, role_id));
CREATE INDEX IF NOT EXISTS idx_member_roles_role ON member_roles(community_id, role_id);

CREATE TABLE IF NOT EXISTS roles (
  community_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, color INT NOT NULL,
  rank TEXT NOT NULL, permissions TEXT NOT NULL, mentionable INT NOT NULL,
  is_founder INT NOT NULL, is_default INT NOT NULL, member_count INT NOT NULL DEFAULT 0,
  deleted_at INT, PRIMARY KEY (community_id, id));
CREATE INDEX IF NOT EXISTS idx_roles_rank ON roles(community_id, rank DESC);

CREATE TABLE IF NOT EXISTS categories (
  community_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, rank TEXT NOT NULL,
  deleted_at INT, PRIMARY KEY (community_id, id));
CREATE INDEX IF NOT EXISTS idx_categories_rank ON categories(community_id, rank);

CREATE TABLE IF NOT EXISTS channels (
  community_id TEXT NOT NULL, id TEXT NOT NULL, category_id TEXT NOT NULL, type INT NOT NULL,
  name TEXT NOT NULL, topic TEXT, rank TEXT NOT NULL, read_only_role_ids TEXT NOT NULL,
  deleted_at INT, PRIMARY KEY (community_id, id));
CREATE UNIQUE INDEX IF NOT EXISTS uniq_channels_name
  ON channels(community_id, type, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_channels_cat ON channels(community_id, category_id, rank);

CREATE TABLE IF NOT EXISTS messages (
  community_id TEXT NOT NULL, id TEXT NOT NULL, seq INT NOT NULL, channel_id TEXT NOT NULL,
  author_key BLOB NOT NULL, content TEXT, author_ts INT NOT NULL, host_ts INT NOT NULL,
  clock_skewed INT NOT NULL, edited_at INT, pinned INT NOT NULL DEFAULT 0, reply_to_id TEXT,
  thread_id TEXT, mentions TEXT, mention_everyone_effective INT NOT NULL DEFAULT 0,
  deleted_at INT, hidden_by_ban INT NOT NULL DEFAULT 0, orphaned INT NOT NULL DEFAULT 0,
  PRIMARY KEY (community_id, id));
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(community_id, channel_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(community_id, author_key);

CREATE TABLE IF NOT EXISTS reactions (
  community_id TEXT NOT NULL, message_id TEXT NOT NULL, emoji TEXT NOT NULL,
  identity_key BLOB NOT NULL, at INT NOT NULL,
  PRIMARY KEY (community_id, message_id, emoji, identity_key));
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(community_id, message_id);

CREATE TABLE IF NOT EXISTS bans (
  community_id TEXT NOT NULL, target_key BLOB NOT NULL, by_key BLOB NOT NULL, at INT NOT NULL,
  reason TEXT, revoked_at INT, PRIMARY KEY (community_id, target_key));

CREATE TABLE IF NOT EXISTS invites (
  community_id TEXT NOT NULL, invite_public_key BLOB NOT NULL, created_by BLOB NOT NULL,
  created_at INT NOT NULL, expires_at INT, max_uses INT, uses INT NOT NULL DEFAULT 0,
  revoked_at INT, label TEXT, PRIMARY KEY (community_id, invite_public_key));

CREATE TABLE IF NOT EXISTS moderation_log (
  community_id TEXT NOT NULL, id TEXT NOT NULL, seq INT NOT NULL, type TEXT NOT NULL,
  target_id TEXT, target_label TEXT, by_key BLOB NOT NULL, by_label TEXT NOT NULL,
  reason TEXT, at INT NOT NULL, PRIMARY KEY (community_id, id));
CREATE INDEX IF NOT EXISTS idx_modlog ON moderation_log(community_id, seq DESC);

-- Diagnostico (§10.3). Podado acima de REJECTED_LOG_MAX linhas por comunidade.
CREATE TABLE IF NOT EXISTS rejected_records (
  community_id TEXT NOT NULL, seq INT NOT NULL, kind INT NOT NULL, author_key BLOB,
  reason TEXT NOT NULL, PRIMARY KEY (community_id, seq));

-- Snapshot do DecisionState (§10.6).
CREATE TABLE IF NOT EXISTS ds_snapshot (
  community_id TEXT PRIMARY KEY, interpreted_seq INT NOT NULL, blob BLOB NOT NULL,
  fold_build_id TEXT NOT NULL, taken_at INT NOT NULL);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export function openViewDb(path: string): DB {
  const db = new Database(path);
  // §10.4 — view.db: WAL, synchronous=NORMAL (dado reconstruivel).
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = OFF');
  db.pragma('busy_timeout = 5000');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -32000');
  db.exec(SCHEMA);
  return db;
}

/** DROP e recria todas as tabelas de `view.db` (reprojecao total, §10.5). */
export function wipeViewDb(db: DB): void {
  const tables = [...DUMP_TABLES.map((t) => t.table), 'rejected_records', 'ds_snapshot', 'meta'];
  db.exec('BEGIN');
  for (const t of tables) db.exec(`DROP TABLE IF EXISTS ${t}`);
  db.exec('COMMIT');
  db.exec(SCHEMA);
}

// ---------------------------------------------------------------------------------
// Hash de dump ordenado (§28.4, P-11)
// ---------------------------------------------------------------------------------

function canon(v: unknown): string {
  if (v === null || v === undefined) return 'N';
  if (Buffer.isBuffer(v)) return `B:${v.toString('hex')}`;
  if (typeof v === 'number') return `I:${v}`;
  if (typeof v === 'bigint') return `I:${v.toString()}`;
  if (typeof v === 'string') return `S:${v}`;
  return `?:${String(v)}`;
}

/**
 * Hash de dump ordenado do Estado de Conteudo. Duas replicas que interpretaram o mesmo
 * prefixo do log PRECISAM produzir o mesmo hash (§28.4 teste 2). Uma divergencia e
 * reprovacao do gate.
 */
export function dumpHash(db: DB, communityId: string): { hash: string; rows: number } {
  const parts: string[] = [];
  let rows = 0;
  for (const spec of DUMP_TABLES) {
    parts.push(`#${spec.table}`);
    const sql = `SELECT ${spec.cols.join(', ')} FROM ${spec.table} WHERE community_id = ? ORDER BY ${spec.order.join(', ')}`;
    for (const r of db.prepare(sql).all(communityId) as Array<Record<string, unknown>>) {
      rows++;
      parts.push(spec.cols.map((c) => canon(r[c])).join(''));
    }
  }
  return { hash: blake2b256('dump/1', Buffer.from(parts.join(''), 'utf8')).toString('hex'), rows };
}

/** Dump textual completo, para diff humano quando o hash divergir. */
export function dumpText(db: DB, communityId: string): string {
  const out: string[] = [];
  for (const spec of DUMP_TABLES) {
    const sql = `SELECT ${spec.cols.join(', ')} FROM ${spec.table} WHERE community_id = ? ORDER BY ${spec.order.join(', ')}`;
    for (const r of db.prepare(sql).all(communityId) as Array<Record<string, unknown>>) {
      out.push(`${spec.table}\t${spec.cols.map((c) => canon(r[c])).join('\t')}`);
    }
  }
  return out.join('\n');
}

export type { CsTable, EntityKey, Primitive };
