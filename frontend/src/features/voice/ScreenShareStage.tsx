import { useRef, useState } from "react";
import {
  ChevronDown,
  Maximize2,
  Minimize2,
  Monitor,
  Network,
  Star,
  TriangleAlert,
  Waves,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { Tooltip } from "../../components/ui/Tooltip";
import { TreeHealthPopover } from "./TreeHealthPopover";
import { findMember } from "../../mocks/dataset";
import {
  useMyRelayCount,
  useVoiceStore,
  type ActiveShare,
  type ShareQuality,
} from "../../store/voiceStore";

const QUALITY_LABEL: Record<ShareQuality, string> = {
  auto: "Automática",
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
 * Compartilhamento de tela/vídeo (§9, 2.4) — sub-modo do canal de voz, nunca
 * tela irmã.
 *
 * É a parte mais diferenciadora da arquitetura: topologia estrela vs. árvore
 * (`CLAUDE.md:12-19`), fallback TURN visível, reparo de árvore e o badge de
 * quem está retransmitindo. Toda transição de estado usa banner
 * não-bloqueante no topo do tile — nunca um modal que interrompe a
 * visualização.
 *
 * O mock não captura tela de verdade: o tile mostra a fonte escolhida no
 * seletor simulado, e diz que é simulação em vez de fingir um vídeo.
 */
export function ScreenShareStage({
  communityId,
  share,
  isPresenter,
}: ScreenShareStageProps) {
  const stopShare = useVoiceStore((state) => state.stopShare);
  const setQuality = useVoiceStore((state) => state.setQuality);
  const retryShare = useVoiceStore((state) => state.retryShare);
  const myRelayCount = useMyRelayCount();

  const [fullscreen, setFullscreen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [treeAnchor, setTreeAnchor] = useState<DOMRect | null>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);

  const presenter = findMember(communityId, share.presenterId);
  const presenterName = presenter?.displayName ?? "Participante";
  const isTree = share.topology === "tree";
  const repairing = share.treeHealth === "repairing";
  /** §9, 2.4.2 — só o apresentador expande o badge, e só em modo árvore. */
  const badgeInteractive = isPresenter && isTree;

  const topologyBadge = (
    <>
      {isTree ? (
        <Network size={16} strokeWidth={2} aria-hidden="true" />
      ) : (
        <Star size={16} strokeWidth={2} aria-hidden="true" />
      )}
      {isTree ? "Retransmissão em árvore" : "Transmissão direta"}
      {badgeInteractive && (
        <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
      )}
      {/* Painel fechado durante o reparo: dot pulsante sobre o ícone, convite
          discreto para abrir — sem toast nem modal (§9, 2.4.2). */}
      {badgeInteractive && repairing && treeAnchor === null && (
        <span
          className="absolute -top-0.5 -left-0.5 size-2 animate-conn-pulse rounded-full bg-conn-reconnecting"
          aria-hidden="true"
        />
      )}
    </>
  );

  const badgeClass = cn(
    "relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
    "border-border-default bg-surface-app/80 text-meta text-text-secondary",
    badgeInteractive &&
      "hover:border-border-strong hover:text-text-primary transition-colors duration-(--duration-fast) ease-out",
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col gap-2",
        fullscreen ? "fixed inset-0 z-50 bg-surface-app p-4" : "min-h-0 flex-1",
      )}
    >
      {/* Banners de transição — sempre no topo do tile, nunca modais. */}
      {share.phase === "optimizing" && (
        <StatusBanner tone="reconnecting" inset>
          Otimizando distribuição…
        </StatusBanner>
      )}
      {repairing && (
        <StatusBanner tone="reconnecting" inset>
          Reorganizando transmissão…
        </StatusBanner>
      )}
      {isPresenter &&
        share.viewerIds.length === 0 &&
        share.phase === "live" && (
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
              Falha ao conectar à transmissão
            </p>
            <Button variant="secondary" size="sm" onClick={retryShare}>
              Tentar novamente
            </Button>
          </div>
        )}

        {(share.phase === "live" || share.phase === "optimizing") && (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <Monitor
              size={24}
              strokeWidth={2}
              aria-hidden="true"
              className="text-text-tertiary"
            />
            <p className="text-body-emphasis text-text-primary">
              {isPresenter
                ? `Você está compartilhando · ${share.sourceLabel}`
                : `Tela de ${presenterName} · ${share.sourceLabel}`}
            </p>
            <p className="text-meta text-text-tertiary">
              Transmissão simulada — o mock não captura tela de verdade
            </p>
          </div>
        )}

        {/* Faixa de informação sobre o tile: topologia, espectadores,
            qualidade e o fallback TURN quando ativo (§9, 2.4). */}
        <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1.5">
          {badgeInteractive ? (
            <button
              ref={badgeRef}
              type="button"
              onClick={() =>
                setTreeAnchor((current) =>
                  current
                    ? null
                    : (badgeRef.current?.getBoundingClientRect() ?? null),
                )
              }
              aria-expanded={treeAnchor !== null}
              className={badgeClass}
            >
              {topologyBadge}
            </button>
          ) : (
            <span className={badgeClass}>{topologyBadge}</span>
          )}

          <span className="rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-secondary">
            {share.viewerIds.length}{" "}
            {share.viewerIds.length === 1 ? "espectador" : "espectadores"}
          </span>

          {share.usingTurnFallback && (
            <Tooltip
              label="Conexão direta bloqueada por NAT restritivo — usando retransmissão"
              side="top"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-conn-degraded">
                <Waves size={16} strokeWidth={2} aria-hidden="true" />
                Via TURN
              </span>
            </Tooltip>
          )}
        </div>

        {/* §9, 2.4 — só aparece para quem de fato está repassando. */}
        {myRelayCount !== null && (
          <span className="absolute bottom-2 left-2 rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-secondary">
            Você está retransmitindo para {myRelayCount}{" "}
            {myRelayCount === 1 ? "pessoa" : "pessoas"}
          </span>
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
      </div>

      {treeAnchor && (
        <TreeHealthPopover
          communityId={communityId}
          relays={share.firstLevelRelays}
          anchor={treeAnchor}
          onClose={() => setTreeAnchor(null)}
        />
      )}
    </div>
  );
}
