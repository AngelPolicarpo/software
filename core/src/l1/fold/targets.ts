// Estágio 12 — quem é o alvo da hierarquia, e o que ele tem de imunidade (§9.3, R-4, R-16).
//
// §9.3, regra única: o autor só age sobre alvo cujo `topRank` seja **estritamente** menor que
// o seu. Nunca igual, nunca maior. Fundador original e host corrente nunca são alvo.
//
// A ordem dentro do estágio (fecha `HOLE-16`) é imposta por `authorizeOverTarget` em
// `permissions`: imunidade **antes** da comparação de `rank`. Este módulo só resolve *quem* é
// o alvo e *quais* imunidades ele carrega — a decisão é de `permissions` (§4: hierarquia é
// dele), e é por isso que os dois estão separados.

import { KINDS } from '../opCodec/index.ts';
import { topRank, type AuthorityContext } from '../permissions/index.ts';
import type { DecisionState } from './state.ts';

export type HierarchyTarget = {
  /** `false` quando o `kind` não tem alvo, ou quando o alvo não existe no `DS`. */
  readonly applies: boolean;
  readonly ctx: AuthorityContext;
};

const NAO_SE_APLICA: HierarchyTarget = {
  applies: false,
  ctx: { authorTopRank: null, targetTopRank: null },
};

/** Os `mod.*` de §7.4.4 — o conjunto de que R-16 fala. */
const MOD_KINDS: ReadonlySet<number> = new Set([
  KINDS['mod.kick'],
  KINDS['mod.ban'],
  KINDS['mod.revokeBan'],
  KINDS['mod.timeout'],
  KINDS['mod.removeTimeout'],
]);

function alvoMembro(
  state: DecisionState,
  authorTop: string | null,
  targetHex: string,
  authorHex: string,
  isMod: boolean,
): HierarchyTarget {
  const base = { authorTopRank: authorTop };

  // R-16, passo 2 de §9.3 — vale para todo `mod.*`, independente da coluna `Hier.`.
  if (isMod) {
    if (targetHex === state.community.founderKey.toString('hex')) {
      return { applies: true, ctx: { ...base, targetTopRank: null, targetIsOriginalFounder: true } };
    }
    if (targetHex === state.community.hostKey.toString('hex')) {
      return { applies: true, ctx: { ...base, targetTopRank: null, targetIsCurrentHost: true } };
    }
    if (targetHex === authorHex) {
      return { applies: true, ctx: { ...base, targetTopRank: null, targetIsSelf: true } };
    }
  } else if (targetHex === authorHex) {
    // Fora de `mod.*`, agir sobre si mesmo não é o caso de R-16; a regra estrutural decide.
    return NAO_SE_APLICA;
  }

  const alvo = state.members.get(targetHex);
  // Alvo inexistente é referência quebrada, não falta de hierarquia: o estágio 14 resolve,
  // e devolver `E_HIERARCHY` aqui esconderia um `E_NOT_FOUND` que a UI sabe explicar.
  if (alvo === undefined) return NAO_SE_APLICA;
  return { applies: true, ctx: { ...base, targetTopRank: topRank([...alvo.roleIds], (id) => rv(state, id)) } };
}

/** O recorte de `RoleView` que `permissions` pede, montado do `DS`. */
function rv(state: DecisionState, id: string) {
  const r = state.roles.get(id);
  if (r === undefined || r.deletedAt !== undefined) return undefined;
  return {
    id,
    rank: r.rank,
    permissions: [] as never[],
    isFounder: r.isFounder,
    isDefault: r.isDefault,
  };
}

function alvoCargo(
  state: DecisionState,
  authorTop: string | null,
  roleId: string,
): HierarchyTarget {
  const r = state.roles.get(roleId);
  // Cargo inexistente ou já deletado: o estágio 14 devolve `E_NOT_FOUND`.
  if (r === undefined || r.deletedAt !== undefined) return NAO_SE_APLICA;
  return {
    applies: true,
    ctx: {
      authorTopRank: authorTop,
      targetTopRank: r.rank,
      // Passo 1 de §9.3: o cargo Fundador é imune **antes** da comparação de `rank`.
      targetIsFounderRole: r.isFounder,
    },
  };
}

export function hierarchyTargetOf(
  kind: number,
  payload: Readonly<Record<string, unknown>>,
  state: DecisionState,
  authorHex: string,
  authorTop: string | null,
): HierarchyTarget {
  const isMod = MOD_KINDS.has(kind);
  if (isMod || kind === KINDS['member.setRoles']) {
    const alvo = payload['targetKey'];
    if (!Buffer.isBuffer(alvo)) return NAO_SE_APLICA;
    return alvoMembro(state, authorTop, alvo.toString('hex'), authorHex, isMod);
  }

  if (kind === KINDS['role.update'] || kind === KINDS['role.delete'] || kind === KINDS['role.move']) {
    const id = payload['roleId'];
    if (typeof id !== 'string') return NAO_SE_APLICA;
    const alvo = alvoCargo(state, authorTop, id);
    // R-4 / §9.3 passo 1: `role.move` que levaria um cargo a `rank ≥` o do Fundador é
    // `E_FOUNDER_TOP`. O destino só é conhecido no estágio 15, então o que se confere aqui é
    // o cargo movido; alcançar o topo é decidido lá, com o `rank` já calculado.
    return alvo;
  }

  if (kind === KINDS['message.delete']) {
    const id = payload['messageId'];
    if (typeof id !== 'string') return NAO_SE_APLICA;
    const msg = state.messages.get(id);
    // Deletar a própria não passa por hierarquia (§7.4: `Hier.` = "se de outro").
    if (msg === undefined || msg.authorKey === authorHex) return NAO_SE_APLICA;
    return alvoMembro(state, authorTop, msg.authorKey, authorHex, false);
  }

  return NAO_SE_APLICA;
}
