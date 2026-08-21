// Cenários do POC-09/G8 no escopo Node. Cada passo devolve ok/detalhe; os números vão
// todos para o artefato out/gate-G8/gate-G8.json. As decisões exercidas são sempre as
// classes reais do core (VoiceHostSessions, ShareHostSessions, VoiceTicketManager,
// MediaServer/TurnControls) — nada é reimplementado aqui.

import dgram from 'node:dgram';
import { performance } from 'node:perf_hooks';

import { core, type ShareQuality } from './core.js';
import { HostRig, StarSession, keypair, kbpsOf, sleep, startStunService } from './star.js';

export type Profile = 'quick' | 'full';

export interface Step {
  id: string;
  desc: string;
  ok: boolean;
}

export interface ScenarioOutcome {
  steps: Step[];
  metrics: Record<string, unknown>;
  ok: boolean;
}

function codeOf(r: { ok: true } | { ok: false; code: string }): 'ok' | string {
  return r.ok ? 'ok' : r.code;
}

function setQualityCode(r: { ok: true; applied: true; quality: ShareQuality } | { ok: false; code: string }): string {
  return r.ok ? 'aplicado' : r.code;
}

function captureReason(r: { allowed: true } | { allowed: false; reason: 'gone' | 'mismatch' | 'expired' }): string {
  return r.allowed ? 'autorizado' : r.reason;
}

/** Mede CPU do processo em torno de um trecho assíncrono (limite superior: tudo num processo). */
async function withCpu<T>(fn: () => Promise<T>): Promise<{ result: T; cpuPct: number }> {
  const start = process.cpuUsage();
  const t0 = performance.now();
  const result = await fn();
  const dtMs = performance.now() - t0;
  const delta = process.cpuUsage(start);
  return { result, cpuPct: ((delta.user + delta.system) / 1000 / dtMs) * 100 };
}

// ─── Camada de decisão (sem mídia) ──────────────────────────────────────────────────────

function s1Autorizacao(): { step: Step; metrics: Record<string, unknown> } {
  const rig = new HostRig();
  const presenter = keypair('s1-apresentador');
  const viewer = keypair('s1-espectador');
  rig.addMember(presenter.hex);
  rig.addMember(viewer.hex);
  rig.voice.join({ state: rig.state, channelId: 'voz-canal', memberKeyHex: presenter.hex });
  rig.voice.join({ state: rig.state, channelId: 'voz-canal', memberKeyHex: viewer.hex });

  // sem `voice_share_screen` no cargo → E_PERMISSION_DENIED mesmo elegível
  const semPermissao = new HostRig();
  semPermissao.addMember(presenter.hex);
  semPermissao.voice.join({ state: semPermissao.state, channelId: 'voz-canal', memberKeyHex: presenter.hex });
  const estadoSemShare = {
    community: { exists: true },
    channels: semPermissao.state.channels,
    members: semPermissao.state.members,
    roles: new Map([['r-todos', { permissions: [9] }]]),
  };

  const foraDaChamada = new HostRig();
  foraDaChamada.addMember(presenter.hex);

  const started = rig.shares.start({ state: rig.state, channelId: 'voz-canal', presenterKeyHex: presenter.hex });
  const again = rig.shares.start({ state: rig.state, channelId: 'voz-canal', presenterKeyHex: presenter.hex });

  const recusas = {
    semPermissao: codeOf(semPermissao.shares.start({ state: estadoSemShare, channelId: 'voz-canal', presenterKeyHex: presenter.hex })),
    foraDaChamada: codeOf(foraDaChamada.shares.start({ state: foraDaChamada.state, channelId: 'voz-canal', presenterKeyHex: presenter.hex })),
  };

  const ok =
    started.ok &&
    !again.ok &&
    again.code === 'E_ALREADY_SHARING' &&
    recusas.semPermissao === 'E_PERMISSION_DENIED' &&
    recusas.foraDaChamada === 'E_SESSION_GONE';

  return {
    step: { id: 'S1', desc: 'share.start — validação §17.4 passo 1 + voice_share_screen; uma sessão por canal (E_ALREADY_SHARING)', ok },
    metrics: {
      shareStartOk: started.ok,
      segundaRecusa: again.ok ? null : again.code,
      semPermissaoRecusadoCom: recusas.semPermissao,
      apresentadorForaDaChamadaRecusadoCom: recusas.foraDaChamada,
    },
  };
}

