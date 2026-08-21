// Constantes de protocolo aplicadas pelo `fold` — §27.1, §26.2, §8.6, §6.4.2, §6.6.
//
// §1.5 e §27.1: **nada aqui é configurável**. Se um número decide se uma op tem efeito, ele
// é constante de protocolo; se decide como esta instalação usa recursos locais, é §27.2 e
// mora em `config` (L0), que §4 proíbe de expor qualquer valor ao `fold`.
//
// §27.1 diz que as constantes "ficam num módulo `protocol/constants.ts`". §4 não tem módulo
// `protocol`, e a fronteira de camadas é por diretório de módulo da tabela de §4 — então
// cada constante mora no módulo de §4 que a aplica: as de `rank` em `permissions` (que
// ordena) e estas no `fold` (que decide). Uma constante nunca é transcrita duas vezes.

const KiB = 1024;
const MiB = 1024 * KiB;
const GiB = 1024 * MiB;
const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

// ─── Relógio (§27.1, R-2, §6.7) ─────────────────────────────────────────────────────────

/** Estágio 7 / R-2: `|op.ts − hostTsEfetivo|` acima disto é `E_CLOCK_UNREASONABLE`. */
export const CLOCK_ACCEPT_MS = 24 * HORA;

/** §6.7: acima disto a mensagem é marcada `clockSkewed`. Não recusa nada. */
export const CLOCK_SKEW_MS = 60 * SEGUNDO;

// ─── Cotas (§27.1, R-14, R-15) ──────────────────────────────────────────────────────────

export const ATTACHMENT_MAX_BYTES = 8 * GiB;
export const ATTACHMENT_QUOTA_PER_MEMBER = 5 * GiB;

/** R-15: a janela é sobre `seq`, **não** sobre tempo — o `fold` não lê relógio. */
export const QUOTA_WINDOW_SEQS = 10_000;
export const QUOTA_OPS_PER_WINDOW = 2_000;
export const QUOTA_BYTES_PER_WINDOW = 64 * MiB;

// ─── Tamanho de registro (§27.1, §8.6, estágios 0 e 13) ─────────────────────────────────

/** Teto do registro **sem** anexo, conferido no estágio 13 — depois do decode revelar. */
export const MAX_ENVELOPE_BYTES = 32 * KiB;

/** Teto absoluto, conferido no **estágio 0**, antes de qualquer decode ou Ed25519. */
export const MAX_ENVELOPE_BYTES_ATTACHMENT = 64 * KiB;

// ─── Cardinalidade (§26.2, R-26) ────────────────────────────────────────────────────────

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

// ─── Sucessão e relay (§27.1, R-18, R-19) ───────────────────────────────────────────────

export const HOST_INACTIVITY_MS = 30 * DIA;
export const RELAY_TTL_MS = 24 * HORA;

// ─── Mídia (§17, §27.1) ─────────────────────────────────────────────────────────────────

/**
 * §17.4: validade do ticket de mídia emitido pelo host. O ticket é renovado por
 * `media.ticketRenew` (§26.2); expiração sem renovação encerra a sessão no pior caso —
 * é o que faz ban alcançar mídia mesmo com `voice.revoked` suprimido (`T-32`).
 *
 * Aplicada pelo `voiceCoordinator` (emissor/verificador), que a recebe por injeção:
 * §4 não declara `fold` nas dependências dele. Os controles TURN são §27.2 e moram em
 * `config` (L0) — ver cabeçalho acima.
 */
export const MEDIA_TICKET_TTL_MS = 5 * MINUTO;

// ─── Voz e câmera (§17, §27.1) ──────────────────────────────────────────────────────────

/** §17.6/§RPC `voiceJoin`: teto de participantes de uma sessão de voz; além → `E_VOICE_FULL`. */
export const MAX_VOICE_PARTICIPANTS = 24;

/** §17.5/`voiceState{cameraOn}`: teto de câmeras simultâneas; além → `E_CAMERA_LIMIT`. */
export const MAX_CAMERAS = 6;

