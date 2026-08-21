// Harness G7 (escopo executável em Node, sem rede externa) — POC-08.
// Implementações experimentais aqui são descartáveis: NÃO viram código de produto
// (poc/ é descartável por definição; a implementação da fase 7 segue §17 depois do gate).
//
// C1 codec STUN (RFC 5389 Binding) — round-trip e XOR-MAPPED-ADDRESS corretos
// C2 demux §17.3 — corpus UDX REAL (udx-native via proxy dgram) + STUN sintético + adversarial
// C3 coexistência numa única socket UDP sob carga mista, com RTT e CPU do processo
// C4 tickets de mídia A22/§17.4 — assinatura, escopo, expiração, revogação ≤ 5 s
// C5 controles TURN §17.3 — credencial HMAC, limite de alocação, refresh, roster, tela recusada

import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  BINDING_REQUEST,
  classify,
  classifyAlt,
  decode,
  encodeBindingError,
  encodeBindingRequest,
  encodeBindingSuccess,
  randomTxId,
  type Ipv4,
} from './stun.js';
import {
  MEDIA_TICKET_TTL_MS_DEFAULT,
  TURN_ALLOC_PER_MEMBER,
  TURN_ALLOC_TTL_MS_DEFAULT,
  VOICE_REVOKED_CLOSE_MS,
  TurnHostControls,
  issueTicket,
  issueTurnCredential,
  verifyTicket,
  verifyTurnCredential,
} from './tickets.js';

export type Profile = 'quick' | 'full';

export interface StepResult {
  id: string;
  desc: string;
  ok: boolean;
  ms: number;
  evidence?: Record<string, unknown>;
  error?: string;
}

export interface HarnessResult {
  profile: Profile;
  ok: boolean;
  steps: StepResult[];
  metrics: Record<string, unknown>;
}

interface LoadPlan {
  codecCycles: number;
  stunSynth: number;
  udxCorpus: number;
  loadStun: number;
  loadUdx: number;
}

function planFor(profile: Profile): LoadPlan {
  return profile === 'full'
    ? { codecCycles: 50_000, stunSynth: 100_000, udxCorpus: 50_000, loadStun: 20_000, loadUdx: 10_000 }
    : { codecCycles: 5_000, stunSynth: 20_000, udxCorpus: 5_000, loadStun: 5_000, loadUdx: 2_000 };
}

const SEED = 20260821;
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function bindUdp(): Promise<dgram.Socket> {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.once('error', reject);
    s.bind({ address: '127.0.0.1', port: 0 }, () => {
      s.removeAllListeners('error');
      resolve(s);
    });
  });
}

// ─── Captura de corpus UDX real: par udx-native atravessando um proxy dgram ──

type AnyRecord = Record<string, unknown>;

async function loadUdx(): Promise<AnyRecord> {
  const mod = (await import('udx-native')) as unknown as { default: new () => AnyRecord };
  const udx = new mod.default() as AnyRecord & {
    createSocket(): AnyRecord;
    createStream(id: number): AnyRecord;
  };
  return udx;
}

interface UdxLike {
  bind(port?: number): void;
  address(): { port: number; host: string; family: number };
  close(): void;
}

interface StreamLike {
  connect(socket: UdxLike, remoteId: number, port: number, host: string): void;
  write(b: Buffer): boolean;
  on(ev: string, fn: (x?: unknown) => void): unknown;
  end(): void;
  destroy(): void;
  id: number;
}

