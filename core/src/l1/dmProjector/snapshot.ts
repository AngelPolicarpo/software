// Snapshot do `DmState` — `dm_ds_snapshot` de §31.12, sob a regra de §10.6 sem alteração.
//
// - Carrega o `fold_build_id`; se não bater, é **descartado** e o `dmFold` recomeça do zero.
//   Snapshot é cache, nunca verdade: a perda custa tempo de boot, nunca dado (§10.6).
// - `interpreted_ord_sum` sozinho não diz **quais** registros o blob contém — a conversa tem
//   dois logs (§31.6). Quem diz são `lo_length`/`hi_length`, e é por isso que §31.12 as
//   declara como colunas.
//
// **Por que `messages` entra no blob, ao contrário do que §8.1 faz na comunidade.** Lá o
// `MessageMeta` é rematerializado de `view.db`. Aqui não pode ser: `reactionEmojis` é a lista
// de emojis **distintos já vistos** numa mensagem e, por RD-9, ela **nunca encolhe** — um
// `present:false` apaga a linha do reator em `dm_reactions` e não devolve a vaga do emoji.
// Reconstruir o conjunto a partir de `dm_reactions` devolveria a vaga, e um par poderia
// contornar RD-9 alternando `present` de um lado para o outro de um snapshot. O estado que
// não é derivável da tabela vai no blob.
//
// **Por que o blob carrega também as LINHAS projetadas.** O snapshot da comunidade não
// precisa disso: o log de uma comunidade é uma sequência, `seq` só cresce, e nada nunca é
// desfeito em `view.db`. Aqui §31.13 manda **voltar** a projeção a um ponto anterior, e a
// projeção não é reconstruível só do `DmState` — `dm_messages.content` não mora nele, e um
// registro que muda de desfecho na reinterpretação (uma edição que era `APPLIED` e passa a
// `REJECTED`, uma reação que some) deixaria a linha antiga viva se ninguém a apagasse.
// Recarregar o snapshot é, portanto: apagar o que é desta conversa e repor as linhas do blob.
// É o mesmo arranjo que o harness de G14 mediu no cenário 2.
//
// A serialização é JSON **canônico**: chaves ordenadas, mapas ordenados por chave. Sem isso a
// ordem de inserção entraria no blob, e um `DmState` construído com snapshot serializaria
// numa ordem e o mesmo `DmState` construído do zero noutra — o oráculo de equivalência
// acusaria divergência que não existe. É o mesmo cuidado de `projector/snapshot.ts`.

import type { ViewDb } from '../../l0/view/index.ts';
import { type DmMessageMeta, type DmOrigin, type DmSideState, type DmState } from '../dmFold/index.ts';

const hex = (b: Buffer): string => b.toString('hex');
const buf = (s: string): Buffer => Buffer.from(s, 'hex');

/** JSON canônico — chaves ordenadas recursivamente, `undefined` não entra. */
function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

type SideJson = {
  identityKey: string;
  coreKey?: string;
  displayName: string;
  avatarColor: number;
  length: number;
  lastAuthorSeq: number;
  lastAck: number;
  lastTs: number;
  invalid: boolean;
  blobsCoreKey?: string;
  tsWindow: number[];
  tsWindowBase: number;
};

function serializeSide(s: DmSideState): SideJson {
  return {
    identityKey: hex(s.identityKey),
    ...(s.coreKey !== undefined ? { coreKey: hex(s.coreKey) } : {}),
    displayName: s.displayName,
    avatarColor: s.avatarColor,
    length: s.length,
    lastAuthorSeq: s.lastAuthorSeq,
    lastAck: s.lastAck,
    lastTs: s.lastTs,
    invalid: s.invalid,
    ...(s.blobsCoreKey !== undefined ? { blobsCoreKey: hex(s.blobsCoreKey) } : {}),
    tsWindow: [...s.tsWindow],
    tsWindowBase: s.tsWindowBase,
  };
}

function deserializeSide(j: SideJson): DmSideState {
  const s: DmSideState = {
    identityKey: buf(j.identityKey),
    displayName: j.displayName,
    avatarColor: j.avatarColor,
    length: j.length,
    lastAuthorSeq: j.lastAuthorSeq,
    lastAck: j.lastAck,
    lastTs: j.lastTs,
    invalid: j.invalid,
    tsWindow: j.tsWindow,
    tsWindowBase: j.tsWindowBase,
  };
  if (j.coreKey !== undefined) s.coreKey = buf(j.coreKey);
  if (j.blobsCoreKey !== undefined) s.blobsCoreKey = buf(j.blobsCoreKey);
  return s;
}

