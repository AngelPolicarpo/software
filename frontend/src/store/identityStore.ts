import { create } from "zustand";
import type { AvatarColor, Identity, PresenceStatus } from "../domain/types";
import { handleFromDisplayName } from "../lib/avatar";

/**
 * Identidade no renderer — espelho de `query.identity` (§15.6).
 *
 * A fonte da verdade é o NÚCLEO: o par de chaves nasce e vive no cofre
 * (`identity.create`, §15.4), e quem enche esta store é o sincronizador.
 * Nada aqui persiste — uma identidade que só existe no localStorage
 * enquanto o núcleo diz `awaiting-identity` é um fantasma que faz a rota
 * `/` abrir um shell sem núcleo (foi exatamente o que o smoke achou).
 */
export interface CreateIdentityInput {
  displayName: string;
  avatarColor: AvatarColor;
}

interface IdentityState {
  identity: Identity | null;
  /** Escrita local de presença otimista; o núcleo confirma pelo evento. */
  setPresence: (presence: PresenceStatus) => void;
  updateIdentity: (
    patch: Partial<Pick<Identity, "displayName" | "avatarColor">>,
  ) => void;
  /** "Sair desta identidade" (§10, 3.1) — não há recuperação. */
  clearIdentity: () => void;
}

export const useIdentityStore = create<IdentityState>()((set) => ({
  identity: null,

  setPresence: (presence) =>
    set((state) =>
      state.identity
        ? { identity: { ...state.identity, presence } }
        : state,
    ),

  updateIdentity: (patch) =>
    set((state) => {
      if (!state.identity) return state;
      const displayName = patch.displayName?.trim();
      return {
        identity: {
          ...state.identity,
          ...patch,
          ...(displayName
            ? { displayName, handle: handleFromDisplayName(displayName) }
            : {}),
        },
      };
    }),

  clearIdentity: () => set({ identity: null }),
}));
