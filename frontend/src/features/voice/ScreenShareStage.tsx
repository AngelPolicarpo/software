import { useEffect, useRef, useState } from "react";
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
import { TransmissionSettings } from "./TransmissionSettings";

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

  const [fullscreen, setFullscreen] = useState(false);
  const [ajustes, setAjustes] = useState<DOMRect | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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
  // um `srcObject` novo não a reaplica.
  useEffect(() => {
    const el = videoRef.current;
    if (el === null) return;
    el.volume = Math.max(0, Math.min(100, volume)) / 100;
  }, [volume, share.phase]);

  const aoVivo = share.phase === "live";
  // Ocultar é do espectador: o apresentador nunca esconde a própria conferência.
  const exibindo = aoVivo && (isPresenter || !oculto);

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

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-border-default bg-surface-app">
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
            <Button variant="secondary" size="sm" onClick={retryShare}>
              Tentar novamente
            </Button>
          </div>
        )}

        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- transmissão ao vivo de tela não tem faixa de legenda */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
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

        <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1.5">
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
          <div className="absolute bottom-2 left-2 flex flex-col gap-1">
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

        <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
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
