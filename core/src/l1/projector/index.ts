// `projector` — L1→L0. §10.5 (projeção e reprojeção), §10.6 (snapshot), §8.4 (efeitos),
// §10.7 (transações e barreiras), §21.1 (único escritor de `view.db`).
//
// Algoritmo, por comunidade (§10.5):
//
//   1. Carrega o `DecisionState` (§10.6) — snapshot com `foldBuildId` válido, ou vazio.
//   2. Lê do core em lotes de `PROJECTOR_BATCH` a partir de `interpretedSeq + 1`.
//   3. Para cada registro: `foldRecord(ds, rec, seq)`.
//   4. **Uma transação `view.db` por lote**: aplica os `Effect` **na ordem**, recalcula os
//      `recount`, grava `rejected_records` e o snapshot quando o intervalo chegou.
//   5. Commit. **Depois do commit**, emite os `notify` como eventos (§10.7).
//   6. Repete até `core.length`; depois reage a `append`.
//
// O projector não decide nada e **não decodifica registro** (§4): o `kind` e o `author` que
// `rejected_records` (§10.3) e `fold.panic` (§8.5) pedem chegam pelo `FoldResult` (§8.0). De
// `opCodec` ele tira uma coisa só, a constante `OP_VERSION`, porque `meta.op_version`
// (§10.3.1) precisa de escritor e o único escritor de `view.db` é ele (§21.1).
//
// Não emite evento IPC **direto**: os `notify` saem pelo `onEvent` injetado, sempre depois do
// commit — evento é sinal, nunca fonte (§10.7). A atualização de `local_read_state` (que vive
// em `manifest.db`) e a enumeração de comunidades da reprojeção total (§10.5 passo 1) são da
// fase 3, quando `manifest` existir: §4 **não** dá `manifest` ao projector, e a barreira de
// dois bancos de §10.5 é montada por quem compõe o boot.
//
// §21.3 — nunca reentrante: um lote por comunidade por vez, garantido por flag; um `append`
// durante um lote entra no lote seguinte.

import type { CoreHandle } from '../../l0/corestore/index.ts';
import { META_OP_VERSION, type ViewDb } from '../../l0/view/index.ts';
import { OP_VERSION } from '../../l1/opCodec/index.ts';
import {
  clearPanic,
  emptyState,
  foldRecord,
  newMetrics,
  type DecisionState,
  type EventTopic,
  type FoldMetrics,
  type FoldResult,
} from '../../l1/fold/index.ts';
import { applyEffect, newStmtCache, type StmtCache as EffectStmtCache } from './apply.ts';
import {
  DS_SNAPSHOT_INTERVAL,
  PROJECTOR_BATCH,
  REJECTED_LOG_MAX,
  REPROJECT_PROGRESS_SEQ,
} from './constants.ts';
import { loadSnapshot, saveSnapshot } from './snapshot.ts';

/** Evento IPC (§15.5) — `communityId` sempre presente, acrescentado pelo projector. */
export type ProjectedEvent = {
  readonly topic: EventTopic | 'core.reprojecting';
  readonly data: Readonly<Record<string, unknown>>;
};

export type ProjectorOptions = {
  /** §27.2 `P2P_PROJECTOR_BATCH` — registros por transação. Default 256. */
  readonly batch?: number;
  /** §27.2 `P2P_DS_SNAPSHOT_INTERVAL`. Default 5 000. */
  readonly snapshotInterval?: number;
  /** §27.2 `P2P_REPROJECT_PROGRESS_SEQ` — barra de progresso a partir daí. Default 100 000. */
  readonly reprojectProgressSeq?: number;
  /** §27.2 `P2P_REJECTED_LOG_MAX`. Default 2 000. */
  readonly rejectedLogMax?: number;
  /** §10.6 — hash do binário do `fold`, calculado por quem compõe o boot. */
  readonly foldBuildId: string;
  /** Relógio injetável — só `taken_at` do snapshot (§10.6). */
  readonly now?: () => number;
  /**
   * O `fold` de §8.0. Injetável: o caminho de admissão do host (§11.4) consome efeitos da
   * execução do `communityHost`, e o teste da rede de segurança de §8.5 injeta um que lança.
   * Default é o `foldRecord` real, total.
   */
  readonly fold?: typeof foldRecord;
  /** §10.5 passo 5 — `notify` **depois** do commit. Sem isso, nada é emitido. */
  readonly onEvent?: (events: readonly ProjectedEvent[]) => void;
  /**
   * §8.5 — `fold.panic{seq, kind}`. Métrica de bug; nunca fluxo de controle. O `kind` vem do
   * `FoldResult` (§8.0) e é `null` quando a exceção veio antes do decode do `Op`.
   */
  readonly onPanic?: (seq: number, kind: number | null) => void;
};

