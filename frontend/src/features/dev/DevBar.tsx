import { useState } from "react";
import { Button } from "../../components/ui/Button";
import {
  selectChannel,
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
import {
  selectQueuedChannelIds,
  useMessageStore,
} from "../../store/messageStore";
import { IDS } from "../../mocks/dataset";

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
  const setLocalRoleOverride = useCommunityStore(
    (state) => state.setLocalRoleOverride,
  );

  const failNextSend = useMessageStore((state) => state.failNextSend);
  const setFailNextSend = useMessageStore((state) => state.setFailNextSend);
  const setTyping = useMessageStore((state) => state.setTyping);
  const resetMessages = useMessageStore((state) => state.reset);

  if (!import.meta.env.DEV) return null;

  /** §11, B4 passo 4: o host volta, reconecta e a fila local é entregue. */
  function bringHostOnline(communityId: string) {
    setHostStatus(communityId, "reconnecting");
    window.setTimeout(() => {
      setHostStatus(communityId, "online");
      const messageState = useMessageStore.getState();
      const communityState = useCommunityStore.getState();
      useMessageStore
        .getState()
        .flushQueued(
          selectQueuedChannelIds(messageState).filter(
            (channelId) =>
              selectChannel(communityState, channelId)?.communityId ===
              communityId,
          ),
        );
    }, RECONNECT_DELAY_MS);
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col items-start gap-2">
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
              <Button
                variant={failNextSend ? "primary" : "secondary"}
                size="sm"
                onClick={() => setFailNextSend(!failNextSend)}
              >
                {failNextSend ? "Próximo envio falha ✓" : "Próximo envio falha"}
              </Button>
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
            </div>
          </div>

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
