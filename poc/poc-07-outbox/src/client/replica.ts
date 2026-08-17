// A réplica local: lê o core, projeta em `view.db` (`NORMAL`) e mantém o `lastAuthorSeq`
// que §11.6 usa para reconciliar.
//
// A assimetria de §10.4 é o ponto: `view.db` é **derivado** e pode ser `NORMAL`, porque
// perdê-lo custa uma reprojeção; `manifest.db` é `FULL` porque perdê-lo custa a operação do
// usuário. Este harness mede exatamente o que cada modo dá — e o que não dá.
//
// A barreira de §10.5 é normativa e está aqui: **primeiro commita `view.db`, depois
// `manifest.db`**. Um crash entre os dois deixa o read state atrasado, que é reconciliável;
// a ordem inversa deixaria a outbox achando que uma op foi observada sem que a projeção a
// tivesse — o que o boot não teria como detectar.

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

import { killPoint } from '../harness/kill.ts';
import { decodeEnvelope, decodeRecord, opIdOf } from '../protocol/envelope.ts';
import type { Manifest } from './manifest.ts';

const PRAGMAS: readonly (readonly [string, string | number])[] = [
  ['journal_mode', 'WAL'],
  ['synchronous', 'NORMAL'],
  ['foreign_keys', 'OFF'],
  ['busy_timeout', 5000],
  ['temp_store', 'MEMORY'],
  ['cache_size', -32000],
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  community_id TEXT NOT NULL, op_id TEXT NOT NULL, seq INT NOT NULL,
  author_key TEXT NOT NULL, author_seq INT NOT NULL, host_ts INT NOT NULL,
  PRIMARY KEY (community_id, op_id));
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(community_id, author_key, author_seq);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export type ReplicaState = {
  interpretedSeq: number;
  readonly lastAuthorSeq: Map<string, number>;
};

/**
 * De onde a réplica lê o log.
 *
 * O cliente **não** abre o core do host: o RocksDB do corestore tem lock próprio (§10.8
 * passo 3), e dois processos no mesmo diretório é precisamente o que aquele lock existe para
 * impedir. Em produção o cliente tem o próprio core, alimentado por replicação; aqui ele lê
 * por RPC do host, e a diferença não alcança nenhum critério deste gate — o que a
 * reconciliação de §11.6 precisa é observar o log **materializado localmente**, e é o que
 * acontece: os registros atravessam o processo, entram em `view.db` e é de lá que
 * `lastAuthorSeq` sai.
 *
 * O que esta escolha **não** cobre está declarado no artefato: a verificação de prova de
 * Merkle que tornaria o cliente imune a um host que mente sobre o **conteúdo** do log. O
 * adversário que este gate mede é o que mente sobre o ACK, não sobre os bytes.
 */
export type LogSource = {
  length(): Promise<number>;
  get(seq: number): Promise<Buffer | null>;
};

export class Replica {
  readonly #db: Database.Database;
  readonly #log: LogSource;
  readonly #manifest: Manifest;
  readonly #communityId: string;
  readonly state: ReplicaState = { interpretedSeq: -1, lastAuthorSeq: new Map() };

  constructor(viewPath: string, log: LogSource, manifest: Manifest, communityId: string) {
    this.#db = new Database(viewPath);
    for (const [k, v] of PRAGMAS) this.#db.pragma(`${k} = ${v}`);
    this.#db.exec(SCHEMA);
    this.#log = log;
    this.#manifest = manifest;
    this.#communityId = communityId;
  }

  get raw(): Database.Database {
    return this.#db;
  }

  pragma(name: string): unknown {
    return this.#db.pragma(name);
  }

