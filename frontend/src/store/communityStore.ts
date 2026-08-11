import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import type {
  AvatarColor,
  Category,
  Channel,
  Community,
  Role,
} from "../domain/types";
import {
  ALL_PERMISSIONS,
  BASE_MEMBER_PERMISSIONS,
  CATEGORIES,
  CHANNELS,
  COMMUNITIES,
  COMMUNITY_ORDER,
  findMember,
  IDS,
  ROLES,
} from "../mocks/dataset";

/**
 * Comunidades das quais a identidade local participa (§7 0.3/0.4 · §8 1.1).
 *
 * Duas fontes de dado convivem de propósito: as comunidades de §2 vivem nas
 * fixtures (o "mundo" que já existe) e a store guarda só de quais delas Ana
 * participa; as comunidades que Ana cria no mock não existem em fixture
 * nenhuma, então moram aqui. Resolver um id sempre passa por
 * `selectCommunity`, que olha os dois lugares.
 *
 * Persistido (§4): comunidade e canal ativos sobrevivem entre sessões.
 */
export interface CreateCommunityInput {
  name: string;
  description?: string;
  iconColor: AvatarColor;
}

interface CommunityState {
  /** Ordem do rail = ordem de entrada/criação, nunca alfabética (§14). */
  joinedCommunityIds: string[];
  /** Comunidades das quais esta identidade foi banida (preview de 0.3). */
  bannedCommunityIds: string[];
  activeCommunityId: string | null;
  /** Último canal aberto por comunidade — restaurado ao trocar (§4). */
  activeChannelByCommunity: Record<string, string>;
  /**
   * Categorias colapsadas, lembradas por comunidade (§8, 1.1). O estado de
   * colapso é de quem lê, não da comunidade — por isso mora aqui e não no
   * `collapsed` da fixture, que só descreve como a categoria nasce.
   */
  collapsedCategoryIds: Record<string, string[]>;

  createdCommunities: Record<string, Community>;
  createdCategories: Record<string, Category>;
  createdChannels: Record<string, Channel>;
  createdRoles: Record<string, Role>;

  joinCommunity: (communityId: string) => void;
  createCommunity: (input: CreateCommunityInput) => string;
  setActiveCommunity: (communityId: string) => void;
  setActiveChannel: (communityId: string, channelId: string) => void;
  toggleCategoryCollapsed: (communityId: string, categoryId: string) => void;

  /** Só para desenvolvimento (§19.1) — carrega o rail de §2 de uma vez. */
  seedReferenceDataset: () => void;
  /** Só para desenvolvimento — volta ao estado de 0 comunidades. */
  resetCommunities: () => void;
}

