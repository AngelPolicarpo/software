// Codec STUN mínimo (RFC 5389, Binding) + classificador de demux §17.3.
// Regra normativa: os dois primeiros bits `00` e o magic cookie 0x2112A442 identificam STUN;
// o resto da socket é UDX. A coerência do campo de comprimento é refinamento seguro:
// todo pacote STUN válido a satisfaz por construção (RFC 5389 §6).

import crypto from 'node:crypto';

export const STUN_MAGIC = 0x2112a442;
export const BINDING_REQUEST = 0x0001;
export const BINDING_SUCCESS = 0x0101;
export const BINDING_ERROR = 0x0111;
// TURN (RFC 5766)
export const TURN_ALLOCATE = 0x0003;
export const TURN_REFRESH = 0x0004;
export const TURN_SEND = 0x0016;
export const TURN_DATA = 0x0017;
export const TURN_CREATE_PERMISSION = 0x0008;
export const TURN_CHANNEL_BIND = 0x0009;

const ATTR_XOR_MAPPED = 0x0020;
const ATTR_ERROR_CODE = 0x0009;
const ATTR_SOFTWARE = 0x8022;
const ATTR_USERNAME = 0x0006;
const ATTR_MESSAGE_INTEGRITY = 0x0008;
const ATTR_REALM = 0x0014;
const ATTR_NONCE = 0x0015;
const ATTR_LIFETIME = 0x000d;
const ATTR_XOR_PEER = 0x0012;
const ATTR_XOR_RELAYED = 0x0016;
const ATTR_REQUESTED_TRANSPORT = 0x0019;
const ATTR_DATA = 0x0013;

export type Ipv4 = { host: string; port: number };

export function randomTxId(): Buffer {
  return crypto.randomBytes(12);
}

function attr(type: number, value: Buffer): Buffer {
  const pad = (4 - (value.length % 4)) % 4;
  const head = Buffer.alloc(4);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(value.length, 2);
  return Buffer.concat([head, value, Buffer.alloc(pad)]);
}

export function encodeBindingRequest(txId: Buffer = randomTxId()): Buffer {
  const head = Buffer.alloc(20);
  head.writeUInt16BE(BINDING_REQUEST, 0);
  head.writeUInt16BE(0, 2);
  head.writeUInt32BE(STUN_MAGIC, 4);
  txId.copy(head, 8);
  return head;
}

function ipv4ToBuffer(host: string): Buffer {
  const parts = host.split('.').map((s) => Number.parseInt(s, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`IPv4 inválido: ${host}`);
  }
  return Buffer.from(parts as number[]);
}

export function encodeBindingSuccess(txId: Buffer, addr: Ipv4): Buffer {
  const xport = addr.port ^ (STUN_MAGIC >>> 16);
  const ip = ipv4ToBuffer(addr.host);
  const xaddr = Buffer.alloc(4);
  for (let i = 0; i < 4; i++) xaddr[i] = ip[i]! ^ ((STUN_MAGIC >>> (24 - 8 * i)) & 0xff);
  const value = Buffer.concat([Buffer.from([0x00, 0x01]), Buffer.alloc(2), Buffer.alloc(2), Buffer.alloc(4)]);
  value.writeUInt16BE(xport, 2);
  xaddr.copy(value, 4);
  const body = attr(ATTR_XOR_MAPPED, value.subarray(0, 8));
  const head = Buffer.alloc(20);
  head.writeUInt16BE(BINDING_SUCCESS, 0);
  head.writeUInt16BE(body.length, 2);
  head.writeUInt32BE(STUN_MAGIC, 4);
  txId.copy(head, 8);
  return Buffer.concat([head, body]);
}

export function encodeBindingError(txId: Buffer, code: number, reason: string): Buffer {
  const value = Buffer.concat([
    Buffer.from([0x00, 0x00, Math.floor(code / 100), code % 100]),
    Buffer.from(reason, 'utf8'),
  ]);
  const body = attr(ATTR_ERROR_CODE, value);
  const head = Buffer.alloc(20);
  head.writeUInt16BE(BINDING_ERROR, 0);
  head.writeUInt16BE(body.length, 2);
  head.writeUInt32BE(STUN_MAGIC, 4);
  txId.copy(head, 8);
  return Buffer.concat([head, body]);
}

export interface DecodedStun {
  type: number;
  txId: Buffer;
  xorMapped?: Ipv4;
  errorCode?: number;
  software?: string;
  username?: string;
  realm?: string;
  nonce?: string;
  lifetimeSec?: number;
  requestedTransport?: number;
  xorPeer?: Ipv4;
  xorRelayed?: Ipv4;
  data?: Buffer;
  channelNumber?: number;
  hasMessageIntegrity?: boolean;
}

