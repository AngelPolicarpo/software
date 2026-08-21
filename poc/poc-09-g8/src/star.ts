// G8 — estrela WebRTC real (werift) sobre a camada de decisão REAL do core.
//
// O apresentador mantém uma RTCPeerConnection por espectador (§17.5/A19); sinalização
// gated por ticket do host nas duas pontas (A22 passos 3–4); captura só depois de
// share.start → captureToken → autorização (T-41). Mídia é sintética em cadência de
// vídeo (pacotes ~1,1 kB) com bitrate dirigido pelo perfil por espectador: o werift
// aceita setParameters mas não aplica maxBitrate ("todo impl" no código dele), então o
// enforcement no escopo Node é feito pela bomba do apresentador e o efeito é medido nos
// receptores — limitação declarada no artefato do gate.

import dgram from 'node:dgram';
import { performance } from 'node:perf_hooks';

import sodium from 'sodium-native';
import { MediaStreamTrack, RtpHeader, RtpPacket, RTCPeerConnection, type RTCRtpSender } from 'werift';

import {
  core,
  type MediaServerLike,
  type ShareHostSessionsLike,
  type ShareQuality,
  type VoiceHostSessionsLike,
  type VoiceStatePort,
  type VoiceTicketManagerLike,
} from './core.js';

const CHANNEL = 'voz-canal';
const PKT_PAYLOAD = 1100; // bytes úteis por pacote RTP (fatia típica de tela)
const PKT_WIRE = 12 + PKT_PAYLOAD;
const TICK_MS = 5;
const CONNECT_TIMEOUT_MS = 20_000;

export function kbpsOf(q: ShareQuality): number {
  return core.SHARE_QUALITY_PROFILES[q];
}

export interface Keypair {
  pk: Buffer;
  sk: Buffer;
  hex: string;
}

export function keypair(label: string): Keypair {
  const seed = Buffer.alloc(sodium.crypto_sign_SEEDBYTES);
  seed.write(label);
  const pk = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
  const sk = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
  sodium.crypto_sign_seed_keypair(pk, sk, seed);
  return { pk, sk, hex: pk.toString('hex') };
}

/** PRNG determinístico (mulberry32) para injeção de perda reproduzível. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function percentile(samples: readonly number[], q: number): number {
  if (samples.length === 0) return Number.NaN;
  const s = [...samples].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[i] as number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Host real: voz + sessão de tela + estado estrutural mutável ────────────────────────

export class HostRig {
  readonly host = keypair('g8-host');
  readonly voice: VoiceHostSessionsLike;
  readonly shares: ShareHostSessionsLike;
  readonly voiceRevoked: { sessionId: string; channelId: string; targetKeyHex: string }[] = [];
  readonly shareRevoked: { sessionId: string; channelId: string; targetKeyHex: string }[] = [];
  readonly membersMut = new Map<string, { state: 'active' | 'left' | 'banned'; timeoutUntil?: number; roleIds: string[] }>();
  #n = 0;

  constructor() {
    this.voice = new core.VoiceHostSessions({
      hostSecretKey: this.host.sk,
      hostTurnSecret: Buffer.alloc(32, 7),
      ttlMs: core.MEDIA_TICKET_TTL_MS,
      maxParticipants: core.MAX_VOICE_PARTICIPANTS,
      maxCameras: core.MAX_CAMERAS,
      isVoiceChannelType: (t) => t === 1,
      sessionIdFactory: () => `voz-${++this.#n}`,
      onRevoked: (targets) => this.voiceRevoked.push(...targets),
    });
    this.shares = new core.ShareHostSessions({
      hostSecretKey: this.host.sk,
      ttlMs: core.MEDIA_TICKET_TTL_MS,
      captureTokenTtlMs: 120_000,
      maxViewers: core.SHARE_MAX_VIEWERS,
      isVoiceChannelType: (t) => t === 1,
      voiceParticipants: (channelId) => {
        const s = this.voice.sessionOf(channelId);
        return s ? new Set(s.participants.map((p) => p.keyHex)) : null;
      },
      sessionIdFactory: () => `share-${++this.#n}`,
      onRevoked: (targets) => this.shareRevoked.push(...targets),
    });
  }

  addMember(hexKey: string): void {
    if (!this.membersMut.has(hexKey)) this.membersMut.set(hexKey, { state: 'active', roleIds: ['r-todos'] });
  }

  get state(): VoiceStatePort {
    return {
      community: { exists: true },
      channels: new Map([[CHANNEL, { type: 1 }]]),
      members: this.membersMut,
      roles: new Map([['r-todos', { permissions: [9, 11] }]]),
    };
  }

  /** Ban de um membro: deriva revogações na voz e na sessão de tela pelo estado corrente. */
  ban(hexKey: string): { voiceTargets: string[]; shareTargets: string[] } {
    this.membersMut.set(hexKey, { state: 'banned', roleIds: ['r-todos'] });
    const v = this.voice.sweepAgainst(this.state).map((t) => t.targetKeyHex);
    const s = this.shares.sweepAgainst(this.state).map((t) => t.targetKeyHex);
    return { voiceTargets: [...new Set(v)], shareTargets: [...new Set(s)] };
  }
}

