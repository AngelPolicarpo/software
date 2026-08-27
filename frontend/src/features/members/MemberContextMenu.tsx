import { useState } from "react";
import { Ban, Mic, MicOff, Timer, User, UserMinus } from "lucide-react";
import { Menu } from "../../components/ui/Menu";
import type { MenuItem, MenuProps } from "../../components/ui/Menu";
import {
  selectCanModerate,
  useCommunityStore,
  useFindMember,
  useHasPermission,
  useLocalMemberId,
  useMemberLabel,
} from "../../store/communityStore";
import { useVoiceStore } from "../../store/voiceStore";
import {
  ModerationDialog,
  type ModerationKind,
} from "../moderation/ModerationDialog";

const ICON = 16;

export interface MemberContextMenuProps {
  communityId: string;
  identityId: string;
  open: boolean;
  onClose: () => void;
  /**
   * Aberto de dentro de uma chamada em que os dois estão (§9, 2.3) — é o que
   * libera "silenciar nesta chamada" (§8, 1.4).
   */
  inCall?: boolean;
  /** "Ver perfil" abre o popover de 1.4 — o gatilho continua sendo do chamador. */
  onOpenProfile: () => void;
  side?: MenuProps["side"];
}

/**
 * §6 — menu de contexto de **membro**, o irmão do menu de canal.
 *
 * O popover de perfil (§8, 1.4) segue sendo a superfície completa: cargos,
 * data de entrada, atribuir cargo e o slider de volume, que não cabem numa
 * lista de itens. O menu é o atalho para as ações de um clique só, e por isso
 * abre com "Ver perfil" — que é também o caminho equivalente exigido por
 * §19.4, já disponível no clique esquerdo para quem não tem botão direito.
 *
 * Item que a permissão ou a hierarquia não autoriza **não aparece**, nunca
 * desabilitado (§15). Quem decide de fato é o fold: a tela só deixa de
 * oferecer o que já sabe que seria recusado.
 */
export function MemberContextMenu({
  communityId,
  identityId,
  open,
  onClose,
  inCall = false,
  onOpenProfile,
  side = "bottom",
}: MemberContextMenuProps) {
  const findMember = useFindMember();
  const member = findMember(communityId, identityId);
  const label = useMemberLabel(communityId, identityId);
  const localMemberId = useLocalMemberId(communityId);

  const canModerate = useCommunityStore((state) =>
    selectCanModerate(state, communityId, identityId),
  );
  const canKick = useHasPermission(communityId, "kick_members");
  const canBan = useHasPermission(communityId, "ban_members");
  const canTimeout = useHasPermission(communityId, "timeout_members");
  const canMuteOthers = useHasPermission(communityId, "voice_mute_others");

  const isSelf = identityId === localMemberId;
  const participantMuted = useVoiceStore((state) =>
    Boolean(state.participants.find((p) => p.identityId === identityId)?.muted),
  );
  const setParticipantMuted = useVoiceStore(
    (state) => state.setParticipantMuted,
  );

  const [moderation, setModeration] = useState<ModerationKind | null>(null);

  const items: MenuItem[] = [
    {
      id: "profile",
      label: "Ver perfil",
      icon: <User size={ICON} strokeWidth={2} />,
      onSelect: onOpenProfile,
    },
  ];

  if (inCall && !isSelf && canMuteOthers)
    items.push({
      id: "mute",
      label: participantMuted
        ? "Reativar microfone nesta chamada"
        : "Silenciar nesta chamada",
      description: participantMuted
        ? undefined
        : "Vale só enquanto a chamada durar",
      icon: participantMuted ? (
        <Mic size={ICON} strokeWidth={2} />
      ) : (
        <MicOff size={ICON} strokeWidth={2} />
      ),
      onSelect: () => setParticipantMuted(identityId, !participantMuted),
    });

  if (canModerate) {
    if (canTimeout)
      items.push({
        id: "timeout",
        label: "Aplicar timeout",
        icon: <Timer size={ICON} strokeWidth={2} />,
        onSelect: () => setModeration("timeout"),
      });
    if (canKick)
      items.push({
        id: "kick",
        label: "Expulsar",
        icon: <UserMinus size={ICON} strokeWidth={2} />,
        danger: true,
        onSelect: () => setModeration("kick"),
      });
    if (canBan)
      items.push({
        id: "ban",
        label: "Banir",
        icon: <Ban size={ICON} strokeWidth={2} />,
        danger: true,
        onSelect: () => setModeration("ban"),
      });
  }

  return (
    <>
      <Menu open={open} onClose={onClose} items={items} side={side} />

      {/* Fica fora do `Menu` de propósito: o menu fecha ao escolher o item, e
          o modal precisa continuar de pé depois disso. */}
      {moderation && member && (
        <ModerationDialog
          kind={moderation}
          communityId={communityId}
          targetId={identityId}
          targetLabel={label || member.displayName}
          byId={localMemberId}
          onClose={() => setModeration(null)}
        />
      )}
    </>
  );
}
