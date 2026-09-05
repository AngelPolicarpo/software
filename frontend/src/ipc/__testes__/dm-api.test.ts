/**
 * O invólucro de IPC-R da conversa direta (§31.16) contra o contrato de §31.10.
 *
 * O que se testa aqui não é a forma de cada argumento — isso o `tsc` já garante —, e sim a
 * **classe de escrita**. `dm.send` é a terceira de A25: síncrona e local-durável, com o
 * registro já no log. Se o invólucro a modelasse como as escritas de §15.4, a tela otimista
 * ficaria esperando um `message.accepted` que nunca vem, e ofereceria "tentar de novo" para
 * algo que não pode falhar depois de responder.
 */

import { describe, expect, it, vi } from "vitest";
import { api, cliente } from "../api";
import * as bridge from "../bridge";

/** Captura o comando e o argumento sem tocar em porta nenhuma. */
function espiar() {
  const chamadas: Array<{ cmd: string; arg: unknown; token: string | undefined }> = [];
  vi.spyOn(cliente, "request").mockImplementation(
    (cmd: string, arg: unknown, token?: string) => {
      chamadas.push({ cmd, arg, token });
      return Promise.resolve({});
    },
  );
  return chamadas;
}

describe("§31.16.1 — os comandos de conversa direta", () => {
  it("cada invólucro chama o comando da tabela, com o argumento da tabela", async () => {
    const chamadas = espiar();

    await api.dmOpen("ab".repeat(32));
    await api.dmAccept("conv-1");
    await api.dmBlock("conv-1");
    await api.dmUnblock("conv-1");
    await api.dmSend({ conversationId: "conv-1", content: "oi", clientRef: "r1" });
    await api.dmEdit({ conversationId: "conv-1", messageId: "dmsg-1", content: "ei" });
    await api.dmDelete({ conversationId: "conv-1", messageId: "dmsg-1" });
    await api.dmReact({ conversationId: "conv-1", messageId: "dmsg-1", emoji: "👍", present: true });
    await api.dmSetProfile({ conversationId: "conv-1", displayName: "Ana" });
    await api.dmMarkRead("conv-1");
    await api.dmSetTyping({ conversationId: "conv-1", on: true });
    await api.dmSetContactPolicy("shared-community");
    await api.dmActivate("conv-1");

    expect(chamadas.map((c) => c.cmd)).toEqual([
      "dm.open",
      "dm.accept",
      "dm.block",
      "dm.unblock",
      "dm.send",
      "dm.edit",
      "dm.delete",
      "dm.react",
      "dm.setProfile",
      "dm.markRead",
      "dm.setTyping",
      "dm.setContactPolicy",
      "dm.activate",
    ]);
    expect(chamadas[0]?.arg).toEqual({ peerKey: "ab".repeat(32) });
    expect(chamadas[4]?.arg).toEqual({ conversationId: "conv-1", content: "oi", clientRef: "r1" });
    // §31.16.1 — `dm.activate{null}` é "nenhuma conversa em foco", não ausência de argumento.
    await api.dmActivate(null);
    expect(chamadas[13]?.arg).toEqual({ conversationId: null });
    vi.restoreAllMocks();
  });

  it("`dm.forget` pede o diálogo nativo antes do quadro (§15.3, main-confirmed)", async () => {
    const token = vi.spyOn(bridge, "pedirToken").mockResolvedValue("tok-1");
    const chamadas = espiar();
    await api.dmForget("conv-1");
    // §15.3 emendado (2026-09-05) — o token liga-se a `(cmd, alvo)`, então o MESMO argumento
    // vai ao pedido de token e ao quadro: é dele que os dois lados derivam o alvo, e é o que
    // impede um token de `dm.forget` de uma conversa esquecer outra.
    expect(token).toHaveBeenCalledWith("dm.forget", { conversationId: "conv-1" });
    expect(chamadas[0]?.cmd).toBe("dm.forget");
    expect(chamadas[0]?.arg).toEqual({ conversationId: "conv-1" });
    expect(chamadas[0]?.token).toBe("tok-1");
    vi.restoreAllMocks();
  });

  it("as cinco queries de §31.16.3 são as cinco, e nenhuma a mais", async () => {
    const chamadas = espiar();
    await api.dmConversations();
    await api.dmConversation("conv-1");
    await api.dmMessages({ conversationId: "conv-1", limit: 50, direction: "before" });
    await api.dmMessage({ conversationId: "conv-1", messageId: "dmsg-1" });
    await api.dmPrefs();
    expect(chamadas.map((c) => c.cmd)).toEqual([
      "query.dmConversations",
      "query.dmConversation",
      "query.dmMessages",
      "query.dmMessage",
      "query.dmPrefs",
    ]);
    vi.restoreAllMocks();
  });
});

describe("§31.10 — a terceira classe de escrita, refletida no cliente", () => {
  it("`dmSend` devolve o registro já no log; não há `opId` nem `state:'queued'`", async () => {
    vi.spyOn(cliente, "request").mockResolvedValue({
      messageId: "dmsg-ABC",
      ordSum: 7,
      state: "written",
      clientRef: "r1",
    });
    const r = await api.dmSend({ conversationId: "conv-1", content: "oi", clientRef: "r1" });
    expect(r.state).toBe("written");
    expect(r.messageId).toBe("dmsg-ABC");
    expect(r.ordSum).toBe(7);
    expect((r as unknown as { opId?: string }).opId).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("não existe `dmRetry` nem `dmCancelQueued` — e a ausência é normativa (§31.10)", () => {
    // Não há fila durável, logo não há nada pendente a retentar nem a cancelar. O que existe
    // é apagar (`dmDelete`, tombstone). Um invólucro para eles seria superfície que o núcleo
    // recusa por construção — e a tela que os oferecesse mentiria sobre o modelo.
    const nomes = Object.keys(api);
    expect(nomes).toContain("messageRetry");
    expect(nomes).toContain("messageCancelQueued");
    expect(nomes).not.toContain("dmRetry");
    expect(nomes).not.toContain("dmCancelQueued");
    expect(nomes).toContain("dmDelete");
  });
});
