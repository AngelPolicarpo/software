// `dmFold` — a interpretação normativa da conversa direta. §31.7.
//
//   L1, puro. Sem I/O, sem relógio, sem configuração, **sem exceção** (§4, §31.7.1).
//   dmFoldRecord(prev: DmState, rec: RawRecord, origin, index, ctx: DmContext): DmFoldResult
//
// Três desfechos, e só três: `APPLIED`, `REJECTED`, `IGNORED`. Não existe "abortar", "parar",
// "degradar a conversa" nem "lançar". Em **todos** eles o estágio final atualiza
// `interpretedOrdSum`, `sides[origin].length`, `lastAuthorSeq`, `lastAck` e `lastTs`: um
// registro recusado **queima** o número, pela mesma razão de §7.5 — sem isso, uma recusa
// devolveria a posição e o índice do core deixaria de casar com `authorSeq` (RD-3).
//
// **O que este módulo não é.** Ele não é uma extensão do `fold` de §8 (§31.0): não usa o
// catálogo de 38 `kind`s, não usa `opVersion`, não conhece `DecisionState`, não tem outbox,
// não tem host e não tem `HostRecord`. São módulos irmãos, e §4 dá a este exatamente três
// dependências: `dmCodec`, `idgen`, `errors`.
//
// **O que ele não precisa ter, e por quê:**
//
// | Ausente                        | Razão                                                    |
// |--------------------------------|----------------------------------------------------------|
// | Estágio de duplicata           | Um Hypercore não tem duas entradas no mesmo índice e RD-3 amarra `authorSeq` ao índice; um envelope replicado para outro core cai no estágio 2 ou 3. **A deduplicação é estrutural** (§31.7.3) |
// | Estágio de autorização         | Uma conversa tem exatamente dois participantes e cada um escreve o próprio log. Não há permissão, hierarquia nem membresia a conferir (§31.7.3) |
// | Cota determinística (R-14/R-15)| O log de uma comunidade é compartilhado; aqui cada um escreve no próprio core, no próprio disco. Uma cota custaria estado e determinismo sem fechar ameaça (§31.18) |
// | Recusa por relógio (R-2)       | Sem host não há carimbo neutro; recusar por relógio daria a uma parte com relógio quebrado o poder de destruir a conversa (§31.6) |

import {
  decodeDmEnvelope,
  decodeDmOp,
  decodeDmPayload,
  dmKindName,
  dmOpSigningHash,
  isKnownDmKind,
  isSupportedDmVersion,
  openDmPayload,
  peekDmHeader,
  verifyDmSignature,
  DM_KINDS,
  type DmOp,
} from '../dmCodec/index.ts';
import type { ErrorCode } from '../errors/index.ts';

import { applyDmKind, type DmContext, type DmKindCtx, type DmRejection } from './apply.ts';
import { DM_MAX_ENVELOPE_BYTES, DM_MAX_ENVELOPE_BYTES_ATTACHMENT } from './constants.ts';
import type { DmEffect } from './effects.ts';
import { clampAck, mergeRecords, ordSumOf, type DmOrdRef } from './order.ts';
import {
  DmDraft,
  otherSide,
  SEM_EFEITOS,
  type DmOrigin,
  type DmState,
} from './state.ts';

export * from './constants.ts';
export * from './effects.ts';
export * from './limits.ts';
export * from './order.ts';
export * from './state.ts';
export { applyDmKind, type DmContext, type DmKindCtx, type DmRejection } from './apply.ts';

export type DmDecision = 'APPLIED' | 'REJECTED' | 'IGNORED';