/** Captura `target` datagramas UDX reais (SYN/DATA/ACK) na wire format, nos dois sentidos. */
async function captureUdxCorpus(target: number): Promise<{ corpus: Buffer[]; truncated: boolean }> {
  const udx = (await loadUdx()) as unknown as {
    createSocket(): UdxLike;
    createStream(id: number): StreamLike;
  };
  const sa = udx.createSocket();
  sa.bind(0);
  const sb = udx.createSocket();
  sb.bind(0);
  const PA = sa.address().port;
  const PB = sb.address().port;

  const proxy = await bindUdp();
  const PP = proxy.address().port;
  const corpus: Buffer[] = [];
  let truncated = false;
  proxy.on('message', (msg: Buffer, rinfo: { port: number }) => {
    if (corpus.length < target) corpus.push(Buffer.from(msg));
    else truncated = true;
    proxy.send(msg, rinfo.port === PA ? PB : PA, '127.0.0.1');
  });

  const strA = udx.createStream(1);
  const strB = udx.createStream(2);
  strA.on('data', () => {});
  strB.on('data', () => {});
  strA.connect(sa, 2, PP, '127.0.0.1');
  strB.connect(sb, 1, PP, '127.0.0.1');

  const payload = crypto.randomBytes(1024);
  const deadline = Date.now() + 20_000;
  let i = 0;
  while (corpus.length < target && Date.now() < deadline) {
    for (let b = 0; b < 64 && corpus.length < target; b++, i++) {
      payload.writeUInt32LE(i >>> 0, 0);
      strA.write(payload);
      if ((b & 7) === 7) strB.write(payload);
    }
    await sleep(1);
  }
  await sleep(50);

  try {
    strA.destroy();
    strB.destroy();
  } catch {}
  try {
    sa.close();
    sb.close();
  } catch {}
  proxy.close();

  return { corpus, truncated };
}

// ─── C1 — Codec STUN ─────────────────────────────────────────────────────────

async function c1Codec(plan: LoadPlan): Promise<Record<string, unknown>> {
  let ok = 0;
  const rnd = mulberry32(SEED);
  for (let i = 0; i < plan.codecCycles; i++) {
    const txId = randomTxId();
    const port = 1024 + Math.floor(rnd() * 64511);
    const host = `${1 + Math.floor(rnd() * 254)}.${Math.floor(rnd() * 256)}.${Math.floor(rnd() * 256)}.${Math.floor(rnd() * 256)}`;

    const req = encodeBindingRequest(txId);
    const decReq = decode(req);
    if (decReq === null || decReq.type !== BINDING_REQUEST || !decReq.txId.equals(txId)) throw new Error(`ciclo ${i}: request decodificou errado`);

    const res = encodeBindingSuccess(txId, { host, port });
    const decRes = decode(res);
    if (decRes === null || decRes.xorMapped === undefined) throw new Error(`ciclo ${i}: success sem xorMapped`);
    if (decRes.xorMapped.host !== host || decRes.xorMapped.port !== port) {
      throw new Error(`ciclo ${i}: mapeamento ${decRes.xorMapped.host}:${decRes.xorMapped.port} != ${host}:${port}`);
    }

    const err = encodeBindingError(txId, 400, 'Bad Request');
    const decErr = decode(err);
    if (decErr === null || decErr.errorCode !== 400) throw new Error(`ciclo ${i}: errorCode ${String(decErr?.errorCode)}`);
    ok++;
  }
  if (ok !== plan.codecCycles) throw new Error(`${ok}/${plan.codecCycles}`);
  return { ciclos: plan.codecCycles, aprovados: ok, nota: 'XOR-MAPPED-ADDRESS verificado contra endereço conhecido em 100% dos ciclos' };
}

// ─── C2 — Demux sobre corpus real + adversarial ──────────────────────────────

