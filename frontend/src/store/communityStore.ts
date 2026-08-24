import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { useIdentityStore } from "./identityStore";
import type {
  AvatarColor,
  Category,
  Channel,
  ChannelType,
  Community,
  Invite,
  Member,
  Permission,
  Role,
} from "../domain/types";
// As tabelas de permissão são constantes de produto (§10), não fixture de dado: seguem
// vindo daqui. Tudo que era DADO — comunidades, categorias, canais, cargos, convites,
// membros — passou para o espelho de `remote`, preenchido pela IPC-R.
import { ALL_PERMISSIONS, BASE_MEMBER_PERMISSIONS } from "../mocks/dataset";

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

/** §10, 3.4 — canal nasce numa categoria, sempre (§7, 0.4). */
export interface CreateChannelInput {
  communityId: string;
  categoryId: string;
  type: ChannelType;
  name: string;
  topic?: string;
  /** Cargos que **não** postam aqui — é assim que `#avisos` existe (§2). */
  readOnlyForRoleIds?: string[];
}

/** §13 — expiração e limite de usos são opcionais (premissa 4). */
export interface CreateInviteInput {
  communityId: string;
  createdById: string;
  expiresInDays?: number;
  maxUses?: number;
}

/**
 * Espelho do que o núcleo respondeu — o lugar das fixtures.
 *
 * Os seletores desta store sempre resolveram `criado[id] ?? fixture[id] + override`. A
 * fatia de ligação com a IPC-R troca **só a fonte**: as fixtures de `mocks/dataset` saem e
 * este espelho entra, preenchido pelos adaptadores de §15.6. Nenhum seletor muda de forma e
 * nenhum componente sabe que a origem mudou — que é o ponto.
 *
 * Vive DENTRO do estado do Zustand (e não num módulo à parte) porque é isso que faz os
 * componentes re-renderizarem quando o núcleo responde.
 */
export interface EspelhoRemoto {
  communities: Record<string, Community>;
  /** Ordem de `query.communities` — que é a ordem de entrada (§15.6). */
  order: string[];
  categories: Record<string, Category>;
  channels: Record<string, Channel>;
  roles: Record<string, Role>;
  invites: Invite[];
  membersByCommunity: Record<string, Member[]>;
  /** Chave da identidade local: quem o mock chamava de `IDS.ana`. */
  euId: string | null;
}

export const ESPELHO_VAZIO: EspelhoRemoto = {
  communities: {},
  order: [],
  categories: {},
  channels: {},
  roles: {},
  invites: [],
  membersByCommunity: {},
  euId: null,
};

interface CommunityState {
  /** O que o núcleo respondeu (§15.6), no lugar das fixtures. */
  remote: EspelhoRemoto;
  /** Aplica um lote vindo do núcleo. Substitui, nunca mescla por baixo. */
  aplicarRemoto: (patch: Partial<EspelhoRemoto>) => void;
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
  /**
   * Canais abertos recentemente, por comunidade, do mais recente para o mais
   * antigo — é o que a busca mostra antes de o usuário digitar (§8, 1.2).
   */
  recentChannelIds: Record<string, string[]>;
  /**
   * Cargos que a identidade local assume numa comunidade, sobrepondo os da
   * fixture. Existe para §19.1: com uma identidade só, sem isto não há como
   * alcançar a UI que depende de permissão (deletar mensagem de outro autor,
   * por exemplo). Não é persistido.
   */
  localRoleOverrides: Record<string, string[]>;

  createdCommunities: Record<string, Community>;
  createdCategories: Record<string, Category>;
  createdChannels: Record<string, Channel>;
  createdRoles: Record<string, Role>;

  /**
   * Edições de §10 (3.1b/3.2) sobre o que a fixture define. Mesma divisão do
   * `messageStore`: a fixture continua intacta e recarregar devolve o app ao
   * estado documentado em §2, que é o que §19 manda conferir.
   */
  communityOverrides: Record<string, Partial<Community>>;
  roleOverrides: Record<string, Partial<Role>>;
  deletedRoleIds: string[];
  /**
   * §10, 3.4 — edições de canal/categoria sobre a fixture, na mesma divisão
   * das comunidades e cargos. `channelOverrides` também carrega o que é
   * preferência de quem lê (silenciado, lido) — §8, 1.1.1.
   */
  channelOverrides: Record<string, Partial<Channel>>;
  deletedChannelIds: string[];
  categoryOverrides: Record<string, Partial<Category>>;
  deletedCategoryIds: string[];
  /** Cargos atribuídos a um membro nesta sessão (§10, 3.2 · §8, 1.4). */
  memberRoleOverrides: Record<string, Record<string, string[]>>;
  /**
   * Apelido por comunidade (§8, 1.4 · premissa 11) — auto-atribuído, então
   * na prática só a identidade local escreve aqui. String vazia significa
   * "removi meu apelido", que é diferente de "nunca defini".
   */
  memberNicknames: Record<string, Record<string, string>>;
  createdInvites: Invite[];
  revokedInviteCodes: string[];