export type DmFoldResult = {
  readonly decision: DmDecision;
  /** Presente quando `REJECTED` ou `IGNORED`. */
  readonly reason?: ErrorCode;
  /** §20.1 — presente em `E_VALIDATION`. */
  readonly field?: string;
  /** §31.7.1 — a partir do decode do cabeçalho; ausente antes dele. */
  readonly kind?: number;
  readonly author?: Buffer;
  /** Presente em `APPLIED` de `dm.message`. */
  readonly messageId?: string;
  /** §31.6 — presente em **todo** desfecho: o número é queimado mesmo na recusa. */
  readonly ordSum: number;
  /** RD-5 — o `ts` decrescia e foi clampado (`dmFold.tsClamped`). */
  readonly tsClamped?: boolean;
  /** §31.6 — o `ack` excede o comprimento conhecido do log do par (**L-27**). */
  readonly ackAhead?: boolean;
  /** §31.6 — impossibilidade causal: `ts` menor que o do registro que o próprio `ack` reconhece. */
  readonly clockSkewed?: boolean;
  readonly effects: readonly DmEffect[];
  readonly next: DmState;
};

/** Os bytes de um registro do core, como o Hypercore os devolve. */
export type DmRawRecord = Uint8Array;

/**
 * §31.7.1 — a fronteira de diagnóstico. O pipeline preenche isto assim que o `DmOp`
 * decodifica, e o caminho de pânico a copia: é a única forma de `dmFold.panic{ordSum, kind}`
 * ter o `kind`, porque quem lança pode ter lançado depois do decode e o projetor **não
 * decodifica registro** (§4).
 */
type DmProbe = { kind?: number; author?: Buffer };

/** Contadores de §31.7.1 e §24.3. Métrica de bug, **nunca** fluxo de controle. */
export type DmFoldMetrics = {
  panic: number;
  tsClamped: number;
  ackAhead: number;
  clockSkewed: number;
  idCollision: number;
  applied: number;
  rejected: number;
  ignored: number;
  rejectedBy: Map<string, number>;
  ignoredBy: Map<string, number>;
};

export function newDmMetrics(): DmFoldMetrics {
  return {
    panic: 0,
    tsClamped: 0,
    ackAhead: 0,
    clockSkewed: 0,
    idCollision: 0,
    applied: 0,
    rejected: 0,
    ignored: 0,
    rejectedBy: new Map(),
    ignoredBy: new Map(),
  };
}

export function countDmResult(m: DmFoldMetrics, r: DmFoldResult): void {
  if (r.tsClamped === true) m.tsClamped++;
  if (r.ackAhead === true) m.ackAhead++;
  if (r.clockSkewed === true) m.clockSkewed++;
  if (r.reason === 'E_ID_COLLISION') m.idCollision++;
  if (r.decision === 'APPLIED') {
    m.applied++;
    return;
  }
  const alvo = r.decision === 'REJECTED' ? m.rejectedBy : m.ignoredBy;
  if (r.decision === 'REJECTED') m.rejected++;
  else m.ignored++;
  const k = r.reason ?? 'unknown';
  alvo.set(k, (alvo.get(k) ?? 0) + 1);
}

// ─── `clockSkewed` (§31.6, RD-5) ────────────────────────────────────────────────────────

/**
 * O `ts` do registro mais recente que este registro reconhece por `ack`: o do **outro** lado,
 * no índice `ack − 1`.
 *
 * `undefined` quando esse registro ainda não foi interpretado — o que só acontece com `ack`
 * mentiroso. Na ordem canônica, um `ack` verdadeiro garante que ele já passou: §31.6 prova
 * que `ordSum(r) < ordSum(s)` sempre que `s` reconhece `r`, e o merge entrega em `ordKey`
 * ascendente. Sem o registro, não há impossibilidade causal a afirmar, e nada é marcado.
 */
function tsReconhecido(state: DmState, origin: DmOrigin, ack: number): number | undefined {
  if (ack <= 0) return undefined;
  const par = state.sides[otherSide(origin)];
  const pos = ack - 1 - par.tsWindowBase;
  if (pos < 0 || pos >= par.tsWindow.length) return undefined;
  return par.tsWindow[pos];
}

/**
 * Poda a janela de `ts` do outro lado até `ack − 1`. Os `ack` de um log são não decrescentes
 * (RD-4), então nada abaixo disso volta a ser consultado e a janela fica do tamanho do atraso
 * corrente, não do tamanho da conversa.
 */
