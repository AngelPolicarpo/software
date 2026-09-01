import { useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Calendar, Hash, Paperclip, User, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Menu } from "../../components/ui/Menu";
import type { MenuItem } from "../../components/ui/Menu";
import { useFindMember, useFindMembers, useTextChannels } from "../../store/communityStore";
import { useUiStore } from "../../store/uiStore";
import type { DateFilter, KindFilter, SearchFilters } from "./searchIndex";
import type { Channel, Community } from "../../domain/types";

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

export interface SearchFilterBarProps {
  community: Community;
  activeChannel: Channel | undefined;
  scope: "channel" | "community" | null;
  filters: SearchFilters;
  setFilters: Dispatch<SetStateAction<SearchFilters>>;
}

/** Escopo e os quatro filtros de §8, 1.2 — autor, canal, data e tipo. */
export function SearchFilterBar({
  community,
  activeChannel,
  scope,
  filters,
  setFilters,
}: SearchFilterBarProps) {
  const findMember = useFindMember();
  const findMembers = useFindMembers();
  const setSearchScope = useUiStore((state) => state.setSearchScope);
  const textChannels = useTextChannels(community.id);
  const members = findMembers(community.id);

  const authorName = filters.authorId
    ? findMember(community.id, filters.authorId)?.displayName
    : undefined;
  const channelName = filters.channelId
    ? textChannels.find((channel) => channel.id === filters.channelId)?.name
    : undefined;

  return (
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
          onSelect: () => setFilters((f) => ({ ...f, channelId: channel.id })),
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
  );
}
