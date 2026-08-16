/**
 * Estagios 13, 14 e 15 de §8.2, por `kind`:
 *   13 — limites de campo (§8.6)
 *   14 — regras estruturais R-* (§8.3)
 *   15 — emissao de efeitos (§8.4) e avanco do `DS`
 *
 * Devolve `null` quando o registro e APPLIED, ou uma `Rejection` com o codigo especifico
 * da regra. NUNCA lanca (§8.5).
 */
import { E, type ErrorCode } from '../protocol/errors.ts';
import { K } from '../protocol/kinds.ts';
import {
  ATTACHMENT_MAX_BYTES,
  CLOCK_SKEW_MS,
  LIMIT,
  MAX_ACTIVE_INVITES,
  MAX_CATEGORIES,
  MAX_CHANNELS,
  MAX_MENTIONS,
  MAX_REACTION_EMOJIS,
  MAX_ROLES,
  MAX_ROLES_PER_MEMBER,
} from '../protocol/constants.ts';
import {
  BASE_ROLE_FORBIDDEN,
  PERM,
  effectivePerms,
  isValidPerm,
} from '../protocol/permissions.ts';
import { blake2b256, verify } from '../crypto/index.ts';
import { entityId } from '../codec/idgen.ts';
import type {
  Op,
  Payload,
  PCategoryCreate,
  PCategoryDelete,
  PChannelCreate,
  PChannelDelete,
  PChannelUpdate,
  PCommunityCreate,
  PInviteCreate,
  PMemberJoin,
  PMemberSetRoles,
  PMessageDelete,
  PMessageSend,
  PModBan,
  PReactionSet,
  PRoleCreate,
  PRoleDelete,
  PRoleUpdate,
} from '../codec/opCodec.ts';
import { AUDIT, type Effect, type ModerationEntry } from './effects.ts';
import {
  CHANNEL_TYPE,
  checkCategoryName,
  checkChannelName,
  checkChannelTopic,
  checkCommunityDescription,
  checkCommunityName,
  checkDisplayName,
  checkMessageContent,
  checkModerationReason,
  checkReactionEmoji,
  checkRoleName,
  codePointsAtMost,
  isValidChannelType,
  utf8Bytes,
} from './limits.ts';
import { RANK_BOTTOM, RANK_TOP, needsRenormalization, rankBetween, renormalize } from './rank.ts';
import { emptyRing, type Channel, type Draft, type Member, type Role } from './state.ts';

export type Rejection = { code: ErrorCode; field?: string; limit?: number };

export type KindCtx = {
  seq: number;
  hostTs: number;
  flags: number;
  op: Op;
  authorHex: string;
  payload: Payload;
  draft: Draft;
  inGenesis: boolean;
  effects: Effect[];
  eff: Set<number>;
  authorTop: string | null;
  member: Member | undefined;
};

const rj = (code: ErrorCode, field?: string, limit?: number): Rejection => ({ code, field, limit });

/**
 * §6.4.2 (fecha HOLE-10) — cor viaja como `u8` em material assinado, entao a faixa e
 * constante de protocolo. `RoleColor` e 0..6; `avatarColor`/`iconColor` sao 0..7, porque
 * `accent` (7) e a cor do proprio app e nao e atribuivel a cargo.
 *
 * Fora da faixa e REJECTED, nunca clampado: clampar faria duas replicas com paletas de
 * tamanhos diferentes convergirem para cores diferentes a partir do mesmo log.
 */
const ROLE_COLOR_MAX = 6;
const AVATAR_COLOR_MAX = 7;
const isRoleColor = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= ROLE_COLOR_MAX;
const isAvatarColor = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= AVATAR_COLOR_MAX;
const VAL = (field: string): Rejection => rj(E.VALIDATION, field);

// ---------------------------------------------------------------------------------
// utilitarios
// ---------------------------------------------------------------------------------

function newId(ctx: KindCtx, t: 'message' | 'channel' | 'category' | 'role' | 'thread' | 'modentry'): string {
  return entityId(t, ctx.op.communityId, ctx.op.author, ctx.op.authorSeq);
}

function labelOf(ctx: KindCtx, keyHex: string): string {
  const m = ctx.draft.state.members.get(keyHex);
  if (!m) return keyHex.slice(0, 8);
  return m.nickname ?? m.displayName;
}

function audit(
  ctx: KindCtx,
  type: string,
  targetId: string | null,
  targetLabel: string | null,
  reason: string | null,
): void {
  const entry: ModerationEntry = {
    id: newId(ctx, 'modentry'),
    seq: ctx.seq,
    type,
    targetId,
    // §6.13: `targetLabel` e `byLabel` sao CONGELADOS no momento da aplicacao.
    targetLabel,
    byKey: ctx.op.author,
    byLabel: labelOf(ctx, ctx.authorHex),
    reason,
    at: ctx.hostTs,
  };
  ctx.effects.push({ t: 'audit', entry });
  ctx.effects.push({
    t: 'upsert',
    table: 'moderation_log',
    key: [entry.id],
    row: {
      id: entry.id,
      seq: entry.seq,
      type: entry.type,
      target_id: entry.targetId,
      target_label: entry.targetLabel,
      by_key: entry.byKey,
      by_label: entry.byLabel,
      reason: entry.reason,
      at: entry.at,
    },
  });
}

function nameKey(type: number, name: string): string {
  return `${type}:${name}`;
}

function activeRoleRanks(ctx: KindCtx): string[] {
  const out: string[] = [];
  for (const r of ctx.draft.state.roles.values()) if (r.deletedAt === undefined) out.push(r.rank);
  return out;
}

function baseRoleId(ctx: KindCtx): string | null {
  for (const [id, r] of ctx.draft.state.roles) if (r.isDefault && r.deletedAt === undefined) return id;
  return null;
}

function founderRoleId(ctx: KindCtx): string | null {
  for (const [id, r] of ctx.draft.state.roles) if (r.isFounder && r.deletedAt === undefined) return id;
  return null;
}

function countActive<T extends { deletedAt?: number }>(m: Map<string, T>): number {
  let n = 0;
  for (const v of m.values()) if (v.deletedAt === undefined) n++;
  return n;
}

/**
 * §6.4.1, renormalizacao deterministica (fecha HOLE-15).
 *
 * `rankBetween` estourou RANK_MAX_LEN. Em vez de recusar a op — o que deixaria a
 * comunidade permanentemente incapaz de reordenar —, o escopo inteiro e reespacado
 * PRESERVANDO A ORDEM CORRENTE, e o item novo entra na posicao pedida.
 *
 * Funcao pura da lista ordenada, entao toda replica produz exatamente os mesmos ranks.
 * Emite um `patch` por item ja existente (limitado por §27.1); nao usa `patchScope`,
 * porque cada item recebe um valor DIFERENTE.
 *
 * Devolve o `rank` do item novo, ou `null` quando o escopo excede o alcance da funcao.
 */
