import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalizeInviteCode } from "../mocks/dataset";

/**
 * Convite pendente (§4 · fluxo A2).
 *
 * `/invite/:code` é a única rota endereçável além de `/` porque o link é
 * aberto *fora* do app, às vezes por quem nem tem identidade ainda. A rota
 * consome a URL, guarda o código aqui e manda pro onboarding; depois de a
 * identidade existir, o preview (0.3) é retomado a partir deste estado —
 * sem exigir colar o código de novo.
 *
 * Persistido porque um reload no meio do onboarding não pode perder o
 * convite que trouxe a pessoa até aqui.
 */
interface PendingInviteState {
  pendingInviteCode: string | null;
  setPendingInvite: (rawCodeOrLink: string) => void;
  clearPendingInvite: () => void;
}

export const usePendingInviteStore = create<PendingInviteState>()(
  persist(
    (set) => ({
      pendingInviteCode: null,

      setPendingInvite: (rawCodeOrLink) => {
        const code = normalizeInviteCode(rawCodeOrLink);
        set({ pendingInviteCode: code || null });
      },

      clearPendingInvite: () => set({ pendingInviteCode: null }),
    }),
    { name: "comunidade-p2p:pending-invite", version: 1 },
  ),
);