  joinCommunity: (communityId: string) => void;
  createCommunity: (input: CreateCommunityInput) => string;
  setActiveCommunity: (communityId: string) => void;
  setActiveChannel: (communityId: string, channelId: string) => void;
  toggleCategoryCollapsed: (communityId: string, categoryId: string) => void;
  /** Só §19.1 — `null` devolve os cargos da fixture. */
  setLocalRoleOverride: (communityId: string, roleIds: string[] | null) => void;

  /* §10, 3.1b — metadados, convites e zona de perigo. */
  updateCommunity: (communityId: string, patch: Partial<Community>) => void;
  createInvite: (input: CreateInviteInput) => Invite;
  revokeInvite: (code: string) => void;
  /** Sair da comunidade; o host precisa encerrar, não sair (§18). */
  leaveCommunity: (communityId: string) => void;
  endCommunity: (communityId: string) => void;

  /* §10, 3.2 — cargos. */
  createRole: (communityId: string) => string;
  updateRole: (roleId: string, patch: Partial<Role>) => void;
  deleteRole: (communityId: string, roleId: string) => void;
  /** Reordena a hierarquia; Fundador nunca sai do topo (§10, D13). */
  moveRole: (communityId: string, roleId: string, direction: -1 | 1) => void;
  setMemberRoles: (
    communityId: string,
    identityId: string,
    roleIds: string[],
  ) => void;
  /** `null` remove o apelido e volta a exibir o nome de identidade. */
  setMemberNickname: (
    communityId: string,
    identityId: string,
    nickname: string | null,
  ) => void;

  /* §10, 3.4 — canais e categorias. */
  createChannel: (input: CreateChannelInput) => string;
  updateChannel: (channelId: string, patch: Partial<Channel>) => void;
  /** Move entre categorias; canal novo entra no fim da destino (§14). */
  moveChannel: (channelId: string, categoryId: string) => void;
  deleteChannel: (communityId: string, channelId: string) => void;
  createCategory: (communityId: string, name: string) => string;
  renameCategory: (categoryId: string, name: string) => void;
  /**
   * `moveChannelsToId` move os canais para outra categoria; sem ele, exclui
   * a categoria **e** os canais dentro (§10, 3.4 — os dois caminhos do modal).
   */
  deleteCategory: (
    communityId: string,
    categoryId: string,
    moveChannelsToId?: string,
  ) => void;

