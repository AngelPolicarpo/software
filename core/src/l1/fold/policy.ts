// Matriz de enforcement por `kind` — §9.4, consolidada das colunas `Perm.`, `Hier.`, `Aud.`
// e `Fila` de §7.4.
//
// §9.4: *"O `fold` lê **dessa tabela**, declarativamente. Um `kind` sem linha na tabela falha
// fechado com `E_UNKNOWN_KIND`."* Esta é a tabela — transcrição, não interpretação. O tipo
// `satisfies Record<KindName, …>` garante que os 38 `kind`s de §7.4 tenham linha: acrescentar
// um `kind` sem política aqui não compila.

import { KINDS, type KindName } from '../opCodec/index.ts';
import type { Permission } from '../permissions/index.ts';
import type { AuditType } from './effects.ts';

/**
 * Coluna `Perm.` de §7.4. Cada forma corresponde a uma redação distinta da coluna, e o
 * estágio 11 as trata separadamente porque **os códigos de recusa são diferentes**.
 */
export type PermRule =
  /** `—` — nenhuma permissão. Inclui "só o próprio", que o payload já garante por não ter alvo. */
  | { readonly r: 'none' }
  /** Uma permissão do catálogo de §9.1. */
  | { readonly r: 'perm'; readonly perm: Permission }
  /** `send_messages` (+`attach_files` se anexo) — `message.send`. */
  | { readonly r: 'permPlusAttachment'; readonly perm: Permission; readonly comAnexo: Permission }
  /** `própria | manage_messages` — `message.delete`. */
  | { readonly r: 'ownOrPerm'; readonly perm: Permission }
  /** `autor do convite | manage_community` — `invite.revoke`. */
  | { readonly r: 'inviteOwnerOrPerm'; readonly perm: Permission }
  /** `host` — R-17, e o código é `E_NOT_HOST`, não `E_PERMISSION_DENIED`. */
  | { readonly r: 'host' }
  /** `sucessor (§18.8)` — R-18, verificado como regra estrutural no estágio 14. */
  | { readonly r: 'successor' };

export type KindPolicy = {
  /** Coluna `Perm.` */
  readonly perm: PermRule;
  /**
   * Coluna `Hier.` — comparação de `rank` sobre o alvo no estágio 12. As **imunidades** de
   * §9.3 (passos 1 e 2) não dependem desta coluna: R-16 fala de `mod.*` inteiro, e o passo 1
   * fala do cargo Fundador. O que a coluna liga é o passo 3, a comparação de `rank`.
   */
  readonly hier: boolean;
  /** Coluna `Aud.` — `null` quando `—`. R-27(d): não vale nos `seq` 0..5. */
  readonly audit: AuditType | null;
  /** Coluna `Fila` — §11.1. O `fold` não usa; a `outbox` (L2) usa, e a fonte é esta. */
  readonly fila: boolean;
};

const P = (perm: Permission): PermRule => ({ r: 'perm', perm });
const NENHUMA: PermRule = { r: 'none' };

