/**
 * §31.15 — a chamada de uma conversa direta. B62 / §109.
 *
 * O que se afirma aqui é a **tabela de remoções** do lado do renderer, e cada caso nomeia a
 * peça de §17 que some. O WebRTC em si não entra: a `MalhaDeVoz` é a de §17.2 sem alteração,
 * e a evidência de duas pontas com mídia real é o smoke de §98.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  dmCallJoin: vi.fn<(id: string) => Promise<unknown>>(),
  dmCallLeave: vi.fn<(id: string) => Promise<unknown>>(),
  dmSignal: vi.fn<(a: unknown) => Promise<unknown>>(),
}));
const cliente = vi.hoisted(() => ({ subscribe: vi.fn() }));
const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
const malha = vi.hoisted(() => ({
  entrar: vi.fn<(a: unknown) => Promise<unknown>>(),
  sair: vi.fn<() => Promise<unknown>>(),
  aplicarSinal: vi.fn<(a: unknown) => Promise<unknown>>(),
  aplicarIceServers: vi.fn<(a: unknown) => void>(),
  definirMudo: vi.fn<(m: boolean) => void>(),
  definirVideoLocal: vi.fn<(t: unknown, s: unknown) => Promise<void>>(),
  removerVideoLocal: vi.fn<() => Promise<void>>(),
}));
/** A captura de vídeo, injetada: `CameraDaChamada` é a de produto, o dispositivo não é. */
const captura = vi.hoisted(() => ({ getUserMedia: vi.fn<(c: unknown) => Promise<unknown>>() }));
/** O que o construtor da malha recebeu — é por onde a porta de §31.15 é inspecionada. */
const construida = vi.hoisted(() => ({ porta: null as unknown, eventos: null as unknown }));

vi.mock("../../ipc/api", () => ({ api, cliente }));
vi.mock("../../store/toastStore", () => ({ useToastStore: { getState: () => toast } }));
vi.mock("../voz", () => ({
  MalhaDeVoz: class {
    constructor(porta: unknown, _midia: unknown, eventos: unknown) {
      construida.porta = porta;
      construida.eventos = eventos;
    }
    entrar = malha.entrar;
    sair = malha.sair;
    aplicarSinal = malha.aplicarSinal;
    aplicarIceServers = malha.aplicarIceServers;
    definirMudo = malha.definirMudo;
    definirVideoLocal = malha.definirVideoLocal;
    removerVideoLocal = malha.removerVideoLocal;
  },
}));

import {
  assinarDmVoz,
  chamar,
  definirMudo,
  desligar,
  desligarCamera,
  ligarCamera,
} from "../dmVoz";
import { cameraLocal, cameraRecebida } from "../cameraStreams";
import { useDmCallStore } from "../../store/dmCallStore";

type Porta = {
  join(a: { communityId: string; channelId: string }): Promise<{
    sessionId: string;
    roster: Array<{ keyHex: string }>;
    tickets: unknown[];
    autorizacaoPorTransporte?: boolean;
  }>;
  signal(a: { peerKey: string; ticketId: string; sdp?: string; ice?: string }): Promise<unknown>;
};

const CONVERSA = "c".repeat(64);
const PAR = "b".repeat(64);

/** Uma trilha de vídeo falsa, com os três manipuladores que a DM usa como evidência. */
function trilhaFalsa(): MediaStreamTrack {
  return {
    kind: "video",
    label: "Câmera de teste",
    stop: vi.fn(),
    onended: null,
    onmute: null,
    onunmute: null,
  } as unknown as MediaStreamTrack;
}

