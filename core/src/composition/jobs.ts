// Os jobs periódicos de §22.2 que já têm dono em código. Raiz de composição (§4): cada job
// é uma chamada a um módulo que existe — o que mora aqui é a **cadência** e o cancelamento.
//
// §22.5 é a regra que dá forma ao arquivo: nenhum job sobrevive ao fechamento do seu escopo.
// Como todos os jobs desta fase são por instalação (não por comunidade), o escopo é o do
// núcleo, e `stop()` é chamado pelo `close` do runtime — nada de job zumbi escrevendo em
// banco fechado.
//
// O relógio é injetado (`schedule`/`cancel` de `BootDeps`): em teste o agendador é no-op e
// quem dispara o job é `runNow`, que é o mesmo caminho, sem esperar 15 minutos.

/** Cadências de §22.2 — os períodos são normativos, não preferência de implementação. */
export const JOB_INTERVALS = {
  'invite.topicSweep': 15 * 60_000,
  'blob.gc': 24 * 60 * 60_000,
} as const;

export type JobName = keyof typeof JOB_INTERVALS;

export type JobRunnerDeps = {
  /** `setInterval` do produto; em teste, o injetado por `BootDeps` (no-op determinístico). */
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  jobs: { readonly [K in JobName]?: () => void | Promise<void> };
  /** Falha de job não derruba o núcleo (§22.5): o próximo ciclo tenta de novo. */
  onError?(name: JobName, err: unknown): void;
};

export type JobRunner = {
  /** Dispara um job agora — o gatilho do teste e de todo caminho manual. */
  runNow(name: JobName): Promise<void>;
  stop(): void;
};

export function startJobs(deps: JobRunnerDeps): JobRunner {
  let parado = false;

  async function runNow(name: JobName): Promise<void> {
    const job = deps.jobs[name];
    if (job === undefined || parado) return;
    try {
      await job();
    } catch (err) {
      deps.onError?.(name, err);
    }
  }

  // `schedule` de `BootDeps` é de **um** disparo (o mesmo cabo do outbox): quem torna o job
  // periódico é o rearme depois de cada execução — e é ele que também impede sobreposição,
  // porque o próximo relógio só começa quando o anterior terminou.
  const armados = new Map<JobName, unknown>();
  function armar(nome: JobName): void {
    if (parado) return;
    armados.set(
      nome,
      deps.schedule(() => {
        void runNow(nome).finally(() => armar(nome));
      }, JOB_INTERVALS[nome]),
    );
  }
  for (const nome of Object.keys(JOB_INTERVALS) as JobName[]) {
    if (deps.jobs[nome] === undefined) continue;
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