function s2CaptureToken(): { step: Step; metrics: Record<string, unknown> } {
  const rig = new HostRig();
  const presenter = keypair('s2-apresentador');
  rig.addMember(presenter.hex);
  rig.voice.join({ state: rig.state, channelId: 'voz-canal', memberKeyHex: presenter.hex });

  // ordem T-41: antes de share.start não existe captura possível
  const antesDeStart = rig.shares.authorizeCapture({ sessionId: 'inexistente', token: 'ab'.repeat(32) });

  const started = rig.shares.start({ state: rig.state, channelId: 'voz-canal', presenterKeyHex: presenter.hex });
  if (!started.ok) throw new Error('start deveria passar');
  const good = rig.shares.authorizeCapture({ sessionId: started.sessionId, token: started.captureToken.token });
  const wrongToken = rig.shares.authorizeCapture({ sessionId: started.sessionId, token: 'cd'.repeat(32) });
  const wrongSession = rig.shares.authorizeCapture({ sessionId: 'outra-sessao', token: started.captureToken.token });

  // tela via TURN recusada na decisão REAL de §17.3 (TurnControls do stunTurn.ts)
  const controls = new core.TurnControls({ ttlMs: 600_000, maxPerMember: 2 });
  const screenViaTurn = controls.allocate(presenter.hex, 'screen', Date.now());

  rig.shares.stop({ sessionId: started.sessionId, memberKeyHex: presenter.hex });
  const aposStop = rig.shares.authorizeCapture({ sessionId: started.sessionId, token: started.captureToken.token });

  const ok =
    antesDeStart.allowed === false &&
    good.allowed === true &&
    wrongToken.allowed === false &&
    wrongSession.allowed === false &&
    aposStop.allowed === false &&
    !screenViaTurn.ok &&
    screenViaTurn.reason === 'screen-refused';

  return {
    step: {
      id: 'S2',
      desc: 'captureToken T-41 — captura nunca inicia sem token válido da sessão viva; tela via TURN recusada',
      ok,
    },
    metrics: {
      antesDoStart: captureReason(antesDeStart),
      tokenCorretoAutorizado: good.allowed,
      tokenErrado: captureReason(wrongToken),
      sessaoErrada: captureReason(wrongSession),
      aposStop: captureReason(aposStop),
      telaViaTURN: screenViaTurn.ok ? 'aceita-indevidamente' : screenViaTurn.reason,
    },
  };
}

