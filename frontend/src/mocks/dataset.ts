/**
 * Dataset de referência — §2 da spec de UX/UI.
 *
 * Estes são os valores exatos que a spec manda usar como fixtures padrão,
 * para que os estados das telas batam com o que está documentado. Nada aqui
 * vem de rede: as stores Zustand leem daqui.
 *
 * Consistência (§19.2): todo id/nome usado numa tela precisa ser o mesmo em
 * qualquer outra — Ana, Rafael, Bianca, Diego, Fernanda e as 3 comunidades
 * são sempre as mesmas entidades.
 */
import type {
  Attachment,
  Category,
  Channel,
  Community,
  Identity,
  Invite,
  InvitePreview,
  Member,
  Message,
  ModerationAction,
  Permission,
  Role,
  ScreenShareSession,
  Thread,
  VoiceSession,
} from "../domain/types";

/* ─── Ids estáveis ───────────────────────────────────────────────── */

export const IDS = {
  ana: "usr-ana",
  rafael: "usr-rafael",
  bianca: "usr-bianca",
  diego: "usr-diego",
  fernanda: "usr-fernanda",

  vale: "com-vale-do-codigo",
  cla: "com-cla-noturno",
  atelie: "com-atelie-aberto",
} as const;

/* ─── Datas ──────────────────────────────────────────────────────── */

/** Base fixa do "hoje" do mock, resolvida uma vez por carga da página. */
const TODAY = new Date();

