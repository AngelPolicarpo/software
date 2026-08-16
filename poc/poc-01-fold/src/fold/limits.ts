/**
 * Limites de campo e normalizacao — backend-v2.md §8.6 (tabela unica e autoritativa).
 * Todos sao constantes de protocolo (§27.1). Nenhum e configuravel.
 *
 * A contagem e em CODE POINTS (escalares Unicode), NUNCA em grafemas — §8.6, "Unidade de
 * contagem", e `TEXT_COUNT_UNIT` em §27.1. Grafema depende da tabela de segmentacao do
 * ICU do runtime, que tem versao e pode ser tailorizada por locale; contar grafema aqui
 * tornaria a interpretacao do log funcao do ambiente e violaria §1.5 (era RISCO-01, e
 * foi a unica brecha estrutural encontrada contra a tese "mesma funcao em todo no").
 * Este modulo NAO usa `Intl.Segmenter`. Contador grafemico e assunto de UI (§8.7).
 */
import { LIMIT } from '../protocol/constants.ts';

export function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/**
 * Conta code points ate `limit + 1` e para. Um code point tem >= 1 unidade UTF-16, entao
 * `s.length <= limit` ja garante `codePoints <= limit` sem iterar. Mesma decisao de
 * aceitacao, custo limitado para entrada hostil longa.
 */
export function codePointsAtMost(s: string, limit: number): number {
  if (s.length <= limit) return codePoints(s);
  let n = 0;
  for (const _ of s) {
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

export function checkCodePointRange(
  value: string,
  min: number,
  max: number,
  field: string,
): FieldCheck {
  const g = codePointsAtMost(value, max);
  if (g < min || g > max) return { ok: false, field };
  return { ok: true, value };
}

export function checkCommunityName(raw: string): FieldCheck {
  const v = trimNFKC(raw);
  return checkCodePointRange(v, LIMIT.communityName.min, LIMIT.communityName.max, 'name');
}

export function checkCommunityDescription(raw: string | undefined): FieldCheck {
  if (raw === undefined) return { ok: true, value: '' };
  const v = raw.trim();
  return checkCodePointRange(v, LIMIT.communityDescription.min, LIMIT.communityDescription.max, 'description');
}

export function checkCategoryName(raw: string): FieldCheck {
  const v = trimNFKC(raw);
  return checkCodePointRange(v, LIMIT.categoryName.min, LIMIT.categoryName.max, 'name');
}

export function checkRoleName(raw: string): FieldCheck {
  const v = trimNFKC(raw);
  return checkCodePointRange(v, LIMIT.roleName.min, LIMIT.roleName.max, 'name');
}

export function checkDisplayName(raw: string): FieldCheck {
  const v = trimCollapseNFKC(raw);
  return checkCodePointRange(v, LIMIT.displayName.min, LIMIT.displayName.max, 'displayName');
}

export function checkChannelTopic(raw: string | undefined): FieldCheck {
  if (raw === undefined) return { ok: true, value: '' };
  const v = raw.trim();
  return checkCodePointRange(v, LIMIT.channelTopic.min, LIMIT.channelTopic.max, 'topic');
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
  const g = codePointsAtMost(v, LIMIT.channelName.max);
  if (g < LIMIT.channelName.min || g > LIMIT.channelName.max) return { ok: false, empty: false };
  return { ok: true, value: v };
}

export function checkMessageContent(raw: string): FieldCheck {
  const v = trimEnd(raw);
  if (utf8Bytes(v) > LIMIT.messageContentBytes.max) return { ok: false, field: 'content' };
  const g = codePointsAtMost(v, LIMIT.messageContentCodePoints.max);
  if (g < LIMIT.messageContentCodePoints.min || g > LIMIT.messageContentCodePoints.max) {
    return { ok: false, field: 'content' };
  }
  return { ok: true, value: v };
}

/**
 * §8.6 — `Reaction.emoji`: 1..8 code points, <= 32 bytes.
 *
 * Era "1 grafema / 24 bytes". O teto de 24 bytes rejeitava a familia com ZWJ
 * (`👨‍👩‍👧‍👦`, 7 code points, 25 bytes) — era OBS-04. "Uma reacao = um emoji" passa a ser
 * garantido pelo seletor da UI, nao pelo `fold`: aqui a regra e um teto deterministico.
 */
export function checkReactionEmoji(raw: string): FieldCheck {
  if (utf8Bytes(raw) > LIMIT.reactionEmojiBytes.max) return { ok: false, field: 'emoji' };
  const g = codePointsAtMost(raw, LIMIT.reactionEmojiCodePoints.max);
  if (g < LIMIT.reactionEmojiCodePoints.min || g > LIMIT.reactionEmojiCodePoints.max) {
    return { ok: false, field: 'emoji' };
  }
  return { ok: true, value: raw };
}

export function checkModerationReason(raw: string | undefined): FieldCheck {
  if (raw === undefined) return { ok: true, value: '' };
  const v = raw.trim();
  return checkCodePointRange(v, LIMIT.moderationReason.min, LIMIT.moderationReason.max, 'reason');
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
