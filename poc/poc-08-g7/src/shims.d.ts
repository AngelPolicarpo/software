// Shims de tipos para dependências sem .d.ts — o harness tipa no ponto de uso.
declare module 'udx-native' {
  const UDX: new () => unknown;
  export default UDX;
}
declare module 'sodium-native' {
  const sodium: {
    crypto_generichash_BYTES: number;
    crypto_generichash_batch(out: Buffer, parts: readonly Buffer[]): void;
    crypto_sign_BYTES: number;
    crypto_sign_PUBLICKEYBYTES: number;
    crypto_sign_SECRETKEYBYTES: number;
    crypto_sign_seed_keypair(pk: Buffer, sk: Buffer, seed: Buffer): void;
    crypto_sign_detached(sig: Buffer, msg: Buffer, sk: Buffer): void;
    crypto_sign_verify_detached(sig: Buffer, msg: Buffer, pk: Buffer): boolean;
    crypto_auth_BYTES: number;
    crypto_auth_KEYBYTES: number;
    crypto_auth(out: Buffer, msg: Buffer, key: Buffer): void;
    crypto_auth_verify(tag: Buffer, msg: Buffer, key: Buffer): boolean;
  };
  export default sodium;
}
declare module 'werift' {
  export interface RTCDataChannel {
    send(data: Buffer | string): void;
    onmessage: ((ev: { data: Buffer | string }) => void) | null;
    onOpen?: Promise<void>;
    sendOpen?: boolean;
    readyState: string;
  }
  export interface RTCDataChannelEvent {
    channel: RTCDataChannel;
  }
  export class RTCPeerConnection {
    constructor(cfg?: {
      iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
      iceTransportPolicy?: 'all' | 'relay';
    });
    createDataChannel(label: string): RTCDataChannel;
    setLocalDescription(desc?: unknown): Promise<unknown>;
    setRemoteDescription(desc: unknown): Promise<void>;
    createOffer(): Promise<unknown>;
    createAnswer(): Promise<unknown>;
    localDescription: { sdp?: string } | null;
    connectionState: string;
    iceGatheringState: string;
    close(): Promise<void> | void;
    ondatachannel: ((ev: RTCDataChannelEvent) => void) | null;
    oniceconnectionstatechange: ((s: string) => void) | null;
    onconnectionstatechange: ((s: string) => void) | null;
  }
}
