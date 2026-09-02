// Portas do transporte de §14 — só tipos, para que a fachada de `index.ts` não arraste o
// `hyperswarm` real para dentro da suíte unitária. Quem implementa é `hyperswarm.ts`
// (produto) ou o modo memória da própria fachada.

import type { SwarmStream } from 'hyperswarm';

import type { SwarmTopic } from './index.ts';

/** Uma conexão viva do swarm, no recorte que a composição usa. */
export type SwarmConnection = {
  /** Chave pública do par — autenticada pelo Noise do Hyperswarm, não declarada por ele. */
  readonly remotePublicKeyHex: string;
  /** O stream criptografado. Opaco aqui: quem monta o grafo põe o `Protomux` em cima. */
  readonly stream: SwarmStream;
  /**
   * Tópicos (discovery keys, em hex) que esta conexão tem em comum com este nó.
   *
   * **Vivo, não instantâneo.** O hyperswarm registra no `PeerInfo` todo tópico em que o par
   * é redescoberto, mas só emite `connection` na PRIMEIRA vez (`_handlePeer` sai cedo
   * quando já há conexão com aquela chave). Um tópico que aparece depois — o convite da
   * segunda comunidade do mesmo host, §12.3 — só existe aqui porque esta lista é lida na
   * hora. Quem precisa reagir à mudança assina `onPeerTopics`.
   */
  readonly topicsHex: readonly string[];
  /**
   * Endereço UDP observado, quando o backend o expõe. É o que alimenta a metade por /24
   * do rate limit pré-membro de §12.6 — a outra metade é o próprio `remotePublicKeyHex`.
   * Opcional: nem todo backend entrega, e o rate limit degrada para por-chave só.
   */
  readonly remoteAddress?: string;
  close(): void;
};

/**
 * O que a fachada precisa de um backend de rede. Existe para que `Swarm` continue com **um**
 * contrato quando o backend é memória (suíte unitária) e quando é DHT (produto).
 */
export interface SwarmBackendPort {
  join(topicHex: string, topic: SwarmTopic, role: { readonly server: boolean; readonly client: boolean }): void;
  leave(topicHex: string): void;
  /**
   * §31.8 — conexão direta a uma chave de identidade, **sem tópico**. É o que a conversa
   * direta usa: por **L-24** a chave pública de identidade já é o nó na DHT, e §31.8 recusa
   * explicitamente um tópico de conversa (ele não funcionaria no primeiro contato, em que
   * `B` não conhece `A`). O anúncio do próprio lado é o par de identidade do Hyperswarm,
   * que §14.3 (emenda item 1) já fixou — não há o que anunciar a mais.
   *
   * Opcional: backend sem rede real não tem par a quem se conectar.
   */
  joinPeer?(peerKeyHex: string): void;
  leavePeer?(peerKeyHex: string): void;
  /**
   * §31.8 — "um nó com ao menos uma conversa em estado `accepted` ou `pending-out`
   * anuncia-se na DHT sob o próprio par de identidade". É o `listen` do Hyperswarm: sem ele
   * o par que faz `joinPeer` não tem a quem se conectar. **Sem tópico** — a linha que §14.1
   * ganha em §31.8 é exatamente esta.
   */
  listenSelf?(): void;
  /** Anúncio/consulta concluídos na DHT — o `flushed` do Hyperswarm. */
  flush(): Promise<void>;
  onConnection(listener: (conn: SwarmConnection) => void): () => void;
  /**
   * Um par JÁ CONECTADO passou a ser conhecido por um tópico novo (§12.3: o candidato entra
   * no tópico do convite de um host com quem já fala). Sem isto o tópico entra na lista viva
   * e ninguém reavalia — e era esse silêncio que fazia o segundo convite do mesmo host
   * nunca abrir canal de admissão. Opcional: backend sem rede real não redescobre par.
   */
  onPeerTopics?(listener: (conn: SwarmConnection) => void): () => void;
  connectionCount(): number;
  destroy(): Promise<void>;
  /**
   * §14.3(5) — declara que este nó tem superfície pré-membro (hospeda convite ativo).
   * Enquanto o predicado devolver true, o firewall de conexão cede ao canal de admissão.
   * Opcional: backends sem firewall não têm o que ceder.
   */
  setPreMemberSurface?(fn: (() => boolean) | null): void;
  /**
   * §17.3 — a socket UDP que o UDX usa, para o STUN/TURN do host dividir com o DHT.
   * Opcional: backend sem rede real (a suíte unitária) não tem socket para compartilhar, e
   * nesse caso `voice.join` entrega `iceServers` vazio, que é a mesma situação de L-11.
   */
  mediaSocket?(): MediaSocketTap | null;
  /**
   * §24.3 `swarm.natType` / §15.4 `diag.run` — o que o DHT já MEDIU sobre a saída deste nó.
   * Opcional: backend sem rede real não tem amostra, e a sonda de §15.4 assume o pior caso.
   */
  natObservation?(): NatObservation | null;
}

/**
 * A observação de NAT do DHT, crua. Quem a traduz em `open`/`moderate`/`cgnat` é L2
 * (`diagnostics`) — L0 não classifica, só entrega o que amostrou.
 */
export type NatObservation = {
  /** O nó é servidor DHT (alcançável de fora) ou cliente atrás de firewall. */
  readonly firewalled: boolean;
  /** Endereço externo consolidado pelas amostras, ou `null` se nem ele estabilizou. */
  readonly host: string | null;
  /**
   * Porta externa consolidada. **`0` é informação, não ausência**: o `nat-sampler` do
   * `dht-rpc` só a zera quando o host é consistente entre observadores e a PORTA não é —
   * que é a definição operacional de NAT simétrico. É o sinal que separa "atrás de NAT" de
   * "atrás de NAT que nenhum candidato `srflx` atravessa".
   */
  readonly port: number;
};

/** Socket compartilhada de §17.3, entregue sem semântica de mídia — quem classifica é L2. */
export type MediaSocketTap = {
  /** Endereço LIGADO — `0.0.0.0:<porta>`. Serve para falar consigo mesmo, não para anunciar. */
  address(): { readonly host: string; readonly port: number };
  /**
   * §17.3 — "o endereço público do host é obtido do próprio `hyperdht` (ele é um servidor
   * DHT)". É este que vai em `iceServers`. `null` quando o DHT ainda não observou o próprio
   * endereço; e quando o nó está `firewalled`, o mapeamento NAT que vale é o que o tráfego
   * do DHT mantém vivo — que é a razão de a socket ser compartilhada, e não uma otimização.
   */
  publicAddress(): { readonly host: string; readonly port: number } | null;
  send(datagram: Uint8Array, addr: { readonly host: string; readonly port: number }): void;
  /** Instala o classificador; devolve a função que o remove e devolve a socket ao dono. */
  tap(handler: (data: Buffer, addr: { host: string; port: number }) => boolean): () => void;
};

