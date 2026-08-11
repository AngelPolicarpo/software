import { useState } from "react";
import { Plus, Ticket, Users } from "lucide-react";
import { cn } from "../../lib/cn";
import { Avatar } from "../ui/Avatar";
import { Menu } from "../ui/Menu";
import { Tooltip } from "../ui/Tooltip";
import { CommunityIcon } from "./CommunityIcon";
import { useIdentityStore } from "../../store/identityStore";
import { useUiStore } from "../../store/uiStore";
import {
  selectFirstTextChannelId,
  useCommunityStore,
  useJoinedCommunities,
} from "../../store/communityStore";
import { PRESENCE_LABEL } from "../../lib/avatar";

/**
 * Rail de comunidades (§8, 1.1) — 72px fixos, `surface-app`.
 * Topo→base: ícones das comunidades na ordem de entrada, separador, botão
 * "+" (criar/entrar), espaço flexível, avatar da identidade local.
 */
export function CommunityRail() {
  const identity = useIdentityStore((state) => state.identity);
  const communities = useJoinedCommunities();
  const activeCommunityId = useCommunityStore(
    (state) => state.activeCommunityId,
  );
  const setActiveCommunity = useCommunityStore(
    (state) => state.setActiveCommunity,
  );
  const setActiveChannel = useCommunityStore((state) => state.setActiveChannel);
  const openJoinCommunity = useUiStore((state) => state.openJoinCommunity);
  const openCreateCommunity = useUiStore((state) => state.openCreateCommunity);

  const [menuOpen, setMenuOpen] = useState(false);

  function handleSelect(communityId: string) {
    setActiveCommunity(communityId);
    const state = useCommunityStore.getState();
    // Primeira visita cai no primeiro canal de texto da primeira categoria;
    // visitas seguintes mantêm o último canal aberto (§4).
    if (!state.activeChannelByCommunity[communityId]) {
      const channelId = selectFirstTextChannelId(state, communityId);
      if (channelId) setActiveChannel(communityId, channelId);
    }
  }

  return (
    <nav
      aria-label="Comunidades"
      className="flex w-18 shrink-0 flex-col items-center gap-2 bg-surface-app py-3"
    >
      {communities.map((community) => (
        <CommunityIcon
          key={community.id}
          community={community}
          active={community.id === activeCommunityId}
          onSelect={() => handleSelect(community.id)}
        />
      ))}

      {communities.length > 0 && (
        <hr className="my-1 w-8 border-t border-border-default" aria-hidden />
      )}

      <div className="relative flex w-full justify-center">
        <Tooltip label="Criar ou entrar numa comunidade">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={cn(
              "grid size-12 place-items-center rounded-full",
              "bg-surface-sidebar text-accent-default",
              "transition-all duration-(--duration-base) ease-out",
              "hover:rounded-lg hover:bg-accent-default hover:text-text-on-accent",
            )}
          >
            <Plus size={24} strokeWidth={2} />
            <span className="sr-only">Criar ou entrar numa comunidade</span>
          </button>
        </Tooltip>

        <Menu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          items={[
            {
              id: "create",
              label: "Criar uma comunidade",
              description: "Você vira o host",
              icon: <Users size={20} strokeWidth={2} />,
              onSelect: openCreateCommunity,
            },
            {
              id: "join",
              label: "Entrar com convite",
              description: "Cole um link ou código",
              icon: <Ticket size={20} strokeWidth={2} />,
              onSelect: () => openJoinCommunity("manual"),
            },
          ]}
        />
      </div>

      <div className="flex-1" />

      {identity && (
        /* Abre 3.1 (Configurações de conta) quando a Camada 3 existir; por
           enquanto só identifica quem está usando o app. */
        <Tooltip label={`${identity.displayName} — ${PRESENCE_LABEL[identity.presence]}`}>
          <Avatar
            name={identity.displayName}
            color={identity.avatarColor}
            size="md"
            presence={identity.presence}
            presenceRingClass="border-surface-app"
          />
        </Tooltip>
      )}
    </nav>
  );
}
