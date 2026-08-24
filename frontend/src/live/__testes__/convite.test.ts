/**
 * O caminho de convite do lado do renderer: `entrarComunidade` é a porta de §12.4.
 *
 * O que se afirma: o código vai INTEIRO ao núcleo (`invite.redeem` — a gramática de
 * §15.4 e os desfechos de §12.3 são dele, não da tela), a resposta vira o par
 * comunidade/canal padrão, e o resync corre DEPOIS do resgate — é ele quem traz o rail
 * novo de `query.communities`, então sem o recarregar a comunidade resgatada não existe
 * na UI. Cada caso verificado por mutação: remover o `recarregar()` ou engolir a recusa
 * derruba o teste correspondente.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreStatus } from "../../ipc/dto";

const api = vi.hoisted(() => ({
  coreStatus: vi.fn<() => Promise<CoreStatus>>(),
  identity: vi.fn<() => Promise<unknown>>(),
  inviteRedeem: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("../../ipc/api", () => ({
  api,
  cliente: { subscribe: vi.fn(), onResync: vi.fn(), handleCoreEpoch: vi.fn() },
}));

import { useSessao } from "../sessao";

const STATUS_PRONTO: CoreStatus = {
  phase: "ready",
  epoch: 1,
  coreVersion: "0",
  opVersion: 1,
  manifestSchemaVersion: 1,
  viewSchemaVersion: 1,
  keystore: "insecure-fallback",
  buildChannel: "dev",
};

function núcleoPronto(): void {
  api.coreStatus.mockResolvedValue(STATUS_PRONTO);
  api.identity.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  núcleoPronto();
});

describe("entrarComunidade — §12.4 pelo canal do renderer", () => {
  it("manda o código ao invite.redeem e devolve comunidade + canal padrão", async () => {
    api.inviteRedeem.mockResolvedValue({
      communityId: "ab".repeat(32),
      defaultChannelId: "ch-1",
      seq: 3,
    });

    const r = await useSessao.getState().entrarComunidade({
      codeOrLink: "X7K2-QM9F-RT4B-N8ZP",
    });

    expect(api.inviteRedeem).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ communityId: "ab".repeat(32), defaultChannelId: "ch-1" });
  });

  it("o resgate vem ANTES do resync — o rail novo só existe depois dele", async () => {
    api.inviteRedeem.mockResolvedValue({
      communityId: "cd".repeat(32),
      defaultChannelId: "ch-2",
      seq: 7,
    });

    await useSessao.getState().entrarComunidade({ codeOrLink: "comunidadep2p://join/X7K2QM9FRT4BN8ZP" });

    expect(api.inviteRedeem).toHaveBeenCalledBefore(api.coreStatus);
  });

  it("recusa nomeada do resgate sobe como está — nunca vira sucesso silencioso", async () => {
    api.inviteRedeem.mockRejectedValue(
      Object.assign(new Error("E_INVITE_EXHAUSTED"), { code: "E_INVITE_EXHAUSTED" }),
    );

    await expect(
      useSessao.getState().entrarComunidade({ codeOrLink: "X7K2-QM9F-RT4B-N8ZP" }),
    ).rejects.toMatchObject({ code: "E_INVITE_EXHAUSTED" });
  });
});

describe("sessão — o estado depois do entrarComunidade", () => {
  it("o recarregar interno consulta o núcleo de novo (fonte das queries, não estado local)", async () => {
    api.inviteRedeem.mockResolvedValue({
      communityId: "ef".repeat(32),
      defaultChannelId: "ch-3",
      seq: 9,
    });

    await useSessao.getState().entrarComunidade({ codeOrLink: "X7K2-QM9F-RT4B-N8ZP" });

    expect(useSessao.getState().epoch).toBe(STATUS_PRONTO.epoch);
    expect(api.coreStatus).toHaveBeenCalled();
  });
});
