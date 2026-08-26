/**
 * §17.5 no renderer. O que dá para provar sem tela real e sem duas máquinas: a **ordem** de
 * `T-41`, o perfil por espectador, a reconciliação da audiência e o ciclo de saúde.
 *
 * O que NÃO é testado aqui porque não é daqui: o teto de 8 (`E_SESSION_FULL`) e a
 * autorização da sessão são decisões do **host** (`ShareHostSessions`), verificadas na suíte
 * do núcleo. Repeti-las aqui criaria uma segunda fonte de verdade para a mesma regra — o
 * mesmo motivo pelo qual `voz.test.ts` não testa o passo 3 de §17.4.
 *
 * A captura, a malha e a porta de §15.4 entram injetadas; nada aqui toca em WebRTC de
 * verdade.
 */
import { describe, expect, it, vi } from "vitest";

import { EstrelaDeTela } from "../tela";
import type { FabricaDeCaptura, PortaDaMalha, PortaDeTela } from "../tela";
import type { EnvioDeTrilha } from "../voz";

const EU = "aa".repeat(32);
const ESPECTADOR = "bb".repeat(32);
const OUTRO = "cc".repeat(32);

/** Uma trilha de vídeo de mentira, com o rótulo que o sistema daria. */
function trilha(label = "Tela inteira"): MediaStreamTrack {
  return { kind: "video", label, stop: vi.fn(), onended: null } as unknown as MediaStreamTrack;
}

function stream(track: MediaStreamTrack): MediaStream {
  return {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

function envioFalso(stats: { rttMs: number; lossPct: number } | null = { rttMs: 20, lossPct: 0 }) {
  return {
    definirBitrateKbps: vi.fn(async () => undefined),
    estatisticas: vi.fn(async () => stats),
    encerrar: vi.fn(async () => undefined),
  } satisfies EnvioDeTrilha & Record<string, unknown>;
}

function montar(opts: { pares?: string[]; stats?: { rttMs: number; lossPct: number } | null } = {}) {
  const ordem: string[] = [];
  const envios = new Map<string, ReturnType<typeof envioFalso>>();
  const track = trilha();
  const midia = stream(track);

  const porta: PortaDeTela = {
    start: vi.fn(async () => {
      ordem.push("share.start");
      return { sessionId: "sess-1" };
    }),
    stop: vi.fn(async () => ({})),
    join: vi.fn(async () => ({ ticketId: "t1", presenterKey: OUTRO })),
    setQuality: vi.fn(async () => ({ applied: true })),
    report: vi.fn(async () => ({})),
  };

  const malha: PortaDaMalha = {
    pares: () => opts.pares ?? [ESPECTADOR],
    enviarTrilha: vi.fn(async (par: string) => {
      const e = envioFalso(opts.stats === undefined ? { rttMs: 20, lossPct: 0 } : opts.stats);
      envios.set(par, e);
      return e as unknown as EnvioDeTrilha;
    }),
  };

  const captura: FabricaDeCaptura = {
    declararSessao: vi.fn(async () => {
      ordem.push("declararSessao");
    }),
    capturar: vi.fn(async () => {
      ordem.push("getDisplayMedia");
      return midia;
    }),
  };

  const eventos = {
    aoFalhar: vi.fn(),
    aoEncerrarNaFonte: vi.fn(),
    aoMedir: vi.fn(),
  };

  const estrela = new EstrelaDeTela(porta, malha, captura, eventos);
  return { estrela, porta, malha, captura, eventos, ordem, envios, track };
}

describe("§17.5 — a ordem de T-41", () => {
  it("o host decide ANTES da captura: share.start, declaração, e só então getDisplayMedia", async () => {
    const { estrela, ordem } = montar();
    await estrela.apresentar({ communityId: "c1", channelId: "ch-voz", euHex: EU });
    // A ordem é a própria regra: capturar antes de saber se a permissão deixa passar
    // acenderia a luz da captura à toa (§76.4), e `T-41` a fixa explicitamente.
    expect(ordem).toEqual(["share.start", "declararSessao", "getDisplayMedia"]);
  });

  it("host recusando NUNCA chega a capturar", async () => {
    const { estrela, porta, captura } = montar();
    (porta.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error("negado"), { code: "E_PERMISSION_DENIED" }),
    );
    await expect(
      estrela.apresentar({ communityId: "c1", channelId: "ch-voz", euHex: EU }),
    ).rejects.toThrow();
    expect(captura.capturar).not.toHaveBeenCalled();
  });

  it("captura que falha desfaz a sessão no host e retira a declaração", async () => {
    const { estrela, porta, captura } = montar();
    (captura.capturar as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error("cancelado"), { name: "NotAllowedError" }),
    );
    await expect(
      estrela.apresentar({ communityId: "c1", channelId: "ch-voz", euHex: EU }),
    ).rejects.toThrow();
    // Sessão órfã no host seria `E_ALREADY_SHARING` na próxima tentativa.
    expect(porta.stop).toHaveBeenCalledWith({ sessionId: "sess-1" });
    expect(captura.declararSessao).toHaveBeenLastCalledWith({ sessionId: null, kind: "screen" });
  });
});

