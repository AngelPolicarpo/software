/**
 * Indexacao fracionaria — backend-v2.md §6.4.1, aplicada por R-20.
 *
 * `rank` e uma string na base 62 (`0-9A-Za-z`), ordenada lexicograficamente, lida como
 * a parte fracionaria de um numero em base 62. `midpoint(a, b)` devolve uma chave
 * estritamente entre A e B sem tocar em nenhum outro registro (§6.4.1). O `fold`
 * recalcula o `rank` a partir dos vizinhos REAIS no `DS`, ignorando os enviados pelo
 * cliente quando estiverem desatualizados (R-20).
 *
 * TOTALIDADE (§8.5): nenhuma funcao aqui lanca. Entrada incoerente (`a >= b`, `rank`
 * com zero a direita) e normalizada, nunca rejeitada por excecao.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length; // 62
const ZERO = DIGITS[0]; // '0'

/** Chave canonica: sem zero a direita (senao `midpoint` nao termina). */
function canonical(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === ZERO) end--;
  return s.slice(0, end);
}

export function isValidRank(s: string): boolean {
  if (s.length < 1 || s.length > 64) return false;
  for (const c of s) if (DIGITS.indexOf(c) < 0) return false;
  return s[s.length - 1] !== ZERO;
}

/**
 * Chave estritamente entre `a` e `b`, lidas como fracoes em base 62.
 * `a = ''` => limite inferior; `b = null` => limite superior.
 */
function mid(a: string, b: string | null): string {
  a = canonical(a);
  if (b !== null) {
    b = canonical(b);
    if (b.length === 0 || a >= b) return mid(a, null); // entrada incoerente: append no fim
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + mid(a.slice(n), b.slice(n));
  }
  const digitA = a.length > 0 ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : BASE;
  if (digitB - digitA > 1) return DIGITS[Math.round(0.5 * (digitA + digitB))];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA] + mid(a.slice(1), null);
}

export function midpoint(a: string | null, b: string | null): string {
  return mid(a ?? '', b);
}

/** Topo absoluto — o Fundador tem sempre o `rank` maximo (§6.4.1). */
export const RANK_TOP = 'zz';

/**
 * R-27(a) — sentinela de `topRank` do PRINCIPAL DE GENESE.
 *
 * `isValidRank` limita rank a 64 caracteres, entao 65 `z` e estritamente maior que
 * qualquer rank atribuivel na comparacao lexicografica de §6.4.1 e, ao mesmo tempo,
 * NUNCA e um rank valido — nao pode ser gravado em cargo nem chegar a `view.db`.
 */
export const RANK_GENESIS = 'z'.repeat(65);

/**
 * Fundo da ordenacao, atribuido ao cargo base na genese.
 *
 * BURACO DE SPEC HOLE-14: §6.4.1 fixa so o `rank` do Fundador ("sempre o maximo"). O do
 * cargo base nao esta em lugar nenhum, e ele NAO pode ficar acima dos cargos criados
 * depois — senao todo membro comum passa a superar os moderadores na hierarquia de §9.3.
 * ASSUMPTION-14: cargo base nasce no fundo.
 */
export const RANK_BOTTOM = '1';

/** §7.2.1 — teto de comprimento do tipo `rank`. Constante de protocolo (§27.1). */
export const RANK_MAX_LEN = 64;

/**
 * §6.4.1, renormalizacao deterministica (fecha HOLE-15).
 *
 * `midpoint` cresce em comprimento a cada insercao sucessiva na mesma extremidade:
 * medido, a partir de ~383 insercoes consecutivas no fundo a chave passa de RANK_MAX_LEN
 * e sai do tipo declarado em §7.2.1. Quando isso aconteceria, o `fold` NAO recusa a op —
 * ele reespaca o escopo inteiro, preservando a ordem corrente.
 *
 * Recusar era a alternativa e foi descartada: deixaria a comunidade permanentemente
 * incapaz de reordenar, sem caminho de volta, por um detalhe de representacao que o
 * usuario nao tem como perceber nem corrigir.
 *
 * E funcao pura da lista ordenada, entao toda replica produz exatamente os mesmos ranks.
 * A saida usa dois digitos base62 por item ('11', '21', ... ) — cabe em MAX_CHANNELS
 * (500) < 62^2, e nunca termina em '0', como `isValidRank` exige.
 */
export function renormalize(count: number): string[] {
  // Duas casas base62, ambas com indice >= 1: nunca terminam em '0' (isValidRank) e a
  // primeira casa fica em '1'..'9' para count <= 500, logo todo rank gerado esta
  // ESTRITAMENTE entre RANK_BOTTOM ('1') e RANK_TOP ('zz') — o cargo base continua no
  // fundo e o Fundador continua no topo, que §6.4.1 e R-27(b) exigem.
  if (count > 60 * 61) return []; // fora do alcance de §27.1; nao acontece no v1
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(DIGITS[1 + Math.floor(i / 60)] + DIGITS[1 + (i % 60)]);
  }
  return out;
}

/** `true` quando o `rank` gerado estourou o tipo e o escopo precisa ser reespacado. */
export function needsRenormalization(rank: string): boolean {
  return rank.length > RANK_MAX_LEN;
}

/**
 * R-20 — recalcula o `rank` de um item novo a partir dos vizinhos reais no `DS`.
 * `existing` = ranks vivos no escopo. `after`/`before` sao as dicas do cliente,
 * IGNORADAS quando nao existirem mais no escopo.
 * Sem dica utilizavel, o item vai para o fim da lista (menor `rank`).
 */
export function rankBetween(
  existing: readonly string[],
  after: string | undefined,
  before: string | undefined,
): string {
  const sorted = [...existing].sort();
  const set = new Set(sorted);
  const a = after !== undefined && set.has(after) ? after : null;
  const b = before !== undefined && set.has(before) ? before : null;

  if (a !== null && b !== null && a < b) {
    const between = sorted.filter((r) => r > a && r < b);
    return midpoint(a, between.length > 0 ? between[0] : b);
  }
  if (a !== null) {
    const above = sorted.filter((r) => r > a);
    return midpoint(a, above.length > 0 ? above[0] : null);
  }
  if (b !== null) {
    const below = sorted.filter((r) => r < b);
    return midpoint(below.length > 0 ? below[below.length - 1] : null, b);
  }
  return midpoint(null, sorted.length > 0 ? sorted[0] : null);
}
