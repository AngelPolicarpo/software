// Projetor **descartável** de conversa direta — §31.12 e a reinterpretação de §31.13.
//
// **Isto não é produto e não pode virar produto.** O `dmProjector`, a tabela
// `dm_ds_snapshot`, o `self_high_water` de `manifest.db` e o caminho de append são B56 e
// B57, e os dois estão bloqueados por este gate; construí-los como código de produto antes
// do veredito inverteria a ordem que §31.26 fixa. O que existe aqui é o mínimo para que os
// cenários 2, 4 e 5 tenham o que medir: aplicar `DmEffect` numa tabela, guardar snapshot por
// `ord_sum` com `fold_build_id` e refazer a interpretação a partir dele.
//
// O que ele copia da spec, porque é o que o cenário 2 mede:
//
//  1. descarta os snapshots com `interpreted_ord_sum` maior que o ponto de inserção;
//  2. recarrega o mais recente **anterior ou igual** — ou recomeça do zero se não houver;
//  3. reinterpreta dali até as duas cabeças;
//  4. emite `dm.reordered{fromOrdSum}` **depois** do commit.

import {
  dmFoldRecord,
  emptyDmState,
  mergeRecords,
  type DmContext,
  type DmEffect,
  type DmFoldMetrics,
  type DmFoldResult,
  type DmOrdRef,
  type DmOrigin,
  type DmPrimitive,
  type DmState,
} from './core.js';

export type Linha = Record<string, DmPrimitive>;
/** tabela → chave serializada → linha. */
export type Tabelas = Map<string, Map<string, Linha>>;

export type Evento = { topic: string; data: object };

export type Snapshot = {
  readonly interpretedOrdSum: number;
  readonly loLength: number;
  readonly hiLength: number;
  /** `blob BLOB` de `dm_ds_snapshot` — bytes de verdade, não um clone de objeto. */
  readonly blob: Buffer;
  readonly foldBuildId: string;
  readonly takenAt: number;
};

export type CustoReinterpretacao = {
  /** `ordSum` a partir do qual a história mudou. */
  readonly fromOrdSum: number;
  readonly partiuDe: 'snapshot' | 'zero';
  readonly registrosReinterpretados: number;
  readonly snapshotsDescartados: number;
  readonly ms: number;
};

function chave(k: readonly DmPrimitive[]): string {
  return JSON.stringify(k.map((v) => (Buffer.isBuffer(v) ? `b:${v.toString('hex')}` : v)));
}

function tabela(t: Tabelas, nome: string): Map<string, Linha> {
  let m = t.get(nome);
  if (m === undefined) {
    m = new Map();
    t.set(nome, m);
  }
  return m;
}

export function aplicarEfeitos(t: Tabelas, efeitos: readonly DmEffect[], eventos: Evento[]): void {
  for (const e of efeitos) {
    if (e.t === 'notify') {
      eventos.push({ topic: e.topic, data: e.data });
      continue;
    }
    const m = tabela(t, e.table);
    const k = chave(e.key);
    if (e.t === 'upsert') m.set(k, { ...e.row });
    else if (e.t === 'patch') m.set(k, { ...(m.get(k) ?? {}), ...e.fields });
    else m.delete(k);
  }
}

// ─── `dm_ds_snapshot.blob` — serialização de verdade ────────────────────────────────────

type SideJson = {
  identityKey: string;
  coreKey: string | null;
  displayName: string;
  avatarColor: number;
  length: number;
  lastAuthorSeq: number;
  lastAck: number;
  lastTs: number;
  invalid: boolean;
  blobsCoreKey: string | null;
  tsWindow: number[];
  tsWindowBase: number;
};

function serializarLado(x: DmState['sides']['lo']): SideJson {
  return {
    identityKey: x.identityKey.toString('hex'),
    coreKey: x.coreKey?.toString('hex') ?? null,
    displayName: x.displayName,
    avatarColor: x.avatarColor,
    length: x.length,
    lastAuthorSeq: x.lastAuthorSeq,
    lastAck: x.lastAck,
    lastTs: x.lastTs,
    invalid: x.invalid,
    blobsCoreKey: x.blobsCoreKey?.toString('hex') ?? null,
    tsWindow: [...x.tsWindow],
    tsWindowBase: x.tsWindowBase,
  };
}