describe("§17.5 — a estrela e o perfil por espectador", () => {
  it("cada espectador ganha o próprio envio, com o bitrate do perfil pedido", async () => {
    const { estrela, malha, envios } = montar({ pares: [ESPECTADOR, OUTRO] });
    await estrela.apresentar({ communityId: "c1", channelId: "ch", euHex: EU, quality: "low" });
    await estrela.atualizarEspectadores([ESPECTADOR, OUTRO]);

    expect(malha.enviarTrilha).toHaveBeenCalledTimes(2);
    // `low` = 600 kbps (§17.5). Cada `RTCRtpSender` tem os próprios encodings, e é isso
    // que faz a qualidade por espectador funcionar em estrela.
    expect(envios.get(ESPECTADOR)!.definirBitrateKbps).toHaveBeenCalledWith(600);
    expect(envios.get(OUTRO)!.definirBitrateKbps).toHaveBeenCalledWith(600);
  });

  it("a identidade local nunca é espectadora de si mesma", async () => {
    const { estrela, malha } = montar();
    await estrela.apresentar({ communityId: "c1", channelId: "ch", euHex: EU });
    await estrela.atualizarEspectadores([EU, ESPECTADOR]);
    expect(malha.enviarTrilha).toHaveBeenCalledTimes(1);
    expect(estrela.espectadores).toEqual([ESPECTADOR]);
  });

  it("quem sai tem o envio encerrado; quem fica não é reaberto", async () => {
    const { estrela, malha, envios } = montar();
    await estrela.apresentar({ communityId: "c1", channelId: "ch", euHex: EU });
    await estrela.atualizarEspectadores([ESPECTADOR, OUTRO]);
    (malha.enviarTrilha as ReturnType<typeof vi.fn>).mockClear();

    await estrela.atualizarEspectadores([ESPECTADOR]);
    expect(envios.get(OUTRO)!.encerrar).toHaveBeenCalled();
    expect(malha.enviarTrilha).not.toHaveBeenCalled(); // ESPECTADOR já estava servido
    expect(estrela.espectadores).toEqual([ESPECTADOR]);
  });

  it("share.health do host vira maxBitrate no sender daquele espectador", async () => {
    const { estrela, envios } = montar();
    await estrela.apresentar({ communityId: "c1", channelId: "ch", euHex: EU, quality: "high" });
    await estrela.atualizarEspectadores([ESPECTADOR]);
    (envios.get(ESPECTADOR)!.definirBitrateKbps as ReturnType<typeof vi.fn>).mockClear();

    // O veredito é do host: foi ELE que registrou o `share.setQuality` do espectador.
    await estrela.aplicarSaude([
      { key: ESPECTADOR, rttMs: 30, lossPct: 0.2, quality: "low" },
    ]);
    expect(envios.get(ESPECTADOR)!.definirBitrateKbps).toHaveBeenCalledWith(600);
  });

  it("saúde que não muda o perfil não mexe no sender", async () => {
    const { estrela, envios } = montar();
    await estrela.apresentar({ communityId: "c1", channelId: "ch", euHex: EU, quality: "balanced" });
    await estrela.atualizarEspectadores([ESPECTADOR]);
    (envios.get(ESPECTADOR)!.definirBitrateKbps as ReturnType<typeof vi.fn>).mockClear();

    await estrela.aplicarSaude([
      { key: ESPECTADOR, rttMs: 30, lossPct: 0.2, quality: "balanced" },
    ]);
    expect(envios.get(ESPECTADOR)!.definirBitrateKbps).not.toHaveBeenCalled();
  });
});

