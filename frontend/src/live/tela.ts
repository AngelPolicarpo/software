/**
 * O compartilhamento de tela do renderer — §17.5 (estrela WebRTC, ≤ 8 espectadores).
 *
 * **A divisão é a mesma da voz (§76).** `live/voz.ts` fala WebRTC e não sabe o que é uma
 * tela; este módulo sabe o que é uma tela e **não toca em `RTCPeerConnection`** — ele fala
 * com a malha por uma porta (`PortaDaMalha`) que só conhece "trilha", "par" e "bitrate". O
 * `voiceStore` guarda o estado que a tela lê; `live/sincronizacao.ts` é o único lugar onde
 * os três se encontram.
 *
 * **Por que não há conexão nova aqui.** §17.5 pede uma `RTCPeerConnection` por espectador, e
 * ela já existe: é a que a voz mantém com aquele par. §15.4 tem um único canal de
 * sinalização (`voice.signal`) e nenhum campo que diga a qual negociação um SDP pertence —
 * uma segunda conexão pelo mesmo canal faria a oferta de uma cair na outra. A estrela de
 * §17.5 é, portanto, o conjunto dos envios de trilha sobre a malha que já está de pé.
 *
 * **A ordem de `T-41` é lei aqui.** `share.start` → o host autoriza → `captureToken` →
 * `getDisplayMedia`. Nunca o contrário: capturar antes de saber se a permissão
 * `voice_share_screen` deixa passar acende a luz da captura à toa, que é o mesmo erro que
 * §76.4 nomeou para o microfone.
 *
 * **TURN não entra.** §17.3: "tela via TURN é **recusada** no v1". Não há fallback relayado
 * a desenhar nem a anunciar — se a conexão da voz com aquele par não fechou, não há tela
 * para ele.
 *
 * A captura e a malha entram **injetadas**: sem isso nada aqui seria testável fora de um
 * navegador com tela real.
 */
import {
  SHARE_QUALITY_KBPS,
  type ShareQualityDto,
  type ShareViewerHealthDto,
} from "../ipc/api";
import type { EnvioDeTrilha } from "./voz";

/**
 * Diagnóstico do caminho de tela, no console do renderer — irmão do `[voz]`.
 *
 * §82.1: cinco dos oito defeitos da voz só ficaram visíveis depois que §77 instrumentou o
 * caminho. Uma negociação que falha em silêncio é indistinguível de uma que nunca começou, e
 * o stdout do processo Electron não tem para onde ir numa instalação aberta pelo Explorer.
 */
function log(msg: string, extra?: unknown): void {
  if (extra === undefined) console.log(`[tela] ${msg}`);
  else console.log(`[tela] ${msg}`, extra);
}

/** §17.6 — a cadência de `shareHealth`. É nela que medimos e relatamos. */
const CADENCIA_DE_SAUDE_MS = 2_000;

/** O que este módulo precisa da malha de voz. Nada de `RTCPeerConnection` atravessa. */
export interface PortaDaMalha {
  pares(): string[];
  enviarTrilha(
    parHex: string,
    track: MediaStreamTrack,
    stream: MediaStream,
  ): Promise<EnvioDeTrilha | null>;
}

/** A superfície de §15.4 que a tela usa. */
export interface PortaDeTela {
  start(a: {
    communityId: string;
    channelId: string;
    quality: ShareQualityDto;
  }): Promise<{ sessionId: string }>;
  stop(a: { sessionId: string }): Promise<unknown>;
  join(a: { sessionId: string }): Promise<{ ticketId: string; presenterKey: string }>;
  setQuality(a: { sessionId: string; quality: ShareQualityDto }): Promise<{ applied: boolean }>;
  report(a: {
    sessionId: string;
    samples: Array<{ viewerKey: string; rttMs: number; lossPct: number }>;
  }): Promise<unknown>;
}

/**
 * A captura de tela, injetada. Em produto é `getDisplayMedia`; no teste é uma trilha falsa.
 *
 * `declararSessao` é a metade de §17.5 que vive no main: ele precisa saber a qual sessão a
 * próxima captura se refere para perguntar ao núcleo (`capture.authorize`, §15.7) antes de
 * conceder. Sem essa declaração o main nega — falha fechada.
 */
export interface FabricaDeCaptura {
  declararSessao(a: { sessionId: string | null; kind: "screen" | "window" }): Promise<void>;
  capturar(): Promise<MediaStream>;
}

export interface EventosDaTela {
  /** A transmissão não subiu, e o motivo é nomeado — `share.failed` de §15.5. */
  aoFalhar: (motivo: string) => void;
  /** A pessoa parou pela UI do sistema ("Parar de compartilhar" do SO). */
  aoEncerrarNaFonte: () => void;
  /** Saúde por espectador, medida aqui e consolidada pelo núcleo (§17.5). */
  aoMedir?: (amostras: readonly ShareViewerHealthDto[]) => void;
}

interface Espectador {
  envio: EnvioDeTrilha;
  /** Perfil corrente aplicado a ESTE espectador (§17.5: por espectador, não por sessão). */
  quality: ShareQualityDto;
}