function renormalizeScope(
  ctx: KindCtx,
  table: 'roles' | 'categories' | 'channels',
  entries: Array<{ id: string; rank: string }>,
  overflowRank: string,
): string | null {
  // Ordem corrente do escopo, com o item novo posicionado por onde o rank estourado cairia.
  const ordered = [...entries].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1));
  let insertAt = ordered.findIndex((e) => e.rank > overflowRank);
  if (insertAt < 0) insertAt = ordered.length;

  const fresh = renormalize(ordered.length + 1);
  if (fresh.length === 0) return null;

  let cursor = 0;
  for (let i = 0; i < fresh.length; i++) {
    if (i === insertAt) continue; // reservado para o item novo
    const e = ordered[cursor++];
    if (e.rank === fresh[i]) continue;
    if (table === 'roles') {
      const r = ctx.draft.roles().get(e.id);
      if (r) ctx.draft.roles().set(e.id, { ...r, rank: fresh[i] });
    } else if (table === 'categories') {
      const c = ctx.draft.categories().get(e.id);
      if (c) ctx.draft.categories().set(e.id, { ...c, rank: fresh[i] });
    } else {
      const c = ctx.draft.channels().get(e.id);
      if (c) ctx.draft.channels().set(e.id, { ...c, rank: fresh[i] });
    }
    ctx.effects.push({ t: 'patch', table, key: [e.id], fields: { rank: fresh[i] } });
  }
  return fresh[insertAt];
}

/** R-7 — a comunidade nunca fica sem canal de texto nao deletado. */
function textChannelsLeftAfter(ctx: KindCtx, removing: ReadonlySet<string>): number {
  let n = 0;
  for (const [id, c] of ctx.draft.state.channels) {
    if (c.deletedAt !== undefined) continue;
    if (c.type !== CHANNEL_TYPE.text) continue;
    if (removing.has(id)) continue;
    n++;
  }
  return n;
}

/**
 * R-10 — ban, kick, saida ou perda de `create_invite` revogam TODOS os convites que o
 * membro criou, NO MESMO REGISTRO.
 */
function revokeInvitesOf(ctx: KindCtx, ownerHex: string): void {
  for (const [pk, i] of [...ctx.draft.state.invites]) {
    if (i.revokedAt !== undefined) continue;
    if (i.createdBy.toString('hex') !== ownerHex) continue;
    ctx.draft.invites().set(pk, { ...i, revokedAt: ctx.hostTs });
    ctx.effects.push({
      t: 'patch',
      table: 'invites',
      key: [Buffer.from(pk, 'hex')],
      fields: { revoked_at: ctx.hostTs },
    });
  }
}

/** Reavalia R-10 para um membro cujo conjunto de cargos mudou. */
function applyR10OnRoleChange(ctx: KindCtx, memberHex: string, before: Set<number>): void {
  const m = ctx.draft.state.members.get(memberHex);
  if (!m) return;
  const after = effectivePerms(m.roleIds, ctx.draft.state.roles);
  if (before.has(PERM.create_invite) && !after.has(PERM.create_invite)) {
    revokeInvitesOf(ctx, memberHex);
  }
}

function setMemberRoles(ctx: KindCtx, memberHex: string, roleIds: Set<string>): void {
  const m = ctx.draft.mutMember(memberHex);
  if (!m) return;
  const before = effectivePerms(m.roleIds, ctx.draft.state.roles);
  const old = new Set(m.roleIds);
  m.roleIds = roleIds;
  for (const rid of old) {
    if (!roleIds.has(rid)) {
      ctx.effects.push({
        t: 'delete',
        table: 'member_roles',
        key: [Buffer.from(memberHex, 'hex'), rid],
      });
      ctx.effects.push({ t: 'recount', what: 'roleMemberCount', key: [rid] });
    }
  }
  for (const rid of roleIds) {
    if (!old.has(rid)) {
      ctx.effects.push({
        t: 'upsert',
        table: 'member_roles',
        key: [Buffer.from(memberHex, 'hex'), rid],
        row: { identity_key: Buffer.from(memberHex, 'hex'), role_id: rid },
      });
      ctx.effects.push({ t: 'recount', what: 'roleMemberCount', key: [rid] });
    }
  }
  applyR10OnRoleChange(ctx, memberHex, before);
}

/** Marca as mensagens de um canal como `orphaned` (§8.4.1). */
function orphanChannelMessages(ctx: KindCtx, channelId: string): void {
  // §8.4 `patchScope` (fecha HOLE-12): um canal com 100 k mensagens emitia 200 k efeitos.
  let orphanedAny = false;
  for (const [id, msg] of ctx.draft.state.messages) {
    if (msg.channelId !== channelId || msg.orphaned) continue;
    const m = ctx.draft.mutMessage(id);
    if (!m) continue;
    m.orphaned = true;
    orphanedAny = true;
  }
  if (orphanedAny) {
    const scope = { s: 'messagesOfChannel', channelId } as const;
    ctx.effects.push({ t: 'patchScope', scope, fields: { orphaned: 1 } });
    ctx.effects.push({ t: 'ftsRemoveScope', scope });
  }
}

function tombstoneChannel(ctx: KindCtx, channelId: string, at: number): void {
  const ch = ctx.draft.mutChannel(channelId);
  if (!ch || ch.deletedAt !== undefined) return;
  ch.deletedAt = at;
  ctx.draft.channelNameIndex().delete(nameKey(ch.type, ch.name));
  ctx.effects.push({ t: 'patch', table: 'channels', key: [channelId], fields: { deleted_at: at } });
  orphanChannelMessages(ctx, channelId);
}

// ---------------------------------------------------------------------------------

