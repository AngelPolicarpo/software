/**
 * §17.4 no renderer. O que dá para provar sem microfone e sem duas máquinas: a regra de
 * quem pode falar com quem (passo 4), a de quem oferta (anti-glare) e o ciclo de roster.
 *
 * O passo 3 — recusar sinalização sem ticket válido — NÃO é testado aqui porque não é daqui:
 * `signalIsAuthorized` roda no núcleo, antes do evento chegar. O que este arquivo cobre é a
 * outra metade: não iniciar DTLS com par para quem o host não emitiu ticket.
 */
import { describe, expect, it, vi } from "vitest";

import { MalhaDeVoz, chaveHex, paresAutorizados, souOIniciador, ticketIdDe } from "../voz";
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
    addTrack: vi.fn(),
    close: vi.fn(),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "v=0" })),
    createAnswer: vi.fn(async () => ({ type: "answer", sdp: "v=0" })),
    setLocalDescription: vi.fn(async () => undefined),
    setRemoteDescription: vi.fn(async () => undefined),
    addIceCandidate: vi.fn(async () => undefined),
    onicecandidate: null,
    ontrack: null,
    onconnectionstatechange: null,
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

  it("sair fecha tudo e avisa o núcleo", async () => {
    const { malha, porta, criadas } = montar([ticket(EU, PAR)], [EU, PAR]);
    await malha.entrar({ communityId: "c", channelId: "ch", euHex: EU, microfoneId: "default", agora: 0 });
    await malha.sair();
    expect(criadas[0]!.close).toHaveBeenCalled();
    expect(porta.leave).toHaveBeenCalled();
    expect(malha.sessionId).toBeNull();
  });
});
