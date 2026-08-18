// `view.db` — schema de §10.3, transcrito literalmente.
//
// **Totalmente derivado.** Apagar e reprojetar reconstrói byte a byte. Toda PK inclui
// `community_id` — a regra estrutural de §10.1 ("presente em **toda** chave primária") vence a
// notação solta da linha de `communities` ("`id TEXT PK`"), e é ela que o §10.1 diz existir
// para impedir vazamento entre comunidades.
//
// Este arquivo é só forma de armazenamento: nenhuma regra de domínio mora aqui (§4 — `view`
// não pode conter regra de domínio). Quem traduz `Effect` em SQL é o `projector` (§8.4).

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS communities (
  community_id TEXT NOT NULL, id TEXT NOT NULL, core_key BLOB NOT NULL, blobs_key BLOB NOT NULL,
  host_key BLOB NOT NULL, founder_key BLOB NOT NULL, name TEXT NOT NULL, icon_emoji TEXT,
  icon_color TEXT NOT NULL, description TEXT, created_at INT NOT NULL,
  member_count INT NOT NULL DEFAULT 0, ended_at INT, origin_community_id TEXT,
  successor_keys TEXT,
  PRIMARY KEY (community_id, id));

CREATE TABLE IF NOT EXISTS members (
  community_id TEXT NOT NULL, identity_key BLOB NOT NULL, display_name TEXT NOT NULL,
  avatar_color TEXT NOT NULL, nickname TEXT, blobs_core_key BLOB, joined_at INT NOT NULL,
  left_at INT, banned INT NOT NULL DEFAULT 0, timeout_until INT,
  storage_used_bytes INT NOT NULL DEFAULT 0, display_name_collision INT NOT NULL DEFAULT 0,
  PRIMARY KEY (community_id, identity_key));
CREATE INDEX IF NOT EXISTS idx_members_active ON members(community_id, left_at, banned);

CREATE TABLE IF NOT EXISTS member_roles (
  community_id TEXT NOT NULL, identity_key BLOB NOT NULL, role_id TEXT NOT NULL,
  PRIMARY KEY (community_id, identity_key, role_id));
CREATE INDEX IF NOT EXISTS idx_member_roles_role ON member_roles(community_id, role_id);

CREATE TABLE IF NOT EXISTS roles (
  community_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, color INT NOT NULL,
  rank TEXT NOT NULL, permissions TEXT NOT NULL, mentionable INT NOT NULL,
  is_founder INT NOT NULL, is_default INT NOT NULL, member_count INT NOT NULL DEFAULT 0,
  deleted_at INT, PRIMARY KEY (community_id, id));
CREATE INDEX IF NOT EXISTS idx_roles_rank ON roles(community_id, rank DESC);

CREATE TABLE IF NOT EXISTS categories (
  community_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, rank TEXT NOT NULL,
  deleted_at INT, PRIMARY KEY (community_id, id));
CREATE INDEX IF NOT EXISTS idx_categories_rank ON categories(community_id, rank);

CREATE TABLE IF NOT EXISTS channels (
  community_id TEXT NOT NULL, id TEXT NOT NULL, category_id TEXT NOT NULL, type INT NOT NULL,
  name TEXT NOT NULL, topic TEXT, rank TEXT NOT NULL, read_only_role_ids TEXT NOT NULL,
  deleted_at INT, PRIMARY KEY (community_id, id));
