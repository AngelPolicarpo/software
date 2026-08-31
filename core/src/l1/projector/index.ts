// `projector` — L1→L0. §10.5 (projeção e reprojeção), §10.6 (snapshot), §8.4 (efeitos),
// §10.7 (transações e barreiras), §21.1 (único escritor de `view.db`).
//
// Algoritmo, por comunidade (§10.5):
//
//   1. Carrega o `DecisionState` (§10.6) — snapshot com `foldBuildId` válido, ou vazio.
//   2. Lê do core em lotes de `PROJECTOR_BATCH` a partir de `interpretedSeq + 1`.
//   3. Para cada registro: `foldRecord(ds, rec, seq)`.
//   4. **Uma transação `view.db` por lote**: aplica os `Effect` **na ordem**, registra os
//      `APPLIED` em `observed_ops`, recalcula os `recount`, grava `rejected_records` e o snapshot.
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
  authorSequenceKey,
  newMetrics,
  type DecisionState,
  type EventTopic,
  type FoldMetrics,
  type FoldResult,
} from '../../l1/fold/index.ts';
import { sequenceScopeKey, type SequenceScope } from '../../l1/opCodec/index.ts';
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

/**
 * §15.5 — o evento é do **lote projetado**, não do registro. `messages.appended` e
 * `auditLog.changed` declaram `fromSeq`/`toSeq`; `members.changed`, `roles.changed`,
 * `community.changed` e `message.updated` declaram conjuntos. Nenhuma dessas formas é
 * produzível por um `fold` que só enxerga um registro por vez (§8.0): quem sabe onde o lote
 * termina é o projector (§10.5 passo 5), e é ele que agrega — sem decidir nada, porque a
 * chave da agregação é o próprio alvo que a tabela de §15.5 nomeia no payload.
 *
 * Isto é o "delta agregado do projetor" de `DR-27`, agora com forma: **um evento por alvo
 * por lote**, na posição da primeira ocorrência. Agregar não perde estado — evento é sinal
 * para reconsultar (§15.1 regra 5) —, e reduz a pressão sobre a janela de `IPC_SUB_WINDOW`
 * exatamente no caso que a estoura: um lote de 256 registros do mesmo canal.
 */
const MERGE_KEY: Readonly<Record<EventTopic, readonly string[]>> = {
  'messages.appended': ['channelId'],
  'message.updated': ['messageId'],
  'auditLog.changed': [],
  'members.changed': [],
  'roles.changed': [],
  'structure.changed': [],
  'invites.changed': [],
  'community.changed': [],
  'community.ended': [],
};

/** Alvo agregável do evento, ou `null` para o que não está na tabela do `fold`. */
function bucketOf(ev: ProjectedEvent): string | null {
  const keys: readonly string[] | undefined = MERGE_KEY[ev.topic as EventTopic];
  if (keys === undefined) return null;
  return [ev.topic, ...keys.map((k) => String(ev.data[k] ?? ''))].join(' ');
}

/** `fromSeq` mínimo, `toSeq` máximo, união das listas, disjunção dos booleanos. */
function mergeData(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    if (k === 'fromSeq' && typeof prev === 'number' && typeof v === 'number') out[k] = Math.min(prev, v);
    else if (k === 'toSeq' && typeof prev === 'number' && typeof v === 'number') out[k] = Math.max(prev, v);
    else if (typeof prev === 'boolean' && typeof v === 'boolean') out[k] = prev || v;
    else if (Array.isArray(prev) && Array.isArray(v)) out[k] = [...new Set([...prev, ...v])];
    else out[k] = v;
  }
  return out;
}

