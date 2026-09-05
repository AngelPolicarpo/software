// `dmProjector` — L1→L0. §31.12 (persistência), §31.13 (reinterpretação), §31.16.2 (eventos),
// e §10.5/§10.6/§10.7/§21.1 sem emenda.
//
// **É irmão do `projector` de §10.5, não extensão dele (§31.0).** Aquele projeta sobre `seq`
// e um core; este projeta sobre `ordSum` e **dois** cores. Aquele mantém `observed_ops` (a
// reconciliação da outbox, §11.6), `recount`, `patchScope` e FTS5; aqui não existe nenhum dos
// quatro — §31.7.6 fecha o tipo de efeito em quatro formas e §31.12 declara "sem FTS para DM
// no v1". O catálogo de eventos é outro (§31.16.2). Reusar o arquivo, e não o desenho, é o
// erro que §31.0 existe para impedir.
//
// Algoritmo, por conversa:
//
//   1. Carrega o `DmState` do snapshot (§31.12) — `fold_build_id` válido — ou vazio.
//   2. Intercala os dois logs na ordem canônica de §31.6, **em fluxo**: o próximo registro é
//      o de menor `ordKey` entre as duas cabeças não interpretadas. É o mesmo merge de dois
//      ponteiros de `dmFold/order.ts`, sem materializar a ordem inteira.
//   3. Para cada registro: `dmFoldRecord(state, rec, origin, index, ctx)`.
//   4. **Uma transação `view.db` por lote**: aplica os `DmEffect` **na ordem**, grava
//      `dm_rejected_records`, materializa `length`/`invalid` de cada lado, escreve
//      `meta.dm_interpreted` e, na cadência, o snapshot.
//   5. Commit. **Depois do commit**, emite os `notify` como eventos (§10.7).
//   6. Repete até as duas cabeças; depois reage a `append` dos dois cores.
//
// **Ele não decide nada e não decodifica registro** (§4). O `kind` que `dm_rejected_records`
// pede chega pelo `DmFoldResult` (§31.7.1), inclusive no caminho de pânico. A ordem de §31.6
// é sua responsabilidade declarada, e ele a computa pelas funções do `dmFold` (`acksOf`,
// `clampAck`, `ordSumOf`, `compareOrdKey`) — o cabeçalho em claro de §31.4 existe exatamente
// para que a ordem seja computável sem abrir a AEAD.
//
// Não emite evento IPC **direto**: os `notify` saem pelo `onEvent` injetado, sempre depois do
// commit — evento é sinal, nunca fonte (§10.7). A barreira `view.db` → `manifest.db` →
// eventos de §10.5 se completa em quem compõe o boot: §4 **não** dá `manifest` ao
// `dmProjector`, e é por isso que `dm_local_read_state` (§31.12) e `dm.unreadChanged` não
// saem daqui.
//
// §21.3 — nunca reentrante: um lote por conversa por vez, garantido por flag; um `append`
// durante um lote entra no lote seguinte.

import type { CoreHandle } from '../../l0/corestore/index.ts';
import type { DmInterpretedMarker, ViewDb } from '../../l0/view/index.ts';
import {
  acksOf,
  clampAck,
  compareOrdKey,
  dmFoldRecord,
  limparPanico,
  newDmMetrics,
  ordSumOf,
  DM_ORIGINS,
  type DmContext,
  type DmFoldMetrics,
  type DmFoldResult,
  type DmOrdRef,
  type DmOrigin,
  type DmRawRecord,
  type DmState,
} from '../dmFold/index.ts';
import { emptyDmState } from '../dmFold/index.ts';

import { applyDmEffect, newDmStmtCache, type DmStmtCache } from './apply.ts';
import { DM_PROJECTOR_BATCH, DM_REJECTED_LOG_MAX, DM_SNAPSHOT_INTERVAL } from './constants.ts';
import {
  deleteDmSnapshot,
  loadDmSnapshot,
  saveDmSnapshot,
  writeDmRows,
} from './snapshot.ts';

