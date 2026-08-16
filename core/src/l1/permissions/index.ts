// `permissions` — L1, permissão efetiva e hierarquia (§9.1 a §9.3).
//
// §4: função pura sobre `DecisionState`, não depende de nenhum módulo e **não pode ler
// banco**. Por não depender de `errors`, as recusas saem como o **literal** do código de
// §20.2; quem monta o `AppError` é o `fold`, que depende dos dois. O tipo garante que um
// literal inventado não compile lá.

/**
 * §9.1 — catálogo fechado, 17 permissões. O número é **constante de protocolo** (§27.1):
 * é ele que viaja em `arr<u8> permissions` dentro de material assinado, então a numeração é
 * a ordem desta tabela, é fixa, e nenhum número é reaproveitado. Dois clientes com
 * numerações diferentes concederiam permissões diferentes lendo o mesmo log.
 */
export const PERMISSIONS = {
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

export type Permission = keyof typeof PERMISSIONS;
export type PermissionNumber = (typeof PERMISSIONS)[Permission];

/** Índice reverso, na ordem da tabela de §9.1. */
export const PERMISSION_BY_NUMBER: readonly Permission[] = Object.keys(PERMISSIONS) as Permission[];

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_BY_NUMBER;

/** §9.1: um `u8` fora de `0..16` é `E_VALIDATION.permissions`, nunca ignorado em silêncio. */
export function permissionFromNumber(n: number): Permission | null {
  return Number.isInteger(n) && n >= 0 && n < PERMISSION_BY_NUMBER.length
    ? (PERMISSION_BY_NUMBER[n] as Permission)
    : null;
}

export function permissionNumber(p: Permission): PermissionNumber {
  return PERMISSIONS[p];
}

// ─── Cargos ────────────────────────────────────────────────────────────────────────────

/** O recorte de §6.4 que a autorização precisa. Nada além disto é lido aqui. */
export type RoleView = {
  readonly id: string;
  /** Chave fracionária base62 de §6.4.1. */
  readonly rank: string;
  readonly permissions: readonly Permission[];
  readonly isFounder: boolean;
  readonly isDefault: boolean;
};

export type RoleLookup = (roleId: string) => RoleView | undefined;

/**
 * §9.2 — `efetiva(membro) = união das permissões de todos os cargos ativos`. Sem negação,
 * sem override por canal, sem herança. Um `roleId` que não resolve é ignorado: `role.delete`
 * limpa as referências penduradas (§6.4.1, `F-31`), e uma referência sobrevivente não pode
 * conceder nada.
 */
export function effectivePermissions(
  roleIds: readonly string[],
  roles: RoleLookup,
): ReadonlySet<Permission> {
  const out = new Set<Permission>();
  for (const id of roleIds) {
    const role = roles(id);
    if (role === undefined) continue;
    for (const p of role.permissions) out.add(p);
  }
  return out;
}

export function hasPermission(
  roleIds: readonly string[],
  roles: RoleLookup,
  p: Permission,
): boolean {
  for (const id of roleIds) {
    if (roles(id)?.permissions.includes(p) === true) return true;
  }
  return false;
}

// ─── Rank e hierarquia ─────────────────────────────────────────────────────────────────

/** §7.2.1 e §27.1 — o alfabeto e o teto de comprimento do tipo `rank`. */
export const RANK_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const RANK_MAX_LEN = 64;

/** §27.1 / §6.4.1 — `rank` do cargo Fundador, atribuído no `seq` 1 da gênese (R-27b). */
export const RANK_TOP = 'zz';

/** §27.1 / §6.4.1 — `rank` do cargo base, atribuído no `seq` 2 (R-27b). Não é `'0'`. */
export const RANK_BOTTOM = '1';

/**
 * §27.1 / R-27(a) — `topRank` do principal de gênese, válido só nos `seq` 0..5 e **nunca
 * gravado** como `rank` de cargo.
 *
 * São 65 caracteres contra o teto de 64 de `RANK_MAX_LEN`: isso o torna simultaneamente
 * maior que qualquer `rank` válido na ordem lexicográfica **e** impossível de ser um `rank`
 * válido — não há como gravá-lo em cargo por acidente. `isValidRank` recusa-o.
 */
export const RANK_GENESIS = 'z'.repeat(65);

export type Rank = string;

/** §7.2.1 — base62, 1..64 caracteres, nunca terminando em `0`. */
export function isValidRank(s: string): boolean {
  if (s.length < 1 || s.length > RANK_MAX_LEN) return false;
  for (const c of s) if (!RANK_DIGITS.includes(c)) return false;
  return !s.endsWith('0');
}

/**
 * §6.4.1 — `rank` é base62 (`0-9A-Za-z`) ordenada lexicograficamente. A ordem ASCII de
 * `0-9` (48–57) < `A-Z` (65–90) < `a-z` (97–122) coincide com a ordem base62, então a
 * comparação nativa de strings **já é** a ordenação normativa — inclusive para
 * `RANK_GENESIS`, que é maior que tudo por construção.
 */
export function compareRank(a: Rank, b: Rank): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** §9.3 — maior `rank` entre os cargos ativos. `null` quando não há cargo que resolva. */
export function topRank(roleIds: readonly string[], roles: RoleLookup): string | null {
  let top: string | null = null;
  for (const id of roleIds) {
    const role = roles(id);
    if (role === undefined) continue;
    if (top === null || role.rank > top) top = role.rank;
  }
  return top;
}

/** Os códigos de §20.2 que a ordem de §9.3 pode produzir. */
export type AuthorityDenial =
  | 'E_FOUNDER_IMMUTABLE'
  | 'E_FOUNDER_TOP'
  | 'E_FOUNDER_IMMUNE'
  | 'E_HOST_IMMUNE'
  | 'E_SELF_TARGET'
  | 'E_HIERARCHY';

/**
 * Os fatos que §9.3 exige, já resolvidos contra o `DS` por quem chama. Manter isto como
 * dados — em vez de o módulo navegar o `DS` — é o que o mantém puro e testável (§4).
 */
export type AuthorityContext = {
  readonly authorTopRank: Rank | null;
  readonly targetTopRank: Rank | null;
  /** Passo 1: o alvo **é** o cargo Fundador. */
  readonly targetIsFounderRole?: boolean;
  /** Passo 1: `role.move` que levaria um cargo a `rank ≥` o do Fundador. */
  readonly moveReachesFounderRank?: boolean;
  /** Passo 2: o alvo é o Fundador original. */
  readonly targetIsOriginalFounder?: boolean;
  /** Passo 2: o alvo é o host corrente. */
  readonly targetIsCurrentHost?: boolean;
  /** Passo 2: `mod.*` do autor sobre si mesmo (R-16). */
  readonly targetIsSelf?: boolean;
};

/**
 * §9.3 — a ordem do estágio 12, que fecha `HOLE-16`: **a imunidade do alvo é conferida
 * antes da comparação de `rank`**.
 *
 * Sem essa ordem, `E_FOUNDER_IMMUTABLE` e `E_FOUNDER_TOP` eram inalcançáveis — o cargo
 * Fundador tem sempre o `rank` máximo, então a comparação genérica de R-4 recusava antes,
 * com `E_HIERARCHY`, para todo autor, inclusive o próprio Fundador. Dois códigos do
 * catálogo nunca apareciam e a UI não tinha como dizer "este cargo não é editável" em vez
 * de "você não tem hierarquia sobre ele".
 *
 * Devolve `null` quando o autor pode agir.
 */
export function authorizeOverTarget(ctx: AuthorityContext): AuthorityDenial | null {
  // 1. o cargo Fundador, e o movimento que alcançaria o rank dele
  if (ctx.targetIsFounderRole === true) return 'E_FOUNDER_IMMUTABLE';
  if (ctx.moveReachesFounderRank === true) return 'E_FOUNDER_TOP';

  // 2. imunidades de pessoa (R-16)
  if (ctx.targetIsOriginalFounder === true) return 'E_FOUNDER_IMMUNE';
  if (ctx.targetIsCurrentHost === true) return 'E_HOST_IMMUNE';
  if (ctx.targetIsSelf === true) return 'E_SELF_TARGET';

  // 3. só então o rank — estritamente menor, nunca igual, nunca maior (§9.3)
  const { authorTopRank: autor, targetTopRank: alvo } = ctx;
  if (autor === null) return 'E_HIERARCHY';
  if (alvo === null) return null; // alvo sem cargo ativo está abaixo de qualquer autor
  return compareRank(alvo, autor) < 0 ? null : 'E_HIERARCHY';
}

// ─── Anti-escalada (§9.3: R-4, R-5, R-11) ──────────────────────────────────────────────

/**
 * R-11 — o cargo base nunca pode conter nenhuma destas. É a regra que fecha o vetor real:
 * sem ela, editar o cargo base — que **todo** membro presente, futuro e reingressante
 * recebe automaticamente — concederia moderação a toda a comunidade.
 */
export const BASE_ROLE_FORBIDDEN: ReadonlySet<Permission> = new Set<Permission>([
  'manage_community',
  'manage_channels',
  'manage_roles',
  'manage_messages',
  'ban_members',
  'kick_members',
  'timeout_members',
  'mention_everyone',
  'view_audit_log',
  'voice_mute_others',
  'create_invite',
]);

/**
 * R-11 — a primeira permissão proibida no cargo base, na ordem de §9.1, ou `null`.
 * Determinística de propósito: duas réplicas precisam nomear a **mesma** permissão.
 */
export function baseRoleViolation(perms: readonly Permission[]): Permission | null {
  const pedidas = new Set(perms);
  for (const p of ALL_PERMISSIONS) {
    if (BASE_ROLE_FORBIDDEN.has(p) && pedidas.has(p)) return p;
  }
  return null;
}

/**
 * R-5 — ninguém concede a um cargo permissão que não possui no conjunto efetivo. Devolve a
 * primeira permissão escalada na ordem de §9.1, ou `null`.
 */
export function escalation(
  granted: readonly Permission[],
  authorEffective: ReadonlySet<Permission>,
): Permission | null {
  const pedidas = new Set(granted);
  for (const p of ALL_PERMISSIONS) {
    if (pedidas.has(p) && !authorEffective.has(p)) return p;
  }
  return null;
}

// ─── Canal somente-leitura (R-21, R-22) ────────────────────────────────────────────────

/**
 * §9.2 e R-22 — a única exceção por canal. O membro perde `send_messages` naquele canal se
 * **todos** os seus cargos estiverem em `readOnlyForRoleIds`. Basta um cargo de fora para
 * poder escrever.
 *
 * Membro sem cargo nenhum não é silenciado por esta regra: R-3 garante que todo membro
 * ativo carrega o cargo base, então a lista vazia não acontece num `DS` são — e "todos de
 * uma lista vazia estão na lista" seria uma recusa que a regra não pede.
 */
export function isReadOnlyFor(
  roleIds: readonly string[],
  readOnlyForRoleIds: readonly string[],
): boolean {
  if (roleIds.length === 0 || readOnlyForRoleIds.length === 0) return false;
  const bloqueados = new Set(readOnlyForRoleIds);
  return roleIds.every((id) => bloqueados.has(id));
}
