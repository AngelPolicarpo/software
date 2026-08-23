/**
 * `IpcClient` — lado renderer de IPC-R (§15.1, §15.2).
 *
 * **Por que este cliente vive aqui e não vem de `core/`.** O núcleo já tem um `IpcClient`
 * em `core/src/l3/ipcRenderer/index.ts`, mas ele existe para os rigs do próprio núcleo:
 * fala com um `MemoryIpcPort` (`onMessage(listener)`), mora num pacote ESM sem `exports`
 * cujo build atravessa a barreira de camadas de §4, e traz junto o `IpcServer`. Uma
 * dependência `file:../core` faria o build do Vite depender do artefato de `core/dist` e
 * arrastaria L0..L2 para o grafo do renderer — acoplamento que a fronteira de §4 existe
 * justamente para não ter. O contrato compartilhado é o **quadro** de §15.1, não a classe;
 * este arquivo implementa o mesmo quadro sobre o `MessagePort` real que o preload
 * transfere. (Decisão de 2026-08-23, §58.)
 *
 * O que o cliente garante, e a store não precisa refazer:
 *
 * - `epoch` corrente; quadro com epoch diferente é descartado, exceto `hello` (§15.1 r. 1).
 * - No bump de epoch (§15.2 passo 4): (a) toda request em voo falha com `E_CORE_RESTARTED`
 *   e **nenhuma** é reenviada — escrita está na outbox (§11.6); (b) os `subId` antigos são
 *   descartados; (c) as assinaturas são refeitas a partir da lista declarativa que o
 *   cliente mantém. Refazer as **queries** (4d) é do consumidor: só ele sabe quais estão
 *   ativas — é o que `onResync` entrega.
 * - `evAck` a cada evento e `evStale` → `onResync`, porque evento é sinal para reconsultar
 *   e nunca fonte de verdade (§15.1 r. 5).
 */

import {
  IpcCommandError,
  type FrameFromCore,
  type FrameToCore,
  type RendererPort,
} from "./frames";

/** §15.1 r. 6 — default 10 s; as ⏱ de §15.4 pedem 30 s explicitamente. */
export const TIMEOUT_PADRAO_MS = 10_000;
export const TIMEOUT_HOST_MS = 30_000;

/** Por que o cliente pediu resync: o consumidor decide o quanto refazer. */
export type MotivoDeResync =
  | { readonly tipo: "epoch"; readonly epoch: number }
  | { readonly tipo: "stale"; readonly topic: string; readonly dropped: number };

interface Pendente {
  readonly cmd: string;
  readonly resolve: (v: unknown) => void;
  readonly reject: (e: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface Assinatura {
  readonly topic: string;
  readonly filter: unknown;
  readonly handler: (data: unknown) => void;
  /** `subId` do núcleo; ausente entre o `sub` e o `subOk` — e depois de um bump. */
  subId: number | undefined;
  /** `id` do `sub` em voo, para casar o `subOk`. */
  reqId: number | undefined;
}

export class IpcClient {
  #port: RendererPort | null = null;
  #epoch = 0;
  #proximoId = 1;
  #proximoLocal = 1;
  readonly #pendentes = new Map<number, Pendente>();
  readonly #assinaturas = new Map<number, Assinatura>();
  #resolverHello: ((h: Extract<FrameFromCore, { t: "hello" }>) => void) | null = null;
  #timerHello: ReturnType<typeof setTimeout> | null = null;
  #onResync: ((motivo: MotivoDeResync) => void) | null = null;

  get epoch(): number {
    return this.#epoch;
  }

  get conectado(): boolean {
    return this.#port !== null;
  }

  /**
   * Liga o cliente à porta transferida. Uma porta NOVA chega a cada núcleo novo: os
   * `subId` do núcleo anterior não valem mais, e as assinaturas declaradas são reenviadas
   * assim que o `hello` fixar o epoch.
   */
  attach(port: RendererPort): void {
    this.#port = port;
    port.addEventListener("message", (ev) => {
      this.#receber(ev.data as FrameFromCore);
    });
    port.start?.();
  }

  onResync(listener: (motivo: MotivoDeResync) => void): void {
    this.#onResync = listener;
  }

  waitForHello(timeoutMs = TIMEOUT_HOST_MS): Promise<Extract<FrameFromCore, { t: "hello" }>> {
    return new Promise((resolve, reject) => {
      this.#timerHello = setTimeout(() => {
        this.#resolverHello = null;
        this.#timerHello = null;
        reject(new Error("tempo esgotado esperando o hello do núcleo"));
      }, timeoutMs);
      this.#resolverHello = (h) => {
        if (this.#timerHello !== null) clearTimeout(this.#timerHello);
        this.#timerHello = null;
        this.#resolverHello = null;
        resolve(h);
      };
    });
  }