// ─── STUN do host — serviço real sobre socket UDP local ─────────────────────────────────

export interface StunProbe {
  ok: boolean;
  mapped?: string | undefined;
  observed?: string | undefined;
  rttMs: number;
}

export interface StunService {
  port: number;
  server: MediaServerLike;
  udxPassthroughs: () => number;
  probe(): Promise<StunProbe>;
  close(): Promise<void>;
}

export async function startStunService(rig: HostRig): Promise<StunService> {
  const sock = dgram.createSocket('udp4');
  await new Promise<void>((resolve) => sock.bind(0, '127.0.0.1', resolve));
  const port = sock.address().port;
  let udx = 0;

  const server = new core.MediaServer({
    realm: 'poc09',
    hostTurnSecret: rig.host.sk,
    socket: { send: (d, a) => sock.send(Buffer.from(d), a.port, a.host) },
    openRelayPort: async () => ({ addr: { host: '127.0.0.1', port }, send() {}, onData() {}, close() {} }),
    sessionPeerKeys: (sessionId) => rig.voice.participantKeys(sessionId),
    rosterAddresses: () => new Set<string>(),
  });

  sock.on('message', (msg, rinfo) => {
    const cls = server.handleDatagram(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength), {
      host: rinfo.address,
      port: rinfo.port,
    });
    if (cls === 'udx') udx++;
  });

  return {
    port,
    server,
    udxPassthroughs: () => udx,
    async probe(): Promise<StunProbe> {
      const client = dgram.createSocket('udp4');
      await new Promise<void>((resolve) => client.bind(0, '127.0.0.1', resolve));
      try {
        const observed = `${client.address().address}:${client.address().port}`;
        const t0 = performance.now();
        const reply = await new Promise<{ mapped?: string }>((resolve) => {
          const timer = setTimeout(() => resolve({}), 2_000);
          client.once('message', (m) => {
            clearTimeout(timer);
            const xm = core.decodeStun(new Uint8Array(m))?.xorMapped;
            if (xm === undefined) resolve({});
            else resolve({ mapped: `${xm.host}:${xm.port}` });
          });
          client.send(core.encodeBindingRequest(), port, '127.0.0.1');
        });
        return { ok: reply.mapped === observed, mapped: reply.mapped, observed, rttMs: performance.now() - t0 };
      } finally {
        client.close();
      }
    },
    async close(): Promise<void> {
      server.close();
      sock.close();
    },
  };
}

// ─── Estrela ────────────────────────────────────────────────────────────────────────────

