// `outbox` — L2. Fila durável, retry e reconciliação de §11.
//
// Transporte e projeção entram por portas injetadas. Assim a outbox não importa L3 nem decide
// domínio; ela apenas coordena os estados persistidos e exige a observação do `opId`.

import type {
  ManifestDb,
  DropReason,
  EnqueueResult,
  OutboxRow,
  OutboxState,
} from '../../l0/manifest/index.ts';

export type SubmitOk = { readonly ok: true; readonly seq: number; readonly hostTs?: number };
export type SubmitErr = { readonly ok: false; readonly code: string; readonly retryAfterMs?: number };
export type SubmitResult = SubmitOk | SubmitErr;
export type SubmitPort = (envelopes: readonly Buffer[]) => Promise<readonly SubmitResult[] | null>;

export type ObservedOp = { readonly seq: number };

export type OutboxObservation = {
  observedOp(opId: string): ObservedOp | null;
  watermark(item: Pick<OutboxRow, 'community_id' | 'sequence_scope' | 'author_seq'>): number;
  interpretedSeq(): number;
};

export type OutboxMetrics = {
  enqueued: number;
  submitted: number;
  acks: number;
  removedByObservation: number;
  ackMismatch: number;
  overtaken: number;
  reconciliations: number;
  dropped: Record<string, number>;
  attempts: number;
  breakerOpenings: number;
};

export type EnqueueMeta = {
  readonly opId: string;
  readonly channelId: string | null;
  readonly sequenceScope: string;
  readonly kind: number;
  readonly authorSeq: number;
  readonly clientRef?: string | null;
};

export type OutboxOptions = {
  readonly manifest: ManifestDb;
  readonly communityId: string;
  readonly submit: SubmitPort;
  readonly observation: OutboxObservation;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly maxItems?: number;
  readonly maxAgeMs?: number;
  readonly batchMax?: number;
  readonly backoffBaseMs?: number;
  readonly backoffMaxMs?: number;
  readonly breakerThreshold?: number;
  readonly breakerOpenMs?: number;
};

const DEFAULT_MAX_ITEMS = 500;
const DEFAULT_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const DEFAULT_BATCH_MAX = 32;
const DEFAULT_BACKOFF_BASE_MS = 1000;
const DEFAULT_BACKOFF_MAX_MS = 60_000;
const DEFAULT_BREAKER_THRESHOLD = 5;
const DEFAULT_BREAKER_OPEN_MS = 30_000;
const BACKOFF_JITTER = 0.2;

const TERMINAL_DROP_CODES = new Map<string, DropReason>([
  ['E_VERSION_UNSUPPORTED', 'client-outdated'],
  ['E_CHANNEL_NOT_FOUND', 'channel-deleted'],
  ['E_COMMUNITY_ENDED', 'community-ended'],
  ['E_BANNED', 'banned'],
  ['E_PERMISSION_DENIED', 'permission-lost'],
  ['E_CANNOT_EDIT_OTHERS', 'permission-lost'],
]);

export function newOutboxMetrics(): OutboxMetrics {
  return {
    enqueued: 0,
    submitted: 0,
    acks: 0,
    removedByObservation: 0,
    ackMismatch: 0,
    overtaken: 0,
    reconciliations: 0,
    dropped: {},
    attempts: 0,
    breakerOpenings: 0,
  };
}

function backoffMs(attempts: number, random: () => number, base: number, max: number): number {
  const nominal = Math.min(base * 2 ** attempts, max);
  return Math.round(nominal * (1 + (random() * 2 - 1) * BACKOFF_JITTER));
}

export class Outbox {
  readonly #manifest: ManifestDb;
  readonly #communityId: string;
  readonly #submit: SubmitPort;
  readonly #observation: OutboxObservation;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #maxItems: number;
  readonly #maxAgeMs: number;
  readonly #batchMax: number;
  readonly #backoffBaseMs: number;
  readonly #backoffMaxMs: number;
  readonly #breakerThreshold: number;
  readonly #breakerOpenMs: number;
  readonly metrics = newOutboxMetrics();
  #connectionFailures = 0;
  #breakerUntil = 0;
  #flushInFlight: Promise<number> | null = null;

