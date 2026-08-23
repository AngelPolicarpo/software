// Canais, categorias e metadados da comunidade — a metade de **escrita** de §15.4 para a
// estrutura. Raiz de composição (§4): a regra continua no `fold` (R-6, R-7, R-20, R-26 e os
// limites de §8.6); o que mora aqui é a tradução da fronteira para a op, e nada mais.
//
// Três coisas justificam este arquivo existir:
//
//   1. §15.4 endereça posição por **id** (`afterChannelId`, `afterCategoryId`) e a op de §7.4
//      carrega **rank** (`afterRank`/`beforeRank`). Converter um no outro exige ler o DS, que
//      é o que a raiz de composição pode fazer e o `opCodec` não;
//   2. as respostas de §15.4 trazem `channelId`/`categoryId` e `rank`: o id é derivável na
//      hora (§7.3, do `authorSeq` que a submissão consumiu), e o `rank` é do `fold` — quem o
//      quer, espera a projeção;
//   3. `channel.delete` responde `droppedQueued`, que é efeito **local** sobre a outbox
//      (§11.7 motivo `channel-deleted`), fora do alcance de qualquer módulo de camada.

import { entityId } from '../l1/idgen/index.ts';
import { CHANNEL_TYPE, checkCategoryName, checkChannelName, checkChannelTopic, checkCommunityDescription, checkCommunityName, checkIconEmoji } from '../l1/fold/index.ts';
import { memberHasPermission } from '../l2/voiceCoordinator/host.ts';
import type { ManifestDb } from '../l0/manifest/index.ts';
import type { OpenCommunity } from './boot.ts';
import type { InviteSurfaceDeps } from './community.ts';

export type StructureDeps = InviteSurfaceDeps & {
  /** Prazo para a projeção local alcançar o `seq` respondido pelo host (`rank`, contagens). */
  readonly projectionWaitMs?: number;
};

export type StructureError = { readonly ok: false; readonly code: string; readonly field?: string };

/** As permissões de §7.4 que a fronteira confere de forma advisória antes de submeter. */
export type PermissaoSuperficie =
  | 'manage_channels'
  | 'manage_community'
  | 'manage_roles'
  | 'kick_members'
  | 'ban_members'
  | 'timeout_members';

type Aberta = { readonly c: OpenCommunity; readonly selfHex: string };

const ESPERA_PADRAO_MS = 2_000;

/** Preâmbulo comum: comunidade aberta, viva, e permissão de §7.4 sobre o DS local (§8.7). */
export function abrir(deps: StructureDeps, communityId: string, permissao: PermissaoSuperficie): Aberta | StructureError {
  const identity = deps.selfKey();
  if (identity === null) return { ok: false, code: 'E_NO_IDENTITY' };
  const c = deps.runtime.get(communityId);
  if (c === undefined || !c.projector.ds.community.exists) return { ok: false, code: 'E_NOT_FOUND' };
  if (c.projector.ds.community.endedAt !== undefined) return { ok: false, code: 'E_COMMUNITY_ENDED' };
  const selfHex = identity.publicKey.toString('hex');
  // Advisória (§8.7): quem decide de verdade é o `fold`, contra o DS do host no `hostTs`.
  if (!memberHasPermission(c.projector.ds, selfHex, permissao)) return { ok: false, code: 'E_PERMISSION_DENIED' };
  return { c, selfHex };
}

export function ehErro(v: Aberta | StructureError): v is StructureError {
  return (v as StructureError).ok === false;
}

/**
 * §15.4 endereça posição por **id** (`afterChannelId`, `afterCategoryId`, `afterRoleId`) e a
 * op de §7.4 carrega **rank** (`afterRank`/`beforeRank`). Converter um no outro exige ler o
 * DS, que é o que a raiz de composição pode fazer e o `opCodec` não. "Depois de X" é o par
 * `(rank de X, rank de quem vem logo depois de X)` — é isso que faz o item novo cair **entre
 * os dois** em vez de no fim do escopo, e é exatamente o que `rankBetween` (R-20) espera
 * receber.
 */
