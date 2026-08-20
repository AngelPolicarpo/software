// `ipcRenderer` — L3, protocolo e transporte IPC-R para o renderer (§4, §15.1, §15.2, §15.3, §15.4, §15.5, A14).
//
// §4: depende de L2.
// §4: Roteamento, autorização de comando, forma da fronteira; sem regra de negócio.

type IpcFrame =
  | { t: 'hello'; epoch: number; coreVersion: string; opVersion: number; schemaVersion: number }
  | { t: 'req'; epoch: number; id: number; cmd: string; arg: unknown; authToken?: string }
  | { t: 'res'; epoch: number; id: number; ok: boolean; data?: unknown; err?: { code: string; message: string; field?: string; details?: unknown; retryAfterMs?: number } }
  | { t: 'sub'; epoch: number; id: number; topic: string; filter?: unknown }
  | { t: 'subOk'; epoch: number; id: number; subId: number }
  | { t: 'unsub'; epoch: number; subId: number }
  | { t: 'ev'; epoch: number; subId: number; evSeq: number; topic: string; data: unknown }
  | { t: 'evAck'; epoch: number; subId: number; evSeq: number }
  | { t: 'evStale'; epoch: number; subId: number; fromSeq: number; toSeq: number; dropped: number };

type AuthClass = 'open' | 'standard' | 'main-confirmed' | 'dev';

type Handler = (
  arg: unknown,
  ctx: { id: number; epoch: number; authToken?: string },
) => unknown | Promise<unknown>;

type SubEntry = {
  subId: number;
  topic: string;
  filter?: unknown;
  evSeq: number;
  unackedCount: number;
  stale: boolean;
};

export interface IpcPort {
  postMessage(frame: IpcFrame): void;
  onMessage(listener: (frame: IpcFrame) => void): void;
}

export class IpcServer {
  readonly #epoch: number;
  readonly #port: IpcPort;
  readonly #tokenVerifier: { consume(token: string, cmd: string): boolean };
  readonly #identityStatus: { isLoaded: boolean };
  readonly #buildChannel: string;
  readonly #subWindow: number;
  readonly #staleMs: number;
  readonly #handlers = new Map<string, { handler: Handler; authClass: AuthClass }>();
  readonly #subs = new Map<number, SubEntry>();
  #nextSubId = 1;

