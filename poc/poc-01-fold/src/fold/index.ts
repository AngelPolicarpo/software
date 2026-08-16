/**
 * `fold` — a interpretacao normativa. backend-v2.md §8.
 *
 *   L1, puro. Sem I/O, sem relogio, sem configuracao, SEM EXCECAO (§8.5).
 *   function foldRecord(prev: DecisionState, rec: RawRecord, seq: number): FoldResult
 *
 * Tres desfechos e so tres: APPLIED | REJECTED | IGNORED. Em TODOS os desfechos o
 * estagio final atualiza `interpretedSeq = seq` e, quando o registro chegou ao estagio
 * 6, tambem `lastAuthorSeq[author]` (§8.2).
 *
 * O pipeline de §8.2 esta implementado na ordem fixa, com o numero do estagio no
 * comentario de cada bloco. Os estagios 13/14/15 sao delegados por `kind` para
 * `applyKind` (§8.3, §8.4), lidos declarativamente da matriz de §9.4.
 */
import { E, type ErrorCode } from '../protocol/errors.ts';
import { K } from '../protocol/kinds.ts';
import {
  ATTACHMENT_QUOTA_PER_MEMBER,
  CLOCK_ACCEPT_MS,
  GENESIS_LAST_SEQ,
  GENESIS_LENGTH,
  MAX_ENVELOPE_BYTES,
  MAX_ENVELOPE_BYTES_ATTACHMENT,
  OP_VERSION,
} from '../protocol/constants.ts';
import {
  ALL_PERMS,
  GENESIS_BASE_ROLE_ALLOWED,
  KIND_POLICY,
  PERM_COUNT,
  effectivePerms,
  outranks,
  topRank,
} from '../protocol/permissions.ts';
import { RANK_GENESIS } from './rank.ts';
import {
  decodeEnvelope,
  decodeHostRecord,
  decodeOp,
  decodePayload,
  hostRecSigningHash,
  isKnownKind,
  isSupportedVersion,
  opSigningHash,
  type Op,
  type Payload,
} from '../codec/opCodec.ts';
import { verify } from '../crypto/index.ts';
import { Draft, ringAdd, ringWouldExceed, type DecisionState } from './state.ts';
import type { Effect } from './effects.ts';
import { applyKind, type KindCtx, type Rejection } from './apply.ts';
import { hierarchyTargetOf } from './targets.ts';

export type Decision = 'APPLIED' | 'REJECTED' | 'IGNORED';

export type FoldResult = {
  decision: Decision;
  reason?: ErrorCode;
  /** presente em E_VALIDATION (§20.1) */
  field?: string;
  /** presente em E_LIMIT_EXCEEDED (§20.2) */
  limit?: number;
  effects: Effect[];
  next: DecisionState;
  /** R-1 — o registro trouxe `hostTs` retroativo e foi clampado (`fold.hostTsClamped`). */
  hostTsClamped?: boolean;
};

export type RawRecord = Uint8Array;

/** Contadores de §8.5 / §24.3. Metrica de bug, nunca fluxo de controle. */
export type FoldMetrics = {
  panic: number;
  hostTsClamped: number;
  propertyViolation: number;
  idCollision: number;
  applied: number;
  rejected: number;
  ignored: number;
  rejectedBy: Map<string, number>;
  ignoredBy: Map<string, number>;
};

export function newMetrics(): FoldMetrics {
  return {
    panic: 0,
    hostTsClamped: 0,
    propertyViolation: 0,
    idCollision: 0,
    applied: 0,
    rejected: 0,
    ignored: 0,
    rejectedBy: new Map(),
    ignoredBy: new Map(),
  };
}

export function countResult(m: FoldMetrics, r: FoldResult): void {
  if (r.hostTsClamped) m.hostTsClamped++;
  if (r.reason === E.ID_COLLISION) m.idCollision++;
  if (r.decision === 'APPLIED') m.applied++;
  else if (r.decision === 'REJECTED') {
    m.rejected++;
    const k = r.reason ?? 'unknown';
    m.rejectedBy.set(k, (m.rejectedBy.get(k) ?? 0) + 1);
  } else {
    m.ignored++;
    const k = r.reason ?? 'unknown';
    m.ignoredBy.set(k, (m.ignoredBy.get(k) ?? 0) + 1);
  }
}

const NO_EFFECTS: Effect[] = [];

// ---------------------------------------------------------------------------------

