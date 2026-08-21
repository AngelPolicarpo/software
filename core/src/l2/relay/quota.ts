// `relay` — cota do TURN restrito do voluntário (§17.7, A21).
//
// §17.7: "`RELAY_MAX_BYTES_PER_DAY` (default 5 GiB) e `RELAY_MAX_ALLOCS` (default 4);
// atingido, o voluntário **para de aceitar** e emite `relay.stateChanged`." Os defaults
// moram na config L0 (§27.2) e chegam aqui injetados. A janela de bytes é decisão
// operacional desta implementação (§27.2, não protocolo): 24 h a partir do primeiro byte
// da janela corrente — virou a janela, contadores zeram e a suspensão por bytes cai.
//
// Alocações: até `maxAllocs` pares simultâneos; além disso o par novo é recusado enquanto
 // as ativas não terminam — sem suspender o voluntário inteiro, que continua servindo os
// pares já admitidos. Suspensão total só por bytes.

type KeyHex = string;

export type QuotaRefusal = 'alloc-limit' | 'bytes-quota';

const DAY_MS = 24 * 60 * 60 * 1000;

export class RelayQuota {
  readonly #maxBytesPerDay: number;
  readonly #maxAllocs: number;
  readonly #allocs = new Set<KeyHex>();
  #bytesInWindow = 0;
  #windowStart = 0;
  suspended: QuotaRefusal | null = null;

  constructor(opts: { maxBytesPerDay: number; maxAllocs: number }) {
    this.#maxBytesPerDay = opts.maxBytesPerDay;
    this.#maxAllocs = opts.maxAllocs;
  }

  get activeAllocs(): number {
    return this.#allocs.size;
  }

  /** Bytes retransmitidos na janela corrente; rola a janela se ela venceu. */
  bytesInWindow(now: number): number {
    this.#rollWindow(now);
    return this.#bytesInWindow;
  }

  /** Ms restantes da janela corrente; 0 quando nenhuma janela começou. */
  windowRemainingMs(now: number): number {
    this.#rollWindow(now);
    return this.#windowStart === 0 ? 0 : Math.max(0, DAY_MS - (now - this.#windowStart));
  }

  /**
   * Admissão de um par no TURN restrito. Par já ativo é sempre readmitido; par novo
   * respeita `maxAllocs`. Não suspende o voluntário: recusa pontual.
   */
  tryAllocate(keyHex: KeyHex, now: number): { ok: true } | { ok: false; reason: QuotaRefusal } {
    this.#rollWindow(now);
    if (this.suspended === 'bytes-quota') return { ok: false, reason: 'bytes-quota' };
    if (this.#allocs.has(keyHex)) return { ok: true };
    if (this.#allocs.size >= this.#maxAllocs) {
      if (this.suspended === null) this.suspended = 'alloc-limit';
      return { ok: false, reason: 'alloc-limit' };
    }
    this.#allocs.add(keyHex);
    return { ok: true };
  }

  release(keyHex: KeyHex): void {
    this.#allocs.delete(keyHex);
    // liberar uma alocação reabre admissão mesmo com a marca alloc-limit viva
    if (this.suspended === 'alloc-limit' && this.#allocs.size < this.#maxAllocs) this.suspended = null;
  }

  recordBytes(n: number, now: number): void {
    if (!Number.isFinite(n) || n <= 0) return;
    this.#rollWindow(now);
    if (this.#windowStart === 0) this.#windowStart = now;
    this.#bytesInWindow += n;
    if (this.#bytesInWindow >= this.#maxBytesPerDay && this.suspended === null) {
      this.suspended = 'bytes-quota';
    }
  }

  #rollWindow(now: number): void {
    if (this.#windowStart !== 0 && now - this.#windowStart >= DAY_MS) {
      this.#windowStart = 0;
      this.#bytesInWindow = 0;
      if (this.suspended === 'bytes-quota') this.suspended = null;
    }
  }
}
