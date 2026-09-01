/**
 * Quadros de IPC-R — a tabela fechada de `backend-v2.md` §15.1.
 *
 * Este arquivo é a *forma do fio*, não um port do cliente do núcleo: o contrato que os dois
 * lados compartilham são os quadros, e é isso que está declarado aqui. O `chunk` da árvore
 * adiada (§17.8) não entra — a árvore está fora do v1 e declarar o quadro sugeriria que o
 * renderer sabe o que fazer com ele.
 */

export interface IpcError {
  readonly code: string;
  readonly message: string;
  /** §15.2 — campo do formulário que recusou; a UI mostra o erro NO campo. */
  readonly field?: string;
  readonly details?: unknown;
  readonly retryAfterMs?: number;
}

export type FrameFromCore =
  | { t: "hello"; epoch: number; coreVersion: string; opVersion: number; schemaVersion: number }
  | { t: "res"; epoch: number; id: number; ok: true; data?: unknown }
  | { t: "res"; epoch: number; id: number; ok: false; err: IpcError }
  | { t: "subOk"; epoch: number; id: number; subId: number }
  | { t: "ev"; epoch: number; subId: number; evSeq: number; topic: string; data: unknown }
  | { t: "evStale"; epoch: number; subId: number; fromSeq: number; toSeq: number; dropped: number };

export type FrameToCore =
  | { t: "req"; epoch: number; id: number; cmd: string; arg: unknown; authToken?: string }
  | { t: "sub"; epoch: number; id: number; topic: string; filter?: unknown }
  | { t: "unsub"; epoch: number; subId: number }
  | { t: "evAck"; epoch: number; subId: number; evSeq: number };

/**
 * O mínimo de `MessagePort` que o cliente usa. Tipar assim — e não `MessagePort` — é o que
 * deixa o cliente testável fora do Electron e imune ao formato exato da porta transferida.
 */
export interface RendererPort {
  postMessage(frame: FrameToCore): void;
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  start?(): void;
}

/** Erro de comando com os campos de §15.2 preservados até a tela. */
export class IpcCommandError extends Error {
  readonly code: string;
  readonly field: string | undefined;
  readonly details: unknown;
  readonly retryAfterMs: number | undefined;

  constructor(err: IpcError) {
    super(err.message);
    this.name = "IpcCommandError";
    this.code = err.code;
    this.field = err.field;
    this.details = err.details;
    this.retryAfterMs = err.retryAfterMs;
  }
}

export function codigoDoErro(e: unknown): string {
  return e instanceof IpcCommandError ? e.code : "E_INTERNAL";
}
