// Dump ordenado de `view.db` — o oráculo de §28.4.
//
// §28.4 teste 1: apagar `view.db` e reprojetar do `seq` 0 produz **o mesmo hash de dump
// ordenado**. Este arquivo define o que "dump ordenado" é: a lista canônica de tabelas e
// colunas, em ordem fixa, fora de `community_id` (que é constante na consulta). Duas
// réplicas que interpretaram o mesmo prefixo do log produzem o mesmo hash — divergência
// aqui é reprovação do gate, não detalhe.
//
// Fora do dump: `ds_snapshot` (cache com `taken_at` de relógio de parede) e `meta`. O FTS5
// contentless-delete não permite reler o `content` (§10.3, `content=''`), então dele só se
// verifica o **conjunto** de `rowid` indexados — a pertença ao índice é o que o
// `ftsIndex`/`ftsRemove` decidem, e é isso que precisa ser determinístico.

import sodium from 'sodium-native';

import type { CsTableName } from './schema.ts';
import type { ViewDb } from './index.ts';

/** O que o dump precisa: preparar e ler. É o `ViewDb` inteiro nos testes e no CI. */
export type StatementLike = {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
};

/** Ordem canônica: a lista de §10.3, colunas na ordem em que aparecem na tabela. */
const DUMP_TABLES: ReadonlyArray<{
  readonly table: CsTableName | 'rejected_records';
  readonly cols: readonly string[];
  readonly order: readonly string[];
}> = [
  {
    table: 'communities',
    cols: ['id', 'core_key', 'blobs_key', 'host_key', 'founder_key', 'name', 'icon_emoji', 'icon_color', 'description', 'created_at', 'member_count', 'ended_at', 'origin_community_id', 'successor_keys'],
    order: ['id'],
  },
  {
    table: 'members',
    cols: ['identity_key', 'display_name', 'avatar_color', 'nickname', 'blobs_core_key', 'joined_at', 'left_at', 'banned', 'timeout_until', 'storage_used_bytes', 'display_name_collision'],
    order: ['identity_key'],
  },
  { table: 'member_roles', cols: ['identity_key', 'role_id'], order: ['identity_key', 'role_id'] },
  {
    table: 'roles',
    cols: ['id', 'name', 'color', 'rank', 'permissions', 'mentionable', 'is_founder', 'is_default', 'member_count', 'deleted_at'],
    order: ['id'],
  },
  { table: 'categories', cols: ['id', 'name', 'rank', 'deleted_at'], order: ['id'] },
  {
    table: 'channels',
    cols: ['id', 'category_id', 'type', 'name', 'topic', 'rank', 'read_only_role_ids', 'deleted_at'],
    order: ['id'],
  },
  {
    table: 'messages',
    cols: ['id', 'seq', 'channel_id', 'author_key', 'content', 'author_ts', 'host_ts', 'clock_skewed', 'edited_at', 'pinned', 'reply_to_id', 'thread_id', 'mentions', 'mention_everyone_effective', 'deleted_at', 'hidden_by_ban', 'orphaned'],
    order: ['id'],
  },
  { table: 'message_links', cols: ['message_id', 'idx', 'url', 'host', 'seq'], order: ['message_id', 'idx'] },
  {
    table: 'attachments',
    cols: ['message_id', 'owner_key', 'blobs_core_key', 'blob_id', 'name', 'size_bytes', 'kind', 'hash'],
    order: ['message_id'],
  },
  { table: 'reactions', cols: ['message_id', 'emoji', 'identity_key', 'at'], order: ['message_id', 'emoji', 'identity_key'] },
  { table: 'threads', cols: ['id', 'root_message_id', 'channel_id', 'reply_count', 'root_deleted'], order: ['id'] },
  {
    table: 'invites',
    cols: ['invite_public_key', 'created_by', 'created_at', 'expires_at', 'max_uses', 'uses', 'revoked_at', 'label'],
    order: ['invite_public_key'],
  },
  { table: 'bans', cols: ['target_key', 'by_key', 'at', 'reason', 'revoked_at'], order: ['target_key'] },
  { table: 'timeouts', cols: ['target_key', 'by_key', 'at', 'until', 'reason'], order: ['target_key'] },
  {
    table: 'moderation_log',
    cols: ['id', 'seq', 'type', 'target_id', 'target_label', 'by_key', 'by_label', 'reason', 'at'],
    order: ['id'],
  },
  {
    table: 'relay_volunteers',
    cols: ['identity_key', 'relay_public_key', 'since', 'expires_at', 'withdrawn_at'],
    order: ['identity_key'],
  },
  { table: 'rejected_records', cols: ['seq', 'kind', 'author_key', 'reason'], order: ['seq'] },
];

/** Serialização canônica de um valor de coluna — chave do determinismo do hash. */
function canon(v: unknown): string {
  if (v === null || v === undefined) return 'N';
  if (Buffer.isBuffer(v)) return `B:${v.toString('hex')}`;
  if (typeof v === 'number') return `I:${v}`;
  if (typeof v === 'bigint') return `I:${v.toString()}`;
  if (typeof v === 'string') return `S:${v}`;
  return `?:${String(v)}`;
}

export type DumpResult = { hash: string; rows: number };

/**
 * Hash de dump ordenado do Estado de Conteúdo de uma comunidade (§28.4). BLAKE2b-256 com
 * separação de domínio `dump/1`, como qualquer digest do projeto (§5.1).
 */
export function dumpHash(statement: StatementLike, communityId: string): DumpResult {
  const parts: string[] = [];
  let rows = 0;
  for (const spec of DUMP_TABLES) {
    parts.push(`#${spec.table}`);
    const sql = `SELECT ${spec.cols.join(', ')} FROM ${spec.table} WHERE community_id = ? ORDER BY ${spec.order.join(', ')}`;
    for (const r of statement.prepare(sql).all(communityId) as Array<Record<string, unknown>>) {
      rows++;
      parts.push(spec.cols.map((c) => canon(r[c])).join('\u0001'));
    }
  }
  // FTS5 contentless-delete: só o conjunto de rowid é verificável (§10.3, `content=''`).
  parts.push('#messages_fts');
  const ftsRows = statement
    .prepare('SELECT rowid FROM messages_fts WHERE rowid IN (SELECT rowid FROM messages WHERE community_id = ?) ORDER BY rowid')
    .all(communityId) as Array<{ rowid: number }>;
  for (const r of ftsRows) {
    rows++;
    parts.push(`I:${r.rowid}`);
  }
  const digest = Buffer.alloc(32);
  sodium.crypto_generichash_batch(digest, [Buffer.from('dump/1', 'utf8'), Buffer.from(parts.join('\u0002'), 'utf8')]);
  return { hash: digest.toString('hex'), rows };
}

/** Dump textual completo, para diff humano quando o hash divergir. */
export function dumpText(statement: StatementLike, communityId: string): string {
  const out: string[] = [];
  for (const spec of DUMP_TABLES) {
    const sql = `SELECT ${spec.cols.join(', ')} FROM ${spec.table} WHERE community_id = ? ORDER BY ${spec.order.join(', ')}`;
    for (const r of statement.prepare(sql).all(communityId) as Array<Record<string, unknown>>) {
      out.push(`${spec.table}\t${spec.cols.map((c) => canon(r[c])).join('\t')}`);
    }
  }
  return out.join('\n');
}
