// `swarm` — L0. Orquestração de rede P2P de §14.
//
// §4: depende só de `config`. Não contém regra de domínio — a decisão de autorizar
// replicação lives no `fold`/`DecisionState`, este módulo apenas a consulta.
// §14.2: escalonador multicomunidade com orçamento, reservas e anti-starvation.
// §14.3: autorização de canal por comunidade + firewall de conexão corrigido.
// §14.5: sinais de replicação são do `communityClient`; o swarm apenas expõe `degraded`.

import type { SwarmBackendPort } from './ports.ts';

export type SwarmConnectionBudget = {
  readonly swarmMaxConnections: number;
  readonly hostMaxPeers: number;
  readonly bgRotationMs: number;
  readonly preMemberBudget: number;
};

export const DEFAULT_SWARM_BUDGET: SwarmConnectionBudget = {
  swarmMaxConnections: 128,
  hostMaxPeers: 256,
  bgRotationMs: 60_000,
  preMemberBudget: 8,
};

/**
 * §14.3(1)(2): autoriza abrir canal `protomux` de replicação para o core de uma
 * comunidade. Cada nó consulta o próprio `DecisionState` daquela comunidade.
 * `memberActive && !banned` → abre, senão recusa com `E_NOT_AUTHORIZED_FOR_COMMUNITY`.
 */
export function authorizeReplicationChannel(args: {
  readonly isMemberActive: boolean;
  readonly banned: boolean;
}): boolean {
  return args.isMemberActive && !args.banned;
}

/**
 * §14.3(4): firewall de conexão (`hyperswarm.firewall`) corrigido.
 * Só recusa a conexão TCP/UDX quando o par está banido em **todas** as comunidades
 * que este nó tem em comum com ele. Banido em A e membro de B → abre e replica só B.
 * Pré-membro (§12.3) é exceto de (4) — aceita qualquer par.
 */
export function firewallShouldRejectConnection(args: {
  readonly commonCommunityIds: readonly string[];
  readonly bannedIn: (communityId: string) => boolean;
  readonly isPreMemberChannel: boolean;
}): boolean {
  if (args.isPreMemberChannel) return false;
  if (args.commonCommunityIds.length === 0) return false;
  return args.commonCommunityIds.every((id) => args.bannedIn(id));
}

/**
 * §14.2: escalonador de conexões entre comunidades.
 *
 * - Orçamento total: SWARM_MAX_CONNECTIONS (default 128)
 * - Reserva ativa: 40% do orçamento, mínimo 8
 * - Reserva host: 40% por comunidade hospedada, teto HOST_MAX_PEERS
 * - Restante: round-robin entre comunidades de background
 * - Garantia anti-starvation: toda background recebe ≥1 janela a cada BG_ROTATION_MS
 *
 * A função é pura e testável — não toca rede. Quem chama decide repriorização
 * periódica com base em a atividade.
 */
export function allocateConnections(args: {
  readonly communityIds: readonly string[];
  readonly activeCommunityId: string | null;
  readonly hostedCommunityIds: ReadonlySet<string>;
  readonly budget?: SwarmConnectionBudget;
}): ReadonlyMap<string, number> {
  const budget = args.budget ?? DEFAULT_SWARM_BUDGET;
  const total = budget.swarmMaxConnections;
  const activeId = args.activeCommunityId;
  const hosted = args.hostedCommunityIds;
  const all = [...args.communityIds];

  if (all.length === 0) return new Map();

  const allocation = new Map<string, number>();

  // 40% para ativa, mínimo 8 (quando há ativa)
  let remaining = total;
  if (activeId !== null && all.includes(activeId)) {
    const activeReserve = Math.max(8, Math.floor(total * 0.4));
    const give = Math.min(activeReserve, remaining);
    allocation.set(activeId, give);
    remaining -= give;
  }

  // 40% por hospedada, até HOST_MAX_PEERS cada, mas limitado ao restante
  for (const hid of hosted) {
    if (!all.includes(hid)) continue;
    // se já recebeu como ativa, não duplica
    if (allocation.has(hid)) continue;
    const hostReserve = Math.min(budget.hostMaxPeers, Math.floor(total * 0.4));
    const give = Math.min(hostReserve, remaining, Math.max(1, Math.floor(remaining / 2)));
    if (give <= 0) break;
    allocation.set(hid, give);
    remaining -= give;
    if (remaining <= 0) break;
  }

  // Restante round-robin para background
  const background = all.filter((id) => !allocation.has(id));
  if (background.length > 0 && remaining > 0) {
    const perBg = Math.max(1, Math.floor(remaining / background.length));
    for (const id of background) {
      const give = Math.min(perBg, remaining);
      if (give <= 0) break;
      allocation.set(id, give);
      remaining -= give;
    }
    // sobra distribui 1 a 1
    let idx = 0;
    while (remaining > 0) {
      const id = background[idx % background.length]!;
      allocation.set(id, (allocation.get(id) ?? 0) + 1);
      remaining--;
      idx++;
    }
  }

  // Anti-starvation: garante ≥1 para todo background mesmo quando saturado
  // (quando remaining zerou antes de atender todos, redistribui 1 de quem tem >1)
  for (const id of background) {
    if ((allocation.get(id) ?? 0) === 0) {
      // rouba 1 de quem tem mais de 1
      for (const [donor, count] of allocation) {
        if (count > 1) {
          allocation.set(donor, count - 1);
          allocation.set(id, 1);
          break;
        }
      }
    }
  }

  return allocation;
}

