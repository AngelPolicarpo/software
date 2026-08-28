// §17.5 (emenda de 2026-08-28) — o Modo Música no renderer, sem áudio de verdade:
// a malha recebe uma FÁBRICA de mixador de mentira (4º parâmetro do construtor), e o rig
// conta `replaceTrack`. O que se prova: a trilha que sai é a MISTURADA; o mudo próprio cala
// só a perna do mic; o mudo impositivo corta tudo; e desligar devolve o microfone original.
// O grafo REAL (`criarMixador`) tem teste próprio com `AudioContext` falso.

import { describe, expect, it, vi } from "vitest";

import { criarMixador, type Mixador } from "../mixagem";
import { MalhaDeVoz } from "../voz";
import type { FabricaDeMidia, PortaDeVoz, TicketNoFio } from "../voz";

const EU = "aa".repeat(32);
const PAR = "bb".repeat(32);

function bytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
}

function trilhaFalsa(nome: string, kind = "audio"): MediaStreamTrack {
  return { kind, enabled: true, label: nome, stop: vi.fn() } as unknown as MediaStreamTrack;
}

/** `AudioContext` de mentira: nós com `connect` encadeável e destino com trilha própria. */
function contextoFalso() {
  const node = () => {
    const n = {
      gain: { value: 1 },
      fftSize: 512,
      connect(destino: unknown) {
        return destino;
      },
      disconnect: vi.fn(),
      getByteTimeDomainData: vi.fn(),
      stream: { getAudioTracks: () => [trilhaFalsa("mistura")] },
    };
    return n;
  };
  return {
    createMediaStreamDestination: vi.fn(node),
    createGain: vi.fn(node),
    createMediaStreamSource: vi.fn(node),
    createAnalyser: vi.fn(node),
    close: vi.fn(async () => undefined),
  } as unknown as AudioContext;
}

function mixadorFalso(trilha: MediaStreamTrack): Mixador {
  return {
    trilha,
    definirSistema: vi.fn(),
    removerSistema: vi.fn(),
    definirGanhoSistema: vi.fn(),
    nivel: () => 0,
    encerrar: vi.fn(),
  };
}

function pcFalsoComSenders() {
  const audioSender = { track: trilhaFalsa("mic-original"), replaceTrack: vi.fn(async (_nova: MediaStreamTrack) => undefined) };
  const videoSender = { track: trilhaFalsa("video", "video"), replaceTrack: vi.fn(async (_nova: MediaStreamTrack) => undefined) };
  const pc = {
    connectionState: "connected",
    signalingState: "stable",
    remoteDescription: null,
    addTrack: vi.fn(() => audioSender),
    removeTrack: vi.fn(),
    getSenders: vi.fn(() => [videoSender, audioSender]),
    getStats: vi.fn(async () => new Map()),
    close: vi.fn(),
    createOffer: vi.fn(async () => ({ type: "offer" as const, sdp: "v=0" })),
    createAnswer: vi.fn(async () => ({ type: "answer" as const, sdp: "v=0" })),
    setLocalDescription: vi.fn(async () => undefined),
    setRemoteDescription: vi.fn(async () => undefined),
    addIceCandidate: vi.fn(async () => undefined),
    onicecandidate: null,
    ontrack: null,
    onsignalingstatechange: null,
    onconnectionstatechange: null,
    oniceconnectionstatechange: null,
    onicegatheringstatechange: null,
  } as unknown as RTCPeerConnection;
  return { pc, audioSender };
}

function montar(trilhaMic: MediaStreamTrack, fabricaDeMixador: (mic: MediaStream) => Mixador | null) {
  const { pc, audioSender } = pcFalsoComSenders();
  const tickets: TicketNoFio[] = [
    { sessionId: "s1", channelId: "ch", peerA: bytes(EU), peerB: bytes(PAR), expiresAt: 9_000, sig: bytes("00") },
  ];
  const porta: PortaDeVoz = {
    join: vi.fn(async () => ({
      sessionId: "s1",
      roster: [{ keyHex: EU }, { keyHex: PAR }],
      iceServers: [{ urls: "stun:1.2.3.4:1" }],
      tickets,
    })),
    leave: vi.fn(async () => undefined),
    signal: vi.fn(async () => undefined),
  };
  const trilhasDeAudio = [trilhaMic];
  const midia: FabricaDeMidia = {
    capturar: vi.fn(async () => ({ getTracks: () => trilhasDeAudio, getAudioTracks: () => trilhasDeAudio }) as unknown as MediaStream),
    conexao: vi.fn(() => pc),
  };
  const eventos = {
    aoMudarPar: vi.fn(),
    aoChegarAudio: vi.fn(),
    aoChegarVideo: vi.fn(),
    aoFalhar: vi.fn(),
    aoSair: vi.fn(),
  };
  return { malha: new MalhaDeVoz(porta, midia, eventos, fabricaDeMixador), audioSender };
}

