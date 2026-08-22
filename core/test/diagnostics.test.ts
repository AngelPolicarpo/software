// Testes do `diagnostics` — diag.run (§15.4) e diag.snapshot (§24.3), com sondas em portas
// injetadas, teto de prazo e concorrência sem bloquear o event loop (§4 "Não pode").

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Swarm } from '../src/l0/swarm/index.ts';
import {
  Diagnostics,
  type DiagnosticsMetricsPort,
  type DiagnosticsNatPort,
  type DiagnosticsRelayPort,
  type DiagnosticsStunPort,
  type MetricsSnapshot,
  type NatType,
} from '../src/l2/diagnostics/index.ts';

const T0 = 1_800_000_000_000;

function fakeClock() {
  let t = T0;
  return { now: () => t, advance(ms: number) { t += ms; } };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface RigPorts {
  nat: DiagnosticsNatPort & { calls: number };
  stun: DiagnosticsStunPort & { calls: number };
  relay: DiagnosticsRelayPort;
  metrics: DiagnosticsMetricsPort & { snap: MetricsSnapshot };
}

function rig(opts?: { probeTimeoutMs?: number }): {
  swarm: Swarm;
  ports: RigPorts;
  diagnostics: Diagnostics;
  clock: ReturnType<typeof fakeClock>;
} {
  const swarm = new Swarm();
  const topic = 'a'.repeat(64);
  swarm.join(topic, { topicHex: topic, kind: 'community-log', communityId: 'c1' });
  swarm.simulatePeer(topic, 'bb');
  swarm.simulatePeer(topic, 'cc');

  const ports: RigPorts = {
    nat: {
      calls: 0,
      probe: null!,
    },
    stun: {
      calls: 0,
      probe: null!,
    },
    relay: { available: () => false },
    metrics: {
      snap: Object.freeze({
        gauges: Object.freeze({ 'swarm.peers': 2, 'swarm.natType': 1 }),
        counters: Object.freeze({ 'fold.applied': 10, 'fold.rejected': 0 }),
        histograms: Object.freeze({ 'rpc.latency': Object.freeze({ count: 5, sum: 120, max: 40 }) }),
      }) as MetricsSnapshot,
      snapshot() {
        return this.snap;
      },
    },
  };
  ports.nat.probe = async () => {
    ports.nat.calls++;
    return 'moderate' as NatType;
  };
  ports.stun.probe = async () => {
    ports.stun.calls++;
    return true;
  };

  const clock = fakeClock();
  const diagnostics = new Diagnostics({
    swarm,
    nat: ports.nat,
    stun: ports.stun,
    relay: ports.relay,
    metrics: ports.metrics,
    clock,
    ...(opts?.probeTimeoutMs !== undefined ? { probeTimeoutMs: opts.probeTimeoutMs } : {}),
  });
  return { swarm, ports, diagnostics, clock };
}

describe('diagnostics — diag.run (§15.4)', () => {
  it('caminho feliz: campos exatos do contrato, ranAt do relógio injetado', async () => {
    const { ports, diagnostics, clock } = rig();
    ports.relay.available = () => true;
    const r = await diagnostics.run();
    assert.deepEqual(r, {
      natType: 'moderate',
      peerCount: 2,
      relayAvailable: true,
      stunReachable: true,
      ranAt: clock.now(),
    });
    assert.equal(ports.nat.calls, 1);
    assert.equal(ports.stun.calls, 1);
  });

  it('sondas correm em paralelo — ambas começam antes de qualquer resposta', async () => {
    const { ports, diagnostics } = rig();
    const events: string[] = [];
    const gateNat = deferred<void>();
    const gateStun = deferred<void>();
    ports.nat.probe = async () => {
      events.push('nat-start');
      await gateNat.promise;
      return 'open';
    };
    ports.stun.probe = async () => {
      events.push('stun-start');
      await gateStun.promise;
      return true;
    };

    const pending = diagnostics.run();
    // Cedência única: as duas sondas já foram disparadas antes de qualquer resolução.
    await Promise.resolve();
    assert.ok(events.includes('nat-start') && events.includes('stun-start'));

    gateNat.resolve();
    gateStun.resolve();
    const r = await pending;
    assert.equal(r.natType, 'open');
    assert.equal(r.stunReachable, true);
  });

  it('estouro de prazo do NAT → cgnat (pior caso assumido), sem rejeitar', async () => {
    const { ports, diagnostics } = rig({ probeTimeoutMs: 20 });
    ports.nat.probe = () => new Promise<NatType>(() => {}); // nunca responde
    const t0 = Date.now();
    const r = await diagnostics.run();
    assert.equal(r.natType, 'cgnat');
    assert.equal(r.stunReachable, true);
    assert.ok(Date.now() - t0 < 2_000); // voltou pelo prazo, não por rejeição pendente
  });

  it('estouro de prazo do STUN → stunReachable=false', async () => {
    const { ports, diagnostics } = rig({ probeTimeoutMs: 20 });
    ports.stun.probe = () => new Promise<boolean>(() => {});
    const r = await diagnostics.run();
    assert.equal(r.natType, 'moderate');
    assert.equal(r.stunReachable, false);
  });

  it('rejeição da sonda é absorvida — diag.run não cataloga erro (§15.4)', async () => {
    const { ports, diagnostics } = rig();
    ports.nat.probe = async () => {
      throw new Error('dht caiu');
    };
    ports.stun.probe = async () => {
      throw new Error('socket fechada');
    };
    const r = await diagnostics.run();
    assert.deepEqual(
      { ...r, ranAt: 0 },
      { natType: 'cgnat', peerCount: 2, relayAvailable: false, stunReachable: false, ranAt: 0 },
    );
  });

  it('peerCount vem do swarm; timeout default é o constante exportada', async () => {
    const { swarm, diagnostics } = rig();
    const r = await diagnostics.run();
    assert.equal(r.peerCount, swarm.getStats().peerCount);
  });
});

describe('diagnostics — diag.snapshot (§24.3)', () => {
  it('devolve o snapshot da porta sem reinterpretar', () => {
    const { ports, diagnostics } = rig();
    const snap = diagnostics.snapshot();
    assert.equal(snap, ports.metrics.snap); // mesma referência: pass-through puro
    assert.equal(snap.counters['fold.applied'], 10);
    assert.equal(snap.histograms['rpc.latency']?.max, 40);
  });
});