export type SwarmTopicKind = 'community-log' | 'member-blobs' | 'invite';

export type SwarmTopic = {
  readonly topicHex: string;
  readonly kind: SwarmTopicKind;
  readonly communityId: string | null;
};

export type SwarmPeer = {
  readonly publicKeyHex: string;
  readonly address?: string;
};

export type SwarmStats = {
  readonly peerCount: number;
  readonly degraded: boolean;
  readonly byCommunity: ReadonlyArray<{ readonly communityId: string; readonly peers: number }>;
};

export type SwarmOptions = {
  readonly budget?: SwarmConnectionBudget;
  readonly bootstrapReachable?: boolean;
  /**
   * Backend de rede. Ausente = modo memória (`simulatePeer`), que é o da suíte unitária de
   * §14.2/§14.3. Presente = `HyperswarmBackend`, e os pares vêm da DHT. A fachada é a mesma
   * nos dois casos — é isso que mantém as regras puras testáveis sem rede.
   */
  readonly backend?: SwarmBackendPort;
};

/**
 * `Swarm` L0 — fachada injetável sobre Hyperswarm.
 *
 * Em produção envolve `hyperdht`/`hyperswarm` real (§14.1). Na suíte unitária opera
 * em modo memória, com `join`/`leave` e contagem de peers simulada — o suficiente
 * para exercitar §14.2/§14.3 sem rede. `swarm` nunca decide autorização sozinha:
 * quem decide é o `DecisionState` via `authorizeReplicationChannel`.
 */
export class Swarm {
  readonly #budget: SwarmConnectionBudget;
  #backend: SwarmBackendPort | null;
  #bootstrapReachable: boolean;
  #topics = new Map<string, SwarmTopic>();
  /** Papel de §14.1 por tópico — o que `attachBackend` repete ao backend que chega depois. */
  #roles = new Map<string, { server: boolean; client: boolean }>();
  #peerCountByTopic = new Map<string, Set<string>>();
  #onConnection: ((peer: SwarmPeer) => void) | undefined = undefined;

  constructor(opts: SwarmOptions = {}) {
    this.#budget = opts.budget ?? DEFAULT_SWARM_BUDGET;
    this.#bootstrapReachable = opts.bootstrapReachable ?? true;
    this.#backend = opts.backend ?? null;
  }