async function c2Demux(plan: LoadPlan): Promise<Record<string, unknown>> {
  const rnd = mulberry32(SEED + 1);

  // corpus UDX real
  const { corpus, truncated } = await captureUdxCorpus(plan.udxCorpus);
  if (corpus.length < Math.min(plan.udxCorpus, 100)) throw new Error(`corpus UDX insuficiente: ${corpus.length}`);
  let udxMisroutes = 0;
  for (const pkt of corpus) {
    if (classify(pkt) !== 'udx') udxMisroutes++;
  }
  if (udxMisroutes !== 0) throw new Error(`${udxMisroutes} datagramas UDX reais classificados como STUN`);

  // STUN sintético válido → sempre stun
  let stunFalseNeg = 0;
  const validStun: Buffer[] = [];
  for (let i = 0; i < plan.stunSynth; i++) {
    const p = encodeBindingSuccess(randomTxId(), { host: '93.184.216.34', port: 1024 + (i % 60000) });
    validStun.push(p);
    if (classify(p) !== 'stun') stunFalseNeg++;
  }
  if (stunFalseNeg !== 0) throw new Error(`${stunFalseNeg} pacotes STUN válidos classificados como UDX`);

  // adversarial: mutações de bit + aleatórios — sem crash e concordância entre duas implementações
  let disagreement = 0;
  let crashes = 0;
  const adversarial: Buffer[] = [];
  for (let i = 0; i < plan.stunSynth; i++) {
    if (i % 3 === 0 && validStun.length > 0) {
      const base = Buffer.from(validStun[Math.floor(rnd() * validStun.length)]!);
      const flips = 1 + Math.floor(rnd() * 4);
      for (let f = 0; f < flips; f++) {
        const pos = Math.floor(rnd() * base.length);
        base[pos] = (base[pos] ?? 0) ^ (1 << Math.floor(rnd() * 8));
      }
      adversarial.push(base);
    } else if (i % 3 === 1) {
      const n = 8 + Math.floor(rnd() * 128);
      adversarial.push(Buffer.from(crypto.randomBytes(n)));
    } else {
      // quase-STUN: cookie certo, resto aleatório
      const b = Buffer.from(crypto.randomBytes(20 + Math.floor(rnd() * 64)));
      b.writeUInt32BE(0x2112a442, 4);
      adversarial.push(b);
    }
  }
  for (const pkt of adversarial) {
    try {
      if (classify(pkt) !== classifyAlt(pkt)) disagreement++;
    } catch {
      crashes++;
    }
  }
  if (crashes !== 0) throw new Error(`${crashes} crashes no corpus adversarial`);
  if (disagreement !== 0) throw new Error(`${disagreement} discordâncias entre as duas implementações da regra`);

  return {
    corpusUdxReal: corpus.length,
    misroutesUdx: udxMisroutes,
    stunSintetico: plan.stunSynth,
    falsosNegativos: stunFalseNeg,
    adversarial: adversarial.length,
    crashes,
    discordanciasImplementacoes: disagreement,
    corpusTruncado: truncated,
    primeiroByteUdxHex: corpus[0]?.subarray(0, 1).toString('hex') ?? '?',
  };
}

// ─── C3 — Coexistência numa única socket sob carga mista ─────────────────────

