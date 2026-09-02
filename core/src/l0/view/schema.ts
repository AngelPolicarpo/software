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
  speech_mode INT NOT NULL DEFAULT 0, queue_turn_seconds INT,
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
-- blob.cancel/blob.reveal chegam com {blobsCoreKey, blobId} e SEM communityId (a tabela de
-- comandos de §15.4 é fechada): o resolver de anexos varre por essa dupla, e sem índice a
-- varredura é linear na tabela inteira.
CREATE INDEX IF NOT EXISTS idx_attachments_ref ON attachments(blobs_core_key, blob_id);

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

-- ─── §31.12 — a conversa direta ────────────────────────────────────────────────────────
--
-- Seis tabelas **irmãs** das de cima, não extensões delas (§31.0). A chave de escopo é
-- conversation_id, não community_id: uma conversa direta não tem comunidade, e por isso
-- nenhuma delas entra em CS_TABLES — o purgeCommunityData de §18.4 varre por
-- community_id e não alcança (nem deve alcançar) estas.
--
-- Sem FTS (§31.12): query.search (§23) tem contrato declarado com três grupos e uma
-- semântica de partial amarrada a replicação de comunidade; acrescentar uma quarta fonte é
-- decisão de produto. A conversa é paginável por ord_sum, e isso é o que o v1 entrega.

-- Snapshot do DmState (§31.12, §10.6). lo_length/hi_length são o que diz QUAIS
-- registros o blob já contém — é com eles que §31.13 decide se o prefixo do snapshot ainda
-- é prefixo da ordem canônica depois de uma inserção retroativa.
CREATE TABLE IF NOT EXISTS dm_ds_snapshot (
  conversation_id TEXT PRIMARY KEY, interpreted_ord_sum INT NOT NULL, lo_length INT NOT NULL,
  hi_length INT NOT NULL, blob BLOB NOT NULL, fold_build_id TEXT NOT NULL, taken_at INT NOT NULL);

CREATE TABLE IF NOT EXISTS dm_messages (
  conversation_id TEXT NOT NULL, id TEXT NOT NULL, ord_sum INT NOT NULL, author_key BLOB NOT NULL,
  author_seq INT NOT NULL, content TEXT, ts INT NOT NULL, clock_skewed INT NOT NULL,
  ack_ahead INT NOT NULL, edited_at INT, reply_to_id TEXT, deleted_at INT,
  PRIMARY KEY (conversation_id, id));
CREATE INDEX IF NOT EXISTS idx_dm_messages_ord ON dm_messages(conversation_id, ord_sum, author_key);
CREATE INDEX IF NOT EXISTS idx_dm_messages_author ON dm_messages(conversation_id, author_key);

CREATE TABLE IF NOT EXISTS dm_reactions (
  conversation_id TEXT NOT NULL, message_id TEXT NOT NULL, emoji TEXT NOT NULL,
  identity_key BLOB NOT NULL, ord_sum INT NOT NULL,
  PRIMARY KEY (conversation_id, message_id, emoji, identity_key));
CREATE INDEX IF NOT EXISTS idx_dm_reactions_message ON dm_reactions(conversation_id, message_id);

CREATE TABLE IF NOT EXISTS dm_attachments (
  conversation_id TEXT NOT NULL, message_id TEXT NOT NULL, owner_key BLOB NOT NULL,
  blobs_core_key BLOB NOT NULL, blob_id TEXT NOT NULL, name TEXT NOT NULL, size_bytes INT NOT NULL,
  kind INT NOT NULL, hash BLOB NOT NULL,
  PRIMARY KEY (conversation_id, message_id));
CREATE INDEX IF NOT EXISTS idx_dm_attachments_ref ON dm_attachments(blobs_core_key, blob_id);

-- length e invalid são estado de LADO (§31.7.2), não de registro: nenhum DmEffect os
-- carrega, e o dmProjector os materializa do DmState ao fim de cada lote. O DEFAULT 0
-- existe para que o upsert do dmFold — que traz só nome, cor e core — possa criar a linha.
CREATE TABLE IF NOT EXISTS dm_participants (
  conversation_id TEXT NOT NULL, identity_key BLOB NOT NULL, display_name TEXT NOT NULL,
  avatar_color INT NOT NULL, core_key BLOB, length INT NOT NULL DEFAULT 0,
  invalid INT NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, identity_key));