describe("criarMixador — o grafo mic + sistema numa trilha única", () => {
  it("liga as pernas ao destino, expõe a trilha dele e encerra limpo", () => {
    const ctx = contextoFalso();
    const mic = trilhaFalsa("mic");
    const mixador = criarMixador({ getAudioTracks: () => [mic] } as unknown as MediaStream, () => ctx);
    expect(mixador).not.toBeNull();
    expect(mixador!.trilha?.label).toBe("mistura");
    mixador!.definirSistema({ getAudioTracks: () => [trilhaFalsa("loopback")] } as unknown as MediaStream);
    mixador!.definirGanhoSistema(0.5);
    mixador!.encerrar();
    expect(ctx.close).toHaveBeenCalled();
  });

  it("sem AudioContext no ambiente devolve null — música indisponível, nunca crash", () => {
    const Ctor = globalThis.AudioContext;
    // @ts-expect-error — simulando ambiente sem WebAudio
    delete globalThis.AudioContext;
    try {
      expect(criarMixador({ getAudioTracks: () => [] } as unknown as MediaStream)).toBeNull();
    } finally {
      globalThis.AudioContext = Ctor;
    }
  });
});

describe("Modo Música na malha — mixagem, replaceTrack e o mudo em dois níveis", () => {
  async function rigComMusica() {
    const trilhaMic = trilhaFalsa("mic-original");
    const trilhaMistura = trilhaFalsa("mistura");
    const mixador = mixadorFalso(trilhaMistura);
    const { malha, audioSender } = montar(trilhaMic, () => mixador);
    await malha.entrar({ communityId: "c1", channelId: "ch", euHex: EU, microfoneId: "default", agora: 1_000 });
    await malha.ativarMusica({ getAudioTracks: () => [trilhaFalsa("loopback")] } as unknown as MediaStream);
    return { malha, audioSender, trilhaMic, trilhaMistura, mixador };
  }

  it("ativar substitui a trilha de áudio dos pares pela misturada; desativar devolve o mic", async () => {
    const trilhaMic = trilhaFalsa("mic-original");
    const trilhaMistura = trilhaFalsa("mistura");
    const { malha, audioSender } = montar(trilhaMic, () => mixadorFalso(trilhaMistura));
    await malha.entrar({ communityId: "c1", channelId: "ch", euHex: EU, microfoneId: "default", agora: 1_000 });
    await malha.ativarMusica({ getAudioTracks: () => [trilhaFalsa("loopback")] } as unknown as MediaStream);
    const substituida = audioSender.replaceTrack.mock.calls.at(-1)?.[0] as MediaStreamTrack | undefined;
    expect(substituida).not.toBeUndefined();
    expect(substituida?.label).toBe("mistura");
    await malha.desativarMusica();
    expect(audioSender.replaceTrack.mock.calls.at(-1)?.[0]).toBe(trilhaMic);
  });

  it("sem sistema na trilha, ativar não troca nada — não há música para tocar", async () => {
    const trilhaMic = trilhaFalsa("mic-original");
    const { malha, audioSender } = montar(trilhaMic, () => mixadorFalso(trilhaFalsa("mistura")));
    await malha.entrar({ communityId: "c1", channelId: "ch", euHex: EU, microfoneId: "default", agora: 1_000 });
    await malha.ativarMusica({ getAudioTracks: () => [] } as unknown as MediaStream);
    expect(audioSender.replaceTrack).not.toHaveBeenCalled();
  });

  it("mudo próprio com música cala só o mic; impositivo corta a saída inteira", async () => {
    const { malha, trilhaMic, trilhaMistura } = await rigComMusica();

    // Mudo PRÓPRIO: a trilha do MIC desliga, a misturada segue no ar.
    malha.definirMudo(true);
    expect(trilhaMic.enabled).toBe(false);
    expect(trilhaMistura.enabled).toBe(true);

    // Mudo IMPOSTO (host/fila): a trilha que SAI desliga — música incluída.
    malha.definirMudoImpositivo(true);
    expect(trilhaMistura.enabled).toBe(false);

    // A imposição caiu (turno chegou): a saída volta — e o mic continua no mudo DELE.
    malha.definirMudoImpositivo(false);
    expect(trilhaMistura.enabled).toBe(true);
    expect(trilhaMic.enabled).toBe(false);

    malha.definirMudo(false);
    expect(trilhaMic.enabled).toBe(true);
  });

  it("sem música, mudo próprio e impositivo convergem na mesma trilha (comportamento de hoje)", async () => {
    const trilhaMic = trilhaFalsa("mic-original");
    const { malha } = montar(trilhaMic, () => mixadorFalso(trilhaFalsa("mistura")));
    await malha.entrar({ communityId: "c1", channelId: "ch", euHex: EU, microfoneId: "default", agora: 1_000 });

    malha.definirMudo(true);
    expect(trilhaMic.enabled).toBe(false);
    malha.definirMudoImpositivo(true);
    expect(trilhaMic.enabled).toBe(false);
    malha.definirMudoImpositivo(false);
    // O mudo próprio ainda vale — a imposição cair não desmuta quem se calou.
    expect(trilhaMic.enabled).toBe(false);
    malha.definirMudo(false);
    expect(trilhaMic.enabled).toBe(true);
  });

  it("o volume da música vai para o nó de ganho do grafo", async () => {
    const { malha, mixador } = await rigComMusica();
    malha.definirVolumeMusica(0.3);
    expect(mixador.definirGanhoSistema).toHaveBeenCalledWith(0.3);
  });
});
