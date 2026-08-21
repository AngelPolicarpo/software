// Testes do módulo de mídia — STUN/TURN comunitários (§17.3, A17) sobre portas injetadas.
// Vetores e decisões reutilizados da evidência G7 (poc/poc-08-g7); o código do poc é
// descartável, as decisões não.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MediaServer,
  TURN_ALLOCATE,
  TURN_CHANNEL_BIND,
  TURN_CREATE_PERMISSION,
  TURN_REFRESH,
  TURN_SEND,
  addMessageIntegrity,
  classifyInbound,
  decode,
  encodeBindingRequest,
  encodeTurnRequest,
  frameChannelData,
  issueTurnCredential,
  longTermKey,
  parseChannelData,
  randomTxId,
  turnCredentialPassword,
  verifyMessageIntegrity,
  type MediaAddr,
  type MediaServerOptions,
  type MediaSocketPort,
  type RelayPort,
} from '../src/l2/communityHost/stunTurn.ts';
import { resolveConfig } from '../src/l0/config/index.ts';
import { keypairFromSeed } from './helpers/world.ts';

const REALM = 'comunidade.test';
const CLIENT: MediaAddr = { host: '10.0.0.1', port: 50_001 };
const PEER_ADDR: MediaAddr = { host: '10.0.0.2', port: 50_002 };
const ATTR_USERNAME = 0x0006;
const ATTR_REALM = 0x0014;
const ATTR_NONCE = 0x0015;
const ATTR_LIFETIME = 0x000d;
const ATTR_XOR_PEER = 0x0012;
const ATTR_DATA = 0x0013;

