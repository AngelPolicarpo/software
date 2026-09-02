// `view` — L0. `view.db`: abre, recria no bump de schema, transação (§4, §3.3, §10.3, §10.4).
//
// Responsabilidade estrita: o arquivo, os PRAGMAs, o schema e a transação. **Nenhuma regra
// de domínio** — quem decide o que escrever é o `projector` (§4, §8.4). O `projector` é o
// único escritor (§21.1); este módulo não abre para mais ninguém.
//
// §3.3: "Abre `view.db`; se `schema_version` ≠ binário, agenda reprojeção total (§10.5)".
// Aqui a abertura **sinaliza** o descompasso (`schemaVersionMismatch()`); quem executa a
// reprojeção é o `projector` (`reproject()`), que é o módulo de §10.5.

import Database from 'better-sqlite3';

import {
  ALL_TABLES,
  CS_TABLES,
  DM_TABLES,
  META_DM_FOLD_PANIC,
  META_DM_INTERPRETED,
  META_FOLD_PANIC,
  META_INTERPRETED_SEQ,
  META_PER_COMMUNITY_PREFIXES,
  META_PER_CONVERSATION_PREFIXES,
  META_VIEW_SCHEMA_VERSION,
  SCHEMA,
} from './schema.ts';

/**
 * A versão de schema deste binário (§10.3). Bump aqui = bump de `view_schema_version`, e o
 * boot seguinte reprojeta do zero (§10.5).
 *
 * `2` — `ftsIndexScope` entrou em §8.4 (a forma inversa do `ftsRemoveScope` do ban, H-20).
 * §8.4 é explícito: acrescentar uma forma é mudança de contrato com bump. O schema em si não
 * mudou de colunas; o que mudou foi o conteúdo derivável, e uma `view.db` da versão 1 tem o
 * índice de busca incompleto para todo autor que já teve ban revogado.
 * `3` — `observed_ops` passou a registrar a presença de cada operação `APPLIED` para a
 * reconciliação da outbox por `opId` (§11.6).
 * `4` — `message_links` ganhou produtor: o `fold` extrai os links do conteúdo em
 * `message.send`/`message.edit` e os remove no tombstone (§15.6.1, DR-38). O schema não
 * mudou de colunas; o que mudou foi o **conteúdo derivável**, e uma `view.db` da versão 3
 * tem a tabela vazia para toda mensagem já projetada — exatamente o caso que §10.5 resolve
 * reprojetando.
 * `5` — `channels` ganha `speech_mode`/`queue_turn_seconds` (emenda de 2026-08-28, §6.6
 * R-29). Aqui o schema MUDOU de colunas e o `ds_snapshot` da versão anterior carrega um
 * `Channel` sem os campos novos — reprojetar do zero é o que evita herdar snapshot
 * incompatível (§10.6).
 * `6` — as seis tabelas `dm_*` de §31.12 (B56). `view.db` é derivada, e §31.12 autoriza
 * `DROP` e refazer: uma `view.db` da versão 5 não tem tabela nenhuma de conversa direta, e o
 * `CREATE TABLE IF NOT EXISTS` sozinho deixaria o `ds_snapshot` da comunidade intacto sem
 * nunca projetar as conversas. O bump é o que faz o boot passar pelo `wipe` e reprojetar.
 */
export const VIEW_SCHEMA_VERSION = '6';

/** O PRAGMA `synchronous` é por conexão, não por tabela — é a razão de dois bancos (§10.4). */
const PRAGMAS = [
  ['journal_mode', 'WAL'],
  ['synchronous', 'NORMAL'],
  ['foreign_keys', 'OFF'],
  ['busy_timeout', 5000],
  ['temp_store', 'MEMORY'],
  ['mmap_size', 268435456],
  ['cache_size', -32000],
] as const;

/** §31.12 — o valor de `meta.dm_interpreted:<conversationId>`. */
export type DmInterpretedMarker = {
  readonly ordSum: number;
  readonly loLength: number;
  readonly hiLength: number;
};

export type ViewStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

