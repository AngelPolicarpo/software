// Cabo de composição dos testes de integração. Desde §44 ele é a **metade simulada**: o
// transporte RPC em memória, a sonda de NAT fixa, o par STUN de loopback e o disco
// descartável. Tudo que o produto executa mudou-se para `src/composition/ports.ts`, que
// este arquivo reexporta — os rigs continuam importando de um lugar só, e a fronteira entre
// "junta de produto" e "simulação de teste" fica visível no import.

import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MediaServer,
  BINDING_SUCCESS,
  decode,
  encodeBindingRequest,
  randomTxId,
  type MediaAddr,
  type MediaSocketPort,
} from '../../src/l2/communityHost/stunTurn.ts';
import type { NatType } from '../../src/l2/diagnostics/index.ts';
import type { RpcTransportPort } from '../../src/l3/rpcServer/index.ts';

export * from '../../src/composition/ports.ts';

// ─── Transporte RPC em memória (§16.1 — protomux-rpc chega na integração L3 real) ──────

export class MemoryRpcChannel implements RpcTransportPort {
  #other: MemoryRpcChannel | null = null;
  #frameListeners = new Set<(frame: Uint8Array) => void>();
  #downListeners = new Set<() => void>();

  static createPair(): [MemoryRpcChannel, MemoryRpcChannel] {
    const a = new MemoryRpcChannel();
    const b = new MemoryRpcChannel();
    a.#other = b;
    b.#other = a;
    return [a, b];
  }

  send(frame: Uint8Array): void {
    const copy = Buffer.from(frame);
    const peer = this.#other as MemoryRpcChannel | null;
    queueMicrotask(() => {
      if (peer === null) return;
      for (const listener of peer.frameListeners()) listener(copy);
    });
  }

  /** Exposto só para o par — encapsulamento de `#frameListeners` entre instâncias. */
  private frameListeners(): Set<(frame: Uint8Array) => void> {
    return this.#frameListeners;
  }

  onFrame(cb: (frame: Uint8Array) => void): void {
    this.#frameListeners.add(cb);
  }

  onDown(cb: () => void): void {
    this.#downListeners.add(cb);
  }

  /** Queda da conexão — só o lado que cai avisa; o par fica mudo até reattach. */
  drop(): void {
    for (const cb of this.#downListeners) cb();
  }
}

/** Par de canais com queda unilateral para testes de reconexão. */
export function rpcPair(): [MemoryRpcChannel, MemoryRpcChannel] {
  return MemoryRpcChannel.createPair();
}

// ─── Portas do diagnostics (§24.3, §15.4 diag.*) ────────────────────────────────────────

export function swarmNatProbe(natType: NatType): { probe(): Promise<NatType> } {
  return { probe: async () => natType };
}

/**
 * Probe STUN real sobre UDP de loopback: Binding Request RFC 5389 codificado pelo codec do
 * núcleo (`stunTurn`), respondido por um `MediaServer` ligado à mesma socket. É a junta de
 * §17.3 exercitada de verdade, sem HyperDHT.
 */
export class UdpStunProbe {
  readonly #socket: dgram.Socket;
  readonly #addr: MediaAddr;

  private constructor(socket: dgram.Socket, addr: MediaAddr) {
    this.#socket = socket;
    this.#addr = addr;
  }

  /** Sobe socket + MediaServer respondedor e devolve a porta de probe do cliente. */
  static async createPair(): Promise<{ probe: UdpStunProbe; responderClose(): Promise<void> }> {
    const responder = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => responder.bind(0, '127.0.0.1', resolve));
    const responderAddr = responder.address() as { address: string; port: number };

    const mediaSocket: MediaSocketPort = {
      send(datagram, addr) {
        responder.send(Buffer.from(datagram), addr.port, addr.host);
      },
    };
    const media = new MediaServer({
      realm: 'integracao',
      hostTurnSecret: Buffer.alloc(32, 7),
      socket: mediaSocket,
      openRelayPort: async () => {
        throw new Error('sem relay neste teste');
      },
      sessionPeerKeys: () => new Set(),
      rosterAddresses: () => new Set(),
    });
    responder.on('message', (msg, rinfo) => {
      media.handleDatagram(new Uint8Array(msg), { host: rinfo.address, port: rinfo.port });
    });

    const client = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => client.bind(0, '127.0.0.1', resolve));

    return {
      probe: new UdpStunProbe(client, { host: responderAddr.address, port: responderAddr.port }),
      responderClose: () => {
        responder.close();
        return new Promise((resolve) => client.close(resolve));
      },
    };
  }

  /** Binding com prazo próprio — resolve true quando XOR-MAPPED-ADDRESS volta. */
  probe(timeoutMs = 2_000): Promise<boolean> {
    return new Promise((resolve) => {
      const txId = randomTxId();
      const req = encodeBindingRequest(txId);
      const onMsg = (msg: Buffer): void => {
        const dec = decode(new Uint8Array(msg));
        if (dec === null || dec.type !== BINDING_SUCCESS || !dec.txId.equals(txId)) return;
        clearTimeout(timer);
        this.#socket.off('message', onMsg);
        resolve(dec.xorMapped !== undefined);
      };
      const timer = setTimeout(() => {
        this.#socket.off('message', onMsg);
        resolve(false);
      }, timeoutMs);
      this.#socket.on('message', onMsg);
      this.#socket.send(req, this.#addr.port, this.#addr.host);
    });
  }
}

/** Diretório temporário rotulado (mesma convenção dos outros cabos). */
export function tempDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `core-integracao-${label}-`));
}

