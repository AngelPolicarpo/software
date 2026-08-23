/**
 * O cliente de IPC-R contra o contrato de §15.1 e o procedimento de §15.2.
 *
 * O que se testa aqui é justamente o que nenhum olho pega numa tela: o descarte por epoch, a
 * reassinatura depois do crash, o `evAck` que destrava o fluxo e a promessa de que **nada** é
 * reenviado sozinho. A porta é um duplo — o contrato é o quadro, e o quadro é serializável.
 */

import { describe, expect, it, vi } from "vitest";
import { IpcClient, TIMEOUT_PADRAO_MS } from "../client";
import { IpcCommandError, type FrameFromCore, type FrameToCore, type RendererPort } from "../frames";

/** Duplo da porta: guarda o que saiu e injeta o que entra, sem assincronia escondida. */
class PortaFalsa implements RendererPort {
  readonly enviados: FrameToCore[] = [];
  #listener: ((ev: { data: unknown }) => void) | null = null;
  iniciada = false;

  postMessage(frame: FrameToCore): void {
    this.enviados.push(frame);
  }

  addEventListener(_tipo: "message", listener: (ev: { data: unknown }) => void): void {
    this.#listener = listener;
  }

  start(): void {
    this.iniciada = true;
  }

  /** Simula o núcleo mandando um quadro. */
  entregar(frame: FrameFromCore): void {
    this.#listener?.({ data: frame });
  }

  do<T extends FrameToCore["t"]>(t: T): Array<Extract<FrameToCore, { t: T }>> {
    return this.enviados.filter((f) => f.t === t) as Array<Extract<FrameToCore, { t: T }>>;
  }
}

function hello(epoch: number): FrameFromCore {
  return { t: "hello", epoch, coreVersion: "teste", opVersion: 2, schemaVersion: 3 };
}

/** Cliente já conectado e com o epoch fixado pelo `hello`, que é o estado normal. */
function ligado(epoch = 1): { cliente: IpcClient; porta: PortaFalsa } {
  const cliente = new IpcClient();
  const porta = new PortaFalsa();
  cliente.attach(porta);
  porta.entregar(hello(epoch));
  return { cliente, porta };
}

describe("aperto de mão (§15.1)", () => {
  it("o `hello` fixa o epoch e a porta é iniciada por quem escuta", () => {
    const { cliente, porta } = ligado(7);
    expect(cliente.epoch).toBe(7);
    expect(porta.iniciada).toBe(true);
  });

  it("`waitForHello` resolve com o que o núcleo declarou", async () => {
    const cliente = new IpcClient();
    const porta = new PortaFalsa();
    cliente.attach(porta);
    const promessa = cliente.waitForHello(1000);
    porta.entregar(hello(1));
    await expect(promessa).resolves.toMatchObject({ coreVersion: "teste", opVersion: 2 });
  });

  it("assinatura declarada antes da porta existir sai no primeiro `hello`", () => {
    const cliente = new IpcClient();
    cliente.subscribe("messages.appended", () => {});
    const porta = new PortaFalsa();
    cliente.attach(porta);
    expect(porta.do("sub")).toHaveLength(0);
    porta.entregar(hello(1));
    expect(porta.do("sub")).toHaveLength(1);
  });
});

