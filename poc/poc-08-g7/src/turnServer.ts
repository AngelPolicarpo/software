// Servidor TURN mínimo (RFC 5766: Allocate, Refresh, CreatePermission, Send/Data,
// ChannelBind/ChannelData) sobre a MESMA socket UDP do dispatcher STUN/UDX — §17.3.
// Implementação experimental e descartável do harness; a fase 7 segue §17.
//
// Modo "malicioso": registra todo byte relayado e varre known-plaintext do payload
// enviado pelos pares — é o que permite MEDIR a propriedade "relay não lê payload".

import crypto from 'node:crypto';
import dgram from 'node:dgram';

import {
  BINDING_REQUEST,
  TURN_ALLOCATE,
  TURN_CHANNEL_BIND,
  TURN_CREATE_PERMISSION,
  TURN_DATA,
  TURN_REFRESH,
  TURN_SEND,
  addMessageIntegrity,
  decode,
  encodeAllocateSuccess,
  encodeBindingSuccess,
  encodeChannelBindSuccess,
  encodeDataIndication,
  encodePermissionSuccess,
  encodeRefreshSuccess,
  encodeSendIndication,
  encodeTurnError,
  longTermKey,
  verifyMessageIntegrity,
  type DecodedStun,
  type Ipv4,
} from './stun.js';

const TURN_DEFAULT_LIFETIME_SEC = 600; // TURN_ALLOC_TTL_MS = 10 min
const NONCE_VALID_MS = 60 * 60 * 1000;

export interface TurnAuth {
  username: string;
  password: string;
  realm: string;
}

export interface TurnCounters {
  allocates: number;
  refreshes: number;
  permissions: number;
  channelBinds: number;
  sendIndications: number;
  dataIndications: number;
  channelDataIn: number;
  relayedBytes: number;
  authFailures: number;
}

interface Allocation {
  clientAddr: string; // host:port
  relaySocket: dgram.Socket;
  relayedAddr: Ipv4;
  expiresAt: number;
  permissions: Set<string>; // host:port permitidos
  channels: Map<number, string>; // channelNumber → peer host:port
  peersByChannel: Map<string, number>;
}

export class TurnServer {
  readonly #socket: dgram.Socket; // socket compartilhada com o dispatcher
  readonly #auth: TurnAuth;
  readonly #key: Buffer; // MD5(username:realm:password) — respostas autenticadas levam MI
  readonly #nonce: string;
  readonly #nonceIssuedAt: number;
  readonly #allocations = new Map<string, Allocation>();
  readonly counters: TurnCounters = {
    allocates: 0,
    refreshes: 0,
    permissions: 0,
    channelBinds: 0,
    sendIndications: 0,
    dataIndications: 0,
    channelDataIn: 0,
    relayedBytes: 0,
    authFailures: 0,
  };
  /** Modo malicioso: captura tudo que atravessa o relay para inspeção posterior. */
  malicious: { capture: Buffer[]; needles: Buffer[]; matches: number } | null = null;

  constructor(socket: dgram.Socket, auth: TurnAuth) {
    this.#socket = socket;
    this.#auth = auth;
    this.#key = longTermKey(auth.username, auth.realm, auth.password);
    this.#nonce = crypto.randomBytes(16).toString('hex');
    this.#nonceIssuedAt = Date.now();
  }

  get allocationCount(): number {
    return this.#allocations.size;
  }

  /** Trata um datagrama já classificado como STUN que NÃO é Binding Request. */
  handleStun(msg: Buffer, rinfo: { address: string; port: number }): boolean {
    const dec = decode(msg);
    if (dec === null) return false;

    if (dec.type === TURN_SEND) {
      // indications exigem autenticação por MESSAGE-INTEGRITY
      if (!this.#checkIntegrity(msg, dec)) return true;
      if (dec.xorPeer !== undefined && dec.data !== undefined) {
        const alloc = this.#allocations.get(keyOf(rinfo));
        if (alloc !== undefined && this.#permissionAllows(alloc, dec.xorPeer)) {
          this.counters.sendIndications++;
          this.#relayOut(alloc, dec.data, dec.xorPeer);
        }
      }
      return true;
    }

    switch (dec.type) {
      case TURN_ALLOCATE:
        return this.#handleAllocate(msg, dec, rinfo);
      case TURN_REFRESH:
        return this.#handleRefresh(msg, dec, rinfo);
      case TURN_CREATE_PERMISSION:
        return this.#handlePermission(msg, dec, rinfo);
      case TURN_CHANNEL_BIND:
        return this.#handleChannelBind(msg, dec, rinfo);
      default:
        return false; // deixa o dispatcher tratar (ex.: Binding)
    }
  }

  /** ChannelData (primeiro byte 0x40-0x7F) chega pelo mesmo socket. */
  handleChannelData(msg: Buffer, rinfo: { address: string; port: number }): boolean {
    if (msg.length < 4) return false;
    const first = msg[0]!;
    if (first < 0x40 || first > 0x7f) return false;
    const alloc = this.#allocations.get(keyOf(rinfo));
    if (alloc === undefined) return true;
    const channel = msg.readUInt16BE(0);
    const peer = alloc.channels.get(channel);
    if (peer === undefined) return true;
    const len = msg.readUInt16BE(2);
    const data = Buffer.from(msg.subarray(4, 4 + len));
    this.counters.channelDataIn++;
    const [host, portStr] = peer.split(':');
    this.#relayOut(alloc, data, { host: host!, port: Number.parseInt(portStr!, 10) });
    return true;
  }

  #relayOut(alloc: Allocation, data: Buffer, peer: Ipv4): void {
    this.counters.relayedBytes += data.length;
    if (this.malicious !== null) {
      this.malicious.capture.push(Buffer.from(data));
      for (const needle of this.malicious.needles) {
        if (data.indexOf(needle) !== -1) this.malicious.matches++;
      }
    }
    alloc.relaySocket.send(data, peer.port, peer.host);
  }

