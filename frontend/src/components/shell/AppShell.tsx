import { useEffect } from "react";
import { cn } from "../../lib/cn";
import { ChannelList } from "./ChannelList";
import { CommunityRail } from "./CommunityRail";
import { ChannelView } from "../../features/channel/ChannelView";
import { EmptyHub } from "../../features/hub/EmptyHub";
import { CreateCommunityModal } from "../../features/communities/CreateCommunityModal";
import { JoinCommunityOverlay } from "../../features/invites/JoinCommunityOverlay";
import {
  selectCommunity,
  selectFirstTextChannelId,
  useActiveChannel,
  useCommunityStore,
} from "../../store/communityStore";
import { usePendingInviteStore } from "../../store/inviteStore";
import { useUiStore } from "../../store/uiStore";

/**
 * 1.1 Shell principal — chrome persistente que hospeda toda a navegação
 * pós-identidade.
 *
 * Rail (72px) · lista de canais (240px) · área de conteúdo. O painel direito
 * de 280px (membros/thread/busca) entra com 1.2/1.3/2.2. Com 0 comunidades,
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
  const activeChannel = useActiveChannel();

  const overlay = useUiStore((state) => state.overlay);
  const joinSource = useUiStore((state) => state.joinSource);
  const openJoinCommunity = useUiStore((state) => state.openJoinCommunity);
  const mobilePane = useUiStore((state) => state.mobilePane);
  const setMobilePane = useUiStore((state) => state.setMobilePane);

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

  function handleSelectChannel(channelId: string) {
    if (!activeCommunityId) return;
    setActiveChannel(activeCommunityId, channelId);
    // §16, Mobile: escolher um canal avança para a tela de conteúdo.
    setMobilePane("content");
  }

  return (
    <div className="flex h-full">
      <CommunityRail />

      {activeCommunity ? (
        <>
          <ChannelList
            community={activeCommunity}
            activeChannelId={activeChannel?.id}
            onSelectChannel={handleSelectChannel}
            className={cn(mobilePane === "content" && "hidden tablet:flex")}
          />

          {activeChannel && (
            <ChannelView
              community={activeCommunity}
              channel={activeChannel}
              onBack={() => setMobilePane("channels")}
              className={cn(mobilePane === "channels" && "hidden tablet:flex")}
            />
          )}
        </>
      ) : (
        <EmptyHub />
      )}

      {overlay === "create-community" && <CreateCommunityModal />}
      {overlay === "join-community" && <JoinCommunityOverlay layout="modal" />}
    </div>
  );
}
