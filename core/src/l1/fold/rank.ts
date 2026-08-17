// Indexação fracionária — §6.4.1, aplicada por R-20.
//
// §4: `fold` depende de `permissions`, de onde vêm o alfabeto, o teto e as três constantes
// de fronteira. Geração de `rank` é efeito que o `fold` calcula (R-20); *ordenação* de
// `rank` é hierarquia, e mora em `permissions` (§9.3).
//
// TOTALIDADE (§8.5): nenhuma função aqui lança. Entrada incoerente — `a ≥ b`, zero à
// direita, `null` dos dois lados — é normalizada, nunca recusada por exceção. O `fold`
// interpreta um registro por vez e não tem para onde escapar.

import { RANK_BOTTOM, RANK_DIGITS, RANK_MAX_LEN, RANK_TOP } from '../permissions/index.ts';

const BASE = RANK_DIGITS.length; // 62
const ZERO = RANK_DIGITS[0] as string; // '0'

/** Chave canônica: sem `0` à direita — senão `midpoint` não termina. */
function canonical(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === ZERO) end--;
  return s.slice(0, end);
}

function digit(c: string): number {
  return RANK_DIGITS.indexOf(c);
}

function mid(a: string, b: string | null): string {
  a = canonical(a);
  if (b !== null) {
    b = canonical(b);
    // Incoerente (vizinhos desatualizados, R-20): trata como "entra no fim".
    if (b.length === 0 || a >= b) return mid(a, null);
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + mid(a.slice(n), b.slice(n));
  }
  const dA = a.length > 0 ? digit(a[0] as string) : 0;
  const dB = b !== null ? digit(b[0] as string) : BASE;
  // Folga de pelo menos um dígito: fica no meio, arredondando meio para cima.
  if (dB - dA > 1) return RANK_DIGITS[Math.round(0.5 * (dA + dB))] as string;
  // Sem folga: desce uma casa, preservando o dígito de `a`.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return (RANK_DIGITS[dA] as string) + mid(a.slice(1), null);
}

/**
 * §6.4.1 — chave estritamente entre `a` e `b`, lidas como fração em base 62.
 * `a = null` é o limite inferior; `b = null`, o superior.
 */
export function midpoint(a: string | null, b: string | null): string {
  return mid(a ?? '', b);
}

/**
 * §6.4.1, renormalização determinística.
 *
 * `midpoint` cresce em comprimento a cada inserção sucessiva na mesma extremidade: a partir
 * de ~383 inserções consecutivas no fundo a chave passa de `RANK_MAX_LEN` e sai do tipo de
 * §7.2.1. Quando isso aconteceria, o `fold` **não recusa a op** — reespaça o escopo inteiro
 * preservando a ordem corrente, e emite um `upsert` por item.
 *
 * Recusar era a alternativa e foi descartada: deixaria a comunidade permanentemente incapaz
 * de reordenar, por um detalhe de representação que o usuário não percebe nem corrige.
 *
 * Dois dígitos base 62, ambos de índice ≥ 1: nunca terminam em `0`, cabem em
 * `MAX_CHANNELS` (500) e ficam estritamente entre `RANK_BOTTOM` e `RANK_TOP`.
 */
export function renormalize(count: number): string[] {
  if (!Number.isInteger(count) || count < 0 || count > 60 * 61) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push((RANK_DIGITS[1 + Math.floor(i / 60)] as string) + (RANK_DIGITS[1 + (i % 60)] as string));
  }
  return out;
}

/** `true` quando o `midpoint` calculado estouraria o tipo e a renormalização é obrigatória. */
export function needsRenormalization(rank: string): boolean {
  return rank.length > RANK_MAX_LEN;
}

/**
 * R-20 — o `rank` de um item novo ou movido, recalculado **a partir dos vizinhos reais no
 * `DS`**.
 *
 * `after`/`before` são as chaves vizinhas *observadas pelo cliente* (§6.4.1), não uma
 * posição absoluta. O `fold` as **ignora quando não existem mais** no escopo: é o que torna
 * `role.move` determinístico sob concorrência sem que o cliente precise estar em dia. Sem
 * dica utilizável o item vai para o fim da lista — o menor `rank`, já que a ordem exibida é
 * `rank DESC`.
 *
 * Quando as duas dicas são válidas mas há itens entre elas (o cliente estava atrasado), o
 * vizinho real é o **primeiro** item acima de `after`, não `before`: inserir entre `after` e
 * `before` "pulando" quem entrou no meio mudaria a posição relativa de terceiros.
 */
export function rankBetween(
  existing: readonly string[],
  after: string | undefined,
  before: string | undefined,
): string {
  const ordenado = [...existing].sort();
  const vivos = new Set(ordenado);
  const a = after !== undefined && vivos.has(after) ? after : null;
  const b = before !== undefined && vivos.has(before) ? before : null;

  if (a !== null && b !== null && a < b) {
    const entre = ordenado.filter((r) => r > a && r < b);
    return midpoint(a, entre[0] ?? b);
  }
  if (a !== null) {
    const acima = ordenado.filter((r) => r > a);
    return midpoint(a, acima[0] ?? null);
  }
  if (b !== null) {
    const abaixo = ordenado.filter((r) => r < b);
    return midpoint(abaixo[abaixo.length - 1] ?? null, b);
  }
  return midpoint(null, ordenado[0] ?? null);
}

export { RANK_BOTTOM, RANK_TOP };