export function dicasDeRank(itens: ReadonlyArray<{ readonly id: string; readonly rank: string }>, afterId: string | undefined): { afterRank?: string; beforeRank?: string } {
  if (afterId === undefined) return {};
  const ordenado = [...itens].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  const i = ordenado.findIndex((x) => x.id === afterId);
  // Referência que não existe (ou já foi apagada) é dica inútil: o `fold` põe no fim do
  // escopo, que é o mesmo que não ter mandado dica nenhuma (§8.5 — normaliza, não recusa).
  if (i < 0) return {};
  const seguinte = ordenado[i + 1];
  return { afterRank: ordenado[i]!.rank, ...(seguinte !== undefined ? { beforeRank: seguinte.rank } : {}) };
}

function canaisAtivosDaCategoria(c: OpenCommunity, categoryId: string): Array<{ id: string; rank: string }> {
  const out: Array<{ id: string; rank: string }> = [];
  for (const [id, ch] of c.projector.ds.channels) {
    if (ch.deletedAt === undefined && ch.categoryId === categoryId) out.push({ id, rank: ch.rank });
  }
  return out;
}

function categoriasAtivas(c: OpenCommunity): Array<{ id: string; rank: string }> {
  const out: Array<{ id: string; rank: string }> = [];
  for (const [id, cat] of c.projector.ds.categories) if (cat.deletedAt === undefined) out.push({ id, rank: cat.rank });
  return out;
}

/**
 * Espera a projeção local alcançar o `seq` que o host confirmou. É o que permite responder
 * `rank` e as contagens de `category.delete` com o número que o `fold` calculou — nunca com
 * um recalculado aqui, que seria a mesma regra escrita duas vezes. Prazo vencido devolve
 * `false`, e o chamador responde sem o campo derivado: a UI o obtém no `query.structure`
 * seguinte.
 */
/**
 * Espera a projeção local alcançar o `seq` que o host confirmou. É o que permite responder
 * `rank` e os campos derivados (`affectedMembers`, contagens) com o número que o `fold`
 * calculou — nunca com um recalculado aqui, que seria a mesma regra escrita duas vezes.
 * Prazo vencido devolve `false`, e o chamador responde sem o campo derivado: a UI o obtém
 * na consulta seguinte. Compartilhado por toda a superfície ⏱ de §15.4 (estrutura,
 * cargos e moderação).
 */
export async function esperarProjecao(deps: StructureDeps, c: OpenCommunity, seq: number): Promise<boolean> {
  const limite = deps.now() + (deps.projectionWaitMs ?? ESPERA_PADRAO_MS);
  while (c.projector.interpretedSeq < seq) {
    if (deps.now() >= limite) return c.projector.interpretedSeq >= seq;
    await new Promise((r) => setTimeout(r, 5));
  }
  return true;
}

/** O id que o `fold` vai derivar para a entidade criada por esta op (§7.3). */
function idDerivado(t: 'channel' | 'category', communityId: string, author: Buffer, authorSeq: number): string {
  return entityId(t, Buffer.from(communityId, 'hex'), author, authorSeq, 'community');
}

// ─── Canais (§15.4 "Canais e categorias", todas ⏱) ──────────────────────────────────────

export async function channelCreate(
  deps: StructureDeps,
  a: { communityId: string; categoryId: string; type: number; name: string; topic?: string; readOnlyForRoleIds?: readonly string[]; afterChannelId?: string },
): Promise<{ ok: true; channelId: string; seq: number; rank?: string } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'manage_channels');
  if (ehErro(aberta)) return aberta;
  const { c } = aberta;
  if (a.type !== CHANNEL_TYPE.text && a.type !== CHANNEL_TYPE.voice) return { ok: false, code: 'E_VALIDATION', field: 'type' };
  const nome = checkChannelName(a.name, a.type);
  if (!nome.ok) return { ok: false, code: nome.empty ? 'E_CHANNEL_NAME_EMPTY' : 'E_VALIDATION', ...(nome.empty ? {} : { field: 'name' }) };
  if (a.topic !== undefined) {
    if (a.type !== CHANNEL_TYPE.text) return { ok: false, code: 'E_VALIDATION', field: 'topic' };
    if (!checkChannelTopic(a.topic).ok) return { ok: false, code: 'E_VALIDATION', field: 'topic' };
  }
  const cat = c.projector.ds.categories.get(a.categoryId);
  if (cat === undefined || cat.deletedAt !== undefined) return { ok: false, code: 'E_CATEGORY_NOT_FOUND' };

  const payload: Record<string, unknown> = {
    categoryId: a.categoryId,
    type: a.type,
    name: a.name,
    readOnlyForRoleIds: [...(a.readOnlyForRoleIds ?? [])],
    ...dicasDeRank(canaisAtivosDaCategoria(c, a.categoryId), a.afterChannelId),
  };
  if (a.topic !== undefined) payload['topic'] = a.topic;

  const r = await deps.runtime.client.submitSync(a.communityId, { kindName: 'channel.create', payload });
  if (!r.ok) return { ok: false, code: r.code, ...(r.field !== undefined ? { field: r.field } : {}) };
  const identity = deps.selfKey()!;
  const channelId = idDerivado('channel', a.communityId, identity.publicKey, r.authorSeq);
  await esperarProjecao(deps, c, r.seq);
  const criado = c.projector.ds.channels.get(channelId);
  return { ok: true, channelId, seq: r.seq, ...(criado !== undefined ? { rank: criado.rank } : {}) };
}