function s3TetoEQualidade(): { step: Step; metrics: Record<string, unknown> } {
  const rig = new HostRig();
  const presenter = keypair('s3-apresentador');
  rig.addMember(presenter.hex);
  rig.voice.join({ state: rig.state, channelId: 'voz-canal', memberKeyHex: presenter.hex });
  const started = rig.shares.start({ state: rig.state, channelId: 'voz-canal', presenterKeyHex: presenter.hex, quality: 'high' });
  if (!started.ok) throw new Error('start deveria passar');

  const labels = Array.from({ length: 9 }, (_, i) => `s3-v${i}`);
  for (const l of labels) rig.addMember(keypair(l).hex);
  for (const l of labels) rig.voice.join({ state: rig.state, channelId: 'voz-canal', memberKeyHex: keypair(l).hex });

  const codigos = labels.map((l) => codeOf(rig.shares.join({ sessionId: started.sessionId, memberKeyHex: keypair(l).hex })));

  // um sai → a vaga reabre para o próximo da chamada
  rig.shares.leave({ sessionId: started.sessionId, memberKeyHex: keypair('s3-v3').hex });
  rig.addMember(keypair('s3-extra').hex);
  rig.voice.join({ state: rig.state, channelId: 'voz-canal', memberKeyHex: keypair('s3-extra').hex });
  const vagaReaberta = codeOf(rig.shares.join({ sessionId: started.sessionId, memberKeyHex: keypair('s3-extra').hex }));

  const v0 = keypair('s3-v0').hex;
  const foraDaSessao = keypair('s3-v8').hex; // tentou entrar, levou FULL, nunca assiste
  const setLow = rig.shares.setQuality({ sessionId: started.sessionId, memberKeyHex: v0, quality: 'low' });
  const naoEspectador = rig.shares.setQuality({ sessionId: started.sessionId, memberKeyHex: foraDaSessao, quality: 'low' });
  const sessaoGone = rig.shares.setQuality({ sessionId: 'nada', memberKeyHex: v0, quality: 'low' });

  const degradeTabela = [
    core.degradeOnLoss('high', 3),
    core.degradeOnLoss('high', 3.01),
    core.degradeOnLoss('balanced', 12),
    core.degradeOnLoss('low', 40),
  ];

  const oitoOk = codigos.slice(0, 8).every((c) => c === 'ok');
  const nonoFull = codigos[8] === 'E_SESSION_FULL';
  const recusaNaoEspectador = setQualityCode(naoEspectador);
  const recusaSessaoGone = setQualityCode(sessaoGone);
  const ok =
    oitoOk && nonoFull && vagaReaberta === 'ok' && setLow.ok && recusaNaoEspectador === 'E_PERMISSION_DENIED' && recusaSessaoGone === 'E_SESSION_GONE';

  return {
    step: {
      id: 'S3',
      desc: 'teto SHARE_MAX_VIEWERS=8 — 9º espectador recebe E_SESSION_FULL; setQuality por espectador; degradação >3%',
      ok,
    },
    metrics: {
      entraramOk: codigos.filter((c) => c === 'ok').length,
      nonoEspectador: codigos[8],
      vagaReabertaAposLeave: vagaReaberta,
      setQualityEspectador: setLow,
      setQualityNaoEspectador: recusaNaoEspectador,
      setQualitySessaoGone: recusaSessaoGone,
      degradeOnLoss: { high3pct: degradeTabela[0], high301pct: degradeTabela[1], balanced12pct: degradeTabela[2], low40pct: degradeTabela[3] },
    },
  };
}

function s4Revogacao(): { step: Step; metrics: Record<string, unknown> } {
  const rig = new HostRig();
  const presenter = keypair('s4-apresentador');
  const v1 = keypair('s4-v1');
  const v2 = keypair('s4-v2');
  for (const k of [presenter.hex, v1.hex, v2.hex]) rig.addMember(k);
  for (const k of [presenter.hex, v1.hex, v2.hex]) rig.voice.join({ state: rig.state, channelId: 'voz-canal', memberKeyHex: k });
  const started = rig.shares.start({ state: rig.state, channelId: 'voz-canal', presenterKeyHex: presenter.hex });
  if (!started.ok) throw new Error('start deveria passar');
  for (const k of [v1.hex, v2.hex]) rig.shares.join({ sessionId: started.sessionId, memberKeyHex: k });

  rig.shareRevoked.length = 0;
  rig.ban(v1.hex);
  const alvosBanV1 = rig.shareRevoked.map((t) => t.targetKeyHex);
  const espectadoresAposBanV1 = rig.shares.snapshotOf(started.sessionId)?.viewers.length ?? -1;

  rig.shareRevoked.length = 0;
  const banPresenter = rig.ban(presenter.hex);
  const sessaoAposBanPresenter = rig.shares.snapshotOf(started.sessionId);
  const alvosPresenter = new Set([...banPresenter.voiceTargets, ...banPresenter.shareTargets]);

  const ok =
    JSON.stringify(alvosBanV1.slice().sort()) === JSON.stringify([v1.hex]) &&
    espectadoresAposBanV1 === 1 &&
    sessaoAposBanPresenter === null &&
    alvosPresenter.has(v2.hex);

  return {
    step: { id: 'S4', desc: 'revogação T-32 — ban do apresentador encerra a sessão de tela; ban do espectador revoga só ele', ok },
    metrics: {
      banEspectadorAlvos: alvosBanV1,
      espectadoresRestantes: espectadoresAposBanV1,
      banApresentadorAlvos: [...alvosPresenter],
      sessaoEncerrada: sessaoAposBanPresenter === null,
    },
  };
}

// ─── Estrela WebRTC ─────────────────────────────────────────────────────────────────────