export function applyKind(ctx: KindCtx): Rejection | null {
  switch (ctx.op.kind) {
    case K.COMMUNITY_CREATE:
      return communityCreate(ctx);
    case K.ROLE_CREATE:
      return roleCreate(ctx);
    case K.ROLE_UPDATE:
      return roleUpdate(ctx);
    case K.ROLE_DELETE:
      return roleDelete(ctx);
    case K.MEMBER_JOIN:
      return memberJoin(ctx);
    case K.MEMBER_SET_ROLES:
      return memberSetRoles(ctx);
    case K.CATEGORY_CREATE:
      return categoryCreate(ctx);
    case K.CATEGORY_DELETE:
      return categoryDelete(ctx);
    case K.CHANNEL_CREATE:
      return channelCreate(ctx);
    case K.CHANNEL_UPDATE:
      return channelUpdate(ctx);
    case K.CHANNEL_DELETE:
      return channelDelete(ctx);
    case K.MESSAGE_SEND:
      return messageSend(ctx);
    case K.MESSAGE_DELETE:
      return messageDelete(ctx);
    case K.REACTION_SET:
      return reactionSet(ctx);
    case K.MOD_BAN:
      return modBan(ctx);
    case K.INVITE_CREATE:
      return inviteCreate(ctx);
    default:
      return rj(E.UNKNOWN_KIND); // §9.4 falha fechado
  }
}

// --- community.create (40) --------------------------------------------------------

function communityCreate(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PCommunityCreate;
  // 13
  const name = checkCommunityName(p.name);
  if (!name.ok) return VAL(name.field);
  const desc = checkCommunityDescription(p.description);
  if (!desc.ok) return VAL(desc.field);
  if (!isAvatarColor(p.iconColor)) return VAL('iconColor'); // §6.4.2
  if (p.iconEmoji !== undefined) {
    // §8.6 — `Community.iconEmoji`: 1..8 code points, <= 32 bytes (mesma unidade de
    // contagem de `Reaction.emoji`; ver "Unidade de contagem" em §8.6).
    const cp = codePointsAtMost(p.iconEmoji, LIMIT.communityIconEmojiCodePoints.max);
    if (
      cp < LIMIT.communityIconEmojiCodePoints.min ||
      cp > LIMIT.communityIconEmojiCodePoints.max ||
      utf8Bytes(p.iconEmoji) > LIMIT.communityIconEmojiBytes.max
    ) {
      return VAL('iconEmoji');
    }
  }
  // 14 — a posicao (seq 0) ja foi imposta por R-27 no pipeline.
  // 15
  const c = ctx.draft.community();
  c.exists = true;
  c.hostKey = ctx.op.author;
  c.founderKey = ctx.op.author;
  c.blobsKey = p.blobsKey;
  c.name = name.value;
  c.iconEmoji = p.iconEmoji;
  c.iconColor = p.iconColor;
  c.description = p.description === undefined ? undefined : desc.value;
  c.createdAt = ctx.hostTs;
  c.originCommunityId = p.originCommunityId;

  ctx.effects.push({
    t: 'upsert',
    table: 'communities',
    key: [ctx.draft.state.communityId],
    row: {
      id: ctx.draft.state.communityId,
      core_key: ctx.draft.state.communityKey,
      blobs_key: p.blobsKey,
      host_key: ctx.op.author,
      founder_key: ctx.op.author,
      name: name.value,
      icon_emoji: p.iconEmoji ?? null,
      icon_color: p.iconColor,
      description: p.description === undefined ? null : desc.value,
      created_at: ctx.hostTs,
      member_count: 0,
      ended_at: null,
      origin_community_id: p.originCommunityId ?? null,
    },
  });
  return null;
}

// --- role.create (20) -------------------------------------------------------------

function roleCreate(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PRoleCreate;
  // 13
  const name = checkRoleName(p.name);
  if (!name.ok) return VAL(name.field);
  if (!isRoleColor(p.color)) return VAL('color'); // §6.4.2
  for (const perm of p.permissions) if (!isValidPerm(perm)) return VAL('permissions');
  const perms = new Set(p.permissions);

  // 14
  if (countActive(ctx.draft.state.roles) >= MAX_ROLES) return rj(E.LIMIT_EXCEEDED, undefined, MAX_ROLES);

  // Genese (R-27): seq 1 = Fundador (as 17 permissoes, rank maximo), seq 2 = cargo base.
  const isFounder = ctx.inGenesis && ctx.seq === 1;
  const isDefault = ctx.inGenesis && ctx.seq === 2;

  // R-5 — SEM suspensao (R-27(a)): na genese `ctx.eff` e o conjunto do principal.
  for (const perm of perms) if (!ctx.eff.has(perm)) return rj(E.PERMISSION_ESCALATION);

  // 15 — R-20: `rank` recalculado a partir dos vizinhos no `DS`.
  const rank = isFounder
    ? RANK_TOP
    : isDefault
      ? RANK_BOTTOM
      : rankBetween(activeRoleRanks(ctx), p.afterRank, p.beforeRank);

  // R-4 — SEM suspensao (R-27(a)): na genese `ctx.authorTop` e RANK_GENESIS, e
  // RANK_TOP < RANK_GENESIS, entao o cargo Fundador do `seq` 1 passa.
  if (ctx.authorTop === null || rank >= ctx.authorTop) return rj(E.HIERARCHY);

  const id = newId(ctx, 'role');
  if (ctx.draft.state.roles.has(id)) return rj(E.ID_COLLISION);

  const role: Role = {
    name: name.value,
    color: p.color,
    rank,
    permissions: perms,
    mentionable: p.mentionable,
    isFounder,
    isDefault,
  };
  ctx.draft.roles().set(id, role);
  ctx.effects.push({
    t: 'upsert',
    table: 'roles',
    key: [id],
    row: {
      id,
      name: role.name,
      color: role.color,
      rank,
      permissions: JSON.stringify([...perms].sort((a, b) => a - b)),
      mentionable: role.mentionable ? 1 : 0,
      is_founder: isFounder ? 1 : 0,
      is_default: isDefault ? 1 : 0,
      member_count: 0,
      deleted_at: null,
    },
  });
  if (!ctx.inGenesis) audit(ctx, AUDIT.createRole, id, role.name, null);
  return null;
}

// --- role.update (21) -------------------------------------------------------------

