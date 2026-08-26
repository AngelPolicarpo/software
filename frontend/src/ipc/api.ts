/**
 * Superfície tipada de IPC-R usada pelo produto — §15.4 (escritas) e §15.6 (queries).
 *
 * Só entra aqui o que esta fatia realmente chama. Um invólucro para um comando que nenhuma
 * tela usa seria superfície morta, e superfície morta envelhece divergindo da tabela.
 *
 * Três coisas o invólucro carrega e a tela não repete:
 *  - o **timeout** certo: 10 s por default, 30 s nas ⏱ de §15.4 que dependem do host;
 *  - o **token** de §15.3 nas `main-confirmed`, pedido ao main antes da chamada;
 *  - o tipo da resposta, transcrito de §15.6 em `dto.ts`.
 */

import { IpcClient, TIMEOUT_HOST_MS } from "./client";
import { pedirToken } from "./bridge";
import type {
  AttachmentDto,
  AuditItem,
  BanItem,
  CommunityDetail,
  CommunityListItem,
  CoreStatus,
  FileItem,
  HostStatusDto,
  IdentityDto,
  InviteItem,
  InvitePreview,
  LinkItem,
  MemberDetail,
  MembersPage,
  MessageDto,
  MessageFull,
  MessagesPage,
  OutboxDto,
  Pagina,
  Presence,
  PreferencesDto,
  ReactorsDto,
  ResolvedMessageLink,
  RoleDto,
  SearchArgs,
  ThreadUnreadItem,
  SearchResult,
  SelfModeration,
  StructureDto,
  ThreadDto,
  TimeoutItem,
} from "./dto";

export const cliente = new IpcClient();

/**
 * **Cor é `u8` na escrita** (§6.4.2): ela entra em material assinado, então o número é
 * constante de protocolo. A tradução para o token de tema é de `ipc/cores.ts`, e acontece
 * só na renderização — nunca no argumento.
 */

function req<T>(cmd: string, arg?: unknown, timeoutMs?: number): Promise<T> {
  return cliente.request(cmd, arg ?? {}, undefined, timeoutMs) as Promise<T>;
}

/** `main-confirmed`: o diálogo nativo vem ANTES do quadro, e o token é de uso único. */
async function reqConfirmado<T>(cmd: string, arg?: unknown, timeoutMs?: number): Promise<T> {
  const token = await pedirToken(cmd);
  return cliente.request(cmd, arg ?? {}, token, timeoutMs) as Promise<T>;
}

/* ── Formas de voz (§15.4 "Mídia", §17.4) ─────────────────────────────────────── */

/** §17.3 — servidores que o HOST serve; a lista vai vazia quando ele não é alcançável (L-11). */
export interface IceServerDto {
  urls: string;
  username?: string;
  credential?: string;
}

/**
 * §17.4 — o ticket assinado pelo host. Sem um válido para `(sessionId, este par)`, o cliente
 * recusa a sinalização e **não inicia DTLS** (passos 3–4 de A22).
 *
 * As chaves e a assinatura chegam como `Uint8Array`, não hex: a IPC-R é `postMessage`, que é
 * structured clone, e o `Buffer` do núcleo atravessa como bytes. É diferente do fio de §16.2,
 * que é JSON e leva hex — o núcleo tem um codec só para aquela travessia.
 */
export interface MediaTicketDto {
  sessionId: string;
  channelId: string;
  peerA: Uint8Array;
  peerB: Uint8Array;
  expiresAt: number;
  sig: Uint8Array;
}

/**
 * §17.5 — os três perfis normativos, em kbps: `high` 2500, `balanced` 1200, `low` 600.
 * Não existe "auto": a degradação automática é do sistema (a saúde desce o perfil), não um
 * valor que alguém escolha.
 */
export type ShareQualityDto = "high" | "balanced" | "low";

/** §17.5 — teto de espectadores da estrela; acima disso o host recusa com `E_SESSION_FULL`. */
export const SHARE_MAX_VIEWERS = 8;