interface Leg {
  index: number;
  viewer: Keypair;
  presenterPc: RTCPeerConnection;
  viewerPc: RTCPeerConnection;
  track: MediaStreamTrack;
  sender: RTCRtpSender;
  viewerManager: VoiceTicketManagerLike;
  quality: ShareQuality;
  rateBytesPerSec: number;
  credit: number;
  dropProb: number;
  rand: () => number;
  wireSeq: number;
  sentPackets: number;
  injectedDrops: number;
  bytesReceived: number;
  packetsReceived: number;
  lastWireSeq: number | null;
  gapLosses: number;
  latenciesMs: number[];
  firstFrameAt: number | null;
  lastArrivalAt: number | null;
  winSent0: number;
  winRecv0: number;
  winBytes0: number;
}

export interface LegMetrics {
  index: number;
  keyHex: string;
  quality: ShareQuality;
  windowMs: number;
  kbps: number;
  lossPct: number;
  injectedDrops: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  packetsReceived: number;
}

export interface ViewerJoin {
  index: number;
  keyHex: string;
  ticketId: string;
  firstFrameMs: number | null;
}

export class StarSession {
  readonly rig = new HostRig();
  readonly presenter: Keypair = keypair('g8-apresentador');
  readonly legs: Leg[] = [];
  channelId = CHANNEL;
  shareSessionId: string | null = null;
  captureToken: string | null = null;

  #presenterManager: VoiceTicketManagerLike | null = null;
  #pump: NodeJS.Timeout | null = null;