function todayAt(time: `${number}:${number}`): string {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date(TODAY);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function daysAgo(days: number, time: `${number}:${number}` = "14:00"): string {
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date(TODAY);
  date.setDate(date.getDate() - days);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

/* ─── Identidade local de referência ─────────────────────────────── */

/**
 * §2 — "Ana Torres (@ana), avatar com iniciais AT sobre fundo violeta,
 * presença online". Serve de referência; numa instalação nova a identidade
 * real é criada pelo onboarding (0.1) e persistida em `identityStore`.
 */
export const ANA_IDENTITY: Identity = {
  id: IDS.ana,
  handle: "@ana",
  displayName: "Ana Torres",
  avatarColor: "accent",
  publicKey: "7f3a9c21e04b8d6510af2c7e93b1d4a806fe5c2b",
  presence: "online",
  createdAt: daysAgo(150),
};

/* ─── Catálogo de permissões (§10, 3.2) ──────────────────────────── */

export const PERMISSION_GROUPS: {
  id: "general" | "text" | "voice" | "moderation";
  label: string;
  permissions: { id: Permission; label: string }[];
}[] = [
  {
    id: "general",
    label: "Geral",
    permissions: [
      { id: "manage_community", label: "Gerenciar comunidade" },
      { id: "manage_channels", label: "Gerenciar canais" },
      { id: "view_audit_log", label: "Ver log de auditoria" },
    ],
  },
  {
    id: "text",
    label: "Texto",
    permissions: [
      { id: "send_messages", label: "Enviar mensagens" },
      { id: "attach_files", label: "Anexar arquivos" },
      { id: "add_reactions", label: "Adicionar reações" },
      { id: "mention_everyone", label: "Mencionar @everyone" },
      { id: "pin_messages", label: "Fixar mensagens" },
      { id: "manage_messages", label: "Gerenciar mensagens" },
    ],
  },
  {
    id: "voice",
    label: "Voz",
    permissions: [
      { id: "voice_speak", label: "Falar" },
      { id: "voice_mute_others", label: "Silenciar outros" },
      { id: "voice_share_screen", label: "Compartilhar tela" },
    ],
  },
  {
    id: "moderation",
    label: "Moderação",
    permissions: [
      { id: "create_invite", label: "Convidar pessoas" },
      { id: "kick_members", label: "Expulsar" },
      { id: "ban_members", label: "Banir" },
      { id: "timeout_members", label: "Aplicar timeout" },
      { id: "manage_roles", label: "Gerenciar cargos" },
    ],
  },
];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap(
  (group) => group.permissions.map((permission) => permission.id),
);

/** Permissões do cargo base "Membro" — enviar mensagem, falar em voz (§2). */
export const BASE_MEMBER_PERMISSIONS: Permission[] = [
  "send_messages",
  "attach_files",
  "add_reactions",
  "voice_speak",
];

/* ─── Cargos ─────────────────────────────────────────────────────── */

export const ROLES: Record<string, Role> = {
  "role-vale-fundador": {
    id: "role-vale-fundador",
    name: "Fundador",
    color: "role-gold",
    position: 4,
    permissions: ALL_PERMISSIONS,
    mentionable: true,
    memberCount: 1,
    isFounder: true,
  },
  "role-vale-moderador": {
    id: "role-vale-moderador",
    name: "Moderador",
    color: "role-blue",
    position: 3,
    permissions: [
      ...BASE_MEMBER_PERMISSIONS,
      "manage_channels",
      "view_audit_log",
      "manage_messages",
      "pin_messages",
      "mention_everyone",
      "create_invite",
      "kick_members",
      "ban_members",
      "timeout_members",
      "voice_mute_others",
      "voice_share_screen",
    ],
    mentionable: true,
    memberCount: 1,
  },
  "role-vale-contribuidor": {
    id: "role-vale-contribuidor",
    name: "Contribuidor",
    color: "role-green",
    position: 2,
    permissions: [
      ...BASE_MEMBER_PERMISSIONS,
      "pin_messages",
      "mention_everyone",
      "create_invite",
      "voice_share_screen",
    ],
    mentionable: true,
    memberCount: 2,
  },
  "role-vale-membro": {
    id: "role-vale-membro",
    name: "Membro",
    color: "role-neutral",
    position: 1,
    permissions: BASE_MEMBER_PERMISSIONS,
    // O cargo base não é mencionável por padrão (§9, 2.1.1).
    mentionable: false,
    memberCount: 340,
    isDefault: true,
  },

  // Clã Noturno — Ana é a host, então tem o cargo de Fundador aqui.
  "role-cla-fundador": {
    id: "role-cla-fundador",
    name: "Fundador",
    color: "role-gold",
    position: 2,
    permissions: ALL_PERMISSIONS,
    mentionable: true,
    memberCount: 1,
    isFounder: true,
  },
  "role-cla-membro": {
    id: "role-cla-membro",
    name: "Membro",
    color: "role-neutral",
    position: 1,
    permissions: BASE_MEMBER_PERMISSIONS,
    mentionable: false,
    memberCount: 58,
    isDefault: true,
  },

  // Ateliê Aberto — host é Bianca; Ana é membro comum.
  "role-atelie-fundador": {
    id: "role-atelie-fundador",
    name: "Fundador",
    color: "role-gold",
    position: 2,
    permissions: ALL_PERMISSIONS,
    mentionable: true,
    memberCount: 1,
    isFounder: true,
  },
  "role-atelie-membro": {
    id: "role-atelie-membro",
    name: "Membro",
    color: "role-neutral",
    position: 1,
    permissions: BASE_MEMBER_PERMISSIONS,
    mentionable: false,
    memberCount: 12,
    isDefault: true,
  },
};

/* ─── Comunidades ────────────────────────────────────────────────── */

export const COMMUNITIES: Record<string, Community> = {
  [IDS.vale]: {
    id: IDS.vale,
    name: "Vale do Código",
    // Sem emoji: ícone "VC" sobre fundo azul-petróleo (§2).
    iconColor: "role-blue",
    description: "Comunidade de quem constrói coisas na web.",
    hostPeerId: IDS.rafael,
    isHostedByMe: false,
    createdAt: daysAgo(420),
    memberCount: 340,
    categoryIds: ["cat-vale-inicio", "cat-vale-texto", "cat-vale-voz"],
    roleIds: [
      "role-vale-fundador",
      "role-vale-moderador",
      "role-vale-contribuidor",
      "role-vale-membro",
    ],
    connectionHealth: { hostStatus: "online" },
  },
  [IDS.cla]: {
    id: IDS.cla,
    name: "Clã Noturno",
    iconEmoji: "🎮",
    iconColor: "role-purple",
    description: "Partidas noturnas, sem compromisso.",
    hostPeerId: IDS.ana,
    // Host é a própria Ana — usada nas telas de administração (§2).
    isHostedByMe: true,
    createdAt: daysAgo(90),
    memberCount: 58,
    categoryIds: ["cat-cla-geral"],
    roleIds: ["role-cla-fundador", "role-cla-membro"],
    connectionHealth: { hostStatus: "online" },
  },
  [IDS.atelie]: {
    id: IDS.atelie,
    name: "Ateliê Aberto",
    iconEmoji: "🎨",
    iconColor: "role-pink",
    description: "Ilustração, tipografia e afins.",
    hostPeerId: IDS.bianca,
    isHostedByMe: false,
    createdAt: daysAgo(200),
    memberCount: 12,
    categoryIds: ["cat-atelie-geral"],
    roleIds: ["role-atelie-fundador", "role-atelie-membro"],
    // Estado "host offline / modo cache" (§2, fluxo B4).
    connectionHealth: { hostStatus: "offline" },
  },
};

/** Ordem do rail (§2): ordem de entrada, não alfabética (§14). */
export const COMMUNITY_ORDER: string[] = [IDS.vale, IDS.cla, IDS.atelie];

/* ─── Categorias e canais ────────────────────────────────────────── */

export const CATEGORIES: Record<string, Category> = {
  "cat-vale-inicio": {
    id: "cat-vale-inicio",
    communityId: IDS.vale,
    name: "INÍCIO",
    channelIds: ["ch-vale-avisos", "ch-vale-apresentacoes"],
    collapsed: false,
  },
  "cat-vale-texto": {
    id: "cat-vale-texto",
    communityId: IDS.vale,
    name: "TEXTO",
    channelIds: [
      "ch-vale-geral",
      "ch-vale-ajuda-frontend",
      "ch-vale-ajuda-backend",
    ],
    collapsed: false,
  },
  "cat-vale-voz": {
    id: "cat-vale-voz",
    communityId: IDS.vale,
    name: "VOZ",
    channelIds: ["ch-vale-sala-estudos", "ch-vale-papo-aberto"],
    collapsed: false,
  },
  "cat-cla-geral": {
    id: "cat-cla-geral",
    communityId: IDS.cla,
    name: "GERAL",
    channelIds: ["ch-cla-geral", "ch-cla-voz"],
    collapsed: false,
  },
  "cat-atelie-geral": {
    id: "cat-atelie-geral",
    communityId: IDS.atelie,
    name: "GERAL",
    channelIds: ["ch-atelie-geral"],
    collapsed: false,
  },
};

export const CHANNELS: Record<string, Channel> = {
  "ch-vale-avisos": {
    id: "ch-vale-avisos",
    communityId: IDS.vale,
    categoryId: "cat-vale-inicio",
    type: "text",
    name: "avisos",
    topic: "Comunicados da comunidade",
    unreadCount: 1,
    pendingMentions: 0,
    muted: false,
    // Somente-leitura para quem não é Moderador+ (§2, §9 2.1).
    readOnlyForRoleIds: ["role-vale-contribuidor", "role-vale-membro"],
  },
  "ch-vale-apresentacoes": {
    id: "ch-vale-apresentacoes",
    communityId: IDS.vale,
    categoryId: "cat-vale-inicio",
    type: "text",
    name: "apresentações",
    topic: "Chegou agora? Se apresenta aqui",
    unreadCount: 0,
    pendingMentions: 0,
    muted: false,
  },
  "ch-vale-geral": {
    id: "ch-vale-geral",
    communityId: IDS.vale,
    categoryId: "cat-vale-texto",
    type: "text",
    name: "geral",
    topic: "Papo geral da comunidade",
    unreadCount: 12,
    pendingMentions: 1,
    muted: false,
    // O divisor "Novas mensagens" cai na menção de Bianca — a mesma que
    // gera a menção pendente do item de lista (§6).
    firstUnreadMessageId: "msg-geral-4",
  },
  "ch-vale-ajuda-frontend": {
    id: "ch-vale-ajuda-frontend",
    communityId: IDS.vale,
    categoryId: "cat-vale-texto",
    type: "text",
    name: "ajuda-frontend",
    unreadCount: 0,
    pendingMentions: 0,
    muted: false,
  },
  "ch-vale-ajuda-backend": {
    id: "ch-vale-ajuda-backend",
    communityId: IDS.vale,
    categoryId: "cat-vale-texto",
    type: "text",
    name: "ajuda-backend",
    unreadCount: 0,
    pendingMentions: 0,
    // Silenciado por Ana (§2).
    muted: true,
  },
  "ch-vale-sala-estudos": {
    id: "ch-vale-sala-estudos",
    communityId: IDS.vale,
    categoryId: "cat-vale-voz",
    type: "voice",
    name: "Sala de Estudos",
    unreadCount: 0,
    pendingMentions: 0,
    muted: false,
    voiceParticipantIds: [IDS.rafael, IDS.diego, IDS.bianca],
  },
  "ch-vale-papo-aberto": {
    id: "ch-vale-papo-aberto",
    communityId: IDS.vale,
    categoryId: "cat-vale-voz",
    type: "voice",
    name: "Papo Aberto",
    unreadCount: 0,
    pendingMentions: 0,
    muted: false,
    voiceParticipantIds: [],
  },
  "ch-cla-geral": {
    id: "ch-cla-geral",
    communityId: IDS.cla,
    categoryId: "cat-cla-geral",
    type: "text",
    name: "geral",
    unreadCount: 0,
    pendingMentions: 0,
    muted: false,
  },
  "ch-cla-voz": {
    id: "ch-cla-voz",
    communityId: IDS.cla,
    categoryId: "cat-cla-geral",
    type: "voice",
    name: "Lobby",
    unreadCount: 0,
    pendingMentions: 0,
    muted: false,
    voiceParticipantIds: [],
  },
  "ch-atelie-geral": {
    id: "ch-atelie-geral",
    communityId: IDS.atelie,
    categoryId: "cat-atelie-geral",
    type: "text",
    name: "geral",
    unreadCount: 0,
    pendingMentions: 0,
    muted: false,
  },
};

/* ─── Membros ────────────────────────────────────────────────────── */

/** Amostra visível na lista de membros de Vale do Código (§2, §8 1.3). */
export const VALE_MEMBERS: Member[] = [
  {
    identityId: IDS.rafael,
    communityId: IDS.vale,
    displayName: "Rafael Mendes",
    handle: "@rafael",
    avatarColor: "role-gold",
    roleIds: ["role-vale-fundador", "role-vale-membro"],
    joinedAt: daysAgo(420),
    presence: "online",
    banned: false,
  },
  {
    identityId: IDS.bianca,
    communityId: IDS.vale,
    displayName: "Bianca Souza",
    handle: "@bianca",
    avatarColor: "role-pink",
    roleIds: ["role-vale-moderador", "role-vale-membro"],
    joinedAt: daysAgo(300),
    presence: "online",
    banned: false,
  },
  {
    identityId: IDS.diego,
    communityId: IDS.vale,
    displayName: "Diego Alves",
    handle: "@diego",
    avatarColor: "role-blue",
    roleIds: ["role-vale-contribuidor", "role-vale-membro"],
    // "Entrou em 3 jan 2026" (§8, 1.4).
    joinedAt: new Date(2026, 0, 3, 10, 0, 0).toISOString(),
    presence: "online",
    banned: false,
  },
  {
    identityId: IDS.ana,
    communityId: IDS.vale,
    displayName: "Ana Torres",
    handle: "@ana",
    avatarColor: "accent",
    roleIds: ["role-vale-contribuidor", "role-vale-membro"],
    joinedAt: new Date(2026, 2, 12, 9, 0, 0).toISOString(),
    presence: "online",
    banned: false,
  },
  {
    identityId: IDS.fernanda,
    communityId: IDS.vale,
    displayName: "Fernanda Lima",
    handle: "@fernanda",
    avatarColor: "role-green",
    roleIds: ["role-vale-membro"],
    joinedAt: daysAgo(60),
    presence: "idle",
    banned: false,
  },
];

/** Agregador "OFFLINE — 307" da lista de membros (§8, 1.3). */
export const VALE_OFFLINE_MEMBER_COUNT = 307;

export const MEMBERS_BY_COMMUNITY: Record<string, Member[]> = {
  [IDS.vale]: VALE_MEMBERS,
  [IDS.cla]: [
    {
      identityId: IDS.ana,
      communityId: IDS.cla,
      displayName: "Ana Torres",
      handle: "@ana",
      avatarColor: "accent",
      roleIds: ["role-cla-fundador", "role-cla-membro"],
      joinedAt: daysAgo(90),
      presence: "online",
      banned: false,
    },
  ],
  [IDS.atelie]: [
    {
      identityId: IDS.bianca,
      communityId: IDS.atelie,
      displayName: "Bianca Souza",
      handle: "@bianca",
      avatarColor: "role-pink",
      roleIds: ["role-atelie-fundador", "role-atelie-membro"],
      joinedAt: daysAgo(200),
      presence: "online",
      banned: false,
    },
    {
      identityId: IDS.ana,
      communityId: IDS.atelie,
      displayName: "Ana Torres",
      handle: "@ana",
      avatarColor: "accent",
      roleIds: ["role-atelie-membro"],
      joinedAt: daysAgo(40),
      presence: "online",
      banned: false,
    },
  ],
};

/* ─── Anexo de exemplo (§2, fluxo B8) ────────────────────────────── */

export const AULA_WEBRTC_ATTACHMENT: Attachment = {
  id: "att-aula-webrtc",
  name: "aula-webrtc-completa.mp4",
  sizeBytes: 1_240_000_000, // 1.24 GB
  kind: "video",
  downloadProgress: 62,
  availablePeers: 3,
  hostAvailable: true,
};

/* ─── Mensagens de #geral (§2) ───────────────────────────────────── */

export const VALE_GERAL_MESSAGES: Message[] = [
  {
    // Porta-anexo do fluxo B8: a spec exige o card em #geral (§11, B8) mas
    // não o inclui na transcrição de §2, então ele entra antes dela, sem
    // alterar a sequência documentada.
    id: "msg-geral-0",
    channelId: "ch-vale-geral",
    authorId: IDS.rafael,
    content: "Gravação da aula de ontem, pra quem perdeu 👇",
    timestamp: todayAt("08:52"),
    edited: false,
    pinned: false,
    reactions: [],
    attachments: [AULA_WEBRTC_ATTACHMENT],
    mentions: [],
    deliveryState: "sent",
  },
  {
    id: "msg-geral-1",
    channelId: "ch-vale-geral",
    authorId: IDS.rafael,
    content: "Bom dia! Subi a build nova do onboarding, testem quando puderem 🚀",
    timestamp: todayAt("09:14"),
    edited: false,
    pinned: false,
    // §2 não transcreve reações, mas §9 (2.1) exige o chip nos dois estados
    // — com e sem a reação de Ana. Sem alguém já tendo reagido, o estado
    // "outros reagiram, você não" seria inalcançável no mock.
    reactions: [{ emoji: "👍", count: 2, userIds: [IDS.diego, IDS.bianca] }],
    attachments: [],
    mentions: [],
    deliveryState: "sent",
  },
  {
    id: "msg-geral-2",
    channelId: "ch-vale-geral",
    authorId: IDS.diego,
    content: "testando agora",
    timestamp: todayAt("09:16"),
    edited: false,
    pinned: false,
    reactions: [],
    attachments: [],
    mentions: [],
    deliveryState: "sent",
  },
  {
    id: "msg-geral-3",
    channelId: "ch-vale-geral",
    authorId: IDS.diego,
    content:
      "👍 rodou liso aqui, só achei o texto do botão de convite meio pequeno",
    timestamp: todayAt("09:20"),
    edited: true,
    pinned: false,
    reactions: [],
    attachments: [],
    mentions: [],
    deliveryState: "sent",
  },
  {
    id: "msg-geral-4",
    channelId: "ch-vale-geral",
    authorId: IDS.bianca,
    content: "@Ana Torres bora revisar a fila de moderação depois do almoço?",
    timestamp: todayAt("09:41"),
    edited: false,
    pinned: true,
    threadId: "thr-moderacao",
    reactions: [],
    attachments: [],
    mentions: [IDS.ana],
    deliveryState: "sent",
  },
  {
    id: "msg-geral-5",
    channelId: "ch-vale-geral",
    authorId: IDS.ana,
    content: "bora, te chamo na Sala de Estudos",
    timestamp: todayAt("09:43"),
    edited: false,
    pinned: false,
    replyToId: "msg-geral-4",
    threadId: "thr-moderacao",
    reactions: [],
    attachments: [],
    mentions: [],
    deliveryState: "sent",
  },
];

export const MESSAGES_BY_CHANNEL: Record<string, Message[]> = {
  "ch-vale-geral": VALE_GERAL_MESSAGES,
};

/** Referência estável: canal sem histórico devolve sempre o mesmo array. */
const NO_MESSAGES: Message[] = [];

/**
 * Histórico de um canal, em ordem cronológica. Canal sem mensagem nenhuma
 * (recém-criado ou ainda vazio no dataset) cai no empty state de §9, 2.1.
 */
export function findChannelMessages(channelId: string): Message[] {
  return MESSAGES_BY_CHANNEL[channelId] ?? NO_MESSAGES;
}

/** Referência estável: comunidade sem membros fixados devolve o mesmo array. */
const NO_MEMBERS: Member[] = [];

/** Membros conhecidos de uma comunidade (§2 — amostra, não o total). */
export function findMembers(communityId: string): Member[] {
  return MEMBERS_BY_COMMUNITY[communityId] ?? NO_MEMBERS;
}

/** Autor de uma mensagem / alvo de um popover — sempre dentro da comunidade. */
export function findMember(
  communityId: string,
  identityId: string,
): Member | undefined {
  return (MEMBERS_BY_COMMUNITY[communityId] ?? []).find(
    (member) => member.identityId === identityId,
  );
}

export const THREADS: Record<string, Thread> = {
  "thr-moderacao": {
    id: "thr-moderacao",
    rootMessageId: "msg-geral-4",
    channelId: "ch-vale-geral",
    replyIds: ["msg-geral-5"],
    participantIds: [IDS.bianca, IDS.ana],
    unreadCount: 0,
  },
};

/* ─── Convites (§2, §7 0.3) ──────────────────────────────────────── */

export const INVITE_LINK_HOST = "p2p.app";

export const INVITES: Record<string, Invite> = {
  x7k2qm: {
    code: "x7K2qM",
    communityId: IDS.vale,
    createdById: IDS.rafael,
    createdAt: daysAgo(10),
    // Sem expiração, sem limite de usos (§2, premissa 4).
    uses: 0,
    revoked: false,
  },
  // Códigos abaixo existem só para tornar os demais desfechos de 0.3
  // alcançáveis no mock, como pede §19.1 — não fazem parte de §2.
  x7rev0: {
    code: "X7REV0",
    communityId: IDS.vale,
    createdById: IDS.rafael,
    createdAt: daysAgo(30),
    uses: 4,
    revoked: true,
  },
  x7ban1: {
    code: "X7BAN1",
    communityId: IDS.vale,
    createdById: IDS.bianca,
    createdAt: daysAgo(5),
    uses: 1,
    revoked: false,
  },
};

/**
 * Convites que resolvem para "você foi banido desta comunidade" (§7, 0.3).
 * É um atalho de mock: no produto real o banimento é da identidade, não do
 * convite — mas sem rede não há como entrar nesse estado organicamente.
 */
const DEMO_BANNED_CODES = new Set(["x7ban1"]);

/**
 * Aceita link completo ou código curto, em qualquer caixa:
 * "p2p.app/invite/x7K2qM", "https://p2p.app/invite/x7K2qM", "X7K2QM".
 */
export function normalizeInviteCode(raw: string): string {
  const trimmed = raw.trim();
  const fromLink = trimmed.match(/invite\/([A-Za-z0-9_-]+)/);
  const code = fromLink ? fromLink[1] : trimmed;
  return code.replace(/[^A-Za-z0-9_-]/g, "");
}

export function findInviteByCode(raw: string): Invite | undefined {
  const code = normalizeInviteCode(raw).toLowerCase();
  return code ? INVITES[code] : undefined;
}

/**
 * Resolve um código para um dos 4 desfechos de preview de §7 (0.3).
 * Convite revogado recebe o mesmo tratamento textual do inválido — a
 * interface não diferencia os dois para o usuário.
 */
export function resolveInvitePreview(
  raw: string,
  context: { joinedCommunityIds: string[]; bannedCommunityIds: string[] },
): InvitePreview {
  const code = normalizeInviteCode(raw).toLowerCase();
  const invite = code ? INVITES[code] : undefined;

  if (!invite || invite.revoked) return { status: "invalid" };
  if (invite.maxUses !== undefined && invite.uses >= invite.maxUses)
    return { status: "invalid" };

  const community = COMMUNITIES[invite.communityId];
  if (!community) return { status: "invalid" };

  if (
    DEMO_BANNED_CODES.has(code) ||
    context.bannedCommunityIds.includes(community.id)
  ) {
    // Não vaza contagem de membros nem quem convidou (§7, 0.3).
    return { status: "banned", communityName: community.name };
  }

  if (context.joinedCommunityIds.includes(community.id))
    return { status: "already-member", community };

  const invitedBy = (MEMBERS_BY_COMMUNITY[community.id] ?? []).find(
    (member) => member.identityId === invite.createdById,
  );
  if (!invitedBy) return { status: "invalid" };

  return { status: "ok", community, invitedBy };
}

/* ─── Moderação (§10, 3.3) ───────────────────────────────────────── */

export const MODERATION_LOG: ModerationAction[] = [
  {
    id: "mod-1",
    communityId: IDS.vale,
    type: "ban",
    targetId: "usr-4471",
    targetLabel: "Usuário#4471",
    authorId: IDS.bianca,
    reason: "spam de link",
    timestamp: daysAgo(2),
  },
  {
    id: "mod-2",
    communityId: IDS.vale,
    type: "createRole",
    targetId: "role-vale-contribuidor",
    targetLabel: "Contribuidor",
    authorId: IDS.rafael,
    timestamp: daysAgo(21),
  },
];

/* ─── Sessões de voz e compartilhamento (§9, 2.3 / 2.4) ──────────── */

export const SALA_DE_ESTUDOS_VOICE: VoiceSession = {
  channelId: "ch-vale-sala-estudos",
  communityId: IDS.vale,
  participants: [
    {
      identityId: IDS.rafael,
      speaking: false,
      muted: false,
      deafened: false,
      cameraOn: false,
      sharingScreen: false,
      connectionToMe: "ok",
    },
    {
      // Diego começa com o anel de fala ativo (§9, 2.3).
      identityId: IDS.diego,
      speaking: true,
      muted: false,
      deafened: false,
      cameraOn: false,
      sharingScreen: false,
      connectionToMe: "ok",
    },
    {
      identityId: IDS.bianca,
      speaking: false,
      muted: true,
      deafened: false,
      cameraOn: false,
      sharingScreen: false,
      connectionToMe: "ok",
    },
  ],
};

/**
 * §9, 2.4/2.4.2 — Rafael compartilhando para 7 espectadores em modo árvore;
 * Ana e Diego são os nós de primeiro nível (2 + 3 + eles dois = 7).
 */
export const RAFAEL_SCREEN_SHARE: ScreenShareSession = {
  presenterId: IDS.rafael,
  channelId: "ch-vale-sala-estudos",
  topology: "tree",
  viewerIds: [
    IDS.ana,
    IDS.diego,
    IDS.bianca,
    IDS.fernanda,
    "usr-espectador-5",
    "usr-espectador-6",
    "usr-espectador-7",
  ],
  quality: "auto",
  treeHealth: "ok",
  usingTurnFallback: false,
  firstLevelRelays: [
    { identityId: IDS.ana, relayingTo: 2, status: "ok" },
    { identityId: IDS.diego, relayingTo: 3, status: "ok" },
  ],
};
