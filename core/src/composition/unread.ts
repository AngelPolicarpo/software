// Não-lidas de §6.15 — o recálculo que a UI lê em `query.structure` e no agregado de
// `query.communities`. Raiz de composição (§4), e é **decisão registrada** que mora aqui e
// não no `projector`:
//
//   1. `local_read_state` mora no `manifest.db` (LS, §6.15), e o `Effect` de §8.4 é tipo
//      fechado sobre as tabelas de CS da `view.db` — o projector não tem por onde escrever;
//   2. estado de leitura é **por instalação**: pô-lo no `fold` faria o mesmo log produzir
//      contagens diferentes em cada réplica, o que §8.0 proíbe;
//   3. o que o lote projetado fornece é o GATILHO: este serviço assina o gancho de
//      `notifyProjected` (o mesmo passo síncrono do fan-out, §10.7) e reconta com a MESMA
//      query que define a contagem (`seq > lastReadSeq`) — nunca um acumulador, que é o
//      que fecha F-25/F-48 sem contagem dupla.
//
// Incrementalidade: cada comunidade carrega uma marca em memória do último `interpretedSeq`
// processado. A cada lote são recontados os canais tocados pela janela `(marca, agora]`
// MAIS todo canal que já tem linha armazenada — porque mutação de linha velha (edição,
// tombstone e, principalmente, a ocultação/reversão de ban por `patchScope`, que não muda
// `seq`) só pode alterar contagem onde existe não-lida. O primeiro lote depois do attach
// (boot ou reprojeção total) varre do zero e cria linha para todo canal ativo — é o
// "recomputado do zero" de §615. Mudança nos cargos da identidade local também derruba a
// marca: `pendingMentions` depende deles.

import type { ManifestDb } from '../l0/manifest/index.ts';
import type { ViewDb } from '../l0/view/index.ts';
import type { DecisionState } from '../l1/fold/index.ts';

export type UnreadDeps = {
  readonly manifest: ManifestDb;
  readonly view: ViewDb;
  /** O projector da comunidade aberta, ou `null` quando ela não está aberta aqui. */
  comunidade(communityId: string): { readonly interpretedSeq: number; readonly ds: DecisionState } | null;
  selfKeyHex(): string | null;
  /** Porta do fan-out de §15.5 — mesma forma de `EventFanout.emit`. */
  emit(ev: { topic: string; data: Readonly<Record<string, unknown>> }, route: { communityId: string }): void;
};

/** As menções de uma mensagem, na forma de §15.6.1 (mesma leitura das consultas). */
function mencoes(raw: unknown): { identityKeys: Set<string>; roleIds: Set<string>; everyone: boolean } {
  const out = { identityKeys: new Set<string>(), roleIds: new Set<string>(), everyone: false };
  if (typeof raw !== 'string') return out;
  let lista: unknown;
  try {
    lista = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!Array.isArray(lista)) return out;
  for (const item of lista) {
    if (item === 'everyone') out.everyone = true;
    else if (typeof item === 'string' && /^[0-9a-f]{64}$/.test(item)) out.identityKeys.add(item);
    else if (typeof item === 'string') out.roleIds.add(item);
  }
  return out;
}

export class UnreadTracker {
  readonly #deps: UnreadDeps;
  /** Último `interpretedSeq` incorporado por comunidade. Ausente = próximo lote é "do zero". */
  readonly #marca = new Map<string, number>();
  /** Assinatura dos cargos ativos da identidade local — mudou, reconta do zero. */
  readonly #cargos = new Map<string, string>();

  constructor(deps: UnreadDeps) {
    this.#deps = deps;
  }

  /** Assina o gancho de lote projetado do runtime. O retorno desassina (para testes). */
  attach(runtime: { onProjected(cb: (communityId: string) => void): () => void }): void {
    runtime.onProjected((cid) => this.recalc(cid));
  }

  /** Derruba a marca: o próximo lote reconta do zero (reprojeção total). */
  invalidate(communityId: string): void {
    this.#marca.delete(communityId);
    this.#cargos.delete(communityId);
  }