/** Agrega os `notify` de um lote, preservando a ordem de estreia de cada alvo. */
export function coalesceBatch(events: readonly ProjectedEvent[]): ProjectedEvent[] {
  const slots: Array<{ topic: ProjectedEvent['topic']; data: Record<string, unknown> }> = [];
  const byBucket = new Map<string, (typeof slots)[number]>();
  for (const ev of events) {
    const bucket = bucketOf(ev);
    const slot = bucket === null ? undefined : byBucket.get(bucket);
    if (slot === undefined) {
      const novo = { topic: ev.topic, data: { ...ev.data } };
      slots.push(novo);
      if (bucket !== null) byBucket.set(bucket, novo);
      continue;
    }
    slot.data = mergeData(slot.data, ev.data);
  }
  return slots;
}

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

  get interpretedSeq(): number {
    return this.#ds.interpretedSeq;
  }

  /** §11.6 — presença de uma operação aceita, indexada por identidade estável. */
  observedOp(opId: string): { readonly seq: number } | null {
    const row = this.#view
      .prepare('SELECT seq FROM observed_ops WHERE community_id = ? AND op_id = ?')
      .get(this.#communityId, opId) as { seq: number } | undefined;
    return row === undefined ? null : { seq: row.seq };
  }

  /** Leitura do watermark escopado para a porta de observação da outbox. */
  authorWatermark(author: Buffer | string, scope: SequenceScope | string): number {
    const authorHex = typeof author === 'string' ? author : author.toString('hex');
    return this.#ds.lastAuthorSeq.get(authorSequenceKey(authorHex, typeof scope === 'string' ? scope : sequenceScopeKey(scope))) ?? 0;
  }

  /**
   * §19.2 (boot) — snapshot → `fold` até `core.length`. Reprojeção quando o schema de
   * `view.db` mudou (§3.3, §10.5), quando um `fold.panic` ficou registrado no boot anterior
   * (§8.5, §10.5), ou quando o snapshot está **ausente ou inconsistente** — que §10.6 define
   * como `ds_snapshot.interpreted_seq` ≠ `meta.interpreted_seq:<communityId>`, o marcador
   * gravado a cada lote commitado. Sem a igualdade o crash aconteceu entre duas cadências de
   * snapshot e o boot reaplicaria efeitos já materializados; recomeça-se do `seq` 0.
   *
   * O ramo do schema é o passo seguinte ao `DROP`/recria global que o boot já fez (§10.5
   * passo 2): aqui só se folda do zero, no escopo desta comunidade. Comunidade recém-aberta
   * — criada, resgatada por convite ou descoberta — cai no ramo do snapshot ausente, e é por
   * isso que ele **não** pode limpar `view.db` inteira.
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
   * Reprojeção (§10.5): apaga **o que é desta comunidade** em `view.db` e refaz o `fold` do
   * `seq` 0. Quem compõe o boot chama este método por comunidade; o módulo não conhece
   * `manifest` (§4).
   *
   * O `DROP`/recria do passo 2 de §10.5 é **global** — um `view.db` serve todas as
   * comunidades (§10.1) — e por isso saiu daqui: este método roda por comunidade (no
   * `boot()` de cada uma, em `core.reproject` e em toda comunidade aberta depois do boot),
   * e o `wipe()` que estava nesta linha apagava o estado projetado de TODAS as outras, que
   * ninguém refazia porque o `#run` abaixo só folda o log DESTA. Hospedar uma comunidade e
   * entrar noutra esvaziava a primeira — canais, categorias, mensagens, roster —, e
   * reiniciar reproduzia o defeito no laço do boot, uma comunidade derrubando a anterior.
   * O recorte certo é `purgeCommunityData` (§18.4 passo 6): a mesma limpeza, no escopo desta
   * comunidade. A recriação do schema no bump de `view_schema_version` é do boot, uma vez
   * (§3.3), antes de abrir a primeira comunidade.
   */
  async reproject(): Promise<void> {
    this.#view.purgeCommunityData(this.#communityId);
    this.#writeOpVersion();
    this.#ds = emptyState(this.#core.key, this.#communityId);
    this.#lastSnapshotSeq = -1;
    await this.#run({ reprojecting: true });
  }

  /**
   * §10.3.1 — `meta.op_version`: a versão de protocolo que materializou esta `view.db`. O
   * `wipe` do bump de schema — que hoje é do boot, não da reprojeção — derruba `meta` junto
   * com o resto e o `view` (L0) repõe só a versão de schema; a de protocolo mora em
   * `opCodec` (L1) e por isso é escrita aqui, pelo único escritor de `view.db` (§21.1).
   * Escrever de novo o mesmo valor é barato e idempotente.
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
          if (res.decision === 'APPLIED') this.#recordObserved(seq, res);
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
      // O `DS` em memória avança **junto com o commit**, e antes da emissão. É a mesma
      // invariante que o caminho do bloco ausente já respeita (`this.#ds = ds` no `return`
      // acima): depois de um commit, memória e `view.db` estão no mesmo prefixo. Quem
      // observa o lote — o fan-out de §15.5 e, por ele, o transporte em §14.3(3) — precisa
      // ver o estado que o lote produziu, não o anterior.
      this.#ds = ds;

      // §10.7 — emissão de eventos **sempre depois** do commit. Evento é sinal, nunca fonte.
      //
      // §11.6 regra 2 / `DS-31` — a ordem `messages.appended` → `message.accepted` cai daqui:
      // o commit que grava `observed_ops` e esta emissão estão no MESMO passo síncrono, e a
      // reconciliação (§11.6), que é quem emite `message.accepted`, só pode rodar em um passo
      // posterior. Nenhuma reconciliação enxerga a op antes do evento do lote que a projetou.
      if (events.length > 0) this.#opts.onEvent(coalesceBatch(events));
      if (opts.reprojecting && total >= this.#opts.reprojectProgressSeq) {
        this.#opts.onEvent([
          { topic: 'core.reprojecting', data: { communityId: this.#communityId, done: ds.interpretedSeq + 1, total } },
        ]);
      }
    }
    this.#ds = ds;
  }

  /** §11.6 — a reconciliação só pode observar operações `APPLIED`, nunca o watermark. */
  #recordObserved(seq: number, res: FoldResult): void {
    if (res.opId === undefined || res.author === undefined || res.authorSeq === undefined || res.sequenceScope === undefined) {
      throw new Error('FoldResult APPLIED sem metadados de observação');
    }
    const scope = res.sequenceScope.kind === 'community' ? 'community' : `channel:${res.sequenceScope.channelId}`;
    this.#view
      .prepare(
        'INSERT OR REPLACE INTO observed_ops(community_id, op_id, seq, author_key, sequence_scope, author_seq) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(this.#communityId, res.opId, seq, res.author, scope, res.authorSeq);
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
