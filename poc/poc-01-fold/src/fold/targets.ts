/**
 * Estagio 12 — resolucao do alvo de hierarquia (§9.3, R-4, R-16).
 *
 * Regra unica de §9.3: o autor so age sobre alvo cujo `topRank` seja ESTRITAMENTE menor
 * que o seu. Nunca igual, nunca maior. Fundador original e host corrente nunca sao alvo.
 */
import { E, type ErrorCode } from '../protocol/errors.ts';
import { K } from '../protocol/kinds.ts';
import { topRank } from '../protocol/permissions.ts';
import type { Payload } from '../codec/opCodec.ts';
import type { DecisionState } from './state.ts';

export type HierarchyTarget = {
  applies: boolean;
  topRank: string | null;
  immune?: ErrorCode;
};

const NOT_APPLICABLE: HierarchyTarget = { applies: false, topRank: null };

function memberTarget(state: DecisionState, targetHex: string, authorHex: string, isMod: boolean): HierarchyTarget {
  if (targetHex === authorHex) {
    // R-16: ninguem e alvo de `mod.*` sobre si mesmo.
    return isMod ? { applies: true, topRank: null, immune: E.SELF_TARGET } : NOT_APPLICABLE;
  }
  if (isMod) {
    // R-16: o Fundador ORIGINAL e o host CORRENTE nunca sao alvo de `mod.*`.
    if (targetHex === state.community.founderKey.toString('hex')) {
      return { applies: true, topRank: null, immune: E.FOUNDER_IMMUNE };
    }
    if (targetHex === state.community.hostKey.toString('hex')) {
      return { applies: true, topRank: null, immune: E.HOST_IMMUNE };
    }
  }
  const t = state.members.get(targetHex);
  if (!t) return NOT_APPLICABLE; // alvo inexistente: resolvido como regra estrutural (estagio 14)
  return { applies: true, topRank: topRank(t.roleIds, state.roles) };
}

export function hierarchyTargetOf(
  kind: number,
  payload: Payload,
  state: DecisionState,
  authorHex: string,
): HierarchyTarget {
  switch (kind) {
    case K.MOD_BAN: {
      const p = payload as { targetKey: Buffer };
      return memberTarget(state, p.targetKey.toString('hex'), authorHex, true);
    }
    case K.MEMBER_SET_ROLES: {
      const p = payload as { targetKey: Buffer };
      return memberTarget(state, p.targetKey.toString('hex'), authorHex, false);
    }
    case K.MESSAGE_DELETE: {
      const p = payload as { messageId: string };
      const msg = state.messages.get(p.messageId);
      if (!msg || msg.authorKey === authorHex) return NOT_APPLICABLE; // propria: sem hierarquia
      return memberTarget(state, msg.authorKey, authorHex, false);
    }
    case K.ROLE_UPDATE:
    case K.ROLE_DELETE: {
      // R-4: nenhum cargo do alvo pode ter `rank ≥ topRank(autor)`.
      const p = payload as { roleId: string };
      const r = state.roles.get(p.roleId);
      if (!r || r.deletedAt !== undefined) return NOT_APPLICABLE; // estagio 14 resolve
      return { applies: true, topRank: r.rank };
    }
    default:
      return NOT_APPLICABLE;
  }
}