  /** Cargos ativos da identidade local nesta comunidade — a assinatura que vigia mudanças. */
  #meusCargos(ds: DecisionState, eu: string): Set<string> {
    const m = ds.members.get(eu);
    if (m === undefined) return new Set();
    const ativos = new Set<string>();
    for (const id of m.roleIds) {
      const r = ds.roles.get(id);
      if (r !== undefined && r.deletedAt === undefined) ativos.add(id);
    }
    return ativos;
  }

  /**
   * Reconta o que o último lote atingiu. Idempotente e barato quando nada mudou: a marca
   * iguala o `interpretedSeq` e o passe inteiro vira um early-return.
   */
  recalc(communityId: string): void {
    const c = this.#deps.comunidade(communityId);
    if (c === null || !c.ds.community.exists) return;
    const eu = this.#deps.selfKeyHex();
    if (eu === null) return;

    const ate = c.interpretedSeq;
    const marca = this.#marca.get(communityId);
    if (marca !== undefined && ate <= marca) return;

    const meusCargos = this.#meusCargos(c.ds, eu);
    const assinatura = [...meusCargos].sort().join(',');
    const doZero = marca === undefined || this.#cargos.get(communityId) !== assinatura;
    // A janela cobre appends, edições, tombstones e qualquer patch cuja linha tenha `seq`
    // acima da marca. Linhas velhas ficam por conta do conjunto de canais com linha.
    const janela = Math.max(marca ?? -1, -1);

    const alvoCanais = new Set<string>();
    if (doZero) {
      for (const r of this.#deps.view.prepare('SELECT id FROM channels WHERE community_id = ? AND deleted_at IS NULL').all(communityId) as Array<{ id: string }>) {
        alvoCanais.add(r.id);
      }
    } else {
      for (const r of this.#deps.view.prepare('SELECT DISTINCT channel_id AS ch FROM messages WHERE community_id = ? AND seq > ?').all(communityId, janela) as Array<{ ch: string }>) {
        alvoCanais.add(r.ch);
      }
    }
    // Canais já conhecidos desta instalação: é neles que uma linha VELHA pode ter mudado de
    // lado (edição, delete, ocultação de ban, reversão de ban) sem mover `seq`.
    for (const r of this.#deps.manifest.listReadStates(communityId)) alvoCanais.add(r.channelId);

    for (const channelId of alvoCanais) this.#recontarCanal(communityId, channelId, eu, meusCargos);

    // Threads: mesmo esqueleto. Do zero, todas as threads conhecidas entram; senão, as que
    // tiveram atividade na janela mais as que já têm linha armazenada.
    const alvoThreads = new Set<string>();
    if (doZero) {
      for (const r of this.#deps.view.prepare('SELECT id FROM threads WHERE community_id = ?').all(communityId) as Array<{ id: string }>) {
        alvoThreads.add(r.id);
      }
    } else {
      for (const r of this.#deps.view.prepare('SELECT DISTINCT thread_id AS th FROM messages WHERE community_id = ? AND seq > ? AND thread_id IS NOT NULL').all(communityId, janela) as Array<{ th: string }>) {
        alvoThreads.add(r.th);
      }
    }
    for (const r of this.#deps.manifest.listThreadReadStates(communityId)) alvoThreads.add(r.threadId);
    for (const threadId of alvoThreads) this.#recontarThread(communityId, threadId, eu);

    this.#marca.set(communityId, ate);
    this.#cargos.set(communityId, assinatura);
  }

  #recontarCanal(communityId: string, channelId: string, eu: string, meusCargos: ReadonlySet<string>): void {
    const anterior = this.#deps.manifest.getReadState(communityId, channelId);
    const linhas = this.#deps.view
      .prepare(
        'SELECT seq, mentions, mention_everyone_effective AS everyoneEfetivo FROM messages ' +
          'WHERE community_id = ? AND channel_id = ? AND seq > ? AND lower(hex(author_key)) <> ? AND deleted_at IS NULL AND hidden_by_ban = 0 ORDER BY seq ASC',
      )
      .all(communityId, channelId, anterior.lastReadSeq, eu) as Array<{ seq: number; mentions: unknown; everyoneEfetivo: number }>;
    let pendingMentions = 0;
    for (const r of linhas) {
      if (mencionaEu(r.mentions, Number(r.everyoneEfetivo) === 1, eu, meusCargos)) pendingMentions += 1;
    }
    const primeiro = linhas[0];
    const novo = {
      lastReadSeq: anterior.lastReadSeq,
      firstUnreadSeq: primeiro !== undefined ? primeiro.seq : null,
      unreadCount: linhas.length,
      pendingMentions,
    };
    if (
      novo.firstUnreadSeq === anterior.firstUnreadSeq &&
      novo.unreadCount === anterior.unreadCount &&
      novo.pendingMentions === anterior.pendingMentions
    ) {
      return;
    }
    this.#deps.manifest.setReadState(communityId, channelId, novo);
    // §15.5 — sinal para reconsultar, com os campos exatos da tabela de §6.15.
    this.#deps.emit(
      { topic: 'unread.changed', data: { communityId, channelId, unreadCount: novo.unreadCount, pendingMentions: novo.pendingMentions } },
      { communityId },
    );
  }

  #recontarThread(communityId: string, threadId: string, eu: string): void {
    const anterior = this.#deps.manifest.getThreadReadState(communityId, threadId);
    const total = (
      this.#deps.view
        .prepare(
          'SELECT COUNT(*) AS n FROM messages WHERE community_id = ? AND thread_id = ? AND seq > ? AND lower(hex(author_key)) <> ? AND deleted_at IS NULL AND hidden_by_ban = 0',
        )
        .get(communityId, threadId, anterior.lastReadSeq, eu) as { n: number }
    ).n;
    // A linha é escrita sempre que a thread está no escopo — mesmo com contagem zero —,
    // porque é ela que coloca a thread no conjunto "já conhecido" e garante que mutação
    // de linha velha seja vista depois. O evento só sai quando o número muda.
    const mudou = total !== anterior.unreadCount;
    this.#deps.manifest.setThreadReadState(communityId, threadId, { lastReadSeq: anterior.lastReadSeq, unreadCount: total });
    if (mudou) {
      this.#deps.emit({ topic: 'unread.changed', data: { communityId, threadId, unreadCount: total } }, { communityId });
    }
  }

  /**
   * `channel.markRead`: o watermark avança para a cabeça do canal e o canal é recontado NA
   * HORA — a resposta `{unreadCount: 0, pendingMentions: 0}` de §15.4 é literal (RT-03),
   * não promessa.
   */
  marcarCanalLido(communityId: string, channelId: string): { unreadCount: number; pendingMentions: number } {
    const eu = this.#deps.selfKeyHex() ?? '';
    const c = this.#deps.comunidade(communityId);
    const meusCargos = c === null ? new Set<string>() : this.#meusCargos(c.ds, eu);
    const anterior = this.#deps.manifest.getReadState(communityId, channelId);
    const cabeca = this.#deps.view.prepare('SELECT MAX(seq) AS head FROM messages WHERE community_id = ? AND channel_id = ?').get(communityId, channelId) as {
      head: number | null;
    };
    const lastReadSeq = cabeca.head ?? anterior.lastReadSeq;
    this.#deps.manifest.setReadState(communityId, channelId, { ...anterior, lastReadSeq });
    this.#recontarCanal(communityId, channelId, eu, meusCargos);
    const depois = this.#deps.manifest.getReadState(communityId, channelId);
    return { unreadCount: depois.unreadCount, pendingMentions: depois.pendingMentions };
  }

  /** `thread.markRead` — mesmo contrato, sobre `local_thread_read_state` (§6.15, DR-48). */
  marcarThreadLida(communityId: string, threadId: string): { unreadCount: number } {
    const anterior = this.#deps.manifest.getThreadReadState(communityId, threadId);
    const cabeca = this.#deps.view.prepare('SELECT MAX(seq) AS head FROM messages WHERE community_id = ? AND thread_id = ?').get(communityId, threadId) as {
      head: number | null;
    };
    const lastReadSeq = cabeca.head ?? anterior.lastReadSeq;
    this.#deps.manifest.setThreadReadState(communityId, threadId, { lastReadSeq, unreadCount: 0 });
    return { unreadCount: 0 };
  }
}

/** `pendingMentions` de §6.15: identidade, cargo meu, ou `everyone` EFETIVO (R-13). */
function mencionaEu(raw: unknown, everyoneEfetivo: boolean, eu: string, meusCargos: ReadonlySet<string>): boolean {
  const m = mencoes(raw);
  return m.identityKeys.has(eu) || (m.everyone && everyoneEfetivo) || [...m.roleIds].some((r) => meusCargos.has(r));
}
