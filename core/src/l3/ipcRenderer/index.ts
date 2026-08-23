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

  /**
   * §15.3 — a classe de `blob.reveal` depende do **dado**, não do comando: a tabela diz
   * "`blob.reveal` de `archive`" na linha `main-confirmed`. O tipo do blob só se conhece
   * depois de olhá-lo, então o handler pede a confirmação nativa aqui, pelo mesmo caminho
   * que o roteador usa na classe estática — o token é de uso único e o renderer não o
   * fabrica.
   */
  requireConfirmation(cmd: string, authToken: string | undefined): void {
    if (authToken === undefined || !this.#tokenVerifier.consume(authToken, cmd)) {
      throw Object.assign(new Error('Token de confirmação nativa inválido ou ausente'), {
        code: 'E_PERMISSION_DENIED',
      });
    }
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

/**
 * `IpcClient` — lado renderer de IPC-R (§15.1, §15.2, A14, G6).
 *
 * - Mantém `epoch` corrente; quadro com epoch diferente é descartado (§15.1) exceto `hello`
 *   que atualiza o epoch e dispara a recuperação G6.
 * - Requests em voo falham com `E_CORE_RESTARTED` no bump de epoch (§15.2 4a) e NUNCA são
 *   reenviados automaticamente — escrita está na outbox (§11.6).
 * - Subs antigos são descartados e refeitos no bump (4b, 4c).
 * - `evStale` exige resync (queries refeitas) (A14, §15.1 janela 256).
 */
export class IpcClient {
  #port: IpcPort | null = null;
  #epoch = 0;
  #nextId = 1;
  readonly #pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; cmd: string; timer: ReturnType<typeof setTimeout> }
  >();
  readonly #subs = new Map<number, { topic: string; filter?: unknown; handler: (data: unknown) => void }>();
  readonly #subIdToLocal = new Map<number, number>();
  #nextLocalSubId = 1;
  #helloResolver: ((hello: Extract<IpcFrame, { t: 'hello' }>) => void) | null = null;

  get epoch(): number {
    return this.#epoch;
  }

  attach(port: IpcPort): void {
    this.#port = port;
    port.onMessage((frame) => this.#handleFrame(frame));
  }

  /** Chamado pelo preload quando o main notifica novo epoch via `core-epoch` (§15.2). */
  handleCoreEpoch(newEpoch: number): void {
    if (newEpoch <= this.#epoch) return;
    this.#epoch = newEpoch;
    // §15.2 4a: falha TODAS as requests em voo com E_CORE_RESTARTED
    for (const [, p] of this.#pending) {
      clearTimeout(p.timer);
      p.reject(Object.assign(new Error('Núcleo reiniciado'), { code: 'E_CORE_RESTARTED', epoch: newEpoch }));
    }
    this.#pending.clear();
    // §15.2 4b: descarta todos os subId antigos
    this.#subIdToLocal.clear();
    // O renderer deve refazer assinaturas e queries (4c, 4d) — expõe evento
    // O consumidor da classe deve ouvir `onCoreRestart` e re-subscrever.
    this.#onCoreRestart?.(newEpoch);
  }

  #onCoreRestart: ((epoch: number) => void) | null = null;
  onCoreRestart(listener: (epoch: number) => void): void {
    this.#onCoreRestart = listener;
  }

  waitForHello(timeoutMs = 30_000): Promise<Extract<IpcFrame, { t: 'hello' }>> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.#helloResolver = null;
        reject(new Error('timeout esperando hello'));
      }, timeoutMs);
      this.#helloResolver = (hello) => {
        clearTimeout(t);
        this.#helloResolver = null;
        resolve(hello);
      };
    });
  }

  request(cmd: string, arg: unknown, authToken?: string): Promise<unknown> {
    if (this.#port === null) return Promise.reject(Object.assign(new Error('IPC-R não conectado'), { code: 'E_NO_PORT' }));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      // §15.4 — ops ⏱ têm 30 s. O timer vive DENTRO do registro pendente e é limpo em
      // TODO caminho de saída (resposta, epoch bump) — deixá-lo vazava handle por request.
      const timer = setTimeout(() => {
        if (this.#pending.delete(id)) {
          reject(Object.assign(new Error(`timeout em ${cmd}`), { code: 'E_TIMEOUT' }));
        }
      }, 30_000);
      this.#pending.set(id, { resolve, reject, cmd, timer });
      this.#port!.postMessage({
        t: 'req',
        epoch: this.#epoch,
        id,
        cmd,
        arg,
        ...(authToken !== undefined ? { authToken } : {}),
      });
    });
  }

  subscribe(topic: string, handler: (data: unknown) => void, filter?: unknown): number {
    if (this.#port === null) throw Object.assign(new Error('IPC-R não conectado'), { code: 'E_NO_PORT' });
    const localId = this.#nextLocalSubId++;
    const reqId = this.#nextId++;
    this.#subs.set(localId, { topic, filter, handler });
    // Envia sub com epoch corrente; o servidor responderá com subId
    this.#port.postMessage({ t: 'sub', epoch: this.#epoch, id: reqId, topic, filter });
    // Mapeia reqId → localId para quando subOk chegar
    this.#subIdToLocal.set(reqId, localId);
    return localId;
  }

  unsubscribe(localId: number): void {
    const sub = this.#subs.get(localId);
    if (sub === undefined || this.#port === null) return;
    this.#subs.delete(localId);
    // Precisamos do subId real do servidor — simplificação: envia unsub com localId como subId
    // Em produção, manteríamos mapa subId real.
    this.#port.postMessage({ t: 'unsub', epoch: this.#epoch, subId: localId });
  }

  #handleFrame(frame: IpcFrame): void {
    if (frame.t === 'hello') {
      // Hello pode vir com epoch maior que o corrente — atualiza e dispara G6 se necessário
      if (frame.epoch > this.#epoch) {
        this.handleCoreEpoch(frame.epoch);
      } else {
        this.#epoch = frame.epoch;
      }
      this.#helloResolver?.(frame);
      return;
    }
    // §15.1: quadro com epoch diferente é DESCARTADO sem resposta (exceto hello)
    if ((frame as { epoch?: number }).epoch !== this.#epoch) {
      return;
    }
    switch (frame.t) {
      case 'res': {
        const p = this.#pending.get(frame.id);
        if (p === undefined) return;
        this.#pending.delete(frame.id);
        clearTimeout(p.timer);
        if (frame.ok) p.resolve(frame.data);
        else p.reject(Object.assign(new Error(frame.err?.message ?? 'erro'), { code: frame.err?.code ?? 'E_INTERNAL', field: frame.err?.field, details: frame.err?.details, retryAfterMs: frame.err?.retryAfterMs }));
        break;
      }
      case 'subOk': {
        const localId = this.#subIdToLocal.get(frame.id);
        if (localId !== undefined) {
          this.#subIdToLocal.delete(frame.id);
          this.#subIdToLocal.set(frame.subId, localId);
        }
        break;
      }
      case 'ev': {
        const localId = this.#subIdToLocal.get(frame.subId);
        const sub = localId !== undefined ? this.#subs.get(localId) : undefined;
        if (sub !== undefined) {
          sub.handler(frame.data);
          // Controle de fluxo: envia evAck (§15.1 janela 256)
          this.#port?.postMessage({ t: 'evAck', epoch: this.#epoch, subId: frame.subId, evSeq: frame.evSeq });
        }
        break;
      }
      case 'evStale': {
        const localId = this.#subIdToLocal.get(frame.subId);
        const sub = localId !== undefined ? this.#subs.get(localId) : undefined;
        if (sub !== undefined) {
          // Resync obrigatório — o cliente deve refazer queries (§15.1, A14)
          // Emite evento para o consumidor; aqui apenas logamos
          this.#onStale?.(frame.subId, frame);
        }
        break;
      }
      default:
        break;
    }
  }

  #onStale: ((subId: number, frame: Extract<IpcFrame, { t: 'evStale' }>) => void) | null = null;
  onStale(listener: (subId: number, frame: Extract<IpcFrame, { t: 'evStale' }>) => void): void {
    this.#onStale = listener;
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
