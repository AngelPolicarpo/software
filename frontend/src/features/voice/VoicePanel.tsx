import { useState } from "react";
import { Monitor, MonitorUp, PhoneOff, Video, VideoOff, Volume2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { Tooltip } from "../../components/ui/Tooltip";
import { LeaveVoiceConfirm } from "./LeaveVoiceConfirm";
import { ShareSourceModal } from "./ShareSourceModal";
import { useLeaveVoiceGuard } from "./leaveGuard";
import {
  selectChannel,
  selectCommunity,
  useCommunityStore,
  useHasPermission,
} from "../../store/communityStore";
import { useVoiceStore } from "../../store/voiceStore";

interface WideButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  pressed: boolean;
}

/** Ação larga da chamada: ícone + rótulo, os dois lados a mesma largura. */
function WideButton({ label, icon, onClick, pressed }: WideButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        "flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2",
        "text-meta transition-colors duration-(--duration-fast) ease-out",
        pressed
          ? "bg-accent-muted-bg text-text-primary"
          : "bg-surface-primary text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * §9, 2.3.1 — painel da chamada em curso, logo acima da barra de usuário
 * (§8, 1.1) e com a mesma largura dela.
 *
 * Substituiu a barra de chamada persistente de duas linhas: mudo e ensurdecer
 * saíram daqui porque agora moram na barra de usuário e valem fora da chamada
 * — repeti-los 8px acima seria o mesmo interruptor duas vezes na mesma coluna.
 * Fica o que só existe **enquanto há chamada**: de onde ela é, sair dela, e as
 * duas ações que produzem mídia (câmera e tela).
 *
 * Continua sendo a superfície que sobrevive à navegação (§11, C11): a chamada
 * pode ser de uma comunidade que nem está aberta, e este painel é o que diz
 * isso — por isso o nome da comunidade aparece quando ela não é a ativa.
 */
export function VoicePanel() {
  const channelId = useVoiceStore((state) => state.channelId);
  const communityId = useVoiceStore((state) => state.communityId);
  const localId = useVoiceStore((state) => state.localId);
  const expanded = useVoiceStore((state) => state.expanded);
  const participants = useVoiceStore((state) => state.participants);
  const setExpanded = useVoiceStore((state) => state.setExpanded);
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
  // §15: ação que a permissão não autoriza não aparece — nunca desabilitada.
  const canShareScreen = useHasPermission(
    communityId ?? "",
    "voice_share_screen",
  );

  const [choosingSource, setChoosingSource] = useState(false);
  const guard = useLeaveVoiceGuard();

  if (!channel || !community || !communityId || expanded) return null;

  const local = participants.find((p) => p.identityId === localId);
  const sharing = Boolean(local?.sharingScreen);
  // Sufixo só quando a chamada é de outra comunidade — na própria seria
  // informação redundante.
  const otherCommunity =
    communityId !== activeCommunityId ? community.name : null;

  return (
    <>
      <div
        className={cn(
          "hidden shrink-0 flex-col gap-2 p-2",
          "border-t border-border-subtle bg-surface-sidebar",
          "tablet:flex",
        )}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex min-w-0 flex-1 items-center gap-1 rounded-md p-1 text-left hover:bg-surface-primary"
          >
            <Volume2
              size={14}
              strokeWidth={2}
              aria-hidden="true"
              className="shrink-0 text-conn-ok"
            />
            <span className="truncate text-body-emphasis text-text-primary">
              {channel.name}
            </span>
            {otherCommunity && (
              <span className="min-w-0 truncate text-meta text-text-tertiary">
                · {otherCommunity}
              </span>
            )}
            <span className="sr-only">Expandir chamada em {channel.name}</span>
          </button>

          <Tooltip label="Sair da chamada" side="top">
            <button
              type="button"
              onClick={guard.requestLeave}
              aria-label="Sair da chamada"
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-md",
                "text-feedback-danger transition-colors duration-(--duration-fast) ease-out",
                "hover:bg-feedback-danger/15",
              )}
            >
              <PhoneOff size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2">
          <WideButton
            label={local?.cameraOn ? "Desligar câmera" : "Câmera"}
            pressed={Boolean(local?.cameraOn)}
            onClick={toggleCamera}
            icon={
              local?.cameraOn ? (
                <Video size={16} strokeWidth={2} aria-hidden="true" />
              ) : (
                <VideoOff size={16} strokeWidth={2} aria-hidden="true" />
              )
            }
          />
          {canShareScreen && (
            <WideButton
              label={sharing ? "Parar tela" : "Tela"}
              pressed={sharing}
              onClick={() => (sharing ? stopShare() : setChoosingSource(true))}
              icon={
                sharing ? (
                  <Monitor size={16} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <MonitorUp size={16} strokeWidth={2} aria-hidden="true" />
                )
              }
            />
          )}
        </div>
      </div>

      {choosingSource && (
        <ShareSourceModal
          onClose={() => setChoosingSource(false)}
          onSelect={({ kind, quality, sourceId, audio }) => {
            setChoosingSource(false);
            startShare({ kind, quality, sourceId, audio });
          }}
        />
      )}

      <LeaveVoiceConfirm guard={guard} />
    </>
  );
}