function randomId(prefix: string): string {
  const buffer = new Uint8Array(6);
  crypto.getRandomValues(buffer);
  const hex = Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${prefix}-${hex}`;
}

const EMPTY_STATE = {
  joinedCommunityIds: [] as string[],
  bannedCommunityIds: [] as string[],
  activeCommunityId: null,
  activeChannelByCommunity: {} as Record<string, string>,
  collapsedCategoryIds: {} as Record<string, string[]>,
  createdCommunities: {} as Record<string, Community>,
  createdCategories: {} as Record<string, Category>,
  createdChannels: {} as Record<string, Channel>,
  createdRoles: {} as Record<string, Role>,
};

export const useCommunityStore = create<CommunityState>()(
  persist(
    (set, get) => ({
      ...EMPTY_STATE,

      joinCommunity: (communityId) => {
        const state = get();
        if (state.joinedCommunityIds.includes(communityId)) {
          set({ activeCommunityId: communityId });
          return;
        }
        set({
          joinedCommunityIds: [...state.joinedCommunityIds, communityId],
          activeCommunityId: communityId,
        });
      },

      createCommunity: ({ name, description, iconColor }) => {
        const communityId = randomId("com");
        const categoryId = randomId("cat");
        const channelId = randomId("ch");
        const founderRoleId = randomId("role");
        const memberRoleId = randomId("role");
        const now = new Date().toISOString();

        // Cargo "Fundador" atribuído automaticamente a quem cria (§11, A3).
        const founder: Role = {
          id: founderRoleId,
          name: "Fundador",
          color: "role-gold",
          position: 2,
          permissions: ALL_PERMISSIONS,
          mentionable: true,
          memberCount: 1,
          isFounder: true,
        };
        const member: Role = {
          id: memberRoleId,
          name: "Membro",
          color: "role-neutral",
          position: 1,
          permissions: BASE_MEMBER_PERMISSIONS,
          mentionable: false,
          memberCount: 1,
          isDefault: true,
        };

        // Nunca uma comunidade sem nenhum canal (§7, 0.4).
        const category: Category = {
          id: categoryId,
          communityId,
          name: "GERAL",
          channelIds: [channelId],
          collapsed: false,
        };
        const channel: Channel = {
          id: channelId,
          communityId,
          categoryId,
          type: "text",
          name: "geral",
          unreadCount: 0,
          pendingMentions: 0,
          muted: false,
        };

        const community: Community = {
          id: communityId,
          name: name.trim(),
          iconColor,
          description: description?.trim() || undefined,
          // A comunidade roda na máquina de quem a criou (`CLAUDE.md:5`).
          hostPeerId: IDS.ana,
          isHostedByMe: true,
          createdAt: now,
          memberCount: 1,
          categoryIds: [categoryId],
          roleIds: [founderRoleId, memberRoleId],
          connectionHealth: { hostStatus: "online" },
        };

        const state = get();
        set({
          createdCommunities: {
            ...state.createdCommunities,
            [communityId]: community,
          },
          createdCategories: {
            ...state.createdCategories,
            [categoryId]: category,
          },
          createdChannels: { ...state.createdChannels, [channelId]: channel },
          createdRoles: {
            ...state.createdRoles,
            [founderRoleId]: founder,
            [memberRoleId]: member,
          },
          joinedCommunityIds: [...state.joinedCommunityIds, communityId],
          activeCommunityId: communityId,
          activeChannelByCommunity: {
            ...state.activeChannelByCommunity,
            [communityId]: channelId,
          },
        });

        return communityId;
      },

      setActiveCommunity: (communityId) =>
        set({ activeCommunityId: communityId }),

      setActiveChannel: (communityId, channelId) =>
        set((state) => ({
          activeChannelByCommunity: {
            ...state.activeChannelByCommunity,
            [communityId]: channelId,
          },
        })),

      toggleCategoryCollapsed: (communityId, categoryId) =>
        set((state) => {
          const current = state.collapsedCategoryIds[communityId] ?? [];
          const next = current.includes(categoryId)
            ? current.filter((id) => id !== categoryId)
            : [...current, categoryId];
          return {
            collapsedCategoryIds: {
              ...state.collapsedCategoryIds,
              [communityId]: next,
            },
          };
        }),

      seedReferenceDataset: () =>
        set((state) => ({
          joinedCommunityIds: [...COMMUNITY_ORDER],
          activeCommunityId: state.activeCommunityId ?? COMMUNITY_ORDER[0],
        })),

      resetCommunities: () => set({ ...EMPTY_STATE }),
    }),
    { name: "comunidade-p2p:communities", version: 1 },
  ),
);

/* ─── Seletores ──────────────────────────────────────────────────── */

type State = CommunityState;

export function selectCommunity(
  state: State,
  communityId: string | null,
): Community | undefined {
  if (!communityId) return undefined;
  return state.createdCommunities[communityId] ?? COMMUNITIES[communityId];
}

export function selectJoinedCommunities(state: State): Community[] {
  return state.joinedCommunityIds
    .map((id) => selectCommunity(state, id))
    .filter((community): community is Community => community !== undefined);
}

/**
 * Hook para os seletores que montam um array novo a cada chamada.
 * Sem comparação rasa, a store devolveria uma referência diferente em todo
 * render e o `useSyncExternalStore` do Zustand entraria em loop — use este
 * hook em componentes, nunca `useCommunityStore(selectJoinedCommunities)`.
 */
export function useJoinedCommunities(): Community[] {
  return useCommunityStore(useShallow(selectJoinedCommunities));
}

export function useCategories(communityId: string | null): Category[] {
  return useCommunityStore(
    useShallow((state: State) =>
      communityId ? selectCategories(state, communityId) : [],
    ),
  );
}

export function selectCategories(
  state: State,
  communityId: string,
): Category[] {
  const community = selectCommunity(state, communityId);
  if (!community) return [];
  return community.categoryIds
    .map((id) => state.createdCategories[id] ?? CATEGORIES[id])
    .filter((category): category is Category => category !== undefined);
}

export function selectChannel(
  state: State,
  channelId: string,
): Channel | undefined {
  return state.createdChannels[channelId] ?? CHANNELS[channelId];
}

export function selectRole(state: State, roleId: string): Role | undefined {
  return state.createdRoles[roleId] ?? ROLES[roleId];
}

/**
 * Primeiro canal de texto da primeira categoria — destino padrão ao entrar
 * numa comunidade (§7, 0.3/0.4) ou ao visitá-la pela primeira vez (§4).
 */
export function selectFirstTextChannelId(
  state: State,
  communityId: string,
): string | undefined {
  for (const category of selectCategories(state, communityId)) {
    for (const channelId of category.channelIds) {
      const channel = selectChannel(state, channelId);
      if (channel?.type === "text") return channel.id;
    }
  }
  return undefined;
}

/**
 * Canal aberto na comunidade ativa. Se o canal lembrado não resolve mais
 * (ou a comunidade nunca foi visitada), cai no primeiro canal de texto —
 * assim a área de conteúdo nunca renderiza vazia esperando um efeito.
 */
export function useActiveChannel(): Channel | undefined {
  return useCommunityStore((state) => {
    const communityId = state.activeCommunityId;
    if (!communityId) return undefined;

    const channelId = state.activeChannelByCommunity[communityId];
    const channel = channelId ? selectChannel(state, channelId) : undefined;
    if (channel) return channel;

    const firstId = selectFirstTextChannelId(state, communityId);
    return firstId ? selectChannel(state, firstId) : undefined;
  });
}

export function useChannels(channelIds: string[]): Channel[] {
  return useCommunityStore(
    useShallow((state: State) =>
      channelIds
        .map((id) => selectChannel(state, id))
        .filter((channel): channel is Channel => channel !== undefined),
    ),
  );
}

export function useCollapsedCategoryIds(communityId: string | null): string[] {
  return useCommunityStore(
    useShallow((state: State) =>
      communityId ? (state.collapsedCategoryIds[communityId] ?? []) : [],
    ),
  );
}

/**
 * Cargos da identidade local *dentro* desta comunidade.
 *
 * Nas comunidades de §2 a identidade local ocupa o lugar de Ana Torres — o
 * mock não tem rede para materializar duas pessoas distintas, e §19.2 pede
 * que Ana seja a mesma entidade em toda tela. Nas comunidades criadas aqui,
 * quem cria é a fundadora (§11, A3).
 */
export function selectLocalMemberRoleIds(
  state: State,
  communityId: string,
): string[] {
  if (state.createdCommunities[communityId]) {
    return state.createdCommunities[communityId].roleIds;
  }
  return findMember(communityId, IDS.ana)?.roleIds ?? [];
}

/** Cargo mais alto da hierarquia entre os informados (§10, regra de cargo). */
export function selectHighestRole(
  state: State,
  roleIds: string[],
): Role | undefined {
  let highest: Role | undefined;
  for (const roleId of roleIds) {
    const role = selectRole(state, roleId);
    if (!role) continue;
    if (!highest || role.position > highest.position) highest = role;
  }
  return highest;
}

/**
 * Canal somente-leitura para a identidade local (§9, 2.1 — `#avisos`).
 * Vale quando *todos* os cargos dela estão na lista de somente-leitura:
 * basta um cargo de fora (Moderador+) para liberar o composer.
 */
export function selectIsChannelReadOnly(
  state: State,
  channel: Channel,
): boolean {
  const readOnlyFor = channel.readOnlyForRoleIds;
  if (!readOnlyFor || readOnlyFor.length === 0) return false;
  const roleIds = selectLocalMemberRoleIds(state, channel.communityId);
  if (roleIds.length === 0) return false;
  return roleIds.every((roleId) => readOnlyFor.includes(roleId));
}