-- Diagnóstico (§31.12). Podado acima de REJECTED_LOG_MAX linhas por conversa. kind vem
-- do DmFoldResult e é NULL **exatamente** quando o cabeçalho não decodificou — o
-- dmProjector não decodifica registro (§4).
CREATE TABLE IF NOT EXISTS dm_rejected_records (
  conversation_id TEXT NOT NULL, origin TEXT NOT NULL, idx INT NOT NULL, kind INT,
  reason TEXT NOT NULL, PRIMARY KEY (conversation_id, origin, idx));

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

/**
 * Tabelas de conteúdo da conversa direta (§31.12), escopadas por `conversation_id`.
 *
 * **Não** entram em `CS_TABLES`: aquela lista é o que `purgeCommunityData` varre por
 * `community_id`, e uma conversa direta não tem comunidade (§31.0). Aqui elas existem para o
 * `DROP`/recria do bump de schema e para o dump de §28.4.
 */
export const DM_CONTENT_TABLES = [
  'dm_messages',
  'dm_reactions',
  'dm_attachments',
  'dm_participants',
] as const;

export type DmContentTableName = (typeof DM_CONTENT_TABLES)[number];

/** As seis tabelas `dm_*` de §31.12, snapshot e diagnóstico inclusos. */
export const DM_TABLES = [...DM_CONTENT_TABLES, 'dm_rejected_records', 'dm_ds_snapshot'] as const;

/**
 * Colunas de chave primária das tabelas `dm_*`, **depois** de `conversation_id` (§31.12) —
 * o análogo exato de `KEY_COLS`. O `DmEffect` de §31.7.6 carrega a chave sem
 * `conversation_id`, porque quem projeta já sabe a conversa.
 */
export const DM_KEY_COLS: Record<DmContentTableName, readonly string[]> = {
  dm_messages: ['id'],
  dm_reactions: ['message_id', 'emoji', 'identity_key'],
  dm_attachments: ['message_id'],
  dm_participants: ['identity_key'],
};

/** Todas as tabelas de `view.db` — para o `DROP`/recria da reprojeção total (§10.5). */
export const ALL_TABLES = [
  ...CS_TABLES,
  'messages_fts',
  'rejected_records',
  'ds_snapshot',
  ...DM_TABLES,
  'meta',
] as const;

// As seis chaves de `meta` — a lista fechada de §10.3.1. As duas por comunidade carregam o
// `communityId` no nome porque um `view.db` serve todas as comunidades (§10.1); as duas por
// conversa carregam o `conversationId` pela mesma razão (§31.12). Quem escreve é sempre o
// projetor da vez — `projector` ou `dmProjector` —, único escritor de `view.db` (§21.1).

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

/**
 * `dm_interpreted:<conversationId>` — `{ordSum, loLength, hiLength}` do último lote
 * commitado (§10.3.1, §31.12). Ao contrário de `interpreted_seq`, o valor é um objeto: a
 * conversa é um par de logs, e só o `ordSum` não diz **quais** registros já foram
 * interpretados — é `loLength`/`hiLength` que dizem.
 */
export const META_DM_INTERPRETED = 'dm_interpreted';
/** `dm_fold_panic:<conversationId>` — `ordSum` do registro que fez o `dmFold` lançar (§31.7.1). */
export const META_DM_FOLD_PANIC = 'dm_fold_panic';

/** As chaves de `meta` que **não** são por comunidade (§10.3.1). */
export const META_GLOBAL_KEYS = [META_VIEW_SCHEMA_VERSION, META_OP_VERSION] as const;
/** Os prefixos de chave de `meta` que são por comunidade (§10.3.1). */
export const META_PER_COMMUNITY_PREFIXES = [META_FOLD_PANIC, META_INTERPRETED_SEQ] as const;
/** Os prefixos de chave de `meta` que são por conversa direta (§10.3.1, §31.12). */
export const META_PER_CONVERSATION_PREFIXES = [META_DM_INTERPRETED, META_DM_FOLD_PANIC] as const;
