// Membros, cargos e moderação — a metade de **escrita** de §15.4 ("Cargos e membros" e
// "Moderação"). Raiz de composição (§4), na mesma régua de `structure.ts`: a regra continua
// no `fold` (R-3 a R-5, R-10 a R-12, R-16, R-26, R-28 e os limites de §8.6); o que mora aqui
// é a tradução da fronteira para a op e nada mais.
//
// Três coisas justificam este arquivo existir, e são as mesmas da estrutura:
//
//   1. §15.4 endereça posição por **id** (`afterRoleId`/`beforeRoleId`) e a op carrega
//      **rank** (`afterRank`/`beforeRank`) — converter exige ler o DS;
//   2. as respostas trazem campos derivados (`rank`, `affectedMembers`, `clearedChannelRefs`,
//      `appliedRoleIds`, `hiddenMessages`, `revokedInvites`, `restoredMessages`) que são
//      **decisão do `fold`**: quem os quer espera a projeção e lê o estado projetado,
//      nunca recalcula;
//   3. permissões nomeadas chegam do renderer como **nomes** e viajam na op como números de
//      protocolo (§9.1) — a tradução é da raiz, que pode importar `permissions`.
//
// A hierarquia NÃO é conferida aqui: `hierarchyTargetOf` mora no `fold`, e quem recusa com
// `E_HIERARCHY`/`E_FOUNDER_IMMUNE`/`E_HOST_IMMUNE`/`E_SELF_TARGET` é ele (§8.7).

import { entityId } from '../l1/idgen/index.ts';
import { checkNickname, checkRoleName, isRoleColor } from '../l1/fold/index.ts';
import { PERMISSIONS, permissionNumber, type Permission } from '../l1/permissions/index.ts';
import type { OpenCommunity } from './boot.ts';
import type { InviteSurfaceDeps } from './community.ts';
import { abrir, dicasDeRank, ehErro, esperarProjecao, type StructureError } from './structure.ts';

export type ModerationDeps = InviteSurfaceDeps & {
  /** Prazo para a projeção local alcançar o `seq` respondido pelo host (campos derivados). */
  readonly projectionWaitMs?: number;
};

function falha(e: unknown): StructureError {
  const r = e as { code: string; field?: string };
  return { ok: false, code: r.code, ...(r.field !== undefined ? { field: r.field } : {}) };
}

/** `key` do fio de §15.2 — hex64; forma errada é recusa local, nunca op assinada. */
function chaveHex(v: string): Buffer | null {
  return /^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, 'hex') : null;
}

/**
 * Permissões nomeadas → números de protocolo (§9.1). Nome desconhecido é `E_VALIDATION`
 * aqui, antes de assinar qualquer coisa: um número inventado no log seria concessão silenciosa.
 */
function permissoesParaNumeros(nomes: readonly string[]): { ok: true; numeros: number[] } | { ok: false; field: 'permissions' } {
  const numeros: number[] = [];
  for (const nome of nomes) {
    if (typeof nome !== 'string' || !(nome in PERMISSIONS)) return { ok: false, field: 'permissions' };
    numeros.push(permissionNumber(nome as Permission));
  }
  return { ok: true, numeros };
}

function cargosAtivos(c: OpenCommunity): Array<{ id: string; rank: string }> {
  const out: Array<{ id: string; rank: string }> = [];
  for (const [id, role] of c.projector.ds.roles) {
    if (role.deletedAt === undefined) out.push({ id, rank: role.rank });
  }
  return out;
}

function idDerivado(communityId: string, author: Buffer, authorSeq: number): string {
  return entityId('role', Buffer.from(communityId, 'hex'), author, authorSeq, 'community');
}

async function submeter(
  deps: ModerationDeps,
  c: OpenCommunity,
  kindName: 'role.create' | 'role.update' | 'role.move' | 'role.delete' | 'member.setRoles' | 'member.setNickname' | 'mod.kick' | 'mod.ban' | 'mod.revokeBan' | 'mod.timeout' | 'mod.removeTimeout',
  payload: Record<string, unknown>,
) {
  return await deps.runtime.client.submitSync(c.communityId, { kindName, payload });
}

// ─── Cargos (§15.4 "Cargos e membros", todas ⏱, manage_roles) ───────────────────────────

