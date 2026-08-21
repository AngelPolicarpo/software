// `shareStar` — L2. Sessão de tela em estrela, autorização, qualidade por espectador e
// saúde (§17.5, §6.16, §RPC `share.*`, A19/A22).
//
// Ponto único de entrada do módulo: as sessões host-side com captureToken
// (`./sessions.ts`) e o monitor de `share.health` (`./health.ts`).

export * from './sessions.ts';
export * from './health.ts';
