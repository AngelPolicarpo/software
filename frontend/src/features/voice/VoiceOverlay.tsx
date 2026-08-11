import { useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  Monitor,
  MonitorUp,
  PhoneOff,
  Settings,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { Tooltip } from "../../components/ui/Tooltip";
import { ProfilePopover } from "../members/ProfilePopover";
import { ScreenShareStage } from "./ScreenShareStage";
import { ShareSourceModal } from "./ShareSourceModal";
import { LeaveVoiceConfirm } from "./LeaveVoiceConfirm";
import { useLeaveVoiceGuard } from "./leaveGuard";
import { VoiceTile, VoiceTileSkeleton } from "./VoiceTile";
import { useIsMobile } from "../../lib/useMediaQuery";
import { findMember } from "../../mocks/dataset";
import {
  selectChannel,
  selectCommunity,
  useCommunityStore,
  useHasPermission,
} from "../../store/communityStore";
import { useVoiceStore } from "../../store/voiceStore";

interface ControlProps {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  pressed?: boolean;
  tone?: "default" | "warning" | "danger";
  /** Destino que só existe na Camada 3 — visível e inativo (precedente §6). */
  inert?: boolean;
}

/**
 * Botão da barra de controles (§5.7: ícones de 24px nas ações primárias da
 * chamada). Sempre com nome acessível — o ícone sozinho não nomeia nada.
 */
function Control({
  label,
  icon,
  onClick,
  pressed,
  tone = "default",
  inert = false,
}: ControlProps) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        onClick={inert ? undefined : onClick}
        aria-pressed={pressed}
        aria-disabled={inert || undefined}
        className={cn(
          "grid size-11 place-items-center rounded-full",
          "transition-colors duration-(--duration-fast) ease-out",
          tone === "danger"
            ? "bg-feedback-danger text-text-on-accent hover:brightness-110"
            : tone === "warning"
              ? "bg-surface-elevated text-feedback-danger hover:bg-surface-primary"
              : "bg-surface-elevated text-text-secondary hover:bg-surface-primary hover:text-text-primary",
          inert && "cursor-not-allowed text-text-disabled",
        )}
      >
        {icon}
        <span className="sr-only">{label}</span>
      </button>
    </Tooltip>
  );
}

/**
 * 2.3 Canal de voz — grade de participantes, fala ativa, mute/deafen e
 * entrar/sair, com o compartilhamento de tela (2.4) como sub-modo.
 *
 * Abre **por cima** da área de conteúdo, sem trocá-la: entrar em voz não
 * muda o canal de texto que estava aberto (§4, C11). Recolher devolve a
 * barra persistente (2.3.1) sem encerrar a chamada.
 */
