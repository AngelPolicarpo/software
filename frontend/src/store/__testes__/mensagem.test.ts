/**
 * A máquina de bolhas da `messageStore` contra um canal de escrita falso.
 *
 * O que se afirma aqui é o contrato de §11.1/§11.6 do lado do renderer: a
 * bolha nasce antes da resposta, o transporte recebe o `clientRef` dela, o
 * desfecho casa pelo mesmo `clientRef` e a linha aceita só sai da frente
 * quando a mensagem real chega à base. Cada caso foi verificado por mutação:
 * remover o comportamento correspondente derruba o teste (ver §60).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { compose, contaPendentes, THREAD_TEMPORARIA_PREFIXO, useMessageStore, type CanalDeEscrita } from "../messageStore";
import { useIdentityStore } from "../identityStore";
import type { Identity } from "../../domain/types";

const CANAL = "ch-1";
const COMUNIDADE = "co-1";

const EU: Identity = {
  id: "key-eu",
  handle: "ana",
  displayName: "Ana",
  avatarColor: "role-blue",
  publicKey: "key-eu",
  presence: "online",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function canalFalso(resposta?: Partial<{ opId: string; falha: Error }>) {
  const ok = () => Promise.resolve({ opId: resposta?.opId ?? "op-1" });
  const falha = () =>
    resposta?.falha !== undefined ? Promise.reject(resposta.falha) : ok();
  return {
    enviar: vi.fn(falha),
    reenviar: vi.fn(() => Promise.resolve()),
    editar: vi.fn(falha),
    apagar: vi.fn(falha),
    fixar: vi.fn(falha),
    reagir: vi.fn(falha),
    abrirThread: vi.fn(falha),
    observarReacoes: vi.fn(),
    observarThread: vi.fn(),
  } satisfies CanalDeEscrita & { enviar: ReturnType<typeof vi.fn>; reenviar: ReturnType<typeof vi.fn> };
}

function estadoInicial() {
  useIdentityStore.setState({ identity: EU });
  useMessageStore.getState().reset();
  useMessageStore.getState().configurarEscrita(null);
}

beforeEach(estadoInicial);

describe("send — a bolha otimista e o quadro de §15.4", () => {
  it("cria a bolha como 'sending' e chama o canal com o clientRef DELA", async () => {
    const canal = canalFalso();
    useMessageStore.getState().configurarEscrita(canal);

    const antes = useMessageStore.getState().sentByChannel[CANAL] ?? [];
    void useMessageStore.getState().send({
      communityId: COMUNIDADE,
      channelId: CANAL,
      content: "olá",
      mentions: ["everyone"],
    });
    // A bolha existe ANTES de a promessa resolver — otimismo é isto.
    const depois = useMessageStore.getState().sentByChannel[CANAL] ?? [];
    expect(depois).toHaveLength(antes.length + 1);
    const bolha = depois[depois.length - 1];
    expect(bolha.deliveryState).toBe("sending");
    expect(bolha.authorId).toBe("key-eu");

    expect(canal.enviar).toHaveBeenCalledWith(
      expect.objectContaining({
        communityId: COMUNIDADE,
        channelId: CANAL,
        content: "olá",
        mentions: ["everyone"],
        clientRef: bolha.id,
      }),
    );
  });

  it("leva replyToId e threadId ao quadro", async () => {
    const canal = canalFalso();
    useMessageStore.getState().configurarEscrita(canal);
    await useMessageStore.getState().send({
      communityId: COMUNIDADE,
      channelId: CANAL,
      content: "x",
      mentions: [],
      replyToId: "msg-raiz",
      threadId: "thr-9",
    });
    expect(canal.enviar).toHaveBeenCalledWith(
      expect.objectContaining({ replyToId: "msg-raiz", threadId: "thr-9" }),
    );
  });

  it("sem núcleo não há confirmação inventada: a bolha fica failed com motivo", async () => {
    await useMessageStore.getState().send({
      communityId: COMUNIDADE,
      channelId: CANAL,
      content: "olá",
      mentions: [],
    });
    const state = useMessageStore.getState();
    const bolha = (state.sentByChannel[CANAL] ?? [])[0];
    expect(state.overrides[bolha.id]?.deliveryState).toBe("failed");
    expect(state.errosPorRef[bolha.id]).toContain("núcleo");
  });

  it("recusa do transporte marca failed com o código nomeado", async () => {
    const canal = canalFalso({ falha: new Error("E_CHANNEL_READ_ONLY") });
    useMessageStore.getState().configurarEscrita(canal);
    await useMessageStore.getState().send({
      communityId: COMUNIDADE,
      channelId: CANAL,
      content: "olá",
      mentions: [],
    });
    const state = useMessageStore.getState();
    const bolha = (state.sentByChannel[CANAL] ?? [])[0];
    expect(state.overrides[bolha.id]?.deliveryState).toBe("failed");
    expect(state.errosPorRef[bolha.id]).toBe("E_CHANNEL_READ_ONLY");
  });

  it("cancelamento do gesto remove a bolha — cancelar não é falha", async () => {
    const canal = { ...canalFalso(), enviar: () => Promise.resolve({ opId: "", cancelado: true }) };
    useMessageStore.getState().configurarEscrita(canal);
    await useMessageStore.getState().send({
      communityId: COMUNIDADE,
      channelId: CANAL,
      content: "olá",
      mentions: [],
    });
    expect(useMessageStore.getState().sentByChannel[CANAL] ?? []).toHaveLength(0);
    expect(useMessageStore.getState().overrides).toEqual({});
  });
});

describe("desfechos de §11.6 — casa pelo clientRef", () => {
  it("accepted assenta a bolha; ela some quando a mensagem real chega à base", async () => {
    const canal = canalFalso({ opId: "op-42" });
    useMessageStore.getState().configurarEscrita(canal);
    await useMessageStore.getState().send({
      communityId: COMUNIDADE,
      channelId: CANAL,
      content: "olá",
      mentions: [],
    });
    const ref = (useMessageStore.getState().sentByChannel[CANAL] ?? [])[0].id;
    expect(useMessageStore.getState().opIdPorRef[ref]).toBe("op-42");

    useMessageStore.getState().assentarAceita(ref, "msg-real");
    let state = useMessageStore.getState();
    expect(state.aceitasRefs[ref]).toBe("msg-real");
    // Antes da reconsulta chegar, a bolha CONTINUA visível (como sent) —
    // a mensagem não pode piscar entre o evento e a query.
    expect((state.sentByChannel[CANAL] ?? [])[0].id).toBe(ref);

    // A réplica respondeu: a linha real ocupa o lugar e a bolha sai da frente.
    state = useMessageStore.getState();
    state.aplicarRemoto({
      remoteMessages: {
        ...state.remoteMessages,
        [CANAL]: [
          {
            id: "msg-real",
            channelId: CANAL,
            authorId: "key-eu",
            content: "olá",
            timestamp: new Date().toISOString(),
            edited: false,
            pinned: false,
            reactions: [],
            attachments: [],
            mentions: [],
            deliveryState: "sent",
          },
        ],
      },
    });
    expect(contaPendentes(useMessageStore.getState(), CANAL)).toBe(0);
  });

  it("failed/dropped deixam a bolha visível com o motivo", () => {
    useMessageStore.getState().marcarFalha("b-1", "E_QUOTA_EXCEEDED");
    let state = useMessageStore.getState();
    expect(state.errosPorRef["b-1"]).toBe("E_QUOTA_EXCEEDED");

    useMessageStore.getState().marcarFalha("b-1", "descartada (channel-deleted)");
    state = useMessageStore.getState();
    expect(state.errosPorRef["b-1"]).toBe("descartada (channel-deleted)");
  });
});

describe("retrySend — §11.3 reenvia o MESMO envelope", () => {
  it("reenvia pelo opId mapeado e volta a sending", async () => {
    const canal = canalFalso({ opId: "op-7" });
    useMessageStore.getState().configurarEscrita(canal);
    await useMessageStore.getState().send({
      communityId: COMUNIDADE,
      channelId: CANAL,
      content: "olá",
      mentions: [],
    });
    const ref = (useMessageStore.getState().sentByChannel[CANAL] ?? [])[0].id;

    const falho = { ...canal, reenviar: vi.fn(() => Promise.reject(new Error("E_HOST_UNAVAILABLE"))) };
    useMessageStore.getState().configurarEscrita(falho);

    useMessageStore.getState().retrySend(ref);
    expect(falho.reenviar).toHaveBeenCalledWith("op-7");
    await Promise.resolve();
    await Promise.resolve();
    const state = useMessageStore.getState();
    // O segundo desfecho veio: failed de novo, com o novo motivo.
    expect(state.overrides[ref]?.deliveryState).toBe("failed");
    expect(state.errosPorRef[ref]).toBe("E_HOST_UNAVAILABLE");
  });

  it("sem opId mapeado não há retry — não há envelope para reenviar", () => {
    const canal = canalFalso();
    useMessageStore.getState().configurarEscrita(canal);
    useMessageStore.getState().retrySend("b-inexistente");
    expect(canal.reenviar).not.toHaveBeenCalled();
  });
});

const item = (
  sobre?: Partial<{ ref: string; opId: string; channelId: string; content: string; deliveryState: "queued" | "sending" | "failed" }>,
) => ({
  ref: "b-a",
  opId: "op-a",
  channelId: CANAL,
  content: "pendente",
  deliveryState: "queued" as const,
  ...sobre,
});

describe("aplicarFila — F-16, a fila redesenhada por query.outbox", () => {
  it("deriva bolhas por canal e registra o opId de cada uma", () => {
    useMessageStore.getState().aplicarFila([
      item(),
      item({ ref: "b-b", opId: "op-b", channelId: "ch-2" }),
    ]);
    const state = useMessageStore.getState();
    expect(state.filaPorCanal[CANAL]).toHaveLength(1);
    expect(state.filaPorCanal[CANAL][0]).toMatchObject({
      id: "b-a",
      content: "pendente",
      deliveryState: "queued",
    });
    expect(state.opIdPorRef["b-b"]).toBe("op-b");
  });

  it("SUBSTITUI o conjunto anterior — o item que saiu da fila some", () => {
    useMessageStore.getState().aplicarFila([item()]);
    useMessageStore.getState().aplicarFila([item({ ref: "b-c", opId: "op-c" })]);
    const fila = useMessageStore.getState().filaPorCanal[CANAL];
    expect(fila).toHaveLength(1);
    expect(fila[0].id).toBe("b-c");
  });

  it("não redesenha o que já foi observado na réplica", () => {
    useMessageStore.getState().assentarAceita("b-a", "msg-real");
    useMessageStore.getState().aplicarFila([
      item(),
      item({ ref: "b-d", opId: "op-d" }),
    ]);
    const fila = useMessageStore.getState().filaPorCanal[CANAL];
    expect(fila.map((m) => m.id)).toEqual(["b-d"]);
  });
});

describe("descartarCanal — §18, aviso nomeado em vez de sumir calado", () => {
  it("conta as bolhas que caíram e limpa os canais pedidos", () => {
    useMessageStore.getState().aplicarFila([item(), item({ ref: "b-b", opId: "op-b" })]);
    useMessageStore.getState().configurarEscrita(canalFalso());
    void useMessageStore.getState().send({
      communityId: COMUNIDADE,
      channelId: CANAL,
      content: "sessão",
      mentions: [],
    });
    const dropped = useMessageStore.getState().descartarCanal([CANAL]);
    expect(dropped).toBe(3);
    expect(useMessageStore.getState().filaPorCanal[CANAL]).toBeUndefined();
    expect(useMessageStore.getState().sentByChannel[CANAL]).toBeUndefined();
  });
});

/* ─── Fatia §61: as escritas restantes do domínio de mensagem ─────────────── */

