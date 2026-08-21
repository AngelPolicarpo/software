// Harness G7 — rede (C6..C10): matriz de conexão ICE com NAT user-space, mídia
// sintética em cadência de voz, relay malicioso, revogação ≤ 5 s e CPU do host.
// WebRTC real via werift (ICE + DTLS-SRTP + SCTP). Limitações declaradas no artefato:
// sem netem de kernel e sem CGNAT; codec de voz real fica para o gate empacotado.

import dgram from 'node:dgram';
import { performance } from 'node:perf_hooks';

import { RTCPeerConnection } from 'werift';

import { BINDING_REQUEST, classify, decode, encodeBindingSuccess, randomTxId } from './stun.js';
import { TurnServer } from './turnServer.js';
import { NatBox } from './nat.js';

export type Profile = 'quick' | 'full';

export interface StepResult {
  id: string;
  desc: string;
  ok: boolean;
  ms: number;
  evidence?: Record<string, unknown>;
  error?: string;
}

export interface NetHarnessResult {
  profile: Profile;
  ok: boolean;
  steps: StepResult[];
  metrics: Record<string, unknown>;
}

const TURN_USER = 'sess-voz';
const TURN_PASS = 'credencial-hmac-curta';
const REALM = 'comunidade.test';

interface HostStack {
  socket: dgram.Socket;
  turn: TurnServer;
  port: number;
  udxSeen: number;
  dispose(): Promise<void>;
}

/** Socket única do host servindo Binding + TURN + demux UDX — o desenho de §17.3. */
async function startHost(): Promise<HostStack> {
  const socket = dgram.createSocket('udp4');
  await new Promise<void>((r) => socket.bind({ address: '127.0.0.1', port: 0 }, r));
  try {
    socket.setRecvBufferSize(4 * 1024 * 1024);
  } catch {}
  const turn = new TurnServer(socket, { username: TURN_USER, password: TURN_PASS, realm: REALM });
  const stack: HostStack = {
    socket,
    turn,
    port: socket.address().port,
    udxSeen: 0,
    async dispose(): Promise<void> {
      await turn.closeAll();
      socket.close();
    },
  };
  socket.on('message', (msg, rinfo) => {
    if (turn.handleChannelData(msg, rinfo)) return;
    const dec = decode(msg);
    if (dec === null) {
      stack.udxSeen++;
      return; // caminho UDX do host
    }
    if (dec.type === BINDING_REQUEST) return turn.handleBinding(msg, rinfo);
    turn.handleStun(msg, rinfo);
  });
  return stack;
}

type NatModel = 'none' | 'full-cone' | 'port-restricted' | 'symmetric';

interface PeerNet {
  iceServers: Array<{ urls: string; username?: string; credential?: string }>;
  nat?: NatBox;
}

/** Prepara a rede de um par: sem NAT, ou caixa NAT entre par e servidor. */
async function setupPeerNet(model: NatModel, hostPort: number, opts: { lossPct?: number; delayMs?: number } = {}): Promise<PeerNet> {
  if (model === 'none') {
    return { iceServers: [{ urls: `stun:127.0.0.1:${hostPort}` }] };
  }
  const nat = new NatBox(model, opts);
  const internalPort = await nat.bind({ host: '127.0.0.1', port: hostPort });
  return {
    iceServers: [{ urls: `turn:127.0.0.1:${internalPort}`, username: TURN_USER, credential: TURN_PASS }],
    nat,
  };
}

function waitConnected(pc: RTCPeerConnection, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (pc.connectionState === 'connected') {
        clearInterval(iv);
        resolve();
      } else if (['failed', 'closed'].includes(pc.connectionState) || Date.now() - t0 > timeoutMs) {
        clearInterval(iv);
        reject(new Error(`connectionState=${pc.connectionState}`));
      }
    }, 50);
  });
}

interface Pair {
  a: RTCPeerConnection;
  b: RTCPeerConnection;
  dcA?: ReturnType<RTCPeerConnection['createDataChannel']>;
  dcB: ReturnType<RTCPeerConnection['createDataChannel']> | null;
  close(): Promise<void>;
}