/** Decodifica um pacote STUN estruturalmente válido; null se malformado. */
export function decode(buf: Buffer): DecodedStun | null {
  if (!isStructurallyStun(buf)) return null;
  const type = buf.readUInt16BE(0);
  const len = buf.readUInt16BE(2);
  const txId = buf.subarray(8, 20);
  const out: DecodedStun = { type, txId: Buffer.from(txId) };
  let off = 20;
  const end = 20 + len;
  while (off + 4 <= end) {
    const at = buf.readUInt16BE(off);
    const alen = buf.readUInt16BE(off + 2);
    if (off + 4 + alen > end) return null;
    const value = buf.subarray(off + 4, off + 4 + alen);
    if (at === ATTR_XOR_MAPPED && alen >= 8 && value[1] === 0x01) {
      out.xorMapped = decodeXorAddress(value);
    } else if (at === ATTR_ERROR_CODE && alen >= 4) {
      out.errorCode = (value[2] ?? 0) * 100 + (value[3] ?? 0);
    } else if (at === ATTR_SOFTWARE) {
      out.software = value.toString('utf8');
    } else if (at === 0x0006 && type === TURN_CHANNEL_BIND && alen === 4) {
      // CHANNEL-NUMBER compartilha o tipo 0x0006 com USERNAME; o contexto é o método
      out.channelNumber = value.readUInt16BE(0);
    } else if (at === ATTR_USERNAME) {
      out.username = value.toString('utf8');
    } else if (at === ATTR_REALM) {
      out.realm = value.toString('utf8');
    } else if (at === ATTR_NONCE) {
      out.nonce = value.toString('utf8');
    } else if (at === ATTR_LIFETIME && alen === 4) {
      out.lifetimeSec = value.readUInt32BE(0);
    } else if (at === ATTR_REQUESTED_TRANSPORT && alen === 4) {
      out.requestedTransport = value[0] ?? 0;
    } else if (at === ATTR_XOR_PEER && alen >= 8 && value[1] === 0x01) {
      out.xorPeer = decodeXorAddress(value);
    } else if (at === ATTR_XOR_RELAYED && alen >= 8 && value[1] === 0x01) {
      out.xorRelayed = decodeXorAddress(value);
    } else if (at === ATTR_DATA) {
      out.data = Buffer.from(value);
    } else if (at === ATTR_MESSAGE_INTEGRITY) {
      out.hasMessageIntegrity = true;
    }
    off += 4 + alen + ((4 - (alen % 4)) % 4);
  }
  return out;
}

function decodeXorAddress(value: Buffer): Ipv4 {
  const port = value.readUInt16BE(2) ^ (STUN_MAGIC >>> 16);
  const ip: string[] = [];
  for (let i = 0; i < 4; i++) ip.push((value[4 + i]! ^ ((STUN_MAGIC >>> (24 - 8 * i)) & 0xff)).toString(10));
  return { host: ip.join('.'), port };
}

function encodeXorAddress(addr: Ipv4): Buffer {
  const value = Buffer.alloc(8);
  value[1] = 0x01;
  value.writeUInt16BE(addr.port ^ (STUN_MAGIC >>> 16), 2);
  const ip = ipv4ToBuffer(addr.host);
  for (let i = 0; i < 4; i++) value[4 + i] = ip[i]! ^ ((STUN_MAGIC >>> (24 - 8 * i)) & 0xff);
  return value;
}

function message(type: number, txId: Buffer, body: Buffer): Buffer {
  const head = Buffer.alloc(20);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(body.length, 2);
  head.writeUInt32BE(STUN_MAGIC, 4);
  txId.copy(head, 8);
  return Buffer.concat([head, body]);
}

/** Regra §17.3: bits `00` + magic cookie (+ coerência de comprimento). */
export function isStructurallyStun(buf: Buffer): boolean {
  if (buf.length < 20) return false;
  if ((buf[0]! & 0xc0) !== 0) return false;
  if (buf.readUInt32BE(4) !== STUN_MAGIC) return false;
  return 20 + buf.readUInt16BE(2) === buf.length;
}

export type PacketClass = 'stun' | 'udx';

/** Demux da socket compartilhada: tudo que não é STUN vai à pilha UDX. */
export function classify(buf: Buffer): PacketClass {
  return isStructurallyStun(buf) ? 'stun' : 'udx';
}

/**
 * Segunda implementação independente da mesma regra (DataView, sem reads BE compostos).
 * O gate exige concordância 100% entre as duas em todo o corpus — discordância indica
 * bug de implementação, não ambiguidade da regra.
 */
export function classifyAlt(buf: Buffer): PacketClass {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength < 20) return 'udx';
  const b0 = dv.getUint8(0);
  if ((b0 & 0xc0) !== 0) return 'udx';
  const cookie = dv.getUint32(4);
  if (cookie !== STUN_MAGIC) return 'udx';
  const msgLen = dv.getUint16(2);
  return 20 + msgLen === buf.byteLength ? 'stun' : 'udx';
}

// ─── Encoders TURN (RFC 5766 subset §17.3) ───────────────────────────────────