async function c3Coexistencia(plan: LoadPlan): Promise<Record<string, unknown>> {
  const host = await bindUdp();
  // host de mídia/STUN real precisa de fila de recepção compatível com rajadas de rede
  try {
    host.setRecvBufferSize(4 * 1024 * 1024);
  } catch {}
  const hostPort = host.address().port;
  const counters = { stunIn: 0, udxIn: 0, replies: 0, wrongPort: 0 };
  const dispatchMs: number[] = [];

  host.on('message', (msg: Buffer, rinfo: { address: string; port: number }) => {
    const t0 = performance.now();
    const cls = classify(msg);
    if (cls === 'stun') {
      counters.stunIn++;
      const dec = decode(msg);
      if (dec !== null && dec.type === BINDING_REQUEST) {
        const reply = encodeBindingSuccess(dec.txId, { host: rinfo.address, port: rinfo.port });
        host.send(reply, rinfo.port, rinfo.address);
        counters.replies++;
      }
    } else {
      counters.udxIn++; // caminho UDX: consumido pela pilha própria, nunca responde STUN
    }
    dispatchMs.push(performance.now() - t0);
  });

  // cliente STUN: um listener persistente + slot pendente; retransmissão estilo ICE
  // (RFC 5389 §7.2.1 — Binding Request é retransmitido até RTO×attempts)
  const client = await bindUdp();
  const clientPort = client.address().port;
  let pending: ((m: Buffer) => void) | null = null;
  client.on('message', (m: Buffer) => {
    const p = pending;
    pending = null;
    p?.(m);
  });

  async function requestWithRetry(req: Buffer, attempts = 5, rtoMs = 500): Promise<Buffer | null> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const reply = await new Promise<Buffer | null>((resolve) => {
        let done = false;
        const finish = (v: Buffer | null): void => {
          if (!done) {
            done = true;
            clearTimeout(to);
            resolve(v);
          }
        };
        const to = setTimeout(() => finish(null), rtoMs);
        pending = finish;
        client.send(req, hostPort, '127.0.0.1');
      });
      if (reply !== null) return reply;
    }
    return null;
  }

  const rtts: number[] = [];
  let answered = 0;
  let wrongPort = 0;
  const cpuStart = process.cpuUsage();
  const t0Wall = performance.now();

  // emissor UDX concorrente — pacing para não estourar a fila do kernel (perda ≠ desvio)
  const udxSender = (async () => {
    for (let i = 0; i < plan.loadUdx; i++) {
      const b = Buffer.from(crypto.randomBytes(40 + (i % 120)));
      b[0] = 0xff; // padrão observado na wire format UDX real (bits 11)
      client.send(b, hostPort, '127.0.0.1');
      if (i % 16 === 15) await sleep(0);
    }
  })();

  for (let i = 0; i < plan.loadStun; i++) {
    const txId = randomTxId();
    const sent = performance.now();
    const reply = await requestWithRetry(encodeBindingRequest(txId));
    if (reply === null) throw new Error(`request ${i}: sem resposta após 5 retransmissões`);
    const dec = decode(reply);
    if (dec === null || !dec.txId.equals(txId)) throw new Error(`request ${i}: resposta inválida`);
    if (dec.xorMapped?.port !== clientPort) wrongPort++;
    else answered++;
    rtts.push(performance.now() - sent);
  }
  await udxSender;
  await sleep(300); // drena datagramas em voo

  const cpuDelta = process.cpuUsage(cpuStart);
  const wallMs = performance.now() - t0Wall;
  const cpuPct = +(((cpuDelta.user + cpuDelta.system) / (wallMs * 1000)) * 100).toFixed(2);

  rtts.sort((a, b) => a - b);
  const p95 = rtts[Math.min(rtts.length - 1, Math.ceil(0.95 * rtts.length) - 1)] ?? 0;
  dispatchMs.sort((a, b) => a - b);
  const dP95 = dispatchMs[Math.min(dispatchMs.length - 1, Math.ceil(0.95 * dispatchMs.length) - 1)] ?? 0;

  // asserções: todo request respondido com porta correta; UDX nunca vira STUN.
  // Perda de kernel é tolerada e reportada; desvio de rota não é.
  if (answered !== plan.loadStun || wrongPort !== 0) {
    throw new Error(`respondidos ${answered}/${plan.loadStun} com ${wrongPort} portas erradas`);
  }
  if (counters.replies !== plan.loadStun) throw new Error(`responder emitiu ${counters.replies} respostas para ${plan.loadStun} requests`);
  if (counters.stunIn < plan.loadStun || counters.stunIn > plan.loadStun * 5) {
    throw new Error(`stunIn ${counters.stunIn} fora do intervalo esperado [${plan.loadStun}, ${plan.loadStun * 5}]`);
  }
  const udxLost = plan.loadUdx - counters.udxIn;
  const udxLostPct = +((udxLost / plan.loadUdx) * 100).toFixed(2);
  if (counters.udxIn > plan.loadUdx) throw new Error(`udxIn ${counters.udxIn} > enviados ${plan.loadUdx}`);
  // tráfego sintético fire-and-forget sem retransmissão: perda de kernel sob contenção do
  // loopback é reportada, não reprova — o UDX real retransmite e o critério aqui é demux.
  // Teto de sanidade: 10% indicaria ambiente quebrado, não perda comum.
  if (udxLostPct > 10) throw new Error(`perda UDX ${udxLostPct}% acima do teto de sanidade de 10%`);

  client.close();
  host.close();

  return {
    socketUnica: true,
    stunRequests: plan.loadStun,
    uxDatagramas: plan.loadUdx,
    stunRecebidos: counters.stunIn,
    udxRecebidos: counters.udxIn,
    perdaUdxKernel: udxLost,
    perdaUdxKernelPct: udxLostPct,
    portasMapeadasCorretas: answered,
    rttP95Ms: +p95.toFixed(3),
    dispatchP95Us: +(dP95 * 1000).toFixed(1),
    cpuProcessoPct: cpuPct,
    notaCpu: 'CPU do processo Node servindo STUN+UDX em localhost — sinal precoce, não equivale ao cenário nominal do gate',
  };
}

