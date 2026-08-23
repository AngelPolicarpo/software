import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { Hash } from "lucide-react";
import { MessageRow } from "./MessageRow";
import {
  MESSAGE_GROUP_WINDOW_MS,
  formatDaySeparator,
  isSameDay,
} from "../../lib/format";
import { useChannelMessages, useThreadRoots } from "../../store/messageStore";
import { useBans } from "../../store/moderationStore";
import { useUiStore } from "../../store/uiStore";
import type { Channel, Message } from "../../domain/types";

/** Separador de data — muda o dia (§6). */
function DaySeparator({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-3 px-4" role="separator">
      <span className="h-px flex-1 bg-border-default" aria-hidden="true" />
      <span className="text-caption text-text-tertiary uppercase">{label}</span>
      <span className="h-px flex-1 bg-border-default" aria-hidden="true" />
    </div>
  );
}

/** Divisor "Novas mensagens" — onde a leitura parou (§6). */
function UnreadDivider() {
  return (
    <div className="mt-4 flex items-center px-4" role="separator">
      <span className="h-px flex-1 bg-feedback-danger" aria-hidden="true" />
      <span className="ml-2 rounded-sm bg-feedback-danger px-1.5 py-px text-caption text-text-on-accent">
        Novas mensagens
      </span>
    </div>
  );
}

/** §9, 2.1 — canal sem histórico nenhum. */
function ChannelEmptyState({ channel }: { channel: Channel }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-12 text-center">
      <span
        className="grid size-16 place-items-center rounded-full bg-surface-elevated text-text-secondary"
        aria-hidden="true"
      >
        <Hash size={32} strokeWidth={1.5} />
      </span>
      <h2 className="mt-6 text-heading-1 text-text-primary">
        Este é o início de #{channel.name}
      </h2>
      <p className="mt-2 max-w-[420px] text-body text-text-secondary">
        Ninguém enviou mensagem neste canal ainda.
      </p>
    </div>
  );
}

/**
 * Uma mensagem começa um bloco novo quando muda o autor, passam 5 min,
 * vira o dia, ela responde outra mensagem, ou um divisor a separa da
 * anterior (§9, 2.1). Mensagem fixada também fica sozinha: a superfície
 * dela é outra, e agrupar misturaria dois fundos no mesmo bloco.
 */
function startsNewGroup(
  message: Message,
  previous: Message | undefined,
  dividerBetween: boolean,
): boolean {
  if (!previous || dividerBetween) return true;
  if (previous.authorId !== message.authorId) return true;
  if (message.replyToId !== undefined) return true;
  if (message.pinned || previous.pinned) return true;

  const gap =
    new Date(message.timestamp).getTime() -
    new Date(previous.timestamp).getTime();
  return gap >= MESSAGE_GROUP_WINDOW_MS;
}

export interface MessageListProps {
  channel: Channel;
  readOnly: boolean;
  onReply: (message: Message) => void;
}

/**
 * Lista de mensagens em modo leitura (§9, 2.1) — scroll cronológico, com
 * scroll-to-bottom ao entrar no canal. Composer, reações, toolbar de hover e
 * thread entram com o restante de 2.1/2.2.
 */
export function MessageList({ channel, readOnly, onReply }: MessageListProps) {
  const allMessages = useChannelMessages(channel.id);
  const bans = useBans(channel.communityId);
  // §11, D12 passo 3: banir remove as mensagens da pessoa do canal.
  const messages = useMemo(() => {
    if (bans.length === 0) return allMessages;
    const banned = new Set(bans.map((ban) => ban.identityId));
    return allMessages.filter((message) => !banned.has(message.authorId));
  }, [allMessages, bans]);
  const threadRoots = useThreadRoots();
  const highlightedId = useUiStore((state) => state.highlightedMessageId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Ao entrar no canal e a cada mensagem nova, a leitura vai para o fim.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [channel.id, messages.length]);

  // Chegando por busca, a mensagem alvo entra em vista (§11, C10 passo 4).
  useEffect(() => {
    if (!highlightedId) return;
    document
      .getElementById(`msg-${highlightedId}`)
      ?.scrollIntoView({ block: "center" });
  }, [highlightedId, channel.id]);

  const byId = new Map(messages.map((message) => [message.id, message]));
  // Quantas mensagens cada thread tem; a raiz é uma delas (§9, 2.2).
  const threadSizes = new Map<string, number>();
  for (const message of messages) {
    if (!message.threadId) continue;
    threadSizes.set(
      message.threadId,
      (threadSizes.get(message.threadId) ?? 0) + 1,
    );
  }

  const rows: ReactNode[] = [];
  let previous: Message | undefined;

  for (const message of messages) {
    const date = new Date(message.timestamp);
    const newDay =
      previous === undefined || !isSameDay(date, new Date(previous.timestamp));
    const unreadHere = channel.firstUnreadMessageId === message.id;

    if (newDay) {
      rows.push(
        <DaySeparator key={`day-${message.id}`} label={formatDaySeparator(date)} />,
      );
    }
    if (unreadHere) rows.push(<UnreadDivider key={`unread-${message.id}`} />);

    rows.push(
      <MessageRow
        key={message.id}
        message={message}
        communityId={channel.communityId}
        groupStart={startsNewGroup(message, previous, newDay || unreadHere)}
        repliedTo={message.replyToId ? byId.get(message.replyToId) : undefined}
        readOnly={readOnly}
        onReply={onReply}
        threadReplies={
          message.threadId &&
          threadRoots.get(message.threadId) === message.id
            ? (threadSizes.get(message.threadId) ?? 1) - 1
            : 0
        }
      />,
    );

    previous = message;
  }

  return (
    <div ref={scrollRef} className="flex flex-1 flex-col overflow-y-auto pb-4">
      {messages.length === 0 ? (
        <ChannelEmptyState channel={channel} />
      ) : (
        // Histórico curto encosta na base, como em qualquer chat — é de lá
        // que a leitura começa e é lá que o composer vai encostar.
        <div className="mt-auto">{rows}</div>
      )}
    </div>
  );
}