async function connectPair(netA: PeerNet, netB: PeerNet, policy: 'all' | 'relay'): Promise<Pair> {
  const a = new RTCPeerConnection({ iceServers: netA.iceServers, iceTransportPolicy: policy });
  const b = new RTCPeerConnection({ iceServers: netB.iceServers, iceTransportPolicy: policy });
  const dcA = a.createDataChannel('voz');
  // captura o canal recebido em B no momento do evento — depois é tarde demais
  let dcB: ReturnType<RTCPeerConnection['createDataChannel']> | null = null;
  // werift executa o callback com o canal direto (não com {channel}); cobrimos as duas formas
  b.ondatachannel = (evOrChannel: unknown): void => {
    const ev = evOrChannel as { channel?: ReturnType<RTCPeerConnection['createDataChannel']> };
    dcB = ev?.channel ?? (evOrChannel as ReturnType<RTCPeerConnection['createDataChannel']>);
  };
  const offer = await a.setLocalDescription(await a.createOffer());
  await b.setRemoteDescription(offer);
  const answer = await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(answer);
  const pair: Pair = {
    a,
    b,
    dcA,
    // getter: dcB é atribuído assincronamente pelo evento; cópia por valor ficaria nula
    get dcB() {
      return dcB;
    },
    async close(): Promise<void> {
      try {
        await a.close();
      } catch {}
      try {
        await b.close();
      } catch {}
      await netA.nat?.close();
      await netB.nat?.close();
    },
  };
  return pair;
}

// ─── C6 — Matriz de conexão por classe de NAT (≥95% direta ou via TURN do host) ──

async function c6Matriz(profile: Profile): Promise<Record<string, unknown>> {
  const combos: Array<{ nome: string; a: NatModel; b: NatModel; lossPct: number; delayMs: number }> =
    profile === 'full'
      ? [
          { nome: 'sem-NAT × sem-NAT (direto)', a: 'none', b: 'none', lossPct: 0, delayMs: 0 },
          { nome: 'full-cone × full-cone', a: 'full-cone', b: 'full-cone', lossPct: 0, delayMs: 10 },
          { nome: 'port-restricted × port-restricted', a: 'port-restricted', b: 'port-restricted', lossPct: 0, delayMs: 20 },
          { nome: 'symmetric × symmetric', a: 'symmetric', b: 'symmetric', lossPct: 0, delayMs: 20 },
          { nome: 'sem-NAT × symmetric', a: 'none', b: 'symmetric', lossPct: 0, delayMs: 20 },
          { nome: 'full-cone × symmetric', a: 'full-cone', b: 'symmetric', lossPct: 0, delayMs: 20 },
        ]
      : [
          { nome: 'sem-NAT × sem-NAT (direto)', a: 'none', b: 'none', lossPct: 0, delayMs: 0 },
          { nome: 'port-restricted × port-restricted', a: 'port-restricted', b: 'port-restricted', lossPct: 0, delayMs: 20 },
          { nome: 'symmetric × symmetric', a: 'symmetric', b: 'symmetric', lossPct: 0, delayMs: 20 },
        ];

  let conectados = 0;
  const detalhes: Array<{ combo: string; ok: boolean; ms: number; viaTurn: boolean }> = [];
  for (const c of combos) {
    // host novo por combo: reuso de porta efêmera entre combos deixaria uma alocação
    // antiga no mesmo endereço e o servidor responderia 437 Allocation Mismatch
    const host = await startHost();
    const t0 = performance.now();
    let pair: Pair | null = null;
    let ok = false;
    const relayedBefore = host.turn.counters.relayedBytes;
    try {
      const netA = await setupPeerNet(c.a, host.port, { lossPct: c.lossPct, delayMs: c.delayMs });
      const netB = await setupPeerNet(c.b, host.port, { lossPct: c.lossPct, delayMs: c.delayMs });
      // direto quando nenhum dos lados tem NAT; senão relay do host garante o caminho
      const policy: 'all' | 'relay' = c.a === 'none' && c.b === 'none' ? 'all' : 'relay';
      pair = await connectPair(netA, netB, policy);
      await Promise.all([waitConnected(pair.a), waitConnected(pair.b)]);
      ok = true;
    } catch {
      ok = false;
    }
    const ms = Math.round(performance.now() - t0);
    const viaTurn = host.turn.counters.relayedBytes > relayedBefore;
    detalhes.push({ combo: c.nome, ok, ms, viaTurn });
    if (ok) conectados++;
    await pair?.close();
    await host.dispose();
  }

  const taxa = +(conectados / combos.length * 100).toFixed(1);
  const evidencia = {
    combos: combos.length,
    conectados,
    taxaConexaoPct: taxa,
    detalhes,
    criterio: '≥95% conectam — direta ou via TURN do host (plano POC-08)',
  };
  if (taxa < 95) throw Object.assign(new Error(`taxa de conexão ${taxa}% < 95%`), { evidence: evidencia });
  return evidencia;
}