function roleUpdate(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PRoleUpdate;
  // 13
  let newName: string | undefined;
  if (p.name !== undefined) {
    const n = checkRoleName(p.name);
    if (!n.ok) return VAL(n.field);
    newName = n.value;
  }
  if (p.permissions !== undefined) {
    for (const perm of p.permissions) if (!isValidPerm(perm)) return VAL('permissions');
  }

  // 14
  const role = ctx.draft.state.roles.get(p.roleId);
  if (!role || role.deletedAt !== undefined) return rj(E.NOT_FOUND);
  if (role.isFounder) return rj(E.FOUNDER_IMMUTABLE); // §6.4.1
  if (p.permissions !== undefined) {
    const next = new Set(p.permissions);
    // R-11: o cargo base nunca pode conter permissao de gestao, moderacao ou mencao global.
    if (role.isDefault) {
      for (const perm of next) if (BASE_ROLE_FORBIDDEN.has(perm)) return rj(E.BASE_ROLE_RESTRICTED);
    }
    // R-5: ninguem concede permissao que nao possui (avaliado sobre o que e ACRESCENTADO).
    for (const perm of next) if (!role.permissions.has(perm) && !ctx.eff.has(perm)) return rj(E.PERMISSION_ESCALATION);
  }

  // 15
  const r = ctx.draft.mutRole(p.roleId);
  if (!r) return rj(E.NOT_FOUND);
  const fields: Record<string, string | number | null> = {};
  if (newName !== undefined) {
    r.name = newName;
    fields.name = newName;
  }
  if (p.color !== undefined) {
    if (!isRoleColor(p.color)) return VAL('color'); // §6.4.2
    r.color = p.color;
    fields.color = p.color;
  }
  if (p.mentionable !== undefined) {
    r.mentionable = p.mentionable;
    fields.mentionable = p.mentionable ? 1 : 0;
  }
  if (p.permissions !== undefined) {
    const holders: Array<[string, Set<number>]> = [];
    for (const [hex, m] of ctx.draft.state.members) {
      if (m.roleIds.has(p.roleId)) holders.push([hex, effectivePerms(m.roleIds, ctx.draft.state.roles)]);
    }
    r.permissions = new Set(p.permissions);
    fields.permissions = JSON.stringify([...r.permissions].sort((a, b) => a - b));
    // R-10: perder `create_invite` revoga os convites criados pelo membro.
    for (const [hex, before] of holders) applyR10OnRoleChange(ctx, hex, before);
  }
  ctx.effects.push({ t: 'patch', table: 'roles', key: [p.roleId], fields });
  audit(ctx, AUDIT.updateRole, p.roleId, r.name, null);
  return null;
}

// --- role.delete (23) -------------------------------------------------------------

function roleDelete(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PRoleDelete;
  const role = ctx.draft.state.roles.get(p.roleId);
  if (!role || role.deletedAt !== undefined) return rj(E.NOT_FOUND);
  if (role.isFounder) return rj(E.FOUNDER_IMMUTABLE);
  if (role.isDefault) return rj(E.BASE_ROLE_REQUIRED); // R-12

  const base = baseRoleId(ctx);
  const r = ctx.draft.mutRole(p.roleId);
  if (!r) return rj(E.NOT_FOUND);
  r.deletedAt = ctx.hostTs;
  ctx.effects.push({ t: 'patch', table: 'roles', key: [p.roleId], fields: { deleted_at: ctx.hostTs } });

  // §8.4.1: membros mantidos; o id sai de `roleIds`; sem cargo, recebe o base.
  for (const [hex, m] of [...ctx.draft.state.members]) {
    if (!m.roleIds.has(p.roleId)) continue;
    const next = new Set(m.roleIds);
    next.delete(p.roleId);
    if (next.size === 0 && base !== null) next.add(base);
    setMemberRoles(ctx, hex, next);
  }
  // §8.4.1 / fecha F-31: limpa toda referencia pendurada, inclusive readOnlyForRoleIds.
  for (const [id, ch] of [...ctx.draft.state.channels]) {
    if (!ch.readOnlyForRoleIds.has(p.roleId)) continue;
    const c = ctx.draft.mutChannel(id);
    if (!c) continue;
    c.readOnlyForRoleIds.delete(p.roleId);
    ctx.effects.push({
      t: 'patch',
      table: 'channels',
      key: [id],
      fields: { read_only_role_ids: JSON.stringify([...c.readOnlyForRoleIds].sort()) },
    });
  }
  audit(ctx, AUDIT.deleteRole, p.roleId, role.name, null);
  return null;
}

// --- member.join (25) -------------------------------------------------------------

const ZERO32 = Buffer.alloc(32);
const ZERO64 = Buffer.alloc(64);

function memberJoin(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PMemberJoin;
  // 13
  const dn = checkDisplayName(p.displayName);
  if (!dn.ok) return VAL(dn.field);
  if (!isAvatarColor(p.avatarColor)) return VAL('avatarColor'); // §6.4.2

  const existing = ctx.draft.state.members.get(ctx.authorHex);
  // §6.3 (ciclo) e §12.5: banido nao entra. `mod.revokeBan` e o unico caminho de volta.
  if (existing && existing.state === 'banned') return rj(E.BANNED);

  const founderForm = p.invitePublicKey.equals(ZERO32) && p.joinProof.equals(ZERO64);
  let roleIds: Set<string>;

  if (ctx.inGenesis && founderForm) {
    // R-27: R-9 NAO se aplica ao `member.join` do fundador.
    const f = founderRoleId(ctx);
    const b = baseRoleId(ctx);
    if (f === null || b === null) return rj(E.GENESIS_MISPLACED);
    // §19.1: 1 membro (o host, com Fundador). R-3: todo membro ativo tem o cargo base.
    roleIds = new Set([f, b]);
  } else {
    // R-9 — prova de adesao, convite vivo, nao esgotado, par (invitePk, autor) inedito.
    const inv = ctx.draft.state.invites.get(p.invitePublicKey.toString('hex'));
    const digest = blake2b256(
      'invite-join/1',
      ctx.op.communityId,
      p.invitePublicKey,
      ctx.op.author,
    );
    if (!verify(p.joinProof, digest, p.invitePublicKey)) return rj(E.INVITE_INVALID);
    if (!inv) return rj(E.INVITE_INVALID);
    if (inv.revokedAt !== undefined) return rj(E.INVITE_INVALID);
    if (inv.expiresAt !== undefined && inv.expiresAt <= ctx.hostTs) return rj(E.INVITE_INVALID);
    const pair = `${p.invitePublicKey.toString('hex')}:${ctx.authorHex}`;
    if (ctx.draft.state.joinedByInvite.has(pair)) return rj(E.INVITE_INVALID);
    if (inv.maxUses !== undefined && inv.uses >= inv.maxUses) return rj(E.INVITE_EXHAUSTED);

    const b = baseRoleId(ctx);
    if (b === null) return rj(E.NOT_FOUND);
    // §6.3: quem sai e volta recupera o Member com `roleIds` RESETADO ao cargo base.
    roleIds = new Set([b]);

    // Incrementa `uses` NO MESMO PASSO (R-9).
    const pkHex = p.invitePublicKey.toString('hex');
    ctx.draft.invites().set(pkHex, { ...inv, uses: inv.uses + 1 });
    ctx.draft.joinedByInvite().add(pair);
    ctx.effects.push({
      t: 'patch',
      table: 'invites',
      key: [p.invitePublicKey],
      fields: { uses: inv.uses + 1 },
    });
  }

  // 15
  const member: Member = {
    state: 'active',
    roleIds: new Set(),
    displayName: dn.value,
    avatarColor: p.avatarColor,
    blobsCoreKey: p.blobsCoreKey,
    joinedAt: existing?.joinedAt ?? ctx.hostTs,
    storageUsedBytes: existing?.storageUsedBytes ?? 0,
    opBudget: existing?.opBudget ?? emptyRing(),
    byteBudget: existing?.byteBudget ?? emptyRing(),
  };
  ctx.draft.members().set(ctx.authorHex, member);
  ctx.effects.push({
    t: 'upsert',
    table: 'members',
    key: [ctx.op.author],
    row: {
      identity_key: ctx.op.author,
      display_name: member.displayName,
      avatar_color: member.avatarColor,
      nickname: null,
      blobs_core_key: p.blobsCoreKey,
      joined_at: member.joinedAt,
      left_at: null,
      banned: 0,
      timeout_until: null,
      storage_used_bytes: member.storageUsedBytes,
    },
  });
  setMemberRoles(ctx, ctx.authorHex, roleIds);
  ctx.effects.push({ t: 'recount', what: 'memberCount', key: [ctx.draft.state.communityId] });
  return null;
}

