/**
 * §17.4 no renderer. O que dá para provar sem microfone e sem duas máquinas: a regra de
 * quem pode falar com quem (passo 4), a de quem oferta (anti-glare) e o ciclo de roster.
 *
 * O passo 3 — recusar sinalização sem ticket válido — NÃO é testado aqui porque não é daqui:
 * `signalIsAuthorized` roda no núcleo, antes do evento chegar. O que este arquivo cobre é a
 * outra metade: não iniciar DTLS com par para quem o host não emitiu ticket.
 */
import { describe, expect, it, vi } from "vitest";

import { MalhaDeVoz, chaveHex, leituraDeSaida, paresAutorizados, souOIniciador, ticketIdDe } from "../voz";
import type { FabricaDeMidia, PortaDeVoz, TicketNoFio } from "../voz";

const EU = "aa".repeat(32);
const PAR = "bb".repeat(32);
const ESTRANHO = "cc".repeat(32);

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
}

function ticket(a: string, b: string, expiresAt = 9_000): TicketNoFio {
  return { sessionId: "s1", channelId: "ch", peerA: bytes(a), peerB: bytes(b), expiresAt, sig: bytes("00") };
}

/** `RTCPeerConnection` de mentira — o suficiente para a malha acreditar. */
function pcFalso(): RTCPeerConnection {
  const pc = {
    connectionState: "new" as RTCPeerConnectionState,
    signalingState: "stable" as RTCSignalingState,
    addTrack: vi.fn(() => ({
      track: { kind: "video" },
      getParameters: vi.fn(() => ({ encodings: [{}] })),
      setParameters: vi.fn(async () => undefined),
    })),
    removeTrack: vi.fn(),
    getStats: vi.fn(async () => new Map()),
    onsignalingstatechange: null,
    close: vi.fn(),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "v=0" })),
    createAnswer: vi.fn(async () => ({ type: "answer", sdp: "v=0" })),
    setLocalDescription: vi.fn(async () => undefined),
    setRemoteDescription: vi.fn(async () => undefined),
    addIceCandidate: vi.fn(async () => undefined),
    onicecandidate: null,
    ontrack: null,
    onconnectionstatechange: null,
    oniceconnectionstatechange: null,
    onicegatheringstatechange: null,
  };
  return pc as unknown as RTCPeerConnection;
}

function montar(tickets: TicketNoFio[], roster: string[]) {
  const criadas: RTCPeerConnection[] = [];
  const porta: PortaDeVoz = {
    join: vi.fn(async () => ({
      sessionId: "s1",
      roster: roster.map((k) => ({ keyHex: k })),
      iceServers: [{ urls: "stun:1.2.3.4:1" }],
      tickets,
    })),
    leave: vi.fn(async () => undefined),
    signal: vi.fn(async () => undefined),
  };
  const midia: FabricaDeMidia = {
    capturar: vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream),
    conexao: vi.fn(() => {
      const pc = pcFalso();
      criadas.push(pc);
      return pc;
    }),
  };
  const malha = new MalhaDeVoz(porta, midia, {
    aoMudarPar: vi.fn(),
    aoChegarAudio: vi.fn(),
    aoFalhar: vi.fn(),
    aoSair: vi.fn(),
  });
  return { malha, porta, midia, criadas };
}

describe("chaveHex — as duas formas do fio", () => {
  it("bytes da IPC-R e hex de §16.2 chegam ao mesmo lugar", () => {
    expect(chaveHex(bytes("aabb"))).toBe("aabb");
    expect(chaveHex("AABB")).toBe("aabb");
  });
});

describe("paresAutorizados", () => {
  it("o outro lado do par é quem fica autorizado", () => {
    expect([...paresAutorizados([ticket(EU, PAR)], EU, 0).keys()]).toEqual([PAR]);
  });

  it("ticket vencido não autoriza ninguém", () => {
    expect(paresAutorizados([ticket(EU, PAR, 100)], EU, 200).size).toBe(0);
  });

  it("ticket entre dois terceiros não me autoriza a falar com nenhum deles", () => {
    expect(paresAutorizados([ticket(PAR, ESTRANHO)], EU, 0).size).toBe(0);
  });
});

describe("ticketIdDe — §15.4 exige um id em voice.signal", () => {
  it("deriva da assinatura, os 12 primeiros bytes", () => {
    const t = ticket(EU, PAR);
    expect(ticketIdDe({ ...t, sig: bytes("0011223344556677889900112233") })).toBe("001122334455667788990011");
  });

  it("o par autorizado vem COM o id — quem oferta fala primeiro e precisa dele", () => {
    const t = ticket(EU, PAR);
    const mapa = paresAutorizados([t], EU, 0);
    expect(mapa.get(PAR)).toBe(ticketIdDe(t));
    expect(mapa.get(PAR)).not.toBe("");
  });
});

