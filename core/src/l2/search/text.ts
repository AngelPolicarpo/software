// `search` — pipeline de texto de §23.1, função pura.
//
// Três etapas normativas, nesta ordem e nenhuma outra:
//   1. Normalização — NFD → remove diacrítico → minúsculo ("a mesma função do frontend",
//      que vive em `frontend/src/features/search/searchIndex.ts` e é transcrita aqui);
//   2. Tokenização — split por não-alfanumérico; tokens de 1 caractere são descartados;
//   3. Construção do MATCH (fecha DR-39) — cada token vira `"token"` com aspas interna
//      escapada por duplicação, o que desativa toda a sintaxe de operador do FTS5
//      (`AND`/`OR`/`NOT`/`NEAR`/`*`/`^`/`:` digitados são literais); os tokens se unem por
//      AND implícito; exceção única: o último token recebe `*` de prefixo para a
//      busca-enquanto-digita.

/** A mesma normalização do frontend — §23.1, etapa 1. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Etapa 2 — split por não-alfanumérico (classes Unicode `\p{L}`/`\p{N}`), descartando
 * tokens de 1 caractere. Roda sobre o texto já normalizado.
 */
export function tokenize(query: string): readonly string[] {
  const normalized = normalizeText(query.trim());
  if (normalized === '') return [];
  return normalized.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
}

/**
 * Etapa 3 — DR-39. Cada token entre aspas duplas (aspas interna duplicada); junção por AND
 * implícito; só o último token recebe prefixo. `null` quando não sobra token — a consulta
 * vira busca por filtros, nunca MATCH vazio.
 */
export function buildFtsMatch(tokens: readonly string[]): string | null {
  if (tokens.length === 0) return null;
  const quoted = tokens.map((t) => `"${t.replaceAll('"', '""')}"`);
  const last = quoted.length - 1;
  quoted[last] = `${quoted[last]}*`;
  return quoted.join(' ');
}