function streamFalso(id: string, track: MediaStreamTrack): MediaStream {
  return {
    id,
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

/** Os eventos que `dmVoz` deu à malha — é por onde a trilha recebida é injetada. */
type Eventos = {
  aoChegarVideo: (peerHex: string, stream: MediaStream, track: MediaStreamTrack) => void;
};

/** Os assinantes registrados por `assinarDmVoz`, por tópico. */
function ouvinte(topic: string): (d: unknown) => void {
  const chamada = cliente.subscribe.mock.calls.find((c) => c[0] === topic);
  expect(chamada, `nenhum assinante de ${topic}`).toBeDefined();
  return (chamada as [string, (d: unknown) => void])[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  useDmCallStore.getState().encerrou();
  api.dmCallJoin.mockResolvedValue({
    sessionId: CONVERSA,
    peerKey: PAR,
    iceServers: [],
    peerOnCall: false,
  });
  api.dmCallLeave.mockResolvedValue({});
  api.dmSignal.mockResolvedValue({});
  malha.entrar.mockResolvedValue({ sessionId: CONVERSA });
  malha.sair.mockResolvedValue(undefined);
  malha.aplicarSinal.mockResolvedValue(undefined);
  malha.definirVideoLocal.mockResolvedValue(undefined);
  malha.removerVideoLocal.mockResolvedValue(undefined);
  captura.getUserMedia.mockImplementation(async () =>
    streamFalso("local", trilhaFalsa()),
  );
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: captura.getUserMedia } });
});

describe("§31.15 — o que a porta de voz da DM NÃO leva", () => {
  it("a porta entrega roster de um e ticket nenhum, com a autorização vindo do transporte", async () => {
    const porta = construida.porta as Porta;
    const r = await porta.join({ communityId: CONVERSA, channelId: CONVERSA });
    // Ticket de mídia (§17.4): **NÃO REUTILIZADO**. A `remotePublicKey` do Noise é a
    // autorização, e sem a marca a malha recusaria todo sinal (passo 4 de §17.4).
    expect(r.tickets).toEqual([]);
    expect(r.autorizacaoPorTransporte).toBe(true);
    // Roster: **não existe**. Numa dupla ele é a própria conversa — uma entrada, sempre.
    expect(r.roster).toEqual([{ keyHex: PAR }]);
  });

  it("`dm.signal` sai sem `ticketId`: o campo não existe em §31.16.1", async () => {
    await chamar(CONVERSA);
    const porta = construida.porta as Porta;
    await porta.signal({ peerKey: PAR, ticketId: "irrelevante", sdp: "v=0" });
    expect(api.dmSignal).toHaveBeenCalledWith({ conversationId: CONVERSA, sdp: "v=0" });
    expect(api.dmSignal.mock.calls[0]?.[0]).not.toHaveProperty("ticketId");
    expect(api.dmSignal.mock.calls[0]?.[0]).not.toHaveProperty("peerKey");
  });
});

describe("§31.15 — a malha só sobe quando o outro atende (§99.13)", () => {
  it("chamar com o par fora deixa a conversa em `chamando`, sem microfone aberto", async () => {
    await chamar(CONVERSA);
    expect(useDmCallStore.getState().estado).toBe("chamando");
    // Subir aqui entregaria o STUN de terceiro ao agente na primeira coleta: numa DM quem
    // faz o papel do host é o par, e antes de ele atender o serviço dele não existe.
    expect(malha.entrar).not.toHaveBeenCalled();
  });

  it("o par atendendo sobe a malha", async () => {
    assinarDmVoz();
    await chamar(CONVERSA);
    ouvinte("dm.callState")({ conversationId: CONVERSA, peerKey: PAR, on: true, iceServers: [] });
    await vi.waitFor(() => expect(malha.entrar).toHaveBeenCalledTimes(1));
  });

  it("chamar quando o par JÁ está na chamada sobe a malha na hora", async () => {
    api.dmCallJoin.mockResolvedValue({ sessionId: CONVERSA, peerKey: PAR, iceServers: [], peerOnCall: true });
    await chamar(CONVERSA);
    expect(malha.entrar).toHaveBeenCalledTimes(1);
  });
});

