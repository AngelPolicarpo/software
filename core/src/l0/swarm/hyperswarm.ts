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
import type { MediaSocketTap, NatObservation, SwarmBackendPort, SwarmConnection } from './ports.ts';

/** O tanto da socket UDX que §17.3 usa. Declarado aqui porque `udx-native` não tipa isto. */
type UdxSocketLike = {
  address(): { readonly host: string; readonly port: number };
  send(buf: Buffer, port: number, host: string): void;
  on(ev: 'message', fn: (data: Buffer, addr: { host: string; port: number }) => void): void;
  listeners(ev: 'message'): Array<(data: Buffer, addr: { host: string; port: number }) => void>;
  removeListener(ev: 'message', fn: (data: Buffer, addr: { host: string; port: number }) => void): void;
};

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
  /** Assinantes de `onPeerTopics` — tópico novo num par que já está conectado. */
  readonly #topicListeners = new Set<(conn: SwarmConnection) => void>();
  /** `topicHex` → tópico, para dizer a cada conexão quais tópicos ela tem em comum. */
  readonly #topics = new Map<string, SwarmTopic>();
  readonly #live = new Set<SwarmStream>();
  /** §31.8 — pares procurados por chave, sem tópico. `joinPeer` não é idempotente lá dentro. */
  readonly #pares = new Set<string>();
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
      // `info.topics` são as discovery keys que trouxeram este par; o cruzamento com o que
      // este nó anunciou é o que diz "em comum" — nunca o que o par afirma.
      //
      // A leitura é **na hora**, não uma cópia do instante da conexão: o `PeerInfo` é vivo e
      // o hyperswarm empurra para ele (`_handlePeer` → `peerInfo._topic`) todo tópico em que
      // o par é redescoberto, mesmo quando não emite `connection` de novo — e ele não emite,
      // porque já existe conexão com aquela chave. Congelar a lista aqui era o que fazia o
      // segundo convite do mesmo host (§12.3) nunca chegar ao canal de admissão.
      const topicsHex = (): readonly string[] =>
        info.topics.map((t) => t.toString('hex')).filter((hex) => this.#topics.has(hex));
      const endereco = enderecoDoPar(info as { peer?: { address?: unknown } | null });
      const conn: SwarmConnection = {
        remotePublicKeyHex: stream.remotePublicKey.toString('hex'),
        stream,
        get topicsHex(): readonly string[] {
          return topicsHex();
        },
        ...(endereco !== undefined ? { remoteAddress: endereco } : {}),
        close: () => stream.destroy(),
      };
      // O par ganhou tópico depois de conectado: avisa quem reavalia canais. O `PeerInfo`
      // vive mais que a conexão (o hyperswarm o mantém no cadastro de pares), então o
      // ouvinte sai junto com o stream — senão sobra apontando para um mux morto.
      const aoTopico = (): void => {
        for (const l of this.#topicListeners) l(conn);
      };
      info.on('topic', aoTopico);
      stream.once('close', () => {
        this.#live.delete(stream);
        info.off('topic', aoTopico);
      });
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

  /**
   * §24.3 — a observação de NAT que o DHT já fez. Não é sonda nova: o `dht-rpc` amostra o
   * endereço externo a cada resposta que recebe e consolida no `nat-sampler`, e é dele que
   * saem os três sinais. Ler o interno aqui é a mesma escolha de `mediaSocket()`, e pelo
   * mesmo motivo: a alternativa seria mandar tráfego só para medir o que já está medido.
   */
  natObservation(): NatObservation | null {
    const dht = (this.#swarm as unknown as {
      dht?: {
        firewalled?: boolean;
        _nat?: { host?: string | null; port?: number } | null;
        host?: string | null;
        port?: number | null;
      };
    }).dht;
    if (dht === undefined) return null;
    const amostra = dht._nat ?? null;
    // Sem amostrador (ainda não subiu), `dht.host/port` é o que o DHT publica de si.
    const host = amostra?.host ?? dht.host ?? null;
    const port = amostra?.port ?? dht.port ?? 0;
    return { firewalled: dht.firewalled === true, host, port };
  }

  /**
   * §17.3 — a socket UDP do UDX, para o STUN/TURN do host dividir com o DHT.
   *
   * A spec manda os dois serviços na MESMA socket, demultiplexados pelo cabeçalho. Este
   * método entrega a socket sem interpretar nada: quem classifica é L2 (`classifyInbound`),
   * porque a gramática de STUN não é assunto de transporte. `tap` recebe cada datagrama
   * ANTES do DHT e devolve `true` quando consumiu; devolvendo `false`, o datagrama segue
   * para o listener original, intacto.
   *
   * A socket do servidor é a que interessa: é a porta que o par do outro lado alcança, e é
   * dela que sai o endereço anunciado em `iceServers`. `null` antes do DHT ligar.
   */
  mediaSocket(): MediaSocketTap | null {
    const dht = (this.#swarm as unknown as {
      dht?: {
        io?: { serverSocket?: UdxSocketLike | null; clientSocket?: UdxSocketLike | null };
        host?: string | null;
        port?: number | null;
      };
    }).dht;
    const io = dht?.io;
    // **As DUAS sockets, e isso não é excesso de zelo.** O `hyperdht` usa a de servidor
    // quando é alcançável e a de cliente quando está `firewalled` — e `dht.port`, que é o
    // endereço que os outros veem, é o mapeamento NAT de UMA delas. Medido: com
    // `firewalled: true`, `dht.port` (56057) não era nem a porta da socket de servidor
    // (49738) nem a da de cliente (45361); é o mapeamento externo da que fala. Escutar só
    // uma significava anunciar em §17.3 um endereço que o classificador não atende.
    const sockets = [io?.serverSocket, io?.clientSocket].filter(
      (x): x is UdxSocketLike => x !== null && x !== undefined,
    );
    if (sockets.length === 0) return null;

    // Responder pela MESMA socket que recebeu é o que preserva o mapeamento NAT: sair por
    // outra порта faria o pacote chegar de um endereço que o cliente não está esperando.
    let atual: UdxSocketLike = sockets[0]!;

    return {
      address: () => sockets[0]!.address(),
      publicAddress: () => {
        const host = dht?.host ?? null;
        const port = dht?.port ?? null;
        return host === null || port === null || port === 0 ? null : { host, port };
      },
      send: (datagram, addr) => {
        try {
          atual.send(Buffer.from(datagram), addr.port, addr.host);
        } catch {
          // Socket fechando: perder um datagrama UDP é o comportamento do meio, não erro.
        }
      },
      tap: (handler) => {
        const desfazer: Array<() => void> = [];
        for (const socket of sockets) {
          // O DHT registra um listener de `message` por socket. Tirá-lo e reinstalá-lo por
          // baixo do nosso é o que garante ordem: nada chega ao DHT antes de classificarmos.
          const anteriores = socket.listeners('message');
          for (const l of anteriores) socket.removeListener('message', l);
          const nosso = (data: Buffer, addr: { host: string; port: number }): void => {
            atual = socket;
            if (handler(data, addr)) return;
            for (const l of anteriores) l(data, addr);
          };
          socket.on('message', nosso);
          desfazer.push(() => {
            socket.removeListener('message', nosso);
            for (const l of anteriores) socket.on('message', l);
          });
        }
        return () => {
          for (const f of desfazer) f();
        };
      },
    };
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

  /**
   * §31.8 — a descoberta da conversa direta: conectar à **chave de identidade** do par, sem
   * tópico. `joinPeer` do hyperswarm mantém a tentativa viva e reconecta sozinho, que é o
   * comportamento que uma conversa quer — o par pode estar offline por horas.
   */
  listenSelf(): void {
    void this.#swarm.listen();
  }

  joinPeer(peerKeyHex: string): void {
    if (this.#pares.has(peerKeyHex)) return;
    this.#pares.add(peerKeyHex);
    this.#swarm.joinPeer(Buffer.from(peerKeyHex, 'hex'));
  }

  leavePeer(peerKeyHex: string): void {
    if (!this.#pares.delete(peerKeyHex)) return;
    this.#swarm.leavePeer(Buffer.from(peerKeyHex, 'hex'));
  }

  async flush(): Promise<void> {
    for (const session of [...this.#sessions.values()]) await session.flushed();
    await this.#swarm.flush();
  }

  onConnection(listener: (conn: SwarmConnection) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** §12.3 — o par já conectado passou a ser conhecido por um tópico novo. */
  onPeerTopics(listener: (conn: SwarmConnection) => void): () => void {
    this.#topicListeners.add(listener);
    return () => this.#topicListeners.delete(listener);
  }

  connectionCount(): number {
    return this.#live.size;
  }

  async destroy(): Promise<void> {
    this.#sessions.clear();
    this.#topics.clear();
    this.#listeners.clear();
    this.#topicListeners.clear();
    await this.#swarm.destroy();
  }
}
