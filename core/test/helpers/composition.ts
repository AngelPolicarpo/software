// Cabo de composição da fase de integração — quem "monta o grafo" de §4 ("quem monta o
// grafo injeta a implementação no boot") nesta fase é o teste; em produto, o boot do
// utilityProcess. NÃO é código de produto: mora em `test/` porque só existe para exercitar
// as juntas entre os módulos reais — RPC (§16), IPC-R (§15.4), portas de L2 e sondas.
//
// Padrão das fases anteriores: decisões dos módulos reais, transporte simulado.

import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { encodeHostRecord, hostRecordSigningHash } from '../../src/l1/opCodec/index.ts';
import type { DecisionState } from '../../src/l1/fold/index.ts';
import { HostAdmission } from '../../src/l2/communityHost/index.ts';
import {
  MediaServer,
  BINDING_SUCCESS,
  decode,
  encodeBindingRequest,
  randomTxId,
  type MediaAddr,
  type MediaSocketPort,
} from '../../src/l2/communityHost/stunTurn.ts';
import type { DiagnosticsMetricsPort, MetricsSnapshot, NatType } from '../../src/l2/diagnostics/index.ts';
import type { RelayConsentPort } from '../../src/l2/relay/index.ts';
import type { SubmitPort, SubmitResult } from '../../src/l2/outbox/index.ts';
import type { Swarm } from '../../src/l0/swarm/index.ts';
import type { VoiceStatePort } from '../../src/l2/voiceCoordinator/index.ts';
import { RpcClient } from '../../src/l3/rpcClient/index.ts';
import { RpcServer, type RpcTransportPort } from '../../src/l3/rpcServer/index.ts';

// ─── Transporte RPC em memória (§16.1 — protomux-rpc chega na integração L3 real) ──────

export class MemoryRpcChannel implements RpcTransportPort {
  #other: MemoryRpcChannel | null = null;
  #frameListeners = new Set<(frame: Uint8Array) => void>();
  #downListeners = new Set<() => void>();

  static createPair(): [MemoryRpcChannel, MemoryRpcChannel] {
    const a = new MemoryRpcChannel();
    const b = new MemoryRpcChannel();
    a.#other = b;
    b.#other = a;
    return [a, b];
  }

  send(frame: Uint8Array): void {
    const copy = Buffer.from(frame);
    const peer = this.#other as MemoryRpcChannel | null;
    queueMicrotask(() => {
      if (peer === null) return;
      for (const listener of peer.frameListeners()) listener(copy);
    });
  }

  /** Exposto só para o par — encapsulamento de `#frameListeners` entre instâncias. */
  private frameListeners(): Set<(frame: Uint8Array) => void> {
    return this.#frameListeners;
  }

  onFrame(cb: (frame: Uint8Array) => void): void {
    this.#frameListeners.add(cb);
  }

  onDown(cb: () => void): void {
    this.#downListeners.add(cb);
  }