type MessageJson = {
  id: string;
  author: string;
  ordSum: number;
  authorSeq: number;
  deletedAt?: number;
  editedAt?: number;
  replyToId?: string;
  hasAttachment: boolean;
  reactionEmojis: string[];
};

/** As tabelas cujo conteúdo o blob carrega — as quatro de conteúdo mais o diagnóstico. */
export const DM_SNAPSHOT_TABLES = [
  'dm_messages',
  'dm_reactions',
  'dm_attachments',
  'dm_participants',
  'dm_rejected_records',
] as const;

export type DmSnapshotTable = (typeof DM_SNAPSHOT_TABLES)[number];

/** Ordem de leitura de cada tabela — a chave primária, para que o blob seja determinístico. */
const DM_SNAPSHOT_ORDER: Record<DmSnapshotTable, string> = {
  dm_messages: 'id',
  dm_reactions: 'message_id, emoji, identity_key',
  dm_attachments: 'message_id',
  dm_participants: 'identity_key',
  dm_rejected_records: 'origin, idx',
};

export type DmRowValue = string | number | null | Buffer;
export type DmRow = Record<string, DmRowValue>;
/** tabela → linhas, **sem** `conversation_id` (quem repõe já sabe a conversa). */
export type DmRows = Record<string, DmRow[]>;

function serializeValue(v: DmRowValue): unknown {
  return Buffer.isBuffer(v) ? { $b: hex(v) } : v;
}

function deserializeValue(v: unknown): DmRowValue {
  if (v !== null && typeof v === 'object' && '$b' in (v as Record<string, unknown>)) {
    return buf(String((v as { $b: string }).$b));
  }
  return v as DmRowValue;
}

/** Lê de `view.db` as linhas desta conversa, em ordem canônica de chave. */
export function readDmRows(view: ViewDb, conversationId: string): DmRows {
  const out: DmRows = {};
  for (const table of DM_SNAPSHOT_TABLES) {
    const rows = view
      .prepare(`SELECT * FROM ${table} WHERE conversation_id = ? ORDER BY ${DM_SNAPSHOT_ORDER[table]}`)
      .all(conversationId) as Array<Record<string, unknown>>;
    out[table] = rows.map((r) => {
      const { conversation_id: _drop, ...rest } = r;
      return rest as DmRow;
    });
  }
  return out;
}

/** Repõe as linhas do blob. Quem chama já apagou o que era desta conversa. */
export function writeDmRows(view: ViewDb, conversationId: string, rows: DmRows): void {
  for (const table of DM_SNAPSHOT_TABLES) {
    for (const row of rows[table] ?? []) {
      const cols = Object.keys(row);
      if (cols.length === 0) continue;
      const sql =
        `INSERT OR REPLACE INTO ${table} (conversation_id, ${cols.join(', ')}) ` +
        `VALUES (${new Array<string>(cols.length + 1).fill('?').join(', ')})`;
      view.prepare(sql).run(conversationId, ...cols.map((c) => row[c]));
    }
  }
}

/** O `blob` de `dm_ds_snapshot`: o `DmState` e a projeção no mesmo ponto. */
export function serializeDmState(s: DmState, rows: DmRows): Buffer {
  const messages: MessageJson[] = [...s.messages.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, m]) => ({
      id,
      author: hex(m.author),
      ordSum: m.ordSum,
      authorSeq: m.authorSeq,
      ...(m.deletedAt !== undefined ? { deletedAt: m.deletedAt } : {}),
      ...(m.editedAt !== undefined ? { editedAt: m.editedAt } : {}),
      ...(m.replyToId !== undefined ? { replyToId: m.replyToId } : {}),
      hasAttachment: m.hasAttachment,
      // Conjunto ordenado: `Set` preserva ordem de inserção, e ela depende do caminho.
      reactionEmojis: [...m.reactionEmojis].sort(),
    }));
  return Buffer.from(
    canonicalJson({
      conversationId: s.conversationId,
      conversationKey: hex(s.conversationKey),
      interpretedOrdSum: s.interpretedOrdSum,
      dmVersionSeen: s.dmVersionSeen,
      partialInterpretation: s.partialInterpretation,
      lo: serializeSide(s.sides.lo),
      hi: serializeSide(s.sides.hi),
      messages,
      rows: Object.fromEntries(
        DM_SNAPSHOT_TABLES.map((t) => [
          t,
          (rows[t] ?? []).map((r) =>
            Object.fromEntries(Object.entries(r).map(([c, v]) => [c, serializeValue(v)])),
          ),
        ]),
      ),
    }),
    'utf8',
  );
}

