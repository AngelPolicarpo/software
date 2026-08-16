/**
 * Limites de campo e normalizacao — backend-v2.md §8.6 (tabela unica e autoritativa).
 * Todos sao constantes de protocolo (§27.1). Nenhum e configuravel.
 *
 * A contagem e em GRAFEMAS onde a tabela diz grafema. `Intl.Segmenter` esta no ICU do
 * Node e e deterministico para uma versao de ICU dada; a versao entra no artefato do
 * gate (RISCO-01 no REPORT.md: duas replicas com ICU diferente podem divergir na
 * contagem de grafema de entradas exoticas — a spec nao fixa a versao de ICU, e isso e
 * material de interpretacao do log).
 */
import { LIMIT } from '../protocol/constants.ts';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function graphemes(s: string): number {
  let n = 0;
  for (const _ of segmenter.segment(s)) n++;
  return n;
}

/**
 * Conta grafemas ate `limit + 1` e para. Um grafema tem >= 1 unidade UTF-16, entao
 * `s.length <= limit` ja garante `graphemes <= limit` sem segmentar nada. Mesma decisao
 * de aceitacao, custo limitado para entrada hostil longa.
 */
export function graphemesAtMost(s: string, limit: number): number {
  if (s.length <= limit) return s.length === 0 ? 0 : graphemes(s);
  let n = 0;
  for (const _ of segmenter.segment(s)) {
    if (++n > limit) return n;
  }
  return n;
}

export function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/** `trim` + NFKC. */
export function trimNFKC(s: string): string {
  return s.trim().normalize('NFKC');
}

/** `trim` + colapsa espaco interno + NFKC (displayName). */
export function trimCollapseNFKC(s: string): string {
  return s.trim().replace(/\s+/g, ' ').normalize('NFKC');
}

/** `trim` no fim, preservando quebra de linha (Message.content). */
export function trimEnd(s: string): string {
  return s.replace(/\s+$/u, '');
}

/**
 * §8.6 — normalizacao do nome de canal de TEXTO:
 * NFD -> remove diacritico -> minusculo -> espaco vira `-` -> descarta o resto ->
 * colapsa `-` repetido -> trim('-'). Resultado precisa casar ^[a-z0-9][a-z0-9-]{0,31}$
 */
export function slugChannelName(raw: string): string {
  let s = raw.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  s = s.toLowerCase();
  s = s.replace(/\s/gu, '-');
  s = s.replace(/[^a-z0-9-]/gu, '');
  s = s.replace(/-{2,}/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  return s;
}

export const CHANNEL_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Canal de voz: trim, preserva caixa e espaco, NFKC. */
export function normalizeVoiceChannelName(raw: string): string {
  return trimNFKC(raw);
}

export type FieldCheck = { ok: true; value: string } | { ok: false; field: string };

export function checkGraphemeRange(
  value: string,
  min: number,
  max: number,
  field: string,
): FieldCheck {
  const g = graphemesAtMost(value, max);
  if (g < min || g > max) return { ok: false, field };
  return { ok: true, value };
}

export function checkCommunityName(raw: string): FieldCheck {
  const v = trimNFKC(raw);
  return checkGraphemeRange(v, LIMIT.communityName.min, LIMIT.communityName.max, 'name');
}

export function checkCommunityDescription(raw: string | undefined): FieldCheck {
  if (raw === undefined) return { ok: true, value: '' };
  const v = raw.trim();
  return checkGraphemeRange(v, LIMIT.communityDescription.min, LIMIT.communityDescription.max, 'description');
}

export function checkCategoryName(raw: string): FieldCheck {
  const v = trimNFKC(raw);
  return checkGraphemeRange(v, LIMIT.categoryName.min, LIMIT.categoryName.max, 'name');
}

export function checkRoleName(raw: string): FieldCheck {
  const v = trimNFKC(raw);
  return checkGraphemeRange(v, LIMIT.roleName.min, LIMIT.roleName.max, 'name');
}

export function checkDisplayName(raw: string): FieldCheck {
  const v = trimCollapseNFKC(raw);
  return checkGraphemeRange(v, LIMIT.displayName.min, LIMIT.displayName.max, 'displayName');
}

export function checkChannelTopic(raw: string | undefined): FieldCheck {
  if (raw === undefined) return { ok: true, value: '' };
  const v = raw.trim();
  return checkGraphemeRange(v, LIMIT.channelTopic.min, LIMIT.channelTopic.max, 'topic');
}

/** Devolve `E_CHANNEL_NAME_EMPTY` separadamente de `E_VALIDATION.name` (§8.6). */
export type ChannelNameCheck =
  | { ok: true; value: string }
  | { ok: false; empty: true }
  | { ok: false; empty: false };

export function checkChannelName(raw: string, type: number): ChannelNameCheck {
  if (type === CHANNEL_TYPE.text) {
    const s = slugChannelName(raw);
    if (s.length === 0) return { ok: false, empty: true };
    if (!CHANNEL_SLUG_RE.test(s)) return { ok: false, empty: false };
    return { ok: true, value: s };
  }
  const v = normalizeVoiceChannelName(raw);
  const g = graphemesAtMost(v, LIMIT.channelName.max);
  if (g < LIMIT.channelName.min || g > LIMIT.channelName.max) return { ok: false, empty: false };
  return { ok: true, value: v };
}

export function checkMessageContent(raw: string): FieldCheck {
  const v = trimEnd(raw);
  if (utf8Bytes(v) > LIMIT.messageContentBytes.max) return { ok: false, field: 'content' };
  const g = graphemesAtMost(v, LIMIT.messageContentGraphemes.max);
  if (g < LIMIT.messageContentGraphemes.min || g > LIMIT.messageContentGraphemes.max) {
    return { ok: false, field: 'content' };
  }
  return { ok: true, value: v };
}

export function checkReactionEmoji(raw: string): FieldCheck {
  if (utf8Bytes(raw) > LIMIT.reactionEmojiBytes.max) return { ok: false, field: 'emoji' };
  const g = graphemesAtMost(raw, 1);
  if (g !== 1) return { ok: false, field: 'emoji' };
  return { ok: true, value: raw };
}

export function checkModerationReason(raw: string | undefined): FieldCheck {
  if (raw === undefined) return { ok: true, value: '' };
  const v = raw.trim();
  return checkGraphemeRange(v, LIMIT.moderationReason.min, LIMIT.moderationReason.max, 'reason');
}

/**
 * §6.6 — `type` de canal e o enum fechado `text · voice`.
 *
 * BURACO DE SPEC HOLE-09: o payload de `channel.create` carrega `u8 type` (§7.4.2) mas a
 * spec nunca fixa o VALOR NUMERICO de `text` e `voice`. O numero e material assinado.
 * A atribuicao abaixo esta declarada como ASSUMPTION-09.
 */
export const CHANNEL_TYPE = { text: 0, voice: 1 } as const;

export function isValidChannelType(t: number): boolean {
  return t === CHANNEL_TYPE.text || t === CHANNEL_TYPE.voice;
}
