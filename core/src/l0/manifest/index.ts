// `manifest` — L0. Estado local durável de §10.2 e §11.2.
//
// Este módulo conhece apenas armazenamento local. A regra de domínio da outbox vive em L2;
// aqui ficam o schema, as transações e a ordem local persistida.

import Database from 'better-sqlite3';

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

  checkpoint(): void {
    this.#db.pragma('wal_checkpoint(TRUNCATE)');
  }

  close(): void {
    this.#db.close();
  }
}

export function openManifestDb(path: string): ManifestDb {
  return new ManifestDb(path);
}
