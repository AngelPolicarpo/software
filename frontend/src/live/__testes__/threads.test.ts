/**
 * O registro de threads de OUTRAS instalações (§61.4) a partir da página do canal.
 *
 * O que se afirma: a raiz de uma thread é o registro de MENOR `seq` do grupo (o fold só
 * aceita resposta em thread existente — R-24 —, então todo o resto veio depois dela),
 * threads já conhecidas não são reemitidas (sobrescrever reverteria o assentamento da
 * temporária local) e mensagem sem `threadId` não cria thread nenhuma. Verificado por
 * mutação: trocar min→max derruba o caso da raiz; remover o filtro derruba o de conhecidas.
 */

import { describe, expect, it } from "vitest";
import { threadsDaPagina } from "../adaptadores";

const CANAL = "ch-1";

function dto(id: string, seq: number, threadId?: string) {
  return { id, seq, ...(threadId !== undefined ? { threadId } : {}), channelId: CANAL };
}

describe("threadsDaPagina — a thread que o canal revela e a store não conhece", () => {
  it("a raiz é o registro de MENOR seq do grupo, não o primeiro da página", () => {
    // A página desce de `before` e chega invertida: a raiz é a ÚLTIMA a aparecer.
    const threads = threadsDaPagina(
      [dto("r3", 3, "t1"), dto("r7", 7, "t1"), dto("r5", 5, "t1")],
      new Set(),
    );

    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      id: "t1",
      rootMessageId: "r3",
      channelId: CANAL,
    });
  });

  it("thread já conhecida não é reemitida — assentarThreadReal é quem manda na local", () => {
    const threads = threadsDaPagina([dto("r1", 1, "t-conhecida")], new Set(["t-conhecida"]));
    expect(threads).toEqual([]);
  });

  it("mensagem sem threadId não cria thread nenhuma", () => {
    const threads = threadsDaPagina([dto("r1", 1), dto("r2", 2)], new Set());
    expect(threads).toEqual([]);
  });

  it("grupos distintos viram threads distintas, cada uma com a raiz dela", () => {
    const threads = threadsDaPagina(
      [dto("a2", 2, "tA"), dto("a9", 9, "tA"), dto("b4", 4, "tB"), dto("b1", 1, "tB")],
      new Set(),
    );

    const porId = new Map(threads.map((t) => [t.id, t.rootMessageId]));
    expect(porId.get("tA")).toBe("a2");
    expect(porId.get("tB")).toBe("b1");
  });
});
