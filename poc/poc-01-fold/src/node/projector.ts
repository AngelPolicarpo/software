/**
 * `projector` — backend-v2.md §10.5, §8.4, §10.7.
 *
 * Consumidor PURO: le do core em lotes de `PROJECTOR_BATCH`, chama `foldRecord`, aplica
 * os `Effect` NA ORDEM dentro de UMA transacao por lote, e emite os `notify` DEPOIS do
 * commit. NAO decide nada.
 *
 * PAUSAVEL (exigencia da linha "Construir" do POC-01): `pause()` congela a projecao
 * enquanto o host continua aceitando e appendando. E o que reproduz a corrida
 * validacao↔projecao de v1 e prova que ela deixou de existir (§1.2).
 */
import { E } from '../protocol/errors.ts';
import { foldRecord, newMetrics, type FoldMetrics, type FoldResult } from '../fold/index.ts';
import type { DecisionState } from '../fold/state.ts';
import type { Effect } from '../fold/effects.ts';
import { KEY_COLS, type DB } from './viewdb.ts';

export type ProjectorOpts = {
  batch: number;
  /** teto de linhas em `rejected_records` (P2P_REJECTED_LOG_MAX, §27.2) */
  rejectedLogMax: number;
};

type Stmt = { run: (...a: unknown[]) => unknown; get: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[] };
type Stmts = Map<string, Stmt>;

export class Projector {
  readonly db: DB;
  readonly communityId: string;
  readonly metrics: FoldMetrics = newMetrics();
  private stmts: Stmts = new Map();
  private opts: ProjectorOpts;
  private paused = false;
  /** eventos `notify` acumulados; emitidos so DEPOIS do commit (§10.7) */
  readonly notifications: Array<{ topic: string; data: object }> = [];
  readonly decisions: Array<{ seq: number; decision: string; reason?: string }> = [];
  /** registro completo de `fold.panic` (§8.5 item 3) */
  readonly panics: Array<{ seq: number }> = [];

  constructor(db: DB, communityId: string, opts: ProjectorOpts) {
    this.db = db;
    this.communityId = communityId;
    this.opts = opts;
  }

  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  get isPaused(): boolean {
    return this.paused;
  }

