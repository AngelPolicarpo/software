/**
 * A ponte de §31.16 entre o núcleo e a store da conversa direta — U-33 / B60.
 *
 * O que se afirma aqui é o comportamento que os testes de regra não alcançam, porque
 * depende de ordem e de chamada ao fio:
 *
 * - `dm.reordered` descarta a faixa **antes** da reconsulta (é o único dos doze eventos
 *   que aplica payload — ver o cabeçalho de `live/dm.ts`);
 * - abrir uma conversa chama `dm.activate` (residência do projetor, §31.16.1) e só marca
 *   como lida **depois** de carregar;
 * - `E_LIMIT_EXCEEDED` num pedido vira a superfície do teto de §31.9 regra 4, e não um
 *   toast que some;
 * - o envio que falha **não** deixa estado pendente na store: não há outbox (§31.10).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  dmConversations: vi.fn<() => Promise<unknown>>(),
  dmConversation: vi.fn<() => Promise<unknown>>(),
  dmMessages: vi.fn<() => Promise<unknown>>(),
  dmPrefs: vi.fn<() => Promise<unknown>>(),
  dmActivate: vi.fn<() => Promise<unknown>>(),
  dmMarkRead: vi.fn<() => Promise<unknown>>(),
  dmAccept: vi.fn<() => Promise<unknown>>(),
  dmOpen: vi.fn<() => Promise<unknown>>(),
  dmSend: vi.fn<() => Promise<unknown>>(),
  dmForget: vi.fn<() => Promise<unknown>>(),
}));
const cliente = vi.hoisted(() => ({ subscribe: vi.fn() }));
const toast = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("../../ipc/api", () => ({ api, cliente }));
vi.mock("../../store/toastStore", () => ({
  useToastStore: { getState: () => toast },
}));

import {
  abrirConversa,
  aceitarConversa,
  assinarDm,
  enviarMensagem,
  sincronizarConversas,
} from "../dm";
import { useDmStore } from "../../store/dmStore";
import type { DmMessageDto } from "../../ipc/dto";

const par = { key: "aa", displayName: "Ana", handle: "@ana", avatarColor: 0 };

function msg(id: string, ordSum: number): DmMessageDto {
  return {
    id,
    ordSum,
    conversationId: "c1",
    author: par,
    content: id,
    ts: 1,
    clockSkewed: false,
    ackAhead: false,
    hasAttachment: false,
    deleted: false,
  };
}

function ouvinte(topic: string): (d: unknown) => void {
  const chamada = cliente.subscribe.mock.calls.find((c) => c[0] === topic);
  if (chamada === undefined) throw new Error(`sem assinatura de ${topic}`);
  return chamada[1] as (d: unknown) => void;
}

beforeEach(() => {
  vi.clearAllMocks();
  useDmStore.setState({
    conversas: [],
    detalhe: null,
    ativa: null,
    porConversa: {},
    contactPolicy: "anyone",
    pendentesNoTeto: false,
    digitando: {},
  });
  api.dmConversations.mockResolvedValue({ conversations: [] });
  api.dmMessages.mockResolvedValue({ messages: [], hasMore: false, sync: "synced" });
  api.dmConversation.mockResolvedValue(null);
  api.dmActivate.mockResolvedValue({ residency: "active" });
  api.dmMarkRead.mockResolvedValue({ unreadCount: 0 });
});

describe("§31.16.1 — abrir uma conversa", () => {
  it("chama `dm.activate` e só marca como lida DEPOIS de carregar", async () => {
    const ordem: string[] = [];
    api.dmActivate.mockImplementation(async () => {
      ordem.push("activate");
      return { residency: "active" };
    });
    api.dmMessages.mockImplementation(async () => {
      ordem.push("messages");
      return { messages: [msg("m1", 1)], hasMore: false, sync: "synced" };
    });
    api.dmMarkRead.mockImplementation(async () => {
      ordem.push("markRead");
      return { unreadCount: 0 };
    });

    await abrirConversa("c1");

    // Marcar antes de carregar daria por lido o que a tela ainda não tem (A28).
    expect(ordem).toEqual(["activate", "messages", "markRead"]);
    expect(useDmStore.getState().ativa).toBe("c1");
    expect(useDmStore.getState().porConversa["c1"]?.mensagens.map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("§31.13 — `dm.reordered` é o evento que a UI não pode ignorar", () => {
  it("descarta a faixa na hora, antes de a reconsulta voltar", async () => {
    assinarDm();
    useDmStore.setState({
      ativa: "c1",
      porConversa: {
        c1: {
          mensagens: [msg("m1", 1), msg("m2", 2), msg("m3", 3)],
          temMais: false,
          recarregando: false,
        },
      },
    });
    // A reconsulta fica pendurada: o que se mede é o estado ANTES de ela responder.
    api.dmMessages.mockReturnValue(new Promise(() => {}));

    ouvinte("dm.reordered")({ conversationId: "c1", fromOrdSum: 2 });

    const carregada = useDmStore.getState().porConversa["c1"];
    expect(carregada?.mensagens.map((m) => m.ordSum)).toEqual([1]);
    // Sem esta marca a conversa apareceria simplesmente encolhida.
    expect(carregada?.recarregando).toBe(true);
    expect(api.dmMessages).toHaveBeenCalled();
  });

  it("os outros eventos NÃO mexem na lista: são sinal para reconsultar (§15.1 r. 5)", async () => {
    assinarDm();
    useDmStore.setState({
      ativa: "c1",
      porConversa: { c1: { mensagens: [msg("m1", 1)], temMais: false, recarregando: false } },
    });
    api.dmMessages.mockReturnValue(new Promise(() => {}));

    ouvinte("dm.appended")({ conversationId: "c1", fromOrdSum: 1, toOrdSum: 2, hasIncoming: true });

    expect(useDmStore.getState().porConversa["c1"]?.mensagens).toHaveLength(1);
    expect(useDmStore.getState().porConversa["c1"]?.recarregando).toBe(false);
  });
});

describe("§31.9 regra 4 — o teto de pendentes precisa aparecer", () => {
  it("`E_LIMIT_EXCEEDED` liga a superfície do teto, e não vira toast que some", async () => {
    // Não há descarte silencioso do mais antigo: um pedido recusado que ninguém vê é o
    // mesmo que o descarte que a regra recusa.
    api.dmAccept.mockRejectedValue(Object.assign(new Error("cheio"), { code: "E_LIMIT_EXCEEDED" }));

    await aceitarConversa("c1");

    expect(useDmStore.getState().pendentesNoTeto).toBe(true);
    expect(toast.showToast).not.toHaveBeenCalled();
  });

  it("aceitar com sucesso desliga o teto — a fila abriu uma vaga", async () => {
    useDmStore.setState({ pendentesNoTeto: true });
    api.dmAccept.mockResolvedValue({ state: "accepted" });

    await aceitarConversa("c1");

    expect(useDmStore.getState().pendentesNoTeto).toBe(false);
  });
});

describe("§31.10 — não há outbox, e a store não pode inventar uma", () => {
  it("envio que falha não deixa mensagem nenhuma na conversa", async () => {
    api.dmSend.mockRejectedValue(Object.assign(new Error("x"), { code: "E_INTERNAL" }));
    useDmStore.setState({
      ativa: "c1",
      porConversa: { c1: { mensagens: [], temMais: false, recarregando: false } },
    });

    const ok = await enviarMensagem("c1", "oi");

    expect(ok).toBe(false);
    // Nada de `pending`/`failed`: os cinco estados de outbox não são declarados em §31.11
    // porque não podem ocorrer, e uma linha "falhou" seria um deles.
    expect(useDmStore.getState().porConversa["c1"]?.mensagens).toEqual([]);
    expect(toast.showToast).toHaveBeenCalledWith("A mensagem não foi escrita", "error");
  });

  it("envio que resolve recarrega a conversa — a mensagem já está no log", async () => {
    api.dmSend.mockResolvedValue({ messageId: "m9", ordSum: 9 });
    api.dmMessages.mockResolvedValue({ messages: [msg("m9", 9)], hasMore: false, sync: "synced" });

    expect(await enviarMensagem("c1", "oi")).toBe(true);
    expect(useDmStore.getState().porConversa["c1"]?.mensagens.map((m) => m.id)).toEqual(["m9"]);
  });
});

describe("A lista", () => {
  it("falha de consulta preserva o espelho em vez de esvaziar a tela", async () => {
    useDmStore.setState({
      conversas: [
        {
          conversationId: "c1",
          peer: par,
          state: "accepted",
          sync: "synced",
          unread: { count: 0 },
        },
      ],
    });
    api.dmConversations.mockRejectedValue(new Error("sem porta"));

    await sincronizarConversas();

    expect(useDmStore.getState().conversas).toHaveLength(1);
  });
});