export async function roleCreate(
  deps: ModerationDeps,
  a: { communityId: string; name: string; color: number; permissions: readonly string[]; mentionable: boolean; afterRoleId?: string },
): Promise<{ ok: true; roleId: string; seq: number; rank?: string } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'manage_roles');
  if (ehErro(aberta)) return aberta;
  const { c } = aberta;
  const nome = checkRoleName(a.name);
  if (!nome.ok) return { ok: false, code: 'E_VALIDATION', ...(nome.field !== undefined ? { field: nome.field } : {}) };
  if (!Number.isInteger(a.color) || !isRoleColor(a.color)) return { ok: false, code: 'E_VALIDATION', field: 'color' };
  const perms = permissoesParaNumeros(a.permissions);
  if (!perms.ok) return { ok: false, code: 'E_VALIDATION', field: perms.field };

  const payload: Record<string, unknown> = {
    name: a.name,
    color: a.color,
    permissions: perms.numeros,
    mentionable: a.mentionable,
    ...dicasDeRank(cargosAtivos(c), a.afterRoleId),
  };
  const r = await submeter(deps, c, 'role.create', payload);
  if (!r.ok) return falha(r);
  // O id é derivável na hora (§7.3); o `rank` é do `fold` — espera a projeção por ele.
  const identity = deps.selfKey()!;
  const roleId = idDerivado(a.communityId, identity.publicKey, r.authorSeq);
  await esperarProjecao(deps, c, r.seq);
  const criado = c.projector.ds.roles.get(roleId);
  return { ok: true, roleId, seq: r.seq, ...(criado !== undefined ? { rank: criado.rank } : {}) };
}

export async function roleUpdate(
  deps: ModerationDeps,
  a: { communityId: string; roleId: string; name?: string; color?: number; permissions?: readonly string[]; mentionable?: boolean },
): Promise<{ ok: true; seq: number } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'manage_roles');
  if (ehErro(aberta)) return aberta;
  if (a.name === undefined && a.color === undefined && a.permissions === undefined && a.mentionable === undefined) {
    return { ok: false, code: 'E_VALIDATION' };
  }
  if (a.name !== undefined) {
    const n = checkRoleName(a.name);
    if (!n.ok) return { ok: false, code: 'E_VALIDATION', ...(n.field !== undefined ? { field: n.field } : {}) };
  }
  if (a.color !== undefined && (!Number.isInteger(a.color) || !isRoleColor(a.color))) return { ok: false, code: 'E_VALIDATION', field: 'color' };
  let permissoes: number[] | undefined;
  if (a.permissions !== undefined) {
    const perms = permissoesParaNumeros(a.permissions);
    if (!perms.ok) return { ok: false, code: 'E_VALIDATION', field: perms.field };
    permissoes = perms.numeros;
  }
  const payload: Record<string, unknown> = { roleId: a.roleId };
  if (a.name !== undefined) payload['name'] = a.name;
  if (a.color !== undefined) payload['color'] = a.color;
  if (permissoes !== undefined) payload['permissions'] = permissoes;
  if (a.mentionable !== undefined) payload['mentionable'] = a.mentionable;
  // E_FOUNDER_IMMUTABLE / E_BASE_ROLE_RESTRICTED / E_PERMISSION_ESCALATION são do `fold`.
  const r = await submeter(deps, aberta.c, 'role.update', payload);
  return r.ok ? { ok: true, seq: r.seq } : falha(r);
}

export async function roleMove(
  deps: ModerationDeps,
  a: { communityId: string; roleId: string; afterRoleId?: string; beforeRoleId?: string },
): Promise<{ ok: true; seq: number; rank?: string } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'manage_roles');
  if (ehErro(aberta)) return aberta;
  const { c } = aberta;
  if (a.afterRoleId === undefined && a.beforeRoleId === undefined) return { ok: false, code: 'E_VALIDATION' };
  // "Depois de X" manda os dois vizinhos (R-20); "antes de Y" manda só o de cima. Quando os
  // dois chegam, o destino explícito (`beforeRoleId`) fecha o intervalo.
  const escopo = cargosAtivos(c).filter((x) => x.id !== a.roleId);
  let dicas = dicasDeRank(escopo, a.afterRoleId);
  if (a.beforeRoleId !== undefined) {
    const alvo = escopo.find((x) => x.id === a.beforeRoleId);
    // Referência que não existe é dica inútil: sem ela, o `fold` posiciona sozinho (§8.5).
    dicas = { ...dicas, ...(alvo !== undefined ? { beforeRank: alvo.rank } : {}) };
  }
  const r = await submeter(deps, c, 'role.move', { roleId: a.roleId, ...dicas });
  if (!r.ok) return falha(r);
  await esperarProjecao(deps, c, r.seq);
  const movido = c.projector.ds.roles.get(a.roleId);
  return { ok: true, seq: r.seq, ...(movido !== undefined ? { rank: movido.rank } : {}) };
}

