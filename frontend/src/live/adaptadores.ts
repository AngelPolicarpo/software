/**
 * Adaptadores §15.6 → `domain/types.ts`.
 *
 * O produto é o mock: telas, ícones e componentes ficam **intactos**. O que muda é de onde
 * o dado vem. Estas funções são a única costura — traduzem os DTOs do fio para as formas que
 * os componentes já consomem, e é aqui que mora toda divergência entre os dois modelos.
 *
 * Por que a tradução vive aqui e não nos componentes: `domain/types.ts` foi escrito para as
 * fixtures e é mais estreito que §15.6 em vários pontos (cor como token × `u8`, `position`
 * × `rank`, `HostStatus` de 3 × 9 valores). Espalhar essas conversões pelas telas colocaria
 * regra de fronteira dentro da UI e faria cada divergência ser resolvida de um jeito
 * diferente em cada arquivo.
 *
 * Regra desta fatia: **onde o mock não tem aparência para um valor do fio, escolhe-se o
 * vizinho mais conservador e a lacuna fica registrada** — nunca se inventa elemento de tela.
 */

import { tokenDaCor } from "../ipc/cores";
import type {
  AvatarColor,
  Category,
  Channel,
  Community,
  Identity,
  Member,
  Message,
  PresenceStatus,
  Reaction,
  Role,
  RoleColor,
  HostStatus as HostStatusMock,
} from "../domain/types";
import type {
  ChannelDto,
  CommunityDetail,
  CommunityListItem,
  HostStatus,
  IdentityDto,
  MemberEntry,
  MessageDto,
  Presence,
  RoleDto,
  StructureDto,
  UserRef,
} from "../ipc/dto";

/* ─── Escalares ──────────────────────────────────────────────────────────── */

/** §6.4.2 — o fio manda `u8`; o mock pinta por token. Fora do catálogo cai no neutro. */
export function corDeAvatar(bruto: unknown): AvatarColor {
  return (tokenDaCor(bruto) ?? "role-neutral") as AvatarColor;
}

/** `accent` não é atribuível a cargo (§6.4.2): se vier, vira neutro. */
export function corDeCargo(bruto: unknown): RoleColor {
  const token = tokenDaCor(bruto);
  return token === null || token === "accent" ? "role-neutral" : token;
}

export function iso(ms: number | undefined): string {
  return new Date(ms ?? 0).toISOString();
}

/** §6.1 — `offline` não é publicado: a AUSÊNCIA de presença é que o significa. */
export function presenca(p: Presence | undefined): PresenceStatus {
  return p ?? "offline";
}

/**
 * §15.6 `HostStatus` tem nove valores; o mock tem três. Os quatro terminais
 * (`ended`, `unauthorized`, `incompatible`, `forked`) não têm aparência no mock e caem em
 * `offline` — que é o vizinho honesto: em todos eles não há host de quem esperar resposta.
 * O que se perde é a explicação, e ela está registrada como lacuna de UX.
 */
export function statusDoHost(s: HostStatus | undefined): HostStatusMock {
  switch (s) {
    case "online":
      return "online";
    case "connecting":
    case "reconnecting":
    case "unknown":
      return "reconnecting";
    default:
      return "offline";
  }
}

/** §6 — `type` é numérico no fio; 1 é voz. */
export function tipoDeCanal(t: number): Channel["type"] {
  return t === 1 ? "voice" : "text";
}

/* ─── Entidades ──────────────────────────────────────────────────────────── */

export function identidade(d: IdentityDto): Identity {
  return {
    id: d.key,
    handle: d.handle,
    displayName: d.displayName,
    avatarColor: corDeAvatar(d.avatarColor),
    // O mock mostra a chave truncada em Configurações; é a mesma chave pública.
    publicKey: d.key,
    presence: presenca(d.presence),
    createdAt: iso(d.createdAt),
  };
}

export function membroDeRef(communityId: string, u: UserRef, extra?: Partial<Member>): Member {
  return {
    identityId: u.key,
    communityId,
    displayName: u.displayName,
    handle: u.handle,
    avatarColor: corDeAvatar(u.avatarColor),
    ...(u.nickname !== undefined ? { nickname: u.nickname } : {}),
    roleIds: [],
    joinedAt: iso(0),
    presence: "offline",
    banned: false,
    ...extra,
  };
}

export function membroDeEntrada(communityId: string, m: MemberEntry, roleId: string): Member {
  return membroDeRef(communityId, m, {
    roleIds: [roleId],
    joinedAt: iso(m.joinedAt),
    presence: presenca(m.presence),
  });
}

