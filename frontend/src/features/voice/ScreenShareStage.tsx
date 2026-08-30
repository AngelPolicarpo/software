import { useCallback, useEffect, useRef, useState } from "react";
import {
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Monitor,
  Settings2,
  Star,
  TriangleAlert,
  Volume2,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Popover } from "../../components/ui/Popover";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { Tooltip } from "../../components/ui/Tooltip";
import { useFindMember } from "../../store/communityStore";
import {
  useLocalParticipant,
  useShareHealth,
  useVoiceStore,
  type ActiveShare,
  type ShareQuality,
} from "../../store/voiceStore";
import { telaDoApresentador, telaRecebida } from "../../live/telaStreams";
import { useSettingsStore } from "../../store/settingsStore";
import { TransmissionSettings } from "./TransmissionSettings";

/**
 * Quanto tempo os controles ficam sobre a imagem depois do último movimento.
 *
 * Assistir é o modo normal desta tela, e o que se assiste está **debaixo** dos botões: o
 * chip de espectadores cobre o canto de cima, a fileira de ações cobre o de baixo, e nada
 * disso some. Numa apresentação de slides ou num editor, é justamente onde o conteúdo mora.
 *
 * Três segundos é o intervalo em que a mão parada já significa "estou vendo, não mexendo".
 */
const CONTROLES_SOMEM_EM_MS = 3_000;

/** §17.5 — os três perfis normativos. Não existe "auto": a degradação é do sistema. */
const QUALITY_LABEL: Record<ShareQuality, string> = {
  high: "Alta",
  balanced: "Equilibrada",
  low: "Baixa",
};

export interface ScreenShareStageProps {
  communityId: string;
  share: ActiveShare;
  isPresenter: boolean;
}

/**
 * Compartilhamento de tela (§17.5) — sub-modo do canal de voz, nunca tela irmã.
 *
 * **A topologia é estrela e só estrela** (A19/A20). Saíram desta tela, com B26: o seletor
 * de topologia (`Transmissão direta` vs `Retransmissão em árvore`), o `TreeHealthPopover`,
 * o banner "Otimizando distribuição…", o banner de reparo e o badge "Você está
 * retransmitindo para N pessoas". Todos descreviam a árvore de §17.8, que está **fora do
 * v1** — anunciá-los seria prometer um caminho que o produto não tem.
 *
 * Saiu também o selo **"Via TURN"**: §17.3 diz que tela via TURN é *recusada* no v1. Não é
 * um fallback que a UI possa mostrar, porque não é um fallback que exista.
 *
 * O vídeo é real: `<video>` ligado ao `MediaStream` que a estrela entregou.
 */