async function wEstrela(opts: {
  id: string;
  viewers: number;
  quality: ShareQuality;
  windowMs: number;
}): Promise<{ step: Step; metrics: Record<string, unknown>; cpuPct: number }> {
  const session = new StarSession();
  await session.setup('balanced');
  const labels = Array.from({ length: opts.viewers }, (_, i) => `${opts.id.toLowerCase()}-v${i}`);
  const joins = [];
  for (const [i, label] of labels.entries()) {
    joins.push(await session.addViewer(label, i % 2 === 0 ? opts.quality : 'balanced'));
  }

  const { result: janela, cpuPct } = await withCpu(() => session.measureWindow(opts.windowMs));
  const stats = await session.senderStats();

  const latP95Max = Math.max(...janela.map((m) => m.latencyP95Ms));
  const perdaMax = Math.max(...janela.map((m) => m.lossPct));
  const bitrateOk = janela.every((m) => Math.abs(m.kbps - kbpsOf(m.quality)) / kbpsOf(m.quality) < 0.35);

  await session.close();

  return {
    step: {
      id: opts.id,
      desc: `estrela com ${opts.viewers} espectadores — latência p50/p95, perda e bitrate por perfil medidos`,
      ok: latP95Max <= 800 && perdaMax < 1 && bitrateOk,
    },
    metrics: {
      espectadores: opts.viewers,
      janelaMs: opts.windowMs,
      latenciaP50PorEspectadorMs: janela.map((m) => round1(m.latencyP50Ms)),
      latenciaP95PorEspectadorMs: janela.map((m) => round1(m.latencyP95Ms)),
      latenciaP95MaxMs: round1(latP95Max),
      perdaMaxPct: round2(perdaMax),
      qualidadePorEspectador: janela.map((m) => m.quality),
      kbpsRecebidoPorEspectador: janela.map((m) => round1(m.kbps)),
      kbpsContratualPorEspectador: janela.map((m) => kbpsOf(m.quality)),
      primeiroQuadroMs: joins.map((j) => (j.firstFrameMs === null ? null : round1(j.firstFrameMs))),
      outboundBytesSentGetStats: stats.map((s) => s.bytesSent),
      cpuProcessoPct: round2(cpuPct),
    },
    cpuPct,
  };
}

async function wSetQuality(): Promise<{ step: Step; metrics: Record<string, unknown> }> {
  const session = new StarSession();
  await session.setup('balanced');
  await session.addViewer('sq-v0', 'high');
  await session.addViewer('sq-v1', 'high');

  const base = await session.measureWindow(1_500);
  const aplicado = session.applyQuality(0, 'low');
  const depois = aplicado ? await session.measureWindow(1_500) : null;

  await session.close();
  const razaoV0 = depois !== null ? depois[0]!.kbps / Math.max(1, base[0]!.kbps) : Number.NaN;
  const razaoV1 = depois !== null ? depois[1]!.kbps / Math.max(1, base[1]!.kbps) : Number.NaN;
  const esperado = kbpsOf('low') / kbpsOf('high');
  const ok = aplicado && Math.abs(razaoV0 - esperado) < 0.2 && Math.abs(razaoV1 - 1) < 0.35;

  return {
    step: { id: 'W4', desc: 'setQuality por espectador — v0 high→low muda só o bitrate dele (medido nos receptores)', ok },
    metrics: {
      aplicado,
      kbpsBaseV0: round1(base[0]!.kbps),
      kbpsBaseV1: round1(base[1]!.kbps),
      kbpsDepoisV0: depois === null ? null : round1(depois[0]!.kbps),
      kbpsDepoisV1: depois === null ? null : round1(depois[1]!.kbps),
      razaoMedidaV0: round3(razaoV0),
      razaoMedidaV1: round3(razaoV1),
      razaoContratualLowHigh: esperado,
      setParameters: 'maxBitrate registrado no RTCRtpSender; enforcement pela bomba (werift não aplica maxBitrate)',
    },
  };
}