export async function roleDelete(
  deps: ModerationDeps,
  a: { communityId: string; roleId: string },
): Promise<{ ok: true; seq: number; affectedMembers: number; clearedChannelRefs: number } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'manage_roles');
  if (ehErro(aberta)) return aberta;
  const { c } = aberta;
  // Candidatos lidos ANTES, desfecho confirmado DEPOIS no estado projetado — o mesmo padrão
  // de `category.delete`. Quem decidiu a limpeza (R-12, §8.4.1, F-31) foi o `fold`.
  const portadores: string[] = [];
  for (const [hex, m] of c.projector.ds.members) if (m.roleIds.has(a.roleId)) portadores.push(hex);
  const referenciando: string[] = [];
  for (const [id, ch] of c.projector.ds.channels) if (ch.readOnlyForRoleIds.has(a.roleId)) referenciando.push(id);

  const r = await submeter(deps, c, 'role.delete', { roleId: a.roleId });
  if (!r.ok) return falha(r);
  await esperarProjecao(deps, c, r.seq);

  let affectedMembers = 0;
  for (const hex of portadores) {
    const m = c.projector.ds.members.get(hex);
    if (m === undefined || !m.roleIds.has(a.roleId)) affectedMembers += 1;
  }
  let clearedChannelRefs = 0;
  for (const id of referenciando) {
    const ch = c.projector.ds.channels.get(id);
    if (ch === undefined || !ch.readOnlyForRoleIds.has(a.roleId)) clearedChannelRefs += 1;
  }
  return { ok: true, seq: r.seq, affectedMembers, clearedChannelRefs };
}

// ─── Membros ────────────────────────────────────────────────────────────────────────────

export async function memberSetRoles(
  deps: ModerationDeps,
  a: { communityId: string; targetKey: string; roleIds: readonly string[] },
): Promise<{ ok: true; seq: number; appliedRoleIds: string[] } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'manage_roles');
  if (ehErro(aberta)) return aberta;
  const { c } = aberta;
  const targetKey = chaveHex(a.targetKey);
  if (targetKey === null) return { ok: false, code: 'E_VALIDATION', field: 'targetKey' };
  const r = await submeter(deps, c, 'member.setRoles', { targetKey, roleIds: [...a.roleIds] });
  if (!r.ok) return falha(r);
  // §8.4.1: ids desconhecidos ou deletados são DESCARTADOS, não recusam a op — o conjunto
  // efetivamente aplicado é o que o estado projetado tem, lido depois da projeção.
  await esperarProjecao(deps, c, r.seq);
  const alvo = c.projector.ds.members.get(a.targetKey.toLowerCase());
  const aplicados = alvo === undefined ? [] : [...alvo.roleIds].sort();
  return { ok: true, seq: r.seq, appliedRoleIds: aplicados };
}

export async function memberSetNickname(
  deps: ModerationDeps,
  a: { communityId: string; nickname: string | null },
): Promise<{ ok: true; seq: number } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'manage_roles');
  if (ehErro(aberta)) return aberta;
  if (a.nickname !== null) {
    const nk = checkNickname(a.nickname);
    if (!nk.ok) return { ok: false, code: 'E_VALIDATION', field: nk.field };
  }
  // Limpar é a forma sem campo: `opt<str>` ausente é o `null` de §15.4.
  const payload: Record<string, unknown> = a.nickname === null ? {} : { nickname: a.nickname };
  const r = await submeter(deps, aberta.c, 'member.setNickname', payload);
  return r.ok ? { ok: true, seq: r.seq } : falha(r);
}

// ─── Moderação (§15.4 "Moderação", todas ⏱) ─────────────────────────────────────────────

function mensagensDoAlvo(c: OpenCommunity, targetHex: string): Set<string> {
  const ocultas = new Set<string>();
  for (const [id, msg] of c.projector.ds.messages) {
    if (msg.authorKey === targetHex && msg.hiddenByBan) ocultas.add(id);
  }
  return ocultas;
}

function convitesDoAlvo(c: OpenCommunity, targetHex: string): Set<string> {
  const revogados = new Set<string>();
  for (const [pkHex, invite] of c.projector.ds.invites) {
    if (invite.createdBy.toString('hex') === targetHex && invite.revokedAt !== undefined) revogados.add(pkHex);
  }
  return revogados;
}

