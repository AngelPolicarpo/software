/**
 * Permissoes — backend-v2.md §9.1 (catalogo fechado, 17), §9.2 (permissao efetiva),
 * §9.3 (hierarquia), §9.4 (matriz de enforcement por `kind`).
 *
 * ATENCAO — BURACO DE SPEC HOLE-06 (ver REPORT.md): o payload de `role.create`/
 * `role.update` e `arr<u8>` (§7.4.3), mas a spec NAO define o valor numerico de cada
 * permissao. O numero e material assinado e, portanto, normativo. A numeracao abaixo e
 * a ordem de leitura da tabela de §9.1 e esta declarada como ASSUMPTION-06; ela precisa
 * ser fixada na spec antes da fase 1.
 */
import { K } from './kinds.ts';

export const PERM = {
  manage_community: 0,
  manage_channels: 1,
  view_audit_log: 2,
  send_messages: 3,
  attach_files: 4,
  add_reactions: 5,
  mention_everyone: 6,
  pin_messages: 7,
  manage_messages: 8,
  voice_speak: 9,
  voice_mute_others: 10,
  voice_share_screen: 11,
  create_invite: 12,
  kick_members: 13,
  ban_members: 14,
  timeout_members: 15,
  manage_roles: 16,
} as const;

export type PermName = keyof typeof PERM;
export type PermBit = (typeof PERM)[PermName];

export const PERM_NAMES = Object.keys(PERM) as PermName[];
export const ALL_PERMS: readonly PermBit[] = Object.values(PERM);
export const PERM_COUNT = ALL_PERMS.length; // 17, fechado

export const PERM_NAME_OF = new Map<number, PermName>(
  PERM_NAMES.map((n) => [PERM[n] as number, n]),
);

export function isValidPerm(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < PERM_COUNT;
}

/**
 * §8.3 R-11 — permissoes proibidas no cargo base (`isDefault`).
 * Lista literal da regra: manage_community, manage_channels, manage_roles,
 * manage_messages, ban_members, kick_members, timeout_members, mention_everyone,
 * view_audit_log, voice_mute_others, create_invite.
 */
export const BASE_ROLE_FORBIDDEN: ReadonlySet<number> = new Set<number>([
  PERM.manage_community,
  PERM.manage_channels,
  PERM.manage_roles,
  PERM.manage_messages,
  PERM.ban_members,
  PERM.kick_members,
  PERM.timeout_members,
  PERM.mention_everyone,
  PERM.view_audit_log,
  PERM.voice_mute_others,
  PERM.create_invite,
]);

/**
 * §19.1 — o cargo base nasce com send_messages, attach_files, add_reactions,
 * voice_speak (e "nunca pode receber mais que isso alem de pin_messages", R-11).
 */
export const BASE_ROLE_INITIAL_PERMS: readonly number[] = [
  PERM.send_messages,
  PERM.attach_files,
  PERM.add_reactions,
  PERM.voice_speak,
];

/**
 * R-27(b) — permissoes que o cargo base pode carregar NO `seq` 2 DA GENESE.
 *
 * §19.1: o cargo base recebe send_messages, attach_files, add_reactions, voice_speak "e
 * nunca pode receber mais que isso alem de pin_messages (R-11)". A lista e ESTRITAMENTE
 * menor que o complemento de `BASE_ROLE_FORBIDDEN` (que ainda admite voice_share_screen):
 * na genese vale a forma de §19.1; depois, `role.update` vale por R-11.
 */
export const GENESIS_BASE_ROLE_ALLOWED: ReadonlySet<number> = new Set<number>([
  PERM.send_messages,
  PERM.attach_files,
  PERM.add_reactions,
  PERM.voice_speak,
  PERM.pin_messages,
]);

/**
 * §9.4 — matriz de enforcement por `kind`, lida declarativamente pelo `fold`.
 * `perm: null` = sem permissao exigida (a autorizacao vem de outra regra).
 * `hier` = exige hierarquia estrita sobre o alvo (§9.3).
 * Um `kind` sem linha falha fechado com `E_UNKNOWN_KIND` (§9.4).
 */
