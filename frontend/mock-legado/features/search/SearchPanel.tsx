import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { Calendar, Hash, Paperclip, Search, User, X } from "lucide-react";
import { cn } from "../../../src/lib/cn";
import { Avatar } from "../../components/ui/Avatar";
import { Menu } from "../../components/ui/Menu";
import type { MenuItem } from "../../components/ui/Menu";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatusBanner } from "../../../src/components/ui/StatusBanner";
import { formatMessageTimestamp } from "../../lib/format";
import { findMember, findMembers } from "../../mocks/dataset";
import {
  useCommunityStore,
  useRecentChannels,
  useTextChannels,
} from "../../store/communityStore";
import { useHostStatus } from "../../store/connectionStore";
import { useMessagesForChannels } from "../../store/messageStore";
import { useUiStore } from "../../store/uiStore";
import {
  RESULTS_PER_GROUP,
  hasFilters,
  search,
  splitOnMatch,
} from "./searchIndex";
import type { DateFilter, KindFilter, SearchFilters } from "./searchIndex";
import type { Channel, Community, Member, Message } from "../../domain/types";

/** §8, 1.2 — debounce da digitação. */
const DEBOUNCE_MS = 250;

const DATE_LABEL: Record<DateFilter, string> = {
  today: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
};

const KIND_LABEL: Record<KindFilter, string> = {
  attachment: "Anexo",
  link: "Link",
  pinned: "Fixado",
};

type Selectable =
  | { type: "message"; message: Message }
  | { type: "channel"; channel: Channel }
  | { type: "member"; member: Member };

