/**
 * Mensagens das duas fronteiras de A16 / backend-v2.md §29.
 *
 * IPC-M — main <-> núcleo. Ciclo de vida, heartbeat, comandos do harness.
 * IPC-R — renderer <-> núcleo. Aqui só existe para provar que a porta atravessa o main
 *         sem que o main vire proxy do tráfego; o POC-03 não implementa RPC de produto.
 *
 * O POC-03 não é o protocolo do produto. É o mínimo para exercitar o runtime.
 */

/** Comandos que o harness manda ao núcleo pela IPC-M. */
export type CoreCommand =
  | { c: 'ping'; id: number }
  | { c: 'openDbs'; id: number }
  | { c: 'openCore'; id: number }
  | { c: 'append'; id: number; count: number; bytes: number }
  | { c: 'flushProbe'; id: number }
  | { c: 'txRows'; id: number; rows: number }
  | { c: 'ftsIndex'; id: number; rows: number }
  | { c: 'signVerify'; id: number; count: number }
  | { c: 'addonReport'; id: number }
  | { c: 'stat'; id: number }
  /** Injeção de falha: exceção dentro do addon nativo, não um `throw` de JS. */
  | { c: 'crashNative'; id: number }
  /** Injeção de falha: o núcleo se mata sem desmontar nada. */
  | { c: 'crashHard'; id: number }
  | { c: 'shutdown'; id: number };

export type CoreReply =
  | { r: 'ok'; id: number; data: unknown }
  | { r: 'err'; id: number; code: string; message: string };

/** Emitido pelo núcleo sem pedido. */
export type CoreEvent =
  | { e: 'ready'; pid: number; msToReady: number; runtime: RuntimeStamp }
  | { e: 'heartbeat'; pid: number; seq: number; rssBytes: number }
  | { e: 'log'; level: 'info' | 'warn' | 'error'; msg: string };

export type CoreOut = CoreReply | CoreEvent;

/** Identificação do runtime que produziu a evidência — vai para o artefato de G0. */
export type RuntimeStamp = {
  electron: string;
  chrome: string;
  node: string;
  v8: string;
  platform: NodeJS.Platform;
  arch: string;
  packaged: boolean;
  execPath: string;
};

/** Uma linha do relatório de carga de addon: o critério "taxa de carga do addon". */
export type AddonLoad = {
  name: string;
  loaded: boolean;
  /** Caminho do `.node` que o loader realmente escolheu — prova asar vs asarUnpack. */
  resolved: string | null;
  /** Outros `.node` abertos durante o mesmo `require` (dependências transitivas). */
  alsoOpened?: string[];
  /** `true` quando o binário veio de `build/Release`, ou seja, do nosso container. */
  fromSourceBuild: boolean | null;
  error: string | null;
};

export const IPC_M_CHANNEL = 'poc03:ipc-m' as const;
export const IPC_R_CHANNEL = 'poc03:ipc-r' as const;

/**
 * `Omit` sobre união colapsa os membros num só e mata os campos específicos de cada
 * comando. Distribuir preserva `count`, `bytes` e `rows`.
 */
export type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