export type KindPolicy = {
  perm: PermBit | null;
  /** perm exigida so quando a op carrega anexo (`message.send`, §7.4.1). */
  permWithAttachment?: PermBit;
  /** a permissao so e exigida quando o alvo nao e do proprio autor. */
  permWhenOther?: PermBit;
  hier: boolean;
  aud: boolean;
};

export const KIND_POLICY = new Map<number, KindPolicy>([
  [K.MESSAGE_SEND, { perm: PERM.send_messages, permWithAttachment: PERM.attach_files, hier: false, aud: false }],
  [K.MESSAGE_DELETE, { perm: null, permWhenOther: PERM.manage_messages, hier: true, aud: true }],
  [K.REACTION_SET, { perm: PERM.add_reactions, hier: false, aud: false }],
  [K.CHANNEL_CREATE, { perm: PERM.manage_channels, hier: false, aud: true }],
  [K.CHANNEL_UPDATE, { perm: PERM.manage_channels, hier: false, aud: true }],
  [K.CHANNEL_DELETE, { perm: PERM.manage_channels, hier: false, aud: true }],
  [K.CATEGORY_CREATE, { perm: PERM.manage_channels, hier: false, aud: true }],
  [K.CATEGORY_DELETE, { perm: PERM.manage_channels, hier: false, aud: true }],
  [K.ROLE_CREATE, { perm: PERM.manage_roles, hier: false, aud: true }],
  [K.ROLE_UPDATE, { perm: PERM.manage_roles, hier: true, aud: true }],
  [K.ROLE_DELETE, { perm: PERM.manage_roles, hier: true, aud: true }],
  [K.MEMBER_SET_ROLES, { perm: PERM.manage_roles, hier: true, aud: false }],
  [K.MEMBER_JOIN, { perm: null, hier: false, aud: false }],
  [K.MOD_BAN, { perm: PERM.ban_members, hier: true, aud: true }],
  [K.COMMUNITY_CREATE, { perm: null, hier: false, aud: false }],
  // SCOPE-DELTA-01 (ver REPORT.md): `invite.create` esta fora dos 15 `kind`s pedidos,
  // mas POC-01 exige "dez clientes" e R-9 e o unico caminho normativo de associacao.
  [K.INVITE_CREATE, { perm: PERM.create_invite, hier: false, aud: false }],
]);

/** §9.2 — permissao efetiva = uniao das permissoes de todos os cargos ativos. */
export function effectivePerms(
  roleIds: Iterable<string>,
  roles: Map<string, { permissions: Set<number>; deletedAt?: number }>,
): Set<number> {
  const out = new Set<number>();
  for (const rid of roleIds) {
    const r = roles.get(rid);
    if (!r || r.deletedAt !== undefined) continue;
    for (const p of r.permissions) out.add(p);
  }
  return out;
}

export function hasPerm(eff: Set<number>, p: PermBit | number): boolean {
  return eff.has(p);
}

/**
 * §9.3 — `topRank(membro)` = maior `rank` entre os cargos ativos, na ordenacao
 * lexicografica de §6.4.1. Retorna `null` quando o membro nao tem cargo ativo.
 */
export function topRank(
  roleIds: Iterable<string>,
  roles: Map<string, { rank: string; deletedAt?: number }>,
): string | null {
  let top: string | null = null;
  for (const rid of roleIds) {
    const r = roles.get(rid);
    if (!r || r.deletedAt !== undefined) continue;
    if (top === null || r.rank > top) top = r.rank;
  }
  return top;
}

/**
 * §9.3 regra unica: o autor so age sobre alvo cujo `topRank` seja ESTRITAMENTE menor
 * que o seu. Nunca igual, nunca maior. Um autor sem cargo ativo nao age sobre ninguem.
 */
export function outranks(authorTop: string | null, targetTop: string | null): boolean {
  if (authorTop === null) return false;
  if (targetTop === null) return true;
  return authorTop > targetTop;
}
