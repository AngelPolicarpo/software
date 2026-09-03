import type { EnvioDeTrilha } from "./voz";

/**
 * §31.15 (emenda de 2026-09-03) — a tela de uma conversa direta.
 *
 * **É a malha de dois, e o arquivo se lê pelo que não está aqui.** A estrela de §17.5 é uma
 * topologia — "uma `RTCPeerConnection` por espectador" —, e com um espectador ela É a conexão
 * que a chamada já mantém. Cada peça ausente sai por uma linha da tabela de remoções:
 *
 *   - **Nenhuma sessão.** Não há `share.start`, `sessionId` de host nem `share.started`: não
 *     existe host que registre nem que anuncie. O escopo é a conversa.
 *   - **Nenhum `share.join` e nenhum ticket.** Há um espectador só, e o `p2p-dm/1`
 *     autenticado por Noise já o autorizou — a mesma linha que removeu o ticket de §17.4.
 *   - **Nenhum roster de espectadores, nenhum `share.viewersChanged`.** A audiência é o par.
 *   - **Nenhum laço de saúde.** Sem `share.setQuality`, sem `share.report`, sem
 *     `share.health` e sem degradação manual. §17.5 mede e degrada porque **um upload serve
 *     N espectadores** e a estimativa de uma conexão não dá política sobre as outras; com
 *     N = 1 a estimativa daquela conexão **é** a política, e o `transport-cc` do próprio
 *     WebRTC adapta o encoder continuamente. Some junto o "quem mede não decide", cuja razão
 *     declarada é impedir um espectador de empurrar o perfil dos **outros** — e numa dupla
 *     não há outros.
 *
 * **O que continua valendo sem alteração:** a recusa de §17.3 (emenda de 2026-08-28) — tela
 * não sobe por caminho relayado —, porque ela é conselho do lado que empurra e não depende de
 * host; e `applyConstraints`, que §17.5 já declara local e sem RPC.
 *
 * A captura e a malha entram **injetadas**, como em `camera.ts`: sem isso nada aqui seria
 * testável fora de um navegador com permissão de captura.
 */

function log(msg: string, extra?: unknown): void {
  if (extra === undefined) console.log(`[dm-tela] ${msg}`);
  else console.log(`[dm-tela] ${msg}`, extra);
}

/** O que este módulo precisa da malha. Nada de `RTCPeerConnection` atravessa. */
export interface PortaDaMalhaDeTela {
  /** Os pares conectados — numa DM, zero ou um. */
  pares(): string[];
  enviarTrilha(
    parHex: string,
    track: MediaStreamTrack,
    stream: MediaStream,
  ): Promise<EnvioDeTrilha | null>;
}

/**
 * A captura, injetada.
 *
 * `declararSessao` continua existindo e continua sendo obrigatória: o main de §17.5/`T-41`
 * nega toda captura sem sessão declarada, e essa falha fechada não é afrouxada aqui. O que
 * muda é **o que se declara** — o `conversationId`, contra o qual o núcleo responde
 * `capture.authorize` a partir de estar-em-chamada, e não de um `captureToken` de sessão.
 */
export interface FabricaDeCapturaDeTela {
  declararSessao(a: { sessionId: string; kind: "screen" | "window"; sourceId?: string | null; audio?: boolean }): Promise<void>;
  capturar(a: { kind: "screen" | "window"; audio: boolean }): Promise<MediaStream>;
}

export interface EventosDaTelaDaDm {
  /** A pessoa parou pela UI do sistema ("Parar de compartilhar" do SO). */
  aoEncerrarNaFonte: () => void;
}

/**
 * §20.1 — o motivo, em português, de uma captura que não aconteceu.
 *
 * `NotAllowedError` aqui tem duas origens que a pessoa não distingue e não precisa
 * distinguir: ela fechou o seletor, ou o main negou (§15.7). As duas pedem a mesma ação.
 */
export function motivoDoErroDeTela(e: unknown): string {
  const nome = (e as { name?: string } | null)?.name ?? "";
  if (nome === "NotAllowedError" || nome === "SecurityError") {
    return "A captura de tela não foi autorizada.";
  }
  if (nome === "NotFoundError") return "A fonte escolhida não está mais disponível.";
  return "Não foi possível compartilhar a tela.";
}