CREATE UNIQUE INDEX IF NOT EXISTS uniq_channels_name
  ON channels(community_id, type, name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_channels_cat ON channels(community_id, category_id, rank);

-- Índice derivado de operações aceitas, usado pela reconciliação da outbox (§11.6).
CREATE TABLE IF NOT EXISTS observed_ops (
  community_id TEXT NOT NULL, op_id TEXT NOT NULL, seq INT NOT NULL,
  author_key BLOB NOT NULL, sequence_scope TEXT NOT NULL, author_seq INT NOT NULL,
  PRIMARY KEY (community_id, op_id));
CREATE INDEX IF NOT EXISTS idx_observed_ops_seq ON observed_ops(community_id, seq);

CREATE TABLE IF NOT EXISTS messages (
  community_id TEXT NOT NULL, id TEXT NOT NULL, seq INT NOT NULL, channel_id TEXT NOT NULL,
  author_key BLOB NOT NULL, content TEXT, author_ts INT NOT NULL, host_ts INT NOT NULL,
  clock_skewed INT NOT NULL, edited_at INT, pinned INT NOT NULL DEFAULT 0, reply_to_id TEXT,
  thread_id TEXT, mentions TEXT, mention_everyone_effective INT NOT NULL DEFAULT 0,
  deleted_at INT, hidden_by_ban INT NOT NULL DEFAULT 0, orphaned INT NOT NULL DEFAULT 0,
  PRIMARY KEY (community_id, id));
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(community_id, channel_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(community_id, author_key);
CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(community_id, channel_id) WHERE pinned=1;
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(community_id, thread_id, seq);

-- §10.3: FTS5 **contentless-delete** (content=''), rowid = messages.rowid.
-- Sem triggers: o projector emite ftsIndex/ftsRemove explicitamente, na mesma transação.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content, content='', tokenize='unicode61 remove_diacritics 2', prefix='2 3');

CREATE TABLE IF NOT EXISTS message_links (
  community_id TEXT NOT NULL, message_id TEXT NOT NULL, idx INT NOT NULL, url TEXT NOT NULL,
  host TEXT NOT NULL, seq INT NOT NULL,
  PRIMARY KEY (community_id, message_id, idx));
CREATE INDEX IF NOT EXISTS idx_links_channel ON message_links(community_id, message_id);

CREATE TABLE IF NOT EXISTS attachments (
  community_id TEXT NOT NULL, message_id TEXT NOT NULL, owner_key BLOB NOT NULL,
  blobs_core_key BLOB NOT NULL, blob_id TEXT NOT NULL, name TEXT NOT NULL, size_bytes INT NOT NULL,
  kind INT NOT NULL, hash BLOB NOT NULL,
  PRIMARY KEY (community_id, message_id));
CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(community_id, owner_key);

CREATE TABLE IF NOT EXISTS reactions (
  community_id TEXT NOT NULL, message_id TEXT NOT NULL, emoji TEXT NOT NULL,
  identity_key BLOB NOT NULL, at INT NOT NULL,
  PRIMARY KEY (community_id, message_id, emoji, identity_key));
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(community_id, message_id);

CREATE TABLE IF NOT EXISTS threads (
  community_id TEXT NOT NULL, id TEXT NOT NULL, root_message_id TEXT NOT NULL,
  channel_id TEXT NOT NULL, reply_count INT NOT NULL, root_deleted INT NOT NULL,
  PRIMARY KEY (community_id, id),
  UNIQUE (community_id, root_message_id));

CREATE TABLE IF NOT EXISTS invites (
  community_id TEXT NOT NULL, invite_public_key BLOB NOT NULL, created_by BLOB NOT NULL,
  created_at INT NOT NULL, expires_at INT, max_uses INT, uses INT NOT NULL DEFAULT 0,
  revoked_at INT, label TEXT, PRIMARY KEY (community_id, invite_public_key));
CREATE INDEX IF NOT EXISTS idx_invites_community ON invites(community_id, revoked_at);

CREATE TABLE IF NOT EXISTS bans (
  community_id TEXT NOT NULL, target_key BLOB NOT NULL, by_key BLOB NOT NULL, at INT NOT NULL,
  reason TEXT, revoked_at INT, PRIMARY KEY (community_id, target_key));

CREATE TABLE IF NOT EXISTS timeouts (
  community_id TEXT NOT NULL, target_key BLOB NOT NULL, by_key BLOB NOT NULL, at INT NOT NULL,
  until INT NOT NULL, reason TEXT, PRIMARY KEY (community_id, target_key));
CREATE INDEX IF NOT EXISTS idx_timeouts_until ON timeouts(community_id, until);

CREATE TABLE IF NOT EXISTS moderation_log (
  community_id TEXT NOT NULL, id TEXT NOT NULL, seq INT NOT NULL, type TEXT NOT NULL,
  target_id TEXT, target_label TEXT, by_key BLOB NOT NULL, by_label TEXT NOT NULL,
  reason TEXT, at INT NOT NULL, PRIMARY KEY (community_id, id));
CREATE INDEX IF NOT EXISTS idx_modlog ON moderation_log(community_id, seq DESC);
CREATE INDEX IF NOT EXISTS idx_modlog_type ON moderation_log(community_id, type, seq DESC);

CREATE TABLE IF NOT EXISTS relay_volunteers (
  community_id TEXT NOT NULL, identity_key BLOB NOT NULL, relay_public_key BLOB NOT NULL,
  since INT NOT NULL, expires_at INT NOT NULL, withdrawn_at INT,
  PRIMARY KEY (community_id, identity_key));

-- Diagnóstico (§10.3). Podado acima de REJECTED_LOG_MAX linhas por comunidade.
-- kind/author_key vêm do FoldResult (§8.0) e são anuláveis porque há um caso, e um só, em
-- que não existem: a recusa do estágio 0, antes de qualquer decode.
CREATE TABLE IF NOT EXISTS rejected_records (
  community_id TEXT NOT NULL, seq INT NOT NULL, kind INT, author_key BLOB,
  reason TEXT NOT NULL, PRIMARY KEY (community_id, seq));

-- Snapshot do DecisionState (§10.6). fold_build_id é NOT NULL porque um snapshot sem
-- procedência é um snapshot inválido: quem não sabe qual fold produziu o estado não pode
-- herdá-lo (§10.3, §10.6).
CREATE TABLE IF NOT EXISTS ds_snapshot (
  community_id TEXT PRIMARY KEY, interpreted_seq INT NOT NULL, blob BLOB NOT NULL,
  fold_build_id TEXT NOT NULL, taken_at INT NOT NULL);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/** Tabelas de Estado de Conteúdo de §10.3, na ordem canônica do dump de §28.4. */
export const CS_TABLES = [
  'communities',
  'members',
  'member_roles',
  'roles',
  'categories',
  'channels',
  'observed_ops',
  'messages',
  'message_links',
  'attachments',
  'reactions',
  'threads',
  'invites',
  'bans',
  'timeouts',
  'moderation_log',
  'relay_volunteers',
] as const;

export type CsTableName = (typeof CS_TABLES)[number];

/**
 * Colunas de chave primária por tabela, **depois** de `community_id` (§10.3). O `Effect` de
 * §8.4 carrega a chave sem `community_id` — quem projeta já sabe a comunidade —, e esta
 * tabela é o que o projector usa para montar o `WHERE`.
 */
export const KEY_COLS: Record<CsTableName, readonly string[]> = {
  communities: ['id'],
  members: ['identity_key'],
  member_roles: ['identity_key', 'role_id'],
  roles: ['id'],
  categories: ['id'],
  channels: ['id'],
  observed_ops: ['op_id'],
  messages: ['id'],
  message_links: ['message_id', 'idx'],
  attachments: ['message_id'],
  reactions: ['message_id', 'emoji', 'identity_key'],
  threads: ['id'],
  invites: ['invite_public_key'],
  bans: ['target_key'],
  timeouts: ['target_key'],
  moderation_log: ['id'],
  relay_volunteers: ['identity_key'],
};

/** Todas as tabelas de `view.db` — para o `DROP`/recria da reprojeção total (§10.5). */
export const ALL_TABLES = [...CS_TABLES, 'messages_fts', 'rejected_records', 'ds_snapshot', 'meta'] as const;

// As quatro chaves de `meta` — a lista fechada de §10.3.1. As duas por comunidade carregam o
// `communityId` no nome porque um `view.db` serve todas as comunidades (§10.1). Quem escreve
// é sempre o `projector`, único escritor de `view.db` (§21.1).

/** `fold_panic:<communityId>` — `seq` do pânico (§8.5, §10.5: reprojeção no boot seguinte). */
export const META_FOLD_PANIC = 'fold_panic';
/** `interpreted_seq:<communityId>` — `interpretedSeq` do último lote commitado (§10.6). */
export const META_INTERPRETED_SEQ = 'interpreted_seq';
/** `view_schema_version` — a versão de schema do binário (§10.3, §10.5). */
export const META_VIEW_SCHEMA_VERSION = 'view_schema_version';
/**
 * `op_version` — a versão de protocolo que materializou esta `view.db` (§7.2). Escrita pelo
 * `projector`: a constante mora em `opCodec` (L1) e `view` é L0 (§10.3.1, §4).
 */
export const META_OP_VERSION = 'op_version';

/** As chaves de `meta` que **não** são por comunidade (§10.3.1). */
export const META_GLOBAL_KEYS = [META_VIEW_SCHEMA_VERSION, META_OP_VERSION] as const;
/** Os prefixos de chave de `meta` que são por comunidade (§10.3.1). */
export const META_PER_COMMUNITY_PREFIXES = [META_FOLD_PANIC, META_INTERPRETED_SEQ] as const;