export interface TurnAttr {
  type: number;
  value: Buffer;
}

export function encodeTurnRequest(type: number, txId: Buffer, attrs: TurnAttr[]): Buffer {
  return message(type, txId, Buffer.concat(attrs.map((a) => attr(a.type, a.value))));
}

export function encodeTurnError(reqType: number, txId: Buffer, code: number, reason: string, extra: { realm?: string; nonce?: string } = {}): Buffer {
  const errValue = Buffer.concat([Buffer.from([0x00, 0x00, Math.floor(code / 100), code % 100]), Buffer.from(reason, 'utf8')]);
  const parts: TurnAttr[] = [{ type: ATTR_ERROR_CODE, value: errValue }];
  if (extra.realm !== undefined) parts.push({ type: ATTR_REALM, value: Buffer.from(extra.realm, 'utf8') });
  if (extra.nonce !== undefined) parts.push({ type: ATTR_NONCE, value: Buffer.from(extra.nonce, 'utf8') });
  return message(reqType | 0x0110, txId, Buffer.concat(parts.map((p) => attr(p.type, p.value))));
}

export function encodeAllocateSuccess(txId: Buffer, relayed: Ipv4, mapped: Ipv4, lifetimeSec: number): Buffer {
  const life = Buffer.alloc(4);
  life.writeUInt32BE(lifetimeSec, 0);
  const body = Buffer.concat([attr(ATTR_XOR_RELAYED, encodeXorAddress(relayed)), attr(ATTR_XOR_MAPPED, encodeXorAddress(mapped)), attr(ATTR_LIFETIME, life)]);
  return message(0x0103, txId, body);
}

export function encodeRefreshSuccess(txId: Buffer, lifetimeSec: number): Buffer {
  const life = Buffer.alloc(4);
  life.writeUInt32BE(lifetimeSec, 0);
  return message(0x0104, txId, attr(ATTR_LIFETIME, life));
}

export function encodePermissionSuccess(txId: Buffer): Buffer {
  return message(0x0108, txId, Buffer.alloc(0)); // CreatePermission Success (classe 01)
}

export function encodeChannelBindSuccess(txId: Buffer): Buffer {
  return message(0x0109, txId, Buffer.alloc(0)); // ChannelBind Success (classe 01)
}

export function encodeSendIndication(txId: Buffer, peer: Ipv4, data: Buffer): Buffer {
  return message(TURN_SEND, txId, Buffer.concat([attr(ATTR_XOR_PEER, encodeXorAddress(peer)), attr(ATTR_DATA, data)]));
}

export function encodeDataIndication(txId: Buffer, peer: Ipv4, data: Buffer): Buffer {
  return message(TURN_DATA, txId, Buffer.concat([attr(ATTR_XOR_PEER, encodeXorAddress(peer)), attr(ATTR_DATA, data)]));
}

// ─── MESSAGE-INTEGRITY (RFC 5389 §15.4, long-term credentials §10.2) ────────

/** Chave long-term: MD5(username:realm:password) — mesma derivação de makeTurnIntegrityKey do werift. */
export function longTermKey(username: string, realm: string, password: string): Buffer {
  return crypto.createHash('md5').update(`${username}:${realm}:${password}`, 'utf8').digest();
}

/** Anexa MESSAGE-INTEGRITY como último atributo (HMAC-SHA1 com length ajustado). */
export function addMessageIntegrity(buf: Buffer, key: Buffer): Buffer {
  const bodyLen = buf.readUInt16BE(2);
  const head = Buffer.from(buf.subarray(0, 20));
  head.writeUInt16BE(bodyLen + 24, 2);
  const mac = crypto.createHmac('sha1', key).update(Buffer.concat([head, buf.subarray(20)])).digest();
  return Buffer.concat([head, buf.subarray(20), attr(ATTR_MESSAGE_INTEGRITY, mac)]);
}

/** Verifica MESSAGE-INTEGRITY onde quer que o atributo esteja (hash termina antes dele). */
export function verifyMessageIntegrity(buf: Buffer, key: Buffer): boolean {
  let off = 20;
  let miOff = -1;
  while (off + 4 <= buf.length) {
    const at = buf.readUInt16BE(off);
    const alen = buf.readUInt16BE(off + 2);
    if (at === ATTR_MESSAGE_INTEGRITY && alen === 20) {
      miOff = off;
      break;
    }
    off += 4 + alen + ((4 - (alen % 4)) % 4);
  }
  if (miOff < 0) return false;
  const head = Buffer.from(buf.subarray(0, 20));
  head.writeUInt16BE(miOff - 20 + 24, 2);
  const expected = crypto.createHmac('sha1', key).update(Buffer.concat([head, buf.subarray(20, miOff)])).digest();
  try {
    return crypto.timingSafeEqual(expected, buf.subarray(miOff + 4, miOff + 24));
  } catch {
    return false;
  }
}