  /* §8, 1.1.1 — preferências de leitura, locais de quem lê. */
  toggleChannelMuted: (channelId: string) => void;
  markChannelRead: (channelId: string) => void;

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

/**
 * Categoria e canal existem em dois lugares — fixture de §2 ou criados no
 * app —, e escrever em cada um é um `set` diferente. Estes dois helpers
 * devolvem a fatia de estado a mesclar, para as ações de 3.4 não repetirem o
 * mesmo galho seis vezes.
 */
function categoryPatch(
  state: CommunityState,
  categoryId: string,
  patch: Partial<Category>,
): Partial<CommunityState> {
  const created = state.createdCategories[categoryId];
  if (created)
    return {
      createdCategories: {
        ...state.createdCategories,
        [categoryId]: { ...created, ...patch },
      },
    };
  return {
    categoryOverrides: {
      ...state.categoryOverrides,
      [categoryId]: { ...(state.categoryOverrides[categoryId] ?? {}), ...patch },
    },
  };
}

function channelPatch(
  state: CommunityState,
  channelId: string,
  patch: Partial<Channel>,
): Partial<CommunityState> {
  const created = state.createdChannels[channelId];
  if (created)
    return {
      createdChannels: {
        ...state.createdChannels,
        [channelId]: { ...created, ...patch },
      },
    };
  return {
    channelOverrides: {
      ...state.channelOverrides,
      [channelId]: { ...(state.channelOverrides[channelId] ?? {}), ...patch },
    },
  };
}

const EMPTY_STATE = {
  joinedCommunityIds: [] as string[],
  bannedCommunityIds: [] as string[],
  activeCommunityId: null,
  activeChannelByCommunity: {} as Record<string, string>,
  collapsedCategoryIds: {} as Record<string, string[]>,
  recentChannelIds: {} as Record<string, string[]>,
  localRoleOverrides: {} as Record<string, string[]>,
  communityOverrides: {} as Record<string, Partial<Community>>,
  roleOverrides: {} as Record<string, Partial<Role>>,
  deletedRoleIds: [] as string[],
  channelOverrides: {} as Record<string, Partial<Channel>>,
  deletedChannelIds: [] as string[],
  categoryOverrides: {} as Record<string, Partial<Category>>,
  deletedCategoryIds: [] as string[],
  memberRoleOverrides: {} as Record<string, Record<string, string[]>>,
  memberNicknames: {} as Record<string, Record<string, string>>,
  createdInvites: [] as Invite[],
  revokedInviteCodes: [] as string[],
  createdCommunities: {} as Record<string, Community>,
  createdCategories: {} as Record<string, Category>,
  createdChannels: {} as Record<string, Channel>,
  createdRoles: {} as Record<string, Role>,
};

export const useCommunityStore = create<CommunityState>()(
  persist(
    (set, get) => ({
      ...EMPTY_STATE,
      remote: ESPELHO_VAZIO,

      aplicarRemoto: (patch) => {
        set((state) => ({ remote: { ...state.remote, ...patch } }));
      },

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
          hostPeerId: get().remote.euId ?? "",
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
        set((state) => {
          const recent = state.recentChannelIds[communityId] ?? [];
          return {
            activeChannelByCommunity: {
              ...state.activeChannelByCommunity,
              [communityId]: channelId,
            },
            recentChannelIds: {
              ...state.recentChannelIds,
              [communityId]: [
                channelId,
                ...recent.filter((id) => id !== channelId),
              ].slice(0, 5),
            },
          };
        }),

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

      setLocalRoleOverride: (communityId, roleIds) =>
        set((state) => {
          const next = { ...state.localRoleOverrides };
          if (roleIds === null) delete next[communityId];
          else next[communityId] = roleIds;
          return { localRoleOverrides: next };
        }),

      /* ─── §10, 3.1b — comunidade e convites ────────────────────── */

      updateCommunity: (communityId, patch) =>
        set((state) =>
          state.createdCommunities[communityId]
            ? {
                createdCommunities: {
                  ...state.createdCommunities,
                  [communityId]: {
                    ...state.createdCommunities[communityId],
                    ...patch,
                  },
                },
              }
            : {
                communityOverrides: {
                  ...state.communityOverrides,
                  [communityId]: {
                    ...state.communityOverrides[communityId],
                    ...patch,
                  },
                },
              },
        ),

      createInvite: ({ communityId, createdById, expiresInDays, maxUses }) => {
        // Código curto no mesmo formato de §2 (`x7K2qM`): 6 caracteres.
        const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const bytes = new Uint8Array(6);
        crypto.getRandomValues(bytes);
        const code = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");

        const invite: Invite = {
          code,
          communityId,
          createdById,
          createdAt: new Date().toISOString(),
          expiresAt: expiresInDays
            ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
            : undefined,
          maxUses,
          uses: 0,
          revoked: false,
        };
        set((state) => ({ createdInvites: [invite, ...state.createdInvites] }));
        return invite;
      },

      revokeInvite: (code) =>
        set((state) => ({
          revokedInviteCodes: [...state.revokedInviteCodes, code],
        })),

      leaveCommunity: (communityId) =>
        set((state) => ({
          joinedCommunityIds: state.joinedCommunityIds.filter(
            (id) => id !== communityId,
          ),
          activeCommunityId:
            state.activeCommunityId === communityId
              ? null
              : state.activeCommunityId,
        })),

      endCommunity: (communityId) =>
        set((state) => {
          const createdCommunities = { ...state.createdCommunities };
          delete createdCommunities[communityId];
          return {
            createdCommunities,
            joinedCommunityIds: state.joinedCommunityIds.filter(
              (id) => id !== communityId,
            ),
            activeCommunityId:
              state.activeCommunityId === communityId
                ? null
                : state.activeCommunityId,
          };
        }),

      /* ─── §10, 3.2 — cargos ────────────────────────────────────── */

      createRole: (communityId) => {
        const roleId = randomId("role");
        const state = get();
        const roles = selectRoles(state, communityId);
        // Entra logo abaixo do topo da hierarquia de quem já existe, nunca
        // acima do Fundador (§10, D13).
        const highest = roles[0]?.position ?? 1;

        const role: Role = {
          id: roleId,
          name: "",
          color: "role-neutral",
          position: Math.max(1, highest - 0.5),
          permissions: [],
          mentionable: false,
          memberCount: 0,
        };

        set({
          createdRoles: { ...state.createdRoles, [roleId]: role },
        });
        get().updateCommunity(communityId, {
          roleIds: [...(selectCommunity(get(), communityId)?.roleIds ?? []), roleId],
        });
        return roleId;
      },

      updateRole: (roleId, patch) =>
        set((state) =>
          state.createdRoles[roleId]
            ? {
                createdRoles: {
                  ...state.createdRoles,
                  [roleId]: { ...state.createdRoles[roleId], ...patch },
                },
              }
            : {
                roleOverrides: {
                  ...state.roleOverrides,
                  [roleId]: { ...state.roleOverrides[roleId], ...patch },
                },
              },
        ),

      deleteRole: (communityId, roleId) =>
        set((state) => {
          const memberRoles = { ...(state.memberRoleOverrides[communityId] ?? {}) };
          // O cargo some; os membros ficam (§10, 3.2).
          for (const [identityId, roleIds] of Object.entries(memberRoles)) {
            memberRoles[identityId] = roleIds.filter((id) => id !== roleId);
          }
          return {
            deletedRoleIds: [...state.deletedRoleIds, roleId],
            memberRoleOverrides: {
              ...state.memberRoleOverrides,
              [communityId]: memberRoles,
            },
          };
        }),

      moveRole: (communityId, roleId, direction) => {
        const state = get();
        const roles = selectRoles(state, communityId);
        const index = roles.findIndex((role) => role.id === roleId);
        if (index < 0) return;
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= roles.length) return;

        const moving = roles[index];
        const target = roles[targetIndex];
        // Fundador é sempre o topo, posição fixa (§10, D13, exceções).
        if (moving.isFounder || target.isFounder) return;

        get().updateRole(moving.id, { position: target.position });
        get().updateRole(target.id, { position: moving.position });
      },

      setMemberRoles: (communityId, identityId, roleIds) =>
        set((state) => ({
          memberRoleOverrides: {
            ...state.memberRoleOverrides,
            [communityId]: {
              ...(state.memberRoleOverrides[communityId] ?? {}),
              [identityId]: roleIds,
            },
          },
        })),

      setMemberNickname: (communityId, identityId, nickname) =>
        set((state) => ({
          memberNicknames: {
            ...state.memberNicknames,
            [communityId]: {
              ...(state.memberNicknames[communityId] ?? {}),
              [identityId]: nickname?.trim() ?? "",
            },
          },
        })),

      /* ─── §10, 3.4 — canais e categorias ───────────────────────── */

      createChannel: ({
        communityId,
        categoryId,
        type,
        name,
        topic,
        readOnlyForRoleIds,
      }) => {
        const channelId = randomId("channel");
        const channel: Channel = {
          id: channelId,
          communityId,
          categoryId,
          type,
          name,
          topic: topic?.trim() || undefined,
          unreadCount: 0,
          pendingMentions: 0,
          muted: false,
          readOnlyForRoleIds: readOnlyForRoleIds?.length
            ? readOnlyForRoleIds
            : undefined,
        };

        set((state) => {
          const category = selectCategory(state, categoryId);
          const next: Partial<CommunityState> = {
            createdChannels: { ...state.createdChannels, [channelId]: channel },
          };

          // Canal novo entra no fim da sua categoria (§14).
          if (category)
            Object.assign(
              next,
              categoryPatch(state, categoryId, {
                channelIds: [...category.channelIds, channelId],
              }),
            );

          // Categoria colapsada expande sozinha, senão a criação parece não
          // ter surtido efeito (§18).
          const collapsed = state.collapsedCategoryIds[communityId] ?? [];
          if (collapsed.includes(categoryId))
            next.collapsedCategoryIds = {
              ...state.collapsedCategoryIds,
              [communityId]: collapsed.filter((id) => id !== categoryId),
            };

          return next;
        });

        return channelId;
      },

      updateChannel: (channelId, patch) =>
        set((state) => channelPatch(state, channelId, patch)),

      moveChannel: (channelId, categoryId) =>
        set((state) => {
          const channel = selectChannel(state, channelId);
          if (!channel || channel.categoryId === categoryId) return {};

          const from = selectCategory(state, channel.categoryId);
          const to = selectCategory(state, categoryId);
          if (!to) return {};

          const next: Partial<CommunityState> = {};
          if (from)
            Object.assign(
              next,
              categoryPatch(state, from.id, {
                channelIds: from.channelIds.filter((id) => id !== channelId),
              }),
            );
          // O `set` acima já pode ter tocado a mesma fatia; reler do objeto
          // acumulado mantém as duas categorias consistentes num `set` só.
          const merging = { ...state, ...next } as CommunityState;
          Object.assign(
            next,
            categoryPatch(merging, categoryId, {
              // Entra no fim da categoria de destino (§14).
              channelIds: [...to.channelIds, channelId],
            }),
          );
          Object.assign(
            next,
            channelPatch({ ...state, ...next } as CommunityState, channelId, {
              categoryId,
            }),
          );
          return next;
        }),

      deleteChannel: (communityId, channelId) =>
        set((state) => {
          const channel = selectChannel(state, channelId);
          if (!channel) return {};

          const next: Partial<CommunityState> = {
            deletedChannelIds: [...state.deletedChannelIds, channelId],
          };

          const category = selectCategory(state, channel.categoryId);
          if (category)
            Object.assign(
              next,
              categoryPatch(state, category.id, {
                channelIds: category.channelIds.filter((id) => id !== channelId),
              }),
            );

          // O canal ativo não pode apontar para o que não existe mais; sem
          // isto `useActiveChannel` cairia no fallback a cada render.
          if (state.activeChannelByCommunity[communityId] === channelId) {
            const rest = { ...state.activeChannelByCommunity };
            delete rest[communityId];
            next.activeChannelByCommunity = rest;
          }
          const recent = state.recentChannelIds[communityId];
          if (recent?.includes(channelId))
            next.recentChannelIds = {
              ...state.recentChannelIds,
              [communityId]: recent.filter((id) => id !== channelId),
            };

          return next;
        }),

      createCategory: (communityId, name) => {
        const categoryId = randomId("category");
        const community = selectCommunity(get(), communityId);
        set((state) => ({
          createdCategories: {
            ...state.createdCategories,
            [categoryId]: {
              id: categoryId,
              communityId,
              name: name.trim(),
              channelIds: [],
              collapsed: false,
            },
          },
        }));
        // Categoria nova entra no fim da lista (§14).
        if (community)
          get().updateCommunity(communityId, {
            categoryIds: [...community.categoryIds, categoryId],
          });
        return categoryId;
      },

      renameCategory: (categoryId, name) =>
        set((state) => categoryPatch(state, categoryId, { name: name.trim() })),

      deleteCategory: (communityId, categoryId, moveChannelsToId) => {
        const state0 = get();
        const category = selectCategory(state0, categoryId);
        if (!category) return;

        if (moveChannelsToId) {
          // Mover primeiro: excluir a categoria antes deixaria os canais sem
          // dono e `selectCategories` já não os encontraria.
          for (const channelId of category.channelIds)
            get().moveChannel(channelId, moveChannelsToId);
        } else {
          for (const channelId of category.channelIds)
            get().deleteChannel(communityId, channelId);
        }

        set((state) => ({
          deletedCategoryIds: [...state.deletedCategoryIds, categoryId],
        }));

        const community = selectCommunity(get(), communityId);
        if (community)
          get().updateCommunity(communityId, {
            categoryIds: community.categoryIds.filter((id) => id !== categoryId),
          });
      },

      /* ─── §8, 1.1.1 — preferências de leitura ──────────────────── */

      toggleChannelMuted: (channelId) =>
        set((state) => {
          const channel = selectChannel(state, channelId);
          if (!channel) return {};
          return channelPatch(state, channelId, { muted: !channel.muted });
        }),

      markChannelRead: (channelId) =>
        set((state) =>
          channelPatch(state, channelId, {
            unreadCount: 0,
            pendingMentions: 0,
            firstUnreadMessageId: undefined,
          }),
        ),

      seedReferenceDataset: () =>
        set((state) => ({
          joinedCommunityIds: [...get().remote.order],
          activeCommunityId: state.activeCommunityId ?? get().remote.order[0],
        })),

      resetCommunities: () => set({ ...EMPTY_STATE }),
    }),
    {
      name: "comunidade-p2p:communities",
      version: 1,
      // Cargo assumido é afinador de sessão (§19.1): não sobrevive ao reload.
      partialize: ({ localRoleOverrides: _, ...rest }) => rest,
    },
  ),
);

