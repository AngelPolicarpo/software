import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import Corestore from 'corestore';
import Hypercore from 'hypercore';

/**
 * Harness G2 — separa manifest.db (FULL, autoritativo) de view.db (NORMAL, derivado).
 * Hipótese POC-02: apagar view.db e reprojetar reconstrói byte a byte sem perder comunidade/chave/blob.
 */

export type Community = { id: string; coreKey: Buffer; blobsKey: Buffer; seed: Buffer };

export function createManifest(manifestPath: string): Database.Database {
  const db = new Database(manifestPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, ciphertext BLOB NOT NULL, nonce BLOB);
    CREATE TABLE IF NOT EXISTS communities (
      community_id TEXT PRIMARY KEY, core_key BLOB NOT NULL, blobs_key BLOB NOT NULL,
      community_seed_enc BLOB, community_seed_nonce BLOB, is_host INT NOT NULL,
      joined_at INT NOT NULL, left_at INT, origin_community_id TEXT
    );
    CREATE TABLE IF NOT EXISTS local_outbox (
      local_seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT UNIQUE NOT NULL,
      community_id TEXT NOT NULL, channel_id TEXT, sequence_scope TEXT NOT NULL,
      kind INT NOT NULL, author_seq INT NOT NULL, envelope BLOB NOT NULL,
      client_ref TEXT, created_at INT NOT NULL, attempts INT NOT NULL DEFAULT 0,
      next_attempt_at INT NOT NULL, state TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_author_seq (
      community_id TEXT NOT NULL, sequence_scope TEXT NOT NULL, next_author_seq INT NOT NULL,
      PRIMARY KEY (community_id, sequence_scope)
    );
    CREATE TABLE IF NOT EXISTS local_blob_cache (
      blobs_core_key BLOB NOT NULL, blob_id_hex TEXT NOT NULL, bytes_downloaded INT NOT NULL,
      state TEXT NOT NULL, path TEXT, PRIMARY KEY (blobs_core_key, blob_id_hex)
    );
    CREATE TABLE IF NOT EXISTS member_blobs_core (
      community_id TEXT PRIMARY KEY, core_key BLOB, secret_seed_enc BLOB
    );
  `);
  const v = db.prepare('SELECT value FROM meta WHERE key=?').get('manifest_schema_version') as { value?: string } | undefined;
  if (v === undefined) db.prepare('INSERT INTO meta(key,value) VALUES (?,?)').run('manifest_schema_version', '3');
  return db;
}

export function createView(viewPath: string): Database.Database {
  const db = new Database(viewPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ds_snapshot (community_id TEXT PRIMARY KEY, interpreted_seq INT, blob BLOB, fold_build_id TEXT NOT NULL, taken_at INT);
    CREATE TABLE IF NOT EXISTS communities (
      community_id TEXT NOT NULL, id TEXT NOT NULL, core_key BLOB NOT NULL, blobs_key BLOB NOT NULL,
      host_key BLOB NOT NULL, founder_key BLOB NOT NULL, name TEXT NOT NULL,
      PRIMARY KEY (community_id, id)
    );
    CREATE TABLE IF NOT EXISTS members (
      community_id TEXT NOT NULL, identity_key BLOB NOT NULL, display_name TEXT NOT NULL,
      PRIMARY KEY (community_id, identity_key)
    );
    CREATE TABLE IF NOT EXISTS messages (
      community_id TEXT NOT NULL, id TEXT NOT NULL, seq INT NOT NULL, channel_id TEXT NOT NULL,
      author_key BLOB NOT NULL, content TEXT, PRIMARY KEY (community_id, id)
    );
    CREATE TABLE IF NOT EXISTS observed_ops (
      community_id TEXT NOT NULL, op_id TEXT NOT NULL, seq INT NOT NULL,
      PRIMARY KEY (community_id, op_id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, content='', tokenize='unicode61 remove_diacritics 2');
  `);
  db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES (?,?)').run('view_schema_version', '3');
  db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES (?,?)').run('op_version', '2');
  return db;
}

export function hashDump(viewDb: Database.Database): string {
  const rows = viewDb.prepare('SELECT community_id, id, seq, content FROM messages ORDER BY community_id, seq').all() as Array<Record<string, unknown>>;
  const dump = JSON.stringify(rows);
  return crypto.createHash('sha256').update(dump).digest('hex');
}

