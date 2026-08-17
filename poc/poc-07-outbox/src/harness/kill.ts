// Injeção de `SIGKILL` em ponto nomeado — a matriz de crash de §28.3.
//
// A morte é **auto-infligida**: o processo alvo chega ao ponto e se mata. Matar de fora
// (`kill` do orquestrador) não serve para este gate — não há como garantir que o sinal chegue
// exatamente entre `await append` e a resposta, e é justamente essa janela que a hipótese
// interroga. Auto-infligido, o ponto é determinístico e reproduzível.
//
// `SIGKILL` e não `SIGTERM` de propósito: §28.3 exige que a durabilidade **não** dependa de
// shutdown limpo ("qualquer dependência de shutdown limpo para durabilidade" é reprovação).
// Um handler de `SIGTERM` que fechasse o core mediria a coisa errada.

/** Os pontos da matriz. O nome é o contrato entre o orquestrador e o processo alvo. */
export type KillPoint =
  /** Antes de o host chamar `core.append` — a op não pode existir no log. */
  | 'host:before-append'
  /**
   * Depois de `await core.append(...)` resolver e **antes** de responder o ACK. É o ponto que
   * §10.7.1 tornou o único da antiga dupla "entre append e flush": ali não há dois instantes.
   * O oráculo: a op está no log, o cliente não recebeu ACK, e a reconciliação (§11.6) tem de
   * removê-la da outbox por observação da própria réplica.
   */
  | 'host:after-append-before-ack'
  /** Depois de o cliente receber o ACK e antes de gravar `acked_seq`. */
  | 'client:after-ack-before-persist'
  /** Depois de gravar `acked_seq`, antes de qualquer outra coisa. */
  | 'client:after-persist'
  /** Entre o commit de `view.db` e o de `manifest.db` — a barreira de §10.5. */
  | 'client:between-view-and-manifest'
  /** Durante `wal_checkpoint(TRUNCATE)`. */
  | 'client:during-checkpoint'
  /** Antes de a transação de enfileiramento commitar (§10.7, "atômico e durável"). */
  | 'client:before-enqueue-commit'
  /** Depois de a transação de enfileiramento commitar. */
  | 'client:after-enqueue-commit';

export const KILL_POINTS: readonly KillPoint[] = [
  'host:before-append',
  'host:after-append-before-ack',
  'client:after-ack-before-persist',
  'client:after-persist',
  'client:between-view-and-manifest',
  'client:during-checkpoint',
  'client:before-enqueue-commit',
  'client:after-enqueue-commit',
];

/** Código de saída de um processo morto por `SIGKILL` visto pelo pai (`128 + 9`). */
export const SIGKILL_EXIT = 137;

type Armed = { readonly point: KillPoint; after: number };

let armed: Armed | null = null;

/**
 * Lê `POC07_KILL_AT` (`<ponto>` ou `<ponto>@<n>`) do ambiente. `@n` mata na n-ésima vez que o
 * ponto é alcançado, contando de 1 — é o que põe a morte no meio do fluxo, e não na primeira
 * op, onde quase nada ainda está em jogo.
 */
export function armFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  const raw = env.POC07_KILL_AT;
  if (raw === undefined || raw === '') {
    armed = null;
    return;
  }
  const [point, nth] = raw.split('@') as [KillPoint, string | undefined];
  armed = { point, after: nth === undefined ? 1 : Number(nth) };
}

/**
 * Chamado no ponto nomeado. Se for o ponto armado e a contagem chegou, o processo morre
 * **agora** — sem `await`, sem `flush`, sem handler. Devolve normalmente em qualquer outro
 * caso, para que o código de produção do harness não tenha ramo de teste espalhado.
 */
export function killPoint(point: KillPoint): void {
  if (armed === null || armed.point !== point) return;
  armed.after -= 1;
  if (armed.after > 0) return;
  // `process.kill` no próprio pid com SIGKILL: o kernel derruba sem dar chance a nada.
  process.kill(process.pid, 'SIGKILL');
}

/** Para o orquestrador: o ponto está armado neste processo? Só para log. */
export function armedPoint(): KillPoint | null {
  return armed?.point ?? null;
}
