// §17.3 no PRODUTO — o STUN/TURN do host divide a socket UDP do UDX com o DHT.
//
// A spec manda os dois serviços na MESMA socket, demultiplexados pelo cabeçalho (os dois
// primeiros bits `00` e o magic cookie `0x2112A442` identificam STUN; o resto é UDX). O
// `MediaServer` de L2 já sabia classificar e responder — isso o G7 mediu. O que **não**
// existia era a socket: `openCriteria` do gate diz, com estas palavras, "demux/tickets no
// utilityProcess do produto". `HyperswarmBackend.mediaSocket()` é essa peça.
//
// Os dois riscos que este arquivo cobre:
//   1. o STUN responde de verdade, com XOR-MAPPED-ADDRESS correto;
//   2. instalar o classificador **não** derruba o DHT — o UDX atravessa intacto e dois nós
//      continuam se encontrando. Sem (2), ligar mídia custaria a replicação inteira.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import { after, describe, it } from 'node:test';

import createTestnet from 'hyperdht/testnet.js';

import { HyperswarmBackend, type MediaSocketTap } from '../src/l0/swarm/hyperswarm.ts';
import { MediaServer } from '../src/l2/communityHost/stunTurn.ts';

const MAGIC = 0x2112a442;

/** Sobe o `MediaServer` sobre a torneira e conta o que passou por cada lado. */
function classificar(tap: MediaSocketTap): { udx: number; stun: number; server: MediaServer } {
  const server = new MediaServer({
    realm: 'comunidade',
    hostTurnSecret: crypto.randomBytes(32),
    socket: { send: (d, a) => tap.send(d, a) },
    openRelayPort: async () => {
      throw new Error('sem relay neste teste');
    },
    sessionPeerKeys: () => new Set<string>(),
    rosterAddresses: () => new Set<string>(),
  });
  const contas = { udx: 0, stun: 0, server };
  tap.tap((data, from) => {
    const cls = server.handleDatagram(data, { host: from.host, port: from.port });
    if (cls === 'udx') {
      contas.udx += 1;
      return false;
    }
    contas.stun += 1;
    return true;
  });
  return contas;
}

/** Binding Request cru de RFC 5389 §6. */
function bindingRequest(): Buffer {
  const req = Buffer.alloc(20);
  req.writeUInt16BE(0x0001, 0);
  req.writeUInt16BE(0, 2);
  req.writeUInt32BE(MAGIC, 4);
  crypto.randomBytes(12).copy(req, 8);
  return req;
}

/** XOR-MAPPED-ADDRESS (0x0020) desxorado — RFC 5389 §15.2. */
function xorMapped(msg: Buffer): string | null {
  let off = 20;
  while (off + 4 <= msg.length) {
    const tipo = msg.readUInt16BE(off);
    const len = msg.readUInt16BE(off + 2);
    if (tipo === 0x0020) {
      const porta = msg.readUInt16BE(off + 6) ^ (MAGIC >>> 16);
      const ip: number[] = [];
      for (let i = 0; i < 4; i += 1) ip.push(msg[off + 8 + i]! ^ ((MAGIC >>> (24 - 8 * i)) & 0xff));
      return `${ip.join('.')}:${porta}`;
    }
    off += 4 + len + ((4 - (len % 4)) % 4);
  }
  return null;
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('§17.3 — socket compartilhada de STUN/TURN e UDX', () => {
  const paraFechar: Array<() => Promise<void>> = [];
  after(async () => {
    for (const f of paraFechar.reverse()) await f().catch(() => {});
  });

  it('o host responde Binding Request na mesma socket do UDX', async () => {
    const backend = new HyperswarmBackend({});
    paraFechar.push(() => backend.destroy());
    await esperar(2_000);

    const tap = backend.mediaSocket();
    assert.ok(tap !== null, 'mediaSocket() precisa existir com o DHT ligado');
    const contas = classificar(tap);
    const addr = tap.address();

    const cliente = dgram.createSocket('udp4');
    paraFechar.push(async () => {
      cliente.close();
    });
    const resposta = new Promise<Buffer>((resolve, reject) => {
      cliente.once('message', resolve);
      setTimeout(() => reject(new Error('sem resposta STUN em 5 s')), 5_000);
    });
    cliente.send(bindingRequest(), addr.port, '127.0.0.1');
    const msg = await resposta;

    assert.equal(msg.readUInt16BE(0), 0x0101, 'tipo precisa ser Binding Success Response');
    assert.equal(xorMapped(msg), `127.0.0.1:${cliente.address().port}`);
    assert.equal(contas.stun, 1);
    assert.equal(contas.server.counters.bindingRequests, 1);
  });

  it('datagrama UDX atravessa o classificador intacto, para o dono da socket', async () => {
    const backend = new HyperswarmBackend({});
    paraFechar.push(() => backend.destroy());
    await esperar(2_000);

    const tap = backend.mediaSocket();
    assert.ok(tap !== null);

    // Um observador instalado ANTES do classificador ocupa o lugar do DHT: `tap()` recolhe
    // os listeners que já estavam e é obrigado a redespachar para eles o que não consumiu.
    // Se esse repasse quebrar, o DHT para de receber pacote — e a replicação vai junto.
    const recebidos: Buffer[] = [];
    tap.tap((data) => {
      recebidos.push(Buffer.from(data));
      return false;
    });

    const contas = classificar(tap);
    const addr = tap.address();

    // Carga UDX: o primeiro bit NÃO é `0`, então não é STUN (§17.3).
    const udx = Buffer.from([0xff, 0x01, 0x02, 0x03, 0xde, 0xad, 0xbe, 0xef]);
    const cliente = dgram.createSocket('udp4');
    paraFechar.push(async () => {
      cliente.close();
    });
    cliente.send(udx, addr.port, '127.0.0.1');
    await esperar(500);

    assert.equal(contas.udx, 1, 'o datagrama precisa ser classificado como UDX');
    assert.equal(contas.stun, 0, 'UDX não pode ser confundido com STUN');
    assert.ok(
      recebidos.some((b) => b.equals(udx)),
      'quem estava na socket antes precisa receber o datagrama, byte a byte',
    );
  });
});
