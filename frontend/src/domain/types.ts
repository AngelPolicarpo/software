/**
 * Modelo de domínio — §2 da spec de UX/UI.
 *
 * Nada aqui vem de API: são os tipos das fixtures em `src/mocks/`, que as
 * stores Zustand consomem. Os nomes de campo estão em inglês (convenção de
 * código); o mapeamento pros nomes da spec está anotado onde não é óbvio.
 * Todo texto de interface continua em português.
 */

/* ─── Identidade e presença ──────────────────────────────────────── */

/** §2 Identity.statusPresence — `offline` só existe para os outros. */
export type PresenceStatus = "online" | "idle" | "dnd" | "invisible" | "offline";

/** §5.4 — conjunto curado fechado; nunca color-picker livre. */
export type RoleColor =
  | "role-gold"
  | "role-blue"
  | "role-green"
  | "role-red"
  | "role-purple"
  | "role-pink"
  | "role-neutral";

/**
 * §5.4 — paleta de avatar/ícone de comunidade. Reaproveita as 7 cores de
 * cargo + o accent do produto, em vez de inventar uma paleta paralela.
 */
export type AvatarColor = RoleColor | "accent";

/** §2 Identity — o par de chaves não é exibido, só sua existência. */
export interface Identity {
  id: string;
  /** Identificador local curto, ex.: `@ana` (§10, 3.1). */
  handle: string;
  displayName: string;
  avatarColor: AvatarColor;
  /** Chave pública simulada; só aparece truncada em Configurações (3.1). */
  publicKey: string;
  presence: PresenceStatus;
  createdAt: string;
}

/* ─── Saúde de conexão P2P (§5.4, §12) ───────────────────────────── */

export type HostStatus = "online" | "offline" | "reconnecting";
export type MeshStatus = "ok" | "degraded" | "failed";
export type TreeHealth = "ok" | "repairing" | "degraded";

export interface ConnectionHealth {
  hostStatus: HostStatus;
  meshStatus?: MeshStatus;
  treeHealth?: TreeHealth;
}

/* ─── Cargos e permissões (§10, 3.2) ─────────────────────────────── */

export type PermissionGroup = "general" | "text" | "voice" | "moderation";

export type Permission =
  // Geral
  | "manage_community"
  | "manage_channels"
  | "view_audit_log"
  // Texto
  | "send_messages"
  | "attach_files"
  | "add_reactions"
  | "mention_everyone"
  | "pin_messages"
  | "manage_messages"
  // Voz
  | "voice_speak"
  | "voice_mute_others"
  | "voice_share_screen"
  // Moderação
  | "create_invite"
  | "kick_members"
  | "ban_members"
  | "timeout_members"
  | "manage_roles";

export interface Role {
  id: string;
  name: string;
  color: RoleColor;
  /** Hierarquia: maior = mais alto. Fundador é sempre o topo (§10). */
  position: number;
  permissions: Permission[];
  mentionable: boolean;
  memberCount: number;
  /** Cargo base de todo membro; não pode ser deletado (§10, D13). */
  isDefault?: boolean;
  /** Fundador: não editável, não deletável, sempre no topo (§10). */
  isFounder?: boolean;
}

/* ─── Estrutura da comunidade ────────────────────────────────────── */

export interface Community {
  id: string;
  name: string;
  /** Emoji do ícone; quando ausente, usa iniciais + `iconColor`. */
  iconEmoji?: string;
  iconColor: AvatarColor;
  description?: string;
  hostPeerId: string;
  /** §2 `souEuOHost` — a comunidade roda na máquina da identidade local. */
  isHostedByMe: boolean;
  createdAt: string;
  memberCount: number;
  categoryIds: string[];
  roleIds: string[];
  connectionHealth: ConnectionHealth;
}

export interface Category {
  id: string;
  communityId: string;
  name: string;
  channelIds: string[];
  collapsed: boolean;
}

export type ChannelType = "text" | "voice";

export interface Channel {
  id: string;
  communityId: string;
  categoryId: string;
  type: ChannelType;
  name: string;
  topic?: string;
  unreadCount: number;
  pendingMentions: number;
  muted: boolean;
  /**
   * Onde entra o divisor "Novas mensagens" ao reabrir o canal (§6). Fica no
   * canal, não na mensagem, porque "lido até aqui" é estado de quem lê.
   */
  firstUnreadMessageId?: string;
  /** `#avisos`: só quem tem `send_messages` aqui posta (§9, 2.1). */
  readOnlyForRoleIds?: string[];
  /** Só quando `type === "voice"`: ids de quem está conectado agora. */
  voiceParticipantIds?: string[];
}

