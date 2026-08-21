// `voiceCoordinator` — L2. Roster de voz, tickets de sessão e revogação (§17.4, A22).
//
// Ponto único de entrada do módulo: o codec/gerente client-side dos tickets
// (`./tickets.ts`), a orquestração host-side das sessões de voz (`./host.ts`) e a camada
// de decisão da sessão de tela — captureToken e teto de espectadores (§17.5, A19).

export * from './tickets.ts';
export * from './host.ts';
export * from './share.ts';
