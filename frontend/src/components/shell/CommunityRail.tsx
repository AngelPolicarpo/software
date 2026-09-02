import { useState } from "react";
import { Plus, Ticket, Users } from "lucide-react";
import { cn } from "../../lib/cn";
import { Menu } from "../ui/Menu";
import { Tooltip } from "../ui/Tooltip";
import { CommunityIcon } from "./CommunityIcon";
import { DmRailButton } from "../../features/dm/DmRailButton";
import { useUiStore } from "../../store/uiStore";
import {
  selectFirstTextChannelId,
  useCommunityStore,
  useJoinedCommunities,
} from "../../store/communityStore";

/**
 * Rail de comunidades (§8, 1.1) — 72px fixos, `surface-app`.
 * Topo→base: ícones das comunidades na ordem de entrada, separador, botão
 * "+" (criar/entrar) e espaço flexível.
 *
 * O avatar da identidade local ficava aqui no rodapé e era a porta de 3.1;
 * quem faz os dois papéis agora é a barra de usuário (`UserBar`), que
 * atravessa o rodapé desta coluna e da lista de canais.
 */
export function CommunityRail() {
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
  const openCommunitySettings = useUiStore(
    (state) => state.openCommunitySettings,
  );
  const abrirComunidades = useUiStore((state) => state.abrirComunidades);

  const [menuOpen, setMenuOpen] = useState(false);

  function handleSelect(communityId: string) {
    // Escolher uma comunidade sai do destino da DM (U-33): o rail é um seletor só, e
    // deixar os dois "ativos" ao mesmo tempo mentiria sobre o que está na tela.
    abrirComunidades();
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
      aria-label="Comunidades e conversas"
      className="flex w-18 shrink-0 flex-col items-center gap-2 bg-surface-app py-3"
    >
      {/*
        U-33 / B63(a) — a conversa direta no TOPO do rail, antes das comunidades: ela não
        é uma comunidade, e enfileirá-la entre elas sugeriria que é.
      */}
      <DmRailButton />

      <hr className="my-1 w-8 border-t border-border-default" aria-hidden />

      {communities.map((community) => (
        <CommunityIcon
          key={community.id}
          community={community}
          active={community.id === activeCommunityId}
          onSelect={() => handleSelect(community.id)}
          onOpenSettings={() => {
            handleSelect(community.id);
            openCommunitySettings();
          }}
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
    </nav>
  );
}
