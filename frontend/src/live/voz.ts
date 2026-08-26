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

/**
 * L-11 é um estado DESENHADO, não um travamento. §17.3: sem porta alcançável o STUN/TURN do
 * host não serve e "a conexão falha com `conn-failed`". Sem este prazo o ICE fica em
 * `checking` indefinidamente e a tela mente "Conectando…" para sempre — foi o que o smoke de
 * §80 mostrou entre operadoras diferentes.
 */
const PRAZO_DE_CONEXAO_MS = 20_000;

/**
 * De quanto em quanto tempo a oferta é REFEITA enquanto o outro lado não responde.
 *
 * §17.4 tem uma corrida embutida que nenhuma das duas pontas consegue evitar sozinha: os
 * tickets de um par só existem depois que os DOIS estão no roster, e cada lado os busca por
 * conta própria. Quem já tinha ticket (quem estava na chamada primeiro, ou quem hospeda)
 * oferta no instante em que vê o roster novo; quem acabou de entrar ainda está buscando os
 * seus, e o núcleo dele — que falha fechada por passo 3 — **descarta a oferta em silêncio**.
 *
 * A oferta descartada não voltava nunca: quem oferta é um lado só (`souOIniciador`), e ele
 * já tinha ofertado. Os dois ficavam parados até o prazo de L-11 anunciar `conn-failed` com
 * "candidatos vistos: nenhum" — o defeito exato do smoke de duas máquinas, em que o host
 * mandava a oferta e o outro lado registrava `SEM TICKET` no mesmo fôlego.
 *
 * Repetir é o que fecha a corrida sem inventar campo no fio: a próxima volta encontra o
 * ticket já entregue e a negociação anda. Custa uma oferta a cada três segundos, e só
 * enquanto houver par sem resposta.
 */
const REPETIR_OFERTA_MS = 3_000;

export interface EventosDaMalha {
  /** A chamada não fechou, e o motivo é nomeado — `conn-failed` de §17.3/§9 (2.3). */
  aoFalhar: (motivo: string) => void;
  /** Estado por par, para a UI de §9 (2.3) — `connecting | connected | failed`. */
  aoMudarPar: (peerHex: string, estado: RTCPeerConnectionState) => void;
  /** O áudio do outro lado, pronto para tocar. */
  aoChegarAudio: (peerHex: string, stream: MediaStream) => void;
  /**
   * Uma trilha de **vídeo** chegou de um par. Este módulo não sabe o que ela é: quem
   * decide se aquilo é uma tela (§17.5) ou uma câmera é quem escuta, cruzando o par com o
   * apresentador da sessão. A separação é por `track.kind`, que é vocabulário do WebRTC.
   */
  aoChegarVideo?: (peerHex: string, stream: MediaStream, track: MediaStreamTrack) => void;
  aoSair: () => void;
}

/**
 * O que se pode fazer com uma trilha que ESTA máquina envia a UM par. Devolvido por
 * `enviarTrilha`, é a única forma de mexer no `RTCRtpSender` sem conhecer a conexão.
 *
 * `maxBitrate` por espectador é o que torna a qualidade de §17.5 real em estrela: cada
 * `RTCRtpSender` tem os próprios `encodings`, então o perfil de um espectador não afeta os
 * outros. É o que fecha `F-08`/`V-13`.
 */
export interface EnvioDeTrilha {
  definirBitrateKbps(kbps: number): Promise<void>;
  /** Números medidos deste envio — a fonte de `share.report` (§17.5). */
  estatisticas(): Promise<{ rttMs: number; lossPct: number } | null>;
  encerrar(): Promise<void>;
}