/** Bookkeeping obrigatorio de §8.2, aplicado em TODOS os desfechos. */
function bookkeep(
  prev: DecisionState,
  seq: number,
  reachedStage6: { authorHex: string; authorSeq: number } | null,
  clampedHostTs: number | null,
  partial: boolean,
  opVersion: number | null,
): DecisionState {
  const d = new Draft(prev);
  d.setScalar('interpretedSeq', seq);
  if (clampedHostTs !== null && clampedHostTs > prev.lastHostTs) d.setScalar('lastHostTs', clampedHostTs);
  if (partial) d.setScalar('partialInterpretation', true);
  if (opVersion !== null && opVersion > prev.opVersionSeen) d.setScalar('opVersionSeen', opVersion);
  if (reachedStage6) {
    // §7.5 / §8.2: o contador e ESTRITAMENTE CRESCENTE. Ver AMBIG-02 no REPORT.md:
    // §8.2 diz "lastAuthorSeq[author] = authorSeq" incluindo em REJECTED; aplicado
    // literalmente a um duplicado (authorSeq <= lastAuthorSeq) o contador REGREDIRIA e
    // reabriria o replay que §7.5 fecha. `max` e a unica leitura consistente.
    const cur = prev.lastAuthorSeq.get(reachedStage6.authorHex) ?? 0;
    if (reachedStage6.authorSeq > cur) {
      d.lastAuthorSeq().set(reachedStage6.authorHex, reachedStage6.authorSeq);
    }
  }
  d.touch();
  return d.finish();
}

/**
 * R-27 — forma normativa do lote de genese (`seq` 0..5), verificada POR REGISTRO.
 *
 * R-27(c): a verificacao e por registro e SEM RETROACAO — a assinatura de §8.0 e por
 * registro, sem lookahead, e no `seq` k o `fold` ainda nao viu k+1..5. Cada registro e
 * conferido contra a posicao que R-27 exige DELE; o desvio marca a comunidade `invalid`
 * e, a partir dai, todo registro (incluindo os restantes da genese e todo `seq >= 6`) e
 * REJECTED. Toda replica marca `invalid` no MESMO `seq`, entao nao ha divergencia.
 */
const GENESIS_SHAPE: readonly number[] = [
  K.COMMUNITY_CREATE,
  K.ROLE_CREATE,
  K.ROLE_CREATE,
  K.MEMBER_JOIN,
  K.CATEGORY_CREATE,
  K.CHANNEL_CREATE,
];

