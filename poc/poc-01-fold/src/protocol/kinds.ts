/**
 * Catalogo de `kind` — backend-v2.md §7.4. `kind` e um uint16 de enum fechado.
 * Total normativo: 38 para `opVersion = 1`.
 *
 * ESCOPO DO POC-01: 15 dos 38 (genese + as oito corridas de §21.1). Os demais 23
 * existem aqui apenas como numero reservado: NAO estao no registry de payload, portanto
 * §7.2 regra 4 / §8.2 estagio 2 os trata como `IGNORED` (`E_UNKNOWN_KIND`), que e
 * exatamente o comportamento normativo para um `kind` sem layout implementado
 * ("Regra que fecha DR-10", §7.2.1).
 */
export const K = {
  MESSAGE_SEND: 1,
  MESSAGE_EDIT: 2,
  MESSAGE_DELETE: 3,
  MESSAGE_PIN: 4,
  REACTION_SET: 5,
  THREAD_CREATE: 6,

  CHANNEL_CREATE: 10,
  CHANNEL_UPDATE: 11,
  CHANNEL_MOVE: 12,
  CHANNEL_DELETE: 13,
  CATEGORY_CREATE: 14,
  CATEGORY_RENAME: 15,
  CATEGORY_DELETE: 16,

  ROLE_CREATE: 20,
  ROLE_UPDATE: 21,
  ROLE_MOVE: 22,
  ROLE_DELETE: 23,
  MEMBER_SET_ROLES: 24,
  MEMBER_JOIN: 25,
  MEMBER_LEAVE: 26,
  MEMBER_SET_NICKNAME: 27,
  MEMBER_SET_BLOBS_CORE: 28,
  IDENTITY_UPDATE: 29,

  MOD_KICK: 30,
  MOD_BAN: 31,
  MOD_REVOKE_BAN: 32,
  MOD_TIMEOUT: 33,
  MOD_REMOVE_TIMEOUT: 34,

  COMMUNITY_CREATE: 40,
  COMMUNITY_UPDATE: 41,
  COMMUNITY_END: 42,
  COMMUNITY_SET_SUCCESSORS: 43,
  COMMUNITY_ESCROW: 44,
  COMMUNITY_ASSUME_HOST: 45,

  INVITE_CREATE: 50,
  INVITE_REVOKE: 51,

  RELAY_VOLUNTEER: 60,
  RELAY_WITHDRAW: 61,
} as const;

export type Kind = (typeof K)[keyof typeof K];

/**
 * Os `kind`s implementados neste harness: os 15 do escopo do POC-01 mais
 * `invite.create` (SCOPE-DELTA-01, ver REPORT.md) — sem ele nao existe caminho
 * normativo para os "dez clientes" que a linha "Construir" do POC-01 exige.
 */
export const IMPLEMENTED_KINDS: readonly number[] = [
  K.MESSAGE_SEND,
  K.MESSAGE_DELETE,
  K.REACTION_SET,
  K.CHANNEL_CREATE,
  K.CHANNEL_UPDATE,
  K.CHANNEL_DELETE,
  K.CATEGORY_CREATE,
  K.CATEGORY_DELETE,
  K.ROLE_CREATE,
  K.ROLE_UPDATE,
  K.ROLE_DELETE,
  K.MEMBER_SET_ROLES,
  K.MEMBER_JOIN,
  K.MOD_BAN,
  K.COMMUNITY_CREATE,
  K.INVITE_CREATE,
];

/** Os 38 numeros normativos, para o teste de superficie de `kind` desconhecido. */
export const ALL_KINDS: readonly number[] = Object.values(K);

export const KIND_NAME = new Map<number, string>(
  Object.entries(K).map(([name, n]) => [n as number, name.toLowerCase()]),
);