  /** Queda da conexão — só o lado que cai avisa; o par fica mudo até reattach. */
  drop(): void {
    for (const cb of this.#downListeners) cb();
  }
}

/** Par de canais com queda unilateral para testes de reconexão. */
export function rpcPair(): [MemoryRpcChannel, MemoryRpcChannel] {
  return MemoryRpcChannel.createPair();
}

// ─── Host sobre RPC (§16.2: hello, submitOp, submitOps) ─────────────────────────────────

export type HelloInfo = {
  readonly hostVersion: string;
  readonly opVersion: number;
  readonly coreLength: number;
  readonly memberCount: number;
  readonly capabilities: readonly string[];
};

/**
 * Registra os métodos de §16.2 suportados pelo `communityHost` atual sobre um `RpcServer`.
 * `submitOps` segue §11.9: um resultado por envelope, na ordem, sem parar no primeiro erro.
 */
export function wireHostRpc(
  server: RpcServer,
  opts: { admission: Pick<HostAdmission, 'submit'>; hello: HelloInfo },
): void {
  server.register('hello', () =>
    Buffer.from(
      JSON.stringify({
        hostVersion: opts.hello.hostVersion,
        opVersion: opts.hello.opVersion,
        coreLength: opts.hello.coreLength,
        memberCount: opts.hello.memberCount,
        capabilities: opts.hello.capabilities,
      }),
      'utf8',
    ),
  );

  server.register('submitOp', async (body) => {
    const arg = JSON.parse(Buffer.from(body).toString('utf8')) as { envelope: string };
    const result = await opts.admission.submit(new Uint8Array(Buffer.from(arg.envelope, 'base64')));
    if (!result.ok) return { code: result.code };
    return Buffer.from(JSON.stringify({ seq: result.seq, hostTs: result.hostTs }), 'utf8');
  });

  server.register('submitOps', async (body) => {
    const arg = JSON.parse(Buffer.from(body).toString('utf8')) as { envelopes: string[] };
    const out: Array<Record<string, unknown>> = [];
    let infraFailure = false;
    for (const [index, envB64] of arg.envelopes.entries()) {
      if (infraFailure) {
        out.push({ index, ok: false, code: 'E_NOT_ATTEMPTED' });
        continue;
      }
      const result = await opts.admission.submit(new Uint8Array(Buffer.from(envB64, 'base64')));
      if (result.ok) {
        out.push({ index, ok: true, seq: result.seq, hostTs: result.hostTs });
      } else {
        out.push({ index, ok: false, code: result.code });
        // §11.9: só infraestrutura interrompe o lote
        if (result.code === 'E_STORAGE_FULL' || result.code === 'E_BUSY') infraFailure = true;
      }
    }
    return Buffer.from(JSON.stringify(out), 'utf8');
  });
}

/** Adaptador da porta de submissão da outbox sobre o `rpcClient` (§4, §11.6). */
export function rpcSubmitPort(client: RpcClient): SubmitPort {
  return async (envelopes) => {
    const body = Buffer.from(
      JSON.stringify({ envelopes: envelopes.map((e) => Buffer.from(e).toString('base64')) }),
      'utf8',
    );
    const result = await client.call('submitOps', new Uint8Array(body));
    if (!result.ok) return null; // indisponível → backoff/circuit breaker da outbox (§11.8)
    const parsed = JSON.parse(Buffer.from(result.body).toString('utf8')) as Array<
      | { index: number; ok: true; seq: number; hostTs: number }
      | { index: number; ok: false; code: string }
      | { index: number; ok: false; code: 'E_NOT_ATTEMPTED' }
    >;
    return parsed.map((item) =>
      item.ok
        ? ({ ok: true, seq: item.seq, hostTs: item.hostTs } satisfies SubmitResult)
        : ({ ok: false, code: item.code } satisfies SubmitResult),
    );
  };
}

// ─── Portas do diagnostics (§24.3, §15.4 diag.*) ────────────────────────────────────────

export function swarmNatProbe(natType: NatType): { probe(): Promise<NatType> } {
  return { probe: async () => natType };
}

/**
 * Probe STUN real sobre UDP de loopback: Binding Request RFC 5389 codificado pelo codec do
 * núcleo (`stunTurn`), respondido por um `MediaServer` ligado à mesma socket. É a junta de
 * §17.3 exercitada de verdade, sem HyperDHT.
 */
export class UdpStunProbe {
  readonly #socket: dgram.Socket;
  readonly #addr: MediaAddr;

  private constructor(socket: dgram.Socket, addr: MediaAddr) {
    this.#socket = socket;
    this.#addr = addr;
  }

  /** Sobe socket + MediaServer respondedor e devolve a porta de probe do cliente. */
  static async createPair(): Promise<{ probe: UdpStunProbe; responderClose(): Promise<void> }> {
    const responder = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => responder.bind(0, '127.0.0.1', resolve));
    const responderAddr = responder.address() as { address: string; port: number };