// --- member.setRoles (24) ---------------------------------------------------------

function memberSetRoles(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PMemberSetRoles;
  const targetHex = p.targetKey.toString('hex');
  const target = ctx.draft.state.members.get(targetHex);
  if (!target) return rj(E.NOT_FOUND);

  // §8.4.1: ids desconhecidos/deletados sao DESCARTADOS, nao recusam a op inteira.
  const kept = new Set<string>();
  for (const rid of p.roleIds) {
    const r = ctx.draft.state.roles.get(rid);
    if (!r || r.deletedAt !== undefined) continue;
    kept.add(rid);
  }

  const base = baseRoleId(ctx);
  // R-3: todo membro ativo contem o cargo base; REMOVER o base e recusado.
  if (base !== null && target.state === 'active' && target.roleIds.has(base) && !kept.has(base)) {
    return rj(E.BASE_ROLE_REQUIRED);
  }
  if (kept.size === 0 && base !== null) kept.add(base);

  if (kept.size > MAX_ROLES_PER_MEMBER) return rj(E.LIMIT_EXCEEDED, undefined, MAX_ROLES_PER_MEMBER);

  // R-4: nenhum cargo ATRIBUIDO pode ter `rank ≥ topRank(autor)`.
  for (const rid of kept) {
    if (target.roleIds.has(rid)) continue; // ja possuia
    const r = ctx.draft.state.roles.get(rid);
    if (!r) continue;
    if (ctx.authorTop === null || r.rank >= ctx.authorTop) return rj(E.HIERARCHY);
  }

  setMemberRoles(ctx, targetHex, kept);
  return null;
}

// --- category.create (14) ---------------------------------------------------------

function categoryCreate(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PCategoryCreate;
  const name = checkCategoryName(p.name);
  if (!name.ok) return VAL(name.field);
  if (countActive(ctx.draft.state.categories) >= MAX_CATEGORIES) {
    return rj(E.LIMIT_EXCEEDED, undefined, MAX_CATEGORIES);
  }
  const ranks: string[] = [];
  for (const c of ctx.draft.state.categories.values()) if (c.deletedAt === undefined) ranks.push(c.rank);
  let rank = rankBetween(ranks, p.afterRank, p.beforeRank);
  if (needsRenormalization(rank)) {
    const scope: Array<{ id: string; rank: string }> = [];
    for (const [cid, c] of ctx.draft.state.categories) {
      if (c.deletedAt === undefined) scope.push({ id: cid, rank: c.rank });
    }
    const fresh = renormalizeScope(ctx, 'categories', scope, rank);
    if (fresh === null) return rj(E.LIMIT_EXCEEDED, undefined, MAX_CATEGORIES);
    rank = fresh;
  }
  const id = newId(ctx, 'category');
  if (ctx.draft.state.categories.has(id)) return rj(E.ID_COLLISION);
  ctx.draft.categories().set(id, { name: name.value, rank });
  ctx.effects.push({
    t: 'upsert',
    table: 'categories',
    key: [id],
    row: { id, name: name.value, rank, deleted_at: null },
  });
  if (!ctx.inGenesis) audit(ctx, AUDIT.createCategory, id, name.value, null);
  return null;
}

// --- category.delete (16) ---------------------------------------------------------

function categoryDelete(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PCategoryDelete;
  // R-25: carrega EXATAMENTE UM de `moveChannelsTo` / `deleteChannels`.
  const hasMove = p.moveChannelsTo !== undefined;
  if (hasMove === p.deleteChannels) return VAL('moveChannelsTo');

  const cat = ctx.draft.state.categories.get(p.categoryId);
  if (!cat || cat.deletedAt !== undefined) return rj(E.CATEGORY_NOT_FOUND);

  let dest: string | null = null;
  if (hasMove) {
    dest = p.moveChannelsTo as string;
    if (dest === p.categoryId) return VAL('moveChannelsTo');
    const d = ctx.draft.state.categories.get(dest);
    if (!d || d.deletedAt !== undefined) return rj(E.CATEGORY_NOT_FOUND);
  }

  const inCat: string[] = [];
  for (const [id, ch] of ctx.draft.state.channels) {
    if (ch.deletedAt === undefined && ch.categoryId === p.categoryId) inCat.push(id);
  }

  if (p.deleteChannels) {
    // R-7: a comunidade nunca fica sem canal de texto nao deletado.
    if (textChannelsLeftAfter(ctx, new Set(inCat)) === 0) return rj(E.LAST_CHANNEL);
  }

  const c = ctx.draft.mutCategory(p.categoryId);
  if (!c) return rj(E.CATEGORY_NOT_FOUND);
  c.deletedAt = ctx.hostTs;
  ctx.effects.push({
    t: 'patch',
    table: 'categories',
    key: [p.categoryId],
    fields: { deleted_at: ctx.hostTs },
  });

  if (p.deleteChannels) {
    for (const id of inCat) tombstoneChannel(ctx, id, ctx.hostTs);
  } else if (dest !== null) {
    const destRanks: string[] = [];
    for (const ch of ctx.draft.state.channels.values()) {
      if (ch.deletedAt === undefined && ch.categoryId === dest) destRanks.push(ch.rank);
    }
    for (const id of inCat) {
      const ch = ctx.draft.mutChannel(id);
      if (!ch) continue;
      ch.categoryId = dest;
      const rank = rankBetween(destRanks, undefined, undefined);
      destRanks.push(rank);
      ch.rank = rank;
      ctx.effects.push({
        t: 'patch',
        table: 'channels',
        key: [id],
        fields: { category_id: dest, rank },
      });
    }
  }
  audit(ctx, AUDIT.deleteCategory, p.categoryId, cat.name, null);
  return null;
}