function desserializarLado(j: SideJson): DmState['sides']['lo'] {
  const s: DmState['sides']['lo'] = {
    identityKey: Buffer.from(j.identityKey, 'hex'),
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
  if (j.coreKey !== null) s.coreKey = Buffer.from(j.coreKey, 'hex');
  if (j.blobsCoreKey !== null) s.blobsCoreKey = Buffer.from(j.blobsCoreKey, 'hex');
  return s;
}

function serializarPrimitivo(v: DmPrimitive): unknown {
  return Buffer.isBuffer(v) ? { b: v.toString('hex') } : v;
}

function desserializarPrimitivo(v: unknown): DmPrimitive {
  if (v !== null && typeof v === 'object' && 'b' in (v as Record<string, unknown>)) {
    return Buffer.from(String((v as { b: string }).b), 'hex');
  }
  return v as DmPrimitive;
}

/** O `blob` de `dm_ds_snapshot`: estado do `dmFold` **e** as tabelas já projetadas. */
export function serializar(s: DmState, t: Tabelas): Buffer {
  return Buffer.from(
    JSON.stringify({
      conversationId: s.conversationId,
      conversationKey: s.conversationKey.toString('hex'),
      interpretedOrdSum: s.interpretedOrdSum,
      dmVersionSeen: s.dmVersionSeen,
      partialInterpretation: s.partialInterpretation,
      lo: serializarLado(s.sides.lo),
      hi: serializarLado(s.sides.hi),
      messages: [...s.messages.entries()].map(([id, m]) => ({
        id,
        author: m.author.toString('hex'),
        ordSum: m.ordSum,
        authorSeq: m.authorSeq,
        deletedAt: m.deletedAt ?? null,
        editedAt: m.editedAt ?? null,
        replyToId: m.replyToId ?? null,
        hasAttachment: m.hasAttachment,
        reactionEmojis: [...m.reactionEmojis],
      })),
      tabelas: [...t.entries()].map(([nome, linhas]) => ({
        nome,
        linhas: [...linhas.entries()].map(([k, row]) => ({
          k,
          row: Object.fromEntries(Object.entries(row).map(([c, v]) => [c, serializarPrimitivo(v)])),
        })),
      })),
    }),
    'utf8',
  );
}

export function desserializar(blob: Buffer): { state: DmState; tabelas: Tabelas } {
  const j = JSON.parse(blob.toString('utf8')) as Record<string, never>;
  const o = j as unknown as {
    conversationId: string;
    conversationKey: string;
    interpretedOrdSum: number;
    dmVersionSeen: number;
    partialInterpretation: boolean;
    lo: SideJson;
    hi: SideJson;
    messages: Array<{
      id: string;
      author: string;
      ordSum: number;
      authorSeq: number;
      deletedAt: number | null;
      editedAt: number | null;
      replyToId: string | null;
      hasAttachment: boolean;
      reactionEmojis: string[];
    }>;
    tabelas: Array<{ nome: string; linhas: Array<{ k: string; row: Record<string, unknown> }> }>;
  };
  const messages: DmState['messages'] = new Map();
  for (const m of o.messages) {
    const meta: DmState['messages'] extends Map<string, infer V> ? V : never = {
      author: Buffer.from(m.author, 'hex'),
      ordSum: m.ordSum,
      authorSeq: m.authorSeq,
      hasAttachment: m.hasAttachment,
      reactionEmojis: new Set(m.reactionEmojis),
    };
    if (m.deletedAt !== null) meta.deletedAt = m.deletedAt;
    if (m.editedAt !== null) meta.editedAt = m.editedAt;
    if (m.replyToId !== null) meta.replyToId = m.replyToId;
    messages.set(m.id, meta);
  }
  const state: DmState = {
    conversationId: o.conversationId,
    conversationKey: Buffer.from(o.conversationKey, 'hex'),
    interpretedOrdSum: o.interpretedOrdSum,
    dmVersionSeen: o.dmVersionSeen,
    partialInterpretation: o.partialInterpretation,
    sides: { lo: desserializarLado(o.lo), hi: desserializarLado(o.hi) },
    messages,
  };
  const tabelas: Tabelas = new Map();
  for (const { nome, linhas } of o.tabelas) {
    const m = tabela(tabelas, nome);
    for (const { k, row } of linhas) {
      m.set(k, Object.fromEntries(Object.entries(row).map(([c, v]) => [c, desserializarPrimitivo(v)])));
    }
  }
  return { state, tabelas };
}

// ─── O nó ───────────────────────────────────────────────────────────────────────────────

export type OpcoesNo = {
  readonly ctx: DmContext;
  /** Snapshot a cada N registros interpretados. `0` desliga. */
  readonly snapshotEvery?: number;
  readonly foldBuildId?: string;
  readonly metrics?: DmFoldMetrics;
};

/**
 * Um nó da conversa: os dois logs como ele os conhece, o `DmState` do `dmFold` REAL, as
 * tabelas de §31.12 e os snapshots de `dm_ds_snapshot`.
 */
export class No {
  readonly ctx: DmContext;
  readonly snapshotEvery: number;
  readonly foldBuildId: string;
  readonly metrics: DmFoldMetrics | undefined;

  logs: { lo: Uint8Array[]; hi: Uint8Array[] } = { lo: [], hi: [] };
  state: DmState;
  tabelas: Tabelas = new Map();
  snapshots: Snapshot[] = [];
  eventos: Evento[] = [];
  reinterpretacoes: CustoReinterpretacao[] = [];
  /** `origin:index` dos registros já interpretados nesta história. */
  vistos = new Set<string>();
  resultados: DmFoldResult[] = [];
  desdeUltimoSnapshot = 0;

  constructor(o: OpcoesNo) {
    this.ctx = o.ctx;
    this.snapshotEvery = o.snapshotEvery ?? 0;
    this.foldBuildId = o.foldBuildId ?? 'g14-harness';
    this.metrics = o.metrics;
    this.state = emptyDmState(o.ctx.conversationKey, o.ctx.loKey, o.ctx.hiKey, o.ctx.conversationId);
  }

  #zerar(): void {
    this.state = emptyDmState(
      this.ctx.conversationKey,
      this.ctx.loKey,
      this.ctx.hiKey,
      this.ctx.conversationId,
    );
    this.tabelas = new Map();
    this.vistos = new Set();
    this.desdeUltimoSnapshot = 0;
  }

  #tirarSnapshot(): void {
    this.snapshots.push({
      interpretedOrdSum: this.state.interpretedOrdSum,
      loLength: this.state.sides.lo.length,
      hiLength: this.state.sides.hi.length,
      blob: serializar(this.state, this.tabelas),
      foldBuildId: this.foldBuildId,
      takenAt: Date.now(),
    });
  }

  #interpretar(refs: readonly DmOrdRef[]): void {
    for (const ref of refs) {
      const rec = this.logs[ref.origin][ref.index];
      if (rec === undefined) continue;
      const r = dmFoldRecord(this.state, rec, ref.origin, ref.index, this.ctx, this.metrics);
      this.state = r.next;
      this.resultados.push(r);
      this.vistos.add(`${ref.origin}:${ref.index}`);
      aplicarEfeitos(this.tabelas, r.effects, this.eventos);
      // §31.12 — `dm_rejected_records` é diagnóstico, escrito pelo projetor a partir do
      // `DmFoldResult`, não por efeito.
      if (r.decision !== 'APPLIED') {
        const m = tabela(this.tabelas, 'dm_rejected_records');
        m.set(chave([ref.origin, ref.index]), {
          origin: ref.origin,
          idx: ref.index,
          kind: r.kind ?? null,
          reason: r.reason ?? null,
        });
      }
      this.desdeUltimoSnapshot++;
      if (this.snapshotEvery > 0 && this.desdeUltimoSnapshot >= this.snapshotEvery) {
        this.#tirarSnapshot();
        this.desdeUltimoSnapshot = 0;
      }
    }
  }

  /**
   * Entrega blocos novos. Cada log só cresce em índice — é o que um core faz —, então o que
   * chega é sempre um sufixo; o que muda a história é o sufixo de **um** lado ter `ordSum`
   * abaixo do que o outro já empurrou.
   */
  entregar(novos: { lo?: readonly Uint8Array[]; hi?: readonly Uint8Array[] }): void {
    for (const o of ['lo', 'hi'] as const) {
      for (const rec of novos[o] ?? []) this.logs[o].push(rec);
    }
    const ordem = mergeRecords(this.logs.lo, this.logs.hi);
    const pendentes = ordem.filter((r) => !this.vistos.has(`${r.origin}:${r.index}`));
    if (pendentes.length === 0) return;

    const menor = pendentes.reduce((a, r) => Math.min(a, r.ordSum), Number.POSITIVE_INFINITY);
    if (menor > this.state.interpretedOrdSum) {
      this.#interpretar(pendentes);
      return;
    }

    // §31.13 — inserção retroativa.
    const t0 = process.hrtime.bigint();
    const antes = this.snapshots.length;
    this.snapshots = this.snapshots.filter((s) => s.interpretedOrdSum <= menor && s.foldBuildId === this.foldBuildId);
    const descartados = antes - this.snapshots.length;
    const base = this.snapshots.at(-1);
    if (base === undefined) {
      this.#zerar();
    } else {
      const { state, tabelas } = desserializar(base.blob);
      this.state = state;
      this.tabelas = tabelas;
      this.desdeUltimoSnapshot = 0;
      this.vistos = new Set(
        ordem
          .filter((r) => r.ordSum <= base.interpretedOrdSum && this.#dentroDoSnapshot(r, base))
          .map((r) => `${r.origin}:${r.index}`),
      );
    }
    const refazer = ordem.filter((r) => !this.vistos.has(`${r.origin}:${r.index}`));
    this.#interpretar(refazer);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    this.reinterpretacoes.push({
      fromOrdSum: menor,
      partiuDe: base === undefined ? 'zero' : 'snapshot',
      registrosReinterpretados: refazer.length,
      snapshotsDescartados: descartados,
      ms,
    });
    // §31.13 passo 4 — o evento sai **depois** do commit.
    this.eventos.push({ topic: 'dm.reordered', data: { fromOrdSum: menor } });
  }

  #dentroDoSnapshot(r: DmOrdRef, s: Snapshot): boolean {
    const limite: Record<DmOrigin, number> = { lo: s.loLength, hi: s.hiLength };
    return r.index < limite[r.origin];
  }
}