export async function channelUpdate(
  deps: StructureDeps,
  a: { communityId: string; channelId: string; name?: string; topic?: string; readOnlyForRoleIds?: readonly string[] },
): Promise<{ ok: true; seq: number } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'manage_channels');
  if (ehErro(aberta)) return aberta;
  const ch = aberta.c.projector.ds.channels.get(a.channelId);
  if (ch === undefined || ch.deletedAt !== undefined) return { ok: false, code: 'E_CHANNEL_NOT_FOUND' };
  if (a.name === undefined && a.topic === undefined && a.readOnlyForRoleIds === undefined) return { ok: false, code: 'E_VALIDATION' };
  if (a.name !== undefined) {
    const nome = checkChannelName(a.name, ch.type);
    if (!nome.ok) return { ok: false, code: nome.empty ? 'E_CHANNEL_NAME_EMPTY' : 'E_VALIDATION', ...(nome.empty ? {} : { field: 'name' }) };
  }
  if (a.topic !== undefined) {
    if (ch.type !== CHANNEL_TYPE.text) return { ok: false, code: 'E_VALIDATION', field: 'topic' };
    if (!checkChannelTopic(a.topic).ok) return { ok: false, code: 'E_VALIDATION', field: 'topic' };
  }
  const payload: Record<string, unknown> = { channelId: a.channelId };
  if (a.name !== undefined) payload['name'] = a.name;
  if (a.topic !== undefined) payload['topic'] = a.topic;
  if (a.readOnlyForRoleIds !== undefined) payload['readOnlyForRoleIds'] = [...a.readOnlyForRoleIds];
  const r = await deps.runtime.client.submitSync(a.communityId, { kindName: 'channel.update', payload });
  return r.ok ? { ok: true, seq: r.seq } : { ok: false, code: r.code, ...(r.field !== undefined ? { field: r.field } : {}) };
}

export async function channelMove(
  deps: StructureDeps,
  a: { communityId: string; channelId: string; categoryId: string; afterChannelId?: string },
): Promise<{ ok: true; seq: number; rank?: string } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'manage_channels');
  if (ehErro(aberta)) return aberta;
  const { c } = aberta;
  const ch = c.projector.ds.channels.get(a.channelId);
  if (ch === undefined || ch.deletedAt !== undefined) return { ok: false, code: 'E_CHANNEL_NOT_FOUND' };
  const cat = c.projector.ds.categories.get(a.categoryId);
  if (cat === undefined || cat.deletedAt !== undefined) return { ok: false, code: 'E_CATEGORY_NOT_FOUND' };
  // A dica é lida no escopo de DESTINO — mover é reposicionar lá, não aqui.
  const payload: Record<string, unknown> = {
    channelId: a.channelId,
    categoryId: a.categoryId,
    ...dicasDeRank(
      canaisAtivosDaCategoria(c, a.categoryId).filter((x) => x.id !== a.channelId),
      a.afterChannelId,
    ),
  };
  const r = await deps.runtime.client.submitSync(a.communityId, { kindName: 'channel.move', payload });
  if (!r.ok) return { ok: false, code: r.code, ...(r.field !== undefined ? { field: r.field } : {}) };
  await esperarProjecao(deps, c, r.seq);
  const movido = c.projector.ds.channels.get(a.channelId);
  return { ok: true, seq: r.seq, ...(movido !== undefined ? { rank: movido.rank } : {}) };
}