export function ScreenShareStage({
  communityId,
  share,
  isPresenter,
}: ScreenShareStageProps) {
  const findMember = useFindMember();
  const stopShare = useVoiceStore((state) => state.stopShare);
  const retryShare = useVoiceStore((state) => state.retryShare);
  const alternarVideoRecebido = useVoiceStore((state) => state.alternarVideoRecebido);
  // §17.5 — ocultar é por sessão: com duas telas no canal, esconder uma não diz nada
  // sobre a outra.
  const oculto = share.oculto;
  const saude = useShareHealth();
  /**
   * §9 (2.3) — ensurdecer é enforcement local e vale para **tudo** o que entra, não só para
   * a voz. Quando uma tela passou a poder trazer som (§17.5), este elemento virou uma
   * segunda saída de áudio: sem esta linha, quem ensurdeceu continuava ouvindo o som da
   * transmissão alheia, que é exatamente o que o botão promete calar.
   */
  const surdo = useLocalParticipant()?.deafened ?? false;
  /**
   * O volume que esta máquina deu a quem apresenta (§9, 2.3). Vale para o som da tela pelo
   * mesmo motivo do surdo: baixar alguém para 0% e continuar ouvindo a transmissão dele
   * seria o controle acender e não fazer nada.
   */
  const volume = useVoiceStore((state) => state.volumeById[share.presenterId] ?? 100);
  // §10, 3.1 (B47) — a saída e o volume GERAIS desta máquina (o que ela ouve).
  const outputId = useSettingsStore((state) => state.outputId);
  const outputVolume = useSettingsStore((state) => state.outputVolume);

  const [fullscreen, setFullscreen] = useState(false);
  const [ajustes, setAjustes] = useState<DOMRect | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [controles, setControles] = useState(true);
  const relogio = useRef<number | undefined>(undefined);
  /**
   * O ponteiro está parado **em cima** da fileira de ações.
   *
   * Sem isto, mirar um botão e hesitar um segundo o fazia sumir debaixo do cursor: parar de
   * mexer é o sinal de "estou vendo", mas parar de mexer sobre um botão é o oposto disso.
   * É `ref` e não estado porque nada renderiza a partir dele — quem renderiza é `controles`.
   */
  const sobreControles = useRef(false);

  const presenter = findMember(communityId, share.presenterId);
  const presenterName = presenter?.displayName ?? "Participante";

  /**
   * O `MediaStream` mora fora do React (`live/telaStreams`): ele precisa sobreviver a
   * re-render, e um `srcObject` recriado a cada render pisca a imagem. O apresentador vê o
   * que captura; quem assiste vê o que chegou pela malha.
   */
  useEffect(() => {
    const el = videoRef.current;
    if (el === null) return;
    // §17.5 — quem assiste pode ocultar. Soltar o `srcObject` é o que de fato para a
    // decodificação e a pintura desta máquina; deixar o elemento escondido por CSS
    // continuaria decodificando quadro a quadro para ninguém.
    if (!isPresenter && oculto) {
      el.srcObject = null;
      return;
    }
    const stream = isPresenter
      ? telaDoApresentador()
      : telaRecebida(share.presenterId);
    if (stream === null) return;
    el.srcObject = stream;
    void el.play().catch(() => undefined);
    return () => {
      el.srcObject = null;
    };
  }, [isPresenter, oculto, share.presenterId, share.phase]);

  // Propriedade do elemento, não atributo: `volume` não existe como prop do `<video>` e
  // um `srcObject` novo não a reaplica. O volume GERAL de saída (§10, 3.1, B47) multiplica
  // o volume por participante — é o que faz o slider de ajustes valer também para o som da
  // tela, que toca no `<video>` e não nos `<audio>` da voz.
  useEffect(() => {
    const el = videoRef.current;
    if (el === null) return;
    el.volume = Math.max(0, Math.min(100, volume * (outputVolume / 100))) / 100;
  }, [volume, outputVolume, share.phase]);

  // §10, 3.1 (B47) — a SAÍDA de áudio escolhida em ajustes vale para o som da tela também:
  // sem o `setSinkId`, o `<video>` tocava sempre no dispositivo padrão do sistema.
  useEffect(() => {
    const el = videoRef.current;
    if (el === null || typeof el.setSinkId !== "function") return;
    if ((el.dataset.sinkId ?? "default") === outputId) return;
    el.dataset.sinkId = outputId;
    void el
      .setSinkId(outputId === "default" ? "" : outputId)
      .catch(() => undefined);
  }, [outputId, share.phase]);

  const aoVivo = share.phase === "live";
  // Ocultar é do espectador: o apresentador nunca esconde a própria conferência.
  const exibindo = aoVivo && (isPresenter || !oculto);

  /**
   * Os controles só somem quando há **imagem** para eles cobrirem, e nunca enquanto o
   * popover de ajustes está aberto — some-lo debaixo do próprio menu seria puxar o tapete
   * de quem está usando.
   *
   * "Preparando…", a falha com "Tentar novamente" e o vídeo ocultado são o oposto: ali os
   * botões são o conteúdo, e escondê-los deixaria a pessoa sem saída.
   */
  const podeSumir = exibindo && ajustes === null;

  const acordar = useCallback(() => {
    setControles(true);
    window.clearTimeout(relogio.current);
    if (!podeSumir || sobreControles.current) return;
    relogio.current = window.setTimeout(() => setControles(false), CONTROLES_SOMEM_EM_MS);
  }, [podeSumir]);

  // O relógio recomeça a cada mudança do que o torna possível: sair do popover ou a imagem
  // chegar precisa armá-lo, e o contrário precisa desarmá-lo na hora.
  useEffect(() => {
    acordar();
    return () => window.clearTimeout(relogio.current);
  }, [acordar]);

  /**
   * §17.5 — sair da tela cheia pelo Esc. Sem isto o único jeito de voltar era achar o botão
   * "Reduzir", que é exatamente o que acabou de sumir com o resto dos controles: a pessoa
   * ficava presa numa tela sem saída visível, apertando a tecla que o resto do sistema
   * inteiro usa para isto.
   */
  useEffect(() => {
    if (!fullscreen) return;
    const aoTeclar = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setFullscreen(false);
    };
    window.addEventListener("keydown", aoTeclar, true);
    return () => window.removeEventListener("keydown", aoTeclar, true);
  }, [fullscreen]);

  /**
   * Sumir é por opacidade, não por desmontagem: o `<video>` não pode remontar (perderia o
   * `srcObject`) e os botões precisam continuar existindo para o foco de teclado poder
   * trazê-los de volta. `pointer-events-none` enquanto invisíveis evita o clique cego —
   * quem toca na tela para reaparecer não pode apertar um botão que não estava vendo.
   */
  const camada = cn(
    "transition-opacity duration-(--duration-base) ease-out",
    controles ? "opacity-100" : "pointer-events-none opacity-0",
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col gap-2",
        fullscreen ? "fixed inset-0 z-50 bg-surface-app p-4" : "min-h-0 flex-1",
      )}
    >
      {isPresenter && share.viewerCount === 0 && aoVivo && (
        <StatusBanner tone="offline" inset>
          Ninguém está assistindo agora
        </StatusBanner>
      )}

      <div
        // Mexer o ponteiro é o gesto que traz os controles de volta; sair da área os
        // dispensa na hora, sem esperar o relógio. `onFocusCapture` é a metade de teclado:
        // um botão invisível que recebe foco precisa aparecer, senão o Tab passa por
        // controles que ninguém vê.
        onPointerMove={acordar}
        onPointerDown={acordar}
        onPointerLeave={() => podeSumir && setControles(false)}
        onFocusCapture={acordar}
        className={cn(
          "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-border-default bg-surface-app",
          // Em tela cheia o ponteiro parado também vira sujeira sobre a imagem.
          fullscreen && !controles && "cursor-none",
        )}
      >
        {share.phase === "starting" && (
          <p className="text-body text-text-secondary">
            Preparando compartilhamento…
          </p>
        )}

        {share.phase === "failed" && (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <TriangleAlert
              size={24}
              strokeWidth={2}
              aria-hidden="true"
              className="text-conn-failed"
            />
            <p className="text-body text-text-primary">
              {share.motivoDaFalha ?? "Falha ao conectar à transmissão"}
            </p>
            {/*
              Apresentador repete a captura; espectador repete o `share.join`. Quem decide é
              o store, e o que este botão precisa dizer é **qual** transmissão — sem o id,
              com duas telas no canal, ele agia sempre sobre a minha.
            */}
            <Button variant="secondary" size="sm" onClick={() => retryShare(share.sessionId)}>
              Tentar novamente
            </Button>
          </div>
        )}

        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- transmissão ao vivo de tela não tem faixa de legenda */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          // O gesto que todo reprodutor de vídeo tem, e que aqui passou a fazer falta: com
          // os controles sumindo sozinhos, o duplo clique é o caminho para tela cheia que
          // não depende de achar um botão. Fica no `<video>`, não no contêiner, para não
          // disparar quando alguém clica duas vezes num botão da barra.
          onDoubleClick={() => setFullscreen((v) => !v)}
          // O apresentador não ouve a própria tela (seria eco da própria máquina); quem
          // assiste ouve o que vier junto, a menos que tenha ensurdecido.
          muted={isPresenter || surdo}
          aria-label={
            isPresenter
              ? "Sua tela, como os outros a veem"
              : `Tela de ${presenterName}`
          }
          className={cn("h-full w-full bg-black object-contain", !exibindo && "hidden")}
        />

        {/* Ocultado por quem assiste: o lugar do vídeo diz por que está vazio. */}
        {aoVivo && !exibindo && (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <EyeOff size={24} strokeWidth={2} aria-hidden="true" className="text-text-tertiary" />
            <p className="text-body text-text-secondary">Vídeo oculto</p>
            <p className="text-meta text-text-tertiary">
              {presenterName} continua transmitindo — só você deixou de ver
              {share.comAudio ? " e de ouvir" : ""}.
            </p>
          </div>
        )}

        <div className={cn("absolute top-2 left-2 flex flex-wrap items-center gap-1.5", camada)}>
          <span className="relative inline-flex items-center gap-1.5 rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-secondary">
            <Star size={16} strokeWidth={2} aria-hidden="true" />
            Transmissão direta
          </span>

          {/*
            §90 — o chip perdeu o denominador porque o teto deixou de existir. Continua
            dizendo QUANTOS assistem, que é a informação de que quem apresenta precisa;
            o "de 8" prometia uma vaga que ninguém mais conta.
          */}
          <Tooltip label="Quem está na chamada pode assistir" side="top">
            <span className="rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-secondary">
              {share.viewerCount}{" "}
              {share.viewerCount === 1 ? "espectador" : "espectadores"}
            </span>
          </Tooltip>

          {isPresenter && share.sourceLabel !== "" && (
            <span className="rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-tertiary">
              {share.sourceLabel}
            </span>
          )}

          {/*
            §17.5 — o som só é anunciado quando a captura o ENTREGOU. Pedir áudio e
            recebê-lo são coisas diferentes: onde a plataforma não separa o som da fonte, a
            transmissão sobe muda, e um selo dizendo o contrário mandaria a pessoa procurar
            defeito na conexão de quem assiste.
          */}
          {isPresenter && aoVivo && share.comAudio && (
            <Tooltip label="O som da fonte vai junto com a imagem" side="top">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-secondary">
                <Volume2 size={16} strokeWidth={2} aria-hidden="true" />
                Com áudio
              </span>
            </Tooltip>
          )}
        </div>

        {/*
          §17.5 — a saúde por espectador, só para quem apresenta (RT-08). São números
          MEDIDOS neste renderer e consolidados pelo núcleo; nada aqui é estimativa.
        */}
        {isPresenter && saude.length > 0 && (
          <div className={cn("absolute bottom-2 left-2 flex flex-col gap-1", camada)}>
            {saude.map((v) => (
              <span
                key={v.key}
                className="rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-secondary"
              >
                {findMember(communityId, v.key)?.displayName ?? v.key.slice(0, 8)} ·{" "}
                {/* Ainda não medido: "—" em vez de um zero que parece medida. */}
                {v.rttMs === undefined ? "—" : `${Math.round(v.rttMs)} ms`} ·{" "}
                {v.lossPct === undefined ? "—" : `${v.lossPct.toFixed(1)}%`} ·{" "}
                {QUALITY_LABEL[v.quality]}
              </span>
            ))}
          </div>
        )}

        <div
          onPointerEnter={() => {
            sobreControles.current = true;
            acordar();
          }}
          onPointerLeave={() => {
            sobreControles.current = false;
            acordar();
          }}
          className={cn("absolute right-2 bottom-2 flex items-center gap-1.5", camada)}
        >
          {/*
            §17.5 — **os controles da transmissão são de quem transmite.** Resolução, taxa
            de quadros e perfil de qualidade decidem o que sai da máquina do apresentador e
            quanto do upload dele é consumido; quem assiste não tem como pagar essa conta
            nem como ver o que está sendo capturado.

            Antes, o seletor de qualidade aparecia para os dois lados — e para o espectador
            ele era o comando de §15.4 no papel antigo, que mandava no envio alheio.
          */}
          {isPresenter && aoVivo && (
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => setAjustes(e.currentTarget.getBoundingClientRect())}
              aria-haspopup="dialog"
              aria-expanded={ajustes !== null}
              leadingIcon={<Settings2 size={16} strokeWidth={2} aria-hidden="true" />}
            >
              Transmissão
            </Button>
          )}

          {/*
            §17.5 — e o de quem ASSISTE é um só: parar de exibir. Local, reversível e sem
            efeito sobre a transmissão de ninguém.
          */}
          {!isPresenter && aoVivo && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => alternarVideoRecebido(share.sessionId)}
              aria-pressed={oculto}
              leadingIcon={
                oculto ? (
                  <Eye size={16} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <EyeOff size={16} strokeWidth={2} aria-hidden="true" />
                )
              }
            >
              {oculto ? "Mostrar vídeo" : "Ocultar vídeo"}
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setFullscreen((value) => !value)}
            leadingIcon={
              fullscreen ? (
                <Minimize2 size={16} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Maximize2 size={16} strokeWidth={2} aria-hidden="true" />
              )
            }
          >
            {fullscreen ? "Reduzir" : "Tela cheia"}
          </Button>

          {isPresenter && (
            <Button variant="danger" size="sm" onClick={stopShare}>
              Parar compartilhamento
            </Button>
          )}
        </div>

        {ajustes !== null && (
          <Popover
            anchor={ajustes}
            onClose={() => setAjustes(null)}
            label="Ajustes da transmissão"
            placement="below"
            width={288}
          >
            <TransmissionSettings onClose={() => setAjustes(null)} />
          </Popover>
        )}

        {!aoVivo && share.phase !== "starting" && share.phase !== "failed" && (
          <Monitor
            size={24}
            strokeWidth={2}
            aria-hidden="true"
            className="text-text-tertiary"
          />
        )}
      </div>
    </div>
  );
}
