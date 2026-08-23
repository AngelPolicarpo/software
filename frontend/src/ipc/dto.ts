/**
 * Esquemas de resposta de `backend-v2.md` §15.6, transcritos.
 *
 * Regra deste arquivo: **nenhum campo que a tabela não declare**. Onde a tela precisaria de
 * algo que a tabela fechada não tem, o campo fica ausente e a falta vira pendência
 * registrada — precedente de §46–§57. Estes tipos NÃO são os de `src/domain/types.ts`: lá
 * está o modelo das fixtures do mock, com nomes e enums próprios (`HostStatus` de três
 * valores, `position` em vez de `rank`). Mapear um no outro seria inventar correspondência;
 * o produto usa o que o fio entrega.
 */

export type Key = string;
export type Ms = number;
export type Cursor = string;
export type Rank = string;

export interface UserRef {
  key: Key;
  displayName: string;
  handle: string;
  avatarColor: string;
  nickname?: string;
  /** §6.1 L-5 — marcada pelo `fold` desde §57. */
  collision: boolean;
}

export type HostStatus =
  | "unknown"
  | "connecting"
  | "online"
  | "reconnecting"
  | "offline"
  | "ended"
  | "unauthorized"
  | "incompatible"
  | "forked";

export type ReplicationState =
  | "synced"
  | "catching-up"
  | "stalled"
  | "blocked"
  | "unauthorized"
  | "forked";

export type CorePhase =
  | "boot"
  | "awaiting-identity"
  | "opening"
  | "ready"
  | "draining"
  | "stopped";

export interface CoreStatus {
  phase: CorePhase;
  epoch: number;
  coreVersion: string;
  opVersion: number;
  manifestSchemaVersion: number;
  viewSchemaVersion: number;
  keystore: "secure" | "insecure-fallback";
  buildChannel: "prod" | "dev";
}

/** §6.1 — `offline` NUNCA é publicado; ausência é que significa offline. */
export type Presence = "online" | "idle" | "dnd" | "invisible";

export interface IdentityDto {
  key: Key;
  displayName: string;
  handle: string;
  avatarColor: string;
  presence: Presence;
  createdAt: Ms;
}

export interface UnreadDto {
  count: number;
  mentions: number;
}

export interface CommunityListItem {
  id: string;
  name: string;
  iconEmoji?: string;
  iconColor: string;
  memberCount: number;
  isHostedByMe: boolean;
  hostStatus: HostStatus;
  replication: { state: ReplicationState; lag: number };
  unread: UnreadDto;
  notificationLevel: string;
  endedAt?: Ms;
  /** Ausente enquanto não houver contato observado com o host (§22.2 emendado). */
  inactiveDays?: number;
  partialInterpretation: boolean;
}

export interface CommunityDetail extends CommunityListItem {
  myPermissions: string[];
  myRoleIds: string[];
  myTopRank: Rank;
  isHost: boolean;
  hostRef: UserRef;
  successorKeys: Key[];
  /** U-18c — só existe em continuação com a origem replicada aqui (L-23, §18.8.1). */
  pendingReentry?: UserRef[];
}

export interface ChannelDto {
  id: string;
  name: string;
  type: number;
  topic?: string;
  rank: Rank;
  readOnly: boolean;
  muted: boolean;
  unread: UnreadDto;
  firstUnreadSeq?: number;
  voice?: { count: number; first: UserRef[] };
}

export interface CategoryDto {
  id: string;
  name: string;
  rank: Rank;
  collapsed: boolean;
  channels: ChannelDto[];
}

export interface StructureDto {
  categories: CategoryDto[];
}

export interface AttachmentDto {
  [campo: string]: unknown;
}

export interface MessageDto {
  id: string;
  seq: number;
  channelId: string;
  author: UserRef;
  /** `null` quando tombstonada (§15.6.1). */
  content: string | null;
  authorTs: Ms;
  hostTs: Ms;
  clockSkewed: boolean;
  editedAt?: Ms;
  deletedAt?: Ms;
  pinned?: boolean;
  replyToId?: string;
  threadId?: string;
  mentions?: Key[];
  reactions?: ReactionDto[];
  attachment?: AttachmentDto;
  thread?: { threadId: string; replyCount: number };
}

export interface ReactionDto {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface MessagesPage {
  messages: MessageDto[];
  nextCursor?: Cursor;
  hasMore: boolean;
  replication: ReplicationState;
}

export interface MemberEntry extends UserRef {
  presence: Presence;
  joinedAt: Ms;
}

export interface MembersPage {
  groups: Array<{
    roleId: string;
    roleName: string;
    roleColor: string;
    rank: Rank;
    members: MemberEntry[];
  }>;
  offlineCount: number;
  total: number;
  nextCursor?: Cursor;
}

export interface HostStatusDto {
  status: HostStatus;
  lastSeenAt?: Ms;
  inactiveDays?: number;
  replication: { state: ReplicationState; lag: number };
  attempt?: number;
}

export type OutboxItemState = string;

export interface OutboxItem {
  opId: string;
  clientRef?: string;
  communityId: string;
  channelId?: string;
  channelName?: string;
  kind: string;
  kindLabel: string;
  state: OutboxItemState;
  attempts: number;
  nextAttemptAt: Ms;
  lastError?: string;
  droppedReason?: string;
  preview: { content?: string; emoji?: string; targetMessageId?: string };
}

export interface OutboxDto {
  items: OutboxItem[];
  counts: { queued: number; sending: number; failed: number };
}

export interface InvitePreview {
  [campo: string]: unknown;
}

export type ResolvedMessageLink =
  | { status: "ok"; communityId: string; channelId: string; messageId: string; seq: number }
  | { status: "not-member"; communityId: string }
  | { status: "not-synced"; communityId: string; channelId: string }
  | { status: "deleted" }
  | { status: "malformed" };

/* ─── Eventos de §15.5 que esta fatia escuta ─────────────────────────────────── */

export interface EvPresenceChanged {
  communityId: string;
  /** Delta: só quem MUDOU no tick. Quem some expira pelo TTL — `offline` não vem no fio. */
  entries: Array<{ identityKey: Key; status: Presence; lastSeenAt: Ms }>;
}

export interface EvTypingChanged {
  communityId: string;
  channelId: string;
  identityKeys: Key[];
}

export interface EvMessagesAppended {
  communityId: string;
  channelId: string;
  fromSeq: number;
  toSeq: number;
  hasMention: boolean;
}

export interface EvMessageAccepted {
  opId: string;
  clientRef?: string;
  messageId: string;
  seq: number;
  channelId: string;
}

export interface EvMessageFailed {
  opId: string;
  clientRef?: string;
  code: string;
  retryInMs?: number;
  terminal: boolean;
}

export interface EvMessageDropped {
  opId: string;
  clientRef?: string;
  reason: string;
  channelId: string;
}

export interface EvHostStatusChanged {
  communityId: string;
  status: HostStatus;
  lastSeenAt?: Ms;
  attempt?: number;
}

export interface EvUnreadChanged {
  communityId: string;
  channelId?: string;
  threadId?: string;
  unreadCount: number;
  pendingMentions: number;
}
