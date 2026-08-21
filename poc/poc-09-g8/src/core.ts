// Ponte para o núcleo REAL (@comunidade/core). O dist do core não emite .d.ts, então a
// superfície usada pelo harness está declarada aqui e o módulo compilado é importado
// diretamente por caminho relativo. Nada de mídia/tickets/sessões é reimplementado: toda
// decisão exercida abaixo vem do código de produto. Descartável com este poc.

// ─── superfície mínima usada ────────────────────────────────────────────────────────────

export interface MediaAddr {
  readonly host: string;
  readonly port: number;
}

export interface MediaSocketPort {
  send(datagram: Uint8Array, addr: MediaAddr): void;
}

export interface RelayPort {
  readonly addr: MediaAddr;
  send(datagram: Uint8Array, addr: MediaAddr): void;
  onData(cb: (data: Uint8Array, from: MediaAddr) => void): void;
  close(): void;
}

export interface TurnCounters {
  bindingRequests: number;
  allocates: number;
  refreshes: number;
  permissionsGranted: number;
  permissionsRefused: number;
  channelBinds: number;
  relayedPackets: number;
  dataIndications: number;
  relayedBytes: number;
  notPermittedDropped: number;
  rateDropped: number;
  authFailures: number;
  quotaExceeded: number;
}

export interface MediaServerOptions {
  realm: string;
  hostTurnSecret: Buffer;
  socket: MediaSocketPort;
  openRelayPort: (allocId: string) => Promise<RelayPort>;
  sessionPeerKeys: (sessionId: string) => ReadonlySet<string>;
  rosterAddresses: (sessionId: string) => ReadonlySet<string>;
  now?: () => number;
  allocTtlMs?: number;
  maxAllocsPerMember?: number;
  rateKbps?: number;
  sessionMaxBytes?: number;
}

export interface MediaServerLike {
  constructor: unknown;
  handleDatagram(datagram: Uint8Array, addr: MediaAddr): 'stun' | 'channel-data' | 'udx';
  sweep(now?: number): number;
  close(): void;
  readonly counters: TurnCounters;
}

export interface TurnControlsLike {
  allocate(memberKeyHex: string, kind: 'voice' | 'screen', now: number): { ok: true; allocId: string; expiresAt: number } | { ok: false; reason: 'screen-refused' | 'member-limit' | 'gone' };
}

export interface DecodedStun {
  type: number;
  txId: Buffer;
  xorMapped?: MediaAddr;
  errorCode?: number;
}

export interface VoiceStatePort {
  readonly community: { readonly exists: boolean; readonly endedAt?: number };
  readonly channels: ReadonlyMap<string, { readonly type: number; readonly deletedAt?: number }>;
  readonly members: ReadonlyMap<
    string,
    {
      readonly state: 'active' | 'left' | 'banned';
      readonly timeoutUntil?: number;
      readonly roleIds: Iterable<string>;
    }
  >;
  readonly roles: ReadonlyMap<string, { readonly permissions: Iterable<number>; readonly deletedAt?: number }>;
}

export interface IceServer {
  readonly urls: string;
  readonly username?: string;
  readonly credential?: string;
}

export interface RosterEntry {
  readonly keyHex: string;
  readonly muted: boolean;
  readonly deafened: boolean;
  readonly sharing: boolean;
  readonly cameraOn: boolean;
  readonly speaking: boolean;
}

export interface MediaTicket {
  readonly sessionId: string;
  readonly channelId: string;
  readonly peerA: Buffer;
  readonly peerB: Buffer;
  readonly expiresAt: number;
  readonly sig: Buffer;
}

interface Err {
  readonly ok: false;
  readonly code: string;
}

export interface VoiceHostSessionsLike {
  join(args: { state: VoiceStatePort; channelId: string; memberKeyHex: string }):
    | { ok: true; sessionId: string; channelId: string; roster: readonly RosterEntry[]; iceServers: readonly IceServer[]; tickets: readonly MediaTicket[] }
    | Err;
  sessionOf(channelId: string): { sessionId: string; participants: readonly RosterEntry[] } | null;
  participantKeys(sessionId: string): ReadonlySet<string>;
  sweepAgainst(state: VoiceStatePort): readonly { sessionId: string; channelId: string; targetKeyHex: string }[];
}

export interface CaptureToken {
  readonly token: string;
  readonly sessionId: string;
  readonly expiresAt: number;
}

export type ShareQuality = 'high' | 'balanced' | 'low';

export interface ShareHostSessionsLike {
  start(args: { state: VoiceStatePort; channelId: string; presenterKeyHex: string; quality?: ShareQuality }):
    | { ok: true; sessionId: string; channelId: string; captureToken: CaptureToken }
    | Err;
  join(args: { sessionId: string; memberKeyHex: string }):
    | { ok: true; sessionId: string; channelId: string; presenterKeyHex: string; ticketId: string; ticket: MediaTicket; expiresAt: number }
    | Err;
  setQuality(args: { sessionId: string; memberKeyHex: string; quality: ShareQuality }):
    | { ok: true; applied: true; quality: ShareQuality }
    | Err;
  viewerQuality(sessionId: string, memberKeyHex: string): ShareQuality | null;
  stop(args: { sessionId: string; memberKeyHex: string }): { ok: true } | Err;
  leave(args: { sessionId: string; memberKeyHex: string }): { ok: true } | Err;
  authorizeCapture(args: { sessionId: string; token: string }): { allowed: true } | { allowed: false; reason: 'gone' | 'mismatch' | 'expired' };
  snapshotOf(sessionId: string): { sessionId: string; channelId: string; presenterKeyHex: string; viewers: readonly { keyHex: string; quality: ShareQuality }[] } | null;
  sweepAgainst(state: VoiceStatePort): readonly { sessionId: string; channelId: string; targetKeyHex: string }[];
  readonly maxViewers: number;
}