/**
 * §17.5/§27.1/`share.join`: teto de espectadores da sessão de tela em estrela; além →
 * `E_SESSION_FULL` (delta U-09). Aplicado pelo `voiceCoordinator` (camada de decisão da
 * sessão de tela), que o recebe por injeção — mesmo padrão de `MEDIA_TICKET_TTL_MS`.
 */
export const SHARE_MAX_VIEWERS = 8;

// ─── Enums numerados que viajam em material assinado ────────────────────────────────────

/**
 * §6.6 (fecha `HOLE-09`): `type` viaja como `u8` em `channel.create`, dentro de material
 * assinado — o número **é** contrato. `u8` fora de `{0,1}` é `E_VALIDATION.type`.
 */
export const CHANNEL_TYPE = { text: 0, voice: 1 } as const;

export function isValidChannelType(t: number): boolean {
  return t === CHANNEL_TYPE.text || t === CHANNEL_TYPE.voice;
}

/**
 * §6.4.2 (fecha `HOLE-10`): `RoleColor` é `0..6`; `avatarColor`/`iconColor` são `0..7`,
 * porque `accent` (7) é a cor do próprio app e não é atribuível a cargo.
 *
 * Fora da faixa é `REJECTED`, **nunca clampado**: clampar faria duas réplicas com paletas de
 * tamanhos diferentes convergirem para cores diferentes a partir do mesmo log.
 */
export const ROLE_COLOR_MAX = 6;
export const AVATAR_COLOR_MAX = 7;

export function isRoleColor(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= ROLE_COLOR_MAX;
}

export function isAvatarColor(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= AVATAR_COLOR_MAX;
}

// ─── Gênese (R-27) ──────────────────────────────────────────────────────────────────────

/** R-27: os registros de `seq` 0 a 5 formam a gênese. */
export const GENESIS_LENGTH = 6;
export const GENESIS_LAST_SEQ = GENESIS_LENGTH - 1;

// ─── Limites de campo (§8.6, tabela única e autoritativa) ───────────────────────────────

/**
 * §8.6. `cp` conta **code points** (escalares Unicode), `bytes` conta UTF-8. Grafema não
 * aparece em lugar nenhum: ele depende da tabela do ICU do runtime, que tem versão e pode
 * ser tailorizada por locale — contar grafema faria a interpretação do log ser função do
 * ambiente e violaria §1.5. Era a única brecha estrutural conhecida contra "mesma função em
 * todo nó" (`RISCO-01` de G1), e foi fechada trocando a unidade, não pinando ICU.
 */
export const LIMIT = {
  displayName: { minCp: 2, maxCp: 32 },
  communityName: { minCp: 2, maxCp: 40 },
  communityDescription: { minCp: 0, maxCp: 120 },
  communityIconEmoji: { minCp: 1, maxCp: 8, maxBytes: 32 },
  categoryName: { minCp: 1, maxCp: 32 },
  channelName: { minCp: 1, maxCp: 32 },
  channelTopic: { minCp: 0, maxCp: 120 },
  roleName: { minCp: 1, maxCp: 32 },
  nickname: { minCp: 1, maxCp: 32 },
  messageContent: { minCp: 1, maxCp: 4000, maxBytes: 16384 },
  reactionEmoji: { minCp: 1, maxCp: 8, maxBytes: 32 },
  moderationReason: { minCp: 0, maxCp: 200 },
  inviteLabel: { minCp: 0, maxCp: 40 },
  attachmentName: { minBytes: 1, maxBytes: 255 },
} as const;

/** §8.6 — `Invite.expiresAt` ∈ `[hostTs+60s, hostTs+365d]`; `maxUses` ∈ `[1, 10000]`. */
export const INVITE_EXPIRY_MIN_MS = 60 * SEGUNDO;
export const INVITE_EXPIRY_MAX_MS = 365 * DIA;
export const INVITE_MAX_USES_MIN = 1;
export const INVITE_MAX_USES_MAX = 10_000;

/** §8.6 — `Timeout.until` ∈ `[hostTs+60s, hostTs+30d]`. */
export const TIMEOUT_MIN_MS = 60 * SEGUNDO;
export const TIMEOUT_MAX_MS = 30 * DIA;
