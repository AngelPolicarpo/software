import { useEffect, useRef, useState } from "react";
import {
  Maximize2,
  Minimize2,
  Monitor,
  Star,
  TriangleAlert,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { Tooltip } from "../../components/ui/Tooltip";
import { useFindMember } from "../../store/communityStore";
import { SHARE_MAX_VIEWERS } from "../../ipc/api";
import {
  useShareHealth,
  useVoiceStore,
  type ActiveShare,
  type ShareQuality,
} from "../../store/voiceStore";
import { telaDoApresentador, telaRecebida } from "../../live/telaStreams";

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
  const setQuality = useVoiceStore((state) => state.setQuality);
  const retryShare = useVoiceStore((state) => state.retryShare);
  const saude = useShareHealth();

  const [fullscreen, setFullscreen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
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
    const stream = isPresenter
      ? telaDoApresentador()
      : telaRecebida(share.presenterId);
    if (stream === null) return;
    el.srcObject = stream;
    void el.play().catch(() => undefined);
    return () => {
      el.srcObject = null;
    };
  }, [isPresenter, share.presenterId, share.phase]);

  const aoVivo = share.phase === "live";

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
          // O apresentador não ouve a própria tela; quem assiste ouve o que vier junto.
          muted={isPresenter}
          aria-label={
            isPresenter
              ? "Sua tela, como os outros a veem"
              : `Tela de ${presenterName}`
          }
          className={cn("h-full w-full bg-black object-contain", !aoVivo && "hidden")}
        />

        <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1.5">
          <span className="relative inline-flex items-center gap-1.5 rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-secondary">
            <Star size={16} strokeWidth={2} aria-hidden="true" />
            Transmissão direta
          </span>

          {/* §17.5 — a UI exibe o teto, que é constante de protocolo. */}
          <Tooltip
            label={`Até ${SHARE_MAX_VIEWERS} espectadores por transmissão`}
            side="top"
          >
            <span className="rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-secondary">
              {share.viewerCount}/{SHARE_MAX_VIEWERS}{" "}
              {share.viewerCount === 1 ? "espectador" : "espectadores"}
            </span>
          </Tooltip>

          {isPresenter && share.sourceLabel !== "" && (
            <span className="rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-tertiary">
              {share.sourceLabel}
            </span>
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
          <div className="relative">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setQualityOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={qualityOpen}
            >
              Qualidade: {QUALITY_LABEL[share.quality]}
            </Button>
            <Menu
              open={qualityOpen}
              onClose={() => setQualityOpen(false)}
              side="bottom-end"
              items={(Object.keys(QUALITY_LABEL) as ShareQuality[]).map(
                (quality) => ({
                  id: quality,
                  label: QUALITY_LABEL[quality],
                  onSelect: () => setQuality(quality),
                }),
              )}
            />
          </div>

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