export class TelaDaDm {
  readonly #malha: PortaDaMalhaDeTela;
  readonly #captura: FabricaDeCapturaDeTela;
  readonly #eventos: EventosDaTelaDaDm;
  #stream: MediaStream | null = null;
  #video: MediaStreamTrack | null = null;
  #envios: EnvioDeTrilha[] = [];

  constructor(
    malha: PortaDaMalhaDeTela,
    captura: FabricaDeCapturaDeTela,
    eventos: EventosDaTelaDaDm,
  ) {
    this.#malha = malha;
    this.#captura = captura;
    this.#eventos = eventos;
  }

  get transmitindo(): boolean {
    return this.#video !== null;
  }

  /** A imagem que esta máquina captura, para o próprio tile. */
  get stream(): MediaStream | null {
    return this.#stream;
  }

  /**
   * Começa a transmitir. A ordem é a de §17.5 e **não** é a da câmera: declara-se ao main
   * ANTES de capturar (`T-41`), porque capturar primeiro tornaria a autorização decorativa —
   * a imagem já estaria na memória do renderer quando a resposta chegasse.
   *
   * `conversationId` ocupa o slot do `sessionId`, a mesma substituição de `dm.callJoin`.
   */
  async iniciar(a: {
    conversationId: string;
    kind: "screen" | "window";
    sourceId?: string | null;
    audio: boolean;
  }): Promise<void> {
    if (this.#video !== null) await this.parar();
    await this.#captura.declararSessao({
      sessionId: a.conversationId,
      kind: a.kind,
      sourceId: a.sourceId ?? null,
      audio: a.audio,
    });
    const stream = await this.#captura.capturar({ kind: a.kind, audio: a.audio });
    const video = stream.getVideoTracks()[0] ?? null;
    if (video === null) {
      for (const t of stream.getTracks()) t.stop();
      throw Object.assign(new Error("captura sem trilha de vídeo"), { name: "NotFoundError" });
    }
    this.#stream = stream;
    this.#video = video;
    // "Parar de compartilhar" do sistema operacional. Sem isto o botão continuaria dizendo
    // "Parar" sobre uma trilha morta — a mesma decoração que L-12 tirou do mudo.
    video.onended = () => {
      log("captura encerrada na fonte");
      this.#eventos.aoEncerrarNaFonte();
    };
    // Numa DM o par é um só, mas a varredura é a mesma: se não há ninguém conectado a
    // transmissão não sobe, e isso é honesto — não há a quem mandar.
    const audioDaTela = stream.getAudioTracks()[0] ?? null;
    for (const par of this.#malha.pares()) {
      const envio = await this.#malha.enviarTrilha(par, video, stream);
      // `null` é a recusa de §17.3: caminho relayado não carrega tela. Vale igual aqui.
      if (envio === null) {
        log(`par ${par.slice(0, 8)} recusou a tela — caminho relayado (§17.3)`);
        continue;
      }
      this.#envios.push(envio);
      if (audioDaTela !== null) {
        const som = await this.#malha.enviarTrilha(par, audioDaTela, stream);
        if (som !== null) this.#envios.push(som);
      }
    }
    log(`transmitindo · '${video.label}'${audioDaTela === null ? " (sem som)" : " com som"}`);
  }

  /**
   * Para: esvazia os m-lines reservados e **para a captura**. As duas metades importam —
   * esvaziar sem parar deixaria o indicador do sistema aceso para ninguém, e parar sem
   * esvaziar deixaria o par com o último quadro congelado.
   */
  async parar(): Promise<void> {
    if (this.#video === null && this.#stream === null) return;
    if (this.#video !== null) this.#video.onended = null;
    for (const e of this.#envios) await e.encerrar().catch(() => undefined);
    this.#envios = [];
    for (const t of this.#stream?.getTracks() ?? []) t.stop();
    this.#stream = null;
    this.#video = null;
    log("parou");
  }
}
