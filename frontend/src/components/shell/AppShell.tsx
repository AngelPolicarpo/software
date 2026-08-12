import { useEffect } from "react";
import { cn } from "../../lib/cn";
import { ChannelList } from "./ChannelList";
import { CommunityRail } from "./CommunityRail";
import { ChannelView } from "../../features/channel/ChannelView";
import { ChannelInfoPanel } from "../../features/channel/ChannelInfoPanel";
import { MessageLinkResolver } from "../../features/channel/MessageLinkResolver";
import { HostExitDialog } from "../../features/host/HostExitGuard";
import {
  useBeforeUnloadWarning,
  useHostedImpact,
} from "../../features/host/hostExit";
import { ThreadPanel } from "../../features/channel/ThreadPanel";
import { MembersPanel } from "../../features/members/MembersPanel";
import { SearchPanel } from "../../features/search/SearchPanel";
import { EmptyHub } from "../../features/hub/EmptyHub";
import { ChannelDialogs } from "../../features/channels/ChannelDialogs";
import { CreateCommunityModal } from "../../features/communities/CreateCommunityModal";
import { JoinCommunityOverlay } from "../../features/invites/JoinCommunityOverlay";
import { AccountSettings } from "../../features/settings/AccountSettings";
import { CommunitySettings } from "../../features/settings/CommunitySettings";
import { RelayConsentModal } from "../../features/voice/RelayConsentModal";
import { VoiceCallBar } from "../../features/voice/VoiceCallBar";
import { VoiceOverlay } from "../../features/voice/VoiceOverlay";
import {
  selectChannel,
  selectCommunity,
  selectFirstTextChannelId,
  selectIsChannelReadOnly,
  useActiveChannel,
  useCommunityStore,
  useLocalMemberId,
} from "../../store/communityStore";
import { useHostStatus } from "../../store/connectionStore";
import { usePendingInviteStore } from "../../store/inviteStore";
import { useToastStore } from "../../store/toastStore";
import { useUiStore } from "../../store/uiStore";
import { useVoiceStore } from "../../store/voiceStore";

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
  const closeOverlay = useUiStore((state) => state.closeOverlay);
  const mobilePane = useUiStore((state) => state.mobilePane);
  const setMobilePane = useUiStore((state) => state.setMobilePane);
  const rightPanel = useUiStore((state) => state.rightPanel);
  const closeRightPanel = useUiStore((state) => state.closeRightPanel);
  const searchScope = useUiStore((state) => state.searchScope);
  const openSearch = useUiStore((state) => state.openSearch);

  const activeChannelReadOnly = useCommunityStore((state) =>
    activeChannel ? selectIsChannelReadOnly(state, activeChannel) : false,
  );

  const pendingInviteCode = usePendingInviteStore(
    (state) => state.pendingInviteCode,
  );

  const hostStatus = useHostStatus(activeCommunity);
  const localMemberId = useLocalMemberId(activeCommunityId ?? "");
  const joinVoice = useVoiceStore((state) => state.join);
  const voiceExpanded = useVoiceStore((state) => state.expanded);
  const inVoice = useVoiceStore((state) => state.channelId !== null);
  const voiceChannelId = useVoiceStore((state) => state.channelId);
  const setVoiceExpanded = useVoiceStore((state) => state.setExpanded);
  const showToast = useToastStore((state) => state.showToast);

  // §10, 3.5 — o navegador só permite a confirmação genérica dele; o modal
  // é a decisão de produto, alcançável pelo afinador de §19.1.
  const hostedImpact = useHostedImpact();
  useBeforeUnloadWarning(hostedImpact.length > 0);

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

  // `Cmd/Ctrl+K` de qualquer lugar dentro de uma comunidade ativa (§8, 1.2).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey))
        return;
      if (!activeCommunityId) return;
      event.preventDefault();
      openSearch("community");
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeCommunityId, openSearch]);

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

  /**
   * Entrar em voz **não** troca a área de conteúdo (§4): abre a grade por
   * cima dela e a barra persistente. Clicar no canal em que já se está só
   * traz a grade de volta.
   */
  function handleJoinVoice(channelId: string) {
    if (!activeCommunityId) return;
    if (voiceChannelId === channelId) {
      setVoiceExpanded(true);
      return;
    }
    // §11, B4 (exceções): voz precisa do host de pé — bloqueia com mensagem
    // clara em vez de tentar e falhar em silêncio.
    if (hostStatus !== "online") {
      showToast(
        `Voz precisa que ${activeCommunity?.name ?? "o host"} esteja online`,
        "error",
      );
      return;
    }
    const channel = selectChannel(useCommunityStore.getState(), channelId);
    if (channel) joinVoice(channel, localMemberId);
  }

  // §16, Mobile: a grade expandida é a tela em foco, como o conteúdo.
  const contentPaneVisible = mobilePane === "content" || voiceExpanded;

  return (
    // `relative` ancora o painel direito, que no Tablet flutua sobre o
    // conteúdo em vez de ocupar coluna (§16).
    <div
      className={cn(
        "relative flex h-full",
        // A barra de chamada do Mobile é fixa no rodapé: o shell cede a
        // altura dela para não esconder o composer atrás.
        inVoice && !voiceExpanded && "pb-16 tablet:pb-0",
      )}
    >
      <CommunityRail />

      {activeCommunity ? (
        <>
          <ChannelList
            community={activeCommunity}
            activeChannelId={activeChannel?.id}
            onSelectChannel={handleSelectChannel}
            onJoinVoice={handleJoinVoice}
            footer={inVoice && <VoiceCallBar variant="sidebar" />}
            className={cn(contentPaneVisible && "hidden tablet:flex")}
          />

          {/* A grade de voz (2.3) abre sobre a área de conteúdo, não no lugar
              dela: o canal de texto continua atrás (§4, C11). */}
          <div
            className={cn(
              "relative flex min-w-0 flex-1",
              !contentPaneVisible && "hidden tablet:flex",
            )}
          >
            {activeChannel && (
              <ChannelView
                community={activeCommunity}
                channel={activeChannel}
                onBack={() => setMobilePane("channels")}
                className={cn(
                  mobilePane === "channels" && "hidden tablet:flex",
                )}
              />
            )}

            {voiceExpanded && <VoiceOverlay />}
          </div>

          {/* Slot único à direita: abrir um fecha o outro (§6, §15). */}
          {rightPanel?.kind === "members" && (
            <MembersPanel
              community={activeCommunity}
              onClose={closeRightPanel}
            />
          )}
          {rightPanel?.kind === "channel-info" && activeChannel && (
            <ChannelInfoPanel
              community={activeCommunity}
              channel={activeChannel}
              onClose={closeRightPanel}
            />
          )}
          {rightPanel?.kind === "thread" && activeChannel && (
            <ThreadPanel
              community={activeCommunity}
              channel={activeChannel}
              rootMessageId={rightPanel.rootMessageId}
              readOnly={activeChannelReadOnly}
              onClose={closeRightPanel}
            />
          )}
        </>
      ) : (
        <EmptyHub />
      )}

      {searchScope !== null && activeCommunity && (
        <SearchPanel community={activeCommunity} activeChannel={activeChannel} />
      )}

      {overlay === "create-community" && <CreateCommunityModal />}
      {overlay === "join-community" && <JoinCommunityOverlay layout="modal" />}
      {overlay === "account-settings" && (
        <AccountSettings onClose={closeOverlay} />
      )}
      {overlay === "community-settings" && activeCommunity && (
        <CommunitySettings
          community={activeCommunity}
          localMemberId={localMemberId}
          onClose={closeOverlay}
        />
      )}

      {/* §10, 3.4 — gestão de canais e categorias, disparada da lista. */}
      {activeCommunity && <ChannelDialogs community={activeCommunity} />}

      {/* §4 — resolve um `/m/:code` assim que o shell existe. */}
      <MessageLinkResolver />

      {overlay === "host-exit" && hostedImpact.length > 0 && (
        <HostExitDialog impact={hostedImpact} onClose={closeOverlay} />
      )}

      {/* §16: no Mobile a barra de chamada é a única coisa que sobrevive à
          navegação sequencial — fica no rodapé da viewport, acima das três
          telas empilhadas. */}
      {inVoice && <VoiceCallBar variant="mobile" />}
      <RelayConsentModal />
    </div>
  );
}