// --- channel.create (10) ----------------------------------------------------------

function channelCreate(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PChannelCreate;
  // 13
  if (!isValidChannelType(p.type)) return VAL('type');
  const nm = checkChannelName(p.name, p.type);
  if (!nm.ok) return nm.empty ? rj(E.CHANNEL_NAME_EMPTY) : VAL('name');
  if (p.topic !== undefined && p.type !== CHANNEL_TYPE.text) return VAL('topic'); // §8.6: so em texto
  const tp = checkChannelTopic(p.topic);
  if (!tp.ok) return VAL(tp.field);

  // 14
  const cat = ctx.draft.state.categories.get(p.categoryId);
  if (!cat || cat.deletedAt !== undefined) return rj(E.CATEGORY_NOT_FOUND);
  if (countActive(ctx.draft.state.channels) >= MAX_CHANNELS) {
    return rj(E.LIMIT_EXCEEDED, undefined, MAX_CHANNELS);
  }
  // R-6: `(type, name)` unico entre nao deletados.
  if (ctx.draft.state.channelNameIndex.has(nameKey(p.type, nm.value))) return rj(E.CHANNEL_NAME_TAKEN);
  // R-21: todos os ids existem e >= 1 cargo nao deletado fica de fora.
  const ro = checkReadOnly(ctx, p.readOnlyForRoleIds);
  if (ro === null) return VAL('readOnlyForRoleIds');

  // 15
  const ranks: string[] = [];
  for (const ch of ctx.draft.state.channels.values()) {
    if (ch.deletedAt === undefined && ch.categoryId === p.categoryId) ranks.push(ch.rank);
  }
  let rank = rankBetween(ranks, p.afterRank, p.beforeRank);
  if (needsRenormalization(rank)) {
    const scope: Array<{ id: string; rank: string }> = [];
    for (const [cid, ch] of ctx.draft.state.channels) {
      if (ch.deletedAt === undefined && ch.categoryId === p.categoryId) scope.push({ id: cid, rank: ch.rank });
    }
    const fresh = renormalizeScope(ctx, 'channels', scope, rank);
    if (fresh === null) return rj(E.LIMIT_EXCEEDED, undefined, MAX_CHANNELS);
    rank = fresh;
  }
  const id = newId(ctx, 'channel');
  if (ctx.draft.state.channels.has(id)) return rj(E.ID_COLLISION);
  const channel: Channel = {
    categoryId: p.categoryId,
    type: p.type,
    name: nm.value,
    topic: p.topic === undefined ? undefined : tp.value,
    rank,
    readOnlyForRoleIds: ro,
  };
  ctx.draft.channels().set(id, channel);
  ctx.draft.channelNameIndex().set(nameKey(p.type, nm.value), id);
  ctx.effects.push({
    t: 'upsert',
    table: 'channels',
    key: [id],
    row: {
      id,
      category_id: p.categoryId,
      type: p.type,
      name: nm.value,
      topic: p.topic === undefined ? null : tp.value,
      rank,
      read_only_role_ids: JSON.stringify([...ro].sort()),
      deleted_at: null,
    },
  });
  if (!ctx.inGenesis) audit(ctx, AUDIT.createChannel, id, nm.value, null);
  return null;
}

/** R-21 — devolve o conjunto validado, ou `null` quando a regra falha. */
function checkReadOnly(ctx: KindCtx, ids: readonly string[]): Set<string> | null {
  const set = new Set<string>();
  for (const rid of ids) {
    const r = ctx.draft.state.roles.get(rid);
    if (!r || r.deletedAt !== undefined) return null; // "todos os ids precisam existir"
    set.add(rid);
  }
  let outside = 0;
  for (const [rid, r] of ctx.draft.state.roles) {
    if (r.deletedAt !== undefined) continue;
    if (!set.has(rid)) outside++;
  }
  if (outside < 1) return null; // "precisa deixar >= 1 cargo nao deletado de fora"
  return set;
}

// --- channel.update (11) ----------------------------------------------------------

function channelUpdate(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PChannelUpdate;
  const ch = ctx.draft.state.channels.get(p.channelId);
  if (!ch || ch.deletedAt !== undefined) return rj(E.CHANNEL_NOT_FOUND);

  let newName: string | undefined;
  if (p.name !== undefined) {
    const nm = checkChannelName(p.name, ch.type);
    if (!nm.ok) return nm.empty ? rj(E.CHANNEL_NAME_EMPTY) : VAL('name');
    newName = nm.value;
  }
  if (p.topic !== undefined && ch.type !== CHANNEL_TYPE.text) return VAL('topic');
  const tp = checkChannelTopic(p.topic);
  if (!tp.ok) return VAL(tp.field);

  if (newName !== undefined && newName !== ch.name) {
    // R-6
    if (ctx.draft.state.channelNameIndex.has(nameKey(ch.type, newName))) return rj(E.CHANNEL_NAME_TAKEN);
  }
  let ro: Set<string> | undefined;
  if (p.readOnlyForRoleIds !== undefined) {
    const r = checkReadOnly(ctx, p.readOnlyForRoleIds);
    if (r === null) return VAL('readOnlyForRoleIds');
    ro = r;
  }

  const c = ctx.draft.mutChannel(p.channelId);
  if (!c) return rj(E.CHANNEL_NOT_FOUND);
  const fields: Record<string, string | number | null> = {};
  if (newName !== undefined && newName !== c.name) {
    ctx.draft.channelNameIndex().delete(nameKey(c.type, c.name));
    c.name = newName;
    ctx.draft.channelNameIndex().set(nameKey(c.type, newName), p.channelId);
    fields.name = newName;
  }
  if (p.topic !== undefined) {
    c.topic = tp.value;
    fields.topic = tp.value;
  }
  if (ro !== undefined) {
    c.readOnlyForRoleIds = ro;
    fields.read_only_role_ids = JSON.stringify([...ro].sort());
  }
  ctx.effects.push({ t: 'patch', table: 'channels', key: [p.channelId], fields });
  audit(ctx, AUDIT.updateChannel, p.channelId, c.name, null);
  return null;
}

// --- channel.delete (13) ----------------------------------------------------------

