// `search` — L2. FTS5 sobre `CS` (§23) — consulta pura; nada de rede.
//
// Ponto único de entrada do módulo: pipeline de texto (`./text.ts`) e o serviço de
// consulta sobre `view.db` (`./service.ts`). O índice é mantido pelo `projector` na
// transação dos efeitos (§10.3); a composição injeta o `ViewDb` no boot.

export {
  SEARCH_DEFAULT_LIMIT_PER_GROUP,
  SEARCH_MAX_LIMIT_PER_GROUP,
  SearchService,
  type ChannelHit,
  type MemberHit,
  type MessageHit,
  type SearchArgs,
  type SearchDateFilter,
  type SearchFilters,
  type SearchKindFilter,
  type SearchPartialReason,
  type SearchResult,
  type SearchServiceOptions,
} from './service.ts';
export { buildFtsMatch, normalizeText, tokenize } from './text.ts';