  #handleAllocate(msg: Buffer, dec: DecodedStun, rinfo: { address: string; port: number }): boolean {
    if (dec.requestedTransport !== undefined && dec.requestedTransport !== 17) {
      this.#send(encodeTurnError(dec.type, dec.txId, 442, 'Unsupported Transport'), rinfo);
      return true;
    }
    if (!this.#checkIntegrity(msg, dec)) {
      // primeira tentativa sem credenciais → 401 com realm+nonce (RFC 5766 §10)
      this.counters.authFailures++;
      this.#send(encodeTurnError(dec.type, dec.txId, 401, 'Unauthorized', { realm: this.#auth.realm, nonce: this.#nonce }), rinfo);
      return true;
    }
    const existing = this.#allocations.get(keyOf(rinfo));
    if (existing !== undefined) {
      this.#sendAuthed(encodeTurnError(dec.type, dec.txId, 437, 'Allocation Mismatch'), rinfo);
      return true;
    }
    const relaySocket = dgram.createSocket('udp4');
    const relayBound = new Promise<void>((resolve) => relaySocket.bind({ address: '127.0.0.1', port: 0 }, resolve));
    void relayBound.then(() => {
      const port = relaySocket.address().port;
      const alloc: Allocation = {
        clientAddr: keyOf(rinfo),
        relaySocket,
        relayedAddr: { host: '127.0.0.1', port },
        expiresAt: Date.now() + TURN_DEFAULT_LIFETIME_SEC * 1000,
        permissions: new Set(),
        channels: new Map(),
        peersByChannel: new Map(),
      };
      relaySocket.on('message', (data: Buffer, from: { address: string; port: number }) => {
        // dados chegando ao relay → Data indication (ou ChannelData) para o cliente
        const peerKey = `${from.address}:${from.port}`;
        this.counters.relayedBytes += data.length;
        if (this.malicious !== null) {
          this.malicious.capture.push(Buffer.from(data));
          for (const needle of this.malicious.needles) {
            if (data.indexOf(needle) !== -1) this.malicious.matches++;
          }
        }
        const channel = alloc.peersByChannel.get(peerKey);
        const sock = this.#socket;
        if (channel !== undefined) {
          const frame = Buffer.alloc(4 + data.length);
          frame.writeUInt16BE(channel, 0);
          frame.writeUInt16BE(data.length, 2);
          data.copy(frame, 4);
          sock.send(frame, rinfo.port, rinfo.address);
        } else {
          sock.send(encodeDataIndication(crypto.randomBytes(12), { host: from.address, port: from.port }, data), rinfo.port, rinfo.address);
          this.counters.dataIndications++;
        }
      });
      this.#allocations.set(keyOf(rinfo), alloc);
      this.counters.allocates++;
      this.#sendAuthed(
        encodeAllocateSuccess(dec.txId, alloc.relayedAddr, { host: rinfo.address, port: rinfo.port }, TURN_DEFAULT_LIFETIME_SEC),
        rinfo,
      );
    });
    return true;
  }

  #handleRefresh(msg: Buffer, dec: DecodedStun, rinfo: { address: string; port: number }): boolean {
    if (!this.#checkIntegrity(msg, dec)) {
      this.counters.authFailures++;
      this.#send(encodeTurnError(dec.type, dec.txId, 401, 'Unauthorized', { realm: this.#auth.realm, nonce: this.#nonce }), rinfo);
      return true;
    }
    const alloc = this.#allocations.get(keyOf(rinfo));
    if (alloc === undefined) {
      this.#sendAuthed(encodeTurnError(dec.type, dec.txId, 437, 'Allocation Mismatch'), rinfo);
      return true;
    }
    const lifetimeSec = dec.lifetimeSec ?? TURN_DEFAULT_LIFETIME_SEC;
    if (lifetimeSec === 0) {
      alloc.relaySocket.close();
      this.#allocations.delete(keyOf(rinfo));
      this.#sendAuthed(encodeRefreshSuccess(dec.txId, 0), rinfo);
      return true;
    }
    alloc.expiresAt = Date.now() + lifetimeSec * 1000;
    this.counters.refreshes++;
    this.#sendAuthed(encodeRefreshSuccess(dec.txId, lifetimeSec), rinfo);
    return true;
  }

  #handlePermission(msg: Buffer, dec: DecodedStun, rinfo: { address: string; port: number }): boolean {
    if (!this.#checkIntegrity(msg, dec)) {
      this.counters.authFailures++;
      this.#send(encodeTurnError(dec.type, dec.txId, 401, 'Unauthorized', { realm: this.#auth.realm, nonce: this.#nonce }), rinfo);
      return true;
    }
    const alloc = this.#allocations.get(keyOf(rinfo));
    if (alloc === undefined || dec.xorPeer === undefined) {
      this.#sendAuthed(encodeTurnError(dec.type, dec.txId, 437, 'Allocation Mismatch'), rinfo);
      return true;
    }
    alloc.permissions.add(`${dec.xorPeer.host}:${dec.xorPeer.port}`);
    this.counters.permissions++;
    this.#sendAuthed(encodePermissionSuccess(dec.txId), rinfo);
    return true;
  }

  #handleChannelBind(msg: Buffer, dec: DecodedStun, rinfo: { address: string; port: number }): boolean {
    if (!this.#checkIntegrity(msg, dec)) {
      this.counters.authFailures++;
      this.#send(encodeTurnError(dec.type, dec.txId, 401, 'Unauthorized', { realm: this.#auth.realm, nonce: this.#nonce }), rinfo);
      return true;
    }
    const alloc = this.#allocations.get(keyOf(rinfo));
    if (alloc === undefined || dec.xorPeer === undefined) {
      this.#sendAuthed(encodeTurnError(dec.type, dec.txId, 437, 'Allocation Mismatch'), rinfo);
      return true;
    }
    // RFC 5766 §6.2: o CLIENTE escolhe o número do canal (0x4000–0x7FFF)
    const peerKey = `${dec.xorPeer.host}:${dec.xorPeer.port}`;
    const channel = dec.channelNumber ?? 0x4000 + alloc.channels.size;
    if (!alloc.channels.has(channel)) {
      alloc.channels.set(channel, peerKey);
      alloc.peersByChannel.set(peerKey, channel);
    }
    alloc.permissions.add(peerKey);
    this.counters.channelBinds++;
    this.#sendAuthed(encodeChannelBindSuccess(dec.txId), rinfo);
    return true;
  }

  #checkIntegrity(msg: Buffer, dec: DecodedStun): boolean {
    if (!dec.hasMessageIntegrity || dec.username === undefined || dec.realm === undefined || dec.nonce === undefined) return false;
    if (dec.username !== this.#auth.username) return false;
    if (dec.realm !== this.#auth.realm) return false;
    if (dec.nonce !== this.#nonce || Date.now() - this.#nonceIssuedAt > NONCE_VALID_MS) return false;
    const key = longTermKey(this.#auth.username, this.#auth.realm, this.#auth.password);
    return verifyMessageIntegrity(msg, key);
  }

  #permissionAllows(alloc: Allocation, peer: Ipv4): boolean {
    return alloc.permissions.has(`${peer.host}:${peer.port}`);
  }

  #send(buf: Buffer, rinfo: { address: string; port: number }): void {
    this.#socket.send(buf, rinfo.port, rinfo.address);
  }

  /** Resposta a requisição autenticada: RFC 5766 exige MESSAGE-INTEGRITY na resposta. */
  #sendAuthed(buf: Buffer, rinfo: { address: string; port: number }): void {
    this.#socket.send(addMessageIntegrity(buf, this.#key), rinfo.port, rinfo.address);
  }

  /** Responde Binding Requests (mesma socket compartilhada). */
  handleBinding(msg: Buffer, rinfo: { address: string; port: number }): boolean {
    const dec = decode(msg);
    if (dec === null || dec.type !== BINDING_REQUEST) return false;
    this.#socket.send(encodeBindingSuccess(dec.txId, { host: rinfo.address, port: rinfo.port }), rinfo.port, rinfo.address);
    return true;
  }

  sweep(now = Date.now()): number {
    let n = 0;
    for (const [k, alloc] of this.#allocations) {
      if (alloc.expiresAt <= now) {
        try {
          alloc.relaySocket.close();
        } catch {}
        this.#allocations.delete(k);
        n++;
      }
    }
    return n;
  }

  async closeAll(): Promise<void> {
    for (const alloc of this.#allocations.values()) {
      try {
        alloc.relaySocket.close();
      } catch {}
    }
    this.#allocations.clear();
  }
}

function keyOf(rinfo: { address: string; port: number }): string {
  return `${rinfo.address}:${rinfo.port}`;
}

export function isTurnMethod(type: number): boolean {
  return (
    type === TURN_ALLOCATE ||
    type === TURN_REFRESH ||
    type === TURN_SEND ||
    type === TURN_DATA ||
    type === TURN_CREATE_PERMISSION ||
    type === TURN_CHANNEL_BIND ||
    type === 0x0103 ||
    type === 0x0104 ||
    type === 0x0118 ||
    type === 0x0119
  );
}
