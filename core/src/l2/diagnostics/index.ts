// `diagnostics` — L2. NAT, peers e snapshot de métricas (§4; §15.4 `diag.*`).
//
// §4: depende de `swarm` (L0) e `metrics` (L0); **não pode bloquear o event loop**.
//
// Como cada peça entra:
//   - `peerCount` vem do `swarm` injetado (`getStats()` de §14.2);
//   - `metrics` (L0) ainda não tem módulo próprio no núcleo — os contadores vivem nos
//     detentores de estado (fold/projector/outbox/host). Em vez de inventar um registro
//     central fora desta fase, o módulo declara a **porta** `DiagnosticsMetricsPort`; a
//     composição agrega os contadores existentes e injeta a implementação;
//   - `natType` (gauge `swarm.natType` de §24.3: open/moderate/cgnat) é resultado do probe
//     do HyperDHT, que pertence à composição — porta `DiagnosticsNatPort`;
//   - `stunReachable` exige enviar um Binding RFC 5389 pela socket real — rede de verdade,
//     porta assíncrona `DiagnosticsStunPort`;
//   - `relayAvailable` é fato da instalação (host servindo TURN com capacidade ou
//     voluntário ativo) — porta síncrona `DiagnosticsRelayPort`.
//
// Event loop: `run()` nunca executa trabalho de CPU por conta própria e nunca espera além
// do teto injetado — as sondas rodam em paralelo sob `Promise.allSettled` com corrida contra
// um timer `unref()`d. Falha ou estouro de prazo não rejeita: `diag.run` não cataloga erro
// (§15.4), então devolve o resultado conservador (`stunReachable=false`,
// `natType='cgnat'`) — pior caso assumido, nunca otimismo de conectividade.

import type { Swarm } from '../../l0/swarm/index.ts';

export type NatType = 'open' | 'moderate' | 'cgnat';

/** Porta do probe NAT do DHT (gauge `swarm.natType`, §24.3) — implementada pela composição. */
export interface DiagnosticsNatPort {
  /** Resolve com o tipo observado; rejeita quando a sonda não responde. */
  probe(): Promise<NatType>;
}

/**
 * Porta do probe STUN (Binding RFC 5389 sobre a socket do DHT, §17.3). Resolve `true`
 * quando uma resposta chega dentro do prazo da composição; rejeita caso contrário.
 */
export interface DiagnosticsStunPort {
  probe(): Promise<boolean>;
}

/** Disponibilidade de caminho TURN/relay nesta instalação — fato da composição (§17.3/§17.7). */
export interface DiagnosticsRelayPort {
  available(): boolean;
}

/** Resumo de histograma — o que `diag.snapshot` expõe sem exportar série crua. */
export type HistogramSummary = {
  readonly count: number;
  readonly sum: number;
  readonly max: number;
};

/**
 * Snapshot das métricas de §24.3, agregado pela composição a partir dos detentores de
 * estado (fold/projector/outbox/swarm/host). Chaves livres — a taxonomia fechada é a da
 * tabela de §24.3, não deste tipo.
 */
export type MetricsSnapshot = {
  readonly gauges: Readonly<Record<string, number>>;
  readonly counters: Readonly<Record<string, number>>;
  readonly histograms: Readonly<Record<string, HistogramSummary>>;
};

/** Porta do snapshot de métricas — implementada pela composição sobre o `metrics` L0. */
export interface DiagnosticsMetricsPort {
  snapshot(): MetricsSnapshot;
}

/** Contrato exato de `diag.run` (§15.4). Sem campos extras. */
export type DiagRunResult = {
  readonly natType: NatType;
  readonly peerCount: number;
  readonly relayAvailable: boolean;
  readonly stunReachable: boolean;
  readonly ranAt: number;
};

/** Default operacional até a config L0 resolver o valor de §27.2 para esta instalação. */
export const DIAG_PROBE_TIMEOUT_MS = 5_000;

const TIMED_OUT: unique symbol = Symbol('diag-timeout');

/**
 * Corrida contra o prazo. Rejeição da sonda e estouro de prazo caem no mesmo resultado
 * conservador (`TIMED_OUT`) — `diag.run` não cataloga erro (§15.4), nunca rejeita. O timer
 * fica referenciado (sem `unref`) e é sempre limpo no `finally`: quem o derruba é o fim da
 * corrida, não um handle externo.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  return Promise.race([
    promise.then((v) => v, (): typeof TIMED_OUT => TIMED_OUT),
    deadline,
  ]).finally(() => clearTimeout(timer));
}

export type DiagnosticsOptions = {
  readonly swarm: Swarm;
  readonly nat: DiagnosticsNatPort;
  readonly stun: DiagnosticsStunPort;
  readonly relay: DiagnosticsRelayPort;
  readonly metrics: DiagnosticsMetricsPort;
  readonly clock?: { now(): number };
  readonly probeTimeoutMs?: number;
};

export class Diagnostics {
  readonly #swarm: DiagnosticsOptions['swarm'];
  readonly #nat: DiagnosticsNatPort;
  readonly #stun: DiagnosticsStunPort;
  readonly #relay: DiagnosticsRelayPort;
  readonly #metrics: DiagnosticsMetricsPort;
  readonly #clock: { now(): number };
  readonly #probeTimeoutMs: number;

  constructor(opts: DiagnosticsOptions) {
    this.#swarm = opts.swarm;
    this.#nat = opts.nat;
    this.#stun = opts.stun;
    this.#relay = opts.relay;
    this.#metrics = opts.metrics;
    this.#clock = opts.clock ?? { now: () => Date.now() };
    this.#probeTimeoutMs = opts.probeTimeoutMs ?? DIAG_PROBE_TIMEOUT_MS;
  }

  /**
   * `diag.run` → `{natType, peerCount, relayAvailable, stunReachable, ranAt}` (§15.4).
   * Assíncrono e concorrente: as duas sondas de rede correm juntas, cada uma sob o mesmo
   * teto; nada aqui é CPU-bound nem síncrono-bloqueante.
   */
  async run(): Promise<DiagRunResult> {
    const [nat, stun] = await Promise.all([
      withTimeout(this.#nat.probe(), this.#probeTimeoutMs),
      withTimeout(this.#stun.probe(), this.#probeTimeoutMs),
    ]);

    return {
      // Estouro/falha do probe NAT → pior caso assumido; nunca otimismo de conectividade.
      natType: nat === TIMED_OUT ? 'cgnat' : nat,
      peerCount: this.#swarm.getStats().peerCount,
      relayAvailable: this.#relay.available(),
      stunReachable: stun === true,
      ranAt: this.#clock.now(),
    };
  }

  /** `diag.snapshot` — métricas de §24.3, lidas da porta da composição. */
  snapshot(): MetricsSnapshot {
    return this.#metrics.snapshot();
  }
}
