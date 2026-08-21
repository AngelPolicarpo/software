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
import { runNetHarness } from '../src/net-harness.js';

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
const net = await runNetHarness(profile);

const scenarios = [
  ...result.steps.map((s) => ({ name: `${s.id} — ${s.desc}`, ok: s.ok })),
  ...net.steps.map((s) => ({ name: `${s.id} — ${s.desc}`, ok: s.ok })),
];
const allOk = result.ok && net.ok;
const veredito: 'parcial' | 'invalidado' = allOk ? 'parcial' : 'invalidado';

mkdirSync(outDir, { recursive: true });
const artifact = {
  gate: 'G7',
  hypothesis: 'STUN/TURN na mesma socket UDP do UDX com demux correto; autorização de mídia por ticket do host (A17/A21/A22, POC-08)',
  escopo: 'subconjunto executável em Node sem rede externa — NÃO fecha o gate',
  cobertura: [
    'demultiplexação STUN/UDX em socket compartilhada sobre corpus UDX REAL (udx-native) e STUN sintético/adversarial — critério "100% dos pacotes de teste" do plano',
    'responder STUN RFC 5389 (Binding) com XOR-MAPPED-ADDRESS correto sob carga mista em socket única',
    'servidor TURN RFC 5766 (Allocate/Refresh/CreatePermission/Send/Data/ChannelBind) na MESMA socket, com credencial long-term RFC 5389 §10.2',
    'matriz de conexão ICE com WebRTC real (werift): pares conectam direta ou via TURN do host através de NAT user-space (full-cone/port-restricted/symmetric) com perda e atraso injetados — critério ≥95%',
    'mídia sintética 160 B @ 20 ms pelo caminho TURN sob impairment: RTT p95 e perda medidas fim a fim',
    'relay malicioso instrumentado: captura todo byte relayado; known-plaintext nunca encontra payload em claro (DTLS cifra ponta a ponta)',
    'tickets de mídia A22/§17.4: assinatura Ed25519, escopo sessão/canal/par, expiração TTL 5 min, forjado/adulterado recusado, revogação ≤ 5 s medida com tráfego real',
    'controles TURN §17.3: credencial amarrada ao par, TURN_ALLOC_PER_MEMBER=2, refresh, permissão só roster, tela via TURN recusada',
    'CPU do processo servindo STUN/TURN com pares simultâneos em cadência de voz (limite superior — clientes no mesmo processo)',
  ],
  openCriteria: [
    'NAT de kernel/netns + tc/netem (aqui: emulador user-space com semântica RFC 4787) e CGNAT real',
    'codec de voz real (Opus) e RTCPeerConnection do renderer Electron empacotado — aqui: werift em Node com payload sintético em cadência RTP',
    'CPU ≤20% na escala de referência com host dedicado (aqui: limite superior com clientes no mesmo processo)',
    'demux/tickets no utilityProcess do produto (fase 7 implementada)',
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
  metrics: { ...result.metrics, ...net.metrics },
  veredito,
  criteriaMeasured: {
    demux: 'nenhum datagrama UDX real interpretado como STUN; nenhum STUN válido perdido; concordância 100% entre duas implementações independentes da regra §17.3',
    coexistencia: 'zero desvios de rota sob carga mista em socket única; porta mapeada correta em 100% das respostas',
    matrizNAT: 'pares WebRTC reais conectam (direto ou via TURN do host) através de NATs user-space com perda/atraso injetados — taxa ≥95% exigida',
    midia: 'RTT p95 e perda de fluxo 160 B @ 20 ms medidos fim a fim pelo caminho TURN sob impairment',
    relayCego: 'relay captura 100% dos bytes e known-plaintext nunca encontra payload — propriedade medida, não afirmada',
    revogacao: 'tráfego cessa ≤ 5 s após voice.revoked com sessão real ativa',
    tickets: 'sinalização sem ticket válido é sempre recusada (A22 passo 3); pior caso MEDIA_TICKET_TTL_MS=5 min',
    turn: 'credencial expirada/adulterada/de terceiro recusada; limite de alocação e tela-recusada aplicados',
  },
  limitations: [
    'implementações deste harness são experimentais e descartáveis — não são código de produto; a fase 7 segue §17 depois do gate completo',
    'NAT user-space com semântica RFC 4787 (mapeamento/filtragem por modelo); NAT de kernel, netem e CGNAT real ficam para o gate empacotado',
    'injeção de atraso limitada a 20 ms por perna e sem reordenação (fila FIFO): acima disso os temporizadores internos da pilha WebRTC de teste (RTO 50 ms) reprovam o handshake; atrasos maiores ficam para netem de kernel',
    'perda injetada na fase de mídia (pós-estabelecimento) — estabelecimento sob perda simultânea fica para netem de kernel',
    'mídia sintética em cadência RTP sobre DTLS/SCTP do werift; codec Opus e SRTP nativo do Chromium ficam para o gate empacotado',
    'CPU medida inclui os clientes no mesmo processo — limite superior; medida dedicada do host fica para o gate empacotado',
    'corpus UDX capturado de pares udx-native locais; tráfego de produção (hyperdht) pode variar em tamanho/distribuição',
  ],
};

writeFileSync(join(outDir, 'gate-G7.json'), JSON.stringify(artifact, null, 2), 'utf8');
const passed = scenarios.filter((s) => s.ok).length;
console.log(`G7 ${profile}: ${veredito} — ${passed}/${scenarios.length} cenários do escopo executável`);
for (const s of [...result.steps, ...net.steps]) {
  if (!s.ok) {
    console.log(`  FALHA ${s.id}: ${s.error ?? '?'}`);
    if (s.evidence !== undefined) console.log(`    evidência: ${JSON.stringify(s.evidence)}`);
  }
}
if (!result.ok) process.exitCode = 1;
