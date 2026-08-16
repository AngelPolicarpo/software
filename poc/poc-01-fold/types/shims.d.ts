declare module 'sodium-native' {
  const s: any;
  export default s;
}
declare module 'b4a' {
  const b: any;
  export default b;
}
declare module 'hypercore' {
  class Hypercore {
    constructor(storage: any, key?: any, opts?: any);
    key: Buffer;
    length: number;
    writable: boolean;
    manifest: any;
    state?: { flush?: () => Promise<void> };
    ready(): Promise<void>;
    append(b: Buffer | Buffer[] | Uint8Array | Uint8Array[]): Promise<{ length: number; byteLength: number }>;
    get(i: number, opts?: { wait?: boolean; timeout?: number }): Promise<Buffer | null>;
    update(opts?: { wait?: boolean }): Promise<boolean>;
    replicate(isInitiator: boolean | any, opts?: any): any;
    close(): Promise<void>;
    truncate(n: number): Promise<void>;
  }
  export default Hypercore;
}
declare module 'corestore' {
  const C: any;
  export default C;
}
declare module 'hypercore-crypto' {
  export function keyPair(seed?: Buffer): { publicKey: Buffer; secretKey: Buffer };
  export function randomBytes(n: number): Buffer;
}
declare module 'hyperdht' {
  const D: any;
  export default D;
}
declare module 'hyperdht/testnet.js' {
  const t: any;
  export default t;
}
declare module 'compact-encoding' {
  const ce: any;
  export default ce;
}
