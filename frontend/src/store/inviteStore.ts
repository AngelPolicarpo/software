import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalizeInviteCode } from "../mocks/dataset";
import type { MessageRef } from "../lib/messageLink";

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

/**
 * Mensagem pendente de um link `/m/:code` (§4 · premissa 10).
 *
 * Mesma mecânica do convite pendente, e pela mesma razão: o link é aberto
 * fora do app, às vezes antes de existir identidade. A rota consome a URL,
 * guarda a referência aqui e devolve para `/`; o shell resolve quando
 * estiver de pé. Persistido porque um reload no meio do onboarding não pode
 * perder a mensagem que trouxe a pessoa até aqui.
 */
interface PendingMessageState {
  pendingMessage: MessageRef | null;
  /** `null` quando o código do link não decodifica (§4, link inválido). */
  pendingMessageInvalid: boolean;
  setPendingMessage: (ref: MessageRef | null) => void;
  clearPendingMessage: () => void;
}

export const usePendingMessageStore = create<PendingMessageState>()(
  persist(
    (set) => ({
      pendingMessage: null,
      pendingMessageInvalid: false,

      setPendingMessage: (ref) =>
        set({ pendingMessage: ref, pendingMessageInvalid: ref === null }),

      clearPendingMessage: () =>
        set({ pendingMessage: null, pendingMessageInvalid: false }),
    }),
    { name: "comunidade-p2p:pending-message", version: 1 },
  ),
);