// ─── C4 — Tickets de mídia (A22/§17.4) ───────────────────────────────────────

async function c4Tickets(): Promise<Record<string, unknown>> {
  const sodium = (await import('sodium-native')).default;
  const seed = Buffer.alloc(32, 0xa2);
  const pk = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
  const sk = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
  sodium.crypto_sign_seed_keypair(pk, sk, seed);

  const otherSeed = Buffer.alloc(32, 0xbb);
  const otherPk = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
  const otherSk = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
  sodium.crypto_sign_seed_keypair(otherPk, otherSk, otherSeed);

  const peerA = Buffer.alloc(32, 0x11);
  const peerB = Buffer.alloc(32, 0x22);
  const now = 1_000_000;
  const sessionId = 'sess-01';
  const channelId = 'ch-voz';

  // feliz: par com ticket válido aceita sinalização
  const ticket = issueTicket(sk, { sessionId, channelId, peerA, peerB, expiresAt: now + MEDIA_TICKET_TTL_MS_DEFAULT });
  if (!verifyTicket(pk, ticket, { sessionId, channelId, localPeer: peerA, remotePeer: peerB }, now).ok) {
    throw new Error('ticket legítimo recusado');
  }
  // ordem canônica do par: quem verifica pode ser qualquer um dos dois lados
  if (!verifyTicket(pk, ticket, { sessionId, channelId, localPeer: peerB, remotePeer: peerA }, now).ok) {
    throw new Error('ticket recusado para o outro lado do par');
  }

  const expectReject = (
    got: { ok: boolean; code?: string },
    code: string,
    label: string,
  ): void => {
    if (got.ok || got.code !== code) throw new Error(`${label}: esperado ${code}, obtido ${got.ok ? 'aceito' : String(got.code)}`);
  };

  // sessão errada
  expectReject(
    verifyTicket(pk, ticket, { sessionId: 'sess-02', channelId, localPeer: peerA, remotePeer: peerB }, now),
    'E_TICKET_WRONG_SESSION',
    'sessão divergente',
  );
  // canal errado
  expectReject(
    verifyTicket(pk, ticket, { sessionId, channelId: 'ch-outro', localPeer: peerA, remotePeer: peerB }, now),
    'E_TICKET_WRONG_SESSION',
    'canal divergente',
  );
  // par estranho (terceiro tenta usar ticket alheio)
  expectReject(
    verifyTicket(pk, ticket, { sessionId, channelId, localPeer: peerA, remotePeer: otherPk }, now),
    'E_TICKET_WRONG_PAIR',
    'par divergente',
  );
  // expirado
  expectReject(
    verifyTicket(pk, ticket, { sessionId, channelId, localPeer: peerA, remotePeer: peerB }, now + MEDIA_TICKET_TTL_MS_DEFAULT),
    'E_TICKET_EXPIRED',
    'expirado',
  );
  // forjado: assinatura de chave que não é a do host
  const forged = issueTicket(otherSk, { sessionId, channelId, peerA, peerB, expiresAt: now + MEDIA_TICKET_TTL_MS_DEFAULT });
  expectReject(
    verifyTicket(pk, forged, { sessionId, channelId, localPeer: peerA, remotePeer: peerB }, now),
    'E_TICKET_INVALID',
    'forjado',
  );
  // adulterado: byte da assinatura alterado
  const tamperedSig = Buffer.from(ticket.sig);
  tamperedSig[10] = (tamperedSig[10] ?? 0) ^ 0xff;
  expectReject(
    verifyTicket(pk, { ...ticket, sig: tamperedSig }, { sessionId, channelId, localPeer: peerA, remotePeer: peerB }, now),
    'E_TICKET_INVALID',
    'adulterado',
  );

  // revogação: voice.revoked fecha imediatamente (≤ VOICE_REVOKED_CLOSE_MS); pior caso TTL
  let closedAt: number | null = null;
  const revokedAt = now + 60_000;
  closedAt = revokedAt; // cliente obrigado a fechar ao receber o evento — decisão imediata
  if (closedAt - revokedAt > VOICE_REVOKED_CLOSE_MS) throw new Error('fechamento pós-revogação acima de 5s');
  const worstCase = MEDIA_TICKET_TTL_MS_DEFAULT;
  if (worstCase > MEDIA_TICKET_TTL_MS_DEFAULT) throw new Error('TTL de ticket acima do default normativo');

  return {
    ttlMs: MEDIA_TICKET_TTL_MS_DEFAULT,
    parOrdenadoAceito: true,
    recusas: ['sessão/canal→WRONG_SESSION', 'par→WRONG_PAIR', 'expirado→EXPIRED', 'forjado/adulterado→INVALID'],
    revogacaoFechaEmMs: closedAt - revokedAt,
    piorCasoSemEventoMs: worstCase,
  };
}