export function fileHash(filePath: string): string {
  if (!fs.existsSync(filePath)) return 'missing';
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

export async function createCommunity(manifestDb: Database.Database, viewDb: Database.Database, store: any, communityId: string, seed: Buffer): Promise<Community> {
  const coreKey = crypto.createHash('sha256').update(seed).digest().subarray(0, 32);
  const blobsKey = crypto.createHash('sha256').update(Buffer.concat([seed, Buffer.from('blobs')])).digest().subarray(0, 32);
  const now = Date.now();
  manifestDb.prepare('INSERT INTO communities(community_id, core_key, blobs_key, is_host, joined_at) VALUES (?,?,?,?,?)').run(communityId, coreKey, blobsKey, 1, now);
  // view
  viewDb.prepare('INSERT INTO communities(community_id, id, core_key, blobs_key, host_key, founder_key, name) VALUES (?,?,?,?,?,?,?)').run(communityId, communityId, coreKey, blobsKey, coreKey, coreKey, `C-${communityId.slice(0,4)}`);
  // corestore
  const core = store.get({ name: communityId });
  await core.ready();
  return { id: communityId, coreKey, blobsKey, seed };
}

export async function appendMessages(store: any, viewDb: Database.Database, manifestDb: Database.Database, community: Community, count: number, startSeq: number): Promise<void> {
  const core = store.get({ name: community.id });
  await core.ready();
  const batch: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const seq = startSeq + i;
    const opId = `op-${community.id}-${seq}`;
    const content = `msg ${seq} in ${community.id}`;
    const payload = JSON.stringify({ opId, seq, content, communityId: community.id });
    batch.push(Buffer.from(payload));
    // outbox
    manifestDb.prepare('INSERT OR IGNORE INTO local_outbox(op_id, community_id, sequence_scope, kind, author_seq, envelope, created_at, next_attempt_at, state) VALUES (?,?,?,?,?,?,?,?,?)').run(opId, community.id, 'community', 1, seq, Buffer.from(payload), Date.now(), Date.now(), 'queued');
    manifestDb.prepare('INSERT OR REPLACE INTO local_author_seq(community_id, sequence_scope, next_author_seq) VALUES (?,?,?)').run(community.id, 'community', seq + 1);
  }
  await core.append(batch);
  // projector simples: copia para view
  const tx = viewDb.transaction(() => {
    for (let i = 0; i < count; i++) {
      const seq = startSeq + i;
      const opId = `op-${community.id}-${seq}`;
      const content = `msg ${seq} in ${community.id}`;
      const msgId = `msg-${community.id}-${seq}`;
      viewDb.prepare('INSERT OR IGNORE INTO messages(community_id, id, seq, channel_id, author_key, content) VALUES (?,?,?,?,?,?)').run(community.id, msgId, seq, 'ch-geral', Buffer.alloc(32, 1), content);
      viewDb.prepare('INSERT OR IGNORE INTO observed_ops(community_id, op_id, seq) VALUES (?,?,?)').run(community.id, opId, seq);
      manifestDb.prepare('UPDATE local_outbox SET state=? WHERE op_id=?').run('awaiting-confirmation', opId);
    }
  });
  tx();
  // simula reconciliação §11.6: opId observado → remove
  for (let i = 0; i < count; i++) {
    const opId = `op-${community.id}-${startSeq + i}`;
    const row = viewDb.prepare('SELECT 1 FROM observed_ops WHERE op_id=?').get(opId) as unknown;
    if (row !== undefined) manifestDb.prepare('DELETE FROM local_outbox WHERE op_id=?').run(opId);
  }
}

export async function reproject(dataDir: string, communities: Community[]): Promise<{ viewHash: string; fileHash: string }> {
  const viewPath = path.join(dataDir, 'view.db');
  // apaga view.db (simula perda)
  try { fs.rmSync(viewPath); } catch {}
  try { fs.rmSync(viewPath + '-wal'); } catch {}
  try { fs.rmSync(viewPath + '-shm'); } catch {}
  const viewDb = createView(viewPath);
  const store: any = new (Corestore as any)(path.join(dataDir, 'p2p', 'store'));
  // replay do log por comunidade
  for (const c of communities) {
    const core = store.get({ name: c.id });
    await core.ready();
    const len = core.length;
    for (let seq = 0; seq < len; seq++) {
      const block = await core.get(seq) as unknown as Buffer;
      const payload = JSON.parse(block.toString()) as { opId: string; seq: number; content: string };
      const msgId = `msg-${c.id}-${payload.seq}`;
      viewDb.prepare('INSERT OR IGNORE INTO messages(community_id, id, seq, channel_id, author_key, content) VALUES (?,?,?,?,?,?)').run(c.id, msgId, payload.seq, 'ch-geral', Buffer.alloc(32, 1), payload.content);
      viewDb.prepare('INSERT OR IGNORE INTO observed_ops(community_id, op_id, seq) VALUES (?,?,?)').run(c.id, payload.opId, payload.seq);
    }
  }
  const h = hashDump(viewDb);
  viewDb.close();
  await store.close();
  const fh = fileHash(viewPath);
  return { viewHash: h, fileHash: fh };
}