function fakeClock(): { now(): number; advance(ms: number): void } {
  let t = 1_000_000;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

type SentDatagram = { data: Buffer; addr: MediaAddr };

function fakeSocket(): { port: MediaSocketPort; sents: SentDatagram[] } {
  const sents: SentDatagram[] = [];
  return {
    sents,
    port: {
      send(datagram, addr) {
        sents.push({ data: Buffer.from(datagram), addr });
      },
    },
  };
}

type SocketHandle = ReturnType<typeof fakeSocket>;

class FakeRelayPort implements RelayPort {
  readonly addr: MediaAddr;
  readonly sents: SentDatagram[] = [];
  closed = false;
  #cb: ((data: Uint8Array, from: MediaAddr) => void) | null = null;

  constructor(addr: MediaAddr) {
    this.addr = addr;
  }

  send(datagram: Uint8Array, addr: MediaAddr): void {
    this.sents.push({ data: Buffer.from(datagram), addr });
  }

  onData(cb: (data: Uint8Array, from: MediaAddr) => void): void {
    this.#cb = cb;
  }

  /** Simula um datagrama chegando ao relay de um par. */
  receive(data: Buffer, from: MediaAddr): void {
    this.#cb?.(data, from);
  }

  close(): void {
    this.closed = true;
  }
}

interface Fixture {
  clock: ReturnType<typeof fakeClock>;
  socket: SocketHandle;
  relays: FakeRelayPort[];
  server: MediaServer;
  secret: Buffer;
  member: ReturnType<typeof keypairFromSeed>;
  sessionId: string;
  username: string;
  password: string;
  roster: Set<string>;
}

function fixture(overrides: Partial<MediaServerOptions> = {}): Fixture {
  const clock = fakeClock();
  const socket = fakeSocket();
  const relays: FakeRelayPort[] = [];
  const secret = Buffer.alloc(32, 9);
  const member = keypairFromSeed('membro-voz');
  const sessionId = 'sess-voz-1';
  const expiresAt = clock.now() + 300_000;
  let nextRelayPort = 40_000;
  const roster = new Set<string>([`${PEER_ADDR.host}:${PEER_ADDR.port}`]);
  const server = new MediaServer({
    realm: REALM,
    hostTurnSecret: secret,
    socket: socket.port,
    openRelayPort: async () => {
      const relay = new FakeRelayPort({ host: '203.0.113.10', port: nextRelayPort++ });
      relays.push(relay);
      return relay;
    },
    sessionPeerKeys: () => new Set([member.publicKey.toString('hex')]),
    rosterAddresses: () => roster,
    now: clock.now,
    ...overrides,
  });
  const cred = issueTurnCredential(secret, sessionId, member.publicKey, expiresAt);
  return {
    clock,
    socket,
    relays,
    server,
    secret,
    member,
    sessionId,
    username: cred.username,
    password: cred.password,
    roster,
  };
}

function findChallengeNonce(f: Fixture): string | null {
  for (let i = f.socket.sents.length - 1; i >= 0; i--) {
    const dec = decode(f.socket.sents[i]!.data);
    if (dec?.errorCode === 401 && dec.nonce !== undefined) return dec.nonce;
  }
  return null;
}

function currentNonce(f: Fixture): string {
  const found = findChallengeNonce(f);
  if (found !== null) return found;
  f.server.handleDatagram(encodeTurnRequest(TURN_ALLOCATE, randomTxId(), []), CLIENT);
  return findChallengeNonce(f)!;
}

function authedRequest(
  f: Fixture,
  type: number,
  attrs: Parameters<typeof encodeTurnRequest>[2],
  overrides: { client?: MediaAddr; username?: string; password?: string; nonce?: string } = {},
): Buffer {
  const username = overrides.username ?? f.username;
  const nonce = overrides.nonce ?? currentNonce(f);
  const req = encodeTurnRequest(type, randomTxId(), [
    { type: ATTR_USERNAME, value: Buffer.from(username, 'utf8') },
    { type: ATTR_REALM, value: Buffer.from(REALM, 'utf8') },
    { type: ATTR_NONCE, value: Buffer.from(nonce, 'utf8') },
    ...attrs,
  ]);
  return addMessageIntegrity(req, longTermKey(username, REALM, overrides.password ?? f.password));
}

async function drain(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
}

async function allocate(f: Fixture): Promise<void> {
  f.server.handleDatagram(authedRequest(f, TURN_ALLOCATE, []), CLIENT);
  await drain();
}

function grantPermission(f: Fixture): void {
  f.server.handleDatagram(
    authedRequest(f, TURN_CREATE_PERMISSION, [{ type: ATTR_XOR_PEER, value: xorPeerValue(PEER_ADDR) }]),
    CLIENT,
  );
}

function indication(f: Fixture, type: number, peer: MediaAddr, data: Buffer, client: MediaAddr = CLIENT): void {
  // Indicações também carregam MESSAGE-INTEGRITY com a credencial de curta duração
  f.server.handleDatagram(
    authedRequest(f, type, [
      { type: ATTR_XOR_PEER, value: xorPeerValue(peer) },
      { type: ATTR_DATA, value: data },
    ]),
    client,
  );
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n, 0);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function xorPeerValue(addr: MediaAddr): Buffer {
  const value = Buffer.alloc(8);
  value[1] = 0x01;
  value.writeUInt16BE(addr.port ^ 0x2112, 2);
  const ip = addr.host.split('.').map((s) => Number.parseInt(s, 10));
  for (let i = 0; i < 4; i++) value[4 + i] = ip[i]! ^ [0x21, 0x12, 0xa4, 0x42][i]!;
  return value;
}

/** Reenquadra a resposta removendo o MESSAGE-INTEGRITY final para inspecionar atributos. */
function stripMessageIntegrity(buf: Buffer): Buffer {
  const stripped = buf.readUInt16BE(2) - 24;
  const head = Buffer.from(buf.subarray(0, 20));
  head.writeUInt16BE(stripped, 2);
  return Buffer.concat([head, buf.subarray(20, 20 + stripped)]);
}

// ─── Demux §17.3 ────────────────────────────────────────────────────────────────────────

describe('demux §17.3 na socket compartilhada', () => {
  it('regra literal: bits 00 + magic cookie + comprimento coerente é STUN', () => {
    assert.equal(classifyInbound(encodeBindingRequest()), 'stun');
  });

  it('UDX real (primeiro byte 0xff) e lixo vão para a pilha UDX', () => {
    const udx = Buffer.concat([Buffer.from([0xff, 0x51, 0x00]), Buffer.alloc(64, 0xab)]);
    assert.equal(classifyInbound(udx), 'udx');
    assert.equal(classifyInbound(Buffer.alloc(0)), 'udx');
    assert.equal(classifyInbound(Buffer.alloc(19)), 'udx');
  });

  it('adversarial: cookie errado, bits 10/11 e length mentirosa não são STUN', () => {
    const base = encodeBindingRequest();

    const cookieErrado = Buffer.from(base);
    cookieErrado.writeUInt32BE(0xdeadbeef, 4);
    assert.equal(classifyInbound(cookieErrado), 'udx');

    for (const first of [0x80, 0xc0]) {
      const b = Buffer.from(base);
      b[0] = first;
      assert.equal(classifyInbound(b), 'udx');
    }

    const lenErrada = Buffer.from(base);
    lenErrada.writeUInt16BE(4, 2);
    assert.equal(classifyInbound(lenErrada), 'udx');
  });

  it('ChannelData (bits 01) é roteado ao TURN antes do fallback UDX', () => {
    const frame = frameChannelData(0x4001, Buffer.from('srtp'));
    assert.equal(classifyInbound(frame), 'channel-data');
    assert.deepEqual(parseChannelData(frame), { channel: 0x4001, data: Buffer.from('srtp') });
  });

  it('handleDatagram devolve udx intacto para a pilha UDX e consome STUN', async () => {
    const f = fixture();
    const udx = Buffer.concat([Buffer.from([0xff]), Buffer.alloc(31, 1)]);
    assert.equal(f.server.handleDatagram(udx, CLIENT), 'udx');
    assert.equal(f.server.handleDatagram(encodeBindingRequest(), CLIENT), 'stun');
    await drain();
    assert.equal(f.socket.sents.length, 1); // só o Binding gerou resposta
  });
});

// ─── STUN Binding ───────────────────────────────────────────────────────────────────────

describe('STUN Binding (RFC 5389)', () => {
  it('responde XOR-MAPPED-ADDRESS com o endereço de origem observado', async () => {
    const f = fixture();
    const txId = Buffer.from('txid-binding'); // 12 B
    f.server.handleDatagram(encodeBindingRequest(txId), CLIENT);
    await drain();
    assert.equal(f.server.counters.bindingRequests, 1);
    assert.equal(f.socket.sents.length, 1);
    const dec = decode(f.socket.sents[0]!.data);
    assert.ok(dec !== null);
    assert.equal(dec.type, 0x0101);
    assert.deepEqual(dec.txId, txId);
    assert.deepEqual(dec.xorMapped, CLIENT);
  });
});

// ─── Allocate e autenticação ────────────────────────────────────────────────────────────

describe('TURN Allocate com credencial de curta duração (§17.3)', () => {
  it('sem MESSAGE-INTEGRITY responde 401 com realm+nonce', async () => {
    const f = fixture();
    f.server.handleDatagram(encodeTurnRequest(TURN_ALLOCATE, randomTxId(), []), CLIENT);
    await drain();
    const dec = decode(f.socket.sents[0]!.data);
    assert.equal(dec?.errorCode, 401);
    assert.equal(dec?.realm, REALM);
    assert.ok((dec?.nonce ?? '').length > 0);
    assert.equal(f.server.counters.allocates, 0);
  });

  it('credencial válida do roster aloca e devolve XOR-RELAYED/XOR-MAPPED/LIFETIME autenticados', async () => {
    const f = fixture({ allocTtlMs: 600_000 });
    await allocate(f);
    assert.equal(f.server.counters.allocates, 1);
    const raw = f.socket.sents.at(-1)!.data; // a última resposta é o Allocate Success
    const dec = stripMessageIntegrity(raw);
    const parsed = decode(dec);
    assert.equal(parsed?.type, 0x0103);
    assert.deepEqual(parsed?.xorRelayed, f.relays[0]!.addr);
    assert.deepEqual(parsed?.xorMapped, CLIENT);
    assert.equal(parsed?.lifetimeSec, 600);
    // resposta autenticada com a chave long-term derivada da senha emitida
    assert.ok(verifyMessageIntegrity(raw, longTermKey(f.username, REALM, f.password)));
  });

  it('senha errada é recusada sem novo desafio', async () => {
    const f = fixture();
    currentNonce(f); // provoca o 401 inicial
    const antes = f.socket.sents.length;
    f.server.handleDatagram(authedRequest(f, TURN_ALLOCATE, [], { password: 'senha-errada' }), CLIENT);
    await drain();
    assert.equal(decode(f.socket.sents[antes]!.data)?.errorCode, 401);
    assert.equal(f.server.counters.authFailures, 1);
  });

  it('par sem sessão de voz ativa é recusado (§17.3: só membro com sessão ativa)', async () => {
    const f = fixture({ sessionPeerKeys: () => new Set<string>() });
    f.server.handleDatagram(authedRequest(f, TURN_ALLOCATE, []), CLIENT);
    await drain();
    assert.equal(decode(f.socket.sents.at(-1)!.data)?.errorCode, 401);
  });

  it('credencial expirada é recusada', async () => {
    const f = fixture();
    f.clock.advance(301_000);
    f.server.handleDatagram(authedRequest(f, TURN_ALLOCATE, []), CLIENT);
    await drain();
    assert.equal(decode(f.socket.sents.at(-1)!.data)?.errorCode, 401);
  });

  it('REQUESTED-TRANSPORT diferente de UDP é recusado com 442', async () => {
    const f = fixture();
    currentNonce(f);
    const antes = f.socket.sents.length;
    f.server.handleDatagram(
      authedRequest(f, TURN_ALLOCATE, [{ type: 0x0019, value: Buffer.from([6, 0, 0, 0]) }]),
      CLIENT,
    );
    await drain();
    assert.equal(decode(f.socket.sents[antes]!.data)?.errorCode, 442);
  });

  it('terceira alocação do mesmo membro excede TURN_ALLOC_PER_MEMBER → 486', async () => {
    const f = fixture();
    await allocate(f);
    const client2: MediaAddr = { host: CLIENT.host, port: 50_002 };
    const client3: MediaAddr = { host: CLIENT.host, port: 50_003 };
    f.server.handleDatagram(authedRequest(f, TURN_ALLOCATE, []), client2);
    await drain();
    f.server.handleDatagram(authedRequest(f, TURN_ALLOCATE, []), client3);
    await drain();
    assert.equal(decode(f.socket.sents.at(-1)!.data)?.errorCode, 486);
    assert.equal(f.server.allocationCount, 2);
  });

  it('segundo Allocate no mesmo 5-tuple é 437 Allocation Mismatch', async () => {
    const f = fixture();
    await allocate(f);
    const antes = f.socket.sents.length;
    f.server.handleDatagram(authedRequest(f, TURN_ALLOCATE, []), CLIENT);
    await drain();
    assert.equal(decode(f.socket.sents[antes]!.data)?.errorCode, 437);
  });
});

// ─── Refresh / permissão / canal / dados ────────────────────────────────────────────────

describe('TURN Refresh, CreatePermission, ChannelBind e Send/Data', () => {
  it('refresh renova dentro do TTL; lifetime 0 fecha; alloc inexistente é 437', async () => {
    const f = fixture({ allocTtlMs: 60_000 });
    await allocate(f);

    f.clock.advance(59_000);
    f.server.handleDatagram(authedRequest(f, TURN_REFRESH, [{ type: ATTR_LIFETIME, value: u32(120) }]), CLIENT);
    await drain();
    assert.equal(f.server.counters.refreshes, 1);
    // a vida concedida é a política do host, não a pedida
    assert.equal(decode(stripMessageIntegrity(f.socket.sents.at(-1)!.data))?.lifetimeSec, 60);
    assert.equal(f.server.allocationFor(`${CLIENT.host}:${CLIENT.port}`)?.bytesRelayed, 0);

    f.clock.advance(59_000); // renovado até ~118 s; ainda vivo
    assert.equal(f.server.sweep(), 0);
    assert.equal(f.server.allocationCount, 1);

    f.server.handleDatagram(authedRequest(f, TURN_REFRESH, [{ type: ATTR_LIFETIME, value: u32(0) }]), CLIENT);
    await drain();
    assert.equal(f.server.allocationCount, 0);
    assert.ok(f.relays[0]!.closed);

    const apos = f.socket.sents.length;
    f.server.handleDatagram(authedRequest(f, TURN_REFRESH, []), CLIENT);
    await drain();
    assert.equal(decode(f.socket.sents[apos]!.data)?.errorCode, 437);
  });

  it('permissão só para endereços do roster da sessão (§17.3)', async () => {
    const f = fixture();
    await allocate(f);

    grantPermission(f);
    await drain();
    assert.equal(f.server.counters.permissionsGranted, 1);
    assert.equal(decode(stripMessageIntegrity(f.socket.sents.at(-1)!.data))?.type, 0x0108);

    const fora: MediaAddr = { host: '192.0.2.99', port: 9 };
    f.server.handleDatagram(
      authedRequest(f, TURN_CREATE_PERMISSION, [{ type: ATTR_XOR_PEER, value: xorPeerValue(fora) }]),
      CLIENT,
    );
    await drain();
    assert.equal(f.server.counters.permissionsRefused, 1);
    assert.equal(decode(f.socket.sents.at(-1)!.data)?.errorCode, 403);

    // Send indication para endereço sem permissão não repassa
    indication(f, TURN_SEND, fora, Buffer.from('x'));
    await drain();
    assert.equal(f.relays[0]!.sents.length, 0);
    assert.equal(f.server.counters.notPermittedDropped, 1);
  });

  it('Send indication permitido repassa ao par; dado do par volta como Data indication', async () => {
    const f = fixture();
    await allocate(f);
    grantPermission(f);
    await drain();

    const payload = Buffer.alloc(160, 7); // cadência de voz do gate
    indication(f, TURN_SEND, PEER_ADDR, payload);
    await drain();
    assert.equal(f.server.counters.relayedPackets, 1);
    assert.equal(f.server.counters.relayedBytes, payload.length);
    assert.deepEqual(f.relays[0]!.sents[0], { data: payload, addr: PEER_ADDR });

    f.relays[0]!.receive(Buffer.from('eco'), PEER_ADDR);
    await drain();
    const back = decode(f.socket.sents.at(-1)!.data);
    assert.equal(back?.type, 0x0017);
    assert.deepEqual(back?.xorPeer, PEER_ADDR);
    assert.deepEqual(back?.data, Buffer.from('eco'));
    assert.equal(f.server.counters.dataIndications, 1);
  });

  it('Send indication de alocação inexistente ou sem MI não repassa', async () => {
    const f = fixture();
    indication(f, TURN_SEND, PEER_ADDR, Buffer.from('fantasma'));
    await drain();
    assert.equal(f.relays.length, 0);

    await allocate(f);
    grantPermission(f);
    const req = encodeTurnRequest(TURN_SEND, randomTxId(), [
      { type: ATTR_XOR_PEER, value: xorPeerValue(PEER_ADDR) },
      { type: ATTR_DATA, value: Buffer.from('sem-mi') },
    ]);
    const antes = f.relays[0]!.sents.length;
    f.server.handleDatagram(req, CLIENT); // sem MESSAGE-INTEGRITY
    await drain();
    assert.equal(f.relays[0]!.sents.length, antes);
  });

  it('ChannelBind fora do roster é 403; dentro do roster troca ChannelData nos dois sentidos', async () => {
    const f = fixture();
    await allocate(f);
    const bindFrame = (peer: MediaAddr): Buffer =>
      authedRequest(f, TURN_CHANNEL_BIND, [
        // CHANNEL-NUMBER (0x0006, 2 B + 2 RFFU) compartilha o tipo com USERNAME; o
        // decodificador resolve pelo método
        { type: ATTR_USERNAME, value: Buffer.concat([u16(0x4000), u16(0)]) },
        { type: ATTR_XOR_PEER, value: xorPeerValue(peer) },
      ]);

    f.server.handleDatagram(bindFrame({ host: '198.51.100.1', port: 1 }), CLIENT);
    await drain();
    assert.equal(decode(f.socket.sents.at(-1)!.data)?.errorCode, 403);

    f.server.handleDatagram(bindFrame(PEER_ADDR), CLIENT);
    await drain();
    assert.equal(f.server.counters.channelBinds, 1);
    assert.ok(verifyMessageIntegrity(f.socket.sents.at(-1)!.data, longTermKey(f.username, REALM, f.password)));
    assert.equal(decode(stripMessageIntegrity(f.socket.sents.at(-1)!.data))?.type, 0x0109);

    // cliente → par via ChannelData na socket compartilhada
    assert.equal(f.server.handleDatagram(frameChannelData(0x4000, Buffer.from('ida')), CLIENT), 'channel-data');
    await drain();
    assert.deepEqual(f.relays[0]!.sents[0]?.data, Buffer.from('ida'));

    // par → cliente volta enquadradо como ChannelData do canal
    f.relays[0]!.receive(Buffer.from('volta'), PEER_ADDR);
    await drain();
    const frame = parseChannelData(f.socket.sents.at(-1)!.data);
    assert.ok(frame !== null);
    assert.equal(frame.channel, 0x4000);
    assert.deepEqual(frame.data, Buffer.from('volta'));

    // canal já ligado a outro par é recusado
    const outroPar: MediaAddr = { host: PEER_ADDR.host, port: 60_066 };
    f.roster.add(`${outroPar.host}:${outroPar.port}`);
    f.server.handleDatagram(bindFrame(outroPar), CLIENT);
    await drain();
    assert.equal(decode(f.socket.sents.at(-1)!.data)?.errorCode, 400);
  });
});

// ─── Controles §17.3: taxa, teto de bytes, TTL ──────────────────────────────────────────

describe('controles §17.3 do TURN do host', () => {
  it('taxa acima de TURN_RATE_KBPS é descartada com balde de tokens', async () => {
    const f = fixture({ rateKbps: 8 }); // 1 KB/s, rajada de 1000 B
    await allocate(f);
    grantPermission(f);
    await drain();

    for (let i = 0; i < 5; i++) {
      indication(f, TURN_SEND, PEER_ADDR, Buffer.alloc(900, 1));
    }
    await drain();
    assert.equal(f.server.counters.rateDropped, 4);
    assert.equal(f.server.counters.relayedBytes, 900);

    f.clock.advance(2000); // dois segundos de tokens novos
    indication(f, TURN_SEND, PEER_ADDR, Buffer.alloc(900, 1));
    await drain();
    assert.equal(f.server.counters.relayedBytes, 1800);
  });

  it('teto TURN_SESSION_MAX_BYTES encerra a alocação', async () => {
    const f = fixture({ rateKbps: 4096, sessionMaxBytes: 1500 });
    await allocate(f);
    grantPermission(f);
    await drain();

    indication(f, TURN_SEND, PEER_ADDR, Buffer.alloc(1000, 2));
    await drain();
    assert.equal(f.server.allocationCount, 1);

    indication(f, TURN_SEND, PEER_ADDR, Buffer.alloc(1000, 2));
    await drain();
    assert.equal(f.server.counters.quotaExceeded, 1);
    assert.equal(f.server.allocationCount, 0);
    assert.ok(f.relays[0]!.closed);
  });

  it('TTL vencido fecha a alocação no sweep', async () => {
    const f = fixture({ allocTtlMs: 60_000 });
    await allocate(f);
    f.clock.advance(61_000);
    assert.equal(f.server.sweep(), 1);
    assert.ok(f.relays[0]!.closed);
    assert.equal(f.server.allocationCount, 0);
  });
});

// ─── Credencial e codec auxiliares ──────────────────────────────────────────────────────

describe('turnCredential de curta duração (§17.3)', () => {
  it('username é <sessionId>:<expiresAt> e a password amarra sessão, par e validade', () => {
    const secret = Buffer.alloc(32, 3);
    const peer = keypairFromSeed('par').publicKey;
    const cred = issueTurnCredential(secret, 'sess-7', peer, 555_000);
    assert.equal(cred.username, 'sess-7:555000');
    assert.equal(cred.password, turnCredentialPassword(secret, 'sess-7', peer, 555_000));
    assert.notEqual(cred.password, turnCredentialPassword(secret, 'sess-7', keypairFromSeed('outro').publicKey, 555_000));
    assert.notEqual(cred.password, turnCredentialPassword(secret, 'sess-7', peer, 556_000));
    assert.notEqual(cred.password, turnCredentialPassword(Buffer.alloc(32, 4), 'sess-7', peer, 555_000));
  });

  it('MESSAGE-INTEGRITY cobre o corpo: byte adulterado é recusado com 401', async () => {
    const f = fixture();
    await allocate(f);
    const tampered = authedRequest(f, TURN_REFRESH, []);
    tampered[20] = (tampered[20] ?? 0) ^ 0xff;
    const antes = f.socket.sents.length;
    f.server.handleDatagram(tampered, CLIENT);
    await drain();
    const resp = decode(f.socket.sents[antes]!.data);
    assert.equal(resp?.errorCode, 401);
    // a alocação original permanece intacta
    assert.equal(f.server.allocationCount, 1);
  });
});

describe('constantes de §27.1/§27.2 aplicáveis à mídia', () => {
  it('config operacional carrega defaults de §27.2', () => {
    const cfg = resolveConfig();
    assert.equal(cfg.turnRateKbps, 512);
    assert.equal(cfg.turnAllocTtlMs, 600_000);
    assert.equal(cfg.turnAllocPerMember, 2);
    assert.equal(cfg.turnSessionMaxBytes, 2 * 1024 * 1024 * 1024);
    assert.equal(cfg.relayMaxBytesPerDay, 5 * 1024 * 1024 * 1024);
    assert.equal(cfg.relayMaxAllocs, 4);
  });
});