/**
 * Uma sessão de tela viva. §17.5: "exatamente 1" por canal, e o host recusa a segunda com
 * `E_ALREADY_SHARING` — por isso esta classe é instanciada uma vez e reusada.
 */
export class EstrelaDeTela {
  readonly #porta: PortaDeTela;
  readonly #malha: PortaDaMalha;
  readonly #captura: FabricaDeCaptura;
  readonly #eventos: EventosDaTela;
  readonly #espectadores = new Map<string, Espectador>();
  #stream: MediaStream | null = null;
  #track: MediaStreamTrack | null = null;
  #sessionId: string | null = null;
  #euHex = "";
  /** Perfil pedido no `share.start`; base de quem entra depois (§17.5). */
  #qualityBase: ShareQualityDto = "balanced";
  #relogio: ReturnType<typeof setInterval> | null = null;

  constructor(
    porta: PortaDeTela,
    malha: PortaDaMalha,
    captura: FabricaDeCaptura,
    eventos: EventosDaTela,
  ) {
    this.#porta = porta;
    this.#malha = malha;
    this.#captura = captura;
    this.#eventos = eventos;
  }

  get sessionId(): string | null {
    return this.#sessionId;
  }

  /** Espectadores servidos agora — o que a faixa do tile mostra (§17.5). */
  get espectadores(): string[] {
    return [...this.#espectadores.keys()];
  }

  /** A tela capturada, para o `<video>` de quem apresenta. `null` fora de apresentação. */
  get stream(): MediaStream | null {
    return this.#stream;
  }

  /** Como a fonte escolhida se chama, dita pelo sistema — nunca inventado pela UI. */
  get rotuloDaFonte(): string {
    return this.#track?.label ?? "";
  }

  /**
   * §17.5 — começar a apresentar. A ordem de `T-41` está escrita nas linhas abaixo e não
   * pode ser reordenada: o host decide, o núcleo cunha o token, o main o verifica, e só
   * então a tela é capturada.
   */
  async apresentar(a: {
    communityId: string;
    channelId: string;
    euHex: string;
    quality?: ShareQualityDto;
    kind?: "screen" | "window";
  }): Promise<{ sessionId: string }> {
    const quality = a.quality ?? "balanced";
    log(`share.start em ${a.channelId} · perfil ${quality}`);

    // 1. O host decide. Sem `voice_share_screen`, canal de voz e chamada ativa, não há
    //    sessão — e capturar antes disto acenderia a luz da captura à toa (§76.4).
    const r = await this.#porta.start({
      communityId: a.communityId,
      channelId: a.channelId,
      quality,
    });
    log(`share.start ok · sessão ${r.sessionId}`);
    this.#sessionId = r.sessionId;
    this.#euHex = a.euHex.toLowerCase();
    this.#qualityBase = quality;

    // 2. O main precisa saber a qual sessão a próxima captura se refere, para perguntar ao
    //    núcleo (§15.7). O `captureToken` não viaja: ele já está no núcleo desta máquina.
    await this.#captura.declararSessao({ sessionId: r.sessionId, kind: a.kind ?? "screen" });

    // 3. Agora, e só agora, a tela.
    try {
      this.#stream = await this.#captura.capturar();
    } catch (e) {
      log("getDisplayMedia FALHOU", e);
      await this.#porta.stop({ sessionId: r.sessionId }).catch(() => undefined);
      this.#sessionId = null;
      await this.#captura.declararSessao({ sessionId: null, kind: "screen" });
      throw e;
    }
    const track = this.#stream.getVideoTracks()[0] ?? null;
    if (track === null) {
      log("captura sem trilha de vídeo — encerrando a sessão");
      await this.parar();
      throw new Error("captura sem trilha de vídeo");
    }
    this.#track = track;
    log(`captura ok · '${track.label}'`);

    // A pessoa pode parar pelo botão do SISTEMA, que não passa por lugar nenhum do produto.
    // Sem isto a sessão ficaria viva no host com uma trilha morta.
    track.onended = () => {
      log("captura encerrada na fonte (botão do sistema)");
      this.#eventos.aoEncerrarNaFonte();
    };