/* ─── Seletores ──────────────────────────────────────────────────── */

type State = CommunityState;

/**
 * Cache de mesclagem fixture+override, chaveado pelo próprio objeto de
 * override.
 *
 * Sem isto, `selectCommunity` devolveria um objeto novo a cada chamada assim
 * que a comunidade fosse editada — e `useShallow`, que compara elemento a
 * elemento por referência, não salva disso (a armadilha da Parte 4). O
 * override é substituído de forma imutável a cada edição, então a entrada
 * velha do cache morre junto com ele.
 */
const mergedCommunities = new WeakMap<object, Community>();
const mergedRoles = new WeakMap<object, Role>();
const mergedCategories = new WeakMap<object, Category>();
const mergedChannels = new WeakMap<object, Channel>();

function merged<T extends object>(
  cache: WeakMap<object, T>,
  base: T,
  override: Partial<T>,
): T {
  const cached = cache.get(override);
  if (cached) return cached;
  const value = { ...base, ...override };
  cache.set(override, value);
  return value;
}

export function selectCommunity(
  state: State,
  communityId: string | null,
): Community | undefined {
  if (!communityId) return undefined;
  const created = state.createdCommunities[communityId];
  if (created) return created;
  const fixture = state.remote.communities[communityId];
  if (!fixture) return undefined;
  const override = state.communityOverrides[communityId];
  return override ? merged(mergedCommunities, fixture, override) : fixture;
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

export function selectCategory(
  state: State,
  categoryId: string,
): Category | undefined {
  if (state.deletedCategoryIds.includes(categoryId)) return undefined;
  const created = state.createdCategories[categoryId];
  if (created) return created;
  const fixture = state.remote.categories[categoryId];
  if (!fixture) return undefined;
  const override = state.categoryOverrides[categoryId];
  return override ? merged(mergedCategories, fixture, override) : fixture;
}

export function selectCategories(
  state: State,
  communityId: string,
): Category[] {
  const community = selectCommunity(state, communityId);
  if (!community) return [];
  return community.categoryIds
    .map((id) => selectCategory(state, id))
    .filter((category): category is Category => category !== undefined);
}

export function selectChannel(
  state: State,
  channelId: string,
): Channel | undefined {
  if (state.deletedChannelIds.includes(channelId)) return undefined;
  const created = state.createdChannels[channelId];
  if (created) return created;
  const fixture = state.remote.channels[channelId];
  if (!fixture) return undefined;
  const override = state.channelOverrides[channelId];
  return override ? merged(mergedChannels, fixture, override) : fixture;
}

/**
 * Quantos canais a comunidade ainda tem. Sustenta a regra do último canal
 * (§10, 3.4): a comunidade nunca fica sem nenhum (§7, 0.4).
 */
export function selectChannelCount(state: State, communityId: string): number {
  return selectCategories(state, communityId).reduce(
    (total, category) =>
      total +
      category.channelIds.filter((id) => selectChannel(state, id)).length,
    0,
  );
}

/**
 * Não-lidas da comunidade inteira, para o rail (§8, 1.1).
 *
 * Canal silenciado (§8, 1.1.1) não conta pro traço de não-lida, mas menção
 * direta continua contando: silenciar reduz ruído, não esconde alguém te
 * chamando pelo nome.
 */
export function selectCommunityUnread(
  state: State,
  communityId: string,
): { unread: boolean; mentions: number } {
  let unread = false;
  let mentions = 0;
  for (const category of selectCategories(state, communityId)) {
    for (const channelId of category.channelIds) {
      const channel = selectChannel(state, channelId);
      if (!channel) continue;
      if (!channel.muted && channel.unreadCount > 0) unread = true;
      mentions += channel.pendingMentions;
    }
  }
  return { unread: unread || mentions > 0, mentions };
}

export function useCommunityUnread(communityId: string): {
  unread: boolean;
  mentions: number;
} {
  return useCommunityStore(
    useShallow((state: State) => selectCommunityUnread(state, communityId)),
  );
}

export function useChannelCount(communityId: string | null): number {
  return useCommunityStore((state) =>
    communityId ? selectChannelCount(state, communityId) : 0,
  );
}

export function useCategory(categoryId: string | null): Category | undefined {
  return useCommunityStore((state) =>
    categoryId ? selectCategory(state, categoryId) : undefined,
  );
}

export function useChannel(channelId: string | null): Channel | undefined {
  return useCommunityStore((state) =>
    channelId ? selectChannel(state, channelId) : undefined,
  );
}

export function selectRole(state: State, roleId: string): Role | undefined {
  if (state.deletedRoleIds.includes(roleId)) return undefined;
  const created = state.createdRoles[roleId];
  if (created) return created;
  const fixture = state.remote.roles[roleId];
  if (!fixture) return undefined;
  const override = state.roleOverrides[roleId];
  return override ? merged(mergedRoles, fixture, override) : fixture;
}

/** Cargos da comunidade, do topo da hierarquia para baixo (§10, 3.2). */
export function selectRoles(state: State, communityId: string): Role[] {
  const community = selectCommunity(state, communityId);
  if (!community) return [];
  return community.roleIds
    .map((roleId) => selectRole(state, roleId))
    .filter((role): role is Role => role !== undefined)
    .sort((a, b) => b.position - a.position);
}

export function useRoles(communityId: string | null): Role[] {
  return useCommunityStore(
    useShallow((state: State) =>
      communityId ? selectRoles(state, communityId) : [],
    ),
  );
}

/**
 * Apelido de um membro nesta comunidade (§8, 1.4) — o que a sessão definiu,
 * ou o que a fixture diz. A string vazia é remoção explícita, não ausência.
 */
/**
 * Busca de membro com a MESMA assinatura de `findMember` das fixtures, para as telas não
 * precisarem mudar de forma. O hook assina o roster do espelho: quando `query.members`
 * responde, quem chama re-renderiza sozinho.
 */
export function useFindMember(): (communityId: string, identityId: string) => Member | undefined {
  const roster = useCommunityStore((state) => state.remote.membersByCommunity);
  return (communityId, identityId) =>
    roster[communityId]?.find((m) => m.identityId === identityId);
}

/** Idem para `findMembers(communityId)`. */
export function useFindMembers(): (communityId: string) => Member[] {
  const roster = useCommunityStore((state) => state.remote.membersByCommunity);
  return (communityId) => roster[communityId] ?? NENHUM_MEMBRO;
}

/**
 * Versão sem hook, para módulos puros (autocomplete de menção, impacto de saída) que são
 * chamados sob demanda e não precisam re-renderizar por conta própria.
 */
export function membrosDaComunidade(communityId: string): Member[] {
  return useCommunityStore.getState().remote.membersByCommunity[communityId] ?? NENHUM_MEMBRO;
}

const NENHUM_MEMBRO: Member[] = [];

/** Membro no roster que o núcleo respondeu — o lugar de `findMember` das fixtures. */
function membroDo(state: State, communityId: string, identityId: string): Member | undefined {
  return state.remote.membersByCommunity[communityId]?.find((m) => m.identityId === identityId);
}

export function selectMemberNickname(
  state: State,
  communityId: string,
  identityId: string,
): string | undefined {
  const override = state.memberNicknames[communityId]?.[identityId];
  if (override !== undefined) return override === "" ? undefined : override;
  return membroDo(state, communityId, identityId)?.nickname;
}

/**
 * Como um membro é chamado nesta comunidade: apelido, senão nome de
 * identidade. Toda tela que escreve o nome de alguém passa por aqui, senão
 * mudar o apelido só teria efeito em metade da interface.
 */
export function selectMemberLabel(
  state: State,
  communityId: string,
  identityId: string,
): string {
  return (
    selectMemberNickname(state, communityId, identityId) ??
    membroDo(state, communityId, identityId)?.displayName ??
    "Membro"
  );
}

export function useMemberLabel(
  communityId: string,
  identityId: string,
): string {
  return useCommunityStore((state) =>
    selectMemberLabel(state, communityId, identityId),
  );
}

/** Cargos de um membro — o que a sessão atribuiu, ou o que a fixture diz. */
export function selectMemberRoleIds(
  state: State,
  communityId: string,
  identityId: string,
): string[] {
  const override = state.memberRoleOverrides[communityId]?.[identityId];
  const base = override ?? membroDo(state, communityId, identityId)?.roleIds ?? [];
  return base.filter((roleId) => !state.deletedRoleIds.includes(roleId));
}

/** Convites ativos da comunidade — os de §2 mais os criados aqui (§10, 3.1b). */
export function selectInvites(state: State, communityId: string): Invite[] {
  const fromFixture = state.remote.invites.filter(
    (invite) => invite.communityId === communityId,
  );
  return [...state.createdInvites, ...fromFixture].filter(
    (invite) =>
      invite.communityId === communityId &&
      !invite.revoked &&
      !state.revokedInviteCodes.includes(invite.code),
  );
}

export function useInvites(communityId: string | null): Invite[] {
  return useCommunityStore(
    useShallow((state: State) =>
      communityId ? selectInvites(state, communityId) : [],
    ),
  );
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

/** Todos os canais de texto da comunidade, na ordem das categorias (§14). */
export function useTextChannels(communityId: string | null): Channel[] {
  return useCommunityStore(
    useShallow((state: State) => {
      if (!communityId) return [];
      const channels: Channel[] = [];
      for (const category of selectCategories(state, communityId)) {
        for (const channelId of category.channelIds) {
          const channel = selectChannel(state, channelId);
          if (channel?.type === "text") channels.push(channel);
        }
      }
      return channels;
    }),
  );
}

/** Canais visitados recentemente, já resolvidos e ainda existentes. */
export function useRecentChannels(communityId: string | null): Channel[] {
  return useCommunityStore(
    useShallow((state: State) =>
      communityId
        ? (state.recentChannelIds[communityId] ?? [])
            .map((id) => selectChannel(state, id))
            .filter((channel): channel is Channel => channel !== undefined)
        : [],
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
  const override = state.localRoleOverrides[communityId];
  if (override) return override;
  const eu = state.remote.euId;
  const assigned = eu === null ? undefined : state.memberRoleOverrides[communityId]?.[eu];
  if (assigned) return assigned.filter((id) => !state.deletedRoleIds.includes(id));
  if (state.createdCommunities[communityId]) {
    return state.createdCommunities[communityId].roleIds.filter(
      (id) => !state.deletedRoleIds.includes(id),
    );
  }
  return eu === null ? [] : selectMemberRoleIds(state, communityId, eu);
}

/**
 * Regra de hierarquia de §10, aplicada em toda a spec: só dá para moderar
 * alguém cujo cargo mais alto esteja **abaixo** do seu. Nunca igual, nunca
 * superior, e o Fundador/host nunca é alvo de ação nenhuma.
 */
export function selectCanModerate(
  state: State,
  communityId: string,
  targetId: string,
): boolean {
  // Ninguém modera a si mesmo (§10) — `E_SELF_TARGET` no núcleo.
  if (targetId === state.remote.euId) return false;
  const targetRoles = selectMemberRoleIds(state, communityId, targetId);
  const target = selectHighestRole(state, targetRoles);
  if (target?.isFounder) return false;

  const mine = selectHighestRole(
    state,
    selectLocalMemberRoleIds(state, communityId),
  );
  if (!mine) return false;
  return mine.position > (target?.position ?? 0);
}

/**
 * Quem a identidade local *é* dentro desta comunidade, como id de autor.
 * Nas comunidades de §2 ela ocupa o lugar de Ana Torres (§19.2 pede que Ana
 * seja a mesma entidade em toda tela); nas criadas no app, é ela mesma.
 */
export function useLocalMemberId(_communityId: string): string {
  // Com dado real não há mais "o lugar de Ana": a identidade local é a chave desta
  // instalação, e ela é a mesma em toda comunidade (§6.1).
  const identityId = useIdentityStore((state) => state.identity?.id);
  const euId = useCommunityStore((state) => state.remote.euId);
  return identityId ?? euId ?? "";
}

/**
 * Permissão da identidade local nesta comunidade (§10, 3.2) — união das
 * permissões de todos os cargos dela. Decide, por exemplo, se `@everyone`
 * aparece no autocomplete de menção (§9, 2.1.1).
 */
export function selectHasPermission(
  state: State,
  communityId: string,
  permission: Permission,
): boolean {
  return selectLocalMemberRoleIds(state, communityId).some((roleId) =>
    selectRole(state, roleId)?.permissions.includes(permission),
  );
}

export function useHasPermission(
  communityId: string,
  permission: Permission,
): boolean {
  return useCommunityStore((state) =>
    selectHasPermission(state, communityId, permission),
  );
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