export async function channelDelete(
  deps: StructureDeps,
  a: { communityId: string; channelId: string },
): Promise<{ ok: true; seq: number; droppedQueued: number } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'manage_channels');
  if (ehErro(aberta)) return aberta;
  const { c } = aberta;
  const ch = c.projector.ds.channels.get(a.channelId);
  if (ch === undefined || ch.deletedAt !== undefined) return { ok: false, code: 'E_CHANNEL_NOT_FOUND' };
  const r = await deps.runtime.client.submitSync(a.communityId, { kindName: 'channel.delete', payload: { channelId: a.channelId } });
  if (!r.ok) return { ok: false, code: r.code, ...(r.field !== undefined ? { field: r.field } : {}) };
  // §11.7 — o canal foi tombstonado: o que estava na fila para ele não tem mais destino, e
  // some com motivo nomeado em vez de virar `E_CHANNEL_NOT_FOUND` no host, um por um.
  const droppedQueued = c.outbox?.discardForChannel(a.channelId) ?? 0;
  return { ok: true, seq: r.seq, droppedQueued };
}

// ─── Categorias ─────────────────────────────────────────────────────────────────────────

export async function categoryCreate(
  deps: StructureDeps,
  a: { communityId: string; name: string; afterCategoryId?: string },
): Promise<{ ok: true; categoryId: string; seq: number; rank?: string } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'manage_channels');
  if (ehErro(aberta)) return aberta;
  const { c } = aberta;
  if (!checkCategoryName(a.name).ok) return { ok: false, code: 'E_VALIDATION', field: 'name' };
  const payload: Record<string, unknown> = { name: a.name, ...dicasDeRank(categoriasAtivas(c), a.afterCategoryId) };
  const r = await deps.runtime.client.submitSync(a.communityId, { kindName: 'category.create', payload });
  if (!r.ok) return { ok: false, code: r.code, ...(r.field !== undefined ? { field: r.field } : {}) };
  const identity = deps.selfKey()!;
  const categoryId = idDerivado('category', a.communityId, identity.publicKey, r.authorSeq);
  await esperarProjecao(deps, c, r.seq);
  const criada = c.projector.ds.categories.get(categoryId);
  return { ok: true, categoryId, seq: r.seq, ...(criada !== undefined ? { rank: criada.rank } : {}) };
}

export async function categoryRename(
  deps: StructureDeps,
  a: { communityId: string; categoryId: string; name: string },
): Promise<{ ok: true; seq: number } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'manage_channels');
  if (ehErro(aberta)) return aberta;
  const cat = aberta.c.projector.ds.categories.get(a.categoryId);
  if (cat === undefined || cat.deletedAt !== undefined) return { ok: false, code: 'E_CATEGORY_NOT_FOUND' };
  if (!checkCategoryName(a.name).ok) return { ok: false, code: 'E_VALIDATION', field: 'name' };
  const r = await deps.runtime.client.submitSync(a.communityId, { kindName: 'category.rename', payload: { categoryId: a.categoryId, name: a.name } });
  return r.ok ? { ok: true, seq: r.seq } : { ok: false, code: r.code, ...(r.field !== undefined ? { field: r.field } : {}) };
}

export async function categoryDelete(
  deps: StructureDeps,
  a: { communityId: string; categoryId: string; moveChannelsTo?: string; deleteChannels?: boolean },
): Promise<{ ok: true; seq: number; movedChannels: number; deletedChannels: number } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'manage_channels');
  if (ehErro(aberta)) return aberta;
  const { c } = aberta;
  const cat = c.projector.ds.categories.get(a.categoryId);
  if (cat === undefined || cat.deletedAt !== undefined) return { ok: false, code: 'E_CATEGORY_NOT_FOUND' };
  const apagarCanais = a.deleteChannels === true;
  // §15.4 dá as duas formas do comando, e só as duas: ou os canais mudam de casa, ou vão
  // junto. Pedir as duas coisas ao mesmo tempo é entrada incoerente, não escolha.
  if (apagarCanais && a.moveChannelsTo !== undefined) return { ok: false, code: 'E_VALIDATION', field: 'moveChannelsTo' };
  if (a.moveChannelsTo !== undefined) {
    const destino = c.projector.ds.categories.get(a.moveChannelsTo);
    if (destino === undefined || destino.deletedAt !== undefined) return { ok: false, code: 'E_CATEGORY_NOT_FOUND' };
  }
  const antes = canaisAtivosDaCategoria(c, a.categoryId).map((x) => x.id);
  const payload: Record<string, unknown> = { categoryId: a.categoryId, deleteChannels: apagarCanais };
  if (a.moveChannelsTo !== undefined) payload['moveChannelsTo'] = a.moveChannelsTo;
  const r = await deps.runtime.client.submitSync(a.communityId, { kindName: 'category.delete', payload });
  if (!r.ok) return { ok: false, code: r.code, ...(r.field !== undefined ? { field: r.field } : {}) };

  await esperarProjecao(deps, c, r.seq);
  // As contagens são LIDAS do estado projetado, nunca recalculadas: quem decidiu o destino
  // de cada canal foi o `fold` (R-7 pode ter recusado a operação inteira).
  let movedChannels = 0;
  let deletedChannels = 0;
  for (const id of antes) {
    const ch = c.projector.ds.channels.get(id);
    if (ch === undefined) continue;
    if (ch.deletedAt !== undefined) deletedChannels += 1;
    else if (ch.categoryId !== a.categoryId) movedChannels += 1;
  }
  return { ok: true, seq: r.seq, movedChannels, deletedChannels };
}