describe("requests (§15.1 r. 1, r. 6; §15.2)", () => {
  it("o `req` carrega o epoch corrente e o `authToken` quando há", () => {
    const { cliente, porta } = ligado(3);
    void cliente.request("community.end", { communityId: "c1" }, "tok");
    const [req] = porta.do("req");
    expect(req).toMatchObject({ epoch: 3, cmd: "community.end", authToken: "tok" });
  });

  it("sem token, o campo fica AUSENTE — não `undefined` no fio", () => {
    const { cliente, porta } = ligado();
    void cliente.request("query.communities");
    expect("authToken" in porta.do("req")[0]!).toBe(false);
  });

  it("o erro chega com `code` e `field` preservados, que é o que a UI mostra no campo", async () => {
    const { cliente, porta } = ligado();
    const p = cliente.request("identity.create", {});
    porta.entregar({
      t: "res",
      epoch: 1,
      id: porta.do("req")[0]!.id,
      ok: false,
      err: { code: "E_VALIDATION", message: "nome vazio", field: "displayName" },
    });
    await expect(p).rejects.toMatchObject({ code: "E_VALIDATION", field: "displayName" });
  });

  it("resposta de OUTRO epoch é descartada sem resposta — é o que impede o núcleo morto de ser aplicado", async () => {
    vi.useFakeTimers();
    try {
      const { cliente, porta } = ligado(2);
      const p = cliente.request("query.communities");
      const rejeitada = expect(p).rejects.toMatchObject({ code: "E_TIMEOUT" });
      porta.entregar({ t: "res", epoch: 1, id: porta.do("req")[0]!.id, ok: true, data: ["fantasma"] });
      await vi.advanceTimersByTimeAsync(TIMEOUT_PADRAO_MS + 1);
      await rejeitada;
    } finally {
      vi.useRealTimers();
    }
  });

  it("o timeout é o do comando, e o handle não sobrevive à resposta", async () => {
    vi.useFakeTimers();
    try {
      const { cliente, porta } = ligado();
      const p = cliente.request("community.update", {}, undefined, 30_000);
      await vi.advanceTimersByTimeAsync(TIMEOUT_PADRAO_MS + 1);
      porta.entregar({ t: "res", epoch: 1, id: porta.do("req")[0]!.id, ok: true, data: { seq: 9 } });
      await expect(p).resolves.toEqual({ seq: 9 });
      // Nenhum timer pendente: o `advance` seguinte não teria a quem rejeitar.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sem porta, a chamada recusa em vez de ficar pendurada", async () => {
    await expect(new IpcClient().request("query.communities")).rejects.toMatchObject({ code: "E_NO_PORT" });
  });
});

describe("assinaturas e fluxo (§15.1 r. 2, r. 3, r. 5)", () => {
  it("o evento chega ao handler e o `evAck` volta — é o único backpressure que a API dá", () => {
    const { cliente, porta } = ligado();
    const vistos: unknown[] = [];
    cliente.subscribe("messages.appended", (d) => vistos.push(d), { channelId: "ch1" });
    const sub = porta.do("sub")[0]!;
    expect(sub.filter).toEqual({ channelId: "ch1" });
    porta.entregar({ t: "subOk", epoch: 1, id: sub.id, subId: 42 });
    porta.entregar({ t: "ev", epoch: 1, subId: 42, evSeq: 1, topic: "messages.appended", data: { toSeq: 5 } });
    expect(vistos).toEqual([{ toSeq: 5 }]);
    expect(porta.do("evAck")).toContainEqual({ t: "evAck", epoch: 1, subId: 42, evSeq: 1 });
  });

  it("`evStale` confirma o último `evSeq` E pede resync — as duas obrigações da regra 5", () => {
    const { cliente, porta } = ligado();
    const motivos: unknown[] = [];
    cliente.onResync((m) => motivos.push(m));
    cliente.subscribe("messages.appended", () => {});
    porta.entregar({ t: "subOk", epoch: 1, id: porta.do("sub")[0]!.id, subId: 7 });
    porta.entregar({ t: "evStale", epoch: 1, subId: 7, fromSeq: 10, toSeq: 300, dropped: 44 });
    expect(porta.do("evAck")).toContainEqual({ t: "evAck", epoch: 1, subId: 7, evSeq: 300 });
    expect(motivos).toEqual([{ tipo: "stale", topic: "messages.appended", dropped: 44 }]);
  });

  it("o `unsub` usa o `subId` do NÚCLEO, nunca um número local", () => {
    const { cliente, porta } = ligado();
    const local = cliente.subscribe("typing.changed", () => {});
    porta.entregar({ t: "subOk", epoch: 1, id: porta.do("sub")[0]!.id, subId: 99 });
    cliente.unsubscribe(local);
    expect(porta.do("unsub")).toEqual([{ t: "unsub", epoch: 1, subId: 99 }]);
  });

  it("cancelar antes do `subOk` não inventa `subId`; o `subOk` atrasado é que cancela", () => {
    const { cliente, porta } = ligado();
    const local = cliente.subscribe("typing.changed", () => {});
    cliente.unsubscribe(local);
    expect(porta.do("unsub")).toHaveLength(0);
    porta.entregar({ t: "subOk", epoch: 1, id: porta.do("sub")[0]!.id, subId: 55 });
    expect(porta.do("unsub")).toEqual([{ t: "unsub", epoch: 1, subId: 55 }]);
  });

  it("evento de um `subId` desconhecido não derruba o cliente e ainda é confirmado", () => {
    const { cliente, porta } = ligado();
    cliente.subscribe("typing.changed", () => {});
    expect(() =>
      porta.entregar({ t: "ev", epoch: 1, subId: 1234, evSeq: 1, topic: "typing.changed", data: {} }),
    ).not.toThrow();
    expect(porta.do("evAck")).toHaveLength(1);
  });
});

describe("reinício do núcleo (§15.2 passo 4)", () => {
  it("4a — pendentes falham com E_CORE_RESTARTED e NADA é reenviado", async () => {
    const { cliente, porta } = ligado(1);
    const p1 = cliente.request("message.send", { content: "oi" });
    const p2 = cliente.request("query.communities");
    const reqsAntes = porta.do("req").length;

    cliente.handleCoreEpoch(2);

    await expect(p1).rejects.toBeInstanceOf(IpcCommandError);
    await expect(p1).rejects.toMatchObject({ code: "E_CORE_RESTARTED" });
    await expect(p2).rejects.toMatchObject({ code: "E_CORE_RESTARTED" });
    // A escrita está na outbox (§15.2 passo 5): reemitir aqui a duplicaria.
    expect(porta.do("req")).toHaveLength(reqsAntes);
  });

  it("4b/4c — os `subId` antigos morrem e as assinaturas são refeitas no epoch novo", () => {
    const { cliente, porta } = ligado(1);
    const recebidos: unknown[] = [];
    cliente.subscribe("messages.appended", (d) => recebidos.push(d));
    porta.entregar({ t: "subOk", epoch: 1, id: porta.do("sub")[0]!.id, subId: 10 });

    cliente.handleCoreEpoch(2);

    const subs = porta.do("sub");
    expect(subs).toHaveLength(2);
    expect(subs[1]!.epoch).toBe(2);

    // O `subId` do núcleo morto não entrega mais nada, mesmo com o epoch novo.
    porta.entregar({ t: "ev", epoch: 2, subId: 10, evSeq: 1, topic: "messages.appended", data: { velho: true } });
    expect(recebidos).toEqual([]);

    porta.entregar({ t: "subOk", epoch: 2, id: subs[1]!.id, subId: 77 });
    porta.entregar({ t: "ev", epoch: 2, subId: 77, evSeq: 1, topic: "messages.appended", data: { novo: true } });
    expect(recebidos).toEqual([{ novo: true }]);
  });

  it("4d — o consumidor é avisado para refazer as queries, com o epoch novo", () => {
    const { cliente } = ligado(1);
    const motivos: unknown[] = [];
    cliente.onResync((m) => motivos.push(m));
    cliente.handleCoreEpoch(4);
    expect(motivos).toEqual([{ tipo: "epoch", epoch: 4 }]);
  });

  it("o mesmo epoch avisado duas vezes não refaz duas vezes", () => {
    const { cliente } = ligado(1);
    const motivos: unknown[] = [];
    cliente.onResync((m) => motivos.push(m));
    cliente.handleCoreEpoch(2);
    cliente.handleCoreEpoch(2);
    // O main manda `core-epoch` e o núcleo novo manda `hello`: os dois chegam.
    expect(motivos).toHaveLength(1);
  });

  it("o `hello` do núcleo novo, chegando antes do aviso do main, dispara o mesmo procedimento", async () => {
    const { cliente, porta } = ligado(1);
    const motivos: unknown[] = [];
    cliente.onResync((m) => motivos.push(m));
    const p = cliente.request("query.communities");
    porta.entregar(hello(2));
    await expect(p).rejects.toMatchObject({ code: "E_CORE_RESTARTED" });
    expect(motivos).toEqual([{ tipo: "epoch", epoch: 2 }]);
    expect(cliente.epoch).toBe(2);
  });

  it("o primeiro `hello` do canal NÃO é reinício: não há resync nem pendente a falhar", () => {
    const cliente = new IpcClient();
    const porta = new PortaFalsa();
    const motivos: unknown[] = [];
    cliente.onResync((m) => motivos.push(m));
    cliente.attach(porta);
    porta.entregar(hello(1));
    expect(motivos).toEqual([]);
  });
});
