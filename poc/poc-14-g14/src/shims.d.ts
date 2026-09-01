// Shims de tipos para dependências sem `.d.ts` — o harness tipa no ponto de uso. A superfície
// declarada é a mesma de `core/types/vendor.d.ts`, recortada ao que estes cenários tocam.

declare module 'hypercore' {
  import { EventEmitter } from 'node:events';

  export type HypercoreKeyPair = { publicKey: Buffer; secretKey: Buffer };

  export type HypercoreOptions = {
    key?: Buffer;
    keyPair?: HypercoreKeyPair;
    compat?: boolean;
    createIfMissing?: boolean;
  };

  export default class Hypercore extends EventEmitter {
    constructor(storage: string, opts?: HypercoreOptions);
    constructor(storage: string, key?: Buffer | null, opts?: HypercoreOptions);
    readonly key: Buffer | null;
    readonly discoveryKey: Buffer | null;
    readonly length: number;
    readonly fork: number;
    readonly writable: boolean;
    readonly closed: boolean;
    ready(): Promise<void>;
    append(value: Uint8Array | readonly Uint8Array[]): Promise<number>;
    get(seq: number, opts?: { wait?: boolean; timeout?: number }): Promise<Buffer | null>;
    has(start: number, end?: number): Promise<boolean>;
    /** §31.13 — bloco conflitante no próprio core: é o `forked` de §31.13 acontecendo. */
    on(event: 'append' | 'download' | 'conflict' | 'truncate', listener: (...args: unknown[]) => void): this;
    once(event: string, listener: (...args: unknown[]) => void): this;
    replicate(muxOrStream: unknown): unknown;
    download(range?: { start?: number; end?: number; linear?: boolean }): { done(): Promise<void>; destroy(): void };
    close(): Promise<void>;
  }
}

declare module 'hyperdht' {
  export type DhtKeyPair = { publicKey: Buffer; secretKey: Buffer };

  export type DhtServer = {
    listen(keyPair: DhtKeyPair): Promise<void>;
    close(): Promise<void>;
  };

  export type DhtSocket = {
    once(event: 'open' | 'close' | 'error', listener: (...args: unknown[]) => void): DhtSocket;
    on(event: 'open' | 'close' | 'error', listener: (...args: unknown[]) => void): DhtSocket;
    destroy(): void;
  };

  export default class DHT {
    constructor(opts?: { bootstrap?: Array<{ host: string; port: number }> });
    createServer(onconnection: (socket: DhtSocket) => void): DhtServer;
    connect(publicKey: Buffer): DhtSocket;
    destroy(): Promise<void>;
  }
}

declare module 'hyperdht/testnet.js' {
  /** Rede DHT local (§28.5) — bootstrap isolado, **nunca** a DHT pública (ambiente POC-14). */
  export default function createTestnet(
    size?: number,
    opts?: { teardown?: (fn: () => void) => void },
  ): Promise<{
    readonly bootstrap: Array<{ host: string; port: number }>;
    destroy(): Promise<void>;
  }>;
}
