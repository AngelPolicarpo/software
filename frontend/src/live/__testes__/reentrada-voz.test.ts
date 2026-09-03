/**
 * B43 — reentrada automática de voz pós-respawn do núcleo.
 *
 * O que se afirma: com chamada ativa (channel/community/local presentes), o motivo
 * `epoch` reexecuta o `voice.join` (via `retryJoin`); sem chamada, ou com motivo
 * `stale`/`recarregar`, nada acontece — refazer a chamada fora do reinício derrubaria
 * quem está nela sem motivo.
 *
 * Verificado por mutação: trocar o `motivo.tipo !== "epoch"` por checagem ausente faz
 * o caso do `stale` reentrar (derruba a chamada à toa); apagar a guarda de
 * `channelId === null` faz o caso sem chamada tentar entrar.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { reentrarVozSePreciso } from "../sincronizacao";
import { useVoiceStore } from "../../store/voiceStore";

const CANAL = {
  id: "ch-voz",
  communityId: "c1",
  name: "sala",
  type: "voice" as const,
  categoryId: "cat-1",
};

function semChamada(): void {
  useVoiceStore.getState().configurarVoz(null);
  useVoiceStore.setState({
    channelId: null,
    communityId: null,
    localId: null,
    stage: "connecting",
    motivoDaFalha: null,
    participants: [],
  });
}

function comChamada(): { entrar: ReturnType<typeof vi.fn> } {
  const entrar = vi.fn(async () => undefined);
  useVoiceStore.getState().configurarVoz({
    entrar,
    sair: vi.fn(async () => undefined),
    mudarSelf: vi.fn(),
    definirMudo: vi.fn(),
    definirSurdo: vi.fn(),
    definirVolume: vi.fn(),
    definirMusica: vi.fn(async () => ({ erro: null })),
    definirVolumeMusica: vi.fn(),
    fluxosParaGravacao: vi.fn(() => []),
  } as never);
  useVoiceStore.setState({
    channelId: CANAL.id,
    communityId: CANAL.communityId,
    localId: "eu",
    stage: "connected",
    motivoDaFalha: null,
    participants: [],
  });
  return { entrar };
}

describe("B43 — a chamada volta sozinha depois do reinício do núcleo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    semChamada();
  });

  it("com chamada ativa, o epoch reexecuta o join", () => {
    const { entrar } = comChamada();

    reentrarVozSePreciso({ tipo: "epoch", epoch: 2 });

    expect(entrar).toHaveBeenCalledTimes(1);
    expect(useVoiceStore.getState().stage).toBe("connecting");
  });

  it("sem chamada, o epoch não tenta entrar", () => {
    semChamada();
    const entrar = vi.fn(async () => undefined);
    useVoiceStore.getState().configurarVoz({
      entrar,
      sair: vi.fn(async () => undefined),
      mudarSelf: vi.fn(),
      definirMudo: vi.fn(),
      definirSurdo: vi.fn(),
      definirVolume: vi.fn(),
      definirMusica: vi.fn(async () => ({ erro: null })),
      definirVolumeMusica: vi.fn(),
      fluxosParaGravacao: vi.fn(() => []),
    } as never);

    reentrarVozSePreciso({ tipo: "epoch", epoch: 2 });

    expect(entrar).not.toHaveBeenCalled();
  });

  it("com chamada ativa, o stale NÃO reentra — é só janela de eventos", () => {
    const { entrar } = comChamada();

    reentrarVozSePreciso({ tipo: "stale", topic: "voice.roster", dropped: 3 });

    expect(entrar).not.toHaveBeenCalled();
  });

  it("com chamada ativa, o recarregar NÃO reentra — é boot ou comunidade nova", () => {
    const { entrar } = comChamada();

    reentrarVozSePreciso({ tipo: "recarregar" });

    expect(entrar).not.toHaveBeenCalled();
  });
});
