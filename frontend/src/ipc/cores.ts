/**
 * Catálogo de cores de `backend-v2.md` §6.4.2 — a tradução entre o fio e o tema.
 *
 * **Cor é `u8`, não string.** Ela viaja como número em material assinado
 * (`identity.create`/`update`, `community.create`/`update`, `role.create`/`update`), e por
 * isso o número é **constante de protocolo** (§27.1), não escolha de tema: duas réplicas com
 * paletas de tamanhos diferentes convergiriam para cores diferentes a partir do mesmo log se
 * o valor fosse clampado ou substituído por default. Valor fora da faixa é `E_VALIDATION` no
 * campo — o núcleo não conserta, e a UI também não deve tentar.
 *
 * Duas faixas, porque `accent` é a identidade visual do app e não é atribuível a cargo (um
 * cargo `accent` se confundiria com elemento de sistema na lista de membros):
 *
 *   - `Role.color`                 → 0..6
 *   - `avatarColor` / `iconColor`  → 0..7
 *
 * **Na leitura o fio é inconsistente e este módulo absorve isso.** `UserRef.avatarColor` vem
 * como string do número (`"3"`) porque §15.6 declara o campo como `string`, enquanto
 * `query.communities.iconColor` vem como número cru. Aceitar as duas formas aqui evita
 * espalhar a diferença por dez telas; a inconsistência está registrada como pendência.
 */

/** Índice → token de tema. A ordem É o protocolo; não reordenar. */
export const CATALOGO = [
  "role-gold",
  "role-blue",
  "role-green",
  "role-red",
  "role-purple",
  "role-pink",
  "role-neutral",
  "accent",
] as const;

export type TokenDeCor = (typeof CATALOGO)[number];

/** §6.4.2 — cargo não recebe `accent`. */
export const CORES_DE_CARGO = CATALOGO.slice(0, 7) as readonly TokenDeCor[];
export const CORES_DE_AVATAR = CATALOGO as readonly TokenDeCor[];

/** Token → número do fio. `null` quando o token não está no catálogo fechado. */
export function numeroDaCor(token: string): number | null {
  const i = (CATALOGO as readonly string[]).indexOf(token);
  return i === -1 ? null : i;
}

/**
 * O que veio do fio → token. Aceita número e string de número, que são as duas formas em
 * que a cor chega hoje. Fora da faixa devolve `null`: quem não sabe a cor não deve inventar
 * uma, e a chamadora decide o fallback visual.
 */
export function tokenDaCor(bruto: unknown): TokenDeCor | null {
  let n: number;
  if (typeof bruto === "number") {
    n = bruto;
  } else if (typeof bruto === "string" && bruto.trim().length > 0) {
    // `Number("")` é 0: sem esta guarda, campo ausente ou vazio viraria a cor 0 em
    // silêncio — a pior forma de errar, porque parece certo.
    n = Number(bruto);
  } else {
    return null;
  }
  if (!Number.isInteger(n) || n < 0 || n >= CATALOGO.length) return null;
  return CATALOGO[n]!;
}

/** Variável CSS do que veio do fio, com fallback nomeado para valor fora do catálogo. */
export function varDeCor(bruto: unknown, fallback: TokenDeCor = "role-neutral"): string {
  return `var(--color-${tokenDaCor(bruto) ?? fallback})`;
}
