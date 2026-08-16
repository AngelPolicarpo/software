/**
 * `communityHost` — a secao critica de admissao. backend-v2.md §11.4, §11.5, §21.3.
 *
 *   1. adquire a secao critica da comunidade
 *   2. hostTs := max(clock.now(), ds.lastHostTs)          // R-1, nunca retrocede
 *   3. res := foldRecord(ds, montaHostRecord(envelope, hostTs, flags), ds.interpretedSeq + 1)
 *   4. se res.decision !== 'APPLIED': libera; responde erro tipado; NADA e appendado
 *   5. entra no grupo de commit corrente
 *   6. aguarda o append + flush do grupo
 *   7. se o flush falhar: descarta o efeito, responde E_STORAGE_FULL / E_INTERNAL
 *   8. ds := res.next            // so aqui o DS avanca
 *   9. libera a secao critica
 *  10. responde {seq, hostTs}
 *
 * FILA DE UMA VIA POR COMUNIDADE (§11.4) e NAO REENTRANTE (§21.3).
 *
 * O `DS` do host e o `DS` do projetor sao A MESMA INSTANCIA (§11.4) — o host nao tem
 * caminho privilegiado nem estado duplicado. Consequencia implementada aqui: o `fold`
 * roda UMA vez por registro, na admissao, e o projetor consome os `Effect` que ela
 * produziu. Ver HOLE-13 no REPORT.md: a spec tambem diz que "a projecao do host roda
 * pelo mesmo caminho de todo mundo, a partir do log", e as duas frases so sao
 * compativeis sob esta leitura.
 */
import Hypercore from 'hypercore';
import { flushCore } from './adversary.ts';
import { E, type ErrorCode } from '../protocol/errors.ts';
import { encodeHostRecord, hostRecSigningHash, type Envelope, type HostRecord } from '../codec/opCodec.ts';
import { encodeEnvelope } from '../codec/opCodec.ts';
import { sign } from '../crypto/index.ts';
import { foldRecord, newMetrics, type FoldMetrics, type FoldResult } from '../fold/index.ts';
import { emptyState, type DecisionState } from '../fold/state.ts';
import type { Effect } from '../fold/effects.ts';
import { KEY_COLS, dumpHash, openViewDb, wipeViewDb, type DB } from '../node/viewdb.ts';
import { Projector, type ProjectorOpts } from '../node/projector.ts';
import { foldBuildId, loadSnapshot, saveSnapshot } from '../node/snapshot.ts';

export type Clock = { now: () => number };

export type SubmitOk = { ok: true; seq: number; hostTs: number };
export type SubmitErr = { ok: false; code: ErrorCode; field?: string; limit?: number };
export type SubmitResult = SubmitOk | SubmitErr;

export type HostOpts = ProjectorOpts & {
  root: string;
  groupCommitWindowMs: number;
  groupCommitMax: number;
  snapshotIntervalSeqs: number;
};

type QueueItem = {
  envelope: Envelope;
  resolve: (r: SubmitResult) => void;
};

export class CommunityHost {
  readonly core: Hypercore;
  readonly keyPair: { publicKey: Buffer; secretKey: Buffer };
  readonly communityId: string;
  readonly communityKey: Buffer;
  readonly clock: Clock;
  readonly metrics: FoldMetrics = newMetrics();
  db: DB;
  projector: Projector;
  ds: DecisionState;
  private opts: HostOpts;
  private queue: QueueItem[] = [];
  private draining = false;
  /** §21.3: um lote por comunidade por vez, garantido por flag. */
  private inCriticalSection = false;
  /** efeitos ja decididos e appendados, aguardando o projetor (que pode estar pausado) */
  private pendingEffects: Array<{ seq: number; res: FoldResult }> = [];
  /** contadores do gate */
  stats = { submitted: 0, appended: 0, rejectedBeforeAppend: 0 };

