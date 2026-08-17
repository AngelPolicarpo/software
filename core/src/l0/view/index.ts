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
  META_FOLD_PANIC,
  META_INTERPRETED_SEQ,
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
 */
export const VIEW_SCHEMA_VERSION = '2';

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

  close(): void {
    this.#db.close();
  }
}

/** Abre `view.db` com os PRAGMAs de §10.4 e o schema de §10.3. Não reprojeta sozinho. */
export function openViewDb(path: string): ViewDb {
  return new ViewDbImpl(path);
}

export { dumpHash, dumpText, type DumpResult } from './dump.ts';
export {
  ALL_TABLES,
  CS_TABLES,
  KEY_COLS,
  META_FOLD_PANIC,
  META_GLOBAL_KEYS,
  META_INTERPRETED_SEQ,
  META_OP_VERSION,
  META_PER_COMMUNITY_PREFIXES,
  META_VIEW_SCHEMA_VERSION,
  SCHEMA,
  type CsTableName,
} from './schema.ts';
