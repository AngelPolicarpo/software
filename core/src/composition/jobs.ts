// O trabalho periódico do núcleo vivo — jobs de §22.2 e loops permanentes de §22.1.
//
// Raiz de composição (§4): cada entrada é uma chamada a um módulo que existe — o que mora
// aqui é a **cadência** e o cancelamento, nunca decisão de domínio.
//
// §22.5 é a regra que dá forma ao arquivo: nenhum job sobrevive ao fechamento do seu escopo.
// Como todos os jobs desta fase são por instalação (não por comunidade), o escopo é o do
// núcleo, e `stop()` é chamado pelo `close` do runtime — nada de job zumbi escrevendo em
// banco fechado.
//
// O relógio é injetado (`schedule`/`cancel` de `BootDeps`): em teste o agendador é no-op e
// quem dispara o job é `runNow`, que é o mesmo caminho, sem esperar 15 minutos. Nada de
// `setInterval` solto: quem torna o trabalho periódico é o REARME depois de cada execução —
// e é ele que também impede sobreposição, porque o próximo relógio só começa quando o
// anterior terminou.

import { PRESENCE_REFRESH_MS, PRESENCE_TICK_MS } from '../l2/presence/index.ts';

/** Cadências de §22.2 — os períodos são normativos, não preferência de implementação. */
export const JOB_INTERVALS = {
  'invite.topicSweep': 15 * 60_000,
  /** §11.6 regra 1 — `dropped/expired` SÓ depois de reconciliar; a cadência é a de olhar. */
  'outbox.expire': 5 * 60_000,
  'host.inactivity': 6 * 60 * 60_000,
  'staging.gc': 24 * 60 * 60_000,
  'removed.purge': 24 * 60 * 60_000,
  'db.maintenance': 24 * 60 * 60_000,
  'log.rotate': 24 * 60 * 60_000,
  'succession.check': 24 * 60 * 60_000,
  'blob.gc': 24 * 60 * 60_000,
} as const;

export type JobName = keyof typeof JOB_INTERVALS;

/**
 * Loops permanentes de §22.1 com corpo em código nesta fase. Os demais (`outbox.flush`,
 * `outbox.reconcile`, `replication.watchdog`, `metrics.flush`, mídia) continuam disparados
 * pelos seus gatilhos próprios ou aguardam fase — ver §54.
 */
export const LOOP_INTERVALS = {
  /** §17.6 — o host agrega presença em delta consolidado a cada `PRESENCE_TICK_MS`. */
  'presence.tick': PRESENCE_TICK_MS,
  /** §17.6 — TTL 5 s do typing, varrido a cada segundo no host. */
  'typing.expire': 1000,
  /** §17.6/§6.16 — republish antes do TTL de 45 s; todo nó. */
  'presence.refresh': PRESENCE_REFRESH_MS,
} as const;

export type LoopName = keyof typeof LOOP_INTERVALS;

type PeriodicDeps<K extends string> = {
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  bodies: { readonly [P in K]?: () => void | Promise<void> };
  onError?(name: K, err: unknown): void;
};

type PeriodicRunner<K extends string> = {
  runNow(name: K): Promise<void>;
  stop(): void;
};

/**
 * Um corredor por nome: rearma após cada execução (§22.2/§22.5) e para junto com o núcleo.
 * Compartilhado pelos jobs de §22.2 e pelos loops de §22.1 — a cadência muda, a disciplina
 * não.
 */
function startPeriodic<K extends string>(intervals: Readonly<Record<K, number>>, deps: PeriodicDeps<K>): PeriodicRunner<K> {
  let parado = false;

  async function runNow(name: K): Promise<void> {
    const body = deps.bodies[name];
    if (body === undefined || parado) return;
    try {
      await body();
    } catch (err) {
      deps.onError?.(name, err);
    }
  }

  const armados = new Map<K, unknown>();
  function armar(nome: K): void {
    if (parado) return;
    armados.set(
      nome,
      deps.schedule(() => {
        void runNow(nome).finally(() => armar(nome));
      }, intervals[nome]),
    );
  }
  for (const nome of Object.keys(intervals) as K[]) {
    if (deps.bodies[nome] === undefined) continue;
    armar(nome);
  }

  return {
    runNow,
    stop() {
      parado = true;
      for (const h of armados.values()) deps.cancel(h);
      armados.clear();
    },
  };
}

export type JobRunnerDeps = {
  /** `setInterval` do produto; em teste, o injetado por `BootDeps` (no-op determinístico). */
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  jobs: { readonly [K in JobName]?: () => void | Promise<void> };
  /** Falha de job não derruba o núcleo (§22.5): o próximo ciclo tenta de novo. */
  onError?(name: JobName, err: unknown): void;
};

export type JobRunner = PeriodicRunner<JobName>;

export function startJobs(deps: JobRunnerDeps): JobRunner {
  return startPeriodic(JOB_INTERVALS, {
    schedule: deps.schedule,
    cancel: deps.cancel,
    bodies: deps.jobs,
    ...(deps.onError !== undefined ? { onError: deps.onError } : {}),
  });
}

export type LoopRunnerDeps = {
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  loops: { readonly [K in LoopName]?: () => void | Promise<void> };
  onError?(name: LoopName, err: unknown): void;
};

export type LoopRunner = PeriodicRunner<LoopName>;

/** Os loops permanentes de §22.1 — mesma disciplina de rearme e cancelamento dos jobs. */
export function startLoops(deps: LoopRunnerDeps): LoopRunner {
  return startPeriodic(LOOP_INTERVALS, {
    schedule: deps.schedule,
    cancel: deps.cancel,
    bodies: deps.loops,
    ...(deps.onError !== undefined ? { onError: deps.onError } : {}),
  });
}
