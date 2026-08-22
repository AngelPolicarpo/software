// `succession` — L2. Escrow, detecção de inatividade, migração de comunidade (§18.8, A23).
//
// Ponto único de entrada do módulo: o escrow da semente (`./escrow.ts`), o relógio de
// inatividade (`./watch.ts`), a construção da continuação (`./continuation.ts`) e a
// camada b de R-18 com a arbitragem de L-16 (`./follow.ts`).

export * from './escrow.ts';
export * from './watch.ts';
export * from './continuation.ts';
export * from './follow.ts';
export * from './service.ts';
