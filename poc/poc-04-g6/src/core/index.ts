/**
 * Núcleo do POC-04 — roda no utilityProcess (ou em worker Node no quick).
 * Implementa IpcServer §15.1/A14 com estado artificial (contador + lista + op idempotente)
 * para provar o contrato sem domínio real.
 */
import type { IpcPort, IpcFrame } from '../protocol/messages.js';

type AuthClass = 'open' | 'standard';
type Handler = (arg: unknown) => unknown | Promise<unknown>;

export class IpcServer {
  #epoch: number;
  #port: IpcPort;
  #handlers = new Map<string, Handler>();
  #subs = new Map<number, { subId: number; topic: string; evSeq: number; unacked: number; stale: boolean }>();
  #nextSubId = 1;
  #subWindow = 256;
  // Estado artificial para medir convergência
  #counter = 0;
  #list: string[] = [];
  #appliedOps = new Set<string>(); // idempotência por opId

  constructor(epoch: number, port: IpcPort) {
    this.#epoch = epoch;
    this.#port = port;
    port.onMessage((f) => void this._handle(f));
  }

  get epoch(): number { return this.#epoch; }
  get counter(): number { return this.#counter; }
  get list(): readonly string[] { return this.#list; }

  register(cmd: string, handler: Handler): void { this.#handlers.set(cmd, handler); }

  sendHello(): void {
    this.#port.postMessage({ t: 'hello', epoch: this.#epoch, coreVersion: '1.0.0', opVersion: 2, schemaVersion: 3 });
  }

  emit(topic: string, data: unknown): void {
    for (const sub of this.#subs.values()) {
      if (sub.topic !== topic) continue;
      if (sub.unacked >= this.#subWindow) {
        if (!sub.stale) {
          sub.stale = true;
          this.#port.postMessage({ t: 'evStale', epoch: this.#epoch, subId: sub.subId, fromSeq: sub.evSeq, toSeq: sub.evSeq, dropped: 1 });
        }
        continue;
      }
      sub.evSeq++; sub.unacked++;
      this.#port.postMessage({ t: 'ev', epoch: this.#epoch, subId: sub.subId, evSeq: sub.evSeq, topic, data });
    }
  }

  // Operação idempotente para detectar duplicata (G6: "nenhuma operação aplicada duas vezes")
  applyOp(opId: string, delta: number): { applied: boolean; counter: number } {
    if (this.#appliedOps.has(opId)) return { applied: false, counter: this.#counter };
    this.#appliedOps.add(opId);
    this.#counter += delta;
    this.#list.push(opId);
    this.emit('state', { counter: this.#counter, list: [...this.#list] });
    return { applied: true, counter: this.#counter };
  }

  queryState(): { counter: number; list: readonly string[]; epoch: number } {
    return { counter: this.#counter, list: [...this.#list], epoch: this.#epoch };
  }

  private async _handle(frame: IpcFrame): Promise<void> {
    if ((frame as { epoch?: number }).epoch !== this.#epoch) return;
    switch (frame.t) {
      case 'req': {
        const h = this.#handlers.get(frame.cmd);
        if (h === undefined) {
          this.#port.postMessage({ t: 'res', epoch: this.#epoch, id: frame.id, ok: false, err: { code: 'E_UNKNOWN_COMMAND', message: 'unknown' } });
          return;
        }
        try {
          const data = await h(frame.arg);
          this.#port.postMessage({ t: 'res', epoch: this.#epoch, id: frame.id, ok: true, data });
        } catch (e) {
          const code = (e as { code?: string }).code ?? 'E_INTERNAL';
          this.#port.postMessage({ t: 'res', epoch: this.#epoch, id: frame.id, ok: false, err: { code, message: (e as Error).message } });
        }
        break;
      }
      case 'sub': {
        const subId = this.#nextSubId++;
        this.#subs.set(subId, { subId, topic: frame.topic, evSeq: 0, unacked: 0, stale: false });
        this.#port.postMessage({ t: 'subOk', epoch: this.#epoch, id: frame.id, subId });
        break;
      }
      case 'unsub': this.#subs.delete(frame.subId); break;
      case 'evAck': {
        const sub = this.#subs.get(frame.subId);
        if (sub !== undefined) { sub.unacked = 0; sub.stale = false; }
        break;
      }
      default: break;
    }
  }

}
