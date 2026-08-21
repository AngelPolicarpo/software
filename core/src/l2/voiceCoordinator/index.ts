// `voiceCoordinator` — L2. Roster de voz, tickets de sessão e revogação (§17.4, A22).
//
// Ponto único de entrada do módulo: o codec/gerente client-side dos tickets
// (`./tickets.ts`) e a orquestração host-side das sessões de voz (`./host.ts`).

export * from './tickets.ts';
export * from './host.ts';