export class Projector {
  readonly #view: ViewDb;
  readonly #core: CoreHandle;
  readonly #communityId: string;
  readonly #opts: Required<ProjectorOptions>;
  readonly #stmt: EffectStmtCache = newStmtCache();
  readonly metrics: FoldMetrics = newMetrics();
  #ds: DecisionState;
  /** `interpretedSeq` no último snapshot gravado (§10.6, cadência). */
  #lastSnapshotSeq = -1;
  /** §21.3 — um lote por comunidade por vez. */
  #inFlight: Promise<void> | null = null;
  #offAppend: (() => void) | null = null;

  constructor(view: ViewDb, core: CoreHandle, opts: ProjectorOptions) {
    this.#view = view;
    this.#core = core;
    this.#communityId = core.key.toString('hex');
    this.#ds = emptyState(core.key, this.#communityId);
    this.#opts = {
      batch: opts.batch ?? PROJECTOR_BATCH,
      snapshotInterval: opts.snapshotInterval ?? DS_SNAPSHOT_INTERVAL,
      reprojectProgressSeq: opts.reprojectProgressSeq ?? REPROJECT_PROGRESS_SEQ,
      rejectedLogMax: opts.rejectedLogMax ?? REJECTED_LOG_MAX,
      foldBuildId: opts.foldBuildId,
      now: opts.now ?? Date.now,
      fold: opts.fold ?? foldRecord,
      onEvent: opts.onEvent ?? (() => {}),
      onPanic: opts.onPanic ?? (() => {}),
    };
  }

  get ds(): DecisionState {
    return this.#ds;
  }

  /**
   * §19.2 (boot) — snapshot → `fold` até `core.length`. Reprojeção total quando o schema de
   * `view.db` mudou (§3.3, §10.5), quando um `fold.panic` ficou registrado no boot anterior
   * (§8.5, §10.5), ou quando o snapshot está **ausente ou inconsistente** — que §10.6 define
   * como `ds_snapshot.interpreted_seq` ≠ `meta.interpreted_seq:<communityId>`, o marcador
   * gravado a cada lote commitado. Sem a igualdade o crash aconteceu entre duas cadências de
   * snapshot e o boot reaplicaria efeitos já materializados; recomeça-se do `seq` 0.
   */
  async boot(): Promise<void> {
    clearPanic();
    if (this.#view.schemaVersionMismatch() || this.#view.foldPanicSeq(this.#communityId) !== null) {
      await this.reproject();
      return;
    }
    this.#writeOpVersion();
    const snap = loadSnapshot(this.#view, this.#communityId, this.#opts.foldBuildId);
    if (
      snap !== null &&
      this.#view.interpretedSeqMarker(this.#communityId) === snap.interpretedSeq
    ) {
      this.#ds = snap;
      this.#lastSnapshotSeq = snap.interpretedSeq;
      await this.catchUp();
      return;
    }
    await this.reproject();
  }

  /** §10.5 passo 6 — passa a reagir a `append` do core. */
  start(): void {
    if (this.#offAppend === null) {
      this.#offAppend = this.#core.onAppend(() => void this.catchUp());
    }
  }

  stop(): void {
    this.#offAppend?.();
    this.#offAppend = null;
  }

  /** Interpreta do `interpretedSeq + 1` até `core.length`. Idempotente e não reentrante. */
  async catchUp(): Promise<void> {
    for (;;) {
      const inFlight = this.#inFlight;
      if (inFlight === null) break;
      await inFlight; // §21.3 — nunca reentrante; o append entrou no lote seguinte
    }
    const before = this.#core.length;
    const run = this.#run({ reprojecting: false });
    this.#inFlight = run;
    try {
      await run;
    } finally {
      this.#inFlight = null;
    }
    // Um `append` que caiu **durante** o giro fica para o próximo. Um buraco de replicação
    // (bloco ainda não disponível) não dispara nova corrida: o próprio `append` que chegar
    // depois chama `catchUp` de novo (§10.5 passo 6).
    if (this.#core.length > before) await this.catchUp();
  }

  /**
   * Reprojeção total (§10.5). `DROP`/recria de `view.db` e `fold` do `seq` 0. A lista de
   * comunidades vem de `manifest.communities` (§10.5 passo 1) — quem compõe o boot chama
   * este método por comunidade; o módulo não conhece `manifest` (§4).
   */
  async reproject(): Promise<void> {
    this.#view.wipe();
    this.#writeOpVersion();
    this.#ds = emptyState(this.#core.key, this.#communityId);
    this.#lastSnapshotSeq = -1;
    await this.#run({ reprojecting: true });
  }

  /**
   * §10.3.1 — `meta.op_version`: a versão de protocolo que materializou esta `view.db`. O
   * `wipe` da reprojeção derruba `meta` junto com o resto e o `view` (L0) repõe só a versão
   * de schema; a de protocolo mora em `opCodec` (L1) e por isso é escrita aqui, pelo único
   * escritor de `view.db` (§21.1). Escrever de novo o mesmo valor é barato e idempotente.
   */
  #writeOpVersion(): void {
    this.#view.metaSet(META_OP_VERSION, String(OP_VERSION));
  }

  /** §10.6 — "no `draining`": grava o snapshot fora da cadência. Cache, nunca verdade. */
  snapshot(at?: number): void {
    saveSnapshot(this.#view, this.#communityId, this.#ds, this.#opts.foldBuildId, at ?? this.#opts.now());
    this.#lastSnapshotSeq = this.#ds.interpretedSeq;
  }

  async #run(opts: { reprojecting: boolean }): Promise<void> {
    let ds = this.#ds;
    const total = this.#core.length;
    while (ds.interpretedSeq + 1 < this.#core.length) {
      const from = ds.interpretedSeq + 1;
      const to = Math.min(from + this.#opts.batch, this.#core.length);
      const batch: Array<{ seq: number; res: FoldResult }> = [];
      let panicSeq: number | null = null;
      // `working` avança registro a registro; `ds` só avança **depois** do commit do lote —
      // é o que mantém memória e `view.db` no mesmo prefixo quando o lote não completa.
      let working = ds;

      for (let seq = from; seq < to; seq++) {
        const raw = await this.#core.get(seq);
        if (raw === null) {
          // Bloco ainda não replicado: para e espera o próximo `append` (§10.5 passo 6).
          // Os folds deste lote incompleto são descartados — nada foi commitado.
          this.#ds = ds;
          return;
        }
        const panicBefore = this.metrics.panic;
        let res: FoldResult;
        try {
          res = this.#opts.fold(working, raw, seq, this.metrics);
        } catch {
          // §8.5 — rede de segurança: nunca deve acontecer com o `fold` real (total). Um bug
          // nunca vira perda de comunidade: o registro é `IGNORED` e a interpretação continua.
          this.metrics.panic++;
          this.metrics.ignored++;
          panicSeq = seq;
          // O `fold` injetado lançou para fora: não há `FoldResult`, e portanto não há `kind`.
          this.#opts.onPanic(seq, null);
          res = {
            decision: 'IGNORED',
            reason: 'E_MALFORMED',
            effects: [],
            next: { ...working, interpretedSeq: seq },
          };
        }
        if (panicSeq === null && this.metrics.panic > panicBefore) {
          // O `foldRecord` real captura por dentro (§8.5): o panic aparece como métrica, e o
          // `kind` do `FoldResult` (§8.0) é a única fonte possível para `fold.panic{seq, kind}`.
          panicSeq = seq;
          this.#opts.onPanic(seq, res.kind ?? null);
        }
        working = res.next;
        batch.push({ seq, res });
      }

      // §10.5 passo 4 — UMA transação por lote.
      const events: ProjectedEvent[] = [];
      this.#view.transaction(() => {
        for (const { seq, res } of batch) {
          for (const eff of res.effects) {
            if (eff.t === 'notify') {
              // §15.5 — `communityId` sempre presente quando aplicável; o dado do `fold` não
              // o carrega, e acrescentar aqui é parte da tradução do projector.
              events.push({ topic: eff.topic, data: { communityId: this.#communityId, ...eff.data } });
              continue;
            }
            applyEffect(this.#view, this.#stmt, this.#communityId, eff);
          }
          if (res.decision === 'REJECTED') this.#recordRejected(seq, res);
        }
        if (panicSeq !== null) this.#view.setFoldPanicSeq(this.#communityId, panicSeq); // §8.5
        // §10.3 — "se ausente ou inconsistente, o fold recomeça do seq 0": este marcador,
        // gravado **com** os efeitos, é o que permite detectar o snapshot atrasado.
        this.#view.setInterpretedSeqMarker(this.#communityId, working.interpretedSeq);
        if (working.interpretedSeq - this.#lastSnapshotSeq >= this.#opts.snapshotInterval) {
          saveSnapshot(this.#view, this.#communityId, working, this.#opts.foldBuildId, this.#opts.now());
          this.#lastSnapshotSeq = working.interpretedSeq;
        }
      });
      ds = working;

      // §10.7 — emissão de eventos **sempre depois** do commit. Evento é sinal, nunca fonte.
      if (events.length > 0) this.#opts.onEvent(events);
      if (opts.reprojecting && total >= this.#opts.reprojectProgressSeq) {
        this.#opts.onEvent([
          { topic: 'core.reprojecting', data: { communityId: this.#communityId, done: ds.interpretedSeq + 1, total } },
        ]);
      }
    }
    this.#ds = ds;
  }

  /** §10.3 — `rejected_records`, só para diagnóstico, podado acima de `REJECTED_LOG_MAX`. */
  #recordRejected(seq: number, res: FoldResult): void {
    // §8.0 — `kind`/`author_key` vêm do `FoldResult` e são `NULL` **exatamente** quando o `Op`
    // não decodificou, isto é, só na recusa do estágio 0 (teto de bytes, antes de qualquer
    // decode). O projector não decodifica registro nenhum (§4).
    this.#view
      .prepare(
        'INSERT OR REPLACE INTO rejected_records(community_id, seq, kind, author_key, reason) VALUES (?, ?, ?, ?, ?)',
      )
      .run(this.#communityId, seq, res.kind ?? null, res.author ?? null, res.reason ?? 'E_MALFORMED');
    this.#view
      .prepare(
        'DELETE FROM rejected_records WHERE community_id = ? AND seq NOT IN (SELECT seq FROM rejected_records WHERE community_id = ? ORDER BY seq DESC LIMIT ?)',
      )
      .run(this.#communityId, this.#communityId, this.#opts.rejectedLogMax);
  }
}

export { DS_SNAPSHOT_INTERVAL, PROJECTOR_BATCH, REJECTED_LOG_MAX, REPROJECT_PROGRESS_SEQ } from './constants.ts';
export { deserializeDs, loadSnapshot, loadMessagesFromView, saveSnapshot, serializeDs } from './snapshot.ts';
export { applyEffect } from './apply.ts';
