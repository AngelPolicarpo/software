// `communityClient` — L2. Replicação, autorização de canal e estados visíveis de §14.
//
// §4: depende de `swarm` (L0), `corestore` (L0), `projector` (L1→L0) e `outbox` (L2 porta rpcClient).
// Não appenda no core (só `communityHost` faz), não decide domínio — apenas replica,
// interpreta e publica o estado de rede que a UI consome.
// §14.2: usa o escalonador do `swarm` para multicomunidade.
// §14.3: autorização de canal de replicação por comunidade.
// §14.5: `synced`/`catching-up`/`stalled`/`blocked`/`unauthorized`/`forked` + watchdog.
// §6.15: não-lidas são LS em `manifest.db`; o cálculo é puro e o `projector` é o escritor
// de `view.db` — a atualização incremental vive no `CommunityClient` após cada lote (§10.5).

import type { Swarm } from '../../l0/swarm/index.ts';
import type { CoreHandle } from '../../l0/corestore/index.ts';
import type { Projector } from '../../l1/projector/index.ts';

export type ReplicationState = 'synced' | 'catching-up' | 'stalled' | 'blocked' | 'unauthorized' | 'forked';

export type ReplicationInfo = {
  readonly state: ReplicationState;
  readonly lag: number;
  readonly etaMs?: number;
  readonly reason?: 'no-provider' | 'gap';
};

export type WatchdogEvent =
  | { readonly topic: 'community.replication'; readonly data: { readonly communityId: string; readonly state: ReplicationState; readonly lag: number; readonly reason?: 'no-provider' | 'gap'; readonly etaMs?: number } }
  | { readonly topic: 'community.accessRevoked'; readonly data: { readonly communityId: string; readonly cause: 'banned' | 'kicked' | 'unauthorized' } }
  | { readonly topic: 'community.forked'; readonly data: { readonly communityId: string } };

export type CommunityClientOptions = {
  readonly swarm: Swarm;
  readonly clock?: { now(): number };
  readonly helloIntervalMs?: number;
  readonly replicationStallMs?: number;
  readonly replicationWatchMs?: number;
  readonly onEvent?: (ev: WatchdogEvent) => void;
};

export type CommunityHandle = {
  readonly communityId: string;
  readonly core: CoreHandle;
  readonly projector: Projector;
  isHosted?: boolean;
};

const DEFAULT_HELLO_MS = 30_000;
const DEFAULT_WATCH_MS = 5_000;
const DEFAULT_STALL_MS = 20_000;

/**
 * §14.5: determina o estado de replicação a partir de métricas observáveis.
 *
 * - `synced`: interpretedSeq === core.length-1 && host respondeu no último HELLO_INTERVAL
 * - `catching-up`: lag>0 e avançando
 * - `stalled`: lag>0 e sem avanço por REPLICATION_STALL_MS
 * - `blocked`: core anuncia comprimento maior que o disponível em qualquer par (gap)
 * - `unauthorized`: todos os pares recusaram o canal (§14.3)
 * - `forked`: bloco conflitante detectado (§5.5 L-4)
 */
export function computeReplicationState(args: {
  readonly coreLength: number;
  readonly interpretedSeq: number;
  readonly now: number;
  readonly lastProgressAt: number | null;
  readonly lastHelloAt: number | null;
  readonly helloIntervalMs: number;
  readonly stallMs: number;
  readonly unauthorized: boolean;
  readonly forked: boolean;
  readonly blocked: boolean;
}): ReplicationState {
  if (args.forked) return 'forked';
  if (args.unauthorized) return 'unauthorized';
  if (args.blocked) return 'blocked';
  const lag = args.coreLength - (args.interpretedSeq + 1);
  if (lag <= 0) {
    const helloOk = args.lastHelloAt !== null && args.now - args.lastHelloAt <= args.helloIntervalMs;
    return helloOk ? 'synced' : 'catching-up';
  }
  // lag > 0
  const stalled = args.lastProgressAt !== null && args.now - args.lastProgressAt >= args.stallMs;
  if (stalled) return 'stalled';
  return 'catching-up';
}

export function lagOf(coreLength: number, interpretedSeq: number): number {
  return Math.max(0, coreLength - (interpretedSeq + 1));
}

type PerCommunity = {
  handle: CommunityHandle;
  lastProgressAt: number | null;
  lastInterpretedSeq: number;
  lastHelloAt: number | null;
  unauthorized: boolean;
  forked: boolean;
  blocked: boolean;
  state: ReplicationState;
};

