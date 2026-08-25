/**
 * O adaptador de `query.search` (§23.1) para os resultados que o painel desenha.
 *
 * O que se afirma: o hit do FTS atravessa com canal/autor/trecho no lugar — quem
 * buscou não precisa mais nada da tela —, membro vira o `Member` do domínio
 * (presença por ausência, §6.1) e `partial`/`partialReason` atravessam SEM
 * tradução: as quatro causas são do fio, e inventar uma quinta aqui seria
 * mentir sobre a origem. Verificado por mutação: trocar `authorTs` por `hostTs`
 * na ordenação do timestamp derruba o caso do relógio.
 */

import { describe, expect, it } from "vitest";
import { resultadoDeBusca } from "../adaptadores";
import type { SearchResult } from "../../ipc/dto";

const BASE: SearchResult = {
  messages: [
    {
      id: "m-1",
      seq: 9,
      channelId: "ch-1",
      channelName: "geral",
      authorKeyHex: "aa".repeat(32),
      content: "a reunião mudou para quinta",
      snippet: "a reunião mudou para ‹quinta›",
      authorTs: 1_700_000_000_000,
      hostTs: 1_700_000_001_000,
      clockSkewed: false,
      editedAt: null,
      pinned: false,
      threadId: null,
    },
  ],
  channels: [{ id: "ch-2", name: "vendas", type: 0, categoryId: "cat-1" }],
  members: [
    { identityKeyHex: "bb".repeat(32), displayName: "Duda", nickname: "duduzinha" },
    { identityKeyHex: "cc".repeat(32), displayName: "Rafa", nickname: null },
  ],
  partial: false,
};

describe("resultadoDeBusca — o hit do FTS vira resultado de tela", () => {
  it("mensagem: canal, autor e trecho vêm no hit; timestamp é o do AUTOR", () => {
    const r = resultadoDeBusca(BASE);
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatchObject({
      id: "m-1",
      channelId: "ch-1",
      channelName: "geral",
      authorId: "aa".repeat(32),
      snippet: "a reunião mudou para ‹quinta›",
    });
    // §23.2 ordena por recência; o relógio que vale é o do autor da mensagem,
    // não o hostTs do lote — um relógio de host adiantado não reescreve o passado.
    expect(r.messages[0].timestamp).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("canal: id e nome bastam ao painel", () => {
    const r = resultadoDeBusca(BASE);
    expect(r.channels).toEqual([{ id: "ch-2", name: "vendas" }]);
  });

  it("membro: apelido entra quando existe; sem apelido é ausência, não vazio", () => {
    const r = resultadoDeBusca(BASE);
    expect(r.members).toHaveLength(2);
    expect(r.members[0]).toMatchObject({ identityId: "bb".repeat(32), nickname: "duduzinha" });
    expect(r.members[1]).toMatchObject({ identityId: "cc".repeat(32) });
    expect("nickname" in r.members[1]).toBe(false);
    // §6.1 — offline nunca é publicado; é AUSÊNCIA de presença.
    expect(r.members[0].presence).toBe("offline");
  });

  it("partial e partialReason atravessam sem tradução", () => {
    const parcial = resultadoDeBusca({
      ...BASE,
      partial: true,
      partialReason: "catching-up",
    });
    expect(parcial.partial).toBe(true);
    expect(parcial.partialReason).toBe("catching-up");

    const inteira = resultadoDeBusca(BASE);
    expect(inteira.partial).toBe(false);
    expect("partialReason" in inteira).toBe(false);
  });
});
