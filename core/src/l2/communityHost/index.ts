// `communityHost` — L2. Admissão serializada e group commit de §11.4/§11.5.
//
// A porta de transporte é injetada por L3. O host decide contra o `DecisionState` em memória,
// mas mantém o append fora da seção crítica para que o grupo possa crescer.

import {
  foldRecord,
  type DecisionState,
  type FoldResult,
} from '../../l1/fold/index.ts';

export type AppendableCore = {
  readonly length: number;
  append(blocks: readonly Uint8Array[]): Promise<void>;
};

export type HostSubmitOk = { readonly ok: true; readonly seq: number; readonly hostTs: number };
export type HostSubmitErr = { readonly ok: false; readonly code: string };
export type HostSubmitResult = HostSubmitOk | HostSubmitErr;

export type HostAdmissionOptions = {
  readonly core: AppendableCore;
  readonly state: DecisionState;
  readonly makeHostRecord: (envelope: Uint8Array, hostTs: number) => Uint8Array;
  readonly now?: () => number;
  readonly groupWindowMs?: number;
  readonly groupMax?: number;
  readonly queueDepth?: number;
};

export type HostMetrics = {
  admitted: number;
  rejected: number;
  groups: number;
  groupedRecords: number;
  largestGroup: number;
  appendFailures: number;
};

type Pending = {
  readonly seq: number;
  readonly hostTs: number;
  readonly record: Uint8Array;
  readonly resolve: (result: HostSubmitResult) => void;
};

type Group = {
  readonly before: DecisionState;
  state: DecisionState;
  readonly pending: Pending[];
};

type Decision =
  | { readonly immediate: HostSubmitResult }
  | { readonly pending: Promise<HostSubmitResult> }
  | { readonly wait: Promise<void> };

export class HostAdmission {
  readonly #core: AppendableCore;
  readonly #makeHostRecord: HostAdmissionOptions['makeHostRecord'];
  readonly #now: () => number;
  readonly #groupWindowMs: number;
  readonly #groupMax: number;
  readonly #queueDepth: number;
  readonly metrics: HostMetrics = {
    admitted: 0,
    rejected: 0,
    groups: 0,
    groupedRecords: 0,
    largestGroup: 0,
    appendFailures: 0,
  };
  #committed: DecisionState;
  #group: Group | null = null;
  #timer: NodeJS.Timeout | null = null;
  #critical: Promise<void> = Promise.resolve();
  #flushScheduled: Promise<void> | null = null;
  #commitInFlight: Promise<void> | null = null;
  #queued = 0;

  constructor(options: HostAdmissionOptions) {
    this.#core = options.core;
    this.#committed = options.state;
    this.#makeHostRecord = options.makeHostRecord;
    this.#now = options.now ?? Date.now;
    this.#groupWindowMs = options.groupWindowMs ?? 4;
    this.#groupMax = options.groupMax ?? 64;
    this.#queueDepth = options.queueDepth ?? 512;
  }

  get state(): DecisionState {
    return this.#committed;
  }

  async submit(envelope: Uint8Array): Promise<HostSubmitResult> {
    if (this.#queued >= this.#queueDepth) return { ok: false, code: 'E_BUSY' };
    this.#queued++;
    try {
      for (;;) {
        const decision = await this.#runCritical(() => this.#decide(envelope));
        if ('wait' in decision) {
          await decision.wait.catch(() => {});
          continue;
        }
        if ('immediate' in decision) return decision.immediate;
        return decision.pending;
      }
    } finally {
      this.#queued--;
    }
  }

  async drain(): Promise<void> {
    const scheduled = await this.#runCritical(() => {
      this.#closeGroup();
      return { promise: this.#flushScheduled };
    });
    if (scheduled.promise !== null) await scheduled.promise.catch(() => {});
    const flight = await this.#runCritical(() => ({ promise: this.#commitInFlight }));
    if (flight.promise !== null) await flight.promise.catch(() => {});
  }

  #decide(envelope: Uint8Array): Decision {
    if (this.#flushScheduled !== null) return { wait: this.#flushScheduled };
    if (this.#commitInFlight !== null) return { wait: this.#commitInFlight };
    const group = this.#group ?? { before: this.#committed, state: this.#committed, pending: [] };
    this.#group = group;
    const hostTs = Math.max(this.#now(), group.state.lastHostTs);
    const seq = group.state.interpretedSeq + 1;
    const raw = this.#makeHostRecord(envelope, hostTs);
    let result: FoldResult;
    try {
      result = foldRecord(group.state, raw, seq);
    } catch {
      result = { decision: 'REJECTED', reason: 'E_INTERNAL', effects: [], next: group.state };
    }
    if (result.decision !== 'APPLIED') {
      this.metrics.rejected++;
      return { immediate: { ok: false, code: result.reason ?? 'E_INTERNAL' } };
    }

    group.state = result.next;
    const pending = new Promise<HostSubmitResult>((resolve) => {
      group.pending.push({ seq, hostTs, record: raw, resolve });
    });
    if (group.pending.length >= this.#groupMax) this.#closeGroup();
    else if (this.#timer === null) {
      this.#timer = setTimeout(() => this.#closeGroup(), this.#groupWindowMs);
      this.#timer.unref?.();
    }
    return { pending };
  }

  #closeGroup(): void {
    if (this.#group === null || this.#group.pending.length === 0 || this.#flushScheduled !== null) return;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const run = this.#flushGroup();
    let scheduled!: Promise<void>;
    scheduled = run.finally(() => {
      if (this.#flushScheduled === scheduled) this.#flushScheduled = null;
    });
    this.#flushScheduled = scheduled;
  }

  async #flushGroup(): Promise<void> {
    const taken = await this.#runCritical(() => {
      if (this.#group === null || this.#group.pending.length === 0) return null;
      const group = this.#group;
      this.#group = null;
      let flight!: Promise<void>;
      flight = this.#appendGroup(group).finally(async () => {
        await this.#runCritical(() => {
          if (this.#commitInFlight === flight) this.#commitInFlight = null;
        });
      });
      this.#commitInFlight = flight;
      return { flight };
    });
    if (taken !== null) await taken.flight;
  }

  async #appendGroup(group: Group): Promise<void> {
    try {
      await this.#core.append(group.pending.map((pending) => pending.record));
      this.metrics.groups++;
      this.metrics.groupedRecords += group.pending.length;
      this.metrics.largestGroup = Math.max(this.metrics.largestGroup, group.pending.length);
      await this.#runCritical(() => {
        this.#committed = group.state;
      });
      this.metrics.admitted += group.pending.length;
      for (const pending of group.pending) pending.resolve({ ok: true, seq: pending.seq, hostTs: pending.hostTs });
    } catch {
      this.metrics.appendFailures++;
      for (const pending of group.pending) pending.resolve({ ok: false, code: 'E_STORAGE_FULL' });
    }
  }

  #runCritical<T>(fn: () => T): Promise<T> {
    const previous = this.#critical;
    let release!: () => void;
    this.#critical = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(fn).finally(release);
  }
}
