import { useEffect } from "react";
import { CommunityRail } from "./CommunityRail";
import { CommunityWorkspacePlaceholder } from "./CommunityWorkspacePlaceholder";
import { EmptyHub } from "../../features/hub/EmptyHub";
import { CreateCommunityModal } from "../../features/communities/CreateCommunityModal";
import { JoinCommunityOverlay } from "../../features/invites/JoinCommunityOverlay";
import {
  selectCommunity,
  selectFirstTextChannelId,
  useCommunityStore,
} from "../../store/communityStore";
import { usePendingInviteStore } from "../../store/inviteStore";
import { useUiStore } from "../../store/uiStore";

/**
 * 1.1 Shell principal — chrome persistente que hospeda toda a navegação
 * pós-identidade.
 *
 * Nesta parte só o rail (72px) está implementado; a lista de canais, a área
 * de conteúdo e o painel direito entram com a Camada 1. Com 0 comunidades,
 * o conteúdo central é o Hub vazio (0.2), que não é uma tela separada.
 */
export function AppShell() {
  const joinedCommunityIds = useCommunityStore(
    (state) => state.joinedCommunityIds,
  );
  const activeCommunityId = useCommunityStore(
    (state) => state.activeCommunityId,
  );
  const activeCommunity = useCommunityStore((state) =>
    selectCommunity(state, state.activeCommunityId),
  );
  const setActiveCommunity = useCommunityStore(
    (state) => state.setActiveCommunity,
  );
  const setActiveChannel = useCommunityStore((state) => state.setActiveChannel);

  const overlay = useUiStore((state) => state.overlay);
  const joinSource = useUiStore((state) => state.joinSource);
  const openJoinCommunity = useUiStore((state) => state.openJoinCommunity);

  const pendingInviteCode = usePendingInviteStore(
    (state) => state.pendingInviteCode,
  );

  // Convite guardado por `/invite/:code` retoma o preview automaticamente,
  // sem exigir colar o código de novo (§11, A2 passo 3).
  useEffect(() => {
    if (pendingInviteCode && overlay === null) openJoinCommunity("link");
  }, [pendingInviteCode, overlay, openJoinCommunity]);

  // Comunidade ativa some do rail (ou nunca existiu) → cai na primeira.
  useEffect(() => {
    if (joinedCommunityIds.length === 0) return;
    if (activeCommunityId && joinedCommunityIds.includes(activeCommunityId))
      return;

    const fallbackId = joinedCommunityIds[0];
    setActiveCommunity(fallbackId);
    const state = useCommunityStore.getState();
    if (!state.activeChannelByCommunity[fallbackId]) {
      const channelId = selectFirstTextChannelId(state, fallbackId);
      if (channelId) setActiveChannel(fallbackId, channelId);
    }
  }, [
    joinedCommunityIds,
    activeCommunityId,
    setActiveCommunity,
    setActiveChannel,
  ]);

  const joiningFromLinkWithoutShell =
    overlay === "join-community" &&
    joinSource === "link" &&
    joinedCommunityIds.length === 0;

  if (joiningFromLinkWithoutShell) {
    return <JoinCommunityOverlay layout="fullscreen" />;
  }

  return (
    <div className="flex h-full">
      <CommunityRail />

      {activeCommunity ? (
        <CommunityWorkspacePlaceholder community={activeCommunity} />
      ) : (
        <EmptyHub />
      )}

      {overlay === "create-community" && <CreateCommunityModal />}
      {overlay === "join-community" && <JoinCommunityOverlay layout="modal" />}
    </div>
  );
}
