import { useState } from "react";
import { Button } from "../../components/ui/Button";
import {
  selectCommunity,
  selectHighestRole,
  useCommunityStore,
} from "../../store/communityStore";
import {
  RECONNECT_DELAY_MS,
  useConnectionStore,
  useHostStatus,
} from "../../store/connectionStore";
import { useIdentityStore } from "../../store/identityStore";
import { usePendingInviteStore } from "../../store/inviteStore";
import { useMessageStore } from "../../store/messageStore";
import { useDownloadStore } from "../../store/downloadStore";
import type { Attachment } from "../../domain/types";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";
import { useVoiceStore } from "../../store/voiceStore";
import { AULA_WEBRTC_ATTACHMENT, IDS } from "../../mocks/dataset";

/**
 * Afinador de estado só-de-desenvolvimento, recomendado por §19.1 — não faz
 * parte da spec de produto e não é renderizado em build de produção.
 *
 * Sem ele, estados que dependem de rede real (host caindo e voltando, falha
 * de envio, alguém digitando do outro lado) são inalcançáveis num mock.
 */
export function DevBar() {
  const [open, setOpen] = useState(false);

  const seedReferenceDataset = useCommunityStore(
    (state) => state.seedReferenceDataset,
  );
  const resetCommunities = useCommunityStore((state) => state.resetCommunities);
  const clearIdentity = useIdentityStore((state) => state.clearIdentity);
  const clearPendingInvite = usePendingInviteStore(
    (state) => state.clearPendingInvite,
  );

  const activeCommunity = useCommunityStore((state) =>
    selectCommunity(state, state.activeCommunityId),
  );
  const activeChannelId = useCommunityStore((state) =>
    state.activeCommunityId
      ? state.activeChannelByCommunity[state.activeCommunityId]
      : undefined,
  );
  const hostStatus = useHostStatus(activeCommunity);
  const setHostStatus = useConnectionStore((state) => state.setHostStatus);

  const topRole = useCommunityStore((state) =>
    activeCommunity ? selectHighestRole(state, activeCommunity.roleIds) : undefined,
  );
  const roleOverridden = useCommunityStore((state) =>
    activeCommunity
      ? Boolean(state.localRoleOverrides[activeCommunity.id])
      : false,
  );
  const openHostExit = useUiStore((state) => state.openHostExit);
  const setLocalRoleOverride = useCommunityStore(
    (state) => state.setLocalRoleOverride,
  );

  const setTyping = useMessageStore((state) => state.setTyping);
  const resetMessages = useMessageStore((state) => state.reset);

  // Uma ação por seletor: montar um objeto com todas devolveria referência
  // nova a cada render e o Zustand v5 entraria em loop (regra da Parte 4).
  const inVoice = useVoiceStore((state) => state.channelId !== null);
  const share = useVoiceStore((state) => state.share);
  const devFailJoin = useVoiceStore((state) => state.devFailJoin);
  const devSetPeerMesh = useVoiceStore((state) => state.devSetPeerMesh);

  // Afinador de §19.1 — função estável fora do seletor: seletor que cria função nova a
  // cada render recoloca o snapshot e o React entra em loop (#185).
  const dropPeer = (a: Attachment): void => {
    const s = useDownloadStore.getState();
    s.aplicarPeerLost(a.id, Math.max(0, (s.peersById[a.id] ?? a.availablePeers) - 1));
  };
  const resetDownloads = useDownloadStore((state) => state.reset);
  const natType = useSettingsStore((state) => state.natType);
  const devSetNatType = useSettingsStore((state) => state.devSetNatType);

  if (!import.meta.env.DEV) return null;

  /**
   * §11, B4 passo 4, na forma que sobrou para o afinador: o estado de host é
   * o do núcleo, e a fila drena sozinha pela outbox. O botão só encena a
   * transição visual; a contagem honesta vem de `query.outbox`.
   */
  function bringHostOnline(communityId: string) {
    setHostStatus(communityId, "reconnecting");
    window.setTimeout(() => {
      setHostStatus(communityId, "online");
    }, RECONNECT_DELAY_MS);
  }

  return (
    /*
      Terceira posição do afinador, e a regra por trás dela: ele não pode
      pousar sobre nenhuma coluna de produto. Em `left-4` cobria o avatar da
      identidade no rail (gatilho de 3.1); em `left-20` caiu sobre a barra de
      chamada persistente, escrevendo "dev" por cima dos participantes.
      Agora fica **depois** do rail (72px) e da lista (240px), e no Mobile
      sobe acima da barra de chamada, que é fixa no rodapé (§16).
    */
    <div className="fixed bottom-20 left-20 z-50 flex flex-col items-start gap-2 tablet:bottom-4 tablet:left-80">
      {open && (
        <div className="flex w-72 flex-col gap-3 rounded-lg border border-border-default bg-surface-elevated p-3 shadow-elevated">
          <p className="text-caption text-text-tertiary uppercase">
            Estado de desenvolvimento
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={seedReferenceDataset}>
              Carregar dataset §2
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                resetCommunities();
                resetMessages();
                resetDownloads();
              }}
            >
              Zerar comunidades
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                resetCommunities();
                resetMessages();
                resetDownloads();
                clearPendingInvite();
                clearIdentity();
              }}
            >
              Apagar identidade
            </Button>
          </div>

          {activeCommunity && (
            <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
              <p className="text-meta text-text-secondary">
                {activeCommunity.name} — host {hostStatus}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setHostStatus(activeCommunity.id, "offline")}
                >
                  Derrubar host
                </Button>
                {/* §10, 3.5 — o navegador não deixa o app desenhar o próprio
                    diálogo de saída, então o aviso só é alcançável por aqui. */}
                <Button variant="secondary" size="sm" onClick={openHostExit}>
                  Fechar app (simular)
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => bringHostOnline(activeCommunity.id)}
                >
                  Host volta
                </Button>
                {topRole && (
                  <Button
                    variant={roleOverridden ? "primary" : "secondary"}
                    size="sm"
                    onClick={() =>
                      setLocalRoleOverride(
                        activeCommunity.id,
                        roleOverridden ? null : [topRole.id],
                      )
                    }
                  >
                    {roleOverridden
                      ? "Voltar ao meu cargo"
                      : `Assumir ${topRole.name}`}
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
            <div className="flex flex-wrap gap-2">
              {activeChannelId && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setTyping(activeChannelId, [IDS.diego]);
                    window.setTimeout(
                      () => setTyping(activeChannelId, []),
                      4000,
                    );
                  }}
                >
                  Diego digitando
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => dropPeer(AULA_WEBRTC_ATTACHMENT)}
              >
                Peer do anexo cai
              </Button>
              {/* §10, 3.1 — o CGNAT de `CLAUDE.md:45` não acontece sozinho. */}
              <Button
                variant={natType === "cgnat" ? "primary" : "secondary"}
                size="sm"
                onClick={() =>
                  devSetNatType(natType === "cgnat" ? "moderate" : "cgnat")
                }
              >
                {natType === "cgnat" ? "CGNAT ✓" : "Detectar CGNAT"}
              </Button>
            </div>
          </div>

          {/*
            Voz e tela (§17.2/§17.5). Os afinadores de TELA saíram nesta fatia: eles
            encenavam árvore, reparo de nó e fallback TURN — as três coisas que A20 e §17.3
            tiraram do v1 (B26). O que sobrou de tela agora vem da rede de verdade, e um
            botão que a contradissesse só produziria estado que o produto não alcança.
          */}
          {inVoice && (
            <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
              <p className="text-meta text-text-secondary">
                Chamada de voz
                {share ? ` — estrela, ${share.viewerCount} espectadores` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={devFailJoin}>
                  Falha total do mesh
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => devSetPeerMesh(IDS.diego, "degraded")}
                >
                  Diego com sinal fraco
                </Button>
              </div>
            </div>
          )}

          <div className="text-meta text-text-tertiary">
            <p className="text-text-secondary">Convites de teste:</p>
            <p>
              <code>x7K2qM</code> válido · <code>X7REV0</code> revogado ·{" "}
              <code>X7BAN1</code> banido
            </p>
          </div>
        </div>
      )}

      <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
        {open ? "Fechar dev" : "dev"}
      </Button>
    </div>
  );
}
