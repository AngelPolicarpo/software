// `succession` — camada b de R-18 e arbitragem entre continuações (§18.8, L-16).
//
// A camada (a) é universal e mora no `fold` (a prova verifica contra
// `originCommunityId`, que está na gênese da continuação). A camada (b) é condicional:
// só quem TEM a origem replicada pode conferir sucessor autorizado, grace period e
// prioridade. Falhou → o cliente **não migra** e marca a continuação como `disputed`,
// sem rejeitar o registro (não há base para isso na comunidade nova).

export interface ContinuationClaim {
  /** Id da comunidade de continuação (hex da chave pública do core novo). */
  readonly communityIdHex: string;
  readonly originCommunityIdHex: string;
  readonly originFinalSeq: number;
  /** Autor do `community.assumeHost` — é o novo host se tudo validar. */
  readonly assumedByHex: string;
}

/** Recorte do `DecisionState` da origem que a camada b consulta. */
export interface OriginFacts {
  readonly communityIdHex: string;
  /** Ordem = prioridade (§18.8): a lista não é ordenada por valor. */
  readonly successorKeysHex: readonly string[];
  readonly lastHostTs: number;
  readonly endedAt?: number;
}

export type LayerBRefusal = 'scope-mismatch' | 'not-successor' | 'grace-period' | 'origin-ended';

export type LayerBResult =
  | { readonly ok: true; readonly priorityIndex: number }
  | { readonly ok: false; readonly reason: LayerBRefusal };

/**
 * Camada b: o autor está em `successorKeys` da origem, o grace period passou e a origem
 * não foi encerrada. Comunidade encerrada é terminal (§18.5) — não tem sucessão.
 */
export function evaluateLayerB(args: {
  claim: ContinuationClaim;
  origin: OriginFacts;
  ttlMs: number;
  now: number;
}): LayerBResult {
  const { claim, origin, ttlMs, now } = args;
  if (claim.originCommunityIdHex !== origin.communityIdHex) return { ok: false, reason: 'scope-mismatch' };
  if (origin.endedAt !== undefined) return { ok: false, reason: 'origin-ended' };
  const priorityIndex = origin.successorKeysHex.indexOf(claim.assumedByHex);
  if (priorityIndex < 0) return { ok: false, reason: 'not-successor' };
  if (now - origin.lastHostTs < ttlMs) return { ok: false, reason: 'grace-period' };
  return { ok: true, priorityIndex };
}

/**
 * L-16: duas continuações válidas coexistem; cada réplica segue a de **maior prioridade**
 * (menor índice). Empate de prioridade (impossível com uma origem, mas defensivo para
 * claims de origens diferentes) resolve pelo id menor — determinístico.
 */
export function chooseContinuation<T extends { claim: ContinuationClaim; priorityIndex: number }>(
  candidates: readonly T[],
): { chosen: T; orphans: T[] } | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.priorityIndex !== b.priorityIndex) return a.priorityIndex - b.priorityIndex;
    return a.claim.communityIdHex.localeCompare(b.claim.communityIdHex);
  });
  const chosen = sorted[0]!;
  return { chosen, orphans: sorted.slice(1) };
}

export type ContinuationDisposition =
  | { readonly migrate: true }
  | { readonly migrate: false; readonly disputed: true; readonly reason: LayerBRefusal };

/**
 * Decisão de migração da réplica. **Com** a origem replicada, camada b decide: falhou →
 * `disputed`, não migra. **Sem** a origem, a camada a (verificada pelo fold na gênese/
 * assumeHost) é tudo que existe — segue o ponteiro.
 */
export function dispositionFor(args: {
  claim: ContinuationClaim;
  /** `null` quando esta réplica NÃO tem a comunidade de origem replicada. */
  origin: OriginFacts | null;
  ttlMs: number;
  now: number;
}): ContinuationDisposition {
  if (args.origin === null) return { migrate: true };
  const b = evaluateLayerB({ claim: args.claim, origin: args.origin, ttlMs: args.ttlMs, now: args.now });
  if (b.ok) return { migrate: true };
  return { migrate: false, disputed: true, reason: b.reason };
}
