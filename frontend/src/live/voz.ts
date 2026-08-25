/**
 * A malha de voz do renderer — §17.2 (WebRTC ponta a ponta) e §17.4 (tickets).
 *
 * **O que este módulo NÃO faz: criptografia.** §17.4 passo 3 diz que o cliente só aceita
 * sinalização de par com ticket válido, e quem verifica isso é o NÚCLEO: `signalIsAuthorized`
 * roda antes do evento chegar aqui, com a chave do host e os tickets da sessão, e falha
 * fechada. Duplicar a verificação no renderer exigiria Ed25519 sobre BLAKE2b no navegador —
 * que a WebCrypto não tem — e criaria uma segunda fonte de verdade para a mesma regra.
 *
 * O que sobra para cá é o passo 4: **não iniciar DTLS com par para quem não temos ticket**.
 * Isso não precisa de assinatura, só de saber para quem o host emitiu — e é o que
 * `paresAutorizados` responde.
 *
 * **Duas formas de ticket no fio, e não é descuido de quem lê.** `voice.join` responde pela
 * IPC-R, que é `postMessage`/structured clone: as chaves vêm como `Uint8Array`. Já
 * `voice.tickets` é montado com o codec de §16.2, que é JSON e leva hex. `chaveHex` absorve
 * as duas, porque quem consome não deve saber por qual porta o ticket entrou.
 *
 * O `RTCPeerConnection` e a captura entram injetados: sem isso nada aqui seria testável fora
 * de um navegador com microfone.
 */
import type { MediaTicketDto } from "../ipc/api";

/**
 * Diagnóstico do caminho de mídia, no console do renderer.
 *
 * Existe porque o log de fronteira do produto (`[main]`, `[nucleo]`) vai para o stdout do
 * processo Electron — que numa instalação de Windows aberta pelo Explorer não tem para onde
 * ir. Uma negociação WebRTC que falha em silêncio é indistinguível de uma que nunca começou,
 * e no smoke de duas máquinas foi exatamente essa a dúvida que custou caro.
 */
function log(msg: string, extra?: unknown): void {
  if (extra === undefined) console.log(`[voz] ${msg}`);
  else console.log(`[voz] ${msg}`, extra);
}

/** Ticket como chega da IPC-R (bytes) ou do fio de §16.2 (hex). */
export type TicketNoFio = MediaTicketDto | { peerA: string; peerB: string; expiresAt: number };