describe("§17.5/§17.6 — o laço de saúde", () => {
  it("mede cada envio e relata ao núcleo por share.report", async () => {
    const { estrela, porta, eventos } = montar({ stats: { rttMs: 42, lossPct: 5 } });
    await estrela.apresentar({ communityId: "c1", channelId: "ch", euHex: EU });
    await estrela.atualizarEspectadores([ESPECTADOR]);

    await estrela.medirERelatar();
    expect(porta.report).toHaveBeenCalledWith({
      sessionId: "sess-1",
      samples: [{ viewerKey: ESPECTADOR, rttMs: 42, lossPct: 5 }],
    });
    // A UI do apresentador mostra o que ESTA máquina mediu, sem esperar o round-trip.
    expect(eventos.aoMedir).toHaveBeenCalledWith([
      { key: ESPECTADOR, rttMs: 42, lossPct: 5, quality: "balanced" },
    ]);
  });

  it("sem espectador não há o que relatar", async () => {
    const { estrela, porta } = montar();
    await estrela.apresentar({ communityId: "c1", channelId: "ch", euHex: EU });
    await estrela.medirERelatar();
    expect(porta.report).not.toHaveBeenCalled();
  });

  it("estatística indisponível não vira amostra inventada", async () => {
    const { estrela, porta } = montar({ stats: null });
    await estrela.apresentar({ communityId: "c1", channelId: "ch", euHex: EU });
    await estrela.atualizarEspectadores([ESPECTADOR]);
    await estrela.medirERelatar();
    expect(porta.report).not.toHaveBeenCalled();
  });

  it("share.report que falha não derruba a transmissão (§16.3 regra 1)", async () => {
    const { estrela, porta } = montar();
    await estrela.apresentar({ communityId: "c1", channelId: "ch", euHex: EU });
    await estrela.atualizarEspectadores([ESPECTADOR]);
    (porta.report as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("caiu"));
    await expect(estrela.medirERelatar()).resolves.toBeUndefined();
    expect(estrela.espectadores).toEqual([ESPECTADOR]);
  });
});

describe("§17.5 — encerramento", () => {
  it("parar encerra envios, para a captura e fecha a sessão no host", async () => {
    const { estrela, porta, captura, envios, track } = montar();
    await estrela.apresentar({ communityId: "c1", channelId: "ch", euHex: EU });
    await estrela.atualizarEspectadores([ESPECTADOR]);

    await estrela.parar();
    expect(envios.get(ESPECTADOR)!.encerrar).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(porta.stop).toHaveBeenCalledWith({ sessionId: "sess-1" });
    expect(captura.declararSessao).toHaveBeenLastCalledWith({ sessionId: null, kind: "screen" });
    expect(estrela.sessionId).toBeNull();
  });

  it("parar a captura na UI do sistema avisa quem escuta", async () => {
    const { estrela, eventos, track } = montar();
    await estrela.apresentar({ communityId: "c1", channelId: "ch", euHex: EU });
    // O botão "Parar de compartilhar" do SO não passa por lugar nenhum do produto: sem
    // isto a sessão ficaria viva no host com uma trilha morta.
    track.onended?.(new Event("ended"));
    expect(eventos.aoEncerrarNaFonte).toHaveBeenCalled();
  });
});