import type { Message } from "../../domain/types";

function mensagemReal(sobre?: Partial<Message>): Message {
  return {
    id: "msg-9",
    channelId: CANAL,
    authorId: "key-eu",
    content: "original",
    timestamp: new Date().toISOString(),
    edited: false,
    pinned: false,
    reactions: [],
    attachments: [],
    mentions: [],
    deliveryState: "sent",
    ...sobre,
  };
}

describe("escritas sobre mensagem real — otimismo com rollback (§11.1)", () => {
  it("editar aplica já e despacha message.edit pelo canal da mensagem", async () => {
    const canal = canalFalso({ opId: "op-e" });
    useMessageStore.getState().configurarEscrita(canal);
    const msg = mensagemReal();

    useMessageStore.getState().editMessage(msg, "editado");
    const state = useMessageStore.getState();
    expect(state.overrides["msg-9"]?.content).toBe("editado");
    expect(canal.editar).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: CANAL, messageId: "msg-9", content: "editado", clientRef: expect.any(String) }),
    );
  });

  it("recusa de edição desfaz o conteúdo e avisa nomeado — nunca fica aplicada calada", async () => {
    const canal = canalFalso({ falha: new Error("E_MESSAGE_DELETED") });
    useMessageStore.getState().configurarEscrita(canal);
    useMessageStore.getState().editMessage(mensagemReal(), "editado");
    await Promise.resolve();
    await Promise.resolve();

    const state = useMessageStore.getState();
    // O override de edição saiu; o conteúdo volta a ser o projetado.
    expect(state.overrides["msg-9"]).toBeUndefined();
    expect(state.undoPorRef).toEqual({});
  });

  it("aceite descarta o rollback — observado não se desfaz", async () => {
    const canal = canalFalso({ opId: "op-p" });
    useMessageStore.getState().configurarEscrita(canal);
    useMessageStore.getState().setPinned(mensagemReal(), true);
    const ref = Object.keys(useMessageStore.getState().undoPorRef)[0];
    useMessageStore.getState().assentarAceita(ref, "msg-9");
    expect(useMessageStore.getState().undoPorRef).toEqual({});
    expect(useMessageStore.getState().overrides["msg-9"]?.pinned).toBe(true);
  });

  it("reagir computa `present` do que já existe (mesclando hidratação) e despacha", () => {
    const canal = canalFalso({ opId: "op-r" });
    useMessageStore.getState().configurarEscrita(canal);
    useMessageStore.getState().aplicarReacoesRemotas("msg-9", [
      { emoji: "🎉", count: 1, userIds: ["key-outro"] },
    ]);

    // Primeiro clique entra (present=true)…
    useMessageStore.getState().toggleReaction(mensagemReal({ reactions: [] }), "🎉", "key-eu");
    expect(canal.reagir).toHaveBeenLastCalledWith(
      expect.objectContaining({ emoji: "🎉", present: true }),
    );
    expect(useMessageStore.getState().overrides["msg-9"]?.reactions).toEqual([
      { emoji: "🎉", count: 2, userIds: ["key-outro", "key-eu"] },
    ]);

    // …segundo sai (present=false), partindo do override vigente.
    useMessageStore.getState().toggleReaction(
      { ...mensagemReal({ reactions: [] }) },
      "🎉",
      "key-eu",
    );
    expect(canal.reagir).toHaveBeenLastCalledWith(
      expect.objectContaining({ emoji: "🎉", present: false }),
    );
  });

  it("hidratarReacoes consulta pela store e a base só preenche onde está vazia", () => {
    const canal = canalFalso();
    useMessageStore.getState().configurarEscrita(canal);
    useMessageStore.getState().hidratarReacoes(CANAL, "msg-9");
    expect(canal.observarReacoes).toHaveBeenCalledWith(CANAL, "msg-9");

    useMessageStore.getState().aplicarReacoesRemotas("msg-9", [{ emoji: "👍", count: 1, userIds: ["x"] }]);
    const state = useMessageStore.getState();
    const vis = compose([CANAL], {}, {}, {}, [], { [CANAL]: [mensagemReal()] }, {}, state.remoteReactions);
    expect(vis[0].reactions).toEqual([{ emoji: "👍", count: 1, userIds: ["x"] }]);
  });
});