function podarJanela(draft: DmDraft, origin: DmOrigin, ack: number): void {
  const alvo = otherSide(origin);
  const par = draft.state.sides[alvo];
  const base = Math.max(0, ack - 1);
  if (base <= par.tsWindowBase) return;
  const corte = Math.min(base - par.tsWindowBase, par.tsWindow.length);
  if (corte <= 0) return;
  const s = draft.side(alvo);
  s.tsWindow = s.tsWindow.slice(corte);
  s.tsWindowBase = par.tsWindowBase + corte;
}

// ─── O pipeline de §31.7.3 ──────────────────────────────────────────────────────────────

type Livro = {
  /** `ack` cru do cabeçalho; `null` quando o cabeçalho não decodificou. */
  ackRaw: number | null;
  tsRaw: number | null;
  authorSeq: number | null;
  dmVersion: number | null;
  partial: boolean;
};

function dmFoldRecordInner(
  prev: DmState,
  rec: DmRawRecord,
  origin: DmOrigin,
  index: number,
  dm: DmContext,
  probe: DmProbe,
): DmFoldResult {
  const draft = new DmDraft(prev);
  const effects: DmEffect[] = [];
  const anterior = prev.sides[origin];
  const livro: Livro = {
    ackRaw: null,
    tsRaw: null,
    authorSeq: null,
    dmVersion: null,
    partial: false,
  };

  /**
   * §31.7.3 — o que o estágio final faz em **todo** desfecho. `interpretedOrdSum` avança,
   * o comprimento do lado avança, e `lastAuthorSeq`/`lastAck`/`lastTs` recebem o que o
   * registro trouxe, já clampados.
   */
  const fechar = (
    parcial: {
      decision: DmDecision;
      reason?: ErrorCode;
      field?: string;
      messageId?: string;
      effects?: readonly DmEffect[];
    },
  ): DmFoldResult => {
    const ack = clampAck(livro.ackRaw, anterior.lastAck);
    const ts = livro.tsRaw === null ? anterior.lastTs : Math.max(livro.tsRaw, anterior.lastTs);
    const ordSum = ordSumOf(index, ack);
    const tsClamped = livro.tsRaw !== null && livro.tsRaw < anterior.lastTs;
    const ackAhead = livro.ackRaw !== null && livro.ackRaw > prev.sides[otherSide(origin)].length;
    const reconhecido = tsReconhecido(prev, origin, ack);
    const clockSkewed = reconhecido !== undefined && ts < reconhecido;

    const side = draft.side(origin);
    side.length = Math.max(side.length, index + 1);
    if (livro.authorSeq !== null && livro.authorSeq > side.lastAuthorSeq) {
      side.lastAuthorSeq = livro.authorSeq;
    }
    side.lastAck = ack;
    side.lastTs = ts;
    // A janela de `ts` deste lado ganha o índice corrente; a do outro é podada pelo `ack`.
    side.tsWindow = [...side.tsWindow, ts];
    podarJanela(draft, origin, ack);

    draft.setScalar('interpretedOrdSum', ordSum);
    if (livro.partial) draft.setScalar('partialInterpretation', true);
    if (livro.dmVersion !== null && livro.dmVersion > prev.dmVersionSeen) {
      draft.setScalar('dmVersionSeen', livro.dmVersion);
    }
    draft.touch();

    const r: {
      decision: DmDecision;
      reason?: ErrorCode;
      field?: string;
      kind?: number;
      author?: Buffer;
      messageId?: string;
      ordSum: number;
      tsClamped?: boolean;
      ackAhead?: boolean;
      clockSkewed?: boolean;
      effects: readonly DmEffect[];
      next: DmState;
    } = {
      decision: parcial.decision,
      ordSum,
      effects: parcial.effects ?? SEM_EFEITOS,
      next: draft.finish(),
    };
    if (parcial.reason !== undefined) r.reason = parcial.reason;
    if (parcial.field !== undefined) r.field = parcial.field;
    if (parcial.messageId !== undefined) r.messageId = parcial.messageId;
    if (tsClamped) r.tsClamped = true;
    if (ackAhead) r.ackAhead = true;
    if (clockSkewed) r.clockSkewed = true;
    return r;
  };

  /**
   * §31.4 / §31.16.2 — `IGNORED`. `tag` presente é o caso que liga `partialInterpretation`:
   * versão ou `kind` que este build não conhece. O valor entra na lista correspondente do
   * `DmState`; o **evento** é do projetor, por lote, e não daqui — §31.7.3 dá a emissão de
   * efeitos ao estágio 12, que é `APPLIED`, e um `IGNORED` que empurrasse `notify` quebraria
   * essa leitura por um evento de diagnóstico.
   */
  const ignorado = (
    reason: ErrorCode,
    tag?: { readonly qual: 'unknownKinds' | 'unknownVersions'; readonly n: number },
  ): DmFoldResult => {
    if (tag !== undefined) {
      livro.partial = true;
      draft.addUnknown(tag.qual, tag.n);
    }
    return fechar({ decision: 'IGNORED', reason });
  };
  const recusa = (reason: ErrorCode, field?: string): DmFoldResult =>
    fechar(field === undefined ? { decision: 'REJECTED', reason } : { decision: 'REJECTED', reason, field });

  // ── Estágio 0 — teto de bytes, ANTES de qualquer decode ou Ed25519 ────────────────────
  // O transporte impõe o seu teto (§31.18), e um par adversário não passa pelo transporte:
  // ele appenda no próprio core e replica. Custo O(1).
  if (rec.length > DM_MAX_ENVELOPE_BYTES_ATTACHMENT) return recusa('E_PAYLOAD_TOO_LARGE');

  // ── Estágio 1 — `DmEnvelope`/`DmOp` decodificam; `v` e `kind` conhecidos ──────────────
  const env = decodeDmEnvelope(rec);
  if (env === null) return ignorado('E_MALFORMED');
  const op: DmOp | null = decodeDmOp(env.op);
  if (op === null) return ignorado('E_MALFORMED');
  probe.kind = op.kind;
  probe.author = op.author;
  livro.ackRaw = op.ack;
  livro.tsRaw = op.ts;
  livro.authorSeq = op.authorSeq;
  livro.dmVersion = op.v;
  // §31.4, regra 5 de §7.2 com `DM_VERSION` no lugar de `opVersion`: versão desconhecida liga
  // `partialInterpretation` **daquela conversa**, que bloqueia escrita local nela com
  // `E_VERSION_UNSUPPORTED` — mas **não** para a projeção.
  if (!isSupportedDmVersion(op.v)) {
    return ignorado('E_VERSION_UNSUPPORTED', { qual: 'unknownVersions', n: op.v });
  }
  if (!isKnownDmKind(op.kind)) return ignorado('E_UNKNOWN_KIND', { qual: 'unknownKinds', n: op.kind });
  const nome = dmKindName(op.kind);
  /* c8 ignore next */
  if (nome === null) return ignorado('E_UNKNOWN_KIND', { qual: 'unknownKinds', n: op.kind });

  // ── Estágio 2 — `op.conversationId === ctx.conversationId` ────────────────────────────
  // A07: um envelope colhido da conversa X não tem efeito na conversa Y. O código é o de
  // §20.2 e o significado é "envelope de outra conversa" (§31.7.3, §31.17).
  if (!op.conversationId.equals(dm.conversationKey)) return recusa('E_WRONG_COMMUNITY');

  // ── Estágio 3 — `op.author` é o dono do core de origem ────────────────────────────────
  const dono = origin === 'lo' ? dm.loKey : dm.hiKey;
  if (!dono.equals(op.author)) return recusa('E_AUTHOR_MISMATCH');

  // ── Estágio 4 — `sig` válida sobre `BLAKE2b('dm-op/1' ‖ op)` com `op.author` ──────────
  if (!verifyDmSignature(env.sig, dmOpSigningHash(env.op), op.author)) {
    return recusa('E_BAD_SIGNATURE');
  }

  // ── Estágio 5 — RD-3: `authorSeq === index + 1`, sem exceção ──────────────────────────
  // É a amarração entre o contador assinado pela identidade e a posição autenticada pela
  // árvore do core. Um desvio significa core reescrito, e marca o **lado** `invalid`.
  if (op.authorSeq !== index + 1) {
    draft.side(origin).invalid = true;
    return recusa('E_VALIDATION', 'authorSeq');
  }

  // ── Estágio 6 — forma da gênese, quando `index = 0` (RD-1) ────────────────────────────
  // Só a parte de cabeçalho: `peerKey` e `coreProof` vivem no payload, que ainda não abriu.
  // O resto de RD-1 é conferido no handler de `dm.hello`, com o mesmo desfecho.
  if (index === 0) {
    if (op.kind !== DM_KINDS['dm.hello'] || op.ack !== 0) {
      draft.side(origin).invalid = true;
      return recusa('E_GENESIS_MISPLACED');
    }
  }

  // ── Estágio 7 — o lado de origem não está `invalid` ───────────────────────────────────
  // RD-1: absorvente **por lado**. O outro lado não é afetado — uma conversa em que um lado
  // está quebrado ainda é legível do outro.
  if (anterior.invalid) return recusa('E_VALIDATION');

  // ── Estágio 8 — AEAD abre com `dmContentKey` e `dmNonce(op)`, cabeçalho como AAD ──────
  // A AEAD falhar é falha de **autenticidade**, não de sintaxe: `E_BAD_SIGNATURE` (§31.7.3).
  const { payload: _ct, ...cabecalho } = op;
  const plaintext = openDmPayload(dm.contentKey, cabecalho, op.payload);
  if (plaintext === null) return recusa('E_BAD_SIGNATURE');

  // ── Estágio 9 — payload decodifica e casa o layout do `kind` ──────────────────────────
  const p = decodeDmPayload(nome, plaintext) as Readonly<Record<string, unknown>> | null;
  if (p === null) return ignorado('E_MALFORMED');

  // ── Estágio 10 (parte de registro) — o teto condicional de §31.7.5 ────────────────────
  // O estágio 0 aplicou o teto absoluto (64 KiB). Só aqui se sabe se há anexo, e um registro
  // sem anexo tem teto de 32 KiB.
  const temAnexo = op.kind === DM_KINDS['dm.message'] && p['attachment'] !== undefined;
  if (!temAnexo && rec.length > DM_MAX_ENVELOPE_BYTES) return recusa('E_PAYLOAD_TOO_LARGE');

  // ── Estágios 10, 11 e 12 — limites de campo, regras estruturais, efeitos ──────────────
  const ack = clampAck(op.ack, anterior.lastAck);
  const ts = Math.max(op.ts, anterior.lastTs);
  const reconhecido = tsReconhecido(prev, origin, ack);
  const kindCtx: DmKindCtx = {
    origin,
    index,
    ordSum: ordSumOf(index, ack),
    op,
    ts,
    ack,
    ackAhead: op.ack > prev.sides[otherSide(origin)].length,
    clockSkewed: reconhecido !== undefined && ts < reconhecido,
    draft,
    effects,
    dm,
  };
  const rejeicao: DmRejection | null = applyDmKind(kindCtx, p);
  if (rejeicao !== null) return recusa(rejeicao.code, rejeicao.field);

  // §31.7.1 — `messageId` está presente em `APPLIED` de `dm.message`, e é o id que o próprio
  // handler derivou (§31.4). Lê-lo do efeito evita uma segunda derivação a manter em dia.
  const messageId =
    op.kind === DM_KINDS['dm.message']
      ? effects.find((e): e is Extract<DmEffect, { t: 'upsert' }> =>
          e.t === 'upsert' && e.table === 'dm_messages',
        )?.key[0]
      : undefined;

  return fechar({
    decision: 'APPLIED',
    effects,
    ...(typeof messageId === 'string' ? { messageId } : {}),
  });
}