describe("§31.15 — `dm.callState` é a notificação que substitui o roster", () => {
  beforeEach(() => assinarDmVoz());

  it("o par ligando sem que eu tenha pedido nada põe a conversa em `recebendo`", () => {
    ouvinte("dm.callState")({ conversationId: CONVERSA, peerKey: PAR, on: true, iceServers: [] });
    const s = useDmCallStore.getState();
    expect(s.estado).toBe("recebendo");
    expect(s.conversationId).toBe(CONVERSA);
    expect(s.peerKey).toBe(PAR);
  });

  it("o par saindo encerra sem afirmar a causa — sair, cair e bloquear são indistinguíveis (L-28)", async () => {
    await chamar(CONVERSA);
    ouvinte("dm.callState")({ conversationId: CONVERSA, peerKey: PAR, on: false });
    await vi.waitFor(() => expect(useDmCallStore.getState().estado).toBe("fora"));
    expect(toast.showToast).not.toHaveBeenCalled();
  });

  it("a lista de ICE renovada numa chamada de pé não renegocia: `setConfiguration`, como §17.3", async () => {
    api.dmCallJoin.mockResolvedValue({ sessionId: CONVERSA, peerKey: PAR, iceServers: [], peerOnCall: true });
    await chamar(CONVERSA);
    useDmCallStore.getState().conectou();
    const servers = [{ urls: "stun:9.9.9.9:1" }];
    ouvinte("dm.callState")({ conversationId: CONVERSA, peerKey: PAR, on: true, iceServers: servers });
    expect(malha.aplicarIceServers).toHaveBeenCalledWith(servers);
  });
});

describe("§31.15 — sinal de outra conversa não entra na negociação corrente", () => {
  it("um `dm.signal` de conversa diferente é descartado", async () => {
    assinarDmVoz();
    await chamar(CONVERSA);
    ouvinte("dm.signal")({ conversationId: "a".repeat(64), peerKey: PAR, sdp: "v=0" });
    expect(malha.aplicarSinal).not.toHaveBeenCalled();
    ouvinte("dm.signal")({ conversationId: CONVERSA, peerKey: PAR, sdp: "v=0" });
    expect(malha.aplicarSinal).toHaveBeenCalledWith({ peerKey: PAR, ticketId: "", sdp: "v=0" });
  });
});

describe('§15.4 — "voz é uma só" vale numa DM', () => {
  it("chamar uma segunda conversa com uma chamada de pé é recusado, e nada é aberto", async () => {
    await chamar(CONVERSA);
    api.dmCallJoin.mockClear();
    await chamar("d".repeat(64));
    expect(api.dmCallJoin).not.toHaveBeenCalled();
    expect(toast.showToast).toHaveBeenCalledWith("Você já está numa chamada", "error");
    expect(useDmCallStore.getState().conversationId).toBe(CONVERSA);
  });
});

describe("§9 (2.3.1) / L-12 — o mudo é efetivo e não sai da máquina", () => {
  it("mudar o mudo corta a trilha e NÃO manda nada ao par: não há host a quem contar", async () => {
    await chamar(CONVERSA);
    definirMudo(true);
    expect(malha.definirMudo).toHaveBeenCalledWith(true);
    expect(useDmCallStore.getState().mudo).toBe(true);
    // §31.15 remove o roster; não existe `voiceState` numa DM, e um `dm.signal` com estado
    // de microfone seria mecanismo sem destinatário.
    expect(api.dmSignal).not.toHaveBeenCalled();
  });

  it("desligar devolve o microfone ao estado ligado: a próxima chamada não nasce muda por herança", async () => {
    await chamar(CONVERSA);
    definirMudo(true);
    await desligar();
    expect(useDmCallStore.getState().mudo).toBe(false);
    expect(malha.definirMudo).toHaveBeenLastCalledWith(false);
  });
});

describe("§31.15 — desligar", () => {
  it("sai da malha e avisa o núcleo; o estado volta a `fora`", async () => {
    await chamar(CONVERSA);
    await desligar();
    expect(malha.sair).toHaveBeenCalledTimes(1);
    expect(api.dmCallLeave).toHaveBeenCalledWith(CONVERSA);
    expect(useDmCallStore.getState().estado).toBe("fora");
  });
});


/* ─── §17.2 — a câmera na mesma malha, e a tela que não existe (B68) ───────── */

