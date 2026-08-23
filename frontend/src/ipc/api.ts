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
  CommunityDetail,
  CommunityListItem,
  CoreStatus,
  HostStatusDto,
  IdentityDto,
  InvitePreview,
  MembersPage,
  MessagesPage,
  OutboxDto,
  Presence,
  ResolvedMessageLink,
  StructureDto,
} from "./dto";

export const cliente = new IpcClient();

function req<T>(cmd: string, arg?: unknown, timeoutMs?: number): Promise<T> {
  return cliente.request(cmd, arg ?? {}, undefined, timeoutMs) as Promise<T>;
}

/** `main-confirmed`: o diálogo nativo vem ANTES do quadro, e o token é de uso único. */
async function reqConfirmado<T>(cmd: string, arg?: unknown, timeoutMs?: number): Promise<T> {
  const token = await pedirToken(cmd);
  return cliente.request(cmd, arg ?? {}, token, timeoutMs) as Promise<T>;
}

export const api = {
  /* ── Núcleo e identidade (§15.4 "Identidade e app") ───────────────────────── */

  coreStatus: () => req<CoreStatus>("core.status"),

  identity: () => req<IdentityDto | null>("query.identity"),

  identityCreate: (arg: { displayName: string; avatarColor: string }) =>
    req<{ publicKey: string; handle: string; createdAt: number }>("identity.create", arg),

  /** §15.4 — main-confirmed; a passphrase vai no argumento, o arquivo nunca cruza o IPC-R. */
  identityImport: (arg: { passphrase: string }) =>
    reqConfirmado<{ publicKey: string; handle: string; communities: number }>("identity.import", arg),

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
    clientRef?: string;
    replyToId?: string;
    threadId?: string;
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

  communityCreate: (arg: { name: string; iconEmoji?: string; iconColor: string; description?: string }) =>
    req<{ communityId: string; defaultChannelId: string }>("community.create", arg),

  /** §8.1 — fixa a residência `full` na ativa; `null` devolve todas ao `light`. */
  communityActivate: (communityId: string | null) =>
    req<{ residency: string }>("community.activate", { communityId }),

  communityLeave: (communityId: string) =>
    req<{ leftLocally: true; opId: string; droppedQueued: number }>("community.leave", { communityId }),

  /** ⏱ e main-confirmed — U-18c. */
  communityAssumeHost: (communityId: string) =>
    reqConfirmado<{ newCommunityId: string; seq: number }>("community.assumeHost", { communityId }, TIMEOUT_HOST_MS),

  /* ── Convites e deep link (§12.3, §3.5) ───────────────────────────────────── */

  inviteResolve: (codeOrLink: string) => req<InvitePreview>("invite.resolve", { codeOrLink }, TIMEOUT_HOST_MS),

  inviteRedeem: (arg: { codeOrLink: string; displayName?: string }) =>
    req<{ communityId: string; defaultChannelId: string; seq: number }>("invite.redeem", arg, TIMEOUT_HOST_MS),
} as const;