/**
 * §31.7.1 — a rede de segurança.
 *
 * Uma exceção lançada de dentro do `dmFold` é **bug de implementação de severidade máxima**.
 * Ela não é o comportamento pretendido: existe para que um bug nunca vire perda de conversa.
 * O registro é tratado como `IGNORED`, `dmFold.panic{ordSum, kind}` é contado, e a
 * interpretação **continua**. É o critério 2 de G14 (§31.26), e o fuzzer de
 * `dm-fold-totality` é o ensaio dele: `panic` precisa ser 0.
 */
export function dmFoldRecord(
  prev: DmState,
  rec: DmRawRecord,
  origin: DmOrigin,
  index: number,
  dm: DmContext,
  metrics?: DmFoldMetrics,
): DmFoldResult {
  const probe: DmProbe = {};
  try {
    const r = comProbe(dmFoldRecordInner(prev, rec, origin, index, dm, probe), probe);
    if (metrics !== undefined) countDmResult(metrics, r);
    return r;
  } catch (err) {
    ultimoPanico = {
      ordSum: ordSumOf(index, prev.sides[origin].lastAck),
      err: err instanceof Error ? (err.stack ?? err.message) : String(err),
    };
    if (metrics !== undefined) {
      metrics.panic++;
      metrics.ignored++;
    }
    // O pânico não pode deixar o estado parado: sem avançar `interpretedOrdSum` e o
    // comprimento do lado, o mesmo registro voltaria para sempre. `IGNORED` é o desfecho, e a
    // contabilidade do estágio final acontece do mesmo jeito.
    const seguro = new DmDraft(prev);
    const side = seguro.side(origin);
    const ack = clampAck(peekAck(rec), prev.sides[origin].lastAck);
    const ordSum = ordSumOf(index, ack);
    side.length = Math.max(side.length, index + 1);
    side.lastAck = ack;
    side.tsWindow = [...side.tsWindow, side.lastTs];
    seguro.setScalar('interpretedOrdSum', ordSum);
    seguro.touch();
    return comProbe(
      { decision: 'IGNORED', reason: 'E_MALFORMED', ordSum, effects: SEM_EFEITOS, next: seguro.finish() },
      probe,
    );
  }
}

