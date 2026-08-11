import type { ReactNode } from "react";
import { ChevronDown, Settings } from "lucide-react";
import { cn } from "../../lib/cn";
import { ChannelListItem } from "./ChannelListItem";
import {
  useCategories,
  useChannels,
  useCollapsedCategoryIds,
  useCommunityStore,
} from "../../store/communityStore";
import { useUiStore } from "../../store/uiStore";
import type { Category, Community } from "../../domain/types";

interface CategorySectionProps {
  category: Category;
  collapsed: boolean;
  activeChannelId: string | undefined;
  onToggle: () => void;
  onSelectChannel: (channelId: string) => void;
  onJoinVoice: (channelId: string) => void;
}

function CategorySection({
  category,
  collapsed,
  activeChannelId,
  onToggle,
  onSelectChannel,
  onJoinVoice,
}: CategorySectionProps) {
  const channels = useChannels(category.channelIds);

  return (
    <section className="mb-4 last:mb-0">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className={cn(
            "flex w-full items-center gap-1 rounded-sm px-1 py-1",
            "text-caption text-text-tertiary uppercase",
            "transition-colors duration-(--duration-fast) ease-out",
            "hover:text-text-secondary",
          )}
        >
          <ChevronDown
            size={16}
            strokeWidth={2}
            aria-hidden="true"
            className={cn(
              "shrink-0 transition-transform duration-(--duration-fast) ease-out",
              collapsed && "-rotate-90",
            )}
          />
          <span className="truncate">{category.name}</span>
        </button>
      </h3>

      {!collapsed && (
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {channels.map((channel) => (
            <ChannelListItem
              key={channel.id}
              channel={channel}
              active={channel.id === activeChannelId}
              onSelect={() => onSelectChannel(channel.id)}
              onJoinVoice={() => onJoinVoice(channel.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export interface ChannelListProps {
  community: Community;
  /**
   * Canal aberto na área de conteúdo. Vem de fora, já resolvido, para o
   * destaque da lista nunca discordar do que está aberto — numa comunidade
   * visitada pela primeira vez o canal ainda não foi gravado na store.
   */
  activeChannelId: string | undefined;
  onSelectChannel: (channelId: string) => void;
  onJoinVoice: (channelId: string) => void;
  /**
   * Barra de chamada persistente (§9, 2.3.1) — ancorada na base *da lista de
   * canais*, nunca do rail de 72px.
   */
  footer?: ReactNode;
  className?: string;
}

/**
 * Lista de canais do shell (§8, 1.1) — 240px fixos, `surface-sidebar`.
 * Nome da comunidade no topo, categorias colapsáveis (estado lembrado por
 * comunidade) e os canais na ordem de criação (§14).
 */
export function ChannelList({
  community,
  activeChannelId,
  onSelectChannel,
  onJoinVoice,
  footer,
  className,
}: ChannelListProps) {
  const categories = useCategories(community.id);
  const collapsedIds = useCollapsedCategoryIds(community.id);
  const toggleCategoryCollapsed = useCommunityStore(
    (state) => state.toggleCategoryCollapsed,
  );
  const toggleMembersPanel = useUiStore((state) => state.toggleMembersPanel);
  const openCommunitySettings = useUiStore(
    (state) => state.openCommunitySettings,
  );

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col bg-surface-sidebar",
        // §16: 240px fixos no Desktop e no Tablet; no Mobile a lista de
        // canais é a tela inteira ao lado do rail.
        "w-full tablet:w-60 tablet:shrink-0",
        className,
      )}
    >
      {/*
        §8 (1.1) e §4 dizem que o nome da comunidade abre o painel de membros;
        §10 (3.1b) diz que ele abre as configurações. Duas seções contra uma:
        o nome segue indo para os membros e as configurações ganham botão
        próprio — o mesmo destino que o menu de contexto do ícone no rail.
      */}
      <header className="flex h-12 shrink-0 items-center border-b border-border-subtle pr-1">
        <button
          type="button"
          onClick={toggleMembersPanel}
          className={cn(
            "flex h-full min-w-0 flex-1 items-center px-4 text-left",
            "transition-colors duration-(--duration-fast) ease-out",
            "hover:bg-surface-primary",
          )}
        >
          <h2 className="truncate text-heading-3 text-text-primary">
            {community.name}
          </h2>
        </button>

        <button
          type="button"
          onClick={openCommunitySettings}
          aria-label="Configurações da comunidade"
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md",
            "text-text-secondary transition-colors duration-(--duration-fast) ease-out",
            "hover:bg-surface-primary hover:text-text-primary",
          )}
        >
          <Settings size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      <nav aria-label="Canais" className="flex-1 overflow-y-auto px-2 py-3">
        {categories.map((category) => (
          <CategorySection
            key={category.id}
            category={category}
            collapsed={collapsedIds.includes(category.id)}
            activeChannelId={activeChannelId}
            onToggle={() =>
              toggleCategoryCollapsed(community.id, category.id)
            }
            onSelectChannel={onSelectChannel}
            onJoinVoice={onJoinVoice}
          />
        ))}
      </nav>

      {footer}
    </div>
  );
}
