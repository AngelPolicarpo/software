import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { IDS, MEMBERS_BY_COMMUNITY } from "../../mocks/dataset";
import {
  selectCommunity,
  selectHasPermission,
  selectRole,
  useCommunityStore,
} from "../../store/communityStore";
import { useIdentityStore } from "../../store/identityStore";
import type {
  AvatarColor,
  PresenceStatus,
  Role,
  RoleColor,
} from "../../domain/types";

/**
 * Candidatos do autocomplete de menção (§9, 2.1.1).
 *
 * Ordem fixa das seções — `@everyone`, CARGOS, MEMBROS —, nunca
 * intercalada: a seção já diz o tipo, sem depender de um ícone pequeno.
 */
export type MentionCandidate =
  | { kind: "everyone"; id: "everyone"; label: string; secondary: string }
  | {
      kind: "role";
      id: string;
      label: string;
      secondary: string;
      color: RoleColor;
    }
  | {
      kind: "member";
      id: string;
      label: string;
      secondary: string;
      avatarColor: AvatarColor;
      presence: PresenceStatus;
      roleColor: RoleColor;
    };

/** O texto que entra no composer ao confirmar — e que vira pill depois. */
export function mentionToken(candidate: MentionCandidate): string {
  return `@${candidate.label}`;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Casa por início de qualquer palavra: "so" encontra "Bianca Souza". */
function matches(label: string, query: string): boolean {
  if (query === "") return true;
  const needle = normalize(query);
  return normalize(label)
    .split(/\s+/)
    .some((word) => word.startsWith(needle));
}

const PRESENCE_ORDER: Record<PresenceStatus, number> = {
  online: 0,
  idle: 1,
  dnd: 2,
  invisible: 3,
  offline: 3,
};

/**
 * Lista completa de candidatos da comunidade, na ordem de exibição. O filtro
 * por texto vem depois, em `filterMentionCandidates` — a lista é local e
 * pequena, não há busca assíncrona aqui (§9, 2.1.1).
 *
 * A montagem fica num `useMemo` sobre entradas *estáveis* (os cargos vêm da
 * store por `useShallow`, os membros são fixture). Montar os objetos dentro
 * do seletor derrubaria o app: `useShallow` compara elemento a elemento por
 * referência, e objeto novo a cada render nunca é igual ao anterior.
 */
export function useMentionCandidates(communityId: string): MentionCandidate[] {
  const localIdentityId = useIdentityStore((state) => state.identity?.id);

  const roles = useCommunityStore(
    useShallow((state) =>
      (selectCommunity(state, communityId)?.roleIds ?? [])
        .map((roleId) => selectRole(state, roleId))
        .filter((role): role is Role => role !== undefined),
    ),
  );

  const canMentionEveryone = useCommunityStore((state) =>
    selectHasPermission(state, communityId, "mention_everyone"),
  );

  return useMemo(() => {
    const candidates: MentionCandidate[] = [];

    // Some da lista pra quem não tem a permissão — nunca desabilitado.
    if (canMentionEveryone) {
      candidates.push({
        kind: "everyone",
        id: "everyone",
        label: "everyone",
        secondary: "Notifica todos os membros do canal",
      });
    }

    for (const role of [...roles]
      .filter((role) => role.mentionable)
      .sort((a, b) => b.position - a.position)) {
      candidates.push({
        kind: "role",
        id: role.id,
        label: role.name,
        secondary: `${role.memberCount} ${role.memberCount === 1 ? "membro" : "membros"}`,
        color: role.color,
      });
    }

    const rolesById = new Map(roles.map((role) => [role.id, role]));
    const members = [...(MEMBERS_BY_COMMUNITY[communityId] ?? [])]
      // A identidade local ocupa o lugar de Ana nas comunidades de §2;
      // mencionar a si mesma não serve pra nada, então fica de fora.
      .filter(
        (member) =>
          member.identityId !== IDS.ana &&
          member.identityId !== localIdentityId,
      )
      .sort((a, b) => {
        const presence = PRESENCE_ORDER[a.presence] - PRESENCE_ORDER[b.presence];
        if (presence !== 0) return presence;
        return a.displayName.localeCompare(b.displayName, "pt-BR");
      });

    for (const member of members) {
      const highest = member.roleIds
        .map((roleId) => rolesById.get(roleId))
        .filter((role): role is Role => role !== undefined)
        .sort((a, b) => b.position - a.position)[0];

      candidates.push({
        kind: "member",
        id: member.identityId,
        label: member.nickname ?? member.displayName,
        secondary: highest?.name ?? "Membro",
        avatarColor: member.avatarColor,
        presence: member.presence,
        roleColor: highest?.color ?? "role-neutral",
      });
    }

    return candidates;
  }, [communityId, roles, canMentionEveryone, localIdentityId]);
}

export function filterMentionCandidates(
  candidates: MentionCandidate[],
  query: string,
): MentionCandidate[] {
  return candidates.filter((candidate) => matches(candidate.label, query));
}
