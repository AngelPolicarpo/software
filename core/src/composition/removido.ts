// §18.4 — o ciclo de vida do dado no cliente do ALVO (B7, fecha `F-35`/`DR-35`).
//
// A seção descreve seis passos e o produto tinha o sexto: `removed.purge` apagava a réplica
// no `retain_until`, `community.forget` a apagava antes, e `query.selfModeration` sabia
// dizer o que aconteceu. Faltava quem **começasse** — nada no produto escrevia
// `removed_reason` nem `retain_until`, então:
//
//   - `community.forget` recusava sempre (`E_VALIDATION`: exige `left_at` ou
//     `removed_reason`, e nenhum dos dois era preenchido por ninguém);
//   - `removed.purge` nunca tinha o que purgar;
//   - `community.activate` nunca recusava uma comunidade removida;
//   - e o banido ficava em `reconnecting` honesto, tentando para sempre um host que passou
//     a recusá-lo — sem a tela de modo histórico de U-16.
//
// O gatilho é o `fold` LOCAL, e é assim que §18.4 o define: "ao observar no próprio `fold`
// um `mod.ban`/`mod.kick` cujo alvo é a identidade local". Em v2 isso é alcançável porque o
// alvo continua replicando até aplicar o ban (§14.3) — ele *vê* o próprio ban antes de
// perder acesso, que é o mesmo argumento que torna alcançáveis os motivos `banned`/`kicked`
// de §11.7.
//
// O segundo gatilho é o watchdog: `E_NOT_AUTHORIZED_FOR_COMMUNITY` de todos os pares vira
// `unauthorized` (§14.5), e §18.4 trata os dois pelo mesmo caminho.

import type { ManifestDb } from '../l0/manifest/index.ts';
import type { ViewDb } from '../l0/view/index.ts';

/** §18.4 passo 2 — os valores que `manifest.communities.removed_reason` aceita. */
export type CausaDeRemocao = 'banned' | 'kicked' | 'unauthorized' | 'left';

/** Recorte do `DecisionState` que esta decisão lê. Nada além disto. */
export type EstadoDeRemocao = {
  readonly members: ReadonlyMap<string, { readonly state: 'active' | 'left' | 'banned'; readonly joinedAt: number }>;
};

/**
 * Observa o próprio estado no `fold` e diz por que esta instalação saiu — ou `null` se ela
 * não saiu.
 *
 * `banned` sai do estado do membro. `left` e `kicked` compartilham `state: 'left'` e só se
 * distinguem pela auditoria: um kick sobre mim **dentro da membresia corrente**
 * (`at >= joinedAt`) é kick; sem ele, a saída foi minha. É a mesma derivação que
 * `query.selfModeration` já faz para a tela, e mantê-las iguais é o que impede o cabeçalho
 * de U-16 dizer uma coisa e o `removed_reason` outra.
 *
 * Membro **ausente** do mapa não é remoção: é réplica que ainda não interpretou o `member.join`
 * (boot, primeira replicação). Tratá-lo como saída apagaria a comunidade de quem acabou de
 * entrar nela.
 */
export function causaDaPropriaSaida(
  estado: EstadoDeRemocao,
  selfKeyHex: string,
  kicksSobreMim: (desde: number) => boolean,
): CausaDeRemocao | null {
  const eu = estado.members.get(selfKeyHex);
  if (eu === undefined) return null;
  if (eu.state === 'banned') return 'banned';
  if (eu.state !== 'left') return null;
  return kicksSobreMim(eu.joinedAt) ? 'kicked' : 'left';
}

export type RemocaoDeps = {
  readonly manifest: ManifestDb;
  readonly view: ViewDb;
  readonly now: () => number;
  /** `P2P_REMOVED_RETENTION_DAYS` de §27.2 (default 7). */
  readonly retentionDays: number;
  /** §18.4 passo 1 — para o rpcClient e sai do swarm daquela comunidade. */
  readonly desligarDaRede: (communityId: string) => void;
  /** §18.4 passo 3 — descarte da fila com o motivo nomeado de §11.7. */
  readonly descartarFila: (communityId: string, motivo: 'banned' | 'kicked') => number;
  /** §18.4 passo 4 — `community.accessRevoked{cause}` ao renderer. */
  readonly emitir: (communityId: string, cause: CausaDeRemocao) => void;
};

/** Um kick sobre esta identidade registrado a partir de `desde` (auditoria de §6.13). */
export function kicksSobreMimEm(view: ViewDb, communityId: string, selfKeyHex: string): (desde: number) => boolean {
  return (desde) => {
    const linha = view
      .prepare("SELECT 1 AS achou FROM moderation_log WHERE community_id = ? AND type = 'kick' AND target_id = ? AND at >= ? LIMIT 1")
      .get(communityId, selfKeyHex, desde) as { achou: number } | undefined;
    return linha !== undefined;
  };
}

/**
 * §18.4 passos 1–4, na ordem da seção. Idempotente: uma comunidade que já entrou em modo
 * removido não é reprocessada — cada lote projetado passa por aqui, e refazer os passos
 * empurraria `retain_until` para a frente a cada op nova, que é o oposto do prazo.
 *
 * Devolve a causa quando ACABOU de entrar em modo removido; `null` nas demais vezes.
 */
export function aplicarRemocaoPropria(
  deps: RemocaoDeps,
  a: { readonly communityId: string; readonly causa: CausaDeRemocao },
): CausaDeRemocao | null {
  const linha = deps.manifest.getCommunity(a.communityId) as
    | { left_at: number | null; removed_reason: string | null }
    | null;
  if (linha === null) return null;
  // Já em modo removido: nada a refazer. O prazo é do primeiro instante, não do último lote.
  if (linha.removed_reason !== null) return null;

  const agora = deps.now();

  // 1. para o rpcClient e sai do swarm daquela comunidade
  deps.desligarDaRede(a.communityId);

  // 2. marca o motivo e o prazo
  deps.manifest.marcarRemovida(a.communityId, {
    reason: a.causa,
    leftAt: linha.left_at ?? agora,
    retainUntil: agora + deps.retentionDays * 24 * 60 * 60 * 1000,
  });

  // 3. descarta a fila com o motivo nomeado (§11.7). `left` já teve a própria fila
  //    descartada por `discardForLeave`, e `unauthorized` não é motivo de §11.7 — nesses
  //    dois casos não há descarte a fazer aqui.
  if (a.causa === 'banned' || a.causa === 'kicked') deps.descartarFila(a.communityId, a.causa);

  // 4. o renderer precisa saber, e é o que abre a tela de U-16
  deps.emitir(a.communityId, a.causa);

  // 5 e 6 são de outros donos: a comunidade continua no rail em modo histórico (renderer,
  // por `query.selfModeration`), e a réplica sai em `retain_until` (`removed.purge`) ou por
  // `community.forget`.
  return a.causa;
}