export function deserializeDmState(blob: Buffer): { state: DmState; rows: DmRows } {
  const o = JSON.parse(blob.toString('utf8')) as {
    conversationId: string;
    conversationKey: string;
    interpretedOrdSum: number;
    dmVersionSeen: number;
    partialInterpretation: boolean;
    lo: SideJson;
    hi: SideJson;
    messages: MessageJson[];
    rows: Record<string, Array<Record<string, unknown>>>;
  };
  const messages = new Map<string, DmMessageMeta>();
  for (const m of o.messages) {
    const meta: DmMessageMeta = {
      author: buf(m.author),
      ordSum: m.ordSum,
      authorSeq: m.authorSeq,
      hasAttachment: m.hasAttachment,
      reactionEmojis: new Set(m.reactionEmojis),
    };
    if (m.deletedAt !== undefined) meta.deletedAt = m.deletedAt;
    if (m.editedAt !== undefined) meta.editedAt = m.editedAt;
    if (m.replyToId !== undefined) meta.replyToId = m.replyToId;
    messages.set(m.id, meta);
  }
  const rows: DmRows = {};
  for (const table of DM_SNAPSHOT_TABLES) {
    rows[table] = (o.rows[table] ?? []).map(
      (r) => Object.fromEntries(Object.entries(r).map(([c, v]) => [c, deserializeValue(v)])) as DmRow,
    );
  }
  return {
    state: {
      conversationId: o.conversationId,
      conversationKey: buf(o.conversationKey),
      interpretedOrdSum: o.interpretedOrdSum,
      dmVersionSeen: o.dmVersionSeen,
      partialInterpretation: o.partialInterpretation,
      sides: { lo: deserializeSide(o.lo), hi: deserializeSide(o.hi) },
      messages,
    },
    rows,
  };
}

/** A linha de `dm_ds_snapshot` (§31.12). */
export type DmSnapshotRow = {
  readonly interpreted_ord_sum: number;
  readonly lo_length: number;
  readonly hi_length: number;
  readonly blob: Buffer;
  readonly fold_build_id: string;
  readonly taken_at: number;
};

export type DmSnapshot = {
  readonly state: DmState;
  readonly rows: DmRows;
  readonly interpretedOrdSum: number;
  /** Quantos registros de cada lado o blob já contém — o prefixo, em índices. */
  readonly lengths: Readonly<Record<DmOrigin, number>>;
};

export function saveDmSnapshot(
  view: ViewDb,
  conversationId: string,
  s: DmState,
  foldBuildId: string,
  at: number,
): void {
  view
    .prepare(
      'INSERT OR REPLACE INTO dm_ds_snapshot(conversation_id, interpreted_ord_sum, lo_length, hi_length, blob, fold_build_id, taken_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      conversationId,
      s.interpretedOrdSum,
      s.sides.lo.length,
      s.sides.hi.length,
      serializeDmState(s, readDmRows(view, conversationId)),
      foldBuildId,
      at,
    );
}

export function deleteDmSnapshot(view: ViewDb, conversationId: string): void {
  view.prepare('DELETE FROM dm_ds_snapshot WHERE conversation_id = ?').run(conversationId);
}

/**
 * Devolve `null` quando não há snapshot, quando o `fold_build_id` não bate (§10.6) ou quando
 * o blob não decodifica — em todos os casos o `dmFold` recomeça do zero.
 *
 * A conferência final é a de coerência entre a linha e o blob: as três colunas que §31.12
 * declara fora do blob precisam ser as mesmas de dentro dele, ou a linha não descreve o
 * estado que carrega.
 */
export function loadDmSnapshot(
  view: ViewDb,
  conversationId: string,
  foldBuildId: string,
): DmSnapshot | null {
  const row = view
    .prepare(
      'SELECT interpreted_ord_sum, lo_length, hi_length, blob, fold_build_id, taken_at FROM dm_ds_snapshot WHERE conversation_id = ?',
    )
    .get(conversationId) as DmSnapshotRow | undefined;
  if (row === undefined) return null;
  if (row.fold_build_id !== foldBuildId) return null;
  try {
    const { state, rows } = deserializeDmState(row.blob);
    if (state.conversationId !== conversationId) return null;
    if (state.interpretedOrdSum !== row.interpreted_ord_sum) return null;
    if (state.sides.lo.length !== row.lo_length || state.sides.hi.length !== row.hi_length) return null;
    return {
      state,
      rows,
      interpretedOrdSum: row.interpreted_ord_sum,
      lengths: { lo: row.lo_length, hi: row.hi_length },
    };
  } catch {
    return null; // snapshot inconsistente ⇒ recomeça do zero (§10.6)
  }
}