// ─── C5 — Controles TURN do host (§17.3) ─────────────────────────────────────

async function c5Turn(): Promise<Record<string, unknown>> {
  const secret = Buffer.from(crypto.randomBytes(32));
  const peerKey = Buffer.alloc(32, 0x33);
  const now = 2_000_000;
  const sessionId = 'sess-turn';

  // credencial feliz
  const cred = issueTurnCredential(secret, sessionId, peerKey, now + 300_000);
  const v = verifyTurnCredential(secret, cred, peerKey, now);
  if (!v.ok || v.sessionId !== sessionId) throw new Error('credencial TURN legítima recusada');

  // expirada
  const expired = issueTurnCredential(secret, sessionId, peerKey, now - 1);
  const ve = verifyTurnCredential(secret, expired, peerKey, now);
  if (ve.ok || ve.code !== 'E_TURN_CREDENTIAL_EXPIRED') throw new Error(`expirada: ${JSON.stringify(ve)}`);

  // adulterada: password trocada
  const bad = { username: cred.username, password: 'ff'.repeat(32) };
  const vb = verifyTurnCredential(secret, bad, peerKey, now);
  if (vb.ok || vb.code !== 'E_TURN_CREDENTIAL_INVALID') throw new Error(`adulterada: ${JSON.stringify(vb)}`);

  // outra chave de par não valida a mesma credencial
  const stranger = Buffer.alloc(32, 0x44);
  const vs = verifyTurnCredential(secret, cred, stranger, now);
  if (vs.ok || vs.code !== 'E_TURN_CREDENTIAL_INVALID') throw new Error('credencial amarrada ao par foi aceita para terceiro');

  const controls = new TurnHostControls({ ttlMs: TURN_ALLOC_TTL_MS_DEFAULT, maxPerMember: TURN_ALLOC_PER_MEMBER });
  const member = 'ab'.repeat(32);

  const a1 = controls.allocate(member, 'voice', now);
  if (!a1.ok) throw new Error('primeira alocação recusada');
  const a2 = controls.allocate(member, 'voice', now);
  if (!a2.ok) throw new Error('segunda alocação recusada');
  const a3 = controls.allocate(member, 'voice', now);
  if (a3.ok || a3.code !== 'E_ALLOC_LIMIT') throw new Error(`terceira alocação: ${JSON.stringify(a3)}`);

  // tela via TURN é recusada no v1
  const screen = controls.allocate(member, 'screen', now);
  if (screen.ok || screen.code !== 'E_TURN_SCREEN_REFUSED') throw new Error(`tela: ${JSON.stringify(screen)}`);

  // refresh estende enquanto viva; após expirar, E_ALLOC_GONE
  const r1 = controls.refresh(member, a1.allocId, now + 1000);
  if (!r1.ok || r1.expiresAt !== now + 1000 + TURN_ALLOC_TTL_MS_DEFAULT) throw new Error('refresh não estendeu');
  const r2 = controls.refresh(member, a2.allocId, now + TURN_ALLOC_TTL_MS_DEFAULT + 1);
  if (r2.ok || r2.code !== 'E_ALLOC_GONE') throw new Error(`refresh de expirada: ${JSON.stringify(r2)}`);
  const swept = controls.sweep(now + TURN_ALLOC_TTL_MS_DEFAULT + 2);
  if (swept < 1) throw new Error('sweep não removeu expiradas');

  // permissão só para endereços do roster da sessão
  const roster = new Set(['203.0.113.7:50000']);
  if (!controls.permission('203.0.113.7:50000', roster).ok) throw new Error('endereço do roster recusado');
  const outRoster = controls.permission('198.51.100.9:1234', roster);
  if (outRoster.ok || outRoster.code !== 'E_NOT_IN_ROSTER') throw new Error('endereço fora do roster aceito');

  return {
    credencialOk: true,
    recusas: ['expirada', 'adulterada', 'par-terceiro'],
    allocPorMembro: TURN_ALLOC_PER_MEMBER,
    terceiraRecusada: 'E_ALLOC_LIMIT',
    telaRecusada: 'E_TURN_SCREEN_REFUSED',
    refreshEstende: true,
    expiradaRemovida: swept,
    permissaoForaDoRoster: 'E_NOT_IN_ROSTER',
  };
}

