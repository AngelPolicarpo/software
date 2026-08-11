import { create } from "zustand";

/**
 * Estado de sessão da interface (§4) — nada disso vive no router, porque
 * nenhuma dessas coisas é um recurso endereçável.
 *
 * Só o que a Camada 0 precisa por enquanto; painéis (membros/busca/thread),
 * modais de configuração e estado de voz entram nas camadas seguintes.
 */
export type OverlayKind =
  | "join-community"
  | "create-community"
  /** §10, 3.1 — configurações de conta, independentes de comunidade. */
  | "account-settings"
  /** §10, 3.1b — configurações da comunidade ativa (Geral/Cargos/Moderação). */
  | "community-settings"
  | null;

/** De onde 0.3 foi aberta — muda se o passo 1 (colar código) aparece. */
export type JoinSource = "manual" | "link";

/**
 * §16, Mobile: uma coluna por vez. Qual das duas está em foco não faz
 * sentido no Tablet/Desktop, onde as duas convivem — por isso é só estado de
 * sessão, sem persistência.
 */
export type MobilePane = "channels" | "content";

/**
 * Slot único de painel à direita (§6, §15): membros e thread dividem o
 * mesmo espaço, então abrir um fecha o outro por construção — é um valor só,
 * não dois booleanos que poderiam ficar ambos verdadeiros.
 *
 * A busca (1.2) *não* entra aqui: §8 a descreve como overlay centralizado no
 * topo (command palette), não como painel lateral.
 */
export type RightPanel =
  | { kind: "members" }
  | { kind: "thread"; rootMessageId: string }
  | null;

/**
 * Escopo inicial da busca (§8, 1.2): o ícone de lupa do canal abre no canal
 * atual; `Cmd/Ctrl+K` abre na comunidade inteira. Um motor, dois pontos de
 * entrada — e dá para trocar de escopo sem fechar.
 */
export type SearchScope = "channel" | "community";

/** §9, 2.1 — highlight breve da mensagem alcançada por busca ou link. */
export const HIGHLIGHT_MS = 1500;

interface UiState {
  overlay: OverlayKind;
  joinSource: JoinSource;
  mobilePane: MobilePane;
  rightPanel: RightPanel;
  searchScope: SearchScope | null;
  highlightedMessageId: string | null;
  openJoinCommunity: (source?: JoinSource) => void;
  openCreateCommunity: () => void;
  openAccountSettings: () => void;
  openCommunitySettings: () => void;
  closeOverlay: () => void;
  setMobilePane: (pane: MobilePane) => void;
  toggleMembersPanel: () => void;
  openThreadPanel: (rootMessageId: string) => void;
  closeRightPanel: () => void;
  openSearch: (scope: SearchScope) => void;
  setSearchScope: (scope: SearchScope) => void;
  closeSearch: () => void;
  highlightMessage: (messageId: string) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  overlay: null,
  joinSource: "manual",
  mobilePane: "channels",
  rightPanel: null,
  searchScope: null,
  highlightedMessageId: null,

  openJoinCommunity: (source = "manual") =>
    set({ overlay: "join-community", joinSource: source }),

  openCreateCommunity: () => set({ overlay: "create-community" }),

  openAccountSettings: () => set({ overlay: "account-settings" }),

  openCommunitySettings: () => set({ overlay: "community-settings" }),

  closeOverlay: () => set({ overlay: null }),

  setMobilePane: (pane) => set({ mobilePane: pane }),

  toggleMembersPanel: () =>
    set((state) => ({
      rightPanel: state.rightPanel?.kind === "members" ? null : { kind: "members" },
    })),

  openThreadPanel: (rootMessageId) =>
    set({ rightPanel: { kind: "thread", rootMessageId } }),

  closeRightPanel: () => set({ rightPanel: null }),

  openSearch: (scope) => set({ searchScope: scope }),
  setSearchScope: (scope) => set({ searchScope: scope }),
  closeSearch: () => set({ searchScope: null }),

  highlightMessage: (messageId) => {
    set({ highlightedMessageId: messageId });
    window.setTimeout(() => {
      // Só apaga se ainda for a mesma: outra busca no meio manda nela.
      if (useUiStore.getState().highlightedMessageId === messageId)
        set({ highlightedMessageId: null });
    }, HIGHLIGHT_MS);
  },
}));