function channelDelete(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PChannelDelete;
  const ch = ctx.draft.state.channels.get(p.channelId);
  if (!ch || ch.deletedAt !== undefined) return rj(E.CHANNEL_NOT_FOUND);
  // R-7
  if (ch.type === CHANNEL_TYPE.text && textChannelsLeftAfter(ctx, new Set([p.channelId])) === 0) {
    return rj(E.LAST_CHANNEL);
  }
  const name = ch.name;
  tombstoneChannel(ctx, p.channelId, ctx.hostTs);
  audit(ctx, AUDIT.deleteChannel, p.channelId, name, null);
  return null;
}

// --- message.send (1) -------------------------------------------------------------

function messageSend(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PMessageSend;
  // 13
  const content = checkMessageContent(p.content);
  if (!content.ok) return VAL(content.field);
  const mentions = [...new Set(p.mentions)]; // §8.6: ids duplicados colapsam
  if (mentions.length > MAX_MENTIONS) return VAL('mentions');
  if (p.attachment !== undefined) {
    const a = p.attachment;
    if (a.sizeBytes < 1 || a.sizeBytes > ATTACHMENT_MAX_BYTES) return rj(E.ATTACHMENT_TOO_LARGE);
    const nameCheck = checkAttachmentName(a.name);
    if (!nameCheck) return VAL('name');
  }

  // 14
  const ch = ctx.draft.state.channels.get(p.channelId);
  if (!ch || ch.deletedAt !== undefined) return rj(E.CHANNEL_NOT_FOUND);
  if (ch.type !== CHANNEL_TYPE.text) return rj(E.CHANNEL_NOT_FOUND); // §6.7: canal de TEXTO

  // R-22: recusa quando TODOS os cargos do autor estao em `readOnlyForRoleIds`.
  if (ch.readOnlyForRoleIds.size > 0 && ctx.member) {
    let anyOutside = false;
    for (const rid of ctx.member.roleIds) {
      const r = ctx.draft.state.roles.get(rid);
      if (!r || r.deletedAt !== undefined) continue;
      if (!ch.readOnlyForRoleIds.has(rid)) {
        anyOutside = true;
        break;
      }
    }
    if (!anyOutside) return rj(E.CHANNEL_READ_ONLY);
  }

  // R-8: `replyToId`/`threadId` existem, nao deletados, do MESMO canal.
  if (p.replyToId !== undefined) {
    const m = ctx.draft.state.messages.get(p.replyToId);
    if (!m || m.deletedAt !== undefined || m.channelId !== p.channelId) return VAL('replyToId');
  }
  if (p.threadId !== undefined) {
    const root = ctx.draft.state.threadsByRoot.get(p.threadId);
    const m = root !== undefined ? ctx.draft.state.messages.get(root) : undefined;
    if (!m || m.deletedAt !== undefined || m.channelId !== p.channelId) return VAL('threadId');
  }

  // R-14 (cota de anexo) ja foi decidida no ESTAGIO 10, em `fold/index.ts` — §8.2 a coloca
  // ali, antes de permissao, hierarquia e limites de campo. Aqui so se acumula o consumo.
  const attachBytes = p.attachment !== undefined && ctx.member ? p.attachment.sizeBytes : 0;

  // 15
  const id = newId(ctx, 'message');
  if (ctx.draft.state.messages.has(id)) return rj(E.ID_COLLISION);
  // R-13: `everyone` so vira efetivo com `mention_everyone` NO MOMENTO DO REGISTRO.
  const mentionEveryone = mentions.includes('everyone') && ctx.eff.has(PERM.mention_everyone);
  // §6.7: `clockSkewed` = |authorTs − hostTs| > CLOCK_SKEW_MS
  const clockSkewed = Math.abs(ctx.op.ts - ctx.hostTs) > CLOCK_SKEW_MS;

  ctx.draft.messages().set(id, {
    channelId: p.channelId,
    authorKey: ctx.authorHex,
    pinned: false,
    threadId: p.threadId,
    hasAttachment: p.attachment !== undefined,
    attachmentBytes: attachBytes,
    reactionEmojis: new Set(),
    hiddenByBan: false,
    orphaned: false,
  });
  if (attachBytes > 0) {
    const m = ctx.draft.mutMember(ctx.authorHex);
    if (m) m.storageUsedBytes += attachBytes;
  }
  ctx.effects.push({
    t: 'upsert',
    table: 'messages',
    key: [id],
    row: {
      id,
      seq: ctx.seq,
      channel_id: p.channelId,
      author_key: ctx.op.author,
      content: content.value,
      author_ts: ctx.op.ts,
      host_ts: ctx.hostTs,
      clock_skewed: clockSkewed ? 1 : 0,
      edited_at: null,
      pinned: 0,
      reply_to_id: p.replyToId ?? null,
      thread_id: p.threadId ?? null,
      mentions: JSON.stringify(mentions),
      mention_everyone_effective: mentionEveryone ? 1 : 0,
      deleted_at: null,
      hidden_by_ban: 0,
      orphaned: 0,
    },
  });
  ctx.effects.push({ t: 'ftsIndex', messageId: id, content: content.value });
  ctx.effects.push({ t: 'notify', topic: 'messages.appended', data: { id, channelId: p.channelId } });
  return null;
}

/** §8.6 — nome de anexo: REJEITAR, nao sanitizar. */
const RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
function checkAttachmentName(name: string): boolean {
  const bytes = utf8Bytes(name);
  if (bytes < LIMIT.attachmentName.minBytes || bytes > LIMIT.attachmentName.maxBytes) return false;
  if (/[/\\\0]/.test(name)) return false;
  for (const c of name) if (c.codePointAt(0)! < 0x20 || c.codePointAt(0) === 0x7f) return false;
  if (RESERVED_NAME.test(name)) return false;
  if (name.endsWith('.') || name.endsWith(' ')) return false;
  return true;
}

// --- message.delete (3) -----------------------------------------------------------

function messageDelete(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PMessageDelete;
  const reason = checkModerationReason(p.reason);
  if (!reason.ok) return VAL(reason.field);

  const msg = ctx.draft.state.messages.get(p.messageId);
  if (!msg) return rj(E.NOT_FOUND);
  // §8.4.1: ja deletada => APPLIED idempotente, sem efeito e sem auditoria.
  if (msg.deletedAt !== undefined) {
    ctx.draft.touch();
    return null;
  }

  const isOther = msg.authorKey !== ctx.authorHex;
  const m = ctx.draft.mutMessage(p.messageId);
  if (!m) return rj(E.NOT_FOUND);
  m.deletedAt = ctx.hostTs;
  ctx.effects.push({
    t: 'patch',
    table: 'messages',
    key: [p.messageId],
    // §10.3: `content` e NULL quando tombstonada (fecha DR-17).
    fields: { content: null, deleted_at: ctx.hostTs },
  });
  ctx.effects.push({ t: 'ftsRemove', messageId: p.messageId });
  // §6.9: mensagem deletada => reacoes somem na mesma transacao, sem estado zumbi.
  ctx.effects.push({ t: 'delete', table: 'reactions', key: [p.messageId] });
  m.reactionEmojis = new Set();
  if (isOther) audit(ctx, AUDIT.deleteMessage, p.messageId, labelOf(ctx, msg.authorKey), reason.value || null);
  return null;
}