export type ViewDb = {
  readonly path: string;
  /** Transação com rollback em exceção — a "uma transação por lote" de §10.5. */
  transaction<T>(fn: () => T): T;
  prepare(sql: string): ViewStatement;
  exec(sql: string): void;
  /** Leitura de PRAGMA — para a paridade de §10.4 e para nada mais. */
  pragma(name: string): unknown;
  /** §10.5 passo 2 — `DROP`/recria **todas** as tabelas (`DS` snapshot, `CS`, FTS). */
  wipe(): void;
  metaGet(key: string): string | null;
  metaSet(key: string, value: string): void;
  /** §3.3 — `view_schema_version` ≠ binário ⇒ reprojeção total na agenda do boot. */
  schemaVersionMismatch(): boolean;
  /** Marcador persistente de `fold.panic` (§8.5) — reprojeção no boot seguinte. */
  foldPanicSeq(communityId: string): number | null;
  setFoldPanicSeq(communityId: string, seq: number): void;
  /**
   * `interpretedSeq` do último lote commitado (§10.3.1). Gravado **na mesma transação** dos
   * efeitos de cada lote, é o lado direito da igualdade com que §10.6 define "snapshot
   * inconsistente" — sem ele, um crash entre duas cadências de snapshot faria o boot
   * reaplicar efeitos já materializados.
   */
  interpretedSeqMarker(communityId: string): number | null;
  setInterpretedSeqMarker(communityId: string, seq: number): void;
  /**
   * §31.12 — `dm_interpreted:<conversationId>`: `{ordSum, loLength, hiLength}` do último lote
   * commitado da conversa. O análogo de `interpretedSeqMarker`, com uma diferença que vem do
   * arranjo de §31.6: a conversa tem **dois** logs, e o `ordSum` sozinho não identifica o
   * prefixo interpretado.
   */
  dmInterpretedMarker(conversationId: string): DmInterpretedMarker | null;
  setDmInterpretedMarker(conversationId: string, marker: DmInterpretedMarker): void;
  /** §31.12 — `dm_fold_panic:<conversationId>`, o análogo de `foldPanicSeq` (§31.7.1). */
  dmFoldPanicOrdSum(conversationId: string): number | null;
  setDmFoldPanicOrdSum(conversationId: string, ordSum: number): void;
  /**
   * §18.4 passo 6 (`removed.purge`) — apaga o estado de conteúdo desta comunidade: as
   * tabelas de CS, o log de recusas e o snapshot, mais os marcadores de `meta` dela. O
   * índice FTS é limpo na MESMA transação, pelo mesmo comando contentless-delete do
   * projector — linha de `messages` sem entrada no índice é liço de busca órfão.
   */
  purgeCommunityData(communityId: string): void;
  /**
   * O análogo de `purgeCommunityData` no escopo de uma conversa direta (§31.12): as quatro
   * tabelas de conteúdo `dm_*`, o log de recusas, o snapshot e os marcadores de `meta` dela.
   * É o que a reprojeção de uma conversa usa, e é o que a reinterpretação de §31.13 usa antes
   * de recarregar o snapshot — sem apagar, uma decisão que mudou de desfecho deixaria a linha
   * antiga viva, e a projeção deixaria de ser função do par de logs.
   *
   * Não há FTS a limpar (§31.12: sem FTS para DM no v1), e nada em `manifest.db` é tocado.
   */
  purgeConversationData(conversationId: string): void;
  close(): void;
};

class ViewDbImpl implements ViewDb {
  readonly path: string;
  readonly #db: Database.Database;

  constructor(path: string) {
    this.path = path;
    this.#db = new Database(path);
    for (const [k, v] of PRAGMAS) this.#db.pragma(`${k} = ${v}`);
    this.#db.exec(SCHEMA);
  }

  transaction<T>(fn: () => T): T {
    return this.#db.transaction(fn)();
  }

