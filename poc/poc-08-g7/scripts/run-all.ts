// Gate G7 — POC-08 (escopo executável em Node, sem rede externa).
// Uso: POC08_PROFILE=quick|full node dist/scripts/run-all.js
// O perfil full sobrescreve out/gate-G7/; quick escreve out/gate-G7-quick/.
//
// ATENÇÃO: este artefato NÃO fecha o gate G7. O plano exige matriz de NAT com netem,
// RTCPeerConnection real e relay malicioso instrumentado — critérios que só o gate
// empacotado cobre. Aqui se prova o primeiro item de §17.3 ("demultiplexação STUN/UDX
// numa socket compartilhada") e as decisões de autorização A22/§17.3.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch, cpus, totalmem, hostname, release } from 'node:os';
import { createHash } from 'node:crypto';

import { runHarness, type Profile } from '../src/harness.js';

const profile = ((process.env['POC08_PROFILE'] ?? 'full') as Profile) === 'quick' ? 'quick' : 'full';
const outDir = join(process.cwd(), 'out', profile === 'full' ? 'gate-G7' : 'gate-G7-quick');

function sha256(p: string): string {
  try {
    return createHash('sha256').update(readFileSync(p)).digest('hex');
  } catch {
    return '<ausente>';
  }
}

console.log(`POC-08 / gate G7 (escopo Node) — perfil ${profile}`);
const result = await runHarness(profile);

const scenarios = result.steps.map((s) => ({ name: `${s.id} — ${s.desc}`, ok: s.ok }));
const veredito: 'parcial' | 'invalidado' = result.ok ? 'parcial' : 'invalidado';

mkdirSync(outDir, { recursive: true });
const artifact = {
  gate: 'G7',
  hypothesis: 'STUN/TURN na mesma socket UDP do UDX com demux correto; autorização de mídia por ticket do host (A17/A21/A22, POC-08)',
  escopo: 'subconjunto executável em Node sem rede externa — NÃO fecha o gate',
  cobertura: [
    'demultiplexação STUN/UDX em socket compartilhada sobre corpus UDX REAL (udx-native) e STUN sintético/adversarial — critério "100% dos pacotes de teste" do plano',
    'responder STUN RFC 5389 (Binding) com XOR-MAPPED-ADDRESS correto sob carga mista em socket única',
    'tickets de mídia A22/§17.4: assinatura Ed25519, escopo sessão/canal/par, expiração TTL 5 min, forjado/adulterado recusado, revogação ≤ 5 s e pior caso TTL',
    'controles TURN §17.3: credencial HMAC de curta duração amarrada ao par, TURN_ALLOC_PER_MEMBER=2, refresh, permissão só roster, tela via TURN recusada',
  ],
  openCriteria: [
    'taxa de conexão direta ≥ 95% por classe de NAT (full-cone, port-restricted, symmetric, CGNAT) com tc/netem',
    'áudio p95 ≤ 250 ms e perda < 1% no caminho TURN com RTCPeerConnection real',
    'relay malicioso não lê payload — inspeção de captura com DTLS-SRTP real',
    'ban encerra sessão em ≤ 5 s em rede real (aqui: decisão de fechamento no nível de cliente)',
    'CPU do host ≤ 20% servindo STUN/TURN na escala de referência (aqui: sinal precoce em localhost)',
    'demux e tickets no Electron empacotado com utilityProcess',
  ],
  profile,
  executedAt: new Date().toISOString(),
  host: hostname(),
  so: { platform: platform(), release: release(), arch: arch() },
  cpu: { model: cpus()[0]?.model ?? '?', cores: cpus().length },
  memGiB: +(totalmem() / 1024 ** 3).toFixed(1),
  runtime: { node: process.version },
  lockfile: { file: 'package-lock.json', sha256: sha256(join(process.cwd(), 'package-lock.json')) },
  scenarios,
  metrics: result.metrics,
  veredito,
  criteriaMeasured: {
    demux: 'nenhum datagrama UDX real interpretado como STUN; nenhum STUN válido perdido; concordância 100% entre duas implementações independentes da regra §17.3',
    coexistencia: 'zero desvios de rota sob carga mista em socket única; porta mapeada correta em 100% das respostas',
    tickets: 'sinalização sem ticket válido é sempre recusada (A22 passo 3); revogação fecha imediatamente; pior caso MEDIA_TICKET_TTL_MS=5 min',
    turn: 'credencial expirada/adulterada/de terceiro recusada; limite de alocação e tela-recusada aplicados',
  },
  limitations: [
    'implementações deste harness são experimentais e descartáveis — não são código de produto; a fase 7 segue §17 depois do gate completo',
    'rede limitada a localhost: nenhuma classe de NAT, sem perda/atraso (netem), sem CGNAT — os critérios de rede do plano ficam para o gate empacotado',
    'sem RTCPeerConnection/DTLS-SRTP: a propriedade "relay cego" é aqui consequência de desenho (TURN encaminha opaco), não medida contra relay malicioso real',
    'CPU medida é do processo Node em localhost — sinal precoce, não o orçamento de 20% do cenário nominal',
    'corpus UDX capturado de pares udx-native locais; tráfego de produção (hyperdht) pode variar em tamanho/distribuição',
  ],
};

writeFileSync(join(outDir, 'gate-G7.json'), JSON.stringify(artifact, null, 2), 'utf8');
const passed = scenarios.filter((s) => s.ok).length;
console.log(`G7 ${profile}: ${veredito} — ${passed}/${scenarios.length} cenários do escopo executável`);
for (const s of result.steps) {
  if (!s.ok) console.log(`  FALHA ${s.id}: ${s.error ?? '?'}`);
}
if (!result.ok) process.exitCode = 1;
