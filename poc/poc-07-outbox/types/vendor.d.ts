// Tipagem estreita do que este harness chama. Declarar só o usado é o que faz o compilador
// pegar erro de forma em vez de escondê-lo atrás de `any`.
//
// `append` aceita **lista** aqui: o group commit de §11.5 é um `core.append([...])` só, e é
// exatamente essa chamada que o gate mede.

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
    readonly length: number;
    readonly writable: boolean;
    readonly closed: boolean;

    ready(): Promise<void>;
    /** Um registro, ou o lote inteiro do group commit (§11.5). */
    append(value: Uint8Array | readonly Uint8Array[]): Promise<{ length: number; byteLength: number }>;
    get(seq: number, opts?: { wait?: boolean }): Promise<Buffer | null>;
    on(event: 'append', listener: () => void): this;
    off(event: 'append', listener: () => void): this;
    close(): Promise<void>;
  }
}
