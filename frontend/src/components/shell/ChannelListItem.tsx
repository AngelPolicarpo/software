import { BellOff, Hash, Volume2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { findMember } from "../../mocks/dataset";
import type { Channel } from "../../domain/types";

export interface ChannelListItemProps {
  channel: Channel;
  active: boolean;
  /** Só canal de texto troca a área de conteúdo (§4). */
  onSelect?: () => void;
}

/**
 * Item de lista de canal (§6) — todos os estados obrigatórios:
 * default, hover, ativo (`accent-muted-bg`), não-lido (texto mais claro +
 * dot), menção pendente (badge numérico `feedback-danger`), silenciado
 * (ícone mudo, sem destaque de não-lido) e canal de voz com gente dentro
 * (avatares dos participantes inline abaixo do nome).
 *
 * Canal de voz não é clicável aqui: entrar numa chamada não troca a área de
 * conteúdo (§4) — quem responde por isso é 2.3, que ainda não existe.
 */
export function ChannelListItem({
  channel,
  active,
  onSelect,
}: ChannelListItemProps) {
  const isVoice = channel.type === "voice";
  const participantIds = channel.voiceParticipantIds ?? [];
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
      : unread
        ? "text-text-primary"
        : channel.muted
          ? "text-text-tertiary"
          : "text-text-secondary",
    unread && !active && "text-body-emphasis",
    !active && !isVoice && "hover:bg-surface-primary hover:text-text-primary",
  );

  return (
    <li className="relative">
      {/* Dot de não-lido na borda da lista, fora do retângulo do item ativo
          para os dois estados nunca se sobreporem (§6). */}
      {unread && (
        <span
          className="pointer-events-none absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-text-primary"
          aria-hidden="true"
        />
      )}

      {isVoice ? (
        <div className={rowClass}>{content}</div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          aria-current={active ? "true" : undefined}
          className={rowClass}
        >
          {content}
        </button>
      )}

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
