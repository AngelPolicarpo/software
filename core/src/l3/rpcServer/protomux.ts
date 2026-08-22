// §16.1 — o transporte real: um canal `protomux` sobre o stream do Hyperswarm.
//
// §16.1 pede "dois protocolos distintos, com canais distintos", e §14.3(1) fala em "canal
// `protomux` de replicação". Este arquivo é o adaptador entre um canal desses e o
// `RpcTransportPort` que `RpcServer`/`RpcClient` já consomem: um `send`, um `onFrame`, um
// `onDown`. Nada de §16.2 ou §16.3 muda por causa dele — o que estava sobre um canal de
// memória passa a estar sobre um socket.
//
// O stream chega **opaco**: §4 não dá `swarm` (L0) a `rpcServer`, e não precisa dar. Quem
// monta o grafo já tem a conexão e passa o `Protomux` montado nela.

import Protomux from 'protomux';
import c from 'compact-encoding';

import { RPC_FRAME_MAX_BYTES, RPC_PROTOCOL_ID, type RpcProtocolName, type RpcTransportPort } from './index.ts';

export type ProtomuxTransport = RpcTransportPort & {
  /** Fecha o canal sem derrubar o stream: outros canais (replicação) continuam. */
  close(): void;
  /** Quadros descartados por estourarem o teto de §14.4, para métrica e teste. */
  readonly droppedOversize: number;
};

/**
 * Abre o canal de `protocol` sobre `mux` e devolve o cabo. `id` é o que §16.1 chama de
 * chave do canal: o `coreKey` da comunidade em `p2p-community/1`. Dois canais com o mesmo
 * protocolo e ids diferentes são independentes — é assim que uma conexão serve duas
 * comunidades sem misturá-las.
 *
 * **Quem abre é o membro, e quem responde é o host** (`protomuxChannelAcceptor`). A
 * assimetria não é estilo: um canal aberto contra um par que ainda não o registrou é
 * recusado pelo `protomux` e morre. Como o membro só descobre quem é o host **lendo o log**
 * (§14.1), é ele quem sabe quando o canal faz sentido; o host aceita quando pedirem.
 *
 * Devolve `null` quando já existe um canal igual nesta conexão: `protomux` recusa o
 * duplicado, e inventar um segundo seria criar ordem onde §16.1 declara um canal só.
 */
export function protomuxChannelTransport(
  mux: Protomux,
  opts: { readonly protocol: RpcProtocolName; readonly id: Buffer; onClose?: () => void },
): ProtomuxTransport | null {
  const maxFrameBytes = RPC_FRAME_MAX_BYTES[opts.protocol];
  const frameListeners = new Set<(frame: Uint8Array) => void>();
  const downListeners = new Set<() => void>();
  let down = false;
  let dropped = 0;

  const derrubar = (): void => {
    if (down) return;
    down = true;
    for (const l of downListeners) l();
    opts.onClose?.();
  };

  const channel = mux.createChannel({
    protocol: RPC_PROTOCOL_ID[opts.protocol],
    id: opts.id,
    onclose: derrubar,
    ondestroy: derrubar,
  });
  if (channel === null) return null;

  const message = channel.addMessage({
    encoding: c.raw,
    onmessage: (data: Uint8Array) => {
      // §14.4 — teto **antes** de qualquer decode. Quadro grande demais não é fatiado nem
      // respondido: ele não existiu. Sem id correlacionável não há resposta possível.
      if (data.byteLength > maxFrameBytes) {
        dropped += 1;
        return;
      }
      for (const l of frameListeners) l(data);
    },
  });

  channel.open();

  return {
    send(frame: Uint8Array): void {
      // O mesmo teto na saída: o `RpcServer` já recusa notificação grande demais (§16.3
      // regra 3), e aqui é a rede de segurança de quem escrever um método novo.
      if (down || frame.byteLength > maxFrameBytes) return;
      message.send(frame);
    },
    onFrame(cb: (frame: Uint8Array) => void): void {
      frameListeners.add(cb);
    },
    onDown(cb: () => void): void {
      if (down) {
        cb();
        return;
      }
      downListeners.add(cb);
    },
    close(): void {
      channel.close();
      derrubar();
    },
    get droppedOversize(): number {
      return dropped;
    },
  };
}

/**
 * Lado respondedor: registra o par `(protocol, id)` e entrega o cabo quando o outro lado
 * abrir o canal. Devolve o desregistro.
 */
export function protomuxChannelAcceptor(
  mux: Protomux,
  opts: { readonly protocol: RpcProtocolName; readonly id: Buffer },
  onTransport: (transport: ProtomuxTransport) => void,
): () => void {
  const pairOpts = { protocol: RPC_PROTOCOL_ID[opts.protocol], id: opts.id };
  mux.pair(pairOpts, () => {
    const transport = protomuxChannelTransport(mux, opts);
    if (transport !== null) onTransport(transport);
  });
  return () => mux.unpair(pairOpts);
}

/** `Protomux` do stream, criando-o na primeira vez. Uma conexão, um mux (§16.1). */
export function muxOf(stream: unknown): Protomux {
  return Protomux.from(stream);
}