async function wDegrade(profile: Profile): Promise<{ step: Step; metrics: Record<string, unknown> }> {
  const session = new StarSession();
  await session.setup('balanced');
  await session.addViewer('dg-v0', 'high');
  await session.addViewer('dg-v1', 'high');
  await session.addViewer('dg-v2', 'high');

  session.injectLoss(0, 0.06);
  const sobPerda = await session.measureWindow(profile === 'quick' ? 1_500 : 2_000);
  const perdaMedida = sobPerda[0]!.lossPct;
  const decisao = core.degradeOnLoss('high', perdaMedida);
  const aplicou = decisao !== null && session.applyQuality(0, decisao);
  const degradado = aplicou ? await session.measureWindow(1_200) : null;

  await session.close();
  const caiuParaPerfilInferior = degradado !== null && degradado[0]!.kbps < sobPerda[0]!.kbps * 0.75;
  const vizinhosSemPerda = sobPerda.slice(1).every((m) => m.lossPct < 1);
  const ok = perdaMedida > 3 && decisao === 'balanced' && aplicou && caiuParaPerfilInferior && vizinhosSemPerda;

  return {
    step: { id: 'W7', desc: 'degradação automática quando a saúde reporta perda > 3% (perfil desce, bitrate medido cai)', ok },
    metrics: {
      perdaInjetadaPct: 6,
      perdaMedidaPct: round2(perdaMedida),
      decisaoCore: decisao,
      aplicada: aplicou,
      kbpsAntesDegradar: round1(sobPerda[0]!.kbps),
      kbpsAposDegradar: degradado === null ? null : round1(degradado[0]!.kbps),
      perdaDosVizinhosPct: sobPerda.slice(1).map((m) => round2(m.lossPct)),
    },
  };
}

async function wEntradaTardiaEChurn(): Promise<{ step: Step; metrics: Record<string, unknown> }> {
  const session = new StarSession();
  await session.setup('balanced');
  for (const i of [0, 1, 2]) await session.addViewer(`et-v${i}`, 'balanced');
  await session.measureWindow(800);

  const tardio = await session.addViewer('et-tardio', 'high');
  const primeiroQuadroOk = tardio.firstFrameMs !== null && tardio.firstFrameMs < 2_000;

  const antes = await session.measureWindow(700);
  const kbpsAntesPorHex = new Map(antes.map((m) => [m.keyHex, m.kbps]));
  await session.leaveViewer(0); // churn: espectador 0 sai
  const depois = await session.measureWindow(700);
  const restantesEstaveis = depois
    .filter((m) => m.keyHex !== antes[0]!.keyHex)
    .every((m) => {
      const b = kbpsAntesPorHex.get(m.keyHex);
      return b === undefined || m.kbps > b * 0.5;
    });

  await session.close();
  const ok = primeiroQuadroOk && restantesEstaveis;

  return {
    step: { id: 'W6', desc: 'entrada tardia mede tempo até o 1º quadro; saída (churn) não afeta os demais espectadores', ok },
    metrics: {
      entradaTardiaPrimeiroQuadroMs: tardio.firstFrameMs === null ? null : round1(tardio.firstFrameMs),
      kbpsAntesDoChurn: [...kbpsAntesPorHex.entries()].map(([hexKey, kbps]) => ({ hexKey, kbps: round1(kbps) })),
      kbpsAposChurn: depois.map((m) => round1(m.kbps)),
    },
  };
}

async function wBanPresenter(profile: Profile): Promise<{ step: Step; metrics: Record<string, unknown> }> {
  const session = new StarSession();
  await session.setup('balanced');
  const total = profile === 'quick' ? 2 : 3;
  for (let i = 0; i < total; i++) await session.addViewer(`bp-v${i}`, 'balanced');
  await session.measureWindow(800);

  const ban = await session.banPresenter();
  const calmo = await session.measureWindow(500);
  const trafegoParou = calmo.every((m) => m.packetsReceived === 0);

  await session.close();
  const ok = trafegoParou && ban.cessationMs < 5_000 && ban.revokedCount >= total;

  return {
    step: { id: 'W8', desc: 'ban do apresentador no meio da sessão — tráfego cessa imediatamente (critério ≤ 5 s)', ok },
    metrics: {
      cessacaoMs: round1(ban.cessationMs),
      criterioMs: 5_000,
      revogados: ban.revokedCount,
      pacotesRecebidosAposBan: calmo.map((m) => m.packetsReceived),
    },
  };
}