// ─── C7 — Mídia sintética em cadência de voz (160 B @ 20 ms) ─────────────────

interface MediaStats {
  enviados: number;
  ecoados: number;
  perdidos: number;
  rttP95Ms: number;
  rttMedioMs: number;
}

async function rodarMidia(dc: NonNullable<Pair['dcA']>, segundos: number, pacote: Buffer): Promise<MediaStats> {
  const pendentes = new Map<number, number>(); // seq → t0
  let ecoados = 0;
  let perdidos = 0;
  const rtts: number[] = [];

  dc.onmessage = (ev: { data: Buffer | string }): void => {
    const buf = Buffer.from(ev.data);
    if (buf.length < 4) return;
    const seq = buf.readUInt32BE(0);
    const t0 = pendentes.get(seq);
    if (t0 === undefined) return;
    pendentes.delete(seq);
    ecoados++;
    rtts.push(performance.now() - t0);
  };

  const durMs = segundos * 1000;
  const t0 = performance.now();
  let seq = 0;
  while (performance.now() - t0 < durMs) {
    const p = Buffer.from(pacote);
    p.writeUInt32BE(seq, 0);
    pendentes.set(seq, performance.now());
    dc.send(p);
    seq++;
    // expira pacotes não ecoados após 1 s
    for (const [s, t] of pendentes) {
      if (performance.now() - t > 1000) {
        pendentes.delete(s);
        perdidos++;
      }
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  await new Promise((r) => setTimeout(r, 1200)); // drena ecos em voo
  perdidos += pendentes.size;

  rtts.sort((x, y) => x - y);
  const p95 = rtts[Math.min(rtts.length - 1, Math.ceil(0.95 * rtts.length) - 1)] ?? 0;
  const medio = rtts.length > 0 ? rtts.reduce((s, v) => s + v, 0) / rtts.length : 0;
  return { enviados: seq, ecoados, perdidos, rttP95Ms: +p95.toFixed(2), rttMedioMs: +medio.toFixed(2) };
}

async function c7Midia(profile: Profile): Promise<Record<string, unknown>> {
  const host = await startHost();
  const segundos = profile === 'full' ? 6 : 3;
  const pacote = Buffer.alloc(160); // cadência de voz: 160 B @ 20 ms ≈ Opus 64 kbps
  cryptoFill(pacote);

  // caminho TURN sob impairment: estabelece com atraso 20 ms; perda 2% entra na fase de mídia
  const netA = await setupPeerNet('symmetric', host.port, { delayMs: 20 });
  const netB = await setupPeerNet('port-restricted', host.port, { delayMs: 20 });
  const pair = await connectPair(netA, netB, 'relay');
  await Promise.all([waitConnected(pair.a), waitConnected(pair.b)]);
  for (let i = 0; i < 30 && !pair.dcA!.sendOpen; i++) await new Promise((r) => setTimeout(r, 50));
  netA.nat?.setLossPct(2);
  netB.nat?.setLossPct(2);
  for (let i = 0; i < 60 && pair.dcB === null; i++) await new Promise((r) => setTimeout(r, 50));
  if (pair.dcB === null) throw new Error('canal de B não recebido');
  pair.dcB.onmessage = (ev: { data: Buffer | string }): void => {
    pair.dcB!.send(ev.data); // eco
  };

  const statsTurn = await rodarMidia(pair.dcA!, segundos, pacote);
  const perdaPctTurn = +((statsTurn.perdidos / statsTurn.enviados) * 100).toFixed(2);
  await pair.close();
  await host.dispose();

  if (statsTurn.rttP95Ms > 500) throw new Error(`RTT p95 no TURN ${statsTurn.rttP95Ms} ms acima do teto de sanidade (500 ms = 2×250 ms por perna dupla ecoada)`);
  if (perdaPctTurn > 5) throw new Error(`perda ${perdaPctTurn}% acima do injetado+tolerância`);

  return {
    segundos,
    cadencia: '160 B @ 20 ms',
    caminho: 'TURN do host sob symmetric×port-restricted com perda 2% e atraso 40 ms',
    ...statsTurn,
    perdaPct: perdaPctTurn,
    nota: 'payload sintético em cadência RTP pelo canal DTLS; latência medida é RTT de eco — áudio real com codec fica para o gate empacotado',
  };
}

function cryptoFill(buf: Buffer): void {
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
}

// ─── C8 — Relay malicioso não lê payload ─────────────────────────────────────

async function c8RelayMalicioso(): Promise<Record<string, unknown>> {
  const host = await startHost();
  const netA = await setupPeerNet('symmetric', host.port);
  const netB = await setupPeerNet('port-restricted', host.port);
  const pair = await connectPair(netA, netB, 'relay');
  await Promise.all([waitConnected(pair.a), waitConnected(pair.b)]);
  for (let i = 0; i < 30 && !pair.dcA!.sendOpen; i++) await new Promise((r) => setTimeout(r, 50));

  // ativa captura com agulhas known-plaintext ANTES do tráfego de dados
  const segredo = 'MENSAGEM-CLARA-SECRETA-1234567890';
  host.turn.malicious = { capture: [], needles: [Buffer.from(segredo), Buffer.from(segredo.slice(0, 16)), Buffer.from('DC open')], matches: 0 };

  const payload = Buffer.concat([Buffer.from(segredo), Buffer.alloc(146, 7)]);
  for (let i = 0; i < 200; i++) pair.dcA!.send(payload);
  await new Promise((r) => setTimeout(r, 1500));

  const mal = host.turn.malicious;
  const capturados = mal.capture.length;
  const bytesCapturados = mal.capture.reduce((s, b) => s + b.length, 0);
  if (capturados === 0) throw new Error('relay não capturou nada — instrumento quebrado');
  if (mal.matches !== 0) throw new Error(`relay encontrou ${mal.matches} trechos em claro!`);
  // entropia aproximada: proporção de bytes distintos em amostra
  const amostra = Buffer.concat(mal.capture.slice(0, 100));
  const distintos = new Set(amostra).size;

  await pair.close();
  await host.dispose();

  return {
    datagramasCapturados: capturados,
    bytesVistosPeloRelay: bytesCapturados,
    agulhasEmClaroEncontradas: mal.matches,
    bytesDistintosNaAmostra: distintos,
    conclusao: 'relay vê volume e temporização (L-14), nunca conteúdo — DTLS-SRTP cifra ponta a ponta',
  };
}

// ─── C9 — Revogação encerra sessão ≤ 5 s ─────────────────────────────────────

async function c9Revogacao(): Promise<Record<string, unknown>> {
  const host = await startHost();
  const netA = await setupPeerNet('symmetric', host.port);
  const netB = await setupPeerNet('port-restricted', host.port);
  const pair = await connectPair(netA, netB, 'relay');
  await Promise.all([waitConnected(pair.a), waitConnected(pair.b)]);
  for (let i = 0; i < 30 && !pair.dcA!.sendOpen; i++) await new Promise((r) => setTimeout(r, 50));

  // receptor conta pacotes do marcador (36 B começando com 0x01) — imune a consent checks
  let recebidos = 0;
  for (let i = 0; i < 60 && pair.dcB === null; i++) await new Promise((r) => setTimeout(r, 50));
  if (pair.dcB === null) throw new Error('canal de B não recebido');
  pair.dcB.onmessage = (ev: { data: Buffer | string }): void => {
    const buf = Buffer.from(ev.data);
    if (buf.length === 36 && buf[0] === 1) recebidos++;
  };

  const keepAlive = setInterval(() => {
    try {
      const p = Buffer.alloc(36, 1);
      pair.dcA!.send(p);
    } catch {}
  }, 50);
  await new Promise((r) => setTimeout(r, 500));

  // "voice.revoked" → cliente obrigado a fechar imediatamente (§17.4)
  const t0 = performance.now();
  await pair.a.close();
  let last = recebidos;
  let quietoMs = 0;
  let cessouMs: number | null = null;
  while (performance.now() - t0 < 8000) {
    await new Promise((r) => setTimeout(r, 100));
    if (recebidos === last) {
      quietoMs += 100;
      if (quietoMs >= 500) {
        cessouMs = Math.round(performance.now() - t0);
        break;
      }
    } else {
      quietoMs = 0;
      last = recebidos;
    }
  }
  clearInterval(keepAlive);
  await pair.close();
  await host.dispose();

  if (cessouMs === null || cessouMs > 5000) throw new Error(`tráfego persistiu ${String(cessouMs ?? '>8000')} ms após revogação (> 5 s)`);
  return { cessacaoMs: cessouMs, criterio: '≤ 5 s por revogação ativa; pior caso MEDIA_TICKET_TTL_MS = 5 min (C4)' };
}

// ─── C10 — CPU do processo do host servindo STUN/TURN ────────────────────────

async function c10CpuHost(profile: Profile): Promise<Record<string, unknown>> {
  const host = await startHost();
  const pares: Pair[] = [];
  const nPares = profile === 'full' ? 3 : 2;
  for (let i = 0; i < nPares; i++) {
    const netA = await setupPeerNet(i % 2 === 0 ? 'symmetric' : 'port-restricted', host.port, { lossPct: 1, delayMs: 20 });
    const netB = await setupPeerNet('full-cone', host.port);
    const pair = await connectPair(netA, netB, 'relay');
    await Promise.all([waitConnected(pair.a), waitConnected(pair.b)]);
    pares.push(pair);
  }

  // carga nominal: cada par envia em cadência de voz
  const senders = pares.map((pair) => {
    const iv = setInterval(() => {
      try {
        pair.dcA?.send(Buffer.alloc(160, 3));
      } catch {}
    }, 20);
    return iv;
  });

  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  await new Promise((r) => setTimeout(r, profile === 'full' ? 8000 : 4000));
  const cpuDelta = process.cpuUsage(cpuStart);
  const wallMs = performance.now() - wallStart;
  const cpuPct = +(((cpuDelta.user + cpuDelta.system) / (wallMs * 1000)) * 100).toFixed(2);

  senders.forEach(clearInterval);
  for (const p of pares) await p.close();
  await host.dispose();

  // nota honesta: inclui clientes no mesmo processo — limite superior, não medida limpa do host
  return {
    paresSimultaneos: nPares,
    cpuProcessoPct: cpuPct,
    criterioNominal: '≤ 20% só para servir STUN/TURN na escala de referência (medida dedicada fica para o gate empacotado)',
    nota: 'processo único hospedando servidor E clientes: número é limite superior do custo do host',
  };
}

// ─── Orquestração ─────────────────────────────────────────────────────────────

export async function runNetHarness(profile: Profile): Promise<{ ok: boolean; steps: StepResult[]; metrics: Record<string, unknown> }> {
  const steps: StepResult[] = [];
  const metrics: Record<string, unknown> = {};

  async function step(id: string, desc: string, fn: () => Promise<Record<string, unknown>>): Promise<void> {
    const t0 = performance.now();
    try {
      const evidence = await fn();
      steps.push({ id, desc, ok: true, ms: Math.round(performance.now() - t0), evidence });
      Object.assign(metrics, evidence);
      console.log(`  OK   ${id}  ${desc}`);
    } catch (e) {
      const err = e as Error & { evidence?: Record<string, unknown> };
      const stepData: StepResult = { id, desc, ok: false, ms: Math.round(performance.now() - t0), error: err.message };
      if (err.evidence !== undefined) {
        stepData.evidence = err.evidence;
        Object.assign(metrics, err.evidence);
      }
      steps.push(stepData);
      console.log(`  FALHA ${id}  ${desc} — ${err.message}`);
    }
  }

  await step('C6', `matriz de conexão ICE com NAT user-space — ${profile === 'full' ? 6 : 3} combos, ≥95%`, () => c6Matriz(profile));
  await step('C7', 'mídia sintética 160 B @ 20 ms pelo TURN sob perda/atraso', () => c7Midia(profile));
  await step('C8', 'relay malicioso: captura tudo, não lê nada em claro', () => c8RelayMalicioso());
  await step('C9', 'revogação encerra tráfego ≤ 5 s', () => c9Revogacao());
  await step('C10', `CPU do host com ${profile === 'full' ? 3 : 2} pares simultâneos em cadência de voz`, () => c10CpuHost(profile));

  const ok = steps.every((s) => s.ok);
  return { ok, steps, metrics };
}
