import { create } from "zustand";

/**
 * Estado de sessão da interface (§4) — nada disso vive no router, porque
 * nenhuma dessas coisas é um recurso endereçável.
 *
 * Só o que a Camada 0 precisa por enquanto; painéis (membros/busca/thread),
 * modais de configuração e estado de voz entram nas camadas seguintes.
 */
export type OverlayKind = "join-community" | "create-community" | null;

/** De onde 0.3 foi aberta — muda se o passo 1 (colar código) aparece. */
export type JoinSource = "manual" | "link";

interface UiState {
  overlay: OverlayKind;
  joinSource: JoinSource;
  openJoinCommunity: (source?: JoinSource) => void;
  openCreateCommunity: () => void;
  closeOverlay: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  overlay: null,
  joinSource: "manual",

  openJoinCommunity: (source = "manual") =>
    set({ overlay: "join-community", joinSource: source }),

  openCreateCommunity: () => set({ overlay: "create-community" }),

  closeOverlay: () => set({ overlay: null }),
}));