  private prep(sql: string): Stmt {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql) as unknown as Stmt;
      this.stmts.set(sql, s);
    }
    return s;
  }

  /**
   * Interpreta e projeta os registros de `state.interpretedSeq + 1` ate `length - 1`.
   * Devolve o novo `DecisionState`. Nao faz nada quando pausado.
   */
  async run(
    state: DecisionState,
    read: (seq: number) => Promise<Uint8Array | null>,
    length: number,
  ): Promise<DecisionState> {
    if (this.paused) return state;
    let s = state;
    while (s.interpretedSeq + 1 < length) {
      if (this.paused) return s;
      const from = s.interpretedSeq + 1;
      const to = Math.min(from + this.opts.batch, length);
      const batch: Array<{ seq: number; res: FoldResult }> = [];
      for (let seq = from; seq < to; seq++) {
        const raw = await read(seq);
        if (raw === null) return s; // bloco ainda nao replicado
        const res = foldRecord(s, raw, seq, this.metrics);
        if (this.metrics.panic > this.panics.length) this.panics.push({ seq });
        s = res.next;
        batch.push({ seq, res });
      }
      // §10.5 passo 4: UMA transacao por lote.
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const { seq, res } of batch) {
          for (const eff of res.effects) this.applyEffect(eff);
          if (res.decision !== 'APPLIED') this.recordRejected(seq, res);
          this.decisions.push({ seq, decision: res.decision, reason: res.reason });
        }
        this.prep('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
          `interpreted_seq:${this.communityId}`,
          String(s.interpretedSeq),
        );
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
      // §10.7: emissao de eventos SEMPRE depois do commit.
      for (const { res } of batch) {
        for (const eff of res.effects) {
          if (eff.t === 'notify') this.notifications.push({ topic: eff.topic, data: eff.data });
        }
      }
    }
    return s;
  }

  private recordRejected(seq: number, res: FoldResult): void {
    const n = this.prep('SELECT COUNT(*) AS n FROM rejected_records WHERE community_id = ?').get(this.communityId) as {
      n: number;
    };
    if (n.n >= this.opts.rejectedLogMax) return;
    this.prep(
      'INSERT OR REPLACE INTO rejected_records(community_id, seq, kind, author_key, reason) VALUES (?,?,?,?,?)',
    ).run(this.communityId, seq, 0, null, res.reason ?? E.MALFORMED);
  }

  private applyEffect(eff: Effect): void {
    switch (eff.t) {
      case 'upsert': {
        const cols = ['community_id', ...Object.keys(eff.row)];
        const vals = [this.communityId, ...Object.values(eff.row)];
        const sql = `INSERT OR REPLACE INTO ${eff.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
        this.prep(sql).run(...vals);
        return;
      }
      case 'patch': {
        const keys = KEY_COLS[eff.table];
        const set = Object.keys(eff.fields);
        if (set.length === 0) return;
        const where = keys.slice(0, eff.key.length);
        const sql = `UPDATE ${eff.table} SET ${set.map((c) => `${c}=?`).join(',')} WHERE community_id=? AND ${where
          .map((c) => `${c}=?`)
          .join(' AND ')}`;
        this.prep(sql).run(...[...Object.values(eff.fields), this.communityId, ...eff.key]);
        return;
      }
      // §8.4 formas em lote: UM `UPDATE ... WHERE` sobre indice existente.
      case 'patchScope': {
        const set = Object.keys(eff.fields);
        if (set.length === 0) return;
        const assign = set.map((c) => `${c}=?`).join(',');
        const vals = Object.values(eff.fields);
        if (eff.scope.s === 'messagesOfAuthor') {
          this.prep(
            `UPDATE messages SET ${assign} WHERE community_id=? AND author_key=?`,
          ).run(...vals, this.communityId, eff.scope.authorKey);
        } else if (eff.scope.s === 'messagesOfChannel') {
          this.prep(
            `UPDATE messages SET ${assign} WHERE community_id=? AND channel_id=?`,
          ).run(...vals, this.communityId, eff.scope.channelId);
        }
        return;
      }
      case 'delete': {
        const keys = KEY_COLS[eff.table];
        const where = keys.slice(0, eff.key.length);
        const sql = `DELETE FROM ${eff.table} WHERE community_id=? AND ${where.map((c) => `${c}=?`).join(' AND ')}`;
        this.prep(sql).run(...[this.communityId, ...eff.key]);
        return;
      }
      case 'recount': {
        if (eff.what === 'memberCount') {
          this.prep(
            'UPDATE communities SET member_count = (SELECT COUNT(*) FROM members WHERE community_id=? AND left_at IS NULL AND banned=0) WHERE community_id=? AND id=?',
          ).run(this.communityId, this.communityId, String(eff.key[0]));
        } else if (eff.what === 'roleMemberCount') {
          this.prep(
            'UPDATE roles SET member_count = (SELECT COUNT(*) FROM member_roles mr JOIN members m ON m.community_id=mr.community_id AND m.identity_key=mr.identity_key WHERE mr.community_id=? AND mr.role_id=? AND m.left_at IS NULL AND m.banned=0) WHERE community_id=? AND id=?',
          ).run(this.communityId, String(eff.key[0]), this.communityId, String(eff.key[0]));
        }
        return;
      }
      // Fora do escopo do POC-01 (a linha "Nao implementar" exclui busca):
      // os efeitos sao emitidos pelo `fold` conforme §8.4 e ignorados pelo projetor.
      case 'ftsIndex':
      case 'ftsRemove':
      case 'ftsRemoveScope':
      case 'audit':
      case 'notify':
        return;
    }
  }
}