  constructor(options: OutboxOptions) {
    this.#manifest = options.manifest;
    this.#communityId = options.communityId;
    this.#submit = options.submit;
    this.#observation = options.observation;
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? Math.random;
    this.#maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    this.#maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.#batchMax = options.batchMax ?? DEFAULT_BATCH_MAX;
    this.#backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.#backoffMaxMs = options.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.#breakerThreshold = options.breakerThreshold ?? DEFAULT_BREAKER_THRESHOLD;
    this.#breakerOpenMs = options.breakerOpenMs ?? DEFAULT_BREAKER_OPEN_MS;
  }

  /** Reserva o próximo número antes da assinatura do envelope, no escopo solicitado. */
  nextAuthorSeq(sequenceScope: string): number {
    return this.#manifest.nextAuthorSeq(this.#communityId, sequenceScope);
  }

  enqueue(envelope: Buffer, meta: EnqueueMeta, now = this.#now()): EnqueueResult | { readonly enqueued: false; readonly localSeq: null; readonly code: 'E_OUTBOX_FULL' } {
    if (this.#manifest.countActive(this.#communityId) >= this.#maxItems) {
      return { enqueued: false, localSeq: null, code: 'E_OUTBOX_FULL' };
    }
    const result = this.#manifest.enqueue({
      opId: meta.opId,
      communityId: this.#communityId,
      channelId: meta.channelId,
      sequenceScope: meta.sequenceScope,
      kind: meta.kind,
      authorSeq: meta.authorSeq,
      envelope,
      clientRef: meta.clientRef ?? null,
      now,
    });
    if (result.enqueued) this.metrics.enqueued++;
    return result;
  }

  /** Deve ser chamado uma vez no boot, antes do primeiro flush. */
  recoverOnBoot(now = this.#now()): number {
    return this.#manifest.recoverSending(now);
  }

  async flush(): Promise<number> {
    if (this.#flushInFlight !== null) return this.#flushInFlight;
    const run = this.#flushOnce();
    this.#flushInFlight = run.finally(() => {
      this.#flushInFlight = null;
    });
    return this.#flushInFlight;
  }

  async #flushOnce(): Promise<number> {
    if (this.#now() < this.#breakerUntil) return 0;
    const groups = this.#manifest.ready(this.#communityId, this.#now(), this.#batchMax);
    const batches = [...groups.values()];
    for (const batch of batches) {
      for (const item of batch) this.#manifest.setState(item.local_seq, 'sending');
      this.metrics.submitted += batch.length;
      this.metrics.attempts++;
    }
    const results = await Promise.all(batches.map((batch) => this.#submitBatch(batch)));
    return results.reduce((sum, n) => sum + n, 0);
  }

  async #submitBatch(batch: readonly OutboxRow[]): Promise<number> {
    let response: readonly SubmitResult[] | null;
    try {
      response = await this.#submit(batch.map((item) => item.envelope));
    } catch {
      response = null;
    }
    if (response === null) {
      this.#connectionFailures++;
      if (this.#connectionFailures >= this.#breakerThreshold) {
        this.#breakerUntil = this.#now() + this.#breakerOpenMs;
        this.#connectionFailures = 0;
        this.metrics.breakerOpenings++;
      }
      for (const item of batch) this.#returnToQueue(item, 'E_HOST_UNAVAILABLE', undefined, item.attempts + 1);
      return batch.length;
    }
    this.#connectionFailures = 0;
    for (let i = 0; i < batch.length; i++) this.#applyResult(batch[i] as OutboxRow, response[i]);
    return batch.length;
  }

  #applyResult(item: OutboxRow, result: SubmitResult | undefined): void {
    if (result === undefined || (!result.ok && result.code === 'E_NOT_ATTEMPTED')) {
      this.#manifest.setState(item.local_seq, 'queued', { next_attempt_at: this.#now() });
      return;
    }
    const attempts = item.attempts + 1;
    if (result.ok) {
      this.metrics.acks++;
      this.#manifest.setState(item.local_seq, 'awaiting-confirmation', {
        attempts,
        acked_seq: result.seq,
        last_error: null,
      });
      return;
    }
    if (result.code === 'E_DUPLICATE') {
      this.#manifest.setState(item.local_seq, 'awaiting-confirmation', {
        attempts,
        acked_seq: null,
        last_error: result.code,
      });
      return;
    }
    if (result.code === 'E_AUTHOR_SEQ_OVERTAKEN') {
      this.#manifest.setState(item.local_seq, 'failed', { attempts, last_error: result.code });
      return;
    }
    const dropReason = TERMINAL_DROP_CODES.get(result.code);
    if (dropReason !== undefined) {
      this.#drop(item, dropReason, attempts);
      return;
    }
    this.#returnToQueue(item, result.code, result.retryAfterMs, attempts);
  }

  #returnToQueue(item: OutboxRow, code: string, retryAfterMs?: number, attempts: number = item.attempts): void {
    const nextAttemptAt = this.#now() + backoffMs(attempts, this.#random, this.#backoffBaseMs, this.#backoffMaxMs);
    this.#manifest.setState(item.local_seq, 'queued', {
      attempts,
      next_attempt_at: retryAfterMs === undefined ? nextAttemptAt : Math.max(nextAttemptAt, this.#now() + retryAfterMs),
      last_error: code,
      acked_seq: null,
    });
  }

  #drop(item: OutboxRow, reason: DropReason, attempts?: number): void {
    this.#manifest.setState(item.local_seq, 'dropped', {
      ...(attempts === undefined ? {} : { attempts }),
      dropped_reason: reason,
      acked_seq: null,
    });
    this.metrics.dropped[reason] = (this.metrics.dropped[reason] ?? 0) + 1;
  }

  /** Reconcilia por identidade da operação, com watermark somente como pré-filtro. */
  reconcile(now = this.#now()): { readonly removed: number; readonly mismatch: number; readonly expired: number } {
    this.metrics.reconciliations++;
    let removed = 0;
    let mismatch = 0;
    let expired = 0;
    for (const item of this.#manifest.all(this.#communityId)) {
      if (item.state === 'dropped') continue;
      const observed = this.#observation.observedOp(item.op_id);
      if (observed !== null) {
        this.#manifest.remove(item.local_seq);
        this.metrics.removedByObservation++;
        removed++;
        continue;
      }

      if (this.#observation.watermark(item) >= item.author_seq) {
        if (item.state !== 'failed' || item.last_error !== 'E_AUTHOR_SEQ_OVERTAKEN') {
          this.#manifest.setState(item.local_seq, 'failed', { last_error: 'E_AUTHOR_SEQ_OVERTAKEN' });
          this.metrics.overtaken++;
        }
        continue;
      }

      if (item.acked_seq !== null && this.#observation.interpretedSeq() >= item.acked_seq) {
        this.#manifest.setState(item.local_seq, 'queued', {
          acked_seq: null,
          last_error: 'E_ACK_MISMATCH',
          next_attempt_at: now,
        });
        this.metrics.ackMismatch++;
        mismatch++;
        continue;
      }

      if (now - item.created_at > this.#maxAgeMs && item.acked_seq === null) {
        this.#drop(item, 'expired');
        expired++;
      }
    }
    return { removed, mismatch, expired };
  }

  cancelQueued(opId: string): { readonly ok: true } | { readonly ok: false; readonly code: 'E_NOT_FOUND' | 'E_ALREADY_SENT' } {
    const item = this.#manifest.byOpId(opId);
    if (item === undefined) return { ok: false, code: 'E_NOT_FOUND' };
    if (item.state === 'sending' || item.state === 'awaiting-confirmation') {
      return { ok: false, code: 'E_ALREADY_SENT' };
    }
    this.#drop(item, 'cancelled');
    return { ok: true };
  }

  /** `message.retry` requeues the stored envelope; it never rebuilds or reass signs the op. */
  retry(opId: string, now = this.#now()):
    | { readonly ok: true; readonly state: 'queued' }
    | { readonly ok: false; readonly code: 'E_NOT_FOUND' | 'E_ALREADY_SENT' | 'E_AUTHOR_SEQ_OVERTAKEN' } {
    const item = this.#manifest.byOpId(opId);
    if (item === undefined) return { ok: false, code: 'E_NOT_FOUND' };
    if (item.state === 'sending' || item.state === 'awaiting-confirmation') {
      return { ok: false, code: 'E_ALREADY_SENT' };
    }
    if (item.last_error === 'E_AUTHOR_SEQ_OVERTAKEN') {
      return { ok: false, code: 'E_AUTHOR_SEQ_OVERTAKEN' };
    }
    this.#manifest.setState(item.local_seq, 'queued', { acked_seq: null, next_attempt_at: now });
    return { ok: true, state: 'queued' };
  }
}

export type { OutboxRow, OutboxState, DropReason } from '../../l0/manifest/index.ts';
