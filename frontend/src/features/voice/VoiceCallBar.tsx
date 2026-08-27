import { Mic, MicOff, PhoneOff } from "lucide-react";
import { cn } from "../../lib/cn";
import { Avatar } from "../../components/ui/Avatar";
import { LeaveVoiceConfirm } from "./LeaveVoiceConfirm";
import { useLeaveVoiceGuard } from "./leaveGuard";
import { selectChannel, selectCommunity, useCommunityStore, useFindMember } from "../../store/communityStore";
import { useVoiceStore } from "../../store/voiceStore";
import type { VoiceParticipant } from "../../domain/types";

/** §9, 2.3.1 — no máximo 3 avatares visíveis; o resto vira badge "+N". */
const MAX_STACK = 3;

interface StackProps {
  communityId: string;
  participants: VoiceParticipant[];
}

/**
 * Miniatura de quem está na chamada. A barra recolhida é com frequência a
 * única indicação visual de quem está dentro — a chamada pode ser de uma
 * comunidade que nem está aberta, e aí a lista de participantes do canal de
 * voz (§6) não está visível.
 */
function ParticipantStack({ communityId, participants }: StackProps) {
  const findMember = useFindMember();
  const visible = participants.slice(0, MAX_STACK);
  const overflow = participants.length - visible.length;

  return (
    <span className="flex shrink-0 items-center">
      {visible.map((participant, index) => {
        const member = findMember(communityId, participant.identityId);
        return (
          <Avatar
            key={participant.identityId}
            name={member?.displayName ?? "Participante"}
            color={member?.avatarColor ?? "role-neutral"}
            size="sm"
            // Anel de fala ativa também aqui (§9, 2.3.1): mesma cor e mesmo
            // pulse do tile expandido, só escalados.
            speaking={participant.speaking}
            className={cn(
              "rounded-full ring-2 ring-surface-elevated",
              index > 0 && "-ml-1.5",
            )}
          />
        );
      })}

      {overflow > 0 && (
        // O badge de overflow nunca recebe anel: não representa uma pessoa.
        <span
          className={cn(
            // Sem sobreposição e sem anel: o "+" era mordido pelo avatar
            // vizinho e o contador aparecia como "-1" na tela.
            "ml-1 grid place-items-center rounded-full px-1",
            "bg-surface-primary text-caption text-text-secondary tabular-nums",
            "h-6 min-w-6",
          )}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}

interface BarControlProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  danger?: boolean;
  /** Mobile: alvo de toque de 44px mesmo com ícone menor (§9, 2.3.1). */
  touch?: boolean;
}

function BarControl({
  label,
  icon,
  onClick,
  pressed,
  danger = false,
  touch = false,
}: BarControlProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        "grid shrink-0 place-items-center rounded-md",
        "transition-colors duration-(--duration-fast) ease-out",
        touch ? "size-11" : "size-6",
        danger
          ? "text-feedback-danger hover:bg-surface-primary"
          : pressed
            ? "text-feedback-danger hover:bg-surface-primary"
            : "text-text-secondary hover:bg-surface-primary hover:text-text-primary",
      )}
    >
      {icon}
      <span className="sr-only">{label}</span>
    </button>
  );
}

/**
 * 2.3.1 Barra de chamada persistente — **só Mobile**.
 *
 * Representação compacta da mesma sessão de 2.3, fixa no rodapé da viewport e
 * viva mesmo navegando outra comunidade (§11, C11). No Desktop/Tablet quem faz
 * este papel é o `VoicePanel`, acima da barra de usuário; aqui não existe
 * coluna da esquerda ao lado do conteúdo (§16), então a barra continua sendo
 * uma camada própria sobre as três telas empilhadas.
 */
export function VoiceCallBar() {
  const channelId = useVoiceStore((state) => state.channelId);
  const communityId = useVoiceStore((state) => state.communityId);
  const localId = useVoiceStore((state) => state.localId);
  const expanded = useVoiceStore((state) => state.expanded);
  const participants = useVoiceStore((state) => state.participants);
  const setExpanded = useVoiceStore((state) => state.setExpanded);
  const toggleMute = useVoiceStore((state) => state.toggleMute);

  const channel = useCommunityStore((state) =>
    channelId ? selectChannel(state, channelId) : undefined,
  );
  const community = useCommunityStore((state) =>
    selectCommunity(state, communityId),
  );
  const activeCommunityId = useCommunityStore(
    (state) => state.activeCommunityId,
  );
  const guard = useLeaveVoiceGuard();

  if (!channel || !community || !communityId || expanded) return null;

  const local = participants.find((p) => p.identityId === localId);
  // Sufixo só quando a chamada é de outra comunidade — na própria, seria
  // informação redundante (§9, 2.3.1).
  const otherCommunity =
    communityId !== activeCommunityId ? community.name : null;

  const expandLabel = `Expandir chamada em ${channel.name}`;

  return (
    <>
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex h-16 items-center gap-3",
          "border-t border-border-subtle bg-surface-elevated p-3",
          "tablet:hidden",
        )}
      >
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ParticipantStack
            communityId={communityId}
            participants={participants}
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-body-emphasis text-text-primary">
              {channel.name}
            </span>
            {otherCommunity && (
              <span className="truncate text-meta text-text-tertiary">
                {otherCommunity}
              </span>
            )}
          </span>
          <span className="sr-only">{expandLabel}</span>
        </button>

        {/* Só mudo e sair: ensurdecer/câmera/compartilhar ficam na vista
            expandida, para não lotar a barra de alvos pequenos. */}
        <BarControl
          touch
          label={local?.muted ? "Ativar microfone" : "Silenciar microfone"}
          pressed={local?.muted}
          onClick={toggleMute}
          icon={
            local?.muted ? (
              <MicOff size={20} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Mic size={20} strokeWidth={2} aria-hidden="true" />
            )
          }
        />
        <BarControl
          touch
          danger
          label="Sair da chamada"
          onClick={guard.requestLeave}
          icon={<PhoneOff size={20} strokeWidth={2} aria-hidden="true" />}
        />
      </div>

      <LeaveVoiceConfirm guard={guard} />
    </>
  );
}