export interface VoiceTicketManagerLike {
  acceptSignaling(args: { sessionId: string; channelId: string; remotePeer: Buffer; ticket: MediaTicket }): { ok: true } | { ok: false; code: string };
  canInitiateDtls(sessionId: string, remotePeer: Buffer): boolean;
  revoke(targetKey: Buffer, sessionId: string): readonly { sessionId: string; remotePeerHex: string }[];
  dropSession(sessionId: string): void;
}

// ─── importação dos módulos reais compilados ────────────────────────────────────────────

/** Especificador dinâmico: o dist do core não emite .d.ts e a superfície é declarada acima. */
// Os caminhos resolvem contra o ARQUIVO COMPILADO (dist/src/core.js): sobem 4 níveis.
function dist(rel: string): string {
  return new URL(rel, import.meta.url).href;
}

const stunTurnMod = (await import(dist('../../../../core/dist/src/l2/communityHost/stunTurn.js'))) as unknown as {
  MediaServer: new (options: MediaServerOptions) => MediaServerLike;
  TurnControls: new (opts: { ttlMs: number; maxPerMember: number }) => TurnControlsLike;
  encodeBindingRequest(txId?: Buffer): Buffer;
  decode(buf: Uint8Array): DecodedStun | null;
};

const voiceMod = (await import(dist('../../../../core/dist/src/l2/voiceCoordinator/index.js'))) as unknown as {
  VoiceHostSessions: new (opts: {
    hostSecretKey: Buffer;
    hostTurnSecret: Buffer;
    clock?: { now(): number };
    ttlMs: number;
    maxParticipants: number;
    maxCameras: number;
    isVoiceChannelType: (type: number) => boolean;
    iceServers?: () => readonly IceServer[];
    sessionIdFactory?: () => string;
    onRevoked?: (targets: readonly { sessionId: string; channelId: string; targetKeyHex: string }[]) => void;
    onRosterChanged?: (snapshot: unknown) => void;
  }) => VoiceHostSessionsLike;

  VoiceTicketManager: new (opts: {
    hostPublicKey: Buffer;
    localPeer: Buffer;
    clock?: { now(): number };
    revocationTtlMs: number;
  }) => VoiceTicketManagerLike;

  verifyMediaTicket(
    hostPublicKey: Buffer,
    ticket: MediaTicket,
    expected: { sessionId: string; channelId: string; localPeer: Buffer; remotePeer: Buffer },
    now: number,
  ): { ok: true } | { ok: false; code: string };
};

// Fase 8: a decisão da sessão de tela migrou do voiceCoordinator para o shareStar (§25).
const shareMod = (await import(dist('../../../../core/dist/src/l2/shareStar/index.js'))) as unknown as {
  ShareHostSessions: new (opts: {
    hostSecretKey: Buffer;
    clock?: { now(): number };
    ttlMs: number;
    captureTokenTtlMs: number;
    maxViewers: number;
    isVoiceChannelType: (type: number) => boolean;
    voiceParticipants: (channelId: string) => ReadonlySet<string> | null;
    sessionIdFactory?: () => string;
    onRevoked?: (targets: readonly { sessionId: string; channelId: string; targetKeyHex: string }[]) => void;
  }) => ShareHostSessionsLike;

  degradeOnLoss(quality: ShareQuality, lossPct: number): ShareQuality | null;
  SHARE_QUALITY_PROFILES: Readonly<Record<ShareQuality, number>>;
};

const constantsMod = (await import(dist('../../../../core/dist/src/l1/fold/constants.js'))) as unknown as {
  MEDIA_TICKET_TTL_MS: number;
  SHARE_MAX_VIEWERS: number;
  MAX_VOICE_PARTICIPANTS: number;
  MAX_CAMERAS: number;
};

export const core = {
  MediaServer: stunTurnMod.MediaServer,
  TurnControls: stunTurnMod.TurnControls,
  encodeBindingRequest: stunTurnMod.encodeBindingRequest,
  decodeStun: stunTurnMod.decode,
  VoiceHostSessions: voiceMod.VoiceHostSessions,
  ShareHostSessions: shareMod.ShareHostSessions,
  VoiceTicketManager: voiceMod.VoiceTicketManager,
  verifyMediaTicket: voiceMod.verifyMediaTicket,
  degradeOnLoss: shareMod.degradeOnLoss,
  SHARE_QUALITY_PROFILES: shareMod.SHARE_QUALITY_PROFILES,
  MEDIA_TICKET_TTL_MS: constantsMod.MEDIA_TICKET_TTL_MS,
  SHARE_MAX_VIEWERS: constantsMod.SHARE_MAX_VIEWERS,
  MAX_VOICE_PARTICIPANTS: constantsMod.MAX_VOICE_PARTICIPANTS,
  MAX_CAMERAS: constantsMod.MAX_CAMERAS,
};
