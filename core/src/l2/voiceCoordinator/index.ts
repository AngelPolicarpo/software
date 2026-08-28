// `voiceCoordinator` — L2. Roster de voz, tickets de sessão e revogação (§17.4, A22).
//
// Ponto único de entrada do módulo: o codec/gerente client-side dos tickets
// (`./tickets.ts`) e a orquestração host-side das sessões de voz (`./host.ts`). A sessão
// de tela é do módulo `shareStar` (fase 8) — a camada de decisão que nasceu aqui no G8
// migrou para `../shareStar/` (§25).

export * from './tickets.ts';
// §16.4 (emenda de 2026-08-28) — a fila de karaokê do modo fila, efêmera como o roster.
export * from './queue.ts';
export * from './host.ts';