function peekAck(rec: DmRawRecord): number | null {
  try {
    return peekDmHeader(rec)?.ack ?? null;
  } catch {
    return null;
  }
}

function comProbe(r: DmFoldResult, probe: DmProbe): DmFoldResult {
  if (probe.kind === undefined || probe.author === undefined) return r;
  return { ...r, kind: probe.kind, author: probe.author };
}

export let ultimoPanico: { ordSum: number; err: string } | null = null;

export function limparPanico(): void {
  ultimoPanico = null;
}

// ─── Interpretação dos dois logs na ordem canônica ──────────────────────────────────────

export type DmFoldLogsResult = {
  readonly order: readonly DmOrdRef[];
  readonly results: readonly DmFoldResult[];
  readonly state: DmState;
};

/**
 * Interpreta os dois logs inteiros na ordem canônica de §31.6.
 *
 * É a forma que G14 mede: dois nós com os mesmos dois logs, chegando em ordens de replicação
 * diferentes, precisam produzir o mesmo estado. A ordem de **entrega** não aparece aqui de
 * propósito — a entrada é o par de logs, e a intercalação é função dele.
 */
export function dmFoldLogs(
  inicial: DmState,
  loRecords: readonly DmRawRecord[],
  hiRecords: readonly DmRawRecord[],
  dm: DmContext,
  metrics?: DmFoldMetrics,
): DmFoldLogsResult {
  const order = mergeRecords(loRecords, hiRecords);
  const results: DmFoldResult[] = [];
  let state = inicial;
  for (const ref of order) {
    const rec = (ref.origin === 'lo' ? loRecords : hiRecords)[ref.index];
    if (rec === undefined) continue;
    const r = dmFoldRecord(state, rec, ref.origin, ref.index, dm, metrics);
    results.push(r);
    state = r.next;
  }
  return { order, results, state };
}