export function VoiceOverlay() {
  const channelId = useVoiceStore((state) => state.channelId);
  const communityId = useVoiceStore((state) => state.communityId);
  const localId = useVoiceStore((state) => state.localId);
  const stage = useVoiceStore((state) => state.stage);
  const participants = useVoiceStore((state) => state.participants);
  const share = useVoiceStore((state) => state.share);
  const retryJoin = useVoiceStore((state) => state.retryJoin);
  const setExpanded = useVoiceStore((state) => state.setExpanded);
  const toggleMute = useVoiceStore((state) => state.toggleMute);
  const toggleDeafen = useVoiceStore((state) => state.toggleDeafen);
  const toggleCamera = useVoiceStore((state) => state.toggleCamera);
  const startShare = useVoiceStore((state) => state.startShare);
  const stopShare = useVoiceStore((state) => state.stopShare);

  const channel = useCommunityStore((state) =>
    channelId ? selectChannel(state, channelId) : undefined,
  );
  const community = useCommunityStore((state) =>
    selectCommunity(state, communityId),
  );
  const activeCommunityId = useCommunityStore(
    (state) => state.activeCommunityId,
  );
  const canShareScreen = useHasPermission(
    communityId ?? "",
    "voice_share_screen",
  );

  const [profile, setProfile] = useState<
    { identityId: string; anchor: DOMRect } | null
  >(null);
  const [choosingSource, setChoosingSource] = useState(false);
  const guard = useLeaveVoiceGuard();
  const isMobile = useIsMobile();

  if (!channel || !community || !communityId || !localId) return null;

  const local = participants.find((p) => p.identityId === localId);
  const sharing = Boolean(local?.sharingScreen);
  const connecting = stage === "connecting";

  // §9, 2.3 — um peer que não conecta comigo mas conecta com os outros: a
  // chamada segue, e a interface diz de quem se trata em vez de deixar a
  // pessoa parecer calada (§11, B7).
  const unstable = participants.find(
    (p) => p.identityId !== localId && p.connectionToMe !== "ok",
  );
  const unstableName = unstable
    ? (findMember(communityId, unstable.identityId)?.displayName ?? "um peer")
    : null;

  /** Mobile: lista vertical compacta; acima de 4, carrossel horizontal. */
  const carousel = isMobile && participants.length > 4;

  const tiles = connecting
    ? participants.map((participant) => (
        <VoiceTileSkeleton key={participant.identityId} compact={isMobile} />
      ))
    : participants.map((participant) => (
        <VoiceTile
          key={participant.identityId}
          communityId={communityId}
          participant={participant}
          isLocal={participant.identityId === localId}
          compact={isMobile || share !== null}
          onOpenProfile={(identityId, anchor) =>
            setProfile({ identityId, anchor })
          }
        />
      ));

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-surface-primary">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md",
            "text-text-secondary transition-colors duration-(--duration-fast) ease-out",
            "hover:bg-surface-sidebar hover:text-text-primary",
          )}
        >
          {isMobile ? (
            <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
          ) : (
            <ChevronDown size={20} strokeWidth={2} aria-hidden="true" />
          )}
          <span className="sr-only">Recolher chamada</span>
        </button>

        <Volume2
          size={20}
          strokeWidth={2}
          aria-hidden="true"
          className="shrink-0 text-text-tertiary"
        />
        <h2 className="min-w-0 truncate text-heading-3 text-text-primary">
          {channel.name}
        </h2>
        {/* Só quando a chamada é de outra comunidade — na própria seria
            informação redundante (mesma regra de 2.3.1). */}
        {communityId !== activeCommunityId && (
          <span className="min-w-0 truncate text-meta text-text-tertiary">
            · {community.name}
          </span>
        )}
      </header>

      {stage === "failed" && (
        <StatusBanner tone="failed">
          Não foi possível conectar à chamada de voz
          <Button
            variant="ghost"
            size="sm"
            className="ml-1 h-6 px-1.5"
            onClick={retryJoin}
          >
            Tentar novamente
          </Button>
        </StatusBanner>
      )}

      {stage === "connected" && unstableName && (
        <StatusBanner tone="degraded">
          Conexão instável com {unstableName}
        </StatusBanner>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {connecting && (
          <p className="text-meta text-text-tertiary">Conectando…</p>
        )}

        {share && communityId && (
          <ScreenShareStage
            communityId={communityId}
            share={share}
            isPresenter={share.presenterId === localId}
          />
        )}

        <ul
          className={cn(
            share
              ? // Tira de miniaturas ao lado do compartilhamento (§9, 2.4).
                "flex shrink-0 gap-2 overflow-x-auto"
              : carousel
                ? "flex gap-2 overflow-x-auto"
                : "flex flex-col gap-2 tablet:grid tablet:grid-cols-2 desktop:grid-cols-3",
          )}
        >
          {tiles}
        </ul>

        {/* §18 — sozinha na chamada, sem placeholder vazio estranho. */}
        {!connecting && participants.length === 1 && !share && (
          <p className="text-meta text-text-tertiary">
            Convide alguém pra {channel.name}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-border-subtle p-3">
        <Control
          label={local?.muted ? "Ativar microfone" : "Silenciar microfone"}
          pressed={local?.muted}
          tone={local?.muted ? "warning" : "default"}
          onClick={toggleMute}
          icon={
            local?.muted ? (
              <MicOff size={24} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Mic size={24} strokeWidth={2} aria-hidden="true" />
            )
          }
        />
        <Control
          label={local?.deafened ? "Reativar áudio" : "Ensurdecer"}
          pressed={local?.deafened}
          tone={local?.deafened ? "warning" : "default"}
          onClick={toggleDeafen}
          icon={
            local?.deafened ? (
              <HeadphoneOff size={24} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Headphones size={24} strokeWidth={2} aria-hidden="true" />
            )
          }
        />
        <Control
          label={local?.cameraOn ? "Desligar câmera" : "Ligar câmera"}
          pressed={local?.cameraOn}
          onClick={toggleCamera}
          icon={
            local?.cameraOn ? (
              <Video size={24} strokeWidth={2} aria-hidden="true" />
            ) : (
              <VideoOff size={24} strokeWidth={2} aria-hidden="true" />
            )
          }
        />
        {canShareScreen && (
          <Control
            label={sharing ? "Parar compartilhamento" : "Compartilhar tela"}
            pressed={sharing}
            onClick={() =>
              sharing ? stopShare() : setChoosingSource(true)
            }
            icon={
              sharing ? (
                <Monitor size={24} strokeWidth={2} aria-hidden="true" />
              ) : (
                <MonitorUp size={24} strokeWidth={2} aria-hidden="true" />
              )
            }
          />
        )}
        <Control
          label="Configurações de dispositivo"
          inert
          icon={<Settings size={24} strokeWidth={2} aria-hidden="true" />}
        />
        <Control
          label="Sair da chamada"
          tone="danger"
          onClick={guard.requestLeave}
          icon={<PhoneOff size={24} strokeWidth={2} aria-hidden="true" />}
        />
      </div>

      {profile && (
        <ProfilePopover
          communityId={communityId}
          identityId={profile.identityId}
          anchor={profile.anchor}
          onClose={() => setProfile(null)}
          inCall
        />
      )}

      {choosingSource && (
        <ShareSourceModal
          onClose={() => setChoosingSource(false)}
          onSelect={(sourceLabel) => {
            setChoosingSource(false);
            startShare(sourceLabel);
          }}
        />
      )}

      <LeaveVoiceConfirm guard={guard} />
    </div>
  );
}
