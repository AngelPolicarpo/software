// `Effect` — §8.4. Tipo **fechado**.
//
// O `fold` emite `Effect[]`; o `projector` aplica a lista **na ordem**, dentro de uma
// transação por lote, e emite os `notify` **depois do commit** (§10.7). O projetor não
// decide nada — é o que fecha `DR-27` ("o delta agregado do projetor não tem forma").

export type Primitive = string | number | null | Buffer;

/** As tabelas de Estado de Conteúdo de §10.3 alcançadas pelos 38 `kind`s de §7.4. */
export type CsTable =
  | 'communities'
  | 'members'
  | 'member_roles'
  | 'roles'
  | 'categories'
  | 'channels'
  | 'messages'
  | 'message_links'
  | 'attachments'
  | 'reactions'
  | 'threads'
  | 'invites'
  | 'bans'
  | 'timeouts'
  | 'moderation_log'
  | 'relay_volunteers';

/** Chave primária da linha, **sem** `community_id`: quem projeta já sabe a comunidade. */
export type EntityKey = readonly Primitive[];

/**
 * §6.13 — o enum é fechado e **único** (fecha `RT-07`): há exatamente um valor para cada
 * linha marcada `Aud. = sim` em §7.4, e a correspondência 1:1 é verificável por teste.
 */
export const AUDIT_TYPES = [
  'kick',
  'ban',
  'revokeBan',
  'timeout',
  'removeTimeout',
  'deleteMessage',
  'createRole',
  'updateRole',
  'deleteRole',
  'createChannel',
  'updateChannel',
  'deleteChannel',
  'createCategory',
  'renameCategory',
  'deleteCategory',
  'updateCommunity',
  'endCommunity',
  'assumeHost',
  'setSuccessors',
  'revokeInvite',
] as const;

export type AuditType = (typeof AUDIT_TYPES)[number];

export const AUDIT = Object.fromEntries(AUDIT_TYPES.map((t) => [t, t])) as {
  readonly [T in AuditType]: T;
};

/** §6.13 — `targetLabel` e `byLabel` são **congelados no momento da aplicação**. */
export type ModerationEntry = {
  readonly id: string;
  readonly seq: number;
  readonly type: AuditType;
  readonly targetId: string | null;
  readonly targetLabel: string | null;
  readonly byKey: Buffer;
  readonly byLabel: string;
  readonly reason: string | null;
  readonly at: number;
};

/**
 * §8.4 — escopo **fechado** das formas em lote (fecha `HOLE-12`). Não é linguagem de
 * consulta: são exatamente as duas formas que o v1 precisa, e o `projector` traduz cada uma
 * em **um** `UPDATE ... WHERE` sobre índice existente.
 *
 * Um predicado livre viraria linguagem de consulta dentro de material determinístico, e duas
 * implementações o avaliariam diferente. Acrescentar uma terceira forma é mudança de
 * contrato, com bump de `view_schema_version`.
 */
export type EffectScope =
  | { readonly s: 'messagesOfAuthor'; readonly authorKey: Buffer }
  | { readonly s: 'messagesOfChannel'; readonly channelId: string };

/** Tópico de §15.5. O `fold` só produz os que decorrem de um registro do log. */
export type EventTopic =
  | 'community.changed'
  | 'community.ended'
  | 'structure.changed'
  | 'roles.changed'
  | 'members.changed'
  | 'messages.appended'
  | 'message.updated'
  | 'invites.changed'
  | 'auditLog.changed';

export type Effect =
  | {
      readonly t: 'upsert';
      readonly table: CsTable;
      readonly key: EntityKey;
      readonly row: Readonly<Record<string, Primitive>>;
    }
  | {
      readonly t: 'patch';
      readonly table: CsTable;
      readonly key: EntityKey;
      readonly fields: Readonly<Record<string, Primitive>>;
    }
  | { readonly t: 'delete'; readonly table: CsTable; readonly key: EntityKey }
  // Formas em lote — escopo fechado (fecha `HOLE-12`)
  | {
      readonly t: 'patchScope';
      readonly scope: EffectScope;
      readonly fields: Readonly<Record<string, Primitive>>;
    }
  | { readonly t: 'ftsRemoveScope'; readonly scope: EffectScope }
  /**
   * §8.4 — a forma inversa de `ftsRemoveScope`. O `fold` **não** carrega o `content` (§8.1 só
   * guarda metadado de decisão), então quem reindexa é o projector, a partir de
   * `messages.content` que ele mesmo materializou. Sem ela, um ban revogado devolve as
   * mensagens às listagens e **nunca** à busca — §18.2 promete reversibilidade sem ressalva.
   */
  | { readonly t: 'ftsIndexScope'; readonly scope: EffectScope }
  | { readonly t: 'ftsIndex'; readonly messageId: string; readonly content: string }
  | { readonly t: 'ftsRemove'; readonly messageId: string }
  | { readonly t: 'audit'; readonly entry: ModerationEntry }
  | {
      readonly t: 'recount';
      readonly what: 'memberCount' | 'roleMemberCount' | 'threadReplyCount';
      readonly key: EntityKey;
    }
  | { readonly t: 'notify'; readonly topic: EventTopic; readonly data: object };