/** §17.5 — os perfis em kbps, que viram `maxBitrate` no `RTCRtpSender` de cada espectador. */
export const SHARE_QUALITY_KBPS: Readonly<Record<ShareQualityDto, number>> = {
  high: 2500,
  balanced: 1200,
  low: 600,
};

/**
 * §17.5 — saúde por espectador, como `share.health` a entrega ao apresentador.
 *
 * `rttMs`/`lossPct` são **opcionais**: quem acabou de ser autorizado pelo host aparece na
 * lista antes de ter sido medido, e o evento é justamente como o apresentador descobre a
 * quem servir. Zerá-los faria a UI mostrar "0 ms · 0,0%" como se fosse medida.
 */
export interface ShareViewerHealthDto {
  key: string;
  rttMs?: number;
  lossPct?: number;
  quality: ShareQualityDto;
}

/** §17.6 — o roster que o host publica; `keyHex` é a identidade de §5.5. */
export interface VoiceRosterEntry {
  keyHex: string;
  muted: boolean;
  deafened: boolean;
  sharing: boolean;
  cameraOn?: boolean;
  speaking?: boolean;
}

export const api = {
  /* ── Núcleo e identidade (§15.4 "Identidade e app") ───────────────────────── */

  coreStatus: () => req<CoreStatus>("core.status"),

  identity: () => req<IdentityDto | null>("query.identity"),

  identityCreate: (arg: { displayName: string; avatarColor: number }) =>
    req<{ publicKey: string; handle: string; createdAt: number }>("identity.create", arg),

  /** §15.4 — main-confirmed; a passphrase vai no argumento, o arquivo nunca cruza o IPC-R. */
  identityImport: (arg: { passphrase: string }) =>
    reqConfirmado<{ publicKey: string; handle: string; communities: number }>("identity.import", arg),

  /**
   * §3.2 L-2 (emenda de 2026-08-23 em §15.4) — o aceite da tela dedicada. `open` pela mesma
   * razão de `identity.create`: é a pré-condição dela, e sem identidade não há contra quem
   * autorizar. Idempotente.
   */
  identityAcceptInsecureKeystore: () => req<Record<string, never>>("identity.acceptInsecureKeystore"),

  identitySetPresence: (presence: Presence) => req<Record<string, never>>("identity.setPresence", { presence }),

  /* ── Leitura (§15.6) ──────────────────────────────────────────────────────── */

  communities: () => req<CommunityListItem[]>("query.communities"),

  community: (communityId: string) => req<CommunityDetail>("query.community", { communityId }),

  structure: (communityId: string) => req<StructureDto>("query.structure", { communityId }),

  messages: (arg: {
    communityId: string;
    channelId: string;
    cursor?: string;
    limit?: number;
    direction?: "before" | "after";
  }) => req<MessagesPage>("query.messages", arg),

  members: (arg: { communityId: string; limit?: number }) => req<MembersPage>("query.members", arg),

  hostStatus: (communityId: string) => req<HostStatusDto>("query.hostStatus", { communityId }),

  outbox: (communityId?: string) =>
    req<OutboxDto>("query.outbox", communityId === undefined ? {} : { communityId }),

  resolveMessageLink: (ref: string) => req<ResolvedMessageLink>("query.resolveMessageLink", { ref }),

  /* ── Escrita de mensagem — **A**, o desfecho vem por evento (§11.1, §15.5) ─── */

  messageSend: (arg: {
    communityId: string;
    channelId: string;
    content: string;
    mentions?: string[];
    clientRef?: string;
    replyToId?: string;
    threadId?: string;
    /**
     * §13.7 r. 1 — a barreira: o renderer manda o `ticketId` e **nada mais**. Quem descreve
     * o blob é o núcleo, a partir do que ele mesmo escreveu; um `attachment` montado aqui
     * poderia apontar a mensagem para qualquer blob do mundo.
     */
    attachment?: { ticketId: string };
  }) => req<{ opId: string; state: string }>("message.send", arg),

  /** §15.1 r. 7 — "tentar de novo" reenvia o MESMO `opId`, nunca constrói op nova. */
  messageRetry: (opId: string) => req<{ state: string }>("message.retry", { opId }),

  messageCancelQueued: (opId: string) => req<Record<string, never>>("message.cancelQueued", { opId }),

  /* ── Estado local do leitor (§15.4 "Preferências locais") ─────────────────── */

  channelMarkRead: (arg: { communityId: string; channelId: string }) =>
    req<{ unreadCount: number; pendingMentions: number }>("channel.markRead", arg),

  /** §17.6 + emenda de §15.4: quem abre canal assina o typing dele. */
  channelSubscribeTyping: (arg: { communityId: string; channelId: string; on: boolean }) =>
    req<Record<string, never>>("channel.subscribeTyping", arg),

  navSetActive: (arg: { communityId?: string; channelId?: string }) =>
    req<Record<string, never>>("nav.setActive", arg),

  /* ── Comunidade (§15.4 "Comunidade", §8.1, §18.8) ─────────────────────────── */

  communityCreate: (arg: { name: string; iconEmoji?: string; iconColor: number; description?: string }) =>
    req<{ communityId: string; defaultChannelId: string }>("community.create", arg),

  /** §8.1 — fixa a residência `full` na ativa; `null` devolve todas ao `light`. */
  communityActivate: (communityId: string | null) =>
    req<{ residency: string }>("community.activate", { communityId }),

  /**
   * §15.4 — main-confirmed; apaga a réplica local de uma comunidade `left`/`removed` antes
   * do `retain_until`. Comunidade ainda participada é `E_VALIDATION` (emenda de 2026-08-23):
   * sair vem primeiro.
   */
  /** §15.4 ⏱ main-confirmed — só o host corrente; a resposta diz o que ainda não replicou. */
  communityEnd: (arg: { communityId: string; reason?: string }) =>
    reqConfirmado<{ seq: number; replicatedTo: number }>("community.end", arg, TIMEOUT_HOST_MS),

  communityForget: (communityId: string) => reqConfirmado<Record<string, never>>("community.forget", { communityId }),

  communityLeave: (communityId: string) =>
    req<{ leftLocally: true; opId: string; droppedQueued: number }>("community.leave", { communityId }),

  /** ⏱ e main-confirmed — U-18c. */
  communityAssumeHost: (communityId: string) =>
    reqConfirmado<{ newCommunityId: string; seq: number }>("community.assumeHost", { communityId }, TIMEOUT_HOST_MS),

  /* ── Voz (§15.4 "Mídia", §17.2–§17.4) ─────────────────────────────────────── */

  /**
   * §17.4 — o host decide. A resposta traz o roster, os `iceServers` que ELE serve (§17.3) e
   * um ticket por par: sem ticket válido o cliente não aceita sinalização nem inicia DTLS.
   */
  voiceJoin: (arg: { communityId: string; channelId: string }) =>
    req<{
      sessionId: string;
      roster: VoiceRosterEntry[];
      iceServers: IceServerDto[];
      tickets: MediaTicketDto[];
      turnCredential?: { username: string; password: string; expiresAt: number };
    }>("voice.join", arg, TIMEOUT_HOST_MS),

  /** §15.4 — "voz é uma só": não leva sessão, porque a instalação tem no máximo uma. */
  voiceLeave: () => req<Record<string, never>>("voice.leave", {}),

  voiceSetSelf: (arg: { muted?: boolean; deafened?: boolean; cameraOn?: boolean; speaking?: boolean }) =>
    req<Record<string, never>>("voice.setSelf", arg),

  voiceMuteParticipant: (arg: { communityId: string; identityKey: string; muted: boolean }) =>
    req<Record<string, never>>("voice.muteParticipant", arg),

  /**
   * §17.4 passo 3 — SDP e ICE viajam pelo núcleo, com o `ticketId` que autoriza o par. A
   * mídia NÃO passa por aqui: quando a negociação fecha, o fluxo é DTLS-SRTP ponta a ponta e
   * o núcleo deixa de ver qualquer coisa (§17.2).
   */
  voiceSignal: (arg: { peerKey: string; ticketId: string; sdp?: string; ice?: string }) =>
    req<Record<string, never>>("voice.signal", arg),

  /* ── Tela (§15.4 "Mídia", §17.5) ──────────────────────────────────────────── */

  /**
   * §17.5 — o host decide: `voice_share_screen`, canal de voz, apresentador dentro da
   * chamada, e **uma sessão por apresentador** (`E_ALREADY_SHARING`). O canal aceita
   * várias transmissões ao mesmo tempo desde 2026-08-26; o que não se repete é a minha,
   * porque a captura de tela desta instalação é uma só.
   *
   * A resposta traz `captureToken` porque esta é a **IPC-R**: o token é capacidade LOCAL
   * (§17.4 emendado), cunhada pelo núcleo desta máquina no instante em que o host autorizou.
   * Ele NÃO trafega — a resposta de `shareStart` em §16.2 é só `{sessionId}`. Quem o verifica
   * é o mesmo núcleo, por `capture.authorize` (§15.7), e é isso que faz a ordem de `T-41`
   * valer: `share.start` → host autoriza → `captureToken` → `getDisplayMedia`.
   */
  shareStart: (arg: { communityId: string; channelId: string; quality?: ShareQualityDto }) =>
    req<{ sessionId: string; captureToken: { token: string; sessionId: string; expiresAt: number } }>(
      "share.start",
      arg,
      TIMEOUT_HOST_MS,
    ),

  shareStop: (arg: { sessionId: string }) => req<Record<string, never>>("share.stop", arg),

  /** §17.5 papel **espectador**: pede o perfil; o apresentador aprende por `share.health`. */
  shareSetQuality: (arg: { sessionId: string; quality: ShareQualityDto }) =>
    req<{ applied: boolean }>("share.setQuality", arg),

  /** §17.5 — entrar como espectador. `E_SESSION_FULL` acima de `SHARE_MAX_VIEWERS` (8). */
  shareJoin: (arg: { sessionId: string }) =>
    req<{ ticketId: string; presenterKey: string }>("share.join", arg, TIMEOUT_HOST_MS),

  /**
   * §15.4 `share.report` — **emenda de 2026-08-25**. O apresentador relata o que mediu no
   * `RTCStatsReport` por espectador; o núcleo consolida e devolve `share.health` (§15.5).
   * É a perna de subida que faltava: sem ela `share.health` nunca tinha número para levar,
   * e o `share.setQuality` de um espectador não alcançava quem apresenta.
   */
  shareReport: (arg: { sessionId: string; samples: Array<{ viewerKey: string; rttMs: number; lossPct: number }> }) =>
    req<Record<string, never>>("share.report", arg),

  /* ── Convites e deep link (§12.3, §3.5) ───────────────────────────────────── */

  inviteResolve: (codeOrLink: string) => req<InvitePreview>("invite.resolve", { codeOrLink }, TIMEOUT_HOST_MS),

  inviteRedeem: (arg: { codeOrLink: string; displayName?: string }) =>
    req<{ communityId: string; defaultChannelId: string; seq: number }>("invite.redeem", arg, TIMEOUT_HOST_MS),

  /* ── Mensagem: ações — todas **A**, o desfecho vem por evento (§15.4) ──────── */

  messageEdit: (arg: { communityId: string; messageId: string; content: string; clientRef?: string }) =>
    req<{ opId: string; state: string }>("message.edit", arg),

  messageDelete: (arg: { communityId: string; messageId: string; reason?: string; clientRef?: string }) =>
    req<{ opId: string; state: string }>("message.delete", arg),

  messagePin: (arg: { communityId: string; messageId: string; pinned: boolean; clientRef?: string }) =>
    req<{ opId: string; state: string }>("message.pin", arg),

  messageReact: (arg: { communityId: string; messageId: string; emoji: string; present: boolean; clientRef?: string }) =>
    req<{ opId: string; state: string }>("message.react", arg),

  threadCreate: (arg: { communityId: string; rootMessageId: string; clientRef?: string }) =>
    req<{ opId: string; state: string }>("thread.create", arg),

  /* ── Leitura por mensagem, thread e painéis do canal (§15.6) ──────────────── */

  message: (arg: { communityId: string; messageId: string }) =>
    req<MessageFull | null>("query.message", arg),

  thread: (arg: { communityId: string; threadId: string; cursor?: string; limit?: number }) =>
    req<ThreadDto | null>("query.thread", arg),

  /** §15.6 emenda de 2026-08-25 — o badge do chip de thread (§9, 2.2). */
  threadUnread: (arg: { communityId: string; channelId?: string; cursor?: string; limit?: number }) =>
    req<Pagina<ThreadUnreadItem>>("query.thread.unread", arg),

  threadMarkRead: (arg: { communityId: string; threadId: string }) =>
    req<{ unreadCount: number }>("thread.markRead", arg),

  reactors: (arg: { communityId: string; messageId: string; emoji: string; limit?: number }) =>
    req<ReactorsDto>("query.reactors", arg),

  pinned: (arg: { communityId: string; channelId: string; cursor?: string; limit?: number }) =>
    req<Pagina<MessageDto>>("query.pinned", arg),

  files: (arg: { communityId: string; channelId: string; cursor?: string; limit?: number }) =>
    req<Pagina<FileItem>>("query.files", arg),

  links: (arg: { communityId: string; channelId: string; cursor?: string; limit?: number }) =>
    req<Pagina<LinkItem>>("query.links", arg),

  search: (arg: SearchArgs) => req<SearchResult>("query.search", arg),

  /* ── Membros, cargos e moderação — as escritas são todas ⏱ (§15.4) ────────── */

  member: (arg: { communityId: string; identityKey: string }) => req<MemberDetail>("query.member", arg),

  membersFiltrados: (arg: {
    communityId: string;
    filter?: { query?: string; roleId?: string; onlyOnline?: boolean };
    cursor?: string;
    limit?: number;
  }) => req<MembersPage>("query.members", arg),

  roles: (communityId: string) => req<{ roles: RoleDto[] }>("query.roles", { communityId }),

  roleCreate: (arg: {
    communityId: string;
    name: string;
    color: number;
    permissions: string[];
    mentionable: boolean;
    afterRoleId?: string;
  }) => req<{ roleId: string; seq: number; rank?: string }>("role.create", arg, TIMEOUT_HOST_MS),

  roleUpdate: (arg: {
    communityId: string;
    roleId: string;
    name?: string;
    color?: number;
    permissions?: string[];
    mentionable?: boolean;
  }) => req<{ seq: number }>("role.update", arg, TIMEOUT_HOST_MS),

  roleMove: (arg: { communityId: string; roleId: string; afterRoleId?: string; beforeRoleId?: string }) =>
    req<{ seq: number; rank?: string }>("role.move", arg, TIMEOUT_HOST_MS),

  roleDelete: (arg: { communityId: string; roleId: string }) =>
    req<{ seq: number; affectedMembers: number; clearedChannelRefs: number }>("role.delete", arg, TIMEOUT_HOST_MS),

  memberSetRoles: (arg: { communityId: string; targetKey: string; roleIds: string[] }) =>
    req<{ seq: number; appliedRoleIds?: string[] }>("member.setRoles", arg, TIMEOUT_HOST_MS),

  memberSetNickname: (arg: { communityId: string; nickname: string | null }) =>
    req<{ seq: number }>("member.setNickname", arg, TIMEOUT_HOST_MS),

  modKick: (arg: { communityId: string; targetKey: string; reason?: string }) =>
    req<{ seq: number }>("mod.kick", arg, TIMEOUT_HOST_MS),

  modBan: (arg: { communityId: string; targetKey: string; reason?: string }) =>
    req<{ seq: number; hiddenMessages: number; revokedInvites: number }>("mod.ban", arg, TIMEOUT_HOST_MS),

  modRevokeBan: (arg: { communityId: string; targetKey: string }) =>
    req<{ seq: number; restoredMessages: number }>("mod.revokeBan", arg, TIMEOUT_HOST_MS),

  modTimeout: (arg: { communityId: string; targetKey: string; until: number; reason?: string }) =>
    req<{ seq: number }>("mod.timeout", arg, TIMEOUT_HOST_MS),

  modRemoveTimeout: (arg: { communityId: string; targetKey: string }) =>
    req<{ seq: number }>("mod.removeTimeout", arg, TIMEOUT_HOST_MS),

  /** §15.6 — exigem `view_audit_log` (ou `ban_members`); sem ela é `E_PERMISSION_DENIED`. */
  bans: (arg: { communityId: string; cursor?: string; limit?: number }) => req<Pagina<BanItem>>("query.bans", arg),

  timeouts: (arg: { communityId: string; cursor?: string; limit?: number }) =>
    req<Pagina<TimeoutItem>>("query.timeouts", arg),

  auditLog: (arg: { communityId: string; type?: string; byKey?: string; cursor?: string; limit?: number }) =>
    req<Pagina<AuditItem>>("query.auditLog", arg),

  selfModeration: (communityId: string) => req<SelfModeration>("query.selfModeration", { communityId }),

  /* ── Estrutura e identidade da comunidade — todas ⏱ (§15.4) ───────────────── */

  communityUpdate: (arg: {
    communityId: string;
    name?: string;
    iconEmoji?: string;
    iconColor?: number;
    description?: string;
  }) => req<{ seq: number }>("community.update", arg, TIMEOUT_HOST_MS),

  channelCreate: (arg: {
    communityId: string;
    categoryId: string;
    type: number;
    name: string;
    topic?: string;
    readOnlyForRoleIds?: string[];
    afterChannelId?: string;
  }) => req<{ channelId: string; seq: number; rank?: string }>("channel.create", arg, TIMEOUT_HOST_MS),

  channelUpdate: (arg: {
    communityId: string;
    channelId: string;
    name?: string;
    topic?: string;
    readOnlyForRoleIds?: string[];
  }) => req<{ seq: number }>("channel.update", arg, TIMEOUT_HOST_MS),

  channelMove: (arg: { communityId: string; channelId: string; categoryId: string; afterChannelId?: string }) =>
    req<{ seq: number; rank?: string }>("channel.move", arg, TIMEOUT_HOST_MS),

  channelDelete: (arg: { communityId: string; channelId: string }) =>
    req<{ seq: number; droppedQueued: number }>("channel.delete", arg, TIMEOUT_HOST_MS),

  categoryCreate: (arg: { communityId: string; name: string; afterCategoryId?: string }) =>
    req<{ categoryId: string; seq: number; rank?: string }>("category.create", arg, TIMEOUT_HOST_MS),

  categoryRename: (arg: { communityId: string; categoryId: string; name: string }) =>
    req<{ seq: number }>("category.rename", arg, TIMEOUT_HOST_MS),

  /** §15.4 — exatamente DUAS formas; pedir as duas na mesma chamada é `E_VALIDATION`. */
  categoryDelete: (
    arg:
      | { communityId: string; categoryId: string; moveChannelsTo?: string }
      | { communityId: string; categoryId: string; deleteChannels: true },
  ) => req<{ seq: number; movedChannels: number; deletedChannels: number }>("category.delete", arg, TIMEOUT_HOST_MS),

  communitySetSuccessors: (arg: { communityId: string; successorKeys: string[] }) =>
    req<{ seq: number }>("community.setSuccessors", arg, TIMEOUT_HOST_MS),

  /* ── Convites (§12, §15.4) ────────────────────────────────────────────────── */

  invites: (communityId: string) => req<{ items: InviteItem[] }>("query.invites", { communityId }),

  inviteCreate: (arg: { communityId: string; expiresInDays?: number; maxUses?: number; label?: string }) =>
    req<{ invitePublicKey: string; code: string; expiresAt?: number; maxUses?: number; seq: number }>(
      "invite.create",
      arg,
      TIMEOUT_HOST_MS,
    ),

  inviteRevoke: (arg: { communityId: string; invitePublicKey: string }) =>
    req<{ seq: number }>("invite.revoke", arg, TIMEOUT_HOST_MS),

  /* ── Preferências locais — sem host, sem fila (§15.4) ─────────────────────── */

  preferences: () => req<PreferencesDto>("query.preferences"),

  channelSetMuted: (arg: { communityId: string; channelId: string; muted: boolean }) =>
    req<Record<string, never>>("channel.setMuted", arg),

  categorySetCollapsed: (arg: { communityId: string; categoryId: string; collapsed: boolean }) =>
    req<Record<string, never>>("category.setCollapsed", arg),

  settingsSetDevice: (arg: { kind: "microphone" | "camera" | "output"; deviceId: string }) =>
    req<Record<string, never>>("settings.setDevice", arg),

  settingsSetVolume: (arg: { kind: "input" | "output"; value: number }) =>
    req<Record<string, never>>("settings.setVolume", arg),

  settingsSetNotifications: (arg: { enabled?: boolean; communityId?: string; level?: string }) =>
    req<Record<string, never>>("settings.setNotifications", arg),

  /* ── Identidade: o resto de §15.4 "Identidade e app" ──────────────────────── */

  identityUpdate: (arg: { displayName?: string; avatarColor?: number }) =>
    req<{ queued: Array<{ communityId: string; opId: string }> }>("identity.update", arg),

  /** §13.3 r. 5 — responde `{}`: o caminho do arquivo NUNCA cruza o IPC-R. */
  identityExport: (passphrase: string) => reqConfirmado<Record<string, never>>("identity.export", { passphrase }),

  identityWipe: () => reqConfirmado<Record<string, never>>("identity.wipe"),

  /* ── Anexos (§13) ─────────────────────────────────────────────────────────── */

  filePickForAttachment: (communityId: string) =>
    req<{ ticketId: string; name: string; sizeBytes: number; kind: number }>("file.pickForAttachment", {
      communityId,
    }),

  blobStage: (ticketId: string) => req<AttachmentDto>("blob.stage", { ticketId }, TIMEOUT_HOST_MS),

  blobDownload: (arg: { communityId: string; blobsCoreKey: string; blobId: AttachmentDto["blobId"] }) =>
    req<{ state: string }>("blob.download", arg),

  blobCancel: (arg: { blobsCoreKey: string; blobId: AttachmentDto["blobId"] }) =>
    req<Record<string, never>>("blob.cancel", arg),

  /**
   * §15.3 — a classe depende do DADO: `archive` é `main-confirmed`. O token não pode ser
   * pedido antes de saber o tipo, então quem o exige é o handler; a UI tenta sem token e,
   * se o núcleo recusar por confirmação, refaz com ele.
   */
  blobReveal: async (arg: { blobsCoreKey: string; blobId: AttachmentDto["blobId"]; mode: "open" | "folder" }) => {
    try {
      return await req<Record<string, never>>("blob.reveal", arg);
    } catch (e) {
      if ((e as { code?: string }).code !== "E_PERMISSION_DENIED") throw e;
      return await reqConfirmado<Record<string, never>>("blob.reveal", arg);
    }
  },

  /* ── Diagnóstico e impacto de saída (§15.4, §18.7) ────────────────────────── */

  hostExitImpact: () =>
    req<Array<{ communityId: string; name: string; onlineCount: number; inCallCount: number; pendingReplication: number }>>(
      "host.exitImpact",
    ),

  diagSnapshot: () => req<Record<string, unknown>>("diag.snapshot"),

  /** §18.7 — main-confirmed: congela o núcleo enquanto reabre o estado a partir do log. */
  coreReproject: (communityId?: string) =>
    reqConfirmado<Record<string, never>>(
      "core.reproject",
      communityId === undefined ? {} : { communityId },
      TIMEOUT_HOST_MS,
    ),

  diagRun: () =>
    req<{ natType: string; peerCount: number; relayAvailable: boolean; stunReachable: boolean; ranAt: number }>(
      "diag.run",
      {},
      TIMEOUT_HOST_MS,
    ),

  coreShutdown: () => req<{ drainedMs: number; pendingOps: number; replicatedTo: number }>("core.shutdown", {}, TIMEOUT_HOST_MS),
} as const;
