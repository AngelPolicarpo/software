// `relay` — L2. Voluntariado TURN: consentimento persistido, chave derivada da identidade,
// prova de posse (R-19), TTL renovável e cota (§17.7, A21).
//
// Ponto único de entrada do módulo: derivação/posse (`./keys.ts`), cota do TURN restrito
// (`./quota.ts`) e o ciclo de vida por comunidade (`./volunteer.ts`).

export * from './keys.ts';
export * from './quota.ts';
export * from './volunteer.ts';
