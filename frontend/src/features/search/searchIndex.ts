/**
 * Tipos da busca real de §23.1 (`query.search` sobre o FTS do núcleo).
 *
 * O motor client-side foi embora: a fonte é o índice do `view.db`, que enxerga
 * TODO o log interpretado — não só a janela de 50 mensagens carregada na tela.
 * Aqui ficam os filtros do painel e o destaque do casamento; os tipos de
 * resultado moram em `domain/types.ts`.
 */

/** §14 — top ~20 por grupo, com "ver todos" expandindo in-line. */
export const RESULTS_PER_GROUP = 20;

/**
 * O teto de `limitPerGroup` em §23.1 (`SEARCH_MAX_LIMIT_PER_GROUP` no núcleo). É até onde
 * "Ver todos" expande — pedir mais é recusado lá e devolveria o mesmo 100.
 */
export const RESULTS_MAX_PER_GROUP = 100;

export type DateFilter = "today" | "7d" | "30d";
export type KindFilter = "attachment" | "link" | "pinned";

export interface SearchFilters {
  authorId?: string;
  channelId?: string;
  date?: DateFilter;
  kind?: KindFilter;
}

export type {
  BuscaResults,
  SearchMessageHit,
  SearchChannelHit,
  SearchPartialReason,
} from "../../domain/types";

export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function hasFilters(filters: SearchFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined);
}

/** Divide o texto no trecho que casou, para destacá-lo no resultado. */
export function splitOnMatch(
  text: string,
  query: string,
): { before: string; match: string; after: string } | null {
  const needle = normalize(query.trim());
  if (needle === "") return null;
  const index = normalize(text).indexOf(needle);
  if (index === -1) return null;
  return {
    before: text.slice(0, index),
    match: text.slice(index, index + needle.length),
    after: text.slice(index + needle.length),
  };
}
