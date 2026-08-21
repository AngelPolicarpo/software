// Codec STUN mínimo (RFC 5389, Binding) + classificador de demux §17.3.
// Regra normativa: os dois primeiros bits `00` e o magic cookie 0x2112A442 identificam STUN;
// o resto da socket é UDX. A coerência do campo de comprimento é refinamento seguro:
// todo pacote STUN válido a satisfaz por construção (RFC 5389 §6).

import crypto from 'node:crypto';

export const STUN_MAGIC = 0x2112a442;
export const BINDING_REQUEST = 0x0001;
export const BINDING_SUCCESS = 0x0101;
export const BINDING_ERROR = 0x0111;

const ATTR_XOR_MAPPED = 0x0020;
const ATTR_ERROR_CODE = 0x0009;
const ATTR_SOFTWARE = 0x8022;

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
      const port = value.readUInt16BE(2) ^ (STUN_MAGIC >>> 16);
      const ip = [];
      for (let i = 0; i < 4; i++) ip.push((value[4 + i]! ^ ((STUN_MAGIC >>> (24 - 8 * i)) & 0xff)).toString(10));
      out.xorMapped = { host: ip.join('.'), port };
    } else if (at === ATTR_ERROR_CODE && alen >= 4) {
      out.errorCode = (value[2] ?? 0) * 100 + (value[3] ?? 0);
    } else if (at === ATTR_SOFTWARE) {
      out.software = value.toString('utf8');
    }
    off += 4 + alen + ((4 - (alen % 4)) % 4);
  }
  return out;
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
