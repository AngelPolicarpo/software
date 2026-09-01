// Limites de campo e normalização da conversa direta — §31.7.5. Estágio 10 de §31.7.3.
//
// §31.7.5: "Todos são **constantes de protocolo** e todos são **reuso literal de §8.6**.
// Nenhum limite novo é inventado." A normalização também é a de §8.6, pelo mesmo motivo: a
// unidade de contagem é **code point**, nunca grafema, porque grafema depende da tabela de
// segmentação do ICU do runtime e faria a interpretação do log ser função do ambiente (§1.5).
//
// Este módulo é uma segunda implementação de `fold/limits.ts` restrita aos quatro campos que
// §31.5 tem — §4 não dá a `dmFold` uma aresta até `fold`. O teste `dm-fold-rules` confere os
// dois lado a lado.

import { DM_LIMIT } from './constants.ts';

/** Escalares Unicode de `s`. `for..of` itera code points, não unidades UTF-16. */
export function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/**
 * Conta até `limit + 1` e para. Um code point ocupa ≥ 1 unidade UTF-16, então
 * `s.length ≤ limit` já garante `codePoints ≤ limit` sem iterar nada: mesma decisão de
 * aceitação, custo limitado para entrada hostil longa.
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

/** §8.6 — `displayName`: `trim`, colapsa espaço interno, NFKC. */
export function trimCollapseNFKC(s: string): string {
  return s.trim().replace(/\s+/gu, ' ').normalize('NFKC');
}

/** §8.6 — `content`: `trim` no fim, **preservando quebra de linha** interna. */
export function trimEndOnly(s: string): string {
  return s.replace(/\s+$/u, '');
}

export type DmFieldCheck = { ok: true; value: string } | { ok: false; field: string };

const ok = (value: string): DmFieldCheck => ({ ok: true, value });
const bad = (field: string): DmFieldCheck => ({ ok: false, field });

function range(value: string, minCp: number, maxCp: number, field: string): DmFieldCheck {
  const n = codePointsAtMost(value, maxCp);
  return n < minCp || n > maxCp ? bad(field) : ok(value);
}

/** §31.7.5 — `dm.hello.displayName` / `dm.profile.displayName`: 2–32 code points. */
export function checkDmDisplayName(raw: string): DmFieldCheck {
  const { minCp, maxCp } = DM_LIMIT.displayName;
  return range(trimCollapseNFKC(raw), minCp, maxCp, 'displayName');
}

/** §31.7.5 — `dm.message.content`: 1–4000 code points **e** ≤ 16384 bytes UTF-8. */
export function checkDmMessageContent(raw: string): DmFieldCheck {
  const v = trimEndOnly(raw);
  const { minCp, maxCp, maxBytes } = DM_LIMIT.messageContent;
  if (utf8Bytes(v) > maxBytes) return bad('content');
  return range(v, minCp, maxCp, 'content');
}

/** §31.7.5 — `dm.react.emoji`: 1–8 code points, ≤ 32 bytes. Sem normalização. */
export function checkDmReactionEmoji(raw: string): DmFieldCheck {
  const { minCp, maxCp, maxBytes } = DM_LIMIT.reactionEmoji;
  if (utf8Bytes(raw) > maxBytes) return bad('emoji');
  return range(raw, minCp, maxCp, 'emoji');
}

const NOME_RESERVADO = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/**
 * §31.7.5 — `attachment.name`: 1–255 **bytes**, e **rejeita, não sanitiza**. Sanitizar pode
 * fazer dois nomes distintos colapsarem no mesmo e esconder travessia de caminho (`T-37`);
 * §8.6 fechou isso rejeitando na origem, e §31.7.5 reusa a regra literalmente.
 */
export function isValidDmAttachmentName(name: string): boolean {
  const bytes = utf8Bytes(name);
  const { minBytes, maxBytes } = DM_LIMIT.attachmentName;
  if (bytes < minBytes || bytes > maxBytes) return false;
  if (/[/\\\0]/.test(name)) return false;
  for (const c of name) {
    const cp = c.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp === 0x7f) return false;
  }
  if (NOME_RESERVADO.test(name)) return false;
  return !(name.endsWith('.') || name.endsWith(' '));
}