function genesisViolation(
  state: DecisionState,
  op: Op,
  seq: number,
  authorHex: string,
  payload: Payload,
): boolean {
  if (seq >= GENESIS_LENGTH) return false;
  if (op.kind !== GENESIS_SHAPE[seq]) return true;
  if (op.authorSeq !== seq + 1) return true;
  if (seq !== 0 && authorHex !== state.community.founderKey.toString('hex')) return true;

  // R-27(b) — forma dos payloads. `seq` 1 e o cargo Fundador (as 17 permissoes); `seq` 2
  // e o cargo base (subconjunto da lista de §19.1). Fora disso: E_GENESIS_MISPLACED.
  if (seq === 1) {
    const perms = new Set((payload as { permissions: readonly number[] }).permissions);
    if (perms.size !== PERM_COUNT) return true;
    for (const p of ALL_PERMS) if (!perms.has(p)) return true;
  }
  if (seq === 2) {
    for (const p of (payload as { permissions: readonly number[] }).permissions) {
      if (!GENESIS_BASE_ROLE_ALLOWED.has(p)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------

function foldRecordInner(prev: DecisionState, rec: RawRecord, seq: number): FoldResult {
  // --- Estagio 0: teto de bytes, ANTES de decode e de Ed25519 (§8.2, fecha HOLE-04) --
  // O teto declarado em §26.2/§27.1 nao tinha ponto de aplicacao no `fold`: §14.4 impoe
  // teto no TRANSPORTE, e o host adversario de §1.4 nao passa pelo transporte. Custo
  // O(1), e impede que um prefixo de tamanho hostil faca o decodificador alocar antes de
  // concluir que a entrada e malformada (ACHADO-01).
  if (rec.length > MAX_ENVELOPE_BYTES_ATTACHMENT) {
    return {
      decision: 'REJECTED',
      reason: E.PAYLOAD_TOO_LARGE,
      effects: NO_EFFECTS,
      next: bookkeep(prev, seq, null, null, false, null),
    };
  }

  // --- Estagio 1: HostRecord decodifica; hostSig valida sobre a chave do core --------
  const hr = decodeHostRecord(rec);
  if (hr === null) {
    return {
      decision: 'IGNORED',
      reason: E.BAD_HOST_SIGNATURE,
      effects: NO_EFFECTS,
      next: bookkeep(prev, seq, null, null, false, null),
    };
  }
  const hostDigest = hostRecSigningHash(hr.envelope, hr.hostTs, hr.flags);
  if (!verify(hr.hostSig, hostDigest, prev.communityKey)) {
    return {
      decision: 'IGNORED',
      reason: E.BAD_HOST_SIGNATURE,
      effects: NO_EFFECTS,
      next: bookkeep(prev, seq, null, null, false, null),
    };
  }

  // --- Estagio 2: Envelope/Op decodificam; v e kind conhecidos; payload casa §7.4 ---
  const env = decodeEnvelope(hr.envelope);
  if (env === null) {
    return ignored(prev, seq, E.MALFORMED, false, hr.hostTs);
  }
  const op = decodeOp(env.op);
  if (op === null) {
    return ignored(prev, seq, E.MALFORMED, false, hr.hostTs);
  }
  if (!isSupportedVersion(op.v)) {
    // §7.2 regra 5: versao desconhecida liga `partialInterpretation`.
    return ignored(prev, seq, E.VERSION_UNSUPPORTED, true, hr.hostTs);
  }
  if (!isKnownKind(op.kind)) {
    // §9.4: um `kind` sem linha na matriz falha fechado com E_UNKNOWN_KIND.
    return ignored(prev, seq, E.UNKNOWN_KIND, true, hr.hostTs);
  }
  const payload = decodePayload(op.kind, op.payload);
  if (payload === null) {
    return ignored(prev, seq, E.MALFORMED, false, hr.hostTs);
  }

  // A partir daqui o registro e interpretavel: o clamp de R-1 vale para o resto.
  const hostTs = Math.max(hr.hostTs, prev.lastHostTs); // R-1, clamp deterministico
  const clamped = hr.hostTs < prev.lastHostTs;
  const rej = (code: ErrorCode, extra?: { field?: string; limit?: number }, stage6?: boolean): FoldResult => ({
    decision: 'REJECTED',
    reason: code,
    field: extra?.field,
    limit: extra?.limit,
    hostTsClamped: clamped,
    effects: NO_EFFECTS,
    next: bookkeep(
      prev,
      seq,
      stage6 ? { authorHex, authorSeq: op.authorSeq } : null,
      hostTs,
      false,
      op.v,
    ),
  });
  const authorHex = op.author.toString('hex');

  // --- Estagio 3: op.communityId === state.communityId ------------------------------
  if (!op.communityId.equals(prev.communityKey)) {
    return rej(E.WRONG_COMMUNITY);
  }

  // --- Estagio 4: sig valida sobre BLAKE2b('op/1' ‖ op) com op.author ---------------
  if (!verify(env.sig, opSigningHash(env.op), op.author)) {
    return rej(E.BAD_SIGNATURE);
  }

  // --- Estagio 5: clamp de hostTs (acima) + comunidade nao `ended` ------------------
  if (prev.community.endedAt !== undefined && op.kind !== K.COMMUNITY_END) {
    return rej(E.COMMUNITY_ENDED);
  }

  // --- Estagio 6: authorSeq > lastAuthorSeq[author] ---------------------------------
  const lastSeq = prev.lastAuthorSeq.get(authorHex) ?? 0;
  if (!(op.authorSeq > lastSeq)) {
    return rej(E.DUPLICATE);
  }

  // --- Estagio 7: |op.ts − hostTs| ≤ CLOCK_ACCEPT_MS (R-2, hostTs EFETIVO) ----------
  if (Math.abs(op.ts - hostTs) > CLOCK_ACCEPT_MS) {
    return rej(E.CLOCK_UNREASONABLE, undefined, true);
  }

  // --- R-27: forma do lote de genese ------------------------------------------------
  // Avaliada aqui porque decide se o PRINCIPAL DE GENESE de R-27(a) esta em vigor.
  const inGenesis = seq <= GENESIS_LAST_SEQ && !prev.communityInvalid;
  if (seq <= GENESIS_LAST_SEQ) {
    if (prev.communityInvalid || genesisViolation(prev, op, seq, authorHex, payload)) {
      const d = new Draft(prev);
      d.setScalar('communityInvalid', true);
      d.setScalar('interpretedSeq', seq);
      if (hostTs > prev.lastHostTs) d.setScalar('lastHostTs', hostTs);
      const cur = prev.lastAuthorSeq.get(authorHex) ?? 0;
      if (op.authorSeq > cur) d.lastAuthorSeq().set(authorHex, op.authorSeq);
      d.touch();
      return {
        decision: 'REJECTED',
        reason: E.GENESIS_MISPLACED,
        hostTsClamped: clamped,
        effects: NO_EFFECTS,
        next: d.finish(),
      };
    }
  } else if (op.kind === K.COMMUNITY_CREATE) {
    // §8.4.1: `community.create` em `seq ≠ 0` e genese fora de lugar.
    return rej(E.GENESIS_MISPLACED, undefined, true);
  }

  const member = prev.members.get(authorHex);

  // --- R-27(a): principal de genese --------------------------------------------------
  // Nos `seq` 0..5 o autor do lote e avaliado pelo pipeline como MEMBRO ATIVO, com
  // `efetiva` = as 17 permissoes e `topRank` = RANK_GENESIS. Nenhum estagio de §8.2 e
  // nenhuma regra de §8.3 sao suspensos — a unica excecao e R-9, em `apply.ts`.
  const principalActive = inGenesis || (member !== undefined && member.state === 'active');
  const principalBanned = !inGenesis && member !== undefined && member.state === 'banned';

  // --- Estagio 8: autor e membro ativo nao banido ------------------------------------
  // Excecao: `member.join` (o autor e o candidato). A genese passa por R-27(a).
  if (op.kind !== K.MEMBER_JOIN) {
    if (principalBanned) return rej(E.BANNED, undefined, true);
    if (!principalActive) return rej(E.NOT_MEMBER, undefined, true);
  }

  // --- Estagio 9: sem timeout ativo (`timeoutUntil > hostTs`), exceto member.leave ---
  if (member && op.kind !== K.MEMBER_LEAVE) {
    if (member.timeoutUntil !== undefined && member.timeoutUntil > hostTs) {
      return rej(E.TIMED_OUT, undefined, true);
    }
  }

  // --- Estagio 10: cotas deterministicas do autor (R-14, R-15) ----------------------
  // R-15 vale para todos exceto `member.join`.
  if (member && op.kind !== K.MEMBER_JOIN) {
    const bytes = op.payload.length;
    if (ringWouldExceed(member.opBudget, seq, bytes) !== null) {
      return rej(E.QUOTA_EXCEEDED, undefined, true);
    }
  }
  // R-14 — `storageUsedBytes + attachment.sizeBytes <= ATTACHMENT_QUOTA_PER_MEMBER`.
  // §8.2 coloca R-14 no estagio 10, ANTES de permissao (11), hierarquia (12) e limites de
  // campo (13). O tamanho do anexo ja esta disponivel: o payload decodificou no estagio 2.
  if (member && op.kind === K.MESSAGE_SEND) {
    const att = (payload as { attachment?: { sizeBytes: number } }).attachment;
    if (att !== undefined && member.storageUsedBytes + att.sizeBytes > ATTACHMENT_QUOTA_PER_MEMBER) {
      return rej(E.QUOTA_EXCEEDED, undefined, true);
    }
  }

  const draft = new Draft(prev);
  const roles = prev.roles;
  // R-27(a): na genese o principal carrega as 17 permissoes e o topo sentinela.
  const eff = inGenesis
    ? new Set<number>(ALL_PERMS)
    : member
      ? effectivePerms(member.roleIds, roles)
      : new Set<number>();
  const authorTop = inGenesis ? RANK_GENESIS : member ? topRank(member.roleIds, roles) : null;
  const policy = KIND_POLICY.get(op.kind);
  if (!policy) return rej(E.UNKNOWN_KIND, undefined, true); // §9.4, falha fechado

  const ctx: KindCtx = {
    seq,
    hostTs,
    flags: hr.flags,
    op,
    authorHex,
    payload,
    draft,
    inGenesis,
    effects: [],
    eff,
    authorTop,
    member,
  };

  // --- Estagio 11: permissao do `kind` (§9.4) ---------------------------------------
  // Sem suspensao: na genese `eff` e o conjunto do principal de R-27(a).
  const need = requiredPerm(op.kind, payload, ctx);
  if (need !== null && !eff.has(need)) {
    return rej(E.PERMISSION_DENIED, undefined, true);
  }

  // --- Estagio 12: hierarquia sobre o alvo, quando aplicavel (§9.3) ------------------
  // Sem suspensao: na genese `authorTop` e RANK_GENESIS, acima de qualquer rank.
  if (policy.hier) {
    const target = hierarchyTargetOf(op.kind, payload, prev, authorHex);
    if (target.applies) {
      if (target.immune) return rej(target.immune, undefined, true);
      if (!outranks(authorTop, target.topRank)) return rej(E.HIERARCHY, undefined, true);
    }
  }

  // --- Estagio 13 (parte de registro): teto condicional de §8.6 --------------------
  // O estagio 0 aplicou o teto ABSOLUTO (64 KiB). Só aqui se sabe se ha anexo, e um
  // registro sem anexo tem teto de 32 KiB.
  const hasAttachment =
    op.kind === K.MESSAGE_SEND &&
    (payload as { attachment?: unknown }).attachment !== undefined;
  if (!hasAttachment && rec.length > MAX_ENVELOPE_BYTES) {
    return rej(E.PAYLOAD_TOO_LARGE, undefined, true);
  }

  // --- Estagios 13, 14 e 15: limites de campo, regras estruturais, efeitos ----------
  const out: Rejection | null = applyKind(ctx);
  if (out !== null) {
    return rej(out.code, { field: out.field, limit: out.limit }, true);
  }

  // Bookkeeping do estagio final, agora sobre o rascunho ja avancado.
  draft.setScalar('interpretedSeq', seq);
  if (hostTs > prev.lastHostTs) draft.setScalar('lastHostTs', hostTs);
  if (op.v > prev.opVersionSeen) draft.setScalar('opVersionSeen', op.v);
  const cur = draft.state.lastAuthorSeq.get(authorHex) ?? 0;
  if (op.authorSeq > cur) draft.lastAuthorSeq().set(authorHex, op.authorSeq);

  // R-15: o registro admitido consome a janela do autor.
  if (op.kind !== K.MEMBER_JOIN) {
    const m = draft.mutMember(authorHex);
    if (m) {
      // §8.1 declara `opBudget` e `byteBudget` como dois `RingCounter`; R-15 descreve UMA
      // janela com DOIS tetos. Um contador so ja carrega ops e bytes, entao os dois campos
      // do schema apontam para a mesma janela (ASSUMPTION-05).
      m.opBudget = ringAdd(m.opBudget, seq, op.payload.length);
      m.byteBudget = m.opBudget;
    }
  }
  draft.touch();

  return { decision: 'APPLIED', hostTsClamped: clamped, effects: ctx.effects, next: draft.finish() };

  function ignored(
    p: DecisionState,
    s: number,
    reason: ErrorCode,
    partial: boolean,
    rawHostTs: number,
  ): FoldResult {
    return {
      decision: 'IGNORED',
      reason,
      effects: NO_EFFECTS,
      next: bookkeep(p, s, null, Math.max(rawHostTs, p.lastHostTs), partial, null),
    };
  }
}

/** §9.4 — permissao exigida pelo `kind`, com os dois casos condicionais de §7.4. */
function requiredPerm(kind: number, payload: Payload, ctx: KindCtx): number | null {
  const policy = KIND_POLICY.get(kind);
  if (!policy) return null;
  if (kind === K.MESSAGE_SEND) {
    const p = payload as { attachment?: unknown };
    if (p.attachment !== undefined && policy.permWithAttachment !== undefined) {
      if (!ctx.eff.has(policy.permWithAttachment)) return policy.permWithAttachment;
    }
    return policy.perm;
  }
  if (kind === K.MESSAGE_DELETE) {
    const p = payload as { messageId: string };
    const msg = ctx.draft.state.messages.get(p.messageId);
    // "propria | manage_messages": so exige a permissao quando a mensagem e de outro.
    if (msg && msg.authorKey === ctx.authorHex) return null;
    return policy.permWhenOther ?? null;
  }
  return policy.perm;
}

/**
 * §8.5 item 3 — rede de seguranca. Uma excecao lancada de dentro do `fold` e BUG DE
 * SEVERIDADE MAXIMA. O `projector` a captura, registra `fold.panic{seq, kind}`, trata o
 * registro como IGNORED e CONTINUA. Este teste (POC-01) existe para provar que ela nunca
 * e acionada: `fold.panic` precisa ser 0 em 10^7 entradas.
 */
export function foldRecord(
  prev: DecisionState,
  rec: RawRecord,
  seq: number,
  metrics?: FoldMetrics,
): FoldResult {
  try {
    const r = foldRecordInner(prev, rec, seq);
    if (metrics) countResult(metrics, r);
    return r;
  } catch (err) {
    if (metrics) {
      metrics.panic++;
      metrics.ignored++;
    }
    lastPanic = { seq, err: err instanceof Error ? err.stack ?? err.message : String(err) };
    const next = bookkeep(prev, seq, null, null, false, null);
    return { decision: 'IGNORED', reason: E.MALFORMED, effects: NO_EFFECTS, next };
  }
}

export let lastPanic: { seq: number; err: string } | null = null;
export function clearPanic(): void {
  lastPanic = null;
}

export const OP_VERSION_SUPPORTED = OP_VERSION;