// --- reaction.set (5) -------------------------------------------------------------

function reactionSet(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PReactionSet;
  const emoji = checkReactionEmoji(p.emoji);
  if (!emoji.ok) return VAL(emoji.field);

  const msg = ctx.draft.state.messages.get(p.messageId);
  if (!msg) return rj(E.NOT_FOUND);
  if (msg.deletedAt !== undefined) return rj(E.MESSAGE_DELETED); // §8.4.1

  if (p.present) {
    // R-23: max 20 emojis distintos por mensagem; `present:false` NUNCA e recusada.
    if (!msg.reactionEmojis.has(emoji.value) && msg.reactionEmojis.size >= MAX_REACTION_EMOJIS) {
      return rj(E.REACTION_LIMIT);
    }
    const m = ctx.draft.mutMessage(p.messageId);
    if (!m) return rj(E.NOT_FOUND);
    m.reactionEmojis.add(emoji.value);
    ctx.effects.push({
      t: 'upsert',
      table: 'reactions',
      key: [p.messageId, emoji.value, ctx.op.author],
      row: {
        message_id: p.messageId,
        emoji: emoji.value,
        identity_key: ctx.op.author,
        at: ctx.hostTs,
      },
    });
  } else {
    ctx.effects.push({
      t: 'delete',
      table: 'reactions',
      key: [p.messageId, emoji.value, ctx.op.author],
    });
    ctx.draft.touch();
  }
  return null;
}

// --- mod.ban (31) -----------------------------------------------------------------

function modBan(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PModBan;
  const reason = checkModerationReason(p.reason);
  if (!reason.ok) return VAL(reason.field);

  const targetHex = p.targetKey.toString('hex');
  const target = ctx.draft.state.members.get(targetHex);
  if (!target) return rj(E.NOT_FOUND);
  // §8.4.1: ja banido => APPLIED idempotente, sem segunda entrada de auditoria.
  if (target.state === 'banned') {
    ctx.draft.touch();
    return null;
  }

  const label = labelOf(ctx, targetHex);
  const t = ctx.draft.mutMember(targetHex);
  if (!t) return rj(E.NOT_FOUND);
  t.state = 'banned';
  t.bannedAt = ctx.hostTs;
  t.bannedBy = ctx.op.author;
  ctx.effects.push({
    t: 'patch',
    table: 'members',
    key: [p.targetKey],
    fields: { banned: 1 },
  });
  ctx.effects.push({
    t: 'upsert',
    table: 'bans',
    key: [p.targetKey],
    row: {
      target_key: p.targetKey,
      by_key: ctx.op.author,
      at: ctx.hostTs,
      reason: reason.value || null,
      revoked_at: null,
    },
  });
  // §6.12 / §18.2: ocultacao REVERSIVEL das mensagens do alvo, na mesma transacao.
  // §8.4 `patchScope` (fecha HOLE-12): DOIS efeitos no lugar de 2N. O `DS` continua sendo
  // atualizado mensagem a mensagem — ele e a fonte da decisao —, mas o delta que viaja
  // ate `view.db` deixa de ser uma lista de N linhas.
  let hidAny = false;
  for (const [id, msg] of ctx.draft.state.messages) {
    if (msg.authorKey !== targetHex || msg.hiddenByBan) continue;
    const m = ctx.draft.mutMessage(id);
    if (!m) continue;
    m.hiddenByBan = true;
    hidAny = true;
  }
  if (hidAny) {
    const scope = { s: 'messagesOfAuthor', authorKey: p.targetKey } as const;
    ctx.effects.push({ t: 'patchScope', scope, fields: { hidden_by_ban: 1 } });
    ctx.effects.push({ t: 'ftsRemoveScope', scope });
  }
  revokeInvitesOf(ctx, targetHex); // R-10
  ctx.effects.push({ t: 'recount', what: 'memberCount', key: [ctx.draft.state.communityId] });
  audit(ctx, AUDIT.ban, targetHex, label, reason.value || null);
  return null;
}

// --- invite.create (50) — SCOPE-DELTA-01 ------------------------------------------

function inviteCreate(ctx: KindCtx): Rejection | null {
  const p = ctx.payload as PInviteCreate;
  // 13 — §8.6
  if (p.maxUses !== undefined) {
    if (p.maxUses < LIMIT.inviteMaxUses.min || p.maxUses > LIMIT.inviteMaxUses.max) return VAL('maxUses');
  }
  if (p.expiresAt !== undefined) {
    if (p.expiresAt < ctx.hostTs + LIMIT.inviteExpiryMinMs) return VAL('expiresAt');
    if (p.expiresAt > ctx.hostTs + LIMIT.inviteExpiryMaxMs) return VAL('expiresAt');
  }
  if (p.label !== undefined && codePointsAtMost(p.label.trim(), LIMIT.inviteLabelCodePoints.max) > LIMIT.inviteLabelCodePoints.max)
    return VAL('label');

  // 14
  let active = 0;
  for (const i of ctx.draft.state.invites.values()) {
    if (i.revokedAt === undefined && (i.expiresAt === undefined || i.expiresAt > ctx.hostTs)) active++;
  }
  if (active >= MAX_ACTIVE_INVITES) return rj(E.LIMIT_EXCEEDED, undefined, MAX_ACTIVE_INVITES);
  const pkHex = p.invitePublicKey.toString('hex');
  if (ctx.draft.state.invites.has(pkHex)) return VAL('invitePublicKey');

  // 15
  ctx.draft.invites().set(pkHex, {
    createdBy: ctx.op.author,
    createdAt: ctx.hostTs,
    expiresAt: p.expiresAt,
    maxUses: p.maxUses,
    uses: 0,
  });
  ctx.effects.push({
    t: 'upsert',
    table: 'invites',
    key: [p.invitePublicKey],
    row: {
      invite_public_key: p.invitePublicKey,
      created_by: ctx.op.author,
      created_at: ctx.hostTs,
      expires_at: p.expiresAt ?? null,
      max_uses: p.maxUses ?? null,
      uses: 0,
      revoked_at: null,
      label: p.label ?? null,
    },
  });
  return null;
}
