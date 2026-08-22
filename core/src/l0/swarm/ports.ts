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
  /** Tópicos (discovery keys, em hex) que esta conexão tem em comum com este nó. */
  readonly topicsHex: readonly string[];
  close(): void;
};

/**
 * O que a fachada precisa de um backend de rede. Existe para que `Swarm` continue com **um**
 * contrato quando o backend é memória (suíte unitária) e quando é DHT (produto).
 */
export interface SwarmBackendPort {
  join(topicHex: string, topic: SwarmTopic, role: { readonly server: boolean; readonly client: boolean }): void;
  leave(topicHex: string): void;
  /** Anúncio/consulta concluídos na DHT — o `flushed` do Hyperswarm. */
  flush(): Promise<void>;
  onConnection(listener: (conn: SwarmConnection) => void): () => void;
  connectionCount(): number;
  destroy(): Promise<void>;
}

