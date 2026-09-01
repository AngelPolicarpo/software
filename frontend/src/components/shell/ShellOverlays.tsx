import { ChannelDialogs } from "../../features/channels/ChannelDialogs";
import { CreateCommunityModal } from "../../features/communities/CreateCommunityModal";
import { HostExitDialog } from "../../features/host/HostExitGuard";
import { JoinCommunityOverlay } from "../../features/invites/JoinCommunityOverlay";
import { MessageLinkResolver } from "../../features/channel/MessageLinkResolver";
import { AccountSettings } from "../../features/settings/AccountSettings";
import { CommunitySettings } from "../../features/settings/CommunitySettings";
import { RelayConsentModal } from "../../features/voice/RelayConsentModal";
import { cancelarSaida, confirmarSaida } from "../../ipc/bridge";
import { useUiStore } from "../../store/uiStore";
import type { Community } from "../../domain/types";
import type { HostedImpact } from "../../features/host/hostExit";

export interface ShellOverlaysProps {
  community: Community | undefined;
  /** §10, 3.5 — comunidades hospedadas aqui que caem se a janela fechar. */
  hostedImpact: HostedImpact[];
}

/**
 * Camada de sobreposição do shell: modais de comunidade, configurações,
 * diálogos de canal e o aviso de saída de host. Todos vivem acima da árvore
 * de conteúdo e são decididos pelo `overlay` do `uiStore`.
 */
export function ShellOverlays({ community, hostedImpact }: ShellOverlaysProps) {
  const overlay = useUiStore((state) => state.overlay);
  const closeOverlay = useUiStore((state) => state.closeOverlay);

  return (
    <>
      {overlay === "create-community" && <CreateCommunityModal />}
      {overlay === "join-community" && <JoinCommunityOverlay layout="modal" />}
      {overlay === "account-settings" && (
        <AccountSettings onClose={closeOverlay} />
      )}
      {overlay === "community-settings" && community && (
        <CommunitySettings community={community} onClose={closeOverlay} />
      )}

      {/* §10, 3.4 — gestão de canais e categorias, disparada da lista. */}
      {community && <ChannelDialogs community={community} />}

      {/* §4 — resolve um `/m/:code` assim que o shell existe. */}
      <MessageLinkResolver />

      {overlay === "host-exit" && hostedImpact.length > 0 && (
        <HostExitDialog
          impact={hostedImpact}
          // Fechar o modal por qualquer caminho — botão, `Esc`, clique fora — é desistir
          // de sair, e o main precisa saber: ele está com a janela segurada e um prazo
          // correndo. Sem o aviso, "Cancelar" só adiava o fechamento em dez segundos.
          onClose={() => {
            closeOverlay();
            void cancelarSaida();
          }}
          onConfirm={() => {
            closeOverlay();
            void confirmarSaida();
          }}
        />
      )}

      <RelayConsentModal />
    </>
  );
}