export interface Member {
  identityId: string;
  communityId: string;
  displayName: string;
  handle: string;
  avatarColor: AvatarColor;
  /** Apelido dentro desta comunidade (§2). */
  nickname?: string;
  roleIds: string[];
  joinedAt: string;
  presence: PresenceStatus;
  banned: boolean;
}

/* ─── Mensagens (§9, 2.1) ────────────────────────────────────────── */

export interface Reaction {
  emoji: string;
  count: number;
  /** Ids de quem reagiu — destaca o chip quando inclui a identidade local. */
  userIds: string[];
}

export type AttachmentKind = "video" | "image" | "audio" | "document" | "other";

export interface Attachment {
  id: string;
  name: string;
  sizeBytes: number;
  kind: AttachmentKind;
  /** 0-100; distribuição estilo torrent (§11, B8). */
  downloadProgress: number;
  availablePeers: number;
  hostAvailable: boolean;
}

export type MessageDeliveryState =
  | "sent"
  | "sending"
  | "failed"
  /** Fila local enquanto o host está offline (premissa 5, §11 B4). */
  | "queued";

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  /** Markdown básico, renderizado só depois de enviado (§11, C9). */
  content: string;
  timestamp: string;
  edited: boolean;
  pinned: boolean;
  replyToId?: string;
  threadId?: string;
  reactions: Reaction[];
  attachments: Attachment[];
  /** Ids de membros/cargos mencionados; `@everyone` usa o id `everyone`. */
  mentions: string[];
  deliveryState: MessageDeliveryState;
}

export interface Thread {
  id: string;
  rootMessageId: string;
  channelId: string;
  replyIds: string[];
  participantIds: string[];
  unreadCount: number;
}

/* ─── Convites (§7, 0.3) ─────────────────────────────────────────── */

export interface Invite {
  code: string;
  communityId: string;
  createdById: string;
  createdAt: string;
  /** Sem expiração por padrão (premissa 4). */
  expiresAt?: string;
  maxUses?: number;
  uses: number;
  revoked: boolean;
}

/**
 * Resultado da resolução de um convite (§7, 0.3). O mock devolve um destes
 * estados; `banned` não vaza dado nenhum da comunidade.
 */
export type InvitePreview =
  | { status: "ok"; community: Community; invitedBy: Member }
  | { status: "already-member"; community: Community }
  | { status: "banned"; communityName: string }
  | { status: "invalid" };

/* ─── Moderação (§10, 3.3) ───────────────────────────────────────── */

export type ModerationActionType =
  | "kick"
  | "ban"
  | "timeout"
  | "deleteMessage"
  | "createRole"
  | "revokeBan";

export interface ModerationAction {
  id: string;
  communityId: string;
  type: ModerationActionType;
  targetId: string;
  targetLabel: string;
  authorId: string;
  reason?: string;
  timestamp: string;
}

/* ─── Voz e compartilhamento de tela (§9, 2.3 / 2.4) ─────────────── */

export interface VoiceParticipant {
  identityId: string;
  speaking: boolean;
  muted: boolean;
  deafened: boolean;
  cameraOn: boolean;
  sharingScreen: boolean;
  /** Falha pontual de mesh com a identidade local (§11, B7). */
  connectionToMe: MeshStatus;
}

export interface VoiceSession {
  channelId: string;
  communityId: string;
  participants: VoiceParticipant[];
}

export type ShareTopology = "star" | "tree";

export interface RelayNode {
  identityId: string;
  /** Quantas pessoas dependem deste nó, somando a subárvore inteira. */
  relayingTo: number;
  status: "ok" | "degraded" | "reconnecting" | "failed";
}

export interface ScreenShareSession {
  presenterId: string;
  channelId: string;
  topology: ShareTopology;
  viewerIds: string[];
  quality: "auto" | "high" | "balanced" | "low";
  treeHealth: TreeHealth;
  /** Ativo quando a conexão direta falhou por NAT restritivo (§9, 2.4). */
  usingTurnFallback: boolean;
  /** Só o apresentador enxerga o primeiro nível da árvore (§9, 2.4.2). */
  firstLevelRelays: RelayNode[];
}