  constructor(
    core: Hypercore,
    keyPair: { publicKey: Buffer; secretKey: Buffer },
    dbPath: string,
    clock: Clock,
    opts: HostOpts,
  ) {
    this.core = core;
    this.keyPair = keyPair;
    this.communityKey = keyPair.publicKey;
    this.communityId = keyPair.publicKey.toString('hex');
    this.clock = clock;
    this.opts = opts;
    this.db = openViewDb(dbPath);
    this.ds = emptyState(this.communityKey, this.communityId);
    this.projector = new Projector(this.db, this.communityId, opts);
  }

  /** Monta e assina o `HostRecord` (§7.1). */
  private makeRecord(envelope: Envelope, hostTs: number, flags: number): { rec: Buffer; hr: HostRecord } {
    const envBytes = encodeEnvelope(envelope);
    const digest = hostRecSigningHash(envBytes, hostTs, flags);
    const hostSig = sign(digest, this.keyPair.secretKey);
    const hr: HostRecord = { envelope: envBytes, hostTs, flags, hostSig };
    return { rec: encodeHostRecord(hr), hr };
  }

  /**
   * §11.4/§11.5 — enfileira e agenda o dreno num MICROTASK, nao sincronamente.
   *
   * Isso importa para as corridas: com dreno sincrono, `submit(a)` ja teria DECIDIDO `a`
   * (o `foldRecord` do passo 3 e sincrono) antes de `submit(b)` sequer enfileirar, e as
   * duas ops nunca disputariam o mesmo grupo. Com o microtask, submissoes emitidas no
   * mesmo turno entram na fila ANTES de qualquer decisao e sao agrupadas num unico
   * `core.append` + `flush` — que e exatamente o group commit que §11.5 descreve, e a
   * forma mais forte de submeter uma corrida "em paralelo".
   */
  submit(envelope: Envelope): Promise<SubmitResult> {
    return new Promise<SubmitResult>((resolve) => {
      this.queue.push({ envelope, resolve });
      queueMicrotask(() => void this.drain());
    });
  }

