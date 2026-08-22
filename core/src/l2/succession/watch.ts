// `succession` — relógio de inatividade do host (§18.8, A23).
//
// "Depois de `HOST_INACTIVITY_MS` (default 30 dias) sem novo registro no log, o sucessor
// de maior prioridade pode assumir." O ttl é constante de protocolo do `fold` (§27.1) e
// chega injetado — §4 não declara `fold`… declara agora (emenda de §27), mas o valor
// continua chegando por injeção pelo mesmo motivo das demais constantes: uma constante
// nunca é transcrita duas vezes.

export class InactivityWatch {
  readonly #ttlMs: number;

  constructor(opts: { ttlMs: number }) {
    this.#ttlMs = opts.ttlMs;
  }

  get ttlMs(): number {
    return this.#ttlMs;
  }

  /** `hostTs − lastHostTs(origem) ≥ HOST_INACTIVITY_MS` (camada b de R-18). */
  isInactive(lastOriginLogTs: number, now: number): boolean {
    return now - lastOriginLogTs >= this.#ttlMs;
  }

  /** Quanto falta para o grace period abrir; 0 quando já aberto. */
  graceRemainingMs(lastOriginLogTs: number, now: number): number {
    return Math.max(0, this.#ttlMs - (now - lastOriginLogTs));
  }
}