export const KIND_POLICY = {
  // ── §7.4.1 Mensagem — domínio enfileirável ────────────────────────────────────────────
  'message.send': {
    perm: { r: 'permPlusAttachment', perm: 'send_messages', comAnexo: 'attach_files' },
    hier: false,
    audit: null,
    fila: true,
  },
  // "própria": não é permissão, é R de estrutura — `E_CANNOT_EDIT_OTHERS` no estágio 14 (§6.7).
  'message.edit': { perm: NENHUMA, hier: false, audit: null, fila: true },
  'message.delete': {
    perm: { r: 'ownOrPerm', perm: 'manage_messages' },
    hier: true,
    audit: 'deleteMessage',
    fila: true,
  },
  'message.pin': { perm: P('pin_messages'), hier: false, audit: null, fila: true },
  'reaction.set': { perm: P('add_reactions'), hier: false, audit: null, fila: true },
  'thread.create': { perm: P('send_messages'), hier: false, audit: null, fila: true },

  // ── §7.4.2 Estrutura — síncrona ───────────────────────────────────────────────────────
  'channel.create': { perm: P('manage_channels'), hier: false, audit: 'createChannel', fila: false },
  'channel.update': { perm: P('manage_channels'), hier: false, audit: 'updateChannel', fila: false },
  'channel.move': { perm: P('manage_channels'), hier: false, audit: null, fila: false },
  'channel.delete': { perm: P('manage_channels'), hier: false, audit: 'deleteChannel', fila: false },
  'category.create': { perm: P('manage_channels'), hier: false, audit: 'createCategory', fila: false },
  'category.rename': { perm: P('manage_channels'), hier: false, audit: 'renameCategory', fila: false },
  'category.delete': { perm: P('manage_channels'), hier: false, audit: 'deleteCategory', fila: false },

  // ── §7.4.3 Cargos e membros — síncrona ────────────────────────────────────────────────
  'role.create': { perm: P('manage_roles'), hier: false, audit: 'createRole', fila: false },
  'role.update': { perm: P('manage_roles'), hier: true, audit: 'updateRole', fila: false },
  'role.move': { perm: P('manage_roles'), hier: true, audit: null, fila: false },
  'role.delete': { perm: P('manage_roles'), hier: true, audit: 'deleteRole', fila: false },
  'member.setRoles': { perm: P('manage_roles'), hier: true, audit: null, fila: false },
  // "— (autorizado pelo convite)": R-9 é quem autoriza, no estágio 14.
  'member.join': { perm: NENHUMA, hier: false, audit: null, fila: false },
  'member.leave': { perm: NENHUMA, hier: false, audit: null, fila: false },
  'member.setNickname': { perm: NENHUMA, hier: false, audit: null, fila: false },
  'member.setBlobsCore': { perm: NENHUMA, hier: false, audit: null, fila: false },
  'identity.update': { perm: NENHUMA, hier: false, audit: null, fila: false },

  // ── §7.4.4 Moderação — síncrona ───────────────────────────────────────────────────────
  'mod.kick': { perm: P('kick_members'), hier: true, audit: 'kick', fila: false },
  'mod.ban': { perm: P('ban_members'), hier: true, audit: 'ban', fila: false },
  'mod.revokeBan': { perm: P('ban_members'), hier: false, audit: 'revokeBan', fila: false },
  'mod.timeout': { perm: P('timeout_members'), hier: true, audit: 'timeout', fila: false },
  'mod.removeTimeout': { perm: P('timeout_members'), hier: false, audit: 'removeTimeout', fila: false },

  // ── §7.4.5 Comunidade, convite, rede — síncrona ───────────────────────────────────────
  // "— (gênese)": a autorização de `community.create` é R-27 inteira, não uma permissão.
  'community.create': { perm: NENHUMA, hier: false, audit: null, fila: false },
  'community.update': { perm: P('manage_community'), hier: false, audit: 'updateCommunity', fila: false },
  'community.end': { perm: { r: 'host' }, hier: false, audit: 'endCommunity', fila: false },
  'community.setSuccessors': { perm: { r: 'host' }, hier: false, audit: 'setSuccessors', fila: false },
  'community.escrow': { perm: { r: 'host' }, hier: false, audit: null, fila: false },
  'community.assumeHost': { perm: { r: 'successor' }, hier: false, audit: 'assumeHost', fila: false },
  'invite.create': { perm: P('create_invite'), hier: false, audit: null, fila: false },
  'invite.revoke': {
    perm: { r: 'inviteOwnerOrPerm', perm: 'manage_community' },
    hier: false,
    audit: 'revokeInvite',
    fila: false,
  },
  'relay.volunteer': { perm: NENHUMA, hier: false, audit: null, fila: false },
  'relay.withdraw': { perm: NENHUMA, hier: false, audit: null, fila: false },
} as const satisfies Record<KindName, KindPolicy>;

const POR_NUMERO = new Map<number, KindPolicy>(
  (Object.keys(KIND_POLICY) as KindName[]).map((n) => [KINDS[n], KIND_POLICY[n]]),
);

/** §9.4 — falha fechado: `kind` sem linha não tem política, e o estágio 11 recusa. */
export function policyOf(kind: number): KindPolicy | undefined {
  return POR_NUMERO.get(kind);
}