  /** §11.9 — `submitOps` em lote, mesma fila, item a item. */
  async submitAll(envelopes: readonly Envelope[]): Promise<SubmitResult[]> {
    return Promise.all(envelopes.map((e) => this.submit(e)));
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        // §11.5 — group commit: acumula ate GROUP_COMMIT_MAX registros por append+flush.
        const group = this.queue.splice(0, Math.max(1, this.opts.groupCommitMax));
        await this.processGroup(group);
      }
    } finally {
      this.draining = false;
    }
  }

  private async processGroup(group: QueueItem[]): Promise<void> {
    if (this.inCriticalSection) throw new Error('reentrancia na secao critica (§21.3)');
    this.inCriticalSection = true;
    // 1. secao critica adquirida.
    const accepted: Array<{ item: QueueItem; res: FoldResult; rec: Buffer; hostTs: number; seq: number }> = [];
    let speculativeDs = this.ds;
    try {
      for (const item of group) {
        this.stats.submitted++;
        // 2. hostTs := max(clock.now(), ds.lastHostTs) — R-1, nunca retrocede.
        const hostTs = Math.max(this.clock.now(), speculativeDs.lastHostTs);
        const { rec } = this.makeRecord(item.envelope, hostTs, 0);
        const seq = speculativeDs.interpretedSeq + 1;
        // 3. o MESMO `fold`, contra o `DS` na CABECA do log.
        const res = foldRecord(speculativeDs, rec, seq, this.metrics);
        if (res.decision !== 'APPLIED') {
          // 4. NADA e appendado; o cliente recebe o erro tipado.
          this.stats.rejectedBeforeAppend++;
          item.resolve({ ok: false, code: (res.reason ?? E.INTERNAL) as ErrorCode, field: res.field, limit: res.limit });
          continue;
        }
        accepted.push({ item, res, rec, hostTs, seq });
        speculativeDs = res.next;
      }

      if (accepted.length > 0) {
        // 5/6. UM `core.append([...])` + UM `flush()` para o grupo inteiro.
        try {
          await this.core.append(accepted.map((a) => a.rec));
          await flushCore(this.core);
        } catch {
          // 7. flush falhou: descarta o efeito, o `DS` NAO avancou, nada a desfazer.
          for (const a of accepted) a.item.resolve({ ok: false, code: E.INTERNAL });
          return;
        }
        // 8. so aqui o DS avanca.
        this.ds = speculativeDs;
        this.stats.appended += accepted.length;
        for (const a of accepted) this.pendingEffects.push({ seq: a.seq, res: a.res });
        // 10. responde {seq, hostTs}
        for (const a of accepted) a.item.resolve({ ok: true, seq: a.seq, hostTs: a.hostTs });
      }
    } finally {
      // 9. libera a secao critica.
      this.inCriticalSection = false;
    }
    if (!this.projector.isPaused) this.flushProjector();
  }

  /** Aplica em `view.db` os efeitos ja decididos na admissao (uma transacao por lote). */
  flushProjector(): void {
    if (this.pendingEffects.length === 0) return;
    const batch = this.pendingEffects.splice(0, this.pendingEffects.length);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const { seq, res } of batch) {
        for (const eff of res.effects) this.applyEffect(eff);
        this.projector.decisions.push({ seq, decision: res.decision, reason: res.reason });
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  pauseProjector(): void {
    this.projector.pause();
  }

  resumeProjector(): void {
    this.projector.resume();
    this.flushProjector();
  }

  get projectorBacklog(): number {
    return this.pendingEffects.length;
  }

  private applyEffect(eff: Effect): void {
    // Mesmo caminho do `Projector`; duplicado aqui porque a origem dos efeitos e a
    // secao critica, nao a leitura do log (ver o cabecalho e HOLE-13).
    switch (eff.t) {
      case 'upsert': {
        const cols = ['community_id', ...Object.keys(eff.row)];
        const vals = [this.communityId, ...Object.values(eff.row)];
        this.db
          .prepare(`INSERT OR REPLACE INTO ${eff.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
          .run(...(vals as unknown[] as never[]));
        return;
      }
      case 'patch': {
        const set = Object.keys(eff.fields);
        if (set.length === 0) return;
        const where = KEY_COLS[eff.table].slice(0, eff.key.length);
        this.db
          .prepare(
            `UPDATE ${eff.table} SET ${set.map((c) => `${c}=?`).join(',')} WHERE community_id=? AND ${where
              .map((c) => `${c}=?`)
              .join(' AND ')}`,
          )
          .run(...([...Object.values(eff.fields), this.communityId, ...eff.key] as never[]));
        return;
      }
      case 'delete': {
        const where = KEY_COLS[eff.table].slice(0, eff.key.length);
        this.db
          .prepare(`DELETE FROM ${eff.table} WHERE community_id=? AND ${where.map((c) => `${c}=?`).join(' AND ')}`)
          .run(...([this.communityId, ...eff.key] as never[]));
        return;
      }
      case 'recount': {
        if (eff.what === 'memberCount') {
          this.db
            .prepare(
              'UPDATE communities SET member_count = (SELECT COUNT(*) FROM members WHERE community_id=? AND left_at IS NULL AND banned=0) WHERE community_id=? AND id=?',
            )
            .run(this.communityId, this.communityId, String(eff.key[0]));
        } else if (eff.what === 'roleMemberCount') {
          this.db
            .prepare(
              'UPDATE roles SET member_count = (SELECT COUNT(*) FROM member_roles mr JOIN members m ON m.community_id=mr.community_id AND m.identity_key=mr.identity_key WHERE mr.community_id=? AND mr.role_id=? AND m.left_at IS NULL AND m.banned=0) WHERE community_id=? AND id=?',
            )
            .run(this.communityId, String(eff.key[0]), this.communityId, String(eff.key[0]));
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * Append da GENESE — §19.1 passo 5: UMA chamada `core.append([...6 registros])`,
   * seguida de flush. Ou os 6 entram, ou nenhum. NAO passa pela fila de admissao
   * porque a fila valida contra um `DS` que ainda nao existe; a atomicidade e do log.
   */
  async appendGenesis(envelopes: readonly Envelope[], hostTs: number): Promise<void> {
    const recs = envelopes.map((e) => this.makeRecord(e, hostTs, 0).rec);
    await this.core.append(recs);
    await flushCore(this.core);
    // O host interpreta os 6 pelo caminho normal — sem atalho (§19.1 passo 7).
    for (let seq = 0; seq < recs.length; seq++) {
      const res = foldRecord(this.ds, recs[seq], seq, this.metrics);
      this.ds = res.next;
      this.pendingEffects.push({ seq, res });
    }
    this.stats.appended += recs.length;
    if (!this.projector.isPaused) this.flushProjector();
  }

  /**
   * §10.6 — snapshot tirado pelo PROJETOR, ou seja, so do estado JA PROJETADO.
   * Exige `pendingEffects` vazio: um snapshot a frente de `view.db` seria inconsistente
   * e a rematerializacao de `messages` (§8.1) perderia dado.
   */
  snapshotProjected(): void {
    if (this.pendingEffects.length > 0) {
      throw new Error('snapshot com projecao atrasada: violaria §10.6');
    }
    saveSnapshot(this.db, this.communityId, this.ds, foldBuildId(this.opts.root), this.clock.now());
  }

  /**
   * REINICIO DO HOST (POC-01: "reinicio do host no intervalo").
   *
   * Derruba TODO o estado em memoria — inclusive os efeitos ja decididos na admissao e
   * ainda nao projetados, que e exatamente o que um crash perderia — e reconstroi pelo
   * caminho de boot de §19.2: `ds_snapshot` -> `fold` ate `core.length`.
   *
   * Depois disto, o `DS` que decide a proxima op foi INTERPRETADO A PARTIR DO LOG, nao
   * herdado da admissao. E a forma mais direta de testar a afirmacao central de §1.2.
   */
  async restartFromSnapshot(): Promise<void> {
    this.pendingEffects = [];
    const snap = loadSnapshot(this.db, this.communityId, foldBuildId(this.opts.root));
    this.ds = snap ?? emptyState(this.communityKey, this.communityId);
    await this.foldTailFromLog();
  }

  /**
   * §10.5 — reprojecao TOTAL: DROP/recria `view.db` e `fold` do `seq` 0.
   * Devolve o hash do dump para comparacao com o de antes (§28.4 teste 1).
   */
  async reprojectAll(): Promise<string> {
    this.flushProjector();
    wipeViewDb(this.db);
    this.ds = emptyState(this.communityKey, this.communityId);
    this.pendingEffects = [];
    this.projector = new Projector(this.db, this.communityId, this.opts);
    await this.foldTailFromLog();
    return dumpHash(this.db, this.communityId).hash;
  }

  /**
   * Interpreta do log ate `core.length` — o MESMO caminho de qualquer replica (§8.7).
   * A projecao incremental pode estar pausada; o boot/reprojecao nao e projecao
   * incremental, e por isso escreve. Restaura o estado de pausa ao terminar.
   */
  private async foldTailFromLog(): Promise<void> {
    const read = async (seq: number): Promise<Uint8Array | null> =>
      (await this.core.get(seq, { wait: false })) ?? null;
    const wasPaused = this.projector.isPaused;
    this.projector.resume();
    this.ds = await this.projector.run(this.ds, read, this.core.length);
    if (wasPaused) this.projector.pause();
  }

  hash(): string {
    this.flushProjector();
    return dumpHash(this.db, this.communityId).hash;
  }

  maybeSnapshot(): void {
    if (this.ds.interpretedSeq >= 0 && this.ds.interpretedSeq % this.opts.snapshotIntervalSeqs === 0) {
      saveSnapshot(this.db, this.communityId, this.ds, foldBuildId(this.opts.root), this.clock.now());
    }
  }

  async close(): Promise<void> {
    this.db.close();
    await this.core.close();
  }
}