// ─── Comunidade (§15.4 "Comunidade") ────────────────────────────────────────────────────

export async function communityUpdate(
  deps: StructureDeps,
  a: { communityId: string; name?: string; iconEmoji?: string; iconColor?: number; description?: string },
): Promise<{ ok: true; seq: number } | StructureError> {
  const aberta = abrir(deps, a.communityId, 'manage_community');
  if (ehErro(aberta)) return aberta;
  if (a.name === undefined && a.iconEmoji === undefined && a.iconColor === undefined && a.description === undefined) {
    return { ok: false, code: 'E_VALIDATION' };
  }
  if (a.name !== undefined && !checkCommunityName(a.name).ok) return { ok: false, code: 'E_VALIDATION', field: 'name' };
  if (a.iconEmoji !== undefined && !checkIconEmoji(a.iconEmoji).ok) return { ok: false, code: 'E_VALIDATION', field: 'iconEmoji' };
  if (a.iconColor !== undefined && (!Number.isInteger(a.iconColor) || a.iconColor < 0 || a.iconColor > 255)) {
    return { ok: false, code: 'E_VALIDATION', field: 'iconColor' };
  }
  if (a.description !== undefined && !checkCommunityDescription(a.description).ok) return { ok: false, code: 'E_VALIDATION', field: 'description' };
  const payload: Record<string, unknown> = {};
  if (a.name !== undefined) payload['name'] = a.name;
  if (a.iconEmoji !== undefined) payload['iconEmoji'] = a.iconEmoji;
  if (a.iconColor !== undefined) payload['iconColor'] = a.iconColor;
  if (a.description !== undefined) payload['description'] = a.description;
  const r = await deps.runtime.client.submitSync(a.communityId, { kindName: 'community.update', payload });
  return r.ok ? { ok: true, seq: r.seq } : { ok: false, code: r.code, ...(r.field !== undefined ? { field: r.field } : {}) };
}

// ─── community.activate (§15.4, §8.1) ─────────────────────────────────────────────────────

/**
 * `community.activate {communityId | null}` — a troca de residência do DS. É escolha
 * LOCAL (nunca trafega): a regra de §8.1 deriva `full` para a comunidade ativa e para toda
 * hospedada, `light` para as demais; o comando é quem FIXA a ativa. A carga sob demanda de
 * `messages`/`rootOfThread` para comunidades `light` ainda não existe no projector (§8.1,
 * a medir em G9) — pendência registrada; hoje a escolha é persistida e consultável.
 */
export function communityActivate(
  deps: StructureDeps & { manifest: ManifestDb },
  communityId: string | null,
): { ok: true; residency: 'full' | 'light' } | StructureError {
  if (communityId === null) {
    deps.manifest.setResidencyActive(null);
    return { ok: true, residency: 'light' };
  }
  const row = deps.manifest.getCommunity(communityId) as { left_at: number | null; removed_reason: string | null } | null;
  if (row === null || row.left_at !== null || row.removed_reason !== null) {
    return { ok: false, code: 'E_NOT_FOUND' };
  }
  deps.manifest.setResidencyActive(communityId);
  return { ok: true, residency: 'full' };
}
