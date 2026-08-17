// Tradução de `Effect` → SQL — §8.4.
//
// O `fold` emite `Effect[]`; o `projector` aplica a lista **na ordem**, dentro de **uma
// transação por lote**, e emite os `notify` **depois do commit** (§10.5, §10.7). O projector
// **não decide nada** — este arquivo é a tradução mecânica de cada forma fechada do tipo,
// e mais nada.
//
// §8.4: cada forma em lote vira **um** `UPDATE ... WHERE` sobre índice existente; o `fold`
// não enumera as linhas. A FTS5 não usa triggers (§10.3): `ftsIndex`/`ftsRemove` são
// aplicados na **mesma transação** do `upsert`/`patch` da mensagem, sempre depois dele —
// exatamente a ordem em que o `fold` os emite.

import type { ViewStatement, ViewDb } from '../../l0/view/index.ts';
import { KEY_COLS } from '../../l0/view/index.ts';
import type {
  CsTable,
  Effect,
  EffectScope,
  EntityKey,
  Primitive,
} from '../../l1/fold/index.ts';

export type StmtCache = Map<string, ViewStatement>;

function prep(view: ViewDb, cache: StmtCache, sql: string): ViewStatement {
  let s = cache.get(sql);
  if (s === undefined) {
    s = view.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

/** `INSERT ... ON CONFLICT` com os campos da linha — preserva `rowid`, que a FTS5 usa. */
function applyUpsert(view: ViewDb, cache: StmtCache, communityId: string, eff: Effect & { t: 'upsert' }): void {
  const cols = Object.keys(eff.row);
  if (cols.length === 0) return;
  const pk = KEY_COLS[eff.table].filter((c) => eff.row[c] !== undefined);
  const updatables = cols.filter((c) => !pk.includes(c));
  const sql =
    `INSERT INTO ${eff.table} (community_id, ${cols.join(', ')}) VALUES (${new Array<string>(cols.length + 1).fill('?').join(', ')}) ` +
    `ON CONFLICT(community_id, ${pk.join(', ')}) DO ` +
    (updatables.length > 0
      ? `UPDATE SET ${updatables.map((c) => `${c} = excluded.${c}`).join(', ')}`
      : 'NOTHING');
  prep(view, cache, sql).run(communityId, ...cols.map((c) => eff.row[c]));
}

function whereClause(table: CsTable, key: EntityKey): { cols: string[]; vals: Primitive[] } {
  const cols = KEY_COLS[table].slice(0, key.length);
  return { cols, vals: [...key] };
}

function applyPatch(view: ViewDb, cache: StmtCache, communityId: string, eff: Effect & { t: 'patch' }): void {
  const set = Object.keys(eff.fields);
  if (set.length === 0) return;
  const { cols, vals } = whereClause(eff.table, eff.key);
  const sql =
    `UPDATE ${eff.table} SET ${set.map((c) => `${c}=?`).join(',')} ` +
    `WHERE community_id=?${cols.map((c) => ` AND ${c}=?`).join('')}`;
  prep(view, cache, sql).run(...set.map((c) => eff.fields[c]), communityId, ...vals);
}

/** §8.4 — um `UPDATE ... WHERE` por forma em lote, sobre índice existente. */
function applyPatchScope(view: ViewDb, cache: StmtCache, communityId: string, eff: Effect & { t: 'patchScope' }): void {
  const set = Object.keys(eff.fields);
  if (set.length === 0) return;
  const assign = set.map((c) => `${c}=?`).join(',');
  const vals = set.map((c) => eff.fields[c]);
  if (eff.scope.s === 'messagesOfAuthor') {
    prep(view, cache, `UPDATE messages SET ${assign} WHERE community_id=? AND author_key=?`).run(
      ...vals,
      communityId,
      eff.scope.authorKey,
    );
  } else {
    prep(view, cache, `UPDATE messages SET ${assign} WHERE community_id=? AND channel_id=?`).run(
      ...vals,
      communityId,
      eff.scope.channelId,
    );
  }
}

function applyDelete(view: ViewDb, cache: StmtCache, communityId: string, eff: Effect & { t: 'delete' }): void {
  const { cols, vals } = whereClause(eff.table, eff.key);
  const sql = `DELETE FROM ${eff.table} WHERE community_id=?${cols.map((c) => ` AND ${c}=?`).join('')}`;
  prep(view, cache, sql).run(communityId, ...vals);
}

/** §10.3 — `rowid = messages.rowid`; o `upsert` da mensagem já rodou (ordem do `fold`). */
function applyFtsIndex(view: ViewDb, cache: StmtCache, communityId: string, eff: Effect & { t: 'ftsIndex' }): void {
  prep(
    view,
    cache,
    'INSERT INTO messages_fts(rowid, content) VALUES ((SELECT rowid FROM messages WHERE community_id=? AND id=?), ?)',
  ).run(communityId, eff.messageId, eff.content);
}

/**
 * §10.3 — FTS5 contentless-delete (`content=''`) **não aceita `DELETE FROM`** e corrompe o
 * índice em remoção repetida do mesmo `rowid`. A forma segura é o comando especial `'delete'`
 * com **guarda de pertença**: só remove `rowid` que ainda está no índice, o que torna o
 * comando idempotente — essencial porque `ftsRemoveScope` (ban) alcança mensagens que já
 * passaram por `ftsRemove` (delete), e o ban repetido alcança o mesmo conjunto de novo.
 */
function applyFtsRemove(view: ViewDb, cache: StmtCache, communityId: string, eff: Effect & { t: 'ftsRemove' }): void {
  prep(
    view,
    cache,
    "INSERT INTO messages_fts(messages_fts, rowid, content) SELECT 'delete', rowid, NULL FROM messages WHERE community_id=? AND id=? AND rowid IN (SELECT rowid FROM messages_fts)",
  ).run(communityId, eff.messageId);
}

function applyFtsRemoveScope(view: ViewDb, cache: StmtCache, communityId: string, eff: Effect & { t: 'ftsRemoveScope' }): void {
  const scopeSql: Record<EffectScope['s'], string> = {
    messagesOfAuthor: 'SELECT rowid FROM messages WHERE community_id=? AND author_key=?',
    messagesOfChannel: 'SELECT rowid FROM messages WHERE community_id=? AND channel_id=?',
  };
  const v = eff.scope.s === 'messagesOfAuthor' ? eff.scope.authorKey : eff.scope.channelId;
  prep(
    view,
    cache,
    `INSERT INTO messages_fts(messages_fts, rowid, content) SELECT 'delete', rowid, NULL FROM messages WHERE rowid IN (${scopeSql[eff.scope.s]}) AND rowid IN (SELECT rowid FROM messages_fts)`,
  ).run(communityId, v);
}

/** §10.3, `moderation_log` — o `ModerationEntry` de §6.13 chega pronto do `fold`. */
function applyAudit(view: ViewDb, cache: StmtCache, communityId: string, eff: Effect & { t: 'audit' }): void {
  const e = eff.entry;
  prep(
    view,
    cache,
    'INSERT INTO moderation_log(community_id, id, seq, type, target_id, target_label, by_key, by_label, reason, at) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(communityId, e.id, e.seq, e.type, e.targetId, e.targetLabel, e.byKey, e.byLabel, e.reason, e.at);
}

/**
 * §10.5 passo 4 — "recalcula os `recount`". As três contagens são derivadas das tabelas de
 * `CS` **dentro da mesma transação**. A fórmula exata não é normativa (buraco de spec): a
 * leitura conservadora conta o que as listagens exibem — membro ativo não banido; cargo em
 * membro ativo; resposta não deletada e não órfã (o ban escondido é transitório, §18.2).
 */
function applyRecount(view: ViewDb, cache: StmtCache, communityId: string, eff: Effect & { t: 'recount' }): void {
  const id = String(eff.key[0]);
  if (eff.what === 'memberCount') {
    prep(
      view,
      cache,
      'UPDATE communities SET member_count = (SELECT COUNT(*) FROM members WHERE community_id=? AND left_at IS NULL AND banned=0) WHERE community_id=? AND id=?',
    ).run(communityId, communityId, id);
  } else if (eff.what === 'roleMemberCount') {
    prep(
      view,
      cache,
      'UPDATE roles SET member_count = (SELECT COUNT(*) FROM member_roles mr JOIN members m ON m.community_id=mr.community_id AND m.identity_key=mr.identity_key WHERE mr.community_id=? AND mr.role_id=? AND m.left_at IS NULL AND m.banned=0) WHERE community_id=? AND id=?',
    ).run(communityId, id, communityId, id);
  } else {
    prep(
      view,
      cache,
      'UPDATE threads SET reply_count = (SELECT COUNT(*) FROM messages WHERE community_id=? AND thread_id=? AND deleted_at IS NULL AND orphaned=0) WHERE community_id=? AND id=?',
    ).run(communityId, id, communityId, id);
  }
}

/**
 * As formas de §8.4 que viram SQL — a lista é o que o teste de paridade compara com a
 * union do normativo em tempo de execução. `ftsRemoveScope` é a forma a mais que o `fold`
 * emite (o par inverso de `patchScope` para a FTS, usado pelo `mod.ban`); ela **não** está
 * na union de §8.4 — buraco de spec na família de H-20, registrado no sequenciamento.
 * `notify` não vira SQL e é tratado pelo projector antes de chegar aqui.
 */
export const SQL_EFFECT_FORMS = [
  'upsert',
  'patch',
  'delete',
  'patchScope',
  'ftsIndex',
  'ftsRemove',
  'ftsRemoveScope',
  'audit',
  'recount',
] as const;

/**
 * Aplica um `Effect` que vira SQL. `notify` **não** passa por aqui: é coletado pelo
 * projector e emitido como evento IPC **depois** do commit (§10.5, §10.7). O caso existe
 * só para o tipo fechado continuar exaustivo.
 */
export function applyEffect(view: ViewDb, cache: StmtCache, communityId: string, eff: Effect): void {
  switch (eff.t) {
    case 'upsert':
      applyUpsert(view, cache, communityId, eff);
      return;
    case 'patch':
      applyPatch(view, cache, communityId, eff);
      return;
    case 'delete':
      applyDelete(view, cache, communityId, eff);
      return;
    case 'patchScope':
      applyPatchScope(view, cache, communityId, eff);
      return;
    case 'ftsIndex':
      applyFtsIndex(view, cache, communityId, eff);
      return;
    case 'ftsRemove':
      applyFtsRemove(view, cache, communityId, eff);
      return;
    case 'ftsRemoveScope':
      applyFtsRemoveScope(view, cache, communityId, eff);
      return;
    case 'audit':
      applyAudit(view, cache, communityId, eff);
      return;
    case 'recount':
      applyRecount(view, cache, communityId, eff);
      return;
    case 'notify':
      return;
  }
}

export function newStmtCache(): StmtCache {
  return new Map();
}
