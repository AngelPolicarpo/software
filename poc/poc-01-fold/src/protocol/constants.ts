/**
 * Constantes de protocolo — backend-v2.md §27.1.
 *
 * REGRA (§1.5, §27.1): fazem parte de `opVersion`. Sao FIXAS NO BINARIO. Nao sao
 * configuraveis por env, arquivo ou flag. Mudar qualquer uma exige bump de `opVersion`.
 * Toda entrada do `fold` sai daqui.
 *
 * O modulo nao importa nada e nao le `process.env`. `assertNoEnvReads()` prova isso em
 * runtime instrumentando `process.env` durante a carga do `fold` (ver scripts/run-fuzz.ts).
 */

export const OP_VERSION = 1;

// --- tempo -------------------------------------------------------------------------
export const CLOCK_ACCEPT_MS = 86_400_000; // 24 h
export const CLOCK_SKEW_MS = 60_000;

// --- anexos ------------------------------------------------------------------------
export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024 * 1024; // 8 GiB
export const ATTACHMENT_QUOTA_PER_MEMBER = 5 * 1024 * 1024 * 1024; // 5 GiB

// --- cotas deterministicas (R-15) --------------------------------------------------
export const QUOTA_WINDOW_SEQS = 10_000;
export const QUOTA_OPS_PER_WINDOW = 2_000;
export const QUOTA_BYTES_PER_WINDOW = 64 * 1024 * 1024; // 64 MiB

// --- tetos de envelope (§26.2: 32 KiB, 64 KiB com anexo) ---------------------------
export const MAX_ENVELOPE_BYTES = 32 * 1024;
export const MAX_ENVELOPE_BYTES_WITH_ATTACHMENT = 64 * 1024;

// --- cardinalidade (§26.2) ---------------------------------------------------------
export const MAX_CHANNELS = 500;
export const MAX_CATEGORIES = 50;
export const MAX_ROLES = 100;
export const MAX_ROLES_PER_MEMBER = 24;
export const MAX_ACTIVE_INVITES = 50;
export const MAX_REACTION_EMOJIS = 20;
export const MAX_MENTIONS = 64;
export const MAX_ATTACHMENTS_PER_MESSAGE = 1;
export const MAX_LINKS_PER_MESSAGE = 8;
export const MAX_SUCCESSORS = 5;

// --- midia (fora do escopo do fold, listadas para paridade com §27.1) --------------
export const SHARE_MAX_VIEWERS = 8;
export const MAX_CAMERAS = 6;
export const MAX_VOICE_PARTICIPANTS = 24;

// --- convite / rede ----------------------------------------------------------------
export const INVITE_SECRET_BYTES = 10;
export const HOST_INACTIVITY_MS = 30 * 86_400_000; // 30 d
export const RELAY_TTL_MS = 24 * 3_600_000; // 24 h
export const MEDIA_TICKET_TTL_MS = 5 * 60_000;

// --- limites de campo (§8.6) -------------------------------------------------------
export const LIMIT = {
  displayName: { min: 2, max: 32 },
  communityName: { min: 2, max: 40 },
  communityDescription: { min: 0, max: 120 },
  categoryName: { min: 1, max: 32 },
  channelName: { min: 1, max: 32 },
  channelTopic: { min: 0, max: 120 },
  roleName: { min: 1, max: 32 },
  nickname: { min: 1, max: 32 },
  messageContentGraphemes: { min: 1, max: 4000 },
  messageContentBytes: { max: 16384 },
  mentions: { min: 0, max: 64 },
  reactionEmojiGraphemes: { min: 1, max: 1 },
  reactionEmojiBytes: { max: 24 },
  moderationReason: { min: 0, max: 200 },
  attachmentName: { minBytes: 1, maxBytes: 255 },
  inviteMaxUses: { min: 1, max: 10_000 },
  inviteLabelGraphemes: { min: 0, max: 40 },
  timeoutMinMs: 60_000,
  timeoutMaxMs: 30 * 86_400_000,
  inviteExpiryMinMs: 60_000,
  inviteExpiryMaxMs: 365 * 86_400_000,
  successorKeys: { min: 0, max: 5 },
} as const;

/** §7.2 regra 5 / R-27: os seis registros do lote de genese. */
export const GENESIS_LENGTH = 6;

/** Numero de registros do lote de genese em que o estagio 8 e o 11 nao se aplicam. */
export const GENESIS_LAST_SEQ = GENESIS_LENGTH - 1;

Object.freeze(LIMIT);