  /** voice.join + share.start reais — a sessão de tela nasce autorizada, com captureToken. */
  async setup(quality: ShareQuality = 'balanced'): Promise<void> {
    this.rig.addMember(this.presenter.hex);
    const joined = this.rig.voice.join({ state: this.rig.state, channelId: CHANNEL, memberKeyHex: this.presenter.hex });
    if (!joined.ok) throw new Error(`voiceJoin do apresentador recusado: ${joined.code}`);
    const started = this.rig.shares.start({
      state: this.rig.state,
      channelId: CHANNEL,
      presenterKeyHex: this.presenter.hex,
      quality,
    });
    if (!started.ok) throw new Error(`shareStart recusado: ${started.code}`);
    this.shareSessionId = started.sessionId;
    this.captureToken = started.captureToken.token;
    this.#presenterManager = new core.VoiceTicketManager({
      hostPublicKey: this.rig.host.pk,
      localPeer: this.presenter.pk,
      revocationTtlMs: core.MEDIA_TICKET_TTL_MS,
    });
  }

  /**
   * Handshake A22 completo: a oferta só é aplicada no espectador depois de
   * acceptSignaling validar o ticket do par; a resposta só é aplicada no apresentador
   * depois da mesma validação. DTLS nunca inicia sem ticket válido.
   */
  async addViewer(label: string, quality: ShareQuality): Promise<ViewerJoin> {
    if (!this.shareSessionId || !this.#presenterManager) throw new Error('sessão não inicializada');
    const viewer = keypair(label);
    this.rig.addMember(viewer.hex);
    const vj = this.rig.voice.join({ state: this.rig.state, channelId: CHANNEL, memberKeyHex: viewer.hex });
    if (!vj.ok) throw new Error(`voiceJoin recusado: ${vj.code}`);
    const sj = this.rig.shares.join({ sessionId: this.shareSessionId, memberKeyHex: viewer.hex });
    if (!sj.ok) throw new Error(`shareJoin recusado: ${sj.code}`);

    const index = this.legs.length;
    const presenterPc = new RTCPeerConnection({ iceServers: [] });
    const viewerPc = new RTCPeerConnection({ iceServers: [] });
    const track = new MediaStreamTrack({ kind: 'video' });
    const sender = presenterPc.addTrack(track);

    const leg: Leg = {
      index,
      viewer,
      presenterPc,
      viewerPc,
      track,
      sender,
      viewerManager: new core.VoiceTicketManager({
        hostPublicKey: this.rig.host.pk,
        localPeer: viewer.pk,
        revocationTtlMs: core.MEDIA_TICKET_TTL_MS,
      }),
      quality,
      rateBytesPerSec: (kbpsOf(quality) * 1000) / 8,
      credit: 0,
      dropProb: 0,
      rand: rng(0x9e3779b9 ^ (index * 2654435761)),
      wireSeq: 0x1234 + index * 101,
      sentPackets: 0,
      injectedDrops: 0,
      bytesReceived: 0,
      packetsReceived: 0,
      lastWireSeq: null,
      gapLosses: 0,
      latenciesMs: [],
      firstFrameAt: null,
      lastArrivalAt: null,
      winSent0: 0,
      winRecv0: 0,
      winBytes0: 0,
    };

    viewerPc.ontrack = (ev) => {
      ev.track.onReceiveRtp.subscribe((rtp) => this.#onPacket(leg, rtp));
    };

    const offer = await presenterPc.createOffer();
    await presenterPc.setLocalDescription(offer);

    const gateViewer = leg.viewerManager.acceptSignaling({
      sessionId: this.shareSessionId,
      channelId: CHANNEL,
      remotePeer: this.presenter.pk,
      ticket: sj.ticket,
    });
    if (!gateViewer.ok) throw new Error(`ticket válido recusado na ponta espectadora: ${gateViewer.code}`);
    await viewerPc.setRemoteDescription(presenterPc.localDescription);

    const answer = await viewerPc.createAnswer();
    await viewerPc.setLocalDescription(answer);

    const gatePresenter = this.#presenterManager.acceptSignaling({
      sessionId: this.shareSessionId,
      channelId: CHANNEL,
      remotePeer: viewer.pk,
      ticket: sj.ticket,
    });
    if (!gatePresenter.ok) throw new Error(`ticket válido recusado na ponta do apresentador: ${gatePresenter.code}`);
    await presenterPc.setRemoteDescription(viewerPc.localDescription);

    const connectedAt = performance.now();
    await this.#waitConnected(viewerPc);
    sender.setParameters({ encodings: [{ maxBitrate: kbpsOf(quality) * 1000 }] });
    this.legs.push(leg);
    this.#ensurePump();

    const deadline = performance.now() + 3_000;
    while (leg.firstFrameAt === null && performance.now() < deadline) await sleep(5);

    return {
      index,
      keyHex: viewer.hex,
      ticketId: sj.ticketId,
      firstFrameMs: leg.firstFrameAt === null ? null : leg.firstFrameAt - connectedAt,
    };
  }

  /**
   * Sonda A22 adversarial: ingressa como espectador e apresenta ticket adulterado ao
   * tentar sinalizar — deve ser recusado. Sai da sessão em seguida para devolver a vaga.
   */
  probeTamperedTicket(label: string): 'refused' | 'aceitou-indevidamente' {
    if (!this.shareSessionId) throw new Error('sessão não inicializada');
    const viewer = keypair(label);
    this.rig.addMember(viewer.hex);
    this.rig.voice.join({ state: this.rig.state, channelId: CHANNEL, memberKeyHex: viewer.hex });
    const sj = this.rig.shares.join({ sessionId: this.shareSessionId, memberKeyHex: viewer.hex });
    if (!sj.ok) throw new Error(`shareJoin recusado: ${sj.code}`);

    const tamperedSig = Buffer.from(sj.ticket.sig);
    tamperedSig[0] = (tamperedSig[0] ?? 0) ^ 0xff;
    const manager = new core.VoiceTicketManager({
      hostPublicKey: this.rig.host.pk,
      localPeer: viewer.pk,
      revocationTtlMs: core.MEDIA_TICKET_TTL_MS,
    });
    const gate = manager.acceptSignaling({
      sessionId: this.shareSessionId,
      channelId: CHANNEL,
      remotePeer: this.presenter.pk,
      ticket: { ...sj.ticket, sig: tamperedSig },
    });

    // espectador que não conectou sai e libera a vaga
    this.rig.shares.leave({ sessionId: this.shareSessionId, memberKeyHex: viewer.hex });
    return gate.ok ? 'aceitou-indevidamente' : 'refused';
  }

  /**
   * Tentativa do 10º participante de entrar na chamada é recusa de voz; a tentativa do
   * 9º espectador de assistir é E_SESSION_FULL na decisão real.
   */
  tryJoinBeyondCeiling(label: string): { ok: true } | { ok: false; code: string } {
    if (!this.shareSessionId) throw new Error('sessão não inicializada');
    const viewer = keypair(label);
    this.rig.addMember(viewer.hex);
    this.rig.voice.join({ state: this.rig.state, channelId: CHANNEL, memberKeyHex: viewer.hex });
    return this.rig.shares.join({ sessionId: this.shareSessionId, memberKeyHex: viewer.hex });
  }

  applyQuality(index: number, quality: ShareQuality): boolean {
    const leg = this.legs[index];
    if (!leg || !this.shareSessionId) return false;
    const r = this.rig.shares.setQuality({ sessionId: this.shareSessionId, memberKeyHex: leg.viewer.hex, quality });
    if (!r.ok || !r.applied) return false;
    leg.quality = quality;
    leg.rateBytesPerSec = (kbpsOf(quality) * 1000) / 8;
    leg.sender.setParameters({ encodings: [{ maxBitrate: kbpsOf(quality) * 1000 }] });
    return true;
  }

  injectLoss(index: number, prob: number): void {
    const leg = this.legs[index];
    if (leg) leg.dropProb = prob;
  }

  /** Perda acumulada da perna — entrada de `share.health` (§17.5). */
  cumulativeLossPct(index: number): number {
    const leg = this.legs[index];
    if (!leg || leg.sentPackets === 0) return 0;
    return ((leg.sentPackets - leg.packetsReceived) / leg.sentPackets) * 100;
  }

  /** Zera os cursores de janela e mede por `windowMs` com a bomba rodando. */
  async measureWindow(windowMs: number): Promise<LegMetrics[]> {
    for (const leg of this.legs) {
      leg.winSent0 = leg.sentPackets;
      leg.winRecv0 = leg.packetsReceived;
      leg.winBytes0 = leg.bytesReceived;
      leg.latenciesMs = [];
    }
    const t0 = performance.now();
    await sleep(windowMs);
    const dtSec = (performance.now() - t0) / 1000;
    return this.legs.map((leg) => {
      const sentWin = leg.sentPackets - leg.winSent0;
      const recvWin = leg.packetsReceived - leg.winRecv0;
      return {
        index: leg.index,
        keyHex: leg.viewer.hex.slice(0, 8),
        quality: leg.quality,
        windowMs,
        kbps: (leg.bytesReceived - leg.winBytes0) / dtSec / 125,
        lossPct: sentWin > 0 ? ((sentWin - recvWin) / sentWin) * 100 : 0,
        injectedDrops: leg.injectedDrops,
        latencyP50Ms: percentile(leg.latenciesMs, 0.5),
        latencyP95Ms: percentile(leg.latenciesMs, 0.95),
        packetsReceived: recvWin,
      };
    });
  }

  /** RTCStatsReport real do RTCRtpSender (outbound-rtp) — cruzamento com o receptor. */
  async senderStats(): Promise<{ index: number; bytesSent: number; packetsSent: number }[]> {
    const out: { index: number; bytesSent: number; packetsSent: number }[] = [];
    for (const leg of this.legs) {
      let bytesSent = 0;
      let packetsSent = 0;
      const report = await leg.sender.getStats();
      report.forEach((stat) => {
        if (stat['type'] === 'outbound-rtp') {
          bytesSent = Number(stat['bytesSent'] ?? 0);
          packetsSent = Number(stat['packetsSent'] ?? 0);
        }
      });
      out.push({ index: leg.index, bytesSent, packetsSent });
    }
    return out;
  }

  /** `share.leave` do espectador; a revogação recebida obriga o fechamento imediato. */
  async leaveViewer(index: number): Promise<void> {
    const leg = this.legs[index];
    if (!leg || !this.shareSessionId) return;
    this.rig.shares.leave({ sessionId: this.shareSessionId, memberKeyHex: leg.viewer.hex });
    leg.viewerManager.revoke(this.presenter.pk, this.shareSessionId);
    await leg.viewerPc.close();
    await leg.presenterPc.close();
    this.legs.splice(index, 1);
    for (let i = 0; i < this.legs.length; i++) this.legs[i]!.index = i;
  }

  /**
   * Ban do apresentador no meio (`T-32`): o sweep deriva as revogações; cada espectador
   * fecha ao receber `voice.revoked`/revogação de sessão; mede a cessação do tráfego.
   */
  async banPresenter(): Promise<{ cessationMs: number; revokedCount: number }> {
    if (!this.shareSessionId) throw new Error('sessão não inicializada');
    const banAt = performance.now();
    const targets = this.rig.ban(this.presenter.hex);
    const revokedCount = new Set([...targets.voiceTargets, ...targets.shareTargets]).size;
    for (const leg of this.legs) {
      leg.viewerManager.revoke(this.presenter.pk, this.shareSessionId);
      await leg.presenterPc.close();
    }
    await sleep(400); // pacotes em voo após o fechamento
    const lastArrival = Math.max(...this.legs.map((l) => l.lastArrivalAt ?? 0), 0);
    return { cessationMs: Math.max(0, lastArrival - banAt), revokedCount };
  }

  async close(): Promise<void> {
    this.#stopPump();
    for (const leg of this.legs) {
      leg.track.stop();
      await leg.presenterPc.close();
      await leg.viewerPc.close();
    }
    this.legs.length = 0;
  }

  // ─── internals ────────────────────────────────────────────────────────────────────────

  #onPacket(leg: Leg, rtp: RtpPacket): void {
    const now = performance.now();
    const txMs = Number(rtp.payload.readBigUInt64BE(0)) / 1000;
    leg.bytesReceived += rtp.payload.length + 12;
    leg.packetsReceived++;
    if (leg.lastWireSeq !== null) {
      const delta = (rtp.header.sequenceNumber - leg.lastWireSeq) & 0xffff;
      if (delta > 1 && delta < 0x8000) leg.gapLosses += delta - 1;
    }
    leg.lastWireSeq = rtp.header.sequenceNumber;
    leg.lastArrivalAt = now;
    if (leg.firstFrameAt === null) leg.firstFrameAt = now;
    if (txMs > 0 && txMs <= now) leg.latenciesMs.push(now - txMs);
  }

  #ensurePump(): void {
    if (this.#pump !== null) return;
    this.#pump = setInterval(() => {
      const dtSec = TICK_MS / 1000;
      for (const leg of this.legs) {
        leg.credit += leg.rateBytesPerSec * dtSec;
        while (leg.credit >= PKT_WIRE) {
          leg.credit -= PKT_WIRE;
          this.#sendPacket(leg);
        }
      }
    }, TICK_MS);
    this.#pump.unref();
  }

  #sendPacket(leg: Leg): void {
    const txMs = performance.now();
    leg.sentPackets++;
    const payload = Buffer.alloc(PKT_PAYLOAD);
    payload.writeBigUInt64BE(BigInt(Math.round(txMs * 1000)), 0); // relógio do processo, em µs
    payload.writeUInt16BE(leg.index, 8);
    if (leg.dropProb > 0 && leg.rand() < leg.dropProb) {
      leg.injectedDrops++; // a "rede" perde o pacote depois de emitido
      return;
    }
    const packet = new RtpPacket(
      new RtpHeader({ sequenceNumber: leg.wireSeq++ & 0xffff, timestamp: Math.round(txMs * 90), payloadType: 96 }),
      payload,
    );
    leg.track.writeRtp(packet);
  }

  async #waitConnected(pc: RTCPeerConnection): Promise<void> {
    const t0 = performance.now();
    while (pc.connectionState !== 'connected') {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        throw new Error(`conexão falhou (${pc.connectionState})`);
      }
      if (performance.now() - t0 > CONNECT_TIMEOUT_MS) throw new Error('timeout de conexão ICE/DTLS');
      await sleep(25);
    }
  }

  #stopPump(): void {
    if (this.#pump !== null) {
      clearInterval(this.#pump);
      this.#pump = null;
    }
  }
}