describe("souOIniciador — sem glare", () => {
  it("exatamente um dos dois lados oferta", () => {
    expect(souOIniciador(EU, PAR)).toBe(true);
    expect(souOIniciador(PAR, EU)).toBe(false);
  });
});

describe("MalhaDeVoz", () => {
  it("o host decide ANTES da captura: sem join aceito, o microfone não acende", async () => {
    const { malha, midia, porta } = montar([ticket(EU, PAR)], [EU, PAR]);
    (porta.join as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("E_PERMISSION_DENIED"));
    await expect(
      malha.entrar({ communityId: "c", channelId: "ch", euHex: EU, microfoneId: "default", agora: 0 }),
    ).rejects.toThrow();
    expect(midia.capturar).not.toHaveBeenCalled();
  });

  it("oferta ao par com ticket e NÃO oferta a quem não tem (§17.4 passo 4)", async () => {
    const { malha, porta } = montar([ticket(EU, PAR)], [EU, PAR, ESTRANHO]);
    await malha.entrar({ communityId: "c", channelId: "ch", euHex: EU, microfoneId: "default", agora: 0 });
    await new Promise((r) => setTimeout(r, 0));

    const enviados = (porta.signal as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as { peerKey: string; ticketId: string },
    );
    const paraOPar = enviados.find((s) => s.peerKey === PAR);
    expect(paraOPar).toBeDefined();
    // A regressão de §79: `ticketId` vazio era recusado com `E_VALIDATION` no roteador, e
    // quem OFERTA fala primeiro — não tinha como ter recebido um id antes.
    expect(paraOPar!.ticketId).not.toBe("");
    expect(enviados.some((s) => s.peerKey === ESTRANHO)).toBe(false);
  });

  it("sinal de par sem ticket é ignorado, mesmo chegando pelo evento", async () => {
    const { malha, criadas } = montar([ticket(EU, PAR)], [EU, PAR]);
    await malha.entrar({ communityId: "c", channelId: "ch", euHex: EU, microfoneId: "default", agora: 0 });
    const antes = criadas.length;
    await malha.aplicarSinal({ peerKey: ESTRANHO, ticketId: "t", sdp: '{"type":"offer"}' });
    expect(criadas.length).toBe(antes);
  });

  it("roster que perde um par fecha a conexão dele", async () => {
    const { malha, criadas } = montar([ticket(EU, PAR)], [EU, PAR]);
    await malha.entrar({ communityId: "c", channelId: "ch", euHex: EU, microfoneId: "default", agora: 0 });
    expect(criadas.length).toBe(1);
    malha.aplicarRoster([{ keyHex: EU }]);
    expect(criadas[0]!.close).toHaveBeenCalled();
  });

  it("só candidato host = falha NOMEADA, não 'Conectando…' para sempre (L-11)", async () => {
    vi.useFakeTimers();
    try {
      const aoFalhar = vi.fn();
      const criadas: RTCPeerConnection[] = [];
      const porta: PortaDeVoz = {
        join: vi.fn(async () => ({
          sessionId: "s1",
          roster: [{ keyHex: EU }, { keyHex: PAR }],
          iceServers: [],
          tickets: [ticket(EU, PAR)],
        })),
        leave: vi.fn(async () => undefined),
        signal: vi.fn(async () => undefined),
      };
      const midia: FabricaDeMidia = {
        capturar: vi.fn(async () => ({ getTracks: () => [] }) as unknown as MediaStream),
        conexao: vi.fn(() => {
          const pc = pcFalso();
          criadas.push(pc);
          return pc;
        }),
      };
      const malha = new MalhaDeVoz(porta, midia, {
        aoMudarPar: vi.fn(),
        aoChegarAudio: vi.fn(),
        aoFalhar,
        aoSair: vi.fn(),
      });

      await malha.entrar({ communityId: "c", channelId: "ch", euHex: EU, microfoneId: "default", agora: 0 });
      // Só endereço de rede local — o STUN do host não respondeu.
      criadas[0]!.onicecandidate?.({
        candidate: { type: "host", protocol: "udp", toJSON: () => ({}) },
      } as unknown as RTCPeerConnectionIceEvent);

      await vi.advanceTimersByTimeAsync(21_000);

      expect(aoFalhar).toHaveBeenCalledTimes(1);
      expect(aoFalhar.mock.calls[0]![0]).toMatch(/alcançável/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sair fecha tudo e avisa o núcleo", async () => {
    const { malha, porta, criadas } = montar([ticket(EU, PAR)], [EU, PAR]);
    await malha.entrar({ communityId: "c", channelId: "ch", euHex: EU, microfoneId: "default", agora: 0 });
    await malha.sair();
    expect(criadas[0]!.close).toHaveBeenCalled();
    expect(porta.leave).toHaveBeenCalled();
    expect(malha.sessionId).toBeNull();
  });
});

/** `RTCStatsReport` de mentira: um mapa com as entradas que o WebRTC entregaria. */
function relatorio(entradas: Array<Record<string, unknown>>): RTCStatsReport {
  return new Map(entradas.map((e, i) => [String(i), e])) as unknown as RTCStatsReport;
}

describe("enviarTrilha — a estrela de tela pega carona na conexão da voz (§17.5)", () => {
  async function comChamada() {
    const r = montar([ticket(EU, PAR)], [EU, PAR]);
    await r.malha.entrar({
      communityId: "c",
      channelId: "ch",
      euHex: EU,
      microfoneId: "default",
      agora: 0,
    });
    return r;
  }

  it("par sem conexão não recebe trilha nenhuma", async () => {
    const r = await comChamada();
    const envio = await r.malha.enviarTrilha(ESTRANHO, {} as MediaStreamTrack, {} as MediaStream);
    expect(envio).toBeNull();
  });

  /**
   * A regressão do defeito que a §83 introduziu: a trilha era adicionada à conexão, a
   * negociação anterior ainda não tinha assentado, a oferta era adiada — e **nunca saía**.
   * O espectador entrava no mapa como servido e ficava sem vídeo, em silêncio.
   */
  it("renegociação represada fora de `stable` SAI quando a negociação assenta", async () => {
    const r = await comChamada();
    const pc = r.criadas[0]! as unknown as {
      signalingState: RTCSignalingState;
      onsignalingstatechange: (() => void) | null;
    };
    (r.porta.signal as ReturnType<typeof vi.fn>).mockClear();

    pc.signalingState = "have-local-offer";
    await r.malha.enviarTrilha(PAR, { kind: "video" } as MediaStreamTrack, {} as MediaStream);
    // Represada: nada de oferta enquanto a anterior não assenta.
    expect(r.porta.signal).not.toHaveBeenCalled();

    pc.signalingState = "stable";
    pc.onsignalingstatechange?.();
    await Promise.resolve();
    await Promise.resolve();
    // E agora sai — sem isto o par ficava sem vídeo para sempre.
    expect(r.porta.signal).toHaveBeenCalled();
  });

  it("volta a `stable` sem nada represado não gera oferta à toa", async () => {
    const r = await comChamada();
    const pc = r.criadas[0]! as unknown as { onsignalingstatechange: (() => void) | null };
    (r.porta.signal as ReturnType<typeof vi.fn>).mockClear();
    pc.onsignalingstatechange?.();
    await Promise.resolve();
    expect(r.porta.signal).not.toHaveBeenCalled();
  });

  it("a perda é a do INTERVALO, não a acumulada desde o começo da transmissão", async () => {
    const r = await comChamada();
    const pc = r.criadas[0]! as unknown as { getStats: ReturnType<typeof vi.fn> };
    const envio = (await r.malha.enviarTrilha(PAR, { kind: "video" } as MediaStreamTrack, {} as MediaStream))!;

    // Primeira leitura: rajada de 10 perdidos em 100 enviados.
    pc.getStats.mockResolvedValueOnce(
      relatorio([
        { type: "remote-inbound-rtp", roundTripTime: 0.05, packetsLost: 10 },
        { type: "outbound-rtp", packetsSent: 100 },
      ]),
    );
    expect(await envio.estatisticas()).toEqual({ rttMs: 50, lossPct: 10 });

    // Segunda leitura: mais 100 pacotes e NENHUMA perda nova. O acumulado ainda é 10/200
    // (5%), mas o intervalo é 0/100 — e é o intervalo que a degradação de §17.5 deve ler,
    // senão uma rajada inicial prenderia o espectador no perfil baixo para sempre.
    pc.getStats.mockResolvedValueOnce(
      relatorio([
        { type: "remote-inbound-rtp", roundTripTime: 0.02, packetsLost: 10 },
        { type: "outbound-rtp", packetsSent: 200 },
      ]),
    );
    expect(await envio.estatisticas()).toEqual({ rttMs: 20, lossPct: 0 });
  });
});

describe("leituraDeSaida — os contadores crus do RTCStatsReport", () => {
  it("a perda vem do relatório do RECEPTOR, e os contadores saem acumulados", () => {
    expect(
      leituraDeSaida(
        relatorio([
          { type: "remote-inbound-rtp", roundTripTime: 0.1, packetsLost: 7 },
          { type: "outbound-rtp", packetsSent: 700 },
        ]),
      ),
    ).toEqual({ rttMs: 100, perdidosAcumulados: 7, enviadosAcumulados: 700 });
  });

  it("relatório sem nada medível é `null`, não zero — zero seria uma medida inventada", () => {
    expect(leituraDeSaida(relatorio([{ type: "outbound-rtp", packetsSent: 10 }]))).toBeNull();
  });
});