export function cargo(r: RoleDto, posicao: number): Role {
  return {
    id: r.id,
    name: r.name,
    color: corDeCargo(r.color),
    // `rank` é índice fracionário (§6.4.1) e não é comparável a um inteiro. A posição do
    // mock é ordinal, e `query.roles` já vem em `rank DESC`: a ordem do array É a hierarquia.
    position: posicao,
    permissions: r.permissions as Role["permissions"],
    mentionable: r.mentionable,
    memberCount: r.memberCount,
    ...(r.isDefault ? { isDefault: true } : {}),
    ...(r.isFounder ? { isFounder: true } : {}),
  };
}

export function comunidade(c: CommunityListItem, detalhe?: CommunityDetail, estrutura?: StructureDto): Community {
  return {
    id: c.id,
    name: c.name,
    ...(c.iconEmoji !== undefined ? { iconEmoji: c.iconEmoji } : {}),
    iconColor: corDeAvatar(c.iconColor),
    // §15.6 não declara `description` em `query.community`; o mock a exibe em
    // Configurações. Campo sem fonte fica AUSENTE — lacuna registrada.
    // `hostPeerId` do mock é identificação de quem hospeda; no fio isso é `hostRef.key`, que
    // só `query.community` traz. Sem detalhe carregado, fica a própria comunidade.
    hostPeerId: detalhe?.hostRef.key ?? c.id,
    isHostedByMe: c.isHostedByMe,
    // §15.6 não declara data de criação da comunidade em lugar nenhum. O mock exige o campo;
    // a época zero é visivelmente "sem data" e não finge uma. Lacuna registrada.
    createdAt: iso(0),
    memberCount: c.memberCount,
    categoryIds: (estrutura?.categories ?? []).map((cat) => cat.id),
    roleIds: detalhe?.myRoleIds ?? [],
    connectionHealth: { hostStatus: statusDoHost(c.hostStatus) },
  };
}

export function categoria(communityId: string, c: StructureDto["categories"][number]): Category {
  return {
    id: c.id,
    communityId,
    name: c.name,
    channelIds: c.channels.map((ch) => ch.id),
    collapsed: c.collapsed,
  };
}

export function canal(communityId: string, categoryId: string, ch: ChannelDto): Channel {
  return {
    id: ch.id,
    communityId,
    categoryId,
    type: tipoDeCanal(ch.type),
    name: ch.name,
    ...(ch.topic !== undefined ? { topic: ch.topic } : {}),
    unreadCount: ch.unread.count,
    pendingMentions: ch.unread.mentions,
    muted: ch.muted,
    // §15.6 dá `readOnly` JÁ RESOLVIDO para quem pergunta; o mock guardava a lista de cargos
    // e resolvia na tela. Manter a lista exigiria recalcular a permissão fora do núcleo —
    // a lista vazia com o booleano aplicado é o que preserva o comportamento sem duplicar
    // a regra. `selectIsChannelReadOnly` é ajustado para ler o campo resolvido.
    ...(ch.readOnly ? { readOnlyForRoleIds: [] } : {}),
    ...(ch.voice !== undefined ? { voiceParticipantIds: ch.voice.first.map((u) => u.key) } : {}),
  };
}

export function mensagem(m: MessageDto, euId: string | null): Message {
  return {
    id: m.id,
    channelId: m.channelId,
    authorId: m.author.key,
    // §15.6.1 — `null` é tombstone. O mock não tem estado de mensagem removida; o texto
    // é o de U-20, que já é o que a spec manda dizer.
    content: m.content ?? "_Mensagem removida da interface — os bytes continuam no registro da comunidade._",
    timestamp: iso(m.hostTs),
    edited: m.editedAt !== undefined,
    pinned: m.pinned,
    ...(m.replyTo !== undefined ? { replyToId: m.replyTo.messageId } : {}),
    ...(m.threadId !== undefined ? { threadId: m.threadId } : {}),
    // Reações e anexo não estão no `MessageDto` (§15.6.1): vêm de `query.message`, sob
    // demanda. A lista vazia é o estado antes de a linha ser detalhada, não uma afirmação
    // de que não há reação.
    reactions: [],
    attachments: [],
    mentions: [
      ...m.mentions.identityKeys,
      ...m.mentions.roleIds,
      ...(m.mentions.everyone ? ["everyone"] : []),
    ],
    // Mensagem projetada já está no log: entregue. A fila é da outbox, e é ela que produz
    // `queued`/`sending`/`failed` — nunca esta função.
    deliveryState: "sent",
    ...(euId !== null && m.mentionsMe ? {} : {}),
  };
}

export function reacoes(lista: ReadonlyArray<{ emoji: string; count: number; mine: boolean }>, euId: string | null): Reaction[] {
  return lista.map((r) => ({
    emoji: r.emoji,
    count: r.count,
    // O fio diz apenas SE eu reagi (`mine`), não quem mais reagiu — `query.reactors` é uma
    // consulta à parte. O mock usa `userIds` só para destacar o próprio chip, e é isso que
    // a lista de um elemento preserva.
    userIds: r.mine && euId !== null ? [euId] : [],
  }));
}