// ─── Orquestração ───────────────────────────────────────────────────────────────────────

export async function runScenarios(profile: Profile): Promise<ScenarioOutcome> {
  const steps: Step[] = [];
  const metrics: Record<string, unknown> = {};

  for (const s of [s1Autorizacao(), s2CaptureToken(), s3TetoEQualidade(), s4Revogacao()]) {
    steps.push(s.step);
    metrics[s.step.id] = s.metrics;
  }

  // W1 — STUN do host (MediaServer real) + demux da socket compartilhada
  {
    const rig = new HostRig();
    const svc = await startStunService(rig);
    const sondas = [];
    for (let i = 0; i < (profile === 'quick' ? 3 : 6); i++) sondas.push(await svc.probe());

    const client = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => client.bind(0, '127.0.0.1', resolve));
    client.send(Buffer.alloc(64, 0xff), svc.port, '127.0.0.1'); // lixo UDX: 1º byte 0xFF
    await sleep(150);
    client.close();

    const atravessou = svc.udxPassthroughs();
    await svc.close();
    const ok = sondas.every((s) => s.ok) && atravessou >= 1;
    steps.push({ id: 'W1', desc: 'STUN do host (MediaServer real) responde Binding com XOR-MAPPED correto; lixo UDX atravessa ao UDX', ok });
    metrics['W1'] = {
      sondas: sondas.length,
      xorMappedCorreto: sondas.filter((s) => s.ok).length,
      rttMedioMs: round1(sondas.reduce((acc, s) => acc + s.rttMs, 0) / sondas.length),
      datagramasUdxDesviados: atravessou,
    };
  }

  // W2 — ticket adulterado é recusado na sinalização (A22 passos 3–4) + estrela pequena real
  {
    const probe = new StarSession();
    await probe.setup('balanced');
    const forjado = probe.probeTamperedTicket('w2-forjado');
    await probe.close();

    const w = await wEstrela({ id: 'W2', viewers: 2, quality: 'high', windowMs: profile === 'quick' ? 2_000 : 2_500 });
    steps.push(
      { id: 'W2a', desc: 'ticket Ed25519 adulterado é recusado na sinalização; DTLS nunca inicia sem ticket válido', ok: forjado === 'refused' },
      w.step,
    );
    metrics['W2a'] = { resultado: forjado };
    metrics['W2'] = w.metrics;
  }

  const sq = await wSetQuality();
  steps.push(sq.step);
  metrics['W4'] = sq.metrics;

  const et = await wEntradaTardiaEChurn();
  steps.push(et.step);
  metrics['W6'] = et.metrics;

  const dg = await wDegrade(profile);
  steps.push(dg.step);
  metrics['W7'] = dg.metrics;

  const bp = await wBanPresenter(profile);
  steps.push(bp.step);
  metrics['W8'] = bp.metrics;

  // W5/W9 — estrela cheia (critérios centrais do G8), só no perfil full
  if (profile === 'full') {
    const w5 = await wEstrela({ id: 'W5', viewers: 8, quality: 'balanced', windowMs: 4_000 });
    steps.push(w5.step);
    metrics['W5'] = w5.metrics;

    const session = new StarSession();
    await session.setup('balanced');
    for (let i = 0; i < 8; i++) await session.addViewer(`w9-v${i}`, 'balanced');
    const nono = session.tryJoinBeyondCeiling('w9-v9');
    const captureOk =
      session.captureToken !== null &&
      session.shareSessionId !== null &&
      session.rig.shares.authorizeCapture({ sessionId: session.shareSessionId, token: session.captureToken }).allowed;
    await session.close();
    steps.push({
      id: 'W9',
      desc: 'estrela cheia: 9º espectador recebe E_SESSION_FULL na decisão real; captureToken da sessão viva autoriza a captura',
      ok: !nono.ok && nono.code === 'E_SESSION_FULL' && captureOk,
    });
    metrics['W9'] = { nonoEspectador: nono.ok ? 'aceito-indevidamente' : nono.code, captureAutorizado: captureOk };
  }

  return { steps, metrics, ok: steps.every((s) => s.ok) };
}

// util

function round1(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : n;
}
function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : n;
}
function round3(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n;
}