  /**
   * Boot: o estado vem do que **está projetado**, não de um contador guardado à parte. É a
   * mesma razão do `recover()` do host — a autoridade do estado interpretado é o log e o que
   * dele foi materializado, nunca uma memória paralela que um crash pode dessincronizar.
   */
  load(): void {
    const marcador = this.#db.prepare("SELECT value FROM meta WHERE key = 'interpreted_seq'").get() as
      | { value: string }
      | undefined;
    this.state.interpretedSeq = marcador === undefined ? -1 : Number(marcador.value);
    this.state.lastAuthorSeq.clear();
    const rows = this.#db
      .prepare('SELECT author_key AS a, MAX(author_seq) AS s FROM messages WHERE community_id = ? GROUP BY author_key')
      .all(this.#communityId) as { a: string; s: number }[];
    for (const r of rows) this.state.lastAuthorSeq.set(r.a, r.s);
  }

  /** Projeta do `interpretedSeq + 1` até o fim do log, em lotes com uma transação cada. */
  async catchUp(batch = 256): Promise<number> {
    let projetados = 0;
    let fim = await this.#log.length();
    while (this.state.interpretedSeq + 1 < fim) {
      const from = this.state.interpretedSeq + 1;
      const to = Math.min(from + batch, fim);
      const lote: { seq: number; opId: string; author: string; authorSeq: number; hostTs: number }[] = [];
      for (let seq = from; seq < to; seq++) {
        const raw = await this.#log.get(seq);
        if (raw === null) break;
        const rec = decodeRecord(raw);
        if (rec === null) continue;
        const env = decodeEnvelope(rec.envelope);
        if (env === null) continue;
        lote.push({
          seq,
          opId: opIdOf(rec.envelope),
          author: env.author.toString('hex'),
          authorSeq: env.authorSeq,
          hostTs: rec.hostTs,
        });
      }
      if (lote.length === 0) break;
      const ultimo = lote[lote.length - 1] as { seq: number };

      // Uma transação por lote (§10.7).
      const tx = this.#db.transaction(() => {
        const ins = this.#db.prepare(
          'INSERT OR REPLACE INTO messages(community_id, op_id, seq, author_key, author_seq, host_ts) VALUES (?,?,?,?,?,?)',
        );
        for (const m of lote) ins.run(this.#communityId, m.opId, m.seq, m.author, m.authorSeq, m.hostTs);
        this.#db
          .prepare("INSERT INTO meta(key, value) VALUES ('interpreted_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(String(ultimo.seq));
      });
      tx();

      // §10.5 — **primeiro `view.db`, depois `manifest.db`**, depois os eventos.
      killPoint('client:between-view-and-manifest');
      this.#manifest.metaSet('last_projected_seq', String(ultimo.seq));

      for (const m of lote) {
        const atual = this.state.lastAuthorSeq.get(m.author) ?? 0;
        if (m.authorSeq > atual) this.state.lastAuthorSeq.set(m.author, m.authorSeq);
      }
      this.state.interpretedSeq = ultimo.seq;
      projetados += lote.length;
      fim = await this.#log.length();
    }
    return projetados;
  }

  /**
   * §11.6 — `ds[community].lastAuthorSeq[eu]` para o autor **daquele** envelope. É o valor
   * contra o qual a reconciliação compara `item.author_seq`, e por isso sai da réplica: um
   * contador local paralelo seria a palavra do cliente sobre si mesmo, não observação.
   */
  lastAuthorSeqOf(envelope: Buffer): number {
    const env = decodeEnvelope(envelope);
    if (env === null) return 0;
    return this.state.lastAuthorSeq.get(env.author.toString('hex')) ?? 0;
  }

  /** `opId` observado na própria réplica — o oráculo de "a op está no log". */
  hasOpId(opId: string): boolean {
    const r = this.#db
      .prepare('SELECT 1 AS x FROM messages WHERE community_id = ? AND op_id = ?')
      .get(this.#communityId, opId) as { x: number } | undefined;
    return r !== undefined;
  }

  /** Quantos `seq` distintos existem para o mesmo `(author, authorSeq)` — a duplicata lógica. */
  duplicateLogical(): { par: string; seqs: number[] }[] {
    const rows = this.#db
      .prepare(
        // `"..."` no SQLite é identificador, não literal — aspas simples.
        "SELECT author_key || ':' || author_seq AS par, COUNT(*) AS n, GROUP_CONCAT(seq) AS seqs " +
          'FROM messages WHERE community_id = ? GROUP BY par HAVING n > 1',
      )
      .all(this.#communityId) as { par: string; n: number; seqs: string }[];
    return rows.map((r) => ({ par: r.par, seqs: r.seqs.split(',').map(Number) }));
  }

  count(): number {
    return (
      this.#db.prepare('SELECT COUNT(*) AS n FROM messages WHERE community_id = ?').get(this.#communityId) as {
        n: number;
      }
    ).n;
  }

  /** Hash do dump ordenado — a divergência de projeção de §28.4, reduzida a este schema. */
  dumpHash(): string {
    const rows = this.#db
      .prepare('SELECT op_id, seq, author_key, author_seq FROM messages WHERE community_id = ? ORDER BY seq')
      .all(this.#communityId) as Record<string, unknown>[];
    const texto = rows.map((r) => JSON.stringify(r)).join('\n');
    return createHash('sha256').update(texto).digest('hex');
  }

  close(): void {
    this.#db.close();
  }
}