export class CommunityClient {
  readonly #swarm: Swarm;
  readonly #clock: { now(): number };
  readonly #helloIntervalMs: number;
  readonly #stallMs: number;
  readonly #watchMs: number;
  readonly #onEvent: (ev: WatchdogEvent) => void;
  readonly #communities = new Map<string, PerCommunity>();
  #watchTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: CommunityClientOptions) {
    this.#swarm = opts.swarm;
    this.#clock = opts.clock ?? { now: () => Date.now() };
    this.#helloIntervalMs = opts.helloIntervalMs ?? DEFAULT_HELLO_MS;
    this.#stallMs = opts.replicationStallMs ?? DEFAULT_STALL_MS;
    this.#watchMs = opts.replicationWatchMs ?? DEFAULT_WATCH_MS;
    this.#onEvent = opts.onEvent ?? (() => {});
  }

  addCommunity(handle: CommunityHandle): void {
    const now = this.#clock.now();
    const lagState: ReplicationState = computeReplicationState({
      coreLength: handle.core.length,
      interpretedSeq: handle.projector.interpretedSeq,
      now,
      lastProgressAt: now,
      lastHelloAt: null,
      helloIntervalMs: this.#helloIntervalMs,
      stallMs: this.#stallMs,
      unauthorized: false,
      forked: false,
      blocked: false,
    });
    this.#communities.set(handle.communityId, {
      handle,
      lastProgressAt: now,
      lastInterpretedSeq: handle.projector.interpretedSeq,
      lastHelloAt: null,
      unauthorized: false,
      forked: false,
      blocked: false,
      state: lagState,
    });
    // swarm join do tópico do log (§14.1)
    const topicHex = handle.core.key.toString('hex');
    this.#swarm.join(topicHex, { topicHex, kind: 'community-log', communityId: handle.communityId });
  }

  removeCommunity(communityId: string): void {
    const entry = this.#communities.get(communityId);
    if (entry === undefined) return;
    const topicHex = entry.handle.core.key.toString('hex');
    this.#swarm.leave(topicHex);
    this.#communities.delete(communityId);
  }

  /** Chamado quando o host responde `hello` naquela comunidade (§14.5 synced). */
  markHello(communityId: string, at = this.#clock.now()): void {
    const entry = this.#communities.get(communityId);
    if (entry === undefined) return;
    entry.lastHelloAt = at;
    this.#recompute(communityId);
  }

  markUnauthorized(communityId: string, revoked: boolean): void {
    const entry = this.#communities.get(communityId);
    if (entry === undefined) return;
    entry.unauthorized = revoked;
    this.#recompute(communityId, revoked ? 'unauthorized' : undefined);
  }

  markForked(communityId: string): void {
    const entry = this.#communities.get(communityId);
    if (entry === undefined) return;
    entry.forked = true;
    this.#recompute(communityId, 'forked');
  }

  markBlocked(communityId: string, blocked: boolean): void {
    const entry = this.#communities.get(communityId);
    if (entry === undefined) return;
    entry.blocked = blocked;
    this.#recompute(communityId);
  }

  /** Deve ser chamado após cada lote do projector (avanço de interpretedSeq). */
  notifyProgress(communityId: string): void {
    const entry = this.#communities.get(communityId);
    if (entry === undefined) return;
    entry.lastProgressAt = this.#clock.now();
    entry.lastInterpretedSeq = entry.handle.projector.interpretedSeq;
    this.#recompute(communityId);
  }

  getState(communityId: string): ReplicationInfo | null {
    const e = this.#communities.get(communityId);
    if (e === undefined) return null;
    const lag = lagOf(e.handle.core.length, e.handle.projector.interpretedSeq);
    const st: ReplicationInfo = { state: e.state, lag };
    if (e.state === 'stalled') return { ...st, reason: 'no-provider' as const };
    if (e.state === 'blocked') return { ...st, reason: 'gap' as const };
    return st;
  }

  listStates(): Map<string, ReplicationInfo> {
    const out = new Map<string, ReplicationInfo>();
    for (const [cid] of this.#communities) {
      const s = this.getState(cid);
      if (s !== null) out.set(cid, s);
    }
    return out;
  }

  /** §14.5 watchdog: compara core.length vs interpretedSeq e publica transição. */
  watchdogTick(now = this.#clock.now()): WatchdogEvent[] {
    const events: WatchdogEvent[] = [];
    for (const [cid, entry] of this.#communities) {
      // detecta progresso silencioso
      const curSeq = entry.handle.projector.interpretedSeq;
      if (curSeq !== entry.lastInterpretedSeq) {
        entry.lastInterpretedSeq = curSeq;
        entry.lastProgressAt = now;
      }
      const prev = entry.state;
      const next = computeReplicationState({
        coreLength: entry.handle.core.length,
        interpretedSeq: curSeq,
        now,
        lastProgressAt: entry.lastProgressAt,
        lastHelloAt: entry.lastHelloAt,
        helloIntervalMs: this.#helloIntervalMs,
        stallMs: this.#stallMs,
        unauthorized: entry.unauthorized,
        forked: entry.forked,
        blocked: entry.blocked,
      });
      if (next !== prev) {
        entry.state = next;
        if (next === 'unauthorized') {
          const ev: WatchdogEvent = { topic: 'community.accessRevoked', data: { communityId: cid, cause: 'unauthorized' } };
          events.push(ev);
          this.#onEvent(ev);
        } else if (next === 'forked') {
          const ev: WatchdogEvent = { topic: 'community.forked', data: { communityId: cid } };
          events.push(ev);
          this.#onEvent(ev);
        } else {
          const lag = lagOf(entry.handle.core.length, curSeq);
          const reason = next === 'stalled' ? 'no-provider' as const : next === 'blocked' ? 'gap' as const : undefined;
          const data = reason === undefined ? { communityId: cid, state: next, lag } : { communityId: cid, state: next, lag, reason };
          const ev: WatchdogEvent = { topic: 'community.replication', data };
          events.push(ev);
          this.#onEvent(ev);
        }
      }
    }
    return events;
  }

  startWatchdog(): void {
    if (this.#watchTimer !== null) return;
    this.#watchTimer = setInterval(() => this.watchdogTick(), this.#watchMs);
    if ((this.#watchTimer as unknown as { unref?: () => void }).unref !== undefined) {
      (this.#watchTimer as unknown as { unref(): void }).unref();
    }
  }

  stopWatchdog(): void {
    if (this.#watchTimer !== null) {
      clearInterval(this.#watchTimer);
      this.#watchTimer = null;
    }
  }

  /** §14.2: delega ao swarm o cálculo de orçamento para as comunidades conhecidas. */
  allocationFor(swarmActiveId: string | null, hostedIds: ReadonlySet<string>): ReadonlyMap<string, number> {
    return this.#swarm.allocateForCommunities([...this.#communities.keys()], swarmActiveId, hostedIds);
  }

  #recompute(communityId: string, forced?: ReplicationState): void {
    const e = this.#communities.get(communityId)!;
    const now = this.#clock.now();
    const computed = forced ?? computeReplicationState({
      coreLength: e.handle.core.length,
      interpretedSeq: e.handle.projector.interpretedSeq,
      now,
      lastProgressAt: e.lastProgressAt,
      lastHelloAt: e.lastHelloAt,
      helloIntervalMs: this.#helloIntervalMs,
      stallMs: this.#stallMs,
      unauthorized: e.unauthorized,
      forked: e.forked,
      blocked: e.blocked,
    });
    if (computed === e.state) return;
    e.state = computed;
    const lag = lagOf(e.handle.core.length, e.handle.projector.interpretedSeq);
    if (computed === 'unauthorized') {
      this.#onEvent({ topic: 'community.accessRevoked', data: { communityId, cause: 'unauthorized' } });
    } else if (computed === 'forked') {
      this.#onEvent({ topic: 'community.forked', data: { communityId } });
    } else {
      const reason = computed === 'stalled' ? 'no-provider' as const : computed === 'blocked' ? 'gap' as const : undefined;
      const data = reason === undefined ? { communityId, state: computed, lag } : { communityId, state: computed, lag, reason };
      this.#onEvent({ topic: 'community.replication', data });
    }
  }

  close(): void {
    this.stopWatchdog();
    for (const cid of [...this.#communities.keys()]) this.removeCommunity(cid);
  }
}

// ── Não-lidas §6.15 ──────────────────────────────────────────────────────────────

/**
 * §6.15: `unreadCount` por canal = mensagens com `seq > lastReadSeq` cujo autor não é a
 * identidade local, não deletadas e não `hiddenByBan`; `pendingMentions` = subconjunto que
 * menciona a identidade, um cargo dela ou `everyone` efetivo — menção conta mesmo em canal
 * silenciado. `firstUnreadSeq` é o menor `seq` do conjunto.
 *
 * Função pura para o cálculo — o armazenamento em `manifest.local_read_state` e a
 * atualização incremental por lote (§10.5) são feitos pelo CommunityClient/projector;
 * o boot recomputa quando `last_read_seq > interpretedSeq` (§10.5 barreira).
 */
export function computeUnreadForChannel(args: {
  readonly lastReadSeq: number;
  readonly localKeyHex: string;
  readonly localRoleIds: ReadonlySet<string>;
  readonly messages: ReadonlyArray<{
    readonly seq: number;
    readonly authorKeyHex: string;
    readonly deleted: boolean;
    readonly hiddenByBan: boolean;
    readonly mentionEveryoneEffective: boolean;
    readonly mentions: readonly string[];
  }>;
}): { readonly unreadCount: number; readonly pendingMentions: number; readonly firstUnreadSeq: number | null } {
  let unreadCount = 0;
  let pendingMentions = 0;
  let firstUnreadSeq: number | null = null;
  for (const m of args.messages) {
    if (m.seq <= args.lastReadSeq) continue;
    if (m.deleted || m.hiddenByBan) continue;
    if (m.authorKeyHex === args.localKeyHex) continue;
    unreadCount++;
    if (firstUnreadSeq === null || m.seq < firstUnreadSeq) firstUnreadSeq = m.seq;
    const mentionsMe =
      m.mentions.includes(args.localKeyHex) ||
      m.mentionEveryoneEffective ||
      m.mentions.some((id) => args.localRoleIds.has(id));
    if (mentionsMe) pendingMentions++;
  }
  return { unreadCount, pendingMentions, firstUnreadSeq };
}