  /**
   * §15.2 4a — chamado quando o main anuncia epoch novo (`core-epoch`) ou quando o `hello`
   * de um núcleo novo chega antes disso. Idempotente: o segundo aviso do mesmo epoch é
   * ignorado, senão o resync aconteceria duas vezes por reinício.
   */
  handleCoreEpoch(novoEpoch: number): void {
    if (novoEpoch <= this.#epoch) return;
    this.#epoch = novoEpoch;
    for (const p of this.#pendentes.values()) {
      clearTimeout(p.timer);
      p.reject(
        new IpcCommandError({
          code: "E_CORE_RESTARTED",
          message: "O núcleo reiniciou; a ação em voo não foi reenviada",
        }),
      );
    }
    this.#pendentes.clear();
    for (const a of this.#assinaturas.values()) {
      a.subId = undefined;
      a.reqId = undefined;
    }
    this.#reassinar();
    this.#onResync?.({ tipo: "epoch", epoch: novoEpoch });
  }

  request(cmd: string, arg: unknown = {}, authToken?: string, timeoutMs = TIMEOUT_PADRAO_MS): Promise<unknown> {
    const port = this.#port;
    if (port === null) {
      return Promise.reject(new IpcCommandError({ code: "E_NO_PORT", message: "IPC-R não conectado" }));
    }
    const id = this.#proximoId++;
    return new Promise((resolve, reject) => {
      // O handle vive DENTRO do registro pendente e some em todo desfecho — resposta,
      // bump de epoch ou o próprio estouro (lição de §57).
      const timer = setTimeout(() => {
        if (this.#pendentes.delete(id)) {
          reject(new IpcCommandError({ code: "E_TIMEOUT", message: `Tempo esgotado em ${cmd}` }));
        }
      }, timeoutMs);
      this.#pendentes.set(id, { cmd, resolve, reject, timer });
      port.postMessage({
        t: "req",
        epoch: this.#epoch,
        id,
        cmd,
        arg,
        ...(authToken !== undefined ? { authToken } : {}),
      });
    });
  }

  /**
   * Assinatura declarativa: o retorno é um id LOCAL, estável através de reinícios do
   * núcleo. É o que permite ao cliente refazer a assinatura sozinho no bump sem que a
   * store guarde `subId` de servidor (§15.2 4c).
   */
  subscribe(topic: string, handler: (data: unknown) => void, filter?: unknown): number {
    const local = this.#proximoLocal++;
    this.#assinaturas.set(local, { topic, filter, handler, subId: undefined, reqId: undefined });
    this.#enviarSub(local);
    return local;
  }

  unsubscribe(local: number): void {
    const a = this.#assinaturas.get(local);
    if (a === undefined) return;
    this.#assinaturas.delete(local);
    // Sem `subId` do núcleo não há o que cancelar no outro lado: ou o `subOk` ainda não
    // chegou, ou o núcleo que o emitiu já morreu. Inventar um número aqui cancelaria a
    // assinatura de outra tela.
    if (a.subId !== undefined) {
      this.#port?.postMessage({ t: "unsub", epoch: this.#epoch, subId: a.subId });
    }
  }

  #enviarSub(local: number): void {
    const a = this.#assinaturas.get(local);
    if (a === undefined || this.#port === null) return;
    const reqId = this.#proximoId++;
    a.reqId = reqId;
    const frame: FrameToCore = { t: "sub", epoch: this.#epoch, id: reqId, topic: a.topic };
    this.#port.postMessage(a.filter === undefined ? frame : { ...frame, filter: a.filter });
  }

  #reassinar(): void {
    for (const local of this.#assinaturas.keys()) this.#enviarSub(local);
  }

  #receber(frame: FrameFromCore): void {
    if (frame === null || typeof frame !== "object") return;
    if (frame.t === "hello") {
      if (frame.epoch > this.#epoch) {
        if (this.#epoch === 0) {
          // Primeiro `hello` do canal: não houve reinício, não há pendente a falhar — só
          // as assinaturas declaradas antes da porta existir precisam sair agora.
          this.#epoch = frame.epoch;
          this.#reassinar();
        } else {
          // Núcleo novo cujo `hello` chegou antes do aviso do main: mesmo procedimento.
          this.handleCoreEpoch(frame.epoch);
        }
      }
      this.#resolverHello?.(frame);
      return;
    }
    // §15.1 r. 1 — quadro de outro epoch é descartado sem resposta.
    if (frame.epoch !== this.#epoch) return;
    switch (frame.t) {
      case "res": {
        const p = this.#pendentes.get(frame.id);
        if (p === undefined) return;
        this.#pendentes.delete(frame.id);
        clearTimeout(p.timer);
        if (frame.ok) p.resolve(frame.data ?? {});
        else p.reject(new IpcCommandError(frame.err));
        return;
      }
      case "subOk": {
        for (const a of this.#assinaturas.values()) {
          if (a.reqId === frame.id) {
            a.reqId = undefined;
            a.subId = frame.subId;
            return;
          }
        }
        // `subOk` de assinatura já cancelada: cancela do outro lado, senão o núcleo
        // continuaria emitindo para um `subId` que ninguém escuta.
        this.#port?.postMessage({ t: "unsub", epoch: this.#epoch, subId: frame.subId });
        return;
      }
      case "ev": {
        for (const a of this.#assinaturas.values()) {
          if (a.subId === frame.subId) {
            a.handler(frame.data);
            break;
          }
        }
        this.#port?.postMessage({ t: "evAck", epoch: this.#epoch, subId: frame.subId, evSeq: frame.evSeq });
        return;
      }
      case "evStale": {
        // §15.1 r. 5 — as duas obrigações: confirmar o último `evSeq` para o núcleo voltar
        // a emitir, e refazer a query correspondente.
        this.#port?.postMessage({ t: "evAck", epoch: this.#epoch, subId: frame.subId, evSeq: frame.toSeq });
        let topic = "";
        for (const a of this.#assinaturas.values()) {
          if (a.subId === frame.subId) {
            topic = a.topic;
            break;
          }
        }
        this.#onResync?.({ tipo: "stale", topic, dropped: frame.dropped });
        return;
      }
      default:
        return;
    }
  }
}
