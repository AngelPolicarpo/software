import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AvatarColor, Identity, PresenceStatus } from "../domain/types";
import { handleFromDisplayName } from "../lib/avatar";

/**
 * Identidade local (§7, 0.1 · fluxo A1).
 *
 * Em P2P não existe "conta": a identidade é um par de chaves gerado e
 * guardado só neste dispositivo (premissa 3, §0). Aqui o par é simulado —
 * a geração real entra com o backend Hyperswarm/Hypercore.
 *
 * Persistido em localStorage via `persist` (§4): é o que decide, na rota
 * `/`, entre Onboarding e Shell.
 */
export interface CreateIdentityInput {
  displayName: string;
  avatarColor: AvatarColor;
}

interface IdentityState {
  identity: Identity | null;
  createIdentity: (input: CreateIdentityInput) => void;
  setPresence: (presence: PresenceStatus) => void;
  updateIdentity: (
    patch: Partial<Pick<Identity, "displayName" | "avatarColor">>,
  ) => void;
  /** "Sair desta identidade" (§10, 3.1) — não há recuperação. */
  clearIdentity: () => void;
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export const useIdentityStore = create<IdentityState>()(
  persist(
    (set) => ({
      identity: null,

      createIdentity: ({ displayName, avatarColor }) => {
        const name = displayName.trim();
        set({
          identity: {
            id: `usr-${randomHex(8)}`,
            handle: handleFromDisplayName(name),
            displayName: name,
            avatarColor,
            publicKey: randomHex(20),
            presence: "online",
            createdAt: new Date().toISOString(),
          },
        });
      },

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
    }),
    { name: "comunidade-p2p:identity", version: 1 },
  ),
);
