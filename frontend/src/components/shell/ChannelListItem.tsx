import { BellOff, Hash, MoreHorizontal, Volume2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { ChannelContextMenu } from "./ChannelContextMenu";
import { useContextMenu } from "./useContextMenu";
import { findMember } from "../../mocks/dataset";
import {
  useIsInVoiceChannel,
  useVoiceChannelParticipantIds,
} from "../../store/voiceStore";
import type { Channel } from "../../domain/types";

export interface ChannelListItemProps {
  channel: Channel;
  active: boolean;
  /** Só canal de texto troca a área de conteúdo (§4). */
  onSelect?: () => void;
  /** Canal de voz: entra na chamada sem trocar o conteúdo (§4, 2.3). */
  onJoinVoice?: () => void;
  /** §10, 3.4 — habilita os itens de gestão no menu de contexto. */
  canManage?: boolean;
  hostOnline?: boolean;
}

/**
 * Item de lista de canal (§6) — todos os estados obrigatórios:
 * default, hover, ativo (`accent-muted-bg`), não-lido (texto mais claro +
 * dot), menção pendente (badge numérico `feedback-danger`), silenciado
 * (ícone mudo, sem destaque de não-lido) e canal de voz com gente dentro
 * (avatares dos participantes inline abaixo do nome).
 *
 * Canal de voz é o ponto de entrada de 2.3: clicar entra na chamada e abre a
 * grade **por cima** do conteúdo — o canal de texto aberto continua onde
 * estava (§4). Por isso o item nunca fica "ativo": ele não é o que a área de
 * conteúdo está mostrando.
 */
export function ChannelListItem({
  channel,
  active,
  onSelect,
  onJoinVoice,
  canManage = false,
  hostOnline = true,
}: ChannelListItemProps) {
  const menu = useContextMenu();
  const isVoice = channel.type === "voice";
  // A fixture diz como o canal nasce; a chamada em curso sobrepõe, senão a
  // lista não mostraria a identidade local depois que ela entra.
  const participantIds = useVoiceChannelParticipantIds(channel);
  const inThisCall = useIsInVoiceChannel(channel.id);
  // Silenciado perde o destaque de não-lido, nunca a menção (§6).
  const unread = channel.unreadCount > 0 && !channel.muted;

  const ChannelIcon = isVoice ? Volume2 : Hash;

  const content = (
    <>
      <ChannelIcon
        size={20}
        strokeWidth={2}
        className="shrink-0 text-text-tertiary"
        aria-hidden="true"
      />

      <span className="min-w-0 flex-1 truncate text-left">{channel.name}</span>

      {unread && <span className="sr-only">Mensagens não lidas</span>}

      {channel.muted && (
        <BellOff
          size={16}
          strokeWidth={2}
          role="img"
          aria-label="Silenciado"
          className="shrink-0 text-text-tertiary"
        />
      )}

      {isVoice && participantIds.length > 0 && (
        <Badge tone="live">AO VIVO</Badge>
      )}

      {channel.pendingMentions > 0 && (
        <Badge
          count={channel.pendingMentions}
          srLabel={`${channel.pendingMentions} menção pendente`}
        />
      )}
    </>
  );

  const rowClass = cn(
    "flex h-8 w-full items-center gap-1.5 rounded-md px-2",
    "transition-colors duration-(--duration-fast) ease-out",
    active
      ? "bg-accent-muted-bg text-text-primary"
      : unread || inThisCall
        ? "text-text-primary"
        : channel.muted
          ? "text-text-tertiary"
          : "text-text-secondary",
    unread && !active && "text-body-emphasis",
    !active && "hover:bg-surface-primary hover:text-text-primary",
  );

  return (
    <li
      className="group relative"
      onContextMenu={(event) => {
        event.preventDefault();
        menu.show();
      }}
    >
      {/* Dot de não-lido na borda da lista, fora do retângulo do item ativo
          para os dois estados nunca se sobreporem (§6). */}
      {unread && (
        <span
          className="pointer-events-none absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-text-primary"
          aria-hidden="true"
        />
      )}

      <button
        type="button"
        onClick={isVoice ? onJoinVoice : onSelect}
        aria-current={active ? "true" : undefined}
        className={rowClass}
      >
        {content}
      </button>

      {/*
        Caminho equivalente ao botão direito (§19.4): teclado e toque chegam
        ao mesmo menu pelo "⋯", que aparece no hover e no foco. Fica sobre a
        borda direita, cobrindo os badges — como no gênero.
      */}
      <button
        type="button"
        onClick={menu.toggle}
        aria-label={`Opções de ${channel.name}`}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        className={cn(
          "absolute top-0 right-1 hidden size-8 place-items-center rounded-md",
          "bg-surface-sidebar text-text-secondary",
          "hover:bg-surface-primary hover:text-text-primary",
          "group-hover:grid focus-visible:grid",
          menu.open && "grid",
          active && "bg-accent-muted-bg",
        )}
      >
        <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
      </button>

      <ChannelContextMenu
        channel={channel}
        canManage={canManage}
        hostOnline={hostOnline}
        open={menu.open}
        onClose={menu.close}
      />

      {isVoice && participantIds.length > 0 && (
        <ul className="mt-0.5 mb-1 flex flex-wrap items-center gap-1 pr-2 pl-9">
          {participantIds.map((identityId) => {
            const member = findMember(channel.communityId, identityId);
            if (!member) return null;
            return (
              <li key={identityId}>
                <Avatar
                  name={member.displayName}
                  color={member.avatarColor}
                  size="sm"
                />
                <span className="sr-only">{member.displayName}</span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