/** Evento de §31.16.2 — `conversationId` sempre presente, garantido pelo projetor. */
export type DmProjectedEvent = {
  readonly topic: string;
  readonly data: Readonly<Record<string, unknown>>;
};

/**
 * §31.16.2 — o evento é do **lote projetado**, não do registro, pela mesma razão de §15.5: um
 * lote de 256 registros da mesma conversa não pode virar 256 eventos. A chave de agregação é
 * o alvo que o próprio payload nomeia; agregar não perde estado, porque evento é sinal para
 * reconsultar (§15.1 regra 5).
 *
 * `dm.appended` é o caso que §31.16.2 declara agregado por construção: o payload é
 * `{fromOrdSum, toOrdSum, hasIncoming}`, uma **faixa**, e nenhum `dmFold` que vê um registro
 * por vez pode produzi-la.
 */
const DM_MERGE_KEY: Readonly<Record<string, readonly string[]>> = {
  'dm.appended': [],
  'dm.messageUpdated': ['messageId'],
  'dm.conversationChanged': [],
  'dm.partialInterpretation': [],
};

function bucketOf(ev: DmProjectedEvent): string | null {
  const keys = DM_MERGE_KEY[ev.topic];
  if (keys === undefined) return null;
  return [ev.topic, ...keys.map((k) => String(ev.data[k] ?? ''))].join(' ');
}

function mergeData(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    if (k === 'fromOrdSum' && typeof prev === 'number' && typeof v === 'number') out[k] = Math.min(prev, v);
    else if (k === 'toOrdSum' && typeof prev === 'number' && typeof v === 'number') out[k] = Math.max(prev, v);
    else if (typeof prev === 'boolean' && typeof v === 'boolean') out[k] = prev || v;
    else if (Array.isArray(prev) && Array.isArray(v)) out[k] = [...new Set([...prev, ...v])];
    else out[k] = v;
  }
  return out;
}

