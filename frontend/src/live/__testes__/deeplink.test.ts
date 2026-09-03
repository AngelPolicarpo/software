/**
 * B64 — o link de pessoa (`comunidadep2p://u/<KEY64>`) posiciona na confirmação.
 *
 * O que se afirma: a rota `user` preenche o contato pendente e NUNCA dispara `dm.open`
 * sozinha (§3.5 regra 3) — abrir exige o clique explícito na "Nova conversa". As rotas
 * existentes (`join`, `message`) continuam com o comportamento de antes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  dmOpen: vi.fn(),
  inviteResolve: vi.fn(),
  resolveMessageLink: vi.fn(),
}));

vi.mock("../../ipc/api", () => ({
  api,
  cliente: { subscribe: vi.fn(), onResync: vi.fn(), handleCoreEpoch: vi.fn() },
}));

import { useDeeplinks } from "../deeplink";

const OUTRA = "bb".repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
  useDeeplinks.setState({ convite: null, mensagem: null, contato: null });
});

describe("deep link de pessoa — confirmação, nunca ação", () => {
  it("preenche o contato e não chama `dm.open`", async () => {
    await useDeeplinks.getState().receber({ route: "user", key: OUTRA });

    expect(useDeeplinks.getState().contato).toEqual({ peerKey: OUTRA });
    expect(api.dmOpen).not.toHaveBeenCalled();
  });

  it("normaliza a caixa da chave para minúsculas", async () => {
    await useDeeplinks.getState().receber({ route: "user", key: OUTRA.toUpperCase() });

    expect(useDeeplinks.getState().contato).toEqual({ peerKey: OUTRA });
  });

  it("fechar o contato limpa a intenção pendente", async () => {
    await useDeeplinks.getState().receber({ route: "user", key: OUTRA });
    useDeeplinks.getState().fecharContato();

    expect(useDeeplinks.getState().contato).toBeNull();
  });

  it("um segundo link substitui o anterior, sem acumular", async () => {
    const SEGUNDA = "cc".repeat(32);
    await useDeeplinks.getState().receber({ route: "user", key: OUTRA });
    await useDeeplinks.getState().receber({ route: "user", key: SEGUNDA });

    expect(useDeeplinks.getState().contato).toEqual({ peerKey: SEGUNDA });
    expect(api.dmOpen).not.toHaveBeenCalled();
  });
});
