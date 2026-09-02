// Tradução de `DmEffect` → SQL — §31.7.6.
//
// O `dmFold` emite `DmEffect[]`; o `dmProjector` aplica a lista **na ordem**, dentro de
// **uma transação por lote**, e emite os `notify` **depois do commit** (§31.12, §10.7). Ele
// **não decide nada** — este arquivo é a tradução mecânica de cada forma fechada do tipo, e
// mais nada.
//
// Quatro formas, contra as doze de §8.4, e cada ausência tem razão declarada em §31.7.6:
// não há `patchScope` (não há ban que oculte N mensagens nem canal apagado que orfanize N),
// não há `ftsIndex`/`ftsRemove` (sem FTS para DM no v1, §31.12), não há `audit` (não há
// moderação numa conversa de dois) e não há `recount` (nada é derivado de população).

import { DM_KEY_COLS, type DmContentTableName, type ViewDb, type ViewStatement } from '../../l0/view/index.ts';
import type { DmEffect, DmEntityKey, DmPrimitive } from '../dmFold/index.ts';

export type DmStmtCache = Map<string, ViewStatement>;

export function newDmStmtCache(): DmStmtCache {
  return new Map();
}

function prep(view: ViewDb, cache: DmStmtCache, sql: string): ViewStatement {
  let s = cache.get(sql);
  if (s === undefined) {
    s = view.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

/** `INSERT ... ON CONFLICT` com os campos da linha. Escopo é sempre `conversation_id`. */
function applyUpsert(
  view: ViewDb,
  cache: DmStmtCache,
  conversationId: string,
  eff: DmEffect & { t: 'upsert' },
): void {
  const cols = Object.keys(eff.row);
  if (cols.length === 0) return;
  const pk = DM_KEY_COLS[eff.table].filter((c) => eff.row[c] !== undefined);
  const updatables = cols.filter((c) => !pk.includes(c));
  const sql =
    `INSERT INTO ${eff.table} (conversation_id, ${cols.join(', ')}) VALUES (${new Array<string>(cols.length + 1).fill('?').join(', ')}) ` +
    `ON CONFLICT(conversation_id, ${pk.join(', ')}) DO ` +
    (updatables.length > 0
      ? `UPDATE SET ${updatables.map((c) => `${c} = excluded.${c}`).join(', ')}`
      : 'NOTHING');
  prep(view, cache, sql).run(conversationId, ...cols.map((c) => eff.row[c]));
}

/**
 * A chave do efeito é **prefixo** da PK, não a PK inteira: o `dm.delete` de §31.5 apaga as
 * reações de uma mensagem com `key: [messageId]`, sobre uma tabela cuja chave são quatro
 * colunas. É a mesma leitura que `KEY_COLS` já tem no projetor da comunidade.
 */
function whereClause(table: DmContentTableName, key: DmEntityKey): { cols: readonly string[]; vals: DmPrimitive[] } {
  return { cols: DM_KEY_COLS[table].slice(0, key.length), vals: [...key] };
}

function applyPatch(
  view: ViewDb,
  cache: DmStmtCache,
  conversationId: string,
  eff: DmEffect & { t: 'patch' },
): void {
  const set = Object.keys(eff.fields);
  if (set.length === 0) return;
  const { cols, vals } = whereClause(eff.table, eff.key);
  const sql =
    `UPDATE ${eff.table} SET ${set.map((c) => `${c}=?`).join(',')} ` +
    `WHERE conversation_id=?${cols.map((c) => ` AND ${c}=?`).join('')}`;
  prep(view, cache, sql).run(...set.map((c) => eff.fields[c]), conversationId, ...vals);
}

function applyDelete(
  view: ViewDb,
  cache: DmStmtCache,
  conversationId: string,
  eff: DmEffect & { t: 'delete' },
): void {
  const { cols, vals } = whereClause(eff.table, eff.key);
  const sql = `DELETE FROM ${eff.table} WHERE conversation_id=?${cols.map((c) => ` AND ${c}=?`).join('')}`;
  prep(view, cache, sql).run(conversationId, ...vals);
}

/**
 * As formas de §31.7.6 que viram SQL — a lista é o que o teste de paridade compara com a
 * union do normativo em tempo de execução. `notify` não vira SQL e é tratado pelo projetor
 * antes de chegar aqui.
 */
export const DM_SQL_EFFECT_FORMS = ['upsert', 'patch', 'delete'] as const;

/**
 * Aplica um `DmEffect` que vira SQL. `notify` **não** passa por aqui: é coletado pelo
 * projetor e emitido como evento **depois** do commit (§31.12, §10.7). O caso existe só para
 * o tipo fechado continuar exaustivo.
 */
export function applyDmEffect(
  view: ViewDb,
  cache: DmStmtCache,
  conversationId: string,
  eff: DmEffect,
): void {
  switch (eff.t) {
    case 'upsert':
      applyUpsert(view, cache, conversationId, eff);
      return;
    case 'patch':
      applyPatch(view, cache, conversationId, eff);
      return;
    case 'delete':
      applyDelete(view, cache, conversationId, eff);
      return;
    case 'notify':
      return;
  }
}
