// `swarm` — o backend real de §14.1/§14.3(4): um `Hyperswarm` de verdade atrás da fachada.
//
// A fachada de `index.ts` continua sendo a superfície: os módulos de L2 falam com `Swarm`,
// não com esta classe. O que muda é de onde vêm os pares — de `simulatePeer` na suíte
// unitária, do DHT aqui. A separação existe porque as regras de §14.2/§14.3 são **puras**
// (`allocateConnections`, `authorizeReplicationChannel`, `firewallShouldRejectConnection`) e
// precisam continuar testáveis sem rede; este arquivo só liga a rede a elas.
//
// §4: `swarm` depende de `config`. Nada aqui interpreta payload — a conexão é entregue crua
// a quem monta o grafo, que decide o que abrir em cima dela (§16.1).

import Hyperswarm, { type DiscoverySession, type SwarmStream } from 'hyperswarm';

import { firewallShouldRejectConnection, type SwarmTopic } from './index.ts';
import type { SwarmBackendPort, SwarmConnection } from './ports.ts';

export type HyperswarmBackendOptions = {
  readonly bootstrap?: ReadonlyArray<{ readonly host: string; readonly port: number }>;
  /**
   * **A identidade de §5.5.** Não é uma escolha de conveniência: §14.3(1) manda cada nó
   * decidir a autorização consultando o próprio `DecisionState`, onde o par é a chave
   * Ed25519 de identidade — e §5.2, que é a tabela fechada de derivações, não tem prefixo
   * para uma chave de rede separada. Se o keypair do swarm fosse outro, `remotePublicKey`
   * não diria nada sobre membro nenhum e §14.3 precisaria de um handshake de identidade em
   * banda que a spec não declara. §12.6 já lê `remotePublicKey` como "chave pública do par".
   */
  readonly keyPair?: { readonly publicKey: Buffer; readonly secretKey: Buffer };
  readonly maxPeers?: number;
  /**
   * §14.3(4) — as duas metades do firewall de conexão, injetadas porque a decisão mora no
   * `DecisionState` de cada comunidade e §4 não deixa `swarm` lê-lo. A regra que combina as
   * duas é `firewallShouldRejectConnection`, que já é pura e testada.
   */
  readonly firewall?: {
    commonCommunityIds(remotePublicKeyHex: string): readonly string[];
    bannedIn(remotePublicKeyHex: string, communityId: string): boolean;
  };
}

/** Endereço do par no recorte que o `info` do hyperswarm entrega, em qualquer variante. */
function enderecoDoPar(info: { peer?: { address?: unknown } | null }): string | undefined {
  const addr = info.peer?.address;
  if (addr === undefined || addr === null) return undefined;
  if (typeof addr === 'string') return addr;
  if (typeof addr === 'object' && 'host' in (addr as Record<string, unknown>)) {
    const host = (addr as { host?: unknown }).host;
    return typeof host === 'string' ? host : undefined;
  }
  return undefined;
}

/** Backend de produto: `Hyperswarm` sobre o `hyperdht`. */
export class HyperswarmBackend implements SwarmBackendPort {
  readonly #swarm: Hyperswarm;
  readonly #sessions = new Map<string, DiscoverySession>();
  readonly #listeners = new Set<(conn: SwarmConnection) => void>();
  /** `topicHex` → tópico, para dizer a cada conexão quais tópicos ela tem em comum. */
  readonly #topics = new Map<string, SwarmTopic>();
  readonly #live = new Set<SwarmStream>();
  /**
   * §14.3(5) — este nó tem superfície pré-membro (hospeda convite ativo)? Enquanto tiver,
   * o firewall de conexão **cede** ao canal de admissão: recusar a conexão na porta seria
   * tornar o preview `banned` inalcançável, que é exatamente o que (5) existe para evitar.
   * A autorização por comunidade (§14.3(1)) não muda — ela continua valendo canal a canal,
   * e é quem impede um banido de receber bloco. Quem assina é a composição, depois do boot.
   */
  #preMemberSurface: (() => boolean) | null = null;

  constructor(opts: HyperswarmBackendOptions = {}) {
    const firewall = opts.firewall;
    this.#swarm = new Hyperswarm({
      ...(opts.bootstrap !== undefined ? { bootstrap: [...opts.bootstrap] } : {}),
      ...(opts.keyPair !== undefined ? { keyPair: opts.keyPair } : {}),
      ...(opts.maxPeers !== undefined ? { maxPeers: opts.maxPeers } : {}),
      ...(firewall !== undefined
        ? {
            // §14.4: aplicado ANTES de qualquer trabalho criptográfico ou de decode.
            firewall: (remotePublicKey: Buffer): boolean => {
              const hex = remotePublicKey.toString('hex');
              if (this.#preMemberSurface?.() === true) return false;
              return firewallShouldRejectConnection({
                commonCommunityIds: firewall.commonCommunityIds(hex),
                bannedIn: (communityId) => firewall.bannedIn(hex, communityId),
                isPreMemberChannel: false,
              });
            },
          }
        : {}),
    });

    this.#swarm.on('connection', (stream, info) => {
      this.#live.add(stream);
      stream.once('close', () => this.#live.delete(stream));
      // `info.topics` são as discovery keys que trouxeram este par; o cruzamento com o que
      // este nó anunciou é o que diz "em comum" — nunca o que o par afirma.
      const topicsHex = info.topics
        .map((t) => t.toString('hex'))
        .filter((hex) => this.#topics.has(hex));
      const endereco = enderecoDoPar(info as { peer?: { address?: unknown } | null });
      const conn: SwarmConnection = {
        remotePublicKeyHex: stream.remotePublicKey.toString('hex'),
        stream,
        topicsHex,
        ...(endereco !== undefined ? { remoteAddress: endereco } : {}),
        close: () => stream.destroy(),
      };
      for (const l of this.#listeners) l(conn);
    });
  }

  /** Chave pública deste nó no swarm — é por ela que o par o identifica na conexão. */
  get publicKey(): Buffer {
    return Buffer.from(this.#swarm.keyPair.publicKey);
  }

  /** §14.3(5) — assinado pela composição quando há convite ativo hospedado. */
  setPreMemberSurface(fn: (() => boolean) | null): void {
    this.#preMemberSurface = fn;
  }

  join(topicHex: string, topic: SwarmTopic, role: { server: boolean; client: boolean }): void {
    if (this.#sessions.has(topicHex)) return;
    this.#topics.set(topicHex, topic);
    this.#sessions.set(topicHex, this.#swarm.join(Buffer.from(topicHex, 'hex'), { server: role.server, client: role.client }));
  }

  leave(topicHex: string): void {
    const session = this.#sessions.get(topicHex);
    if (session === undefined) return;
    this.#sessions.delete(topicHex);
    this.#topics.delete(topicHex);
    void this.#swarm.leave(Buffer.from(topicHex, 'hex'));
  }

  async flush(): Promise<void> {
    for (const session of [...this.#sessions.values()]) await session.flushed();
    await this.#swarm.flush();
  }

  onConnection(listener: (conn: SwarmConnection) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  connectionCount(): number {
    return this.#live.size;
  }

  async destroy(): Promise<void> {
    this.#sessions.clear();
    this.#topics.clear();
    this.#listeners.clear();
    await this.#swarm.destroy();
  }
}