describe("§17.2 numa DM — a câmera é a MESMA malha da voz", () => {
  async function chamadaDePe(): Promise<void> {
    api.dmCallJoin.mockResolvedValue({
      sessionId: CONVERSA,
      peerKey: PAR,
      iceServers: [],
      peerOnCall: true,
    });
    await chamar(CONVERSA);
    useDmCallStore.getState().conectou();
  }

  it("ligar a câmera anexa a trilha à malha que já existe — nenhuma conexão nova", async () => {
    await chamadaDePe();
    await ligarCamera();
    // §17.2: voz e câmera na mesma `RTCPeerConnection`. Uma sessão nova seria a estrela de
    // §17.5, que numa DM não tem host que a autorize.
    expect(malha.definirVideoLocal).toHaveBeenCalledTimes(1);
    expect(useDmCallStore.getState().cameraLigada).toBe(true);
    expect(cameraLocal()).not.toBeNull();
  });

  it("ligar a câmera NÃO manda nada pelo fio: não há `voice.setSelf` numa DM", async () => {
    await chamadaDePe();
    api.dmSignal.mockClear();
    await ligarCamera();
    // §15.4 `voice.setSelf{cameraOn}` é aviso ao HOST, e §31.15 remove o host. A tabela
    // fechada de §31.8 não tem linha de câmera; inventá-la seria mecanismo sem destinatário.
    expect(api.dmSignal).not.toHaveBeenCalled();
  });

  it("a câmera não liga fora da chamada: antes do atendimento não há malha (§99.13)", async () => {
    await chamar(CONVERSA);
    expect(useDmCallStore.getState().estado).toBe("chamando");
    await ligarCamera();
    expect(malha.definirVideoLocal).not.toHaveBeenCalled();
    expect(useDmCallStore.getState().cameraLigada).toBe(false);
  });

  it("a câmera recusada pelo sistema vira motivo em português, e NÃO vira falha de chamada", async () => {
    await chamadaDePe();
    captura.getUserMedia.mockRejectedValue(
      Object.assign(new Error("negado"), { name: "NotAllowedError" }),
    );
    await ligarCamera();
    const s = useDmCallStore.getState();
    expect(s.erroDeCamera).toBe("O sistema não autorizou o acesso à câmera.");
    expect(s.cameraLigada).toBe(false);
    // O slot de `falha` é o de §99, e `faixaDeChamada` cola L-29 nele. Uma câmera negada
    // pelo SO ali mandaria a pessoa procurar defeito na rede.
    expect(s.falha).toBeNull();
  });

  it("desligar a chamada apaga a câmera: o dispositivo é desta máquina e ninguém o apaga por ela", async () => {
    await chamadaDePe();
    await ligarCamera();
    await desligar();
    expect(malha.removerVideoLocal).toHaveBeenCalled();
    expect(cameraLocal()).toBeNull();
    expect(useDmCallStore.getState().cameraLigada).toBe(false);
  });

  it("desligar só a câmera mantém a chamada de pé", async () => {
    await chamadaDePe();
    await ligarCamera();
    await desligarCamera();
    expect(useDmCallStore.getState().cameraLigada).toBe(false);
    expect(useDmCallStore.getState().estado).toBe("na-chamada");
    expect(api.dmCallLeave).not.toHaveBeenCalled();
  });
});

describe("§17.2 / B41 — a trilha do par é a câmera dele, por construção", () => {
  it("uma trilha de vídeo vira câmera sem consultar `share.join`: numa DM ele não existe", () => {
    const eventos = construida.eventos as Eventos;
    const track = trilhaFalsa();
    eventos.aoChegarVideo(PAR, streamFalso("remoto", track), track);
    expect(useDmCallStore.getState().parComCamera).toBe(true);
    expect(cameraRecebida(PAR)?.id).toBe("remoto");
  });

  it("a trilha parando é o ÚNICO sinal de que o par desligou a câmera", () => {
    const eventos = construida.eventos as Eventos;
    const track = trilhaFalsa();
    eventos.aoChegarVideo(PAR, streamFalso("remoto", track), track);
    // §31.15 remove o roster, e nenhuma notificação de §31.8 declara câmera: não há
    // `voice.setSelf{cameraOn:false}` ecoado por host nenhum. O que sobra é a observação
    // local da trilha.
    (track.onmute as () => void)();
    expect(useDmCallStore.getState().parComCamera).toBe(false);
    (track.onunmute as () => void)();
    expect(useDmCallStore.getState().parComCamera).toBe(true);
    (track.onended as () => void)();
    expect(useDmCallStore.getState().parComCamera).toBe(false);
  });
});
