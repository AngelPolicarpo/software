import { AlertTriangle, Clock, CornerUpLeft, Pin } from "lucide-react";
import { cn } from "../../lib/cn";
import { Avatar } from "../../components/ui/Avatar";
import { AttachmentCard } from "./AttachmentCard";
import { MessageContent } from "./MessageContent";
import {
  formatClock,
  formatFullTimestamp,
  formatMessageTimestamp,
} from "../../lib/format";
import { ROLE_TEXT_CLASS } from "../../lib/role";
import { findMember } from "../../mocks/dataset";
import {
  selectCommunity,
  selectHighestRole,
  useCommunityStore,
} from "../../store/communityStore";
import { useMessageStore } from "../../store/messageStore";
import type { Message } from "../../domain/types";

/** Nome de autor colorido pelo cargo mais alto do membro (§5.4, §9 2.1.1). */
function useAuthorLabel(communityId: string, identityId: string) {
  const member = findMember(communityId, identityId);
  const highestRole = useCommunityStore((state) =>
    member ? selectHighestRole(state, member.roleIds) : undefined,
  );

  return {
    name: member?.nickname ?? member?.displayName ?? "Membro desconhecido",
    avatarColor: member?.avatarColor ?? "role-neutral",
    nameClass: highestRole
      ? ROLE_TEXT_CLASS[highestRole.color]
      : "text-text-primary",
  };
}

function ReplyPreview({
  communityId,
  repliedTo,
}: {
  communityId: string;
  repliedTo: Message;
}) {
  const author = useAuthorLabel(communityId, repliedTo.authorId);

  return (
    <p className="mb-0.5 flex min-w-0 items-center gap-1 text-meta text-text-secondary">
      <CornerUpLeft
        size={12}
        strokeWidth={2}
        aria-hidden="true"
        className="shrink-0 text-text-tertiary"
      />
      <span className="shrink-0">respondendo a</span>
      <span className={cn("shrink-0 font-semibold", author.nameClass)}>
        {author.name}
      </span>
      <span className="truncate text-text-tertiary">{repliedTo.content}</span>
    </p>
  );
}

/**
 * §6 — estados de entrega da linha de mensagem. "Enviando" é só opacidade
 * reduzida; fila offline e falha ganham uma linha explicando o que houve,
 * porque nenhum ícone sozinho diz "sua mensagem ainda não saiu daqui".
 */
function DeliveryStatus({
  message,
  communityId,
}: {
  message: Message;
  communityId: string;
}) {
  const retrySend = useMessageStore((state) => state.retrySend);
  const communityName = useCommunityStore(
    (state) => selectCommunity(state, communityId)?.name ?? "o host",
  );

  if (message.deliveryState === "queued") {
    return (
      <p className="mt-0.5 flex items-center gap-1 text-meta text-text-tertiary">
        <Clock size={12} strokeWidth={2} aria-hidden="true" />
        Pendente — será enviada quando {communityName} voltar
      </p>
    );
  }

  if (message.deliveryState === "failed") {
    return (
      <p className="mt-0.5 flex items-center gap-1 text-meta text-feedback-danger">
        <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
        Não foi possível enviar
        <button
          type="button"
          onClick={() => retrySend(message.channelId, message.id)}
          className="ml-1 underline underline-offset-2 hover:text-text-primary"
        >
          Tentar novamente
        </button>
      </p>
    );
  }

  return null;
}

export interface MessageRowProps {
  message: Message;
  communityId: string;
  /** Primeira mensagem do bloco — só ela repete avatar, nome e carimbo (§9, 2.1). */
  groupStart: boolean;
  /** Mensagem respondida, quando esta é uma resposta inline. */
  repliedTo?: Message;
}

/**
 * Linha de mensagem (§6) em modo leitura.
 *
 * Mensagens consecutivas do mesmo autor dentro de 5 min não repetem avatar
 * nem nome; a hora aparece na medianiz no hover. Fixada ganha o rótulo
 * "Fixado" e uma superfície um degrau acima (§5.1 — hierarquia por
 * luminância). A barra de ações de hover e as reações entram com 2.1 completa.
 */
export function MessageRow({
  message,
  communityId,
  groupStart,
  repliedTo,
}: MessageRowProps) {
  const author = useAuthorLabel(communityId, message.authorId);
  const timestamp = new Date(message.timestamp);

  return (
    <article
      className={cn(
        "group relative flex gap-3 px-4 py-0.5",
        "transition-colors duration-(--duration-fast) ease-out",
        groupStart && "mt-4 first:mt-0",
        message.pinned
          ? "bg-surface-elevated/40"
          : "hover:bg-surface-elevated/30",
        // Enviando: opacidade reduzida até a confirmação (§6, §11 C9).
        message.deliveryState === "sending" && "opacity-60",
      )}
    >
      <div className="w-8 shrink-0">
        {groupStart ? (
          <Avatar
            name={author.name}
            color={author.avatarColor}
            size="md"
            className="mt-0.5"
          />
        ) : (
          <span
            className="hidden text-caption tabular-nums text-text-tertiary group-hover:block"
            title={formatFullTimestamp(timestamp)}
          >
            {formatClock(timestamp)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {message.pinned && (
          <p className="flex items-center gap-1 text-caption text-text-tertiary">
            <Pin size={12} strokeWidth={2} aria-hidden="true" />
            Fixado
          </p>
        )}

        {repliedTo && (
          <ReplyPreview communityId={communityId} repliedTo={repliedTo} />
        )}

        {groupStart && (
          <p className="flex items-baseline gap-2">
            <span
              className={cn("text-body-emphasis", author.nameClass)}
            >
              {author.name}
            </span>
            <span
              className="text-meta text-text-tertiary"
              title={formatFullTimestamp(timestamp)}
            >
              {formatMessageTimestamp(timestamp)}
            </span>
          </p>
        )}

        <MessageContent message={message} communityId={communityId} />

        {message.attachments.map((attachment) => (
          <AttachmentCard
            key={attachment.id}
            attachment={attachment}
            uploading={message.deliveryState === "sending"}
          />
        ))}

        <DeliveryStatus message={message} communityId={communityId} />
      </div>
    </article>
  );
}