    this.#iniciarMedicao();
    return { sessionId: r.sessionId };
  }

  /**
   * `share.viewersChanged`/`share.started` disseram quem assiste. Abre o envio para quem
   * entrou e encerra o de quem saiu.
   *
   * O teto de 8 é do HOST (`E_SESSION_FULL`, §17.5): esta lista já vem podada. Repetir a
   * checagem aqui criaria uma segunda fonte de verdade para a mesma regra.
   */
  async atualizarEspectadores(chaves: readonly string[]): Promise<void> {
    if (this.#track === null || this.#stream === null) return;
    const vivos = new Set(
      chaves.map((k) => k.toLowerCase()).filter((k) => k !== this.#euHex),
    );

    for (const par of vivos) {
      if (this.#espectadores.has(par)) continue;
      const envio = await this.#malha.enviarTrilha(par, this.#track, this.#stream);
      if (envio === null) continue;
      this.#espectadores.set(par, { envio, quality: this.#qualityBase });
      await envio.definirBitrateKbps(SHARE_QUALITY_KBPS[this.#qualityBase]);
      log(`espectador ${par.slice(0, 8)} servido · ${this.#qualityBase}`);
    }

    for (const [par, e] of [...this.#espectadores]) {
      if (vivos.has(par)) continue;
      this.#espectadores.delete(par);
      await e.envio.encerrar().catch(() => undefined);
      log(`espectador ${par.slice(0, 8)} saiu`);
    }
  }

  /**
   * `share.health` chegou do núcleo (§15.5, só ao apresentador). O `quality` de cada
   * espectador é o veredito do host: o perfil que ELE pediu por `share.setQuality`, já
   * passado pela degradação automática de §17.5. Aplicá-lo no `RTCRtpSender` daquele
   * espectador é o que torna a qualidade por espectador real — e o que fecha `F-08`/`V-13`.
   */
  async aplicarSaude(viewers: readonly ShareViewerHealthDto[]): Promise<void> {
    for (const v of viewers) {
      const e = this.#espectadores.get(v.key.toLowerCase());
      if (e === undefined || e.quality === v.quality) continue;
      e.quality = v.quality;
      await e.envio.definirBitrateKbps(SHARE_QUALITY_KBPS[v.quality]).catch(() => undefined);
      const perda = v.lossPct === undefined ? "sem medida" : `${v.lossPct.toFixed(1)}% de perda`;
      log(`espectador ${v.key.slice(0, 8)} · perfil agora ${v.quality} (${perda})`);
    }
  }

  /** §15.4 papel espectador — pedir um perfil para a tela que EU assisto. */
  async pedirQualidade(sessionId: string, quality: ShareQualityDto): Promise<boolean> {
    const r = await this.#porta.setQuality({ sessionId, quality });
    log(`share.setQuality ${quality} → applied=${r.applied}`);
    return r.applied;
  }

  /** §15.4 — entrar como espectador de uma sessão que outra pessoa abriu. */
  async assistir(sessionId: string): Promise<{ presenterKey: string }> {
    log(`share.join na sessão ${sessionId}`);
    const r = await this.#porta.join({ sessionId });
    log(`share.join ok · apresentador ${r.presenterKey.slice(0, 8)}`);
    return { presenterKey: r.presenterKey };
  }

  /** Encerra a apresentação: para a captura, os envios e a sessão no host. */
  async parar(): Promise<void> {
    const sessionId = this.#sessionId;
    this.#pararMedicao();
    for (const [, e] of this.#espectadores) await e.envio.encerrar().catch(() => undefined);
    this.#espectadores.clear();
    if (this.#track !== null) this.#track.onended = null;
    for (const t of this.#stream?.getTracks() ?? []) t.stop();
    this.#stream = null;
    this.#track = null;
    this.#sessionId = null;
    await this.#captura.declararSessao({ sessionId: null, kind: "screen" }).catch(() => undefined);
    if (sessionId !== null) {
      await this.#porta.stop({ sessionId }).catch(() => undefined);
      log(`sessão ${sessionId} encerrada`);
    }
  }

  /**
   * A cadência de §17.6: a cada 2 s, mede cada envio e **relata ao núcleo**
   * (`share.report`). Quem consolida e decide degradar é o host, que é quem sabe o perfil
   * que cada espectador pediu; o veredito volta por `share.health`.
   */
  #iniciarMedicao(): void {
    this.#pararMedicao();
    this.#relogio = setInterval(() => void this.medirERelatar(), CADENCIA_DE_SAUDE_MS);
  }

  #pararMedicao(): void {
    if (this.#relogio !== null) clearInterval(this.#relogio);
    this.#relogio = null;
  }

  /** Um ciclo de medição. Exposto para o teste não depender de temporizador de parede. */
  async medirERelatar(): Promise<void> {
    const sessionId = this.#sessionId;
    if (sessionId === null || this.#espectadores.size === 0) return;
    const samples: Array<{ viewerKey: string; rttMs: number; lossPct: number }> = [];
    const locais: ShareViewerHealthDto[] = [];
    for (const [par, e] of this.#espectadores) {
      const s = await e.envio.estatisticas().catch(() => null);
      if (s === null) continue;
      samples.push({ viewerKey: par, rttMs: s.rttMs, lossPct: s.lossPct });
      locais.push({ key: par, rttMs: s.rttMs, lossPct: s.lossPct, quality: e.quality });
    }
    if (samples.length === 0) return;
    // A UI do apresentador não espera o round-trip para mostrar número: o que ela mostra é
    // o que ESTA máquina mediu. O que volta do host é o veredito de PERFIL, não a medida.
    this.#eventos.aoMedir?.(locais);
    await this.#porta.report({ sessionId, samples }).catch((e: unknown) => {
      log("share.report falhou — a amostra desta volta se perde (§16.3 regra 1)", e);
    });
  }
}