function FilterChip({
  label,
  value,
  icon,
  items,
  onClear,
}: {
  label: string;
  value?: string;
  icon: ReactNode;
  items: MenuItem[];
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <div
        className={cn(
          "flex h-7 items-center gap-1 rounded-full border pl-2",
          value
            ? "border-accent-default bg-accent-muted-bg text-accent-default"
            : "border-border-default text-text-secondary",
          value ? "pr-1" : "pr-2",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((isOpen) => !isOpen)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-1 text-meta"
        >
          {icon}
          {value ? `${label}: ${value}` : label}
        </button>
        {value && (
          <button
            type="button"
            onClick={onClear}
            className="grid size-5 place-items-center rounded-full hover:bg-accent-muted-bg"
          >
            <X size={12} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Remover filtro {label}</span>
          </button>
        )}
      </div>

      <Menu
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        side="bottom"
      />
    </div>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const parts = splitOnMatch(text, query);
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts.before}
      <mark className="rounded-sm bg-accent-muted-bg text-accent-default">
        {parts.match}
      </mark>
      {parts.after}
    </>
  );
}

export interface SearchPanelProps {
  community: Community;
  activeChannel: Channel | undefined;
}

/**
 * Painel de busca (§8, 1.2) — overlay centralizado no topo, não painel
 * lateral: §15 lista a busca junto dos painéis do slot direito, mas §8 e §6
 * a descrevem como command palette, e é a descrição da tela que vale.
 *
 * Um motor, dois pontos de entrada: a lupa do cabeçalho abre no canal atual,
 * `Cmd/Ctrl+K` abre na comunidade inteira, e o escopo troca sem fechar.
 */
export function SearchPanel({ community, activeChannel }: SearchPanelProps) {
  const scope = useUiStore((state) => state.searchScope);
  const setSearchScope = useUiStore((state) => state.setSearchScope);
  const closeSearch = useUiStore((state) => state.closeSearch);
  const highlightMessage = useUiStore((state) => state.highlightMessage);
  const toggleMembersPanel = useUiStore((state) => state.toggleMembersPanel);
  const setMobilePane = useUiStore((state) => state.setMobilePane);
  const setActiveChannel = useCommunityStore((state) => state.setActiveChannel);
  const hostStatus = useHostStatus(community);
  const recentChannels = useRecentChannels(community.id);

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [selected, setSelected] = useState(0);
  const [expandMessages, setExpandMessages] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const textChannels = useTextChannels(community.id);
  const members = findMembers(community.id);
  const messages = useMessagesForChannels(
    textChannels.map((channel) => channel.id),
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => setSelected(0), [debounced, filters]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeSearch();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeSearch]);

  const results = useMemo(
    () =>
      search({
        query: debounced,
        filters,
        messages,
        channels: textChannels,
        members,
        scopeChannelId:
          scope === "channel" && activeChannel ? activeChannel.id : undefined,
      }),
    [debounced, filters, messages, textChannels, members, scope, activeChannel],
  );

  const searching = query !== debounced;
  // Olha a digitação viva, não a debounced: senão o estado vazio ("canais
  // recentes") pisca por 250ms no lugar do skeleton a cada primeira busca.
  const asked = query.trim() !== "" || hasFilters(filters);
  const visibleMessages = expandMessages
    ? results.messages
    : results.messages.slice(0, RESULTS_PER_GROUP);

  const flat: Selectable[] = useMemo(
    () => [
      ...visibleMessages.map((message) => ({ type: "message" as const, message })),
      ...results.channels.map((channel) => ({ type: "channel" as const, channel })),
      ...results.members.map((member) => ({ type: "member" as const, member })),
    ],
    [visibleMessages, results.channels, results.members],
  );

  function openChannel(channelId: string) {
    setActiveChannel(community.id, channelId);
    setMobilePane("content");
  }

  function activate(item: Selectable) {
    if (item.type === "message") {
      openChannel(item.message.channelId);
      highlightMessage(item.message.id);
    } else if (item.type === "channel") {
      openChannel(item.channel.id);
    } else {
      // Sem gatilho ancorado aqui, o destino do membro é a lista (1.3).
      toggleMembersPanel();
    }
    closeSearch();
  }

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((index) => Math.min(index + 1, flat.length - 1));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => Math.max(index - 1, 0));
    }
    if (event.key === "Enter" && flat[selected]) {
      event.preventDefault();
      activate(flat[selected]);
    }
  }

  const authorName = filters.authorId
    ? findMember(community.id, filters.authorId)?.displayName
    : undefined;
  const channelName = filters.channelId
    ? textChannels.find((channel) => channel.id === filters.channelId)?.name
    : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-surface-overlay-scrim tablet:items-center tablet:pt-[10vh]"
      onPointerDown={(event) => {
        if (!containerRef.current?.contains(event.target as Node)) closeSearch();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-label="Buscar"
        onKeyDown={handleKeyDown}
        className={cn(
          "flex h-full w-full min-h-0 flex-col bg-surface-elevated",
          "tablet:h-auto tablet:max-h-[70vh] tablet:w-[600px]",
          "tablet:rounded-lg tablet:border tablet:border-border-default tablet:shadow-elevated",
          "animate-modal-in",
        )}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-4 py-3">
          <Search
            size={20}
            strokeWidth={2}
            aria-hidden="true"
            className="shrink-0 text-text-tertiary"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              scope === "channel" && activeChannel
                ? `Buscar em #${activeChannel.name}`
                : `Buscar em ${community.name}`
            }
            aria-label="Buscar"
            className="min-w-0 flex-1 bg-transparent text-body text-text-primary outline-none placeholder:text-text-tertiary"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="shrink-0 rounded-sm text-text-tertiary hover:text-text-primary"
            >
              <X size={16} strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">Limpar busca</span>
            </button>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border-subtle px-4 py-2">
          {scope === "channel" && activeChannel && (
            <button
              type="button"
              onClick={() => setSearchScope("community")}
              className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-accent-default bg-accent-muted-bg px-2 text-meta text-accent-default"
            >
              Em #{activeChannel.name}
              <X size={12} strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">Buscar em toda a comunidade</span>
            </button>
          )}

          <FilterChip
            label="Autor"
            value={authorName}
            icon={<User size={14} strokeWidth={2} aria-hidden="true" />}
            onClear={() => setFilters((f) => ({ ...f, authorId: undefined }))}
            items={members.map((member) => ({
              id: member.identityId,
              label: member.displayName,
              onSelect: () =>
                setFilters((f) => ({ ...f, authorId: member.identityId })),
            }))}
          />
          <FilterChip
            label="Canal"
            value={channelName ? `#${channelName}` : undefined}
            icon={<Hash size={14} strokeWidth={2} aria-hidden="true" />}
            onClear={() => setFilters((f) => ({ ...f, channelId: undefined }))}
            items={textChannels.map((channel) => ({
              id: channel.id,
              label: `#${channel.name}`,
              onSelect: () =>
                setFilters((f) => ({ ...f, channelId: channel.id })),
            }))}
          />
          <FilterChip
            label="Data"
            value={filters.date ? DATE_LABEL[filters.date] : undefined}
            icon={<Calendar size={14} strokeWidth={2} aria-hidden="true" />}
            onClear={() => setFilters((f) => ({ ...f, date: undefined }))}
            items={(["today", "7d", "30d"] as DateFilter[]).map((date) => ({
              id: date,
              label: DATE_LABEL[date],
              onSelect: () => setFilters((f) => ({ ...f, date })),
            }))}
          />
          <FilterChip
            label="Tipo"
            value={filters.kind ? KIND_LABEL[filters.kind] : undefined}
            icon={<Paperclip size={14} strokeWidth={2} aria-hidden="true" />}
            onClear={() => setFilters((f) => ({ ...f, kind: undefined }))}
            items={(["attachment", "link", "pinned"] as KindFilter[]).map(
              (kind) => ({
                id: kind,
                label: KIND_LABEL[kind],
                onSelect: () => setFilters((f) => ({ ...f, kind })),
              }),
            )}
          />
        </div>

        {hostStatus === "offline" && (
          <StatusBanner tone="offline">
            Buscando só no histórico salvo neste dispositivo — {community.name}{" "}
            está offline
          </StatusBanner>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!asked ? (
            <section>
              <h3 className="px-2 py-1 text-caption text-text-tertiary uppercase">
                Canais recentes
              </h3>
              {recentChannels.length === 0 ? (
                <p className="px-2 py-2 text-body text-text-tertiary">
                  Abra um canal para ele aparecer aqui.
                </p>
              ) : (
                <ul>
                  {recentChannels.map((channel) => (
                    <li key={channel.id}>
                      <button
                        type="button"
                        onClick={() => {
                          openChannel(channel.id);
                          closeSearch();
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent-muted-bg"
                      >
                        <Hash
                          size={16}
                          strokeWidth={2}
                          aria-hidden="true"
                          className="text-text-tertiary"
                        />
                        <span className="text-body text-text-primary">
                          {channel.name}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : searching ? (
            <div className="flex flex-col gap-2 p-2">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-2">
                  <Skeleton className="size-6 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : flat.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-body text-text-secondary">
                Nada encontrado para "{debounced.trim()}"
              </p>
              {hasFilters(filters) && (
                <p className="mt-1 text-meta text-text-tertiary">
                  Tente remover um filtro.
                </p>
              )}
            </div>
          ) : (
            <>
              {visibleMessages.length > 0 && (
                <section className="mb-2">
                  <h3 className="px-2 py-1 text-caption text-text-tertiary uppercase">
                    Mensagens — {results.messages.length}
                  </h3>
                  <ul>
                    {visibleMessages.map((message, index) => {
                      const author = findMember(community.id, message.authorId);
                      const channel = textChannels.find(
                        (item) => item.id === message.channelId,
                      );
                      return (
                        <li key={message.id}>
                          <button
                            type="button"
                            onMouseEnter={() => setSelected(index)}
                            onClick={() => activate({ type: "message", message })}
                            aria-selected={selected === index}
                            className={cn(
                              "flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left",
                              selected === index && "bg-accent-muted-bg",
                            )}
                          >
                            <span className="flex items-center gap-2 text-meta text-text-tertiary">
                              <Avatar
                                name={author?.displayName ?? "?"}
                                color={author?.avatarColor ?? "role-neutral"}
                                size="sm"
                              />
                              <span className="text-text-secondary">
                                {author?.displayName ?? "Membro"}
                              </span>
                              {channel && <span>#{channel.name}</span>}
                              <span>
                                {formatMessageTimestamp(
                                  new Date(message.timestamp),
                                )}
                              </span>
                            </span>
                            <span className="line-clamp-2 text-body text-text-primary">
                              <Highlighted
                                text={message.content}
                                query={debounced}
                              />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {!expandMessages &&
                    results.messages.length > RESULTS_PER_GROUP && (
                      <button
                        type="button"
                        onClick={() => setExpandMessages(true)}
                        className="px-2 py-1 text-meta text-accent-default hover:underline"
                      >
                        Ver todos os resultados de mensagens
                      </button>
                    )}
                </section>
              )}

              {results.channels.length > 0 && (
                <section className="mb-2">
                  <h3 className="px-2 py-1 text-caption text-text-tertiary uppercase">
                    Canais — {results.channels.length}
                  </h3>
                  <ul>
                    {results.channels.map((channel, index) => {
                      const flatIndex = visibleMessages.length + index;
                      return (
                        <li key={channel.id}>
                          <button
                            type="button"
                            onMouseEnter={() => setSelected(flatIndex)}
                            onClick={() => activate({ type: "channel", channel })}
                            aria-selected={selected === flatIndex}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left",
                              selected === flatIndex && "bg-accent-muted-bg",
                            )}
                          >
                            <Hash
                              size={16}
                              strokeWidth={2}
                              aria-hidden="true"
                              className="text-text-tertiary"
                            />
                            <span className="text-body text-text-primary">
                              <Highlighted text={channel.name} query={debounced} />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {results.members.length > 0 && (
                <section>
                  <h3 className="px-2 py-1 text-caption text-text-tertiary uppercase">
                    Membros — {results.members.length}
                  </h3>
                  <ul>
                    {results.members.map((member, index) => {
                      const flatIndex =
                        visibleMessages.length + results.channels.length + index;
                      return (
                        <li key={member.identityId}>
                          <button
                            type="button"
                            onMouseEnter={() => setSelected(flatIndex)}
                            onClick={() => activate({ type: "member", member })}
                            aria-selected={selected === flatIndex}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left",
                              selected === flatIndex && "bg-accent-muted-bg",
                            )}
                          >
                            <Avatar
                              name={member.displayName}
                              color={member.avatarColor}
                              size="sm"
                              presence={member.presence}
                              presenceRingClass="border-surface-elevated"
                            />
                            <span className="text-body text-text-primary">
                              <Highlighted
                                text={member.nickname ?? member.displayName}
                                query={debounced}
                              />
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
