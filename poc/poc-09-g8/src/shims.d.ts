// Shims de tipos para dependências sem .d.ts — o harness tipa no ponto de uso.
declare module 'sodium-native' {
  const sodium: {
    crypto_sign_PUBLICKEYBYTES: number;
    crypto_sign_SECRETKEYBYTES: number;
    crypto_sign_BYTES: number;
    crypto_sign_SEEDBYTES: number;
    crypto_sign_seed_keypair(pk: Buffer, sk: Buffer, seed: Buffer): void;
    crypto_sign_detached(sig: Buffer, msg: Buffer, sk: Buffer): void;
    crypto_sign_verify_detached(sig: Buffer, msg: Buffer, pk: Buffer): boolean;
  };
  export default sodium;
}

declare module 'werift' {
  export class RtpHeader {
    constructor(props?: Partial<{
      version: number;
      padding: boolean;
      paddingSize: number;
      extension: boolean;
      marker: boolean;
      payloadType: number;
      sequenceNumber: number;
      timestamp: number;
      ssrc: number;
    }>);
    sequenceNumber: number;
    timestamp: number;
    payloadType: number;
    marker: boolean;
    ssrc: number;
  }

  export class RtpPacket {
    header: RtpHeader;
    payload: Buffer;
    constructor(header: RtpHeader, payload: Buffer);
    serialize(): Buffer;
  }

  export class MediaStreamTrack {
    constructor(props?: { kind: 'video' | 'audio'; streamId?: string });
    readonly kind: 'video' | 'audio';
    stopped: boolean;
    writeRtp(rtp: RtpPacket | Buffer): void;
    onReceiveRtp: { subscribe(cb: (rtp: RtpPacket) => void): { unSubscribe(): void } };
    stop(): void;
  }

  export interface RTCStatsReport {
    forEach(cb: (stat: Record<string, unknown> & { type?: string; bytesSent?: number; packetsSent?: number; kind?: string }) => void): void;
  }

  export interface RTCRtpSender {
    setParameters(params: { encodings?: Array<Record<string, unknown>> }): void;
    getParameters(): { encodings: Array<Record<string, unknown>> };
    getStats(): Promise<RTCStatsReport>;
    track: MediaStreamTrack | null;
  }

  export interface RTCDataChannel {
    send(data: Buffer | string): void;
    onmessage: ((ev: { data: Buffer | string }) => void) | null;
    readyState: string;
  }

  export class RTCPeerConnection {
    constructor(cfg?: {
      iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
      iceTransportPolicy?: 'all' | 'relay';
    });
    addTrack(track: MediaStreamTrack): RTCRtpSender;
    ontrack: ((ev: { track: MediaStreamTrack; receiver: unknown }) => void) | null;
    createDataChannel(label: string): RTCDataChannel;
    setLocalDescription(desc?: unknown): Promise<void>;
    setRemoteDescription(desc: unknown): Promise<void>;
    createOffer(): Promise<{ type: string; sdp: string }>;
    createAnswer(): Promise<{ type: string; sdp: string }>;
    localDescription: { type: string; sdp?: string } | null;
    connectionState: 'closed' | 'disconnected' | 'new' | 'connected' | 'failed' | 'connecting';
    iceConnectionState: string;
    close(): Promise<void> | void;
  }
}