export function chaveHex(v: Uint8Array | string): string {
  if (typeof v === "string") return v.toLowerCase();
  return Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Para quem o host autorizou esta instalação a falar, dado o conjunto de tickets vivos.
 * Cada ticket nomeia um PAR ordenado `(peerA, peerB)`; o outro lado é o autorizado.
 */
export function paresAutorizados(
  tickets: readonly TicketNoFio[],
  euHex: string,
  agora: number,
): Map<string, string> {
  const eu = euHex.toLowerCase();
  const out = new Map<string, string>();
  for (const t of tickets) {
    if (t.expiresAt <= agora) continue;
    const a = chaveHex(t.peerA);
    const b = chaveHex(t.peerB);
    const id = ticketIdDe(t);
    if (a === eu) out.set(b, id);
    else if (b === eu) out.set(a, id);
  }
  return out;
}

/**
 * O `ticketId` que §15.4 exige em `voice.signal`, derivado da assinatura — os 12 primeiros
 * bytes, o mesmo que o núcleo faz em `ticketIdOf`.
 *
 * Antes eu mandava string vazia até receber um sinal, e o roteador recusava com
 * `E_VALIDATION`: quem OFERTA fala primeiro e não tinha nada para apresentar. O id nunca
 * viajou pelo `voice.join`; derivá-lo é o que fecha a lacuna sem campo novo no fio (§79).
 */
export function ticketIdDe(t: TicketNoFio): string {
  const sig = (t as { sig?: Uint8Array | string }).sig;
  if (sig === undefined) return "";
  return chaveHex(sig).slice(0, 24);
}

/**
 * Quem manda a oferta. Sem uma regra combinada, os dois lados ofertam ao mesmo tempo e a
 * negociação entra em *glare*. A comparação das chaves é determinística e os dois lados
 * chegam à mesma conclusão sem trocar mensagem para isso.
 */
export function souOIniciador(euHex: string, parHex: string): boolean {
  return euHex.toLowerCase() < parHex.toLowerCase();
}

export interface PortaDeVoz {
  join(a: { communityId: string; channelId: string }): Promise<{
    sessionId: string;
    roster: Array<{ keyHex: string }>;
    iceServers: RTCIceServer[];
    tickets: TicketNoFio[];
  }>;
  leave(): Promise<unknown>;
  signal(a: { peerKey: string; ticketId: string; sdp?: string; ice?: string }): Promise<unknown>;
}

export interface FabricaDeMidia {
  /** `getUserMedia({audio})` com o microfone escolhido, ou o padrão do sistema. */
  capturar(deviceId: string): Promise<MediaStream>;
  conexao(config: RTCConfiguration): RTCPeerConnection;
}

export interface EventosDaMalha {
  /** Estado por par, para a UI de §9 (2.3) — `connecting | connected | failed`. */
  aoMudarPar: (peerHex: string, estado: RTCPeerConnectionState) => void;
  /** O áudio do outro lado, pronto para tocar. */
  aoChegarAudio: (peerHex: string, stream: MediaStream) => void;
  aoSair: () => void;
}

interface Par {
  pc: RTCPeerConnection;
  /** Repassado opaco na sinalização: o host não o interpreta, o núcleo do destino também não. */
  ticketId: string;
}

/**
 * Uma chamada viva. §15.4 diz "voz é uma só": a instalação tem no máximo uma, e é por isso
 * que esta classe é instanciada uma vez e reusada, nunca empilhada.
 */
export class MalhaDeVoz {
  readonly #porta: PortaDeVoz;
  readonly #midia: FabricaDeMidia;
  readonly #eventos: EventosDaMalha;
  readonly #pares = new Map<string, Par>();
  #local: MediaStream | null = null;
  #config: RTCConfiguration = {};
  #euHex = "";
  #autorizados = new Map<string, string>();
  #sessionId: string | null = null;

  constructor(porta: PortaDeVoz, midia: FabricaDeMidia, eventos: EventosDaMalha) {
    this.#porta = porta;
    this.#midia = midia;
    this.#eventos = eventos;
  }

  get sessionId(): string | null {
    return this.#sessionId;
  }

  async entrar(a: {
    communityId: string;
    channelId: string;
    euHex: string;
    microfoneId: string;
    agora: number;
  }): Promise<{ sessionId: string }> {
    // A ordem importa: o host decide ANTES de qualquer captura. Ligar o microfone para
    // depois descobrir que a permissão de §9.1 não deixa entrar acende a luz à toa.
    log(`entrando em ${a.channelId}`);
    const r = await this.#porta.join({ communityId: a.communityId, channelId: a.channelId });
    // O que o host serve. Lista VAZIA aqui significa que a chamada só fecha em rede local:
    // sem STUN o WebRTC junta apenas candidato de host (§17.3, L-11).
    log(`join ok · sessão ${r.sessionId} · roster ${r.roster.length} · iceServers`, r.iceServers);
    this.#sessionId = r.sessionId;
    this.#euHex = a.euHex.toLowerCase();
    this.#config = { iceServers: r.iceServers };
    this.#autorizados = paresAutorizados(r.tickets, this.#euHex, a.agora);
    this.#local = await this.#midia.capturar(a.microfoneId);
    log(`microfone ok · autorizado a falar com ${this.#autorizados.size} par(es)`, [...this.#autorizados.keys()]);

    for (const p of r.roster) {
      const par = p.keyHex.toLowerCase();
      if (par === this.#euHex) continue;
      this.#abrir(par, souOIniciador(this.#euHex, par));
    }
    return { sessionId: r.sessionId };
  }

  /** `voice.roster` — o host publicou a lista nova. Entra quem chegou, sai quem saiu. */
  aplicarRoster(participantes: ReadonlyArray<{ keyHex: string }>): void {
    if (this.#sessionId === null) return;
    const vivos = new Set(participantes.map((p) => p.keyHex.toLowerCase()));
    for (const par of vivos) {
      if (par !== this.#euHex && !this.#pares.has(par)) this.#abrir(par, souOIniciador(this.#euHex, par));
    }
    for (const par of [...this.#pares.keys()]) {
      if (!vivos.has(par)) this.#fechar(par);
    }
  }

  /** `voice.tickets` — a renovação de §17.4. Só muda quem está autorizado; nada reconecta. */
  aplicarTickets(tickets: readonly TicketNoFio[], agora: number): void {
    const antes = this.#autorizados;
    this.#autorizados = paresAutorizados(tickets, this.#euHex, agora);
    log(`tickets renovados · ${this.#autorizados.size} par(es) autorizado(s)`);
    // Ticket NOVO destrava quem estava parado: quem entrou primeiro na chamada abriu a
    // conexão sem poder ofertar (§17.4 passo 4) e ficou esperando. Agora pode.
    for (const [par, id] of this.#autorizados) {
      if (antes.has(par)) continue;
      const p = this.#pares.get(par);
      if (p !== undefined) p.ticketId = id;
      if (p !== undefined && souOIniciador(this.#euHex, par)) {
        log(`par ${par.slice(0, 8)} · destravado pelo ticket novo — ofertando`);
        void this.#ofertar(par, p);
      }
    }
  }

  /**
   * `voice.signal` — SDP/ICE de um par. O núcleo já autorizou (passo 3); aqui vale o passo 4,
   * que é não deixar DTLS começar com quem o host não pareou conosco.
   */
  async aplicarSinal(a: { peerKey: string; ticketId: string; sdp?: string; ice?: string }): Promise<void> {
    const par = a.peerKey.toLowerCase();
    if (this.#sessionId === null || par === this.#euHex) return;
    if (!this.#autorizados.has(par)) {
      log(`sinal de ${par.slice(0, 8)} IGNORADO — sem ticket para este par (§17.4 passo 4)`);
      return;
    }

    log(`sinal recebido de ${par.slice(0, 8)} · ${a.sdp !== undefined ? "sdp" : "ice"}`);
    const existente = this.#pares.get(par);
    const p = existente ?? this.#abrir(par, false);
    // O id que vale é o do NOSSO ticket; o que veio no quadro é do ticket do outro lado.
    p.ticketId = this.#autorizados.get(par) ?? a.ticketId;

    if (a.sdp !== undefined) {
      const desc = JSON.parse(a.sdp) as RTCSessionDescriptionInit;
      await p.pc.setRemoteDescription(desc);
      if (desc.type === "offer") {
        const resposta = await p.pc.createAnswer();
        await p.pc.setLocalDescription(resposta);
        await this.#porta.signal({ peerKey: par, ticketId: p.ticketId, sdp: JSON.stringify(resposta) });
      }
      return;
    }
    if (a.ice !== undefined) {
      await p.pc.addIceCandidate(JSON.parse(a.ice) as RTCIceCandidateInit);
    }
  }

  async sair(): Promise<void> {
    for (const par of [...this.#pares.keys()]) this.#fechar(par);
    for (const t of this.#local?.getTracks() ?? []) t.stop();
    this.#local = null;
    this.#sessionId = null;
    this.#autorizados.clear();
    await this.#porta.leave().catch(() => undefined);
    this.#eventos.aoSair();
  }

  #abrir(parHex: string, iniciar: boolean): Par {
    const pc = this.#midia.conexao(this.#config);
    // O id sai do ticket que o host emitiu para NÓS DOIS — não é opaco nem inventado.
    const par: Par = { pc, ticketId: this.#autorizados.get(parHex) ?? "" };
    this.#pares.set(parHex, par);

    for (const track of this.#local?.getTracks() ?? []) pc.addTrack(track, this.#local!);

    pc.onicecandidate = (ev) => {
      if (ev.candidate === null) {
        log(`par ${parHex.slice(0, 8)} · coleta de candidatos terminada`);
        return;
      }
      // `typ host` só = rede local. `srflx` = o STUN do host respondeu. `relay` = TURN.
      log(`par ${parHex.slice(0, 8)} · candidato ${ev.candidate.type ?? "?"} ${ev.candidate.protocol ?? ""}`);
      void this.#porta
        .signal({ peerKey: parHex, ticketId: par.ticketId, ice: JSON.stringify(ev.candidate.toJSON()) })
        .catch(() => undefined);
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (stream !== undefined) this.#eventos.aoChegarAudio(parHex, stream);
    };
    pc.onconnectionstatechange = () => {
      log(`par ${parHex.slice(0, 8)} · conexão ${pc.connectionState}`);
      this.#eventos.aoMudarPar(parHex, pc.connectionState);
    };
    pc.oniceconnectionstatechange = () => log(`par ${parHex.slice(0, 8)} · ICE ${pc.iceConnectionState}`);
    pc.onicegatheringstatechange = () => log(`par ${parHex.slice(0, 8)} · coleta ICE ${pc.iceGatheringState}`);

    // §17.4 passo 4 — sem ticket para este par, a conexão existe mas NÃO oferta: nada de
    // DTLS. Quando a renovação trouxer o ticket, o roster seguinte reabre.
    if (iniciar && this.#autorizados.has(parHex)) {
      void this.#ofertar(parHex, par);
    } else {
      log(
        `par ${parHex.slice(0, 8)} · aguardando oferta` +
          (this.#autorizados.has(parHex) ? "" : " (SEM TICKET — o host não pareou nós dois)"),
      );
    }
    return par;
  }

  async #ofertar(parHex: string, par: Par): Promise<void> {
    try {
      const oferta = await par.pc.createOffer();
      await par.pc.setLocalDescription(oferta);
      await this.#porta.signal({ peerKey: parHex, ticketId: par.ticketId, sdp: JSON.stringify(oferta) });
      log(`par ${parHex.slice(0, 8)} · oferta enviada`);
    } catch (e) {
      log(`par ${parHex.slice(0, 8)} · oferta FALHOU`, e);
      this.#eventos.aoMudarPar(parHex, "failed");
    }
  }

  #fechar(parHex: string): void {
    const p = this.#pares.get(parHex);
    if (p === undefined) return;
    this.#pares.delete(parHex);
    try {
      p.pc.close();
    } catch {
      // Fechar duas vezes não é erro que interesse a ninguém.
    }
    this.#eventos.aoMudarPar(parHex, "closed");
  }
}