  prepare(sql: string): ViewStatement {
    return this.#db.prepare(sql) as ViewStatement;
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  pragma(name: string): unknown {
    return this.#db.pragma(name);
  }

  wipe(): void {
    // §10.5: nada em `manifest.db` é tocado; `meta` cai junto e a versão volta a ser a do
    // binário — a reprojeção é o próprio estado limpo.
    this.transaction(() => {
      for (const t of ALL_TABLES) this.#db.exec(`DROP TABLE IF EXISTS ${t}`);
      this.#db.exec(SCHEMA);
      this.metaSet(META_VIEW_SCHEMA_VERSION, VIEW_SCHEMA_VERSION);
    });
  }

  metaGet(key: string): string | null {
    const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  metaSet(key: string, value: string): void {
    this.#db
      .prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  schemaVersionMismatch(): boolean {
    return this.metaGet(META_VIEW_SCHEMA_VERSION) !== VIEW_SCHEMA_VERSION;
  }

  foldPanicSeq(communityId: string): number | null {
    const v = this.metaGet(`${META_FOLD_PANIC}:${communityId}`);
    if (v === null) return null;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }

  setFoldPanicSeq(communityId: string, seq: number): void {
    this.metaSet(`${META_FOLD_PANIC}:${communityId}`, String(seq));
  }

  interpretedSeqMarker(communityId: string): number | null {
    const v = this.metaGet(`${META_INTERPRETED_SEQ}:${communityId}`);
    if (v === null) return null;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }

  setInterpretedSeqMarker(communityId: string, seq: number): void {
    this.metaSet(`${META_INTERPRETED_SEQ}:${communityId}`, String(seq));
  }

  dmInterpretedMarker(conversationId: string): DmInterpretedMarker | null {
    const v = this.metaGet(`${META_DM_INTERPRETED}:${conversationId}`);
    if (v === null) return null;
    try {
      const o = JSON.parse(v) as Partial<DmInterpretedMarker>;
      if (
        typeof o.ordSum !== 'number' ||
        typeof o.loLength !== 'number' ||
        typeof o.hiLength !== 'number'
      ) {
        return null;
      }
      return { ordSum: o.ordSum, loLength: o.loLength, hiLength: o.hiLength };
    } catch {
      return null; // marcador ilegível ⇒ o mesmo desfecho de marcador ausente: reprojeta
    }
  }

  setDmInterpretedMarker(conversationId: string, marker: DmInterpretedMarker): void {
    this.metaSet(
      `${META_DM_INTERPRETED}:${conversationId}`,
      JSON.stringify({ ordSum: marker.ordSum, loLength: marker.loLength, hiLength: marker.hiLength }),
    );
  }

  dmFoldPanicOrdSum(conversationId: string): number | null {
    const v = this.metaGet(`${META_DM_FOLD_PANIC}:${conversationId}`);
    if (v === null) return null;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }

  setDmFoldPanicOrdSum(conversationId: string, ordSum: number): void {
    this.metaSet(`${META_DM_FOLD_PANIC}:${conversationId}`, String(ordSum));
  }

  purgeConversationData(conversationId: string): void {
    const tx = this.#db.transaction(() => {
      for (const table of DM_TABLES) {
        this.#db.prepare(`DELETE FROM ${table} WHERE conversation_id = ?`).run(conversationId);
      }
      for (const prefix of META_PER_CONVERSATION_PREFIXES) {
        this.#db.prepare('DELETE FROM meta WHERE key = ?').run(`${prefix}:${conversationId}`);
      }
    });
    tx();
  }

  purgeCommunityData(communityId: string): void {
    const tx = this.#db.transaction(() => {
      // Contentless-delete do FTS ANTES de apagar `messages`: o comando casa por rowid
      // presente no índice, e a consulta usa as linhas ainda vivas (§10.3).
      this.#db
        .prepare(
          "INSERT INTO messages_fts(messages_fts, rowid, content) SELECT 'delete', rowid, NULL FROM messages WHERE community_id = ? AND rowid IN (SELECT rowid FROM messages_fts)",
        )
        .run(communityId);
      for (const table of CS_TABLES) {
        this.#db.prepare(`DELETE FROM ${table} WHERE community_id = ?`).run(communityId);
      }
      this.#db.prepare('DELETE FROM rejected_records WHERE community_id = ?').run(communityId);
      this.#db.prepare('DELETE FROM ds_snapshot WHERE community_id = ?').run(communityId);
      for (const prefix of META_PER_COMMUNITY_PREFIXES) {
        this.#db.prepare('DELETE FROM meta WHERE key = ?').run(`${prefix}:${communityId}`);
      }
    });
    tx();
  }

  close(): void {
    this.#db.close();
  }
}

/** Abre `view.db` com os PRAGMAs de §10.4 e o schema de §10.3. Não reprojeta sozinho. */
export function openViewDb(path: string): ViewDb {
  return new ViewDbImpl(path);
}

export { dmDumpHash, dmDumpText, dumpHash, dumpText, type DumpResult } from './dump.ts';
export {
  ALL_TABLES,
  CS_TABLES,
  DM_CONTENT_TABLES,
  DM_KEY_COLS,
  DM_TABLES,
  KEY_COLS,
  META_DM_FOLD_PANIC,
  META_DM_INTERPRETED,
  META_FOLD_PANIC,
  META_GLOBAL_KEYS,
  META_INTERPRETED_SEQ,
  META_OP_VERSION,
  META_PER_COMMUNITY_PREFIXES,
  META_PER_CONVERSATION_PREFIXES,
  META_VIEW_SCHEMA_VERSION,
  SCHEMA,
  type CsTableName,
  type DmContentTableName,
} from './schema.ts';
