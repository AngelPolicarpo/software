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

/**
 * §16, Mobile: uma coluna por vez. Qual das duas está em foco não faz
 * sentido no Tablet/Desktop, onde as duas convivem — por isso é só estado de
 * sessão, sem persistência.
 */
export type MobilePane = "channels" | "content";

interface UiState {
  overlay: OverlayKind;
  joinSource: JoinSource;
  mobilePane: MobilePane;
  openJoinCommunity: (source?: JoinSource) => void;
  openCreateCommunity: () => void;
  closeOverlay: () => void;
  setMobilePane: (pane: MobilePane) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  overlay: null,
  joinSource: "manual",
  mobilePane: "channels",

  openJoinCommunity: (source = "manual") =>
    set({ overlay: "join-community", joinSource: source }),

  openCreateCommunity: () => set({ overlay: "create-community" }),

  closeOverlay: () => set({ overlay: null }),

  setMobilePane: (pane) => set({ mobilePane: pane }),
}));
