/**
 * Fronteiras do POC-10 — gate G10.
 *
 * A13 é a regra que este protocolo existe para não violar:
 *   - a chave de IDENTIDADE é gerada no núcleo e nunca sai dele;
 *   - só a DATA KEY atravessa a IPC-M, para o main embrulhar/desembrulhar com `safeStorage`;
 *   - nenhum comando de IPC-R devolve, deriva ou expõe material de chave.
 *
 * Os dois tipos abaixo são separados de propósito: se um campo de semente aparecesse em
 * `IpcRCommand` ou `IpcRReply`, seria erro de compilação antes de ser achado de varredura.
 */

/** Estágios de §18.6, na ordem exata. `none` é início e fim. */
export const WIPE_STAGES = [
  'none',
  'requested',
  'swarm-down',
  'cores-closed',
  'view-deleted',
  'manifest-deleted',
  'key-wiped',
  'done',
] as const;
export type WipeStage = (typeof WIPE_STAGES)[number];

/** Etapas de §10.8, na ordem exata de aquisição. */
export const LOCK_STAGES = ['app-instance', 'lock-file', 'corestore-rocksdb', 'sqlite'] as const;
export type LockStage = (typeof LOCK_STAGES)[number];

// --- IPC-M: main <-> núcleo -------------------------------------------------------------

/** Pedidos que o NÚCLEO faz ao MAIN. O main é oráculo de `safeStorage`, nada mais. */
export type CoreToMain =
  | { q: 'wrapDataKey'; id: number; dataKeyB64: string }
  | { q: 'unwrapDataKey'; id: number; wrappedB64: string }
  | { q: 'keystoreInfo'; id: number };

export type MainToCore =
  | { a: 'wrapDataKey'; id: number; wrappedB64: string }
  | { a: 'unwrapDataKey'; id: number; dataKeyB64: string }
  | { a: 'keystoreInfo'; id: number; available: boolean; backend: string }
  | { a: 'error'; id: number; code: string; message: string };

/** Comandos do harness ao núcleo, pela IPC-M. */
export type CoreCommand =
  | { c: 'boot'; id: number }
  | { c: 'identityRead'; id: number }
  | { c: 'identitySign'; id: number; message: string }
  | { c: 'identityExport'; id: number; passphrase: string }
  | { c: 'identityImport'; id: number; bundleB64: string; passphrase: string }
  | { c: 'lockStatus'; id: number }
  | { c: 'wipe'; id: number }
  | { c: 'acceptInsecureKeystore'; id: number }
  | { c: 'stat'; id: number }
  | { c: 'shutdown'; id: number };

export type CoreReply =
  | { r: 'ok'; id: number; data: unknown }
  | { r: 'err'; id: number; code: string; message: string };

export type CoreEvent =
  | { e: 'ready'; pid: number; msToReady: number; lockStages: LockStage[]; identityPublicKeyHex: string }
  | { e: 'blocked'; code: string; message: string; stage: LockStage | null }
  | { e: 'wipeStage'; stage: WipeStage }
  | { e: 'log'; level: 'info' | 'warn' | 'error'; msg: string };

export type CoreOut = CoreReply | CoreEvent | CoreToMain;

// --- IPC-R: renderer <-> núcleo ----------------------------------------------------------
// A13(4): nenhum comando daqui devolve, deriva ou expõe material de chave. O tipo de
// resposta não tem forma capaz de carregá-lo.

export type IpcRCommand = { c: 'identity.publicKey' } | { c: 'identity.status' };
export type IpcRReply =
  | { r: 'identity.publicKey'; publicKeyHex: string }
  | { r: 'identity.status'; hasIdentity: boolean; keystoreBackend: string; degraded: boolean };

/** Deep link já parseado — §3.5(2): o main nunca encaminha a string original. */
export type DeepLink = { route: 'join'; code: string } | { route: 'm'; ref: string };

/**
 * `Omit` sobre união colapsa os membros num só e apaga os campos específicos de cada
 * variante. Distribuir preserva `passphrase`, `bundleB64`, `dataKeyB64` e companhia.
 */
export type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
