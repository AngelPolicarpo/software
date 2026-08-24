import { create } from "zustand";
import type { Community, HostStatus } from "../domain/types";

/**
 * Saúde de conexão P2P por comunidade (§5.4, §12).
 *
 * O `hostStatus` de fixture (§2) diz como cada comunidade *nasce* — Ateliê
 * Aberto já nasce offline para o fluxo B4. O que muda em tempo de execução
 * (host caindo, reconectando, voltando) vive aqui e sobrepõe a fixture.
 *
 * Não é persistido: estado de conexão é sempre do agora. Ao reabrir o app,
 * quem manda de novo é a fixture.
 */
interface ConnectionState {
  hostStatusOverrides: Record<string, HostStatus>;
  setHostStatus: (communityId: string, status: HostStatus) => void;
  clearHostStatus: (communityId: string) => void;
}

export const useConnectionStore = create<ConnectionState>()((set) => ({
  hostStatusOverrides: {},

  setHostStatus: (communityId, status) =>
    set((state) => ({
      hostStatusOverrides: {
        ...state.hostStatusOverrides,
        [communityId]: status,
      },
    })),

  clearHostStatus: (communityId) =>
    set((state) => {
      const next = { ...state.hostStatusOverrides };
      delete next[communityId];
      return { hostStatusOverrides: next };
    }),
}));

/**
 * Estado atual do host de uma comunidade: o que a sessão mudou, ou o que a
 * fixture definiu. Toda tela que mostra saúde de host passa por aqui — rail,
 * banner e composer não podem discordar entre si.
 */
export function useHostStatus(community: Community | undefined): HostStatus {
  const override = useConnectionStore((state) =>
    community ? state.hostStatusOverrides[community.id] : undefined,
  );
  return override ?? community?.connectionHealth.hostStatus ?? "online";
}

/** §11, B4 passo 4 — o host volta: "Reconectando…" antes de "online". */
export const RECONNECT_DELAY_MS = 1600;
