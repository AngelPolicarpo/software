// Gate G8 — POC-09 (escopo executável em Node, sem rede externa).
// Uso: POC09_PROFILE=quick|full node dist/scripts/run-all.js
// O perfil full sobrescreve out/gate-G8/; quick escreve out/gate-G8-quick/.
//
// ATENÇÃO: este artefato NÃO fecha o gate G8. O plano exige Electron/Chromium empacotado
// (getDisplayMedia e RTCStatsReport reais com encoder de vídeo), tc/netem com uplink
// limitado, CGNAT e CPU do apresentador em alvo dedicado — critérios que só o gate
// empacotado cobre. Aqui se prova a camada de decisão (§17.4–§17.5, A19/A22) e a estrela
// WebRTC real com os módulos do core sobre portas simuladas.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch, cpus, totalmem, hostname, release } from 'node:os';
import { createHash } from 'node:crypto';

import { runScenarios } from '../src/scenarios.js';

const profile = ((process.env['POC09_PROFILE'] ?? 'full') as string) === 'quick' ? 'quick' : 'full';
const outDir = join(process.cwd(), 'out', profile === 'full' ? 'gate-G8' : 'gate-G8-quick');

function sha256(p: string): string {
  try {
    return createHash('sha256').update(readFileSync(p)).digest('hex');
  } catch {
    return '<ausente>';
  }
}

console.log(`POC-09 / gate G8 (escopo Node) — perfil ${profile}`);
const outcome = await runScenarios(profile);

for (const s of outcome.steps) {
  console.log(`  ${s.ok ? 'ok' : 'FALHOU'} — ${s.id} ${s.desc}`);
}

const veredito: 'parcial' | 'invalidado' = outcome.ok ? 'parcial' : 'invalidado';

mkdirSync(outDir, { recursive: true });
const artifact = {
  gate: 'G8',
  hypothesis:
    'Sessão de tela em estrela WebRTC com até 8 espectadores atende latência, perda e CPU declaradas, com qualidade por espectador funcionando e captura só após autorização (A19/A22, POC-09)',
  escopo: 'subconjunto executável em Node sem rede externa — NÃO fecha o gate',
  cobertura: [
    'camada de decisão share.start/§17.4 passo 1 + voice_share_screen; uma sessão por canal (E_ALREADY_SHARING); apresentador fora da chamada recusado (§17.5/A19)',
    'captureToken T-41: captura nunca autorizada sem token válido da sessão viva — forjado/sessão errada/expirado/encerrado recusados; tela via TURN recusada na decisão real (§17.3)',
    'teto SHARE_MAX_VIEWERS=8 aplicado pela decisão real: 9º espectador recebe E_SESSION_FULL; leave reabre vaga',
    'setQuality por espectador com {applied:true} na decisão e mudança de bitrate medida por receptor (perfis high/balanced/low simultâneos)',
    'degradação automática quando a saúde reporta perda > 3%: decisão core desce o perfil e o bitrate medido cai; vizinhos sem perda ficam estáveis',
    'estrela WebRTC real (werift): uma RTCPeerConnection por espectador; latência apresentador→espectador p50/p95 e perda medidas fim a fim em 2 e 8 espectadores',
    'sinalização gated por ticket Ed25519 nas duas pontas (A22 passos 3–4): ticket adulterado é recusado e DTLS nunca inicia',
    'entrada tardia com tempo ao 1º quadro; churn não afeta os demais espectadores',
    'ban do apresentador no meio da sessão: sweep deriva revogações e o tráfego cessa imediatamente (critério ≤ 5 s)',
    'STUN do host (MediaServer real) responde Binding RFC 5389 com XOR-MAPPED correto; lixo UDX atravessa para a pilha UDX (demux §17.3)',
  ],
  openCriteria: [
    'getDisplayMedia e RTCStatsReport reais no Chromium empacotado — aqui: werift em Node com mídia sintética dirigida por bomba (setParameters do werift não aplica maxBitrate)',
    'encoder de vídeo real (VP8/H264) e perfis de hardware declarados — aqui: pacotes ~1,1 kB em cadência de vídeo',
    'tc/netem com uplink do apresentador limitado (5/10/25 Mbps), CGNAT e churn agressivo — aqui: localhost sem impairment além da perda injetada determinística',
    'CPU ≤ 40% num alvo de referência dedicado — aqui: processo único hospeda host e todos os clientes (limite superior)',
    'share.health via RTCStatsReport do renderer do apresentador — aqui: saúde derivada de perda medida nos receptores',
  ],
  profile,
  executedAt: new Date().toISOString(),
  host: hostname(),
  so: { platform: platform(), release: release(), arch: arch() },
  cpu: { model: cpus()[0]?.model ?? '<desconhecido>', cores: cpus().length },
  memGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
  runtime: { node: process.version },
  lockfile: { file: 'package-lock.json', sha256: sha256(join(process.cwd(), 'package-lock.json')) },
  scenarios: outcome.steps.map((s) => ({ name: `${s.id} — ${s.desc}`, ok: s.ok })),
  metrics: outcome.metrics,
  veredito,
  criteriaMeasured: {
    teto: `9º espectador → E_SESSION_FULL na decisão real (SHARE_MAX_VIEWERS=${8})`,
    captura: 'nenhuma autorização de captura sem captureToken válido da sessão viva (T-41)',
    setQuality: 'mudança de bitrate mensurável por espectador, com dois perfis simultâneos',
    degradacao: 'perda > 3% reportada → perfil desce automaticamente e bitrate cai',
    ban: 'tráfego cessa imediatamente após ban do apresentador (≤ 5 s exigidos)',
    latencia: 'p95 apresentador→espectador medido fim a fim (critério ≤ 800 ms com 8 espectadores)',
  },
  limitations: [
    'implementações deste harness são experimentais e descartáveis — decisões se reaproveitam, código não',
    'mídia sintética: sem codec/encoder real; bitrate dirigido pela bomba do apresentador porque o werift aceita setParameters mas não aplica maxBitrate',
    'localhost sem NAT/netem: latência absoluta não equivale à rede real; matriz de NAT foi propriedade do G7',
    'CPU inclui todos os clientes no mesmo processo — limite superior do custo do apresentador',
    'saúde derivada de perda medida no receptor; RR/RTCStatsReport remoto do werift não expõe fractionLost como o Chromium',
  ],
};

writeFileSync(join(outDir, 'gate-G8.json'), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`artefato: ${join(outDir, 'gate-G8.json')} — veredito: ${veredito}`);
