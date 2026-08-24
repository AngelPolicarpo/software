import { useMemo, useState } from "react";
import { PinOff } from "lucide-react";
import { cn } from "../../lib/cn";
import { Avatar } from "../../components/ui/Avatar";
import { SlidePanel } from "../../components/ui/SlidePanel";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { Tabs } from "../../components/ui/Tabs";
import { formatFileSize, formatMessageTimestamp } from "../../lib/format";
import { useCommunityStore, useFindMember, useHasPermission } from "../../store/communityStore";
import { useHostStatus } from "../../store/connectionStore";
import { useChannelMessages, useMessageStore } from "../../store/messageStore";
import { useUiStore } from "../../store/uiStore";
import type {
  Attachment,
  Channel,
  Community,
  Message,
} from "../../domain/types";

/** URLs dentro do corpo da mensagem — a aba Links sai daqui. */
const URL_PATTERN = /https?:\/\/[^\s<>"')]+/g;

interface LinkEntry {
  url: string;
  host: string;
  message: Message;
}

function EmptyState({ children }: { children: string }) {
  return <p className="px-4 py-6 text-body text-text-tertiary">{children}</p>;
}

interface EntryHeaderProps {
  communityId: string;
  message: Message;
}

function EntryHeader({ communityId, message }: EntryHeaderProps) {
  const findMember = useFindMember();
  const member = findMember(communityId, message.authorId);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar
        name={member?.displayName ?? "Alguém"}
        color={member?.avatarColor ?? "role-neutral"}
        size="sm"
      />
      <span className="min-w-0 truncate text-body-emphasis text-text-primary">
        {member?.displayName ?? "Alguém"}
      </span>
      <span className="shrink-0 text-meta text-text-tertiary">
        {formatMessageTimestamp(new Date(message.timestamp))}
      </span>
    </span>
  );
}

export interface ChannelInfoPanelProps {
  community: Community;
  channel: Channel;
  onClose: () => void;
}

/**
 * 2.1.2 Painel do canal — Fixados / Arquivos / Links.
 *
 * Dá destino ao ato de fixar e superfície ao acervo do canal: até esta parte,
 * fixar uma mensagem não levava a lugar nenhum, e o `Attachment` de §2 só
 * existia dentro da mensagem onde foi postado.
 */
export function ChannelInfoPanel({
  community,
  channel,
  onClose,
}: ChannelInfoPanelProps) {
  const [tab, setTab] = useState("pinned");
  const messages = useChannelMessages(channel.id);
  const setPinned = useMessageStore((state) => state.setPinned);
  const highlightMessage = useUiStore((state) => state.highlightMessage);
  const canPin = useHasPermission(community.id, "pin_messages");
  const hostOffline = useHostStatus(community) === "offline";
  const setActiveChannel = useCommunityStore((state) => state.setActiveChannel);

  const pinned = useMemo(
    () => messages.filter((message) => message.pinned).reverse(),
    [messages],
  );

  const attachments = useMemo(() => {
    const found: { attachment: Attachment; message: Message }[] = [];
    for (const message of messages)
      for (const attachment of message.attachments)
        found.push({ attachment, message });
    return found.reverse();
  }, [messages]);

  const links = useMemo(() => {
    const found: LinkEntry[] = [];
    for (const message of messages)
      for (const url of message.content.match(URL_PATTERN) ?? []) {
        let host = url;
        try {
          host = new URL(url).host;
        } catch {
          // URL malformada continua sendo mostrada crua, sem quebrar a aba.
        }
        found.push({ url, host, message });
      }
    return found.reverse();
  }, [messages]);

  function jumpTo(message: Message) {
    setActiveChannel(community.id, channel.id);
    highlightMessage(message.id);
    onClose();
  }

  return (
    <SlidePanel title={channel.name} onClose={onClose} width={320}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-3 pt-2">
          <Tabs
            orientation="horizontal"
            activeId={tab}
            onSelect={setTab}
            items={[
              { id: "pinned", label: "Fixados" },
              { id: "files", label: "Arquivos" },
              { id: "links", label: "Links" },
            ]}
          />
        </div>

        {/* premissa 6 — réplica local parcial: a aba mostra só o que chegou. */}
        {hostOffline && (
          <div className="px-3 pt-2">
            <StatusBanner tone="offline" inset>
              Mostrando só o que está salvo neste dispositivo
            </StatusBanner>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "pinned" &&
            (pinned.length === 0 ? (
              <EmptyState>
                Nenhuma mensagem fixada neste canal. Fixe uma pelo menu dela.
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-1 p-3">
                {pinned.map((message) => (
                  <li key={message.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => jumpTo(message)}
                      className={cn(
                        "flex w-full flex-col items-start gap-1 rounded-md p-2 text-left",
                        "transition-colors duration-(--duration-fast) ease-out",
                        "hover:bg-surface-primary",
                      )}
                    >
                      <EntryHeader
                        communityId={community.id}
                        message={message}
                      />
                      <span className="line-clamp-2 text-body text-text-secondary">
                        {message.content}
                      </span>
                    </button>

                    {canPin && (
                      <button
                        type="button"
                        onClick={() => setPinned(message, false)}
                        aria-label="Desafixar mensagem"
                        className={cn(
                          "absolute top-2 right-2 hidden size-7 place-items-center rounded-md",
                          "text-text-tertiary hover:bg-surface-elevated hover:text-text-primary",
                          "group-hover:grid focus-visible:grid",
                        )}
                      >
                        <PinOff size={16} strokeWidth={2} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ))}

          {tab === "files" &&
            (attachments.length === 0 ? (
              <EmptyState>Nenhum arquivo compartilhado aqui ainda.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-1 p-3">
                {attachments.map(({ attachment, message }) => (
                  <li key={`${message.id}-${attachment.name}`}>
                    <button
                      type="button"
                      onClick={() => jumpTo(message)}
                      className={cn(
                        "flex w-full flex-col items-start gap-1 rounded-md p-2 text-left",
                        "transition-colors duration-(--duration-fast) ease-out",
                        "hover:bg-surface-primary",
                      )}
                    >
                      <span className="w-full truncate text-body-emphasis text-text-primary">
                        {attachment.name}
                      </span>
                      <span className="text-meta text-text-tertiary">
                        {formatFileSize(attachment.sizeBytes)} ·{" "}
                        {attachment.availablePeers}{" "}
                        {attachment.availablePeers === 1 ? "peer" : "peers"}
                        {attachment.hostAvailable && " + host"}
                      </span>
                      <EntryHeader
                        communityId={community.id}
                        message={message}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            ))}

          {tab === "links" &&
            (links.length === 0 ? (
              <EmptyState>Nenhum link compartilhado aqui ainda.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-1 p-3">
                {links.map((entry, index) => (
                  <li key={`${entry.message.id}-${index}`}>
                    <button
                      type="button"
                      onClick={() => jumpTo(entry.message)}
                      className={cn(
                        "flex w-full flex-col items-start gap-1 rounded-md p-2 text-left",
                        "transition-colors duration-(--duration-fast) ease-out",
                        "hover:bg-surface-primary",
                      )}
                    >
                      {/* Sem preview/unfurl: buscar a página vazaria o IP de
                          todo mundo pro site linkado (Apêndice A). */}
                      <span className="w-full truncate text-body-emphasis text-text-primary">
                        {entry.host}
                      </span>
                      <span className="w-full truncate text-meta text-text-tertiary">
                        {entry.url}
                      </span>
                      <EntryHeader
                        communityId={community.id}
                        message={entry.message}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </div>
    </SlidePanel>
  );
}