interface Par {
  pc: RTCPeerConnection;
  /** Repassado opaco na sinalização: o host não o interpreta, o núcleo do destino também não. */
  ticketId: string;
  /**
   * Renegociação que não coube porque a negociação anterior ainda não tinha assentado.
   * Sem isto a trilha era adicionada à conexão e a oferta **nunca saía**: o par entrava no
   * mapa de espectadores como servido e ficava sem vídeo para sempre, em silêncio — a
   * forma exata de defeito que §82.3 nomeou.
   */
  renegociacaoPendente: boolean;
  /**
   * Os candidatos que ESTA máquina já coletou para este par.
   *
   * Trickle ICE manda cada candidato uma vez, no instante em que ele aparece, e
   * `onicecandidate` não repete. Quando a oferta é refeita porque a primeira foi descartada
   * (ver `REPETIR_OFERTA_MS`), os candidatos que saíram junto com ela foram descartados
   * pelo mesmo motivo — e a coleta já terminou. Sem esta cópia, o outro lado responderia a
   * uma oferta para a qual nunca receberia endereço nenhum: DTLS não começaria e a chamada
   * falharia do mesmo jeito, só que mais tarde.
   */
  candidatosLocais: RTCIceCandidateInit[];
  /**
   * Candidatos do outro lado que chegaram ANTES da descrição remota. `addIceCandidate` sem
   * descrição remota é erro de estado, e a promessa recusada não tinha quem a pegasse — o
   * evento entra por `void malha.aplicarSinal(...)`. Guardar e aplicar depois é a disciplina
   * normal do trickle; descartar seria perder o endereço que talvez fosse o único que fura.
   */
  candidatosRemotos: RTCIceCandidateInit[];
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
  /** Tipos de candidato ICE vistos — é o que diz POR QUE não conectou. */
  readonly #tiposDeCandidato = new Set<string>();
  #prazo: ReturnType<typeof setTimeout> | null = null;
  #retentativa: ReturnType<typeof setInterval> | null = null;

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
    // §17.2 "com aviso": o primeiro é o do host; qualquer outro é servidor de TERCEIRO, e
    // ele passa a ver o IP de quem entra na chamada.
    if (r.iceServers.length > 1) {
      log(`ATENÇÃO — ${r.iceServers.length - 1} STUN de terceiro em uso; eles veem seu IP (§17.2)`);
    }
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
    // **Só há prazo se há com quem conectar.** Entrar sozinho num canal de voz é normal —
    // espera-se alguém. Armar o relógio aí fazia a tela anunciar `conn-failed` 20 s depois,
    // com "candidatos vistos: nenhum", para uma chamada que nunca tentou conectar nada.
    if (this.#pares.size > 0) {
      this.#armarPrazo();
      this.#armarRetentativa();
    }
    return { sessionId: r.sessionId };
  }

  /** `voice.roster` — o host publicou a lista nova. Entra quem chegou, sai quem saiu. */
  aplicarRoster(participantes: ReadonlyArray<{ keyHex: string }>): void {
    if (this.#sessionId === null) return;
    const vivos = new Set(participantes.map((p) => p.keyHex.toLowerCase()));
    for (const par of vivos) {
      if (par !== this.#euHex && !this.#pares.has(par)) {
        this.#abrir(par, souOIniciador(this.#euHex, par));
        this.#armarPrazo();
        this.#armarRetentativa();
      }
    }
    for (const par of [...this.#pares.keys()]) {
      if (!vivos.has(par)) this.#fechar(par);
    }
    // Ficar sozinho de novo desarma o relógio: não há conexão pendente para falhar.
    if (this.#pares.size === 0) {
      this.#desarmarPrazo();
      this.#desarmarRetentativa();
    }
  }

  /** `voice.tickets` — a renovação de §17.4. Só muda quem está autorizado; nada reconecta. */
  aplicarTickets(tickets: readonly TicketNoFio[], agora: number): void {
    this.#autorizados = paresAutorizados(tickets, this.#euHex, agora);
    log(`tickets renovados · ${this.#autorizados.size} par(es) autorizado(s)`);
    for (const [par, id] of this.#autorizados) {
      const p = this.#pares.get(par);
      if (p !== undefined) p.ticketId = id;
    }
    // Ticket novo destrava quem estava parado — mas quem estava parado nem sempre é quem
    // acabou de ser autorizado. Quem já tinha o ticket e ofertou cedo demais (§17.4, a
    // corrida de `REPETIR_OFERTA_MS`) também está parado, e comparar com o conjunto
    // anterior fazia exatamente esse caso ser pulado. A condição que vale é o estado da
    // NEGOCIAÇÃO, não a novidade do ticket.
    this.#tentarNegociacoesParadas();
    if (this.#pares.size > 0) this.#armarRetentativa();
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
      // Chegou a descrição: os candidatos que esperavam por ela entram agora, na ordem.
      await this.#soltarCandidatosRemotos(par, p);
      if (desc.type === "offer") {
        const resposta = await p.pc.createAnswer();
        await p.pc.setLocalDescription(resposta);
        await this.#porta.signal({ peerKey: par, ticketId: p.ticketId, sdp: JSON.stringify(resposta) });
        log(`par ${par.slice(0, 8)} · resposta enviada`);
        // A oferta pode ser a REPETIÇÃO de uma que se perdeu (§17.4, `REPETIR_OFERTA_MS`).
        // Nesse caso os candidatos que este lado já coletou saíram junto com a resposta
        // anterior e foram descartados com ela; `onicecandidate` não os repete.
        await this.#reenviarCandidatosLocais(par, p);
      }
      return;
    }
    if (a.ice !== undefined) {
      const candidato = JSON.parse(a.ice) as RTCIceCandidateInit;
      // Sem descrição remota, `addIceCandidate` é erro de estado. O candidato espera.
      if (p.pc.remoteDescription === null) {
        p.candidatosRemotos.push(candidato);
        return;
      }
      await p.pc.addIceCandidate(candidato).catch(() => {
        // Candidato que o navegador recusa é um endereço a menos, nunca o fim da chamada.
      });
    }
  }

  /** Pares com conexão aberta agora — a audiência possível de qualquer trilha nova. */
  pares(): string[] {
    return [...this.#pares.keys()];
  }

  /**
   * §17.4 L-12 — **silenciar a si mesmo é enforcement, não conselho**: "quem controla o
   * microfone é quem o possui". `voice.setSelf` conta ao host, que republica no roster, e é
   * isso que acende o ícone do outro lado — mas o ícone não interrompe áudio nenhum. Quem
   * interrompe é `track.enabled = false`, aqui, na trilha que esta máquina captura.
   *
   * Sem esta linha o mudo era puramente cosmético: o outro lado via o ícone e continuava
   * ouvindo tudo. Distinguir as duas coisas é justamente o que L-12 exige da UI.
   */
  definirMudo(mudo: boolean): void {
    const trilhas = this.#local?.getAudioTracks() ?? [];
    for (const t of trilhas) t.enabled = !mudo;
    log(`microfone ${mudo ? "MUDO" : "ativo"} (${trilhas.length} trilha(s))`);
  }

  /**
   * Manda uma trilha a UM par, pela conexão que a voz já mantém com ele.
   *
   * **Por que a mesma `RTCPeerConnection` da voz, e não uma nova.** §17.5 pede "uma
   * `RTCPeerConnection` por espectador", e é exatamente o que isto é: a conexão que já
   * existe com aquele par. Abrir uma segunda exigiria um canal de sinalização próprio para
   * tela — e §15.4 tem UM (`voice.signal`), sem campo que diga a qual negociação um SDP
   * pertence. Duas conexões pelo mesmo canal fariam a oferta de uma cair na outra.
   * Reaproveitar é o que mantém a estrela de §17.5 dentro do contrato que existe.
   *
   * Como só o apresentador adiciona trilha, só ele renegocia: não há glare a resolver aqui,
   * ao contrário da oferta inicial (`souOIniciador`).
   */
  async enviarTrilha(parHex: string, track: MediaStreamTrack, stream: MediaStream): Promise<EnvioDeTrilha | null> {
    const par = this.#pares.get(parHex.toLowerCase());
    if (par === undefined) {
      log(`trilha para ${parHex.slice(0, 8)} IGNORADA — sem conexão com este par`);
      return null;
    }
    const sender = par.pc.addTrack(track, stream);
    // Contadores da leitura anterior, para medir o intervalo em vez do acumulado.
    let anterior = { perdidos: 0, enviados: 0 };
    log(`par ${parHex.slice(0, 8)} · trilha ${track.kind} adicionada — renegociando`);
    await this.#renegociar(parHex, par);
    return {
      definirBitrateKbps: async (kbps) => {
        const params = sender.getParameters();
        // `encodings` pode vir vazio antes da primeira negociação assentar.
        if (params.encodings.length === 0) params.encodings = [{}];
        params.encodings[0]!.maxBitrate = kbps * 1000;
        await sender.setParameters(params);
        log(`par ${parHex.slice(0, 8)} · maxBitrate ${kbps} kbps`);
      },
      estatisticas: async () => {
        const relatorio = await par.pc.getStats(sender.track);
        const bruto = leituraDeSaida(relatorio);
        if (bruto === null) return null;
        // **Perda do INTERVALO, não da sessão inteira.** `packetsLost`/`packetsSent` são
        // contadores acumulados: dividir um pelo outro dá a média desde o começo, e uma
        // rajada nos primeiros segundos manteria a perda alta para sempre. Como a
        // degradação de §17.5 só desce, isso prenderia o espectador no perfil baixo mesmo
        // depois de a rede melhorar.
        const perdidos = bruto.perdidosAcumulados - anterior.perdidos;
        const enviados = bruto.enviadosAcumulados - anterior.enviados;
        anterior = { perdidos: bruto.perdidosAcumulados, enviados: bruto.enviadosAcumulados };
        const lossPct = enviados > 0 ? Math.max(0, Math.min(100, (perdidos / enviados) * 100)) : 0;
        return { rttMs: bruto.rttMs, lossPct };
      },
      encerrar: async () => {
        try {
          par.pc.removeTrack(sender);
          await this.#renegociar(parHex, par);
        } catch {
          // Par que já caiu não precisa de renegociação: a conexão morreu com a trilha.
        }
      },
    };
  }

  /**
   * Oferta de renegociação para um par já conectado. Fora de `stable` a negociação anterior
   * ainda não assentou e ofertar por cima a quebraria — a trilha entra na próxima.
   */
  async #renegociar(parHex: string, par: Par): Promise<void> {
    if (par.pc.signalingState !== "stable") {
      // Marcado, não perdido: `onsignalingstatechange` solta a oferta quando assentar.
      par.renegociacaoPendente = true;
      log(`par ${parHex.slice(0, 8)} · renegociação represada (estado ${par.pc.signalingState})`);
      return;
    }
    await this.#ofertar(parHex, par);
  }

  async sair(): Promise<void> {
    this.#desarmarPrazo();
    this.#desarmarRetentativa();
    this.#tiposDeCandidato.clear();
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
    const par: Par = {
      pc,
      ticketId: this.#autorizados.get(parHex) ?? "",
      renegociacaoPendente: false,
      candidatosLocais: [],
      candidatosRemotos: [],
    };
    this.#pares.set(parHex, par);

    for (const track of this.#local?.getTracks() ?? []) pc.addTrack(track, this.#local!);

    pc.onicecandidate = (ev) => {
      if (ev.candidate === null) {
        log(`par ${parHex.slice(0, 8)} · coleta de candidatos terminada`);
        return;
      }
      // `typ host` só = rede local. `srflx` = o STUN do host respondeu. `relay` = TURN.
      if (ev.candidate.type !== null && ev.candidate.type !== undefined) {
        this.#tiposDeCandidato.add(ev.candidate.type);
      }
      log(`par ${parHex.slice(0, 8)} · candidato ${ev.candidate.type ?? "?"} ${ev.candidate.protocol ?? ""}`);
      const bruto = ev.candidate.toJSON();
      // Guardado ANTES de sair: a coleta acontece uma vez só, e uma negociação refeita
      // precisa dos mesmos endereços (§17.4, `REPETIR_OFERTA_MS`).
      par.candidatosLocais.push(bruto);
      void this.#porta
        .signal({ peerKey: parHex, ticketId: par.ticketId, ice: JSON.stringify(bruto) })
        .catch(() => undefined);
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (stream === undefined) return;
      // Separado por `kind` porque é isso que o WebRTC diz. O áudio toca; o vídeo sobe para
      // quem sabe interpretá-lo — este módulo não sabe.
      if (ev.track.kind === 'video') {
        log(`par ${parHex.slice(0, 8)} · trilha de VÍDEO recebida`);
        this.#eventos.aoChegarVideo?.(parHex, stream, ev.track);
        return;
      }
      this.#eventos.aoChegarAudio(parHex, stream);
    };
    pc.onconnectionstatechange = () => {
      log(`par ${parHex.slice(0, 8)} · conexão ${pc.connectionState}`);
      // Um par conectado já basta: a chamada existe, e a falha de outro é assimétrica.
      if (pc.connectionState === "connected") this.#desarmarPrazo();
      this.#eventos.aoMudarPar(parHex, pc.connectionState);
    };
    pc.onsignalingstatechange = () => {
      // Voltou a `stable`: se havia trilha esperando, a oferta sai AGORA. É o retorno que
      // faltava — antes o adiamento era definitivo.
      if (pc.signalingState !== "stable" || !par.renegociacaoPendente) return;
      par.renegociacaoPendente = false;
      log(`par ${parHex.slice(0, 8)} · renegociação represada saindo agora`);
      void this.#ofertar(parHex, par);
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

  /**
   * As negociações que começaram e não andaram — e a repetição da oferta que as destrava.
   *
   * O critério é `remoteDescription`: enquanto ela for `null`, o outro lado não respondeu
   * nada, e é indistinguível daqui se ele não recebeu a oferta ou não quis responder. Nos
   * dois casos repetir é a única ação disponível, e repetir é barato. Assim que a resposta
   * entra, o par sai desta lista para sempre.
   *
   * Continua valendo a regra anti-glare: **só o iniciador oferta**. O outro lado não tem o
   * que repetir — se a oferta não chegou, não há resposta a refazer.
   */
  #tentarNegociacoesParadas(): void {
    let pendentes = 0;
    for (const [parHex, p] of this.#pares) {
      if (!souOIniciador(this.#euHex, parHex)) continue;
      if (p.pc.remoteDescription !== null) continue; // já respondeu: nada a refazer
      const estado = p.pc.connectionState;
      if (estado === "connected" || estado === "closed" || estado === "failed") continue;
      // Sem ticket ainda não se oferta (§17.4 passo 4) — mas ainda é pendência: é ESTE lado
      // que está esperando a renovação, e desarmar aqui deixaria a repetição fora do ar
      // justamente no caso que ela existe para cobrir.
      pendentes++;
      if (!this.#autorizados.has(parHex)) continue;
      log(`par ${parHex.slice(0, 8)} · sem resposta — repetindo a oferta`);
      void this.#ofertar(parHex, p).then(() => this.#reenviarCandidatosLocais(parHex, p));
    }
    // Nada mais a repetir: o relógio para até uma negociação nova precisar dele.
    if (pendentes === 0) this.#desarmarRetentativa();
  }

  /**
   * Reenvia os candidatos já coletados. Repetido é inofensivo — o outro lado descarta o que
   * já conhece —, e ausente é fatal: sem endereço não há par para o ICE testar.
   */
  async #reenviarCandidatosLocais(parHex: string, par: Par): Promise<void> {
    if (par.candidatosLocais.length === 0) return;
    log(`par ${parHex.slice(0, 8)} · reenviando ${par.candidatosLocais.length} candidato(s)`);
    for (const c of par.candidatosLocais) {
      await this.#porta
        .signal({ peerKey: parHex, ticketId: par.ticketId, ice: JSON.stringify(c) })
        .catch(() => undefined);
    }
  }

  /** Os candidatos do outro lado que esperavam a descrição remota. */
  async #soltarCandidatosRemotos(parHex: string, par: Par): Promise<void> {
    if (par.candidatosRemotos.length === 0) return;
    const espera = par.candidatosRemotos;
    par.candidatosRemotos = [];
    log(`par ${parHex.slice(0, 8)} · aplicando ${espera.length} candidato(s) represado(s)`);
    for (const c of espera) {
      await par.pc.addIceCandidate(c).catch(() => undefined);
    }
  }

  #armarRetentativa(): void {
    if (this.#retentativa !== null) return;
    this.#retentativa = setInterval(() => {
      if (this.#sessionId === null) {
        this.#desarmarRetentativa();
        return;
      }
      this.#tentarNegociacoesParadas();
    }, REPETIR_OFERTA_MS);
  }

  #desarmarRetentativa(): void {
    if (this.#retentativa !== null) clearInterval(this.#retentativa);
    this.#retentativa = null;
  }

  #armarPrazo(): void {
    this.#desarmarPrazo();
    this.#prazo = setTimeout(() => {
      this.#prazo = null;
      if (this.#sessionId === null) return;
      const so = [...this.#tiposDeCandidato];
      // Só `host` significa que NENHUM endereço público foi descoberto: o STUN de quem
      // hospeda não respondeu. É a L-11, e a tela deve dizer isso, não ficar girando.
      const semPublico = so.length > 0 && so.every((t) => t === "host");
      const motivo = semPublico
        ? "Sem endereço público: quem hospeda a comunidade não está alcançável de fora da rede dela."
        : "Não foi possível estabelecer a conexão de voz com o outro par.";
      log(`FALHOU · candidatos vistos: ${so.join(", ") || "nenhum"}`);
      this.#eventos.aoFalhar(motivo);
    }, PRAZO_DE_CONEXAO_MS);
  }

  #desarmarPrazo(): void {
    if (this.#prazo !== null) clearTimeout(this.#prazo);
    this.#prazo = null;
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

/**
 * Leitura crua de UM envio, a partir do `RTCStatsReport` (§17.5: "obtidos de
 * `RTCStatsReport` no renderer do apresentador").
 *
 * A perda vem do relatório do RECEPTOR que o par nos devolve (`remote-inbound-rtp`): é ele
 * que sabe quantos pacotes faltaram. `outbound-rtp` conta o que saiu daqui, e o que saiu
 * daqui nunca se perdeu do ponto de vista de quem enviou.
 *
 * Os contadores saem **acumulados**, como o WebRTC os entrega; transformá-los em taxa do
 * intervalo é de quem guarda a leitura anterior (`enviarTrilha`).
 */
export function leituraDeSaida(
  relatorio: RTCStatsReport,
): { rttMs: number; perdidosAcumulados: number; enviadosAcumulados: number } | null {
  let rttMs: number | null = null;
  let perdidos: number | null = null;
  let enviados: number | null = null;

  relatorio.forEach((entrada) => {
    const s = entrada as RTCStats & Record<string, unknown>;
    if (s.type === "remote-inbound-rtp") {
      if (typeof s["roundTripTime"] === "number") rttMs = s["roundTripTime"] * 1000;
      if (typeof s["packetsLost"] === "number") perdidos = s["packetsLost"];
    }
    if (s.type === "outbound-rtp" && typeof s["packetsSent"] === "number") {
      enviados = s["packetsSent"];
    }
  });

  if (rttMs === null && perdidos === null) return null;
  return {
    rttMs: rttMs ?? 0,
    perdidosAcumulados: perdidos ?? 0,
    enviadosAcumulados: enviados ?? 0,
  };
}
