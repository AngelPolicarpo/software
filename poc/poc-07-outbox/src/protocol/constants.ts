// Constantes que este harness usa, com a seção de origem. Nenhuma é inventada: onde o
// normativo dá valor, é o valor dele.

/** §11.5 — o host acumula por até esta janela antes de um `core.append([...])`. */
export const GROUP_COMMIT_WINDOW_MS = 4;
/** §11.5 — ou até este número de registros, o que vier primeiro. */
export const GROUP_COMMIT_MAX = 64;
/** §11.7 — teto de itens por comunidade; acima disso, `E_OUTBOX_FULL` na hora. */
export const OUTBOX_MAX_ITEMS = 500;
/** §11.8 — `delay = min(1000 · 2^attempts, 60000) ± 20 %`. */
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;
export const BACKOFF_JITTER = 0.2;
/** §11.8 — 5 falhas **de conexão** consecutivas abrem o breaker. */
export const BREAKER_THRESHOLD = 5;
export const BREAKER_OPEN_MS = 30_000;
/** §11.8 — profundidade da fila de admissão do host, por comunidade. */
export const HOST_QUEUE_DEPTH = 512;
/** §11.9 — `submitOps{envelopes[≤32]}`. */
export const SUBMIT_BATCH_MAX = 32;

/**
 * §11.6 regra 1 — idade **nunca** descarta sozinha: só depois de uma reconciliação que não
 * encontrou a op no log. O valor real é operacional (§27.2); o cenário de expiração o encurta
 * por ambiente, e o resto do gate roda com um valor alto — senão a própria matriz de crash,
 * que passa segundos em backoff, descartaria itens por idade e mediria a expiração em vez da
 * durabilidade.
 */
export const OUTBOX_MAX_AGE_MS = Number(process.env.POC07_OUTBOX_MAX_AGE_MS ?? 600_000);

/** Estados de §11.3. `dropped` carrega sempre um motivo de §11.7. */
export type OutboxState =
  | 'queued'
  | 'sending'
  | 'awaiting-confirmation'
  | 'failed'
  | 'dropped';

/** §11.7 — os oito motivos nomeados. Descarte sem motivo não existe. */
export type DropReason =
  | 'channel-deleted'
  | 'community-ended'
  | 'left-community'
  | 'banned'
  | 'kicked'
  | 'permission-lost'
  | 'expired'
  | 'client-outdated'
  | 'cancelled';

/** Códigos de §20 que este harness produz. */
export type ErrorCode =
  | 'E_DUPLICATE'
  | 'E_BUSY'
  | 'E_HOST_UNAVAILABLE'
  | 'E_OUTBOX_FULL'
  | 'E_ALREADY_SENT'
  | 'E_VERSION_UNSUPPORTED'
  | 'E_STORAGE_FULL'
  | 'E_INTERNAL';

/** §20 — quais erros são terminais. `E_VERSION_UNSUPPORTED` é terminal por §11.6 regra 3. */
export const TERMINAL_ERRORS: ReadonlySet<string> = new Set<string>([
  'E_VERSION_UNSUPPORTED',
]);
