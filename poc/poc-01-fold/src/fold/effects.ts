/**
 * `Effect` — backend-v2.md §8.4. Tipo FECHADO. O `projector` aplica a lista NA ORDEM,
 * dentro de uma transacao por lote, e emite os `notify` DEPOIS do commit (§10.7).
 * O projetor nao decide nada.
 */
export type Primitive = string | number | null | Buffer;

/** Tabelas de `CS` (§10.3) alcancadas pelos 15 `kind`s do POC-01. */
export type CsTable =
  | 'communities'
  | 'members'
  | 'member_roles'
  | 'roles'
  | 'categories'
  | 'channels'
  | 'messages'
  | 'reactions'
  | 'bans'
  | 'invites'
  | 'moderation_log';

export type EntityKey = readonly Primitive[];

export type ModerationEntry = {
  id: string;
  seq: number;
  type: string;
  targetId: string | null;
  targetLabel: string | null;
  byKey: Buffer;
  byLabel: string;
  reason: string | null;
  at: number;
};

/**
 * §8.4 — escopo FECHADO das formas em lote. Nao e linguagem de consulta: sao exatamente
 * as duas formas que o v1 precisa, e o projetor traduz cada uma em UM `UPDATE ... WHERE`
 * sobre indice existente. Um predicado livre viraria linguagem de consulta dentro de
 * material deterministico, e duas implementacoes o avaliariam diferente.
 */
export type EffectScope =
  | { s: 'messagesOfAuthor'; authorKey: Buffer }
  | { s: 'messagesOfChannel'; channelId: string };

export type Effect =
  | { t: 'upsert'; table: CsTable; key: EntityKey; row: Record<string, Primitive> }
  | { t: 'patch'; table: CsTable; key: EntityKey; fields: Record<string, Primitive> }
  | { t: 'delete'; table: CsTable; key: EntityKey }
  // Formas em lote (§8.4, fecha HOLE-12): um efeito no lugar de N.
  | { t: 'patchScope'; scope: EffectScope; fields: Record<string, Primitive> }
  | { t: 'ftsRemoveScope'; scope: EffectScope }
  | { t: 'ftsIndex'; messageId: string; content: string }
  | { t: 'ftsRemove'; messageId: string }
  | { t: 'audit'; entry: ModerationEntry }
  | { t: 'recount'; what: 'memberCount' | 'roleMemberCount' | 'threadReplyCount'; key: EntityKey }
  | { t: 'notify'; topic: string; data: object };

/**
 * §6.13 — enum fechado e unico de `ModerationEntry.type` (20 valores, 1:1 com as linhas
 * `Aud. = sim` de §7.4). So os do escopo do POC-01 aparecem aqui.
 */
export const AUDIT = {
  ban: 'ban',
  deleteMessage: 'deleteMessage',
  createRole: 'createRole',
  updateRole: 'updateRole',
  deleteRole: 'deleteRole',
  createChannel: 'createChannel',
  updateChannel: 'updateChannel',
  deleteChannel: 'deleteChannel',
  createCategory: 'createCategory',
  deleteCategory: 'deleteCategory',
} as const;