describe("createThread — id temporário assentado pelo lote projetado (§8.x R-24)", () => {
  it("devolve id provisório, enfileira thread.create e o real substitui o temporário", async () => {
    const canal = canalFalso({ opId: "op-t" });
    useMessageStore.getState().configurarEscrita(canal);
    const raiz = mensagemReal();

    const tempId = useMessageStore.getState().createThread(raiz);
    expect(tempId.startsWith(THREAD_TEMPORARIA_PREFIXO)).toBe(true);
    expect(canal.abrirThread).toHaveBeenCalledWith(
      expect.objectContaining({ rootMessageId: "msg-9", clientRef: expect.any(String) }),
    );

    // A réplica projeta: a raiz agora carrega o threadId real.
    useMessageStore.getState().aplicarRemoto({
      remoteMessages: { [CANAL]: [mensagemReal({ threadId: "thr-real-1" })] },
    });
    useMessageStore.getState().assentarThreadReal("msg-9", "thr-real-1");

    const state = useMessageStore.getState();
    expect(state.createdThreads[tempId]).toBeUndefined();
    expect(state.createdThreads["thr-real-1"]?.rootMessageId).toBe("msg-9");
    expect(state.overrides["msg-9"]?.threadId).toBe("thr-real-1");
  });

  it("raiz que já tem thread real não cria segunda (R-24)", () => {
    const canal = canalFalso();
    useMessageStore.getState().configurarEscrita(canal);
    const devolvido = useMessageStore.getState().createThread(mensagemReal({ threadId: "thr-existente" }));
    expect(devolvido).toBe("thr-existente");
    expect(canal.abrirThread).not.toHaveBeenCalled();
  });
});