export async function modKick(
  deps: ModerationDeps,
  a: { communityId: string; targetKey: string; reason?: string },
): Promise<{ ok: true; seq: number } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'kick_members');
  if (ehErro(aberta)) return aberta;
  const targetKey = chaveHex(a.targetKey);
  if (targetKey === null) return { ok: false, code: 'E_VALIDATION', field: 'targetKey' };
  const payload: Record<string, unknown> = { targetKey };
  if (a.reason !== undefined) payload['reason'] = a.reason;
  // Alvo imune ou fora da hierarquia é decisão do `fold` (R-16/§9.3); kick de não-membro é
  // `E_NOT_FOUND` dele. Aqui não se recusa nada disso.
  const r = await submeter(deps, aberta.c, 'mod.kick', payload);
  return r.ok ? { ok: true, seq: r.seq } : falha(r);
}

export async function modBan(
  deps: ModerationDeps,
  a: { communityId: string; targetKey: string; reason?: string },
): Promise<{ ok: true; seq: number; hiddenMessages: number; revokedInvites: number } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'ban_members');
  if (ehErro(aberta)) return aberta;
  const { c } = aberta;
  const targetKey = chaveHex(a.targetKey);
  if (targetKey === null) return { ok: false, code: 'E_VALIDATION', field: 'targetKey' };
  const targetHex = targetKey.toString('hex');
  // Ban de quem NÃO é membro é APPLIED (R-28, ban preventivo) — nunca recusado aqui.
  const ocultasAntes = mensagensDoAlvo(c, targetHex);
  const revogadosAntes = convitesDoAlvo(c, targetHex);

  const payload: Record<string, unknown> = { targetKey };
  if (a.reason !== undefined) payload['reason'] = a.reason;
  const r = await submeter(deps, c, 'mod.ban', payload);
  if (!r.ok) return falha(r);
  await esperarProjecao(deps, c, r.seq);

  // As contagens são o DELTA que esta op produziu no estado projetado: um re-ban idempotente
  // (§8.4.1) decide nada e responde zero — nunca o total acumulado da história.
  let hiddenMessages = 0;
  for (const id of mensagensDoAlvo(c, targetHex)) if (!ocultasAntes.has(id)) hiddenMessages += 1;
  let revokedInvites = 0;
  for (const pk of convitesDoAlvo(c, targetHex)) if (!revogadosAntes.has(pk)) revokedInvites += 1;
  return { ok: true, seq: r.seq, hiddenMessages, revokedInvites };
}

export async function modRevokeBan(
  deps: ModerationDeps,
  a: { communityId: string; targetKey: string },
): Promise<{ ok: true; seq: number; restoredMessages: number } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'ban_members');
  if (ehErro(aberta)) return aberta;
  const { c } = aberta;
  const targetKey = chaveHex(a.targetKey);
  if (targetKey === null) return { ok: false, code: 'E_VALIDATION', field: 'targetKey' };
  const targetHex = targetKey.toString('hex');
  const ocultasAntes = mensagensDoAlvo(c, targetHex);

  const r = await submeter(deps, c, 'mod.revokeBan', { targetKey });
  if (!r.ok) return falha(r);
  await esperarProjecao(deps, c, r.seq);

  const depois = mensagensDoAlvo(c, targetHex);
  let restoredMessages = 0;
  for (const id of ocultasAntes) if (!depois.has(id)) restoredMessages += 1;
  return { ok: true, seq: r.seq, restoredMessages };
}

export async function modTimeout(
  deps: ModerationDeps,
  a: { communityId: string; targetKey: string; until: number; reason?: string },
): Promise<{ ok: true; seq: number } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'timeout_members');
  if (ehErro(aberta)) return aberta;
  const targetKey = chaveHex(a.targetKey);
  if (targetKey === null) return { ok: false, code: 'E_VALIDATION', field: 'targetKey' };
  if (!Number.isSafeInteger(a.until) || a.until <= 0) return { ok: false, code: 'E_VALIDATION', field: 'until' };
  const payload: Record<string, unknown> = { targetKey, until: a.until };
  if (a.reason !== undefined) payload['reason'] = a.reason;
  // A janela `[hostTs+60s, hostTs+30d]` de §8.6 depende do `hostTs` DA ADMISSÃO — só o
  // `fold` conhece; fora dela é `E_VALIDATION.until` dele.
  const r = await submeter(deps, aberta.c, 'mod.timeout', payload);
  return r.ok ? { ok: true, seq: r.seq } : falha(r);
}

export async function modRemoveTimeout(
  deps: ModerationDeps,
  a: { communityId: string; targetKey: string },
): Promise<{ ok: true; seq: number } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'timeout_members');
  if (ehErro(aberta)) return aberta;
  const targetKey = chaveHex(a.targetKey);
  if (targetKey === null) return { ok: false, code: 'E_VALIDATION', field: 'targetKey' };
  const r = await submeter(deps, aberta.c, 'mod.removeTimeout', { targetKey });
  return r.ok ? { ok: true, seq: r.seq } : falha(r);
}