  /**
   * Liga o backend de produto DEPOIS do construtor. O caso é o shell que só tem rede quando
   * tem identidade (§14.3 — o par do swarm É o par da identidade, então não há backend antes
   * dela): o boot nasce em modo memória e este método anexa o backend quando o par existe.
   * Reemite os tópicos já pedidos com o papel de §14.1 — join anterior ao anexo não pode
   * morrer na memória. Idempotente: o primeiro backend vence.
   */
  attachBackend(backend: SwarmBackendPort): void {
    if (this.#backend !== null) return;
    this.#backend = backend;
    for (const [topicHex, topic] of this.#topics) {
      const role = this.#roles.get(topicHex);
      if (role === undefined) continue;
      backend.join(topicHex, topic, role);
    }
  }

  /** O backend real, quando existe — quem monta o grafo põe o `Protomux` nas conexões dele. */
  get backend(): SwarmBackendPort | null {
    return this.#backend;
  }

  /**
   * §14.1 — `role` diz quem anuncia e quem procura o tópico na DHT: o host da comunidade
   * anuncia (`server`), o membro procura (`client`). O default é o do membro, porque é o
   * caso de toda comunidade que esta instalação apenas replica.
   */
  join(topicHex: string, topic: SwarmTopic, role: { server: boolean; client: boolean } = { server: false, client: true }): void {
    this.#topics.set(topicHex, topic);
    this.#roles.set(topicHex, role);
    if (!this.#peerCountByTopic.has(topicHex)) {
      this.#peerCountByTopic.set(topicHex, new Set());
    }
    this.#backend?.join(topicHex, topic, role);
  }

  leave(topicHex: string): void {
    this.#topics.delete(topicHex);
    this.#roles.delete(topicHex);
    this.#peerCountByTopic.delete(topicHex);
    this.#backend?.leave(topicHex);
  }

  /** Anúncio/consulta concluídos na DHT. Sem backend não há o que esperar. */
  async flush(): Promise<void> {
    await this.#backend?.flush();
  }

  isJoined(topicHex: string): boolean {
    return this.#topics.has(topicHex);
  }

  listTopics(): SwarmTopic[] {
    return [...this.#topics.values()];
  }

  /** Simula chegada de peer para teste — em produção vem do Hyperswarm. */
  simulatePeer(topicHex: string, peerKeyHex: string): void {
    const set = this.#peerCountByTopic.get(topicHex);
    if (set === undefined) return;
    set.add(peerKeyHex);
    this.#onConnection?.({ publicKeyHex: peerKeyHex });
  }

  simulatePeerLeave(topicHex: string, peerKeyHex: string): void {
    this.#peerCountByTopic.get(topicHex)?.delete(peerKeyHex);
  }

  onConnection(listener: (peer: SwarmPeer) => void): () => void {
    this.#onConnection = listener;
    const offBackend = this.#backend?.onConnection((conn) => listener({ publicKeyHex: conn.remotePublicKeyHex }));
    return () => {
      offBackend?.();
      if (this.#onConnection === listener) this.#onConnection = undefined;
    };
  }

  getStats(byCommunityPeers?: ReadonlyMap<string, number>): SwarmStats {
    const byCommunity: Array<{ communityId: string; peers: number }> = [];
    let total = 0;
    if (byCommunityPeers !== undefined) {
      for (const [cid, peers] of byCommunityPeers) {
        byCommunity.push({ communityId: cid, peers });
        total += peers;
      }
    } else {
      // deriva de tópicos do tipo community-log
      const perCommunity = new Map<string, number>();
      for (const [topicHex, peers] of this.#peerCountByTopic) {
        const t = this.#topics.get(topicHex);
        if (t?.kind !== 'community-log' || t.communityId === null) continue;
        perCommunity.set(t.communityId, (perCommunity.get(t.communityId) ?? 0) + peers.size);
      }
      for (const [cid, peers] of perCommunity) {
        byCommunity.push({ communityId: cid, peers });
        total += peers;
      }
    }
    const degraded = !this.#bootstrapReachable;
    // Com backend real, `peerCount` é o número de conexões vivas — não a soma por tópico:
    // um par que traz duas comunidades é **uma** conexão, e §14.2 conta conexões.
    const peerCount = this.#backend === null ? total : this.#backend.connectionCount();
    return { peerCount, degraded, byCommunity };
  }

  setBootstrapReachable(v: boolean): void {
    this.#bootstrapReachable = v;
  }

  get budget(): SwarmConnectionBudget {
    return this.#budget;
  }

  /** §14.2: expõe o escalonador puro para quem compõe o boot. */
  allocateForCommunities(
    communityIds: readonly string[],
    activeCommunityId: string | null,
    hostedCommunityIds: ReadonlySet<string>,
  ): ReadonlyMap<string, number> {
    return allocateConnections({
      communityIds,
      activeCommunityId,
      hostedCommunityIds,
      budget: this.#budget,
    });
  }
}
