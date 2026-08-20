/**
 * Fronteira IPC-R do POC-04 / G6 — espelha `core/src/l3/ipcRenderer/index.ts`
 * para o harness descartável não depender do build do core.
 * G6 mede exatamente este contrato: epoch/subId/evSeq/evAck/evStale (§15.1, §15.2, A14).
 */

export type IpcFrame =
  | { t: 'hello'; epoch: number; coreVersion: string; opVersion: number; schemaVersion: number }
  | { t: 'req'; epoch: number; id: number; cmd: string; arg: unknown; authToken?: string }
  | { t: 'res'; epoch: number; id: number; ok: boolean; data?: unknown; err?: { code: string; message: string } }
  | { t: 'sub'; epoch: number; id: number; topic: string; filter?: unknown }
  | { t: 'subOk'; epoch: number; id: number; subId: number }
  | { t: 'unsub'; epoch: number; subId: number }
  | { t: 'ev'; epoch: number; subId: number; evSeq: number; topic: string; data: unknown }
  | { t: 'evAck'; epoch: number; subId: number; evSeq: number }
  | { t: 'evStale'; epoch: number; subId: number; fromSeq: number; toSeq: number; dropped: number };

export interface IpcPort {
  postMessage(frame: IpcFrame): void;
  onMessage(listener: (frame: IpcFrame) => void): void;
}