    const mediaSocket: MediaSocketPort = {
      send(datagram, addr) {
        responder.send(Buffer.from(datagram), addr.port, addr.host);
      },
    };
    const media = new MediaServer({
      realm: 'integracao',
      hostTurnSecret: Buffer.alloc(32, 7),
      socket: mediaSocket,
      openRelayPort: async () => {
        throw new Error('sem relay neste teste');
      },
      sessionPeerKeys: () => new Set(),
      rosterAddresses: () => new Set(),
    });
    responder.on('message', (msg, rinfo) => {
      media.handleDatagram(new Uint8Array(msg), { host: rinfo.address, port: rinfo.port });
    });

    const client = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => client.bind(0, '127.0.0.1', resolve));

    return {
      probe: new UdpStunProbe(client, { host: responderAddr.address, port: responderAddr.port }),
      responderClose: () => {
        responder.close();
        return new Promise((resolve) => client.close(resolve));
      },
    };
  }

  /** Binding com prazo próprio — resolve true quando XOR-MAPPED-ADDRESS volta. */
  probe(timeoutMs = 2_000): Promise<boolean> {
    return new Promise((resolve) => {
      const txId = randomTxId();
      const req = encodeBindingRequest(txId);
      const onMsg = (msg: Buffer): void => {
        const dec = decode(new Uint8Array(msg));
        if (dec === null || dec.type !== BINDING_SUCCESS || !dec.txId.equals(txId)) return;
        clearTimeout(timer);
        this.#socket.off('message', onMsg);
        resolve(dec.xorMapped !== undefined);
      };
      const timer = setTimeout(() => {
        this.#socket.off('message', onMsg);
        resolve(false);
      }, timeoutMs);
      this.#socket.on('message', onMsg);
      this.#socket.send(req, this.#addr.port, this.#addr.host);
    });
  }
}

/** Snapshot agregado das métricas de §24.3 espalhadas pelos detentores de estado. */
export function aggregateMetricsPort(opts: {
  swarm: Swarm;
  natType: NatType;
  counters?: () => Record<string, number>;
}): DiagnosticsMetricsPort & { setNat(n: NatType): void } {
  let nat = opts.natType;
  return {
    setNat(n: NatType) {
      nat = n;
    },
    snapshot(): MetricsSnapshot {
      const stats = opts.swarm.getStats();
      return {
        gauges: {
          'swarm.peers': stats.peerCount,
          'swarm.natType': nat === 'open' ? 0 : nat === 'moderate' ? 1 : 2,
        },
        counters: opts.counters?.() ?? {},
        histograms: {},
      };
    },
  };
}

// ─── Porta de consentimento do relay sobre manifest.db (§6.15) ─────────────────────────

export function manifestRelayConsentPort(manifest: import('../../src/l0/manifest/index.ts').ManifestDb): RelayConsentPort {
  return {
    get(communityId) {
      return manifest.getRelayConsent(communityId);
    },
    set(communityId, decision, opts) {
      manifest.setRelayConsent(communityId, decision, Date.now());
      if (!opts.remember) manifest.forgetRelayConsent(communityId);
    },
    forget(communityId) {
      manifest.forgetRelayConsent(communityId);
    },
  };
}

// ─── Recorte do DecisionState para voz/tela (porta de §17.4) ────────────────────────────

/**
 * Adaptador estrutural `DecisionState → VoiceStatePort`. O DS de §8.1 satisfaz a porta por
 * forma — `permissions` já é `Set<number>` de §9.1 e os campos de membro/canal batem; este
 * adaptador só recorta o que a mídia lê.
 */
export function voiceStateOf(state: DecisionState): VoiceStatePort {
  return {
    community: state.community,
    channels: state.channels,
    members: new Map(
      [...state.members.entries()].map(([keyHex, member]) => [
        keyHex,
        {
          state: member.state,
          ...(member.timeoutUntil !== undefined ? { timeoutUntil: member.timeoutUntil } : {}),
          roleIds: member.roleIds,
        },
      ]),
    ),
    roles: new Map(
      [...state.roles.entries()].map(([id, role]) => [
        id,
        {
          permissions: role.permissions,
          ...(role.deletedAt !== undefined ? { deletedAt: role.deletedAt } : {}),
        },
      ]),
    ),
  };
}

/** Diretório temporário rotulado (mesma convenção dos outros cabos). */
export function tempDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `core-integracao-${label}-`));
}