/** Agrega os `notify` de um lote, preservando a ordem de estreia de cada alvo. */
export function coalesceDmBatch(events: readonly DmProjectedEvent[]): DmProjectedEvent[] {
  const slots: Array<{ topic: string; data: Record<string, unknown> }> = [];
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

export type DmProjectorOptions = {
  /** Registros por transação de projeção. Default 256. */
  readonly batch?: number;
  /** Registros interpretados entre snapshots (§31.12). Default 1 000 — ver `constants.ts`. */
  readonly snapshotInterval?: number;
  /** Teto de linhas de `dm_rejected_records` por conversa (§31.12). Default 2 000. */
  readonly rejectedLogMax?: number;
  /** §10.6 — hash do binário do `dmFold`, calculado por quem compõe o boot. */
  readonly foldBuildId: string;
  /**
   * §31.16.2 — qual dos dois lados é o desta instalação. É fato **local**: o `dmFold` não o
   * conhece de propósito (§31.1 — os dois lados são simétricos, e a interpretação tem de dar
   * o mesmo resultado nos dois), e sem ele não há como dizer se um lote projetado trouxe
   * mensagem **entrante**. Default `'lo'` só para o cabo de teste que projeta um lado só.
   */
  readonly meuLado?: DmOrigin;
  /** Relógio injetável — só `taken_at` do snapshot (§10.6). */
  readonly now?: () => number;
  /** O `dmFold` de §31.7. Injetável para o ensaio da rede de segurança de §31.7.1. */
  readonly fold?: typeof dmFoldRecord;
  /** §31.16.2 — os eventos do lote, **depois** do commit. Sem isto, nada é emitido. */
  readonly onEvent?: (events: readonly DmProjectedEvent[]) => void;
  /**
   * §31.7.1 — `dmFold.panic{ordSum, kind}`. Métrica de bug, nunca fluxo de controle. O `kind`
   * vem do `DmFoldResult` e é `null` quando a exceção veio antes do decode do cabeçalho.
   */
  readonly onPanic?: (ordSum: number, kind: number | null) => void;
};

/** Os dois cores da conversa. `null` enquanto aquele lado não existir (§31.9, `pending-in`). */
export type DmCores = Readonly<Record<DmOrigin, CoreHandle | null>>;

type Lote = { readonly ref: DmOrdRef; readonly res: DmFoldResult };

export class DmProjector {
  readonly #view: ViewDb;
  readonly #cores: DmCores;
  readonly #ctx: DmContext;
  readonly #conversationId: string;
  readonly #opts: Required<DmProjectorOptions>;
  readonly #stmt: DmStmtCache = newDmStmtCache();
  readonly metrics: DmFoldMetrics = newDmMetrics();
  #state: DmState;
  /** Registros interpretados desde o último snapshot gravado (§10.6, cadência). */
  #sinceSnapshot = 0;
  /** §21.3 — um lote por conversa por vez. */
  #inFlight: Promise<void> | null = null;
  #off: Array<() => void> = [];

  constructor(view: ViewDb, cores: DmCores, ctx: DmContext, opts: DmProjectorOptions) {
    this.#view = view;
    this.#cores = cores;
    this.#ctx = ctx;
    this.#conversationId = ctx.conversationId;
    this.#state = emptyDmState(ctx.conversationKey, ctx.loKey, ctx.hiKey, ctx.conversationId);
    this.#opts = {
      batch: opts.batch ?? DM_PROJECTOR_BATCH,
      snapshotInterval: opts.snapshotInterval ?? DM_SNAPSHOT_INTERVAL,
      rejectedLogMax: opts.rejectedLogMax ?? DM_REJECTED_LOG_MAX,
      foldBuildId: opts.foldBuildId,
      meuLado: opts.meuLado ?? 'lo',
      now: opts.now ?? Date.now,
      fold: opts.fold ?? dmFoldRecord,
      onEvent: opts.onEvent ?? (() => {}),
      onPanic: opts.onPanic ?? (() => {}),
    };
  }

  get state(): DmState {
    return this.#state;
  }

  get interpretedOrdSum(): number {
    return this.#state.interpretedOrdSum;
  }

  /**
   * §19.2 (boot), na leitura de §31.12. Reprojeta quando o schema de `view.db` mudou, quando
   * um `dmFold.panic` ficou registrado no boot anterior (§31.7.1) ou quando o snapshot está
   * **ausente ou inconsistente** — que aqui é `dm_ds_snapshot` ≠ `meta.dm_interpreted`, nas
   * três coordenadas: sem a igualdade o crash aconteceu entre duas cadências de snapshot e o
   * boot reaplicaria efeitos já materializados.
   */
  async boot(): Promise<void> {
    limparPanico();
    if (
      this.#view.schemaVersionMismatch() ||
      this.#view.dmFoldPanicOrdSum(this.#conversationId) !== null
    ) {
      await this.reproject();
      return;
    }
    const snap = loadDmSnapshot(this.#view, this.#conversationId, this.#opts.foldBuildId);
    const marker = this.#view.dmInterpretedMarker(this.#conversationId);
    if (
      snap !== null &&
      marker !== null &&
      marker.ordSum === snap.interpretedOrdSum &&
      marker.loLength === snap.lengths.lo &&
      marker.hiLength === snap.lengths.hi
    ) {
      this.#state = snap.state;
      this.#sinceSnapshot = 0;
      await this.catchUp();
      return;
    }
    await this.reproject();
  }

  /** §10.5 passo 6 — passa a reagir a `append` dos **dois** cores. */
  start(): void {
    if (this.#off.length > 0) return;
    for (const o of DM_ORIGINS) {
      const core = this.#cores[o];
      if (core !== null) this.#off.push(core.onAppend(() => void this.catchUp()));
    }
  }

  stop(): void {
    for (const off of this.#off) off();
    this.#off = [];
  }

  /** Interpreta até as duas cabeças. Idempotente e não reentrante. */
  async catchUp(): Promise<void> {
    for (;;) {
      const inFlight = this.#inFlight;
      if (inFlight === null) break;
      await inFlight; // §21.3 — nunca reentrante; o append entrou no lote seguinte
    }
    const before = this.#heads();
    const run = this.#run();
    this.#inFlight = run;
    try {
      await run;
    } finally {
      this.#inFlight = null;
    }
    const after = this.#heads();
    if (after.lo > before.lo || after.hi > before.hi) await this.catchUp();
  }

  /**
   * Reprojeção desta conversa: apaga o que é dela em `view.db` e refaz do começo dos dois
   * logs. O `DROP`/recria do bump de schema é do boot e é global (§10.5 passo 2); aqui o
   * recorte é a conversa, pela mesma razão que fez o `projector` deixar de chamar `wipe()`.
   */
  async reproject(): Promise<void> {
    this.#view.purgeConversationData(this.#conversationId);
    this.#state = emptyDmState(
      this.#ctx.conversationKey,
      this.#ctx.loKey,
      this.#ctx.hiKey,
      this.#ctx.conversationId,
    );
    this.#sinceSnapshot = 0;
    await this.#run();
  }

  /** §10.6 — grava o snapshot fora da cadência. Cache, nunca verdade. */
  snapshot(at?: number): void {
    this.#view.transaction(() => {
      saveDmSnapshot(
        this.#view,
        this.#conversationId,
        this.#state,
        this.#opts.foldBuildId,
        at ?? this.#opts.now(),
      );
    });
    this.#sinceSnapshot = 0;
  }

  // ─── A ordem canônica de §31.6, em fluxo ─────────────────────────────────────────────

  #heads(): Record<DmOrigin, number> {
    return { lo: this.#cores.lo?.length ?? 0, hi: this.#cores.hi?.length ?? 0 };
  }

  /**
   * A posição do **último** registro interpretado de um lado, na ordem canônica. `lastAck` é,
   * por construção do estágio final de §31.7.3, o `ack` já clampado do registro de índice
   * `length − 1` — então o `ordKey` daquele registro é computável sem relê-lo.
   */
  #lastRefOf(state: DmState, o: DmOrigin): DmOrdRef | null {
    const side = state.sides[o];
    if (side.length === 0) return null;
    return { origin: o, index: side.length - 1, ordSum: ordSumOf(side.length - 1, side.lastAck) };
  }

  /** O maior `ordKey` já interpretado — a fronteira contra a qual §31.13 mede o retroativo. */
  #lastRef(state: DmState): DmOrdRef | null {
    let max: DmOrdRef | null = null;
    for (const o of DM_ORIGINS) {
      const r = this.#lastRefOf(state, o);
      if (r !== null && (max === null || compareOrdKey(r, max) > 0)) max = r;
    }
    return max;
  }

  /**
   * A cabeça não interpretada de um lado: o registro de índice `sides[o].length`, com o
   * `ordSum` que ele terá. `null` quando o lado acabou ou quando o bloco ainda não replicou.
   *
   * Só o cabeçalho em claro é lido, pela função do `dmFold` (§31.4, §31.6): o projetor não
   * decodifica registro (§4).
   */
  async #nextRef(state: DmState, o: DmOrigin): Promise<{ ref: DmOrdRef; rec: DmRawRecord } | null> {
    const core = this.#cores[o];
    if (core === null) return null;
    const index = state.sides[o].length;
    if (index >= core.length) return null;
    const rec = await core.get(index);
    if (rec === null) return null; // bloco ainda não replicado (§10.5 passo 6)
    const ack = clampAck(acksOf([rec])[0] ?? null, state.sides[o].lastAck);
    return { ref: { origin: o, index, ordSum: ordSumOf(index, ack) }, rec };
  }

  /**
   * O próximo registro na ordem canônica: o de menor `ordKey` entre as duas cabeças. É o
   * merge de dois ponteiros de §31.6, e a razão de ele ser um merge — e não uma ordenação —
   * é RD-4: `ordSum` é estritamente crescente dentro de cada log.
   *
   * **Um lado com bloco ainda não replicado** (§10.5 passo 6). Ele não para tudo por
   * princípio: RD-4 dá um **piso** para o `ordKey` daquele bloco sem lê-lo — `ack` é não
   * decrescente, então o registro de índice `i` tem `ordSum ≥ i + 1 + lastAck`. Se a cabeça
   * do outro lado precede esse piso, ela pode passar: nenhum bloco que chegue depois poderá
   * se inserir antes dela. Se não precede, o lote para e espera o `append` — consumir agora
   * criaria uma inserção retroativa evitável, e §31.13 é cara.
   */
  async #next(state: DmState): Promise<{ ref: DmOrdRef; rec: DmRawRecord } | null> {
    const cabecas: Array<{ ref: DmOrdRef; rec: DmRawRecord }> = [];
    const barreiras: DmOrdRef[] = [];
    for (const o of DM_ORIGINS) {
      const h = await this.#nextRef(state, o);
      if (h !== null) {
        cabecas.push(h);
        continue;
      }
      const core = this.#cores[o];
      const index = state.sides[o].length;
      // O piso de RD-4: o bloco que falta não pode ter `ordSum` menor que este.
      if (core !== null && index < core.length) {
        barreiras.push({ origin: o, index, ordSum: ordSumOf(index, state.sides[o].lastAck) });
      }
    }
    if (cabecas.length === 0) return null;
    const menor = cabecas.reduce((a, b) => (compareOrdKey(a.ref, b.ref) <= 0 ? a : b));
    for (const b of barreiras) {
      if (compareOrdKey(menor.ref, b) >= 0) return null;
    }
    return menor;
  }

  // ─── §31.13 — reinterpretação por inserção retroativa ────────────────────────────────

  /**
   * Devolve o `ordSum` do ponto de inserção quando alguma cabeça não interpretada precede,
   * por `ordKey`, o último registro já interpretado. Comparar `ordSum` não bastaria: dois
   * registros podem empatar em `ordSum` e o desempate é a chave do autor (§31.6), então um
   * registro de `lo` com o mesmo `ordSum` do último registro de `hi` **é** retroativo.
   */
  async #pontoDeInsercao(state: DmState): Promise<DmOrdRef | null> {
    const ultimo = this.#lastRef(state);
    if (ultimo === null) return null;
    let menor: DmOrdRef | null = null;
    for (const o of DM_ORIGINS) {
      const h = await this.#nextRef(state, o);
      if (h === null) continue;
      if (compareOrdKey(h.ref, ultimo) >= 0) continue;
      if (menor === null || compareOrdKey(h.ref, menor) < 0) menor = h.ref;
    }
    return menor;
  }

  /**
   * §31.13, passos 1 e 2. §31.12 dá **uma** linha de `dm_ds_snapshot` por conversa
   * (`conversation_id` é a PK inteira), então "descartar os snapshots acima do ponto e
   * recarregar o mais recente anterior ou igual" tem aqui exatamente dois desfechos: o único
   * snapshot ainda é prefixo válido da ordem canônica, e é recarregado; ou não é, e é
   * descartado e a reinterpretação parte do zero.
   *
   * **O que "prefixo válido" quer dizer, sem ambiguidade de empate.** O snapshot contém
   * `lo[0..loLength)` e `hi[0..hiLength)`. Ele é prefixo da ordem canônica nova se o maior
   * `ordKey` de dentro precede o menor `ordKey` de fora. Os dois são computáveis sem reler o
   * prefixo: o de dentro sai de `lastAck` de cada lado no próprio blob, o de fora é a cabeça
   * de cada lado. É isto que implementa o "anterior **ou igual**" de §31.13 sem cair na
   * armadilha do empate de `ordSum`, em que "igual" seria errado.
   */
  async #reinterpretar(ponto: DmOrdRef): Promise<void> {
    const snap = loadDmSnapshot(this.#view, this.#conversationId, this.#opts.foldBuildId);
    let base: DmState | null = null;
    if (snap !== null) {
      const dentro = this.#lastRef(snap.state);
      let fora: DmOrdRef | null = null;
      for (const o of DM_ORIGINS) {
        const h = await this.#nextRef(snap.state, o);
        if (h !== null && (fora === null || compareOrdKey(h.ref, fora) < 0)) fora = h.ref;
      }
      if (dentro === null || fora === null || compareOrdKey(dentro, fora) < 0) base = snap.state;
    }

    this.#view.transaction(() => {
      this.#view.purgeConversationData(this.#conversationId);
      if (base !== null && snap !== null) {
        writeDmRows(this.#view, this.#conversationId, snap.rows);
        saveDmSnapshot(
          this.#view,
          this.#conversationId,
          base,
          this.#opts.foldBuildId,
          this.#opts.now(),
        );
        this.#view.setDmInterpretedMarker(this.#conversationId, {
          ordSum: base.interpretedOrdSum,
          loLength: base.sides.lo.length,
          hiLength: base.sides.hi.length,
        });
      } else {
        deleteDmSnapshot(this.#view, this.#conversationId);
      }
    });

    this.#state =
      base ??
      emptyDmState(
        this.#ctx.conversationKey,
        this.#ctx.loKey,
        this.#ctx.hiKey,
        this.#ctx.conversationId,
      );
    this.#sinceSnapshot = 0;
    // §31.13 passo 3 — reinterpreta dali até as duas cabeças, em lotes.
    await this.#run();
    // §31.13 passo 4 — **depois do commit**. A UI é obrigada a recarregar a partir daqui;
    // sem este evento ela mostraria uma história que não é mais a corrente (§31.16.2).
    this.#opts.onEvent([
      { topic: 'dm.reordered', data: { conversationId: this.#conversationId, fromOrdSum: ponto.ordSum } },
    ]);
  }

  // ─── O laço de lotes ────────────────────────────────────────────────────────────────

  async #run(): Promise<void> {
    // §31.13 — a inserção retroativa é decidida ANTES de interpretar qualquer coisa: se a
    // cabeça de um lado precede o que já foi interpretado, o que vem é reinterpretação, não
    // continuação. `#reinterpretar` chama `#run` de volta já com o estado reposicionado.
    const ponto = await this.#pontoDeInsercao(this.#state);
    if (ponto !== null) {
      await this.#reinterpretar(ponto);
      return;
    }

    for (;;) {
      const lote: Lote[] = [];
      let panicOrdSum: number | null = null;
      // `working` avança registro a registro; `#state` só avança **depois** do commit —
      // é o que mantém memória e `view.db` no mesmo prefixo quando o lote não completa.
      let working = this.#state;

      while (lote.length < this.#opts.batch) {
        const proximo = await this.#next(working);
        if (proximo === null) break;
        const { ref, rec } = proximo;
        const panicBefore = this.metrics.panic;
        let res: DmFoldResult;
        try {
          res = this.#opts.fold(working, rec, ref.origin, ref.index, this.#ctx, this.metrics);
        } catch {
          // §31.7.1 — rede de segurança: nunca deve acontecer com o `dmFold` real (total). Um
          // bug nunca vira perda de conversa: o registro é `IGNORED` e a interpretação segue.
          this.metrics.panic++;
          this.metrics.ignored++;
          panicOrdSum = ref.ordSum;
          this.#opts.onPanic(ref.ordSum, null);
          const side = working.sides[ref.origin];
          res = {
            decision: 'IGNORED',
            reason: 'E_MALFORMED',
            ordSum: ref.ordSum,
            effects: [],
            next: {
              ...working,
              interpretedOrdSum: ref.ordSum,
              sides: {
                ...working.sides,
                [ref.origin]: { ...side, length: Math.max(side.length, ref.index + 1) },
              },
            },
          };
        }
        if (panicOrdSum === null && this.metrics.panic > panicBefore) {
          // O `dmFoldRecord` real captura por dentro (§31.7.1): o pânico aparece como métrica,
          // e o `kind` do `DmFoldResult` é a única fonte possível para `dmFold.panic`.
          panicOrdSum = res.ordSum;
          this.#opts.onPanic(res.ordSum, res.kind ?? null);
        }
        working = res.next;
        lote.push({ ref, res });
      }

      if (lote.length === 0) {
        this.#state = working;
        return;
      }

      // §10.5 passo 4 / §31.12 — UMA transação por lote.
      const eventos: DmProjectedEvent[] = [];
      /** O estado com que o lote começou — a base de comparação de `dm.partialInterpretation`. */
      const antes = this.#state;
      this.#view.transaction(() => {
        for (const { ref, res } of lote) {
          for (const eff of res.effects) {
            if (eff.t === 'notify') {
              // §31.16.2 — `hasIncoming` é do **lote**, e o `dmFold` não pode produzi-lo: ele
              // não sabe qual lado é o próprio. Quem sabe é este projetor, e o que ele usa é
              // o `origin` do registro que gerou o efeito. O `coalesceDmBatch` faz o OU
              // booleano da faixa, e é por isso que o campo tem de ser booleano **aqui**, e
              // não uma chave de autor que a agregação sobrescreveria pela última.
              const extra =
                eff.topic === 'dm.appended' ? { hasIncoming: ref.origin !== this.#opts.meuLado } : {};
              eventos.push({
                topic: eff.topic,
                data: { conversationId: this.#conversationId, ...eff.data, ...extra },
              });
              continue;
            }
            applyDmEffect(this.#view, this.#stmt, this.#conversationId, eff);
          }
          if (res.decision !== 'APPLIED') this.#recordRejected(ref, res);
        }
        // §31.16.2 — `dm.partialInterpretation`, **por lote**, e do projetor pela mesma razão
        // que `hasIncoming`: o registro que liga a marca é `IGNORED` no estágio 1, e §31.7.3
        // dá a emissão de efeitos ao estágio 12. O que se observa aqui é a lista de §31.7.2
        // ter crescido — um lote com N registros do mesmo `kind` desconhecido é uma
        // degradação, não N eventos.
        if (
          working.unknownKinds.length > antes.unknownKinds.length ||
          working.unknownVersions.length > antes.unknownVersions.length
        ) {
          eventos.push({
            topic: 'dm.partialInterpretation',
            data: {
              conversationId: this.#conversationId,
              unknownKinds: [...working.unknownKinds],
              unknownVersions: [...working.unknownVersions],
            },
          });
        }
        // `length` e `invalid` são estado de LADO (§31.7.2) e nenhum `DmEffect` os carrega:
        // §31.7.6 fecha o tipo em quatro formas, e nenhuma delas fala do lado. Materializá-los
        // do `DmState` ao fim do lote **não é decidir** — é a mesma tradução mecânica do resto
        // do arquivo, e o valor final é função do prefixo interpretado, igual com e sem
        // snapshot, que é o que o oráculo de equivalência exige.
        this.#writeSides(working);
        if (panicOrdSum !== null) this.#view.setDmFoldPanicOrdSum(this.#conversationId, panicOrdSum);
        const marker: DmInterpretedMarker = {
          ordSum: working.interpretedOrdSum,
          loLength: working.sides.lo.length,
          hiLength: working.sides.hi.length,
        };
        this.#view.setDmInterpretedMarker(this.#conversationId, marker);
        this.#sinceSnapshot += lote.length;
        if (this.#sinceSnapshot >= this.#opts.snapshotInterval) {
          saveDmSnapshot(
            this.#view,
            this.#conversationId,
            working,
            this.#opts.foldBuildId,
            this.#opts.now(),
          );
          this.#sinceSnapshot = 0;
        }
      });
      // O estado em memória avança **junto com o commit**, e antes da emissão: depois de um
      // commit, memória e `view.db` estão no mesmo prefixo.
      this.#state = working;

      // §10.7 — emissão **sempre depois** do commit. Evento é sinal, nunca fonte.
      if (eventos.length > 0) this.#opts.onEvent(coalesceDmBatch(eventos));
    }
  }

  /** §31.12 — `dm_participants.length`/`invalid`, os dois campos que o `dmFold` não projeta. */
  #writeSides(state: DmState): void {
    for (const o of DM_ORIGINS) {
      const side = state.sides[o];
      // Lado sem registro nenhum não tem linha: uma conversa `pending-in` mostra só quem
      // escreveu, e uma linha vazia seria participante inventado.
      if (side.length === 0) continue;
      this.#view
        .prepare(
          'INSERT INTO dm_participants(conversation_id, identity_key, display_name, avatar_color, core_key, length, invalid) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(conversation_id, identity_key) DO UPDATE SET ' +
            'length = excluded.length, invalid = excluded.invalid',
        )
        .run(
          this.#conversationId,
          side.identityKey,
          side.displayName,
          side.avatarColor,
          side.coreKey ?? null,
          side.length,
          side.invalid ? 1 : 0,
        );
    }
  }

  /**
   * §31.12 — `dm_rejected_records`, só para diagnóstico, podado acima de `REJECTED_LOG_MAX`.
   *
   * **Entram `REJECTED` e `IGNORED`, e a diferença com §10.3 é deliberada.** Lá a tabela é
   * escrita só na recusa, e o texto normativo fecha a questão dizendo que `kind` é `NULL`
   * "só na recusa do estágio 0". §31.12 **removeu** essa metade da frase e ficou com "`kind`
   * é `NULL` exatamente quando o cabeçalho não decodificou" — e no `dmFold` o envelope que
   * não decodifica é `IGNORED` no estágio 1 (§31.7.3), não `REJECTED`. Uma tabela só de
   * recusas seria cega exatamente para o caso que a frase nomeia, e a conversa direta não tem
   * outro registro durável de um bloco ilegível vindo do par.
   *
   * O `kind` vem do `DmFoldResult` (§31.7.1), inclusive no caminho de pânico: o projetor não
   * decodifica registro (§4).
   */
  #recordRejected(ref: DmOrdRef, res: DmFoldResult): void {
    this.#view
      .prepare(
        'INSERT OR REPLACE INTO dm_rejected_records(conversation_id, origin, idx, kind, reason) VALUES (?, ?, ?, ?, ?)',
      )
      .run(this.#conversationId, ref.origin, ref.index, res.kind ?? null, res.reason ?? 'E_MALFORMED');
    this.#view
      .prepare(
        'DELETE FROM dm_rejected_records WHERE conversation_id = ? AND rowid NOT IN ' +
          '(SELECT rowid FROM dm_rejected_records WHERE conversation_id = ? ORDER BY idx DESC LIMIT ?)',
      )
      .run(this.#conversationId, this.#conversationId, this.#opts.rejectedLogMax);
  }
}

export {
  DM_PROJECTOR_BATCH,
  DM_REJECTED_LOG_MAX,
  DM_SNAPSHOT_INTERVAL,
} from './constants.ts';
export { applyDmEffect, DM_SQL_EFFECT_FORMS } from './apply.ts';
export {
  deserializeDmState,
  loadDmSnapshot,
  readDmRows,
  saveDmSnapshot,
  serializeDmState,
  writeDmRows,
  type DmRows,
  type DmSnapshot,
} from './snapshot.ts';