  constructor(opts: {
    epoch: number;
    port: IpcPort;
    tokenVerifier: { consume(token: string, cmd: string): boolean };
    identityStatus: { isLoaded: boolean };
    buildChannel?: string;
    subWindow?: number;
    staleMs?: number;
  }) {
    this.#epoch = opts.epoch;
    this.#port = opts.port;
    this.#tokenVerifier = opts.tokenVerifier;
    this.#identityStatus = opts.identityStatus;
    this.#buildChannel = opts.buildChannel ?? 'prod';
    this.#subWindow = opts.subWindow ?? 256;
    this.#staleMs = opts.staleMs ?? 3000;
    this.#port.onMessage((frame) => {
      void this.#handleFrame(frame);
    });
  }

  get epoch(): number {
    return this.#epoch;
  }

  register(cmd: string, authClass: AuthClass, handler: Handler): void {
    if (this.#buildChannel === 'prod' && authClass === 'dev') {
      // §15.3: em prod comandos dev NÃO são registrados
      return;
    }
    this.#handlers.set(cmd, { handler, authClass });
  }

  sendHello(
    coreVersion = '1.0.0',
    opVersion = 2,
    schemaVersion = 3,
  ): void {
    this.#port.postMessage({
      t: 'hello',
      epoch: this.#epoch,
      coreVersion,
      opVersion,
      schemaVersion,
    });
  }

  emit(
    topic: string,
    data: unknown,
    matches?: (filter: unknown) => boolean,
  ): void {
    for (const sub of this.#subs.values()) {
      if (sub.topic !== topic) continue;
      if (sub.filter !== undefined && matches !== undefined && !matches(sub.filter)) continue;
      if (sub.unackedCount >= this.#subWindow) {
        if (!sub.stale) {
          sub.stale = true;
          this.#port.postMessage({
            t: 'evStale',
            epoch: this.#epoch,
            subId: sub.subId,
            fromSeq: sub.evSeq,
            toSeq: sub.evSeq,
            dropped: 1,
          });
        }
        continue;
      }
      sub.evSeq++;
      sub.unackedCount++;
      this.#port.postMessage({
        t: 'ev',
        epoch: this.#epoch,
        subId: sub.subId,
        evSeq: sub.evSeq,
        topic,
        data,
      });
    }
  }

  async #handleFrame(frame: IpcFrame): Promise<void> {
    // §15.1: quadro com epoch diferente do corrente é DESCARTADO sem resposta
    if ((frame as { epoch?: number }).epoch !== this.#epoch) {
      return;
    }
    switch (frame.t) {
      case 'req':
        await this.#handleReq(frame);
        break;
      case 'sub':
        this.#handleSub(frame);
        break;
      case 'unsub':
        this.#subs.delete(frame.subId);
        break;
      case 'evAck':
        this.#handleEvAck(frame);
        break;
      default:
        break;
    }
  }

  async #handleReq(frame: Extract<IpcFrame, { t: 'req' }>): Promise<void> {
    const entry = this.#handlers.get(frame.cmd);
    if (entry === undefined) {
      this.#port.postMessage({
        t: 'res',
        epoch: this.#epoch,
        id: frame.id,
        ok: false,
        err: {
          code: 'E_UNKNOWN_COMMAND',
          message: `Comando desconhecido: ${frame.cmd}`,
        },
      });
      return;
    }
    const { handler, authClass } = entry;
    // Checagem de autorização (§15.3)
    if (authClass === 'standard' && !this.#identityStatus.isLoaded) {
      this.#port.postMessage({
        t: 'res',
        epoch: this.#epoch,
        id: frame.id,
        ok: false,
        err: {
          code: 'E_NO_IDENTITY',
          message: 'Identidade necessária para executar esta ação',
        },
      });
      return;
    }
    if (authClass === 'main-confirmed') {
      if (
        frame.authToken === undefined ||
        !this.#tokenVerifier.consume(frame.authToken, frame.cmd)
      ) {
        this.#port.postMessage({
          t: 'res',
          epoch: this.#epoch,
          id: frame.id,
          ok: false,
          err: {
            code: 'E_PERMISSION_DENIED',
            message: 'Token de confirmação nativa inválido ou ausente',
          },
        });
        return;
      }
    }
    try {
      const data = await handler(frame.arg, {
        id: frame.id,
        epoch: frame.epoch,
        ...(frame.authToken !== undefined ? { authToken: frame.authToken } : {}),
      });
      this.#port.postMessage({
        t: 'res',
        epoch: this.#epoch,
        id: frame.id,
        ok: true,
        data: (data as unknown) ?? {},
      });
    } catch (err) {
      const e = err as {
        code?: string;
        message?: string;
        field?: string;
        details?: unknown;
        retryAfterMs?: number;
      };
      const errPayload: {
        code: string;
        message: string;
        field?: string;
        details?: unknown;
        retryAfterMs?: number;
      } = {
        code: e.code ?? 'E_INTERNAL',
        message: e.message ?? 'Erro interno',
      };
      if (e.field !== undefined) errPayload.field = e.field;
      if (e.details !== undefined) errPayload.details = e.details;
      if (e.retryAfterMs !== undefined) errPayload.retryAfterMs = e.retryAfterMs;
      this.#port.postMessage({
        t: 'res',
        epoch: this.#epoch,
        id: frame.id,
        ok: false,
        err: errPayload,
      });
    }
  }

  #handleSub(frame: Extract<IpcFrame, { t: 'sub' }>): void {
    const subId = this.#nextSubId++;
    this.#subs.set(subId, {
      subId,
      topic: frame.topic,
      filter: frame.filter,
      evSeq: 0,
      unackedCount: 0,
      stale: false,
    });
    this.#port.postMessage({
      t: 'subOk',
      epoch: this.#epoch,
      id: frame.id,
      subId,
    });
  }

  #handleEvAck(frame: Extract<IpcFrame, { t: 'evAck' }>): void {
    const sub = this.#subs.get(frame.subId);
    if (sub === undefined) return;
    sub.unackedCount = 0;
    sub.stale = false;
  }
}

export class MemoryIpcPort implements IpcPort {
  #other: MemoryIpcPort | null = null;
  readonly #listeners: Array<(frame: IpcFrame) => void> = [];

  static createPair(): [MemoryIpcPort, MemoryIpcPort] {
    const a = new MemoryIpcPort();
    const b = new MemoryIpcPort();
    a.#other = b;
    b.#other = a;
    return [a, b];
  }

  postMessage(frame: IpcFrame): void {
    if (this.#other === null) return;
    queueMicrotask(() => {
      for (const listener of this.#other!.#listeners) {
        listener(frame);
      }
    });
  }

  onMessage(listener: (frame: IpcFrame) => void): void {
    this.#listeners.push(listener);
  }
}