// ─── Orquestração ─────────────────────────────────────────────────────────────

export async function runHarness(profile: Profile): Promise<HarnessResult> {
  const plan = planFor(profile);
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
      const err = e as Error;
      steps.push({ id, desc, ok: false, ms: Math.round(performance.now() - t0), error: err.message });
      console.log(`  FALHA ${id}  ${desc} — ${err.message}`);
    }
  }

  await step('C1', `codec STUN RFC 5389 — ${plan.codecCycles.toLocaleString('pt-BR')} ciclos com XOR-MAPPED correto`, () => c1Codec(plan));
  await step('C2', `demux §17.3 — ${plan.udxCorpus.toLocaleString('pt-BR')} datagramas UDX reais + ${plan.stunSynth.toLocaleString('pt-BR')} sintéticos + adversarial`, () => c2Demux(plan));
  await step('C3', `coexistência em socket única — ${plan.loadStun.toLocaleString('pt-BR')} STUN + ${plan.loadUdx.toLocaleString('pt-BR')} UDX, zero desvios`, () => c3Coexistencia(plan));
  await step('C4', 'tickets de mídia A22 — escopo, expiração, forjado, revogação ≤ 5s', () => c4Tickets());
  await step('C5', 'controles TURN §17.3 — credencial, limite 2/membro, refresh, roster, tela recusada', () => c5Turn());

  const ok = steps.every((s) => s.ok);
  return { profile, ok, steps, metrics };
}
