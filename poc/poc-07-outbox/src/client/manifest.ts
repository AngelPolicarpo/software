// `manifest.db` — §10.2, §11.2. **`synchronous=FULL`**, e é isso que este arquivo existe
// para provar: a outbox é a garantia forte do sistema (§10.7.1), não o log.
//
// §10.2: "Nunca é apagado por reprojeção. Nunca é reconstruído a partir do log."

import Database from 'better-sqlite3';

import { killPoint } from '../harness/kill.ts';
import type { DropReason, OutboxState } from '../protocol/constants.ts';

/** §10.4 — os PRAGMAs do `manifest.db`. `FULL` é o ponto inteiro. */
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
CREATE INDEX IF NOT EXISTS idx_outbox_ready ON local_outbox(community_id, state, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_channel ON local_outbox(community_id, channel_id);

CREATE TABLE IF NOT EXISTS local_author_seq (
  community_id TEXT PRIMARY KEY, next_author_seq INT NOT NULL);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export type OutboxRow = {
  local_seq: number;
  op_id: string;
  community_id: string;
  channel_id: string | null;
  kind: number;
  author_seq: number;
  envelope: Buffer;
  client_ref: string | null;
  created_at: number;
  attempts: number;
  next_attempt_at: number;
  state: OutboxState;
  acked_seq: number | null;
  last_error: string | null;
  dropped_reason: DropReason | null;
};

export class Manifest {
  readonly #db: Database.Database;

  constructor(path: string) {
    this.#db = new Database(path);
    for (const [k, v] of PRAGMAS) this.#db.pragma(`${k} = ${v}`);
    this.#db.exec(SCHEMA);
  }

  get raw(): Database.Database {
    return this.#db;
  }

  pragma(name: string): unknown {
    return this.#db.pragma(name);
  }

  /**
   * §7.5 — o `authorSeq` é consumido **no enfileiramento** e nunca reatribuído. Uma op
   * recusada queima o número; é o que impede o replay de reabrir depois de uma recusa.
   */
  nextAuthorSeq(communityId: string): number {
    const tx = this.#db.transaction((cid: string): number => {
      const row = this.#db
        .prepare('SELECT next_author_seq AS n FROM local_author_seq WHERE community_id = ?')
        .get(cid) as { n: number } | undefined;
      const n = row?.n ?? 1;
      this.#db
        .prepare(
          'INSERT INTO local_author_seq(community_id, next_author_seq) VALUES (?, ?) ' +
            'ON CONFLICT(community_id) DO UPDATE SET next_author_seq = excluded.next_author_seq',
        )
        .run(cid, n + 1);
      return n;
    });
    return tx(communityId);
  }

  /**
   * §11.3 `→ queued`: consome `authorSeq`, grava com `FULL`, responde. Enfileirar o mesmo
   * envelope duas vezes é **no-op** (`op_id UNIQUE`), não um segundo item.
   *
   * Os dois pontos de kill cercam o commit: antes, nada pode existir; depois, o item tem de
   * estar lá mesmo com o processo morto no instante seguinte.
   */
  enqueue(item: {
    opId: string;
    communityId: string;
    channelId: string | null;
    kind: number;
    authorSeq: number;
    envelope: Buffer;
    clientRef: string | null;
    now: number;
  }): { enfileirado: boolean; localSeq: number | null } {
    const tx = this.#db.transaction(() => {
      const info = this.#db
        .prepare(
          'INSERT OR IGNORE INTO local_outbox(op_id, community_id, channel_id, kind, author_seq, ' +
            'envelope, client_ref, created_at, attempts, next_attempt_at, state) ' +
            "VALUES (?,?,?,?,?,?,?,?,0,?,'queued')",
        )
        .run(
          item.opId,
          item.communityId,
          item.channelId,
          item.kind,
          item.authorSeq,
          item.envelope,
          item.clientRef,
          item.now,
          item.now,
        );
      killPoint('client:before-enqueue-commit');
      return info.changes > 0 ? Number(info.lastInsertRowid) : null;
    });
    const localSeq = tx();
    killPoint('client:after-enqueue-commit');
    return { enfileirado: localSeq !== null, localSeq };
  }

  /**
   * §11.7 — ordem por `local_seq` **dentro do canal**; um item bloqueado segura só o seu.
   *
   * Devolve um **lote por canal**, não um item: §11.3 diz "um item `sending` por canal por
   * vez", e §11.9 diz que a unidade de envio é `submitOps{envelopes[≤32]}`. As duas só são
   * compatíveis se "um por vez" for sobre a **submissão em voo**, não sobre o registro — um
   * lote ordenado é uma submissão só, e preserva exatamente a ordem que a regra protege.
   * Lido como "um registro por vez", §11.9 não teria função e a vazão cairia para um
   * round-trip por mensagem.
   */
  ready(communityId: string, now: number, porCanal: number): Map<string, OutboxRow[]> {
    const rows = this.#db
      .prepare(
        "SELECT * FROM local_outbox WHERE community_id = ? AND state = 'queued' AND next_attempt_at <= ? " +
          'ORDER BY local_seq',
      )
      .all(communityId, now) as OutboxRow[];
    const ocupados = new Set(
      (
        this.#db
          .prepare("SELECT DISTINCT channel_id AS c FROM local_outbox WHERE community_id = ? AND state = 'sending'")
          .all(communityId) as { c: string | null }[]
      ).map((r) => r.c ?? ''),
    );
    // §11.7 — "um item bloqueado segura o **próprio canal** e não os outros". A consulta
    // acima já filtra por `next_attempt_at <= now`, então ela **pula** itens em backoff; usar
    // o resultado direto enviaria fora de ordem dentro do canal. E enviar fora de ordem é
    // fatal, não estético: o host só aceita `authorSeq > lastAuthorSeq` (§7.5, estágio 6), de
    // modo que um `authorSeq` ultrapassado por um irmão mais novo **nunca mais** é aceito.
    // Por isso a lista de cada canal para no primeiro item que não está pronto.
    const todos = this.#db
      .prepare(
        "SELECT * FROM local_outbox WHERE community_id = ? AND state != 'dropped' ORDER BY local_seq",
      )
      .all(communityId) as OutboxRow[];
    const prontosPorSeq = new Set(rows.map((r) => r.local_seq));
    const parado = new Set<string>();
    const porCanalMap = new Map<string, OutboxRow[]>();
    for (const r of todos) {
      const canal = r.channel_id ?? '';
      if (ocupados.has(canal) || parado.has(canal)) continue;
      if (r.state !== 'queued' || !prontosPorSeq.has(r.local_seq)) {
        // Cabeça do canal bloqueada: o canal inteiro espera.
        parado.add(canal);
        continue;
      }
      const lista = porCanalMap.get(canal) ?? [];
      if (lista.length >= porCanal) {
        parado.add(canal);
        continue;
      }
      lista.push(r);
      porCanalMap.set(canal, lista);
    }
    return porCanalMap;
  }

  all(communityId: string): OutboxRow[] {
    return this.#db
      .prepare('SELECT * FROM local_outbox WHERE community_id = ? ORDER BY local_seq')
      .all(communityId) as OutboxRow[];
  }

  byOpId(opId: string): OutboxRow | undefined {
    return this.#db.prepare('SELECT * FROM local_outbox WHERE op_id = ?').get(opId) as OutboxRow | undefined;
  }

  countActive(communityId: string): number {
    return (
      this.#db
        .prepare(
          "SELECT COUNT(*) AS n FROM local_outbox WHERE community_id = ? AND state != 'dropped'",
        )
        .get(communityId) as { n: number }
    ).n;
  }

  setState(localSeq: number, state: OutboxState, extra: Partial<OutboxRow> = {}): void {
    const campos: string[] = ['state = ?'];
    const vals: unknown[] = [state];
    for (const k of ['acked_seq', 'last_error', 'dropped_reason', 'attempts', 'next_attempt_at'] as const) {
      if (extra[k] !== undefined) {
        campos.push(`${k} = ?`);
        vals.push(extra[k]);
      }
    }
    vals.push(localSeq);
    this.#db.prepare(`UPDATE local_outbox SET ${campos.join(', ')} WHERE local_seq = ?`).run(...vals);
  }

  /** §11.3 — a **única** condição de remoção: observado na própria réplica. */
  remove(localSeq: number): void {
    this.#db.prepare('DELETE FROM local_outbox WHERE local_seq = ?').run(localSeq);
  }

  metaGet(key: string): string | null {
    const r = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }

  metaSet(key: string, value: string): void {
    this.#db
      .prepare('INSERT INTO meta(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  checkpoint(): void {
    killPoint('client:during-checkpoint');
    this.#db.pragma('wal_checkpoint(TRUNCATE)');
  }

  close(): void {
    this.#db.close();
  }
}
