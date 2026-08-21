// Gate G5 — POC-06: ownership e caminho de escrita de anexos.
// Uso: POC06_PROFILE=quick|full node dist/scripts/run-all.js
// O perfil full sobrescreve out/gate-G5/; quick escreve out/gate-G5-quick/.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch, cpus, totalmem, hostname, release } from 'node:os';
import { createHash } from 'node:crypto';

import { runHarness, type Profile } from '../src/harness.js';

const profile = ((process.env['POC06_PROFILE'] ?? 'full') as Profile) === 'quick' ? 'quick' : 'full';
const outDir = join(process.cwd(), 'out', profile === 'full' ? 'gate-G5' : 'gate-G5-quick');

function sha256(p: string): string {
  try {
    return createHash('sha256').update(readFileSync(p)).digest('hex');
  } catch {
    return '<ausente>';
  }
}

// O código de produto precisa estar fresco: build do core inclui a barreira de camadas (§4).
console.log('G5 — build do core (tsc + check-layers)...');
const build = spawnSync('npm', ['run', 'build'], { cwd: join(process.cwd(), '..', '..', 'core'), stdio: 'inherit' });
if (build.status !== 0) {
  console.error('build do core falhou — gate abortado');
  process.exit(1);
}

console.log(`POC-06 / gate G5 — perfil ${profile}`);
const result = await runHarness(profile);

const scenarios = result.steps.map((s) => ({ name: `${s.id} — ${s.desc}`, ok: s.ok }));
const veredito: 'confirmado' | 'invalidado' = result.ok ? 'confirmado' : 'invalidado';

mkdirSync(outDir, { recursive: true });
const artifact = {
  gate: 'G5',
  hypothesis: 'Ownership e caminho de escrita de anexos (A09; ticket de A15; POC-06)',
  profile,
  executedAt: new Date().toISOString(),
  host: hostname(),
  so: { platform: platform(), release: release(), arch: arch() },
  cpu: { model: cpus()[0]?.model ?? '?', cores: cpus().length },
  memGiB: +(totalmem() / 1024 ** 3).toFixed(1),
  runtime: { node: process.version },
  lockfile: { file: 'package-lock.json', sha256: sha256(join(process.cwd(), 'package-lock.json')) },
  coreLockfile: { file: '../../core/package-lock.json', sha256: sha256(join(process.cwd(), '..', '..', 'core', 'package-lock.json')) },
  coreHead: sha256(join(process.cwd(), '..', '..', 'core', 'src', 'l2', 'blobs', 'index.ts')),
  scenarios,
  metrics: result.metrics,
  veredito,
  criteria: {
    ownership: 'nenhum membro escreve em core sem a chave dele (E_NO_BLOBS_KEY); chave derivada por (identitySeed, communityId)',
    controlRpcBytes: 'bytes de anexo atravessando o RPC de controle = 0 (8 fatias de 48 B buscadas em todos os envelopes)',
    hashCycles: 'blob recuperado com hash correto em 100% dos ciclos de stage/download',
    sizeAttack: 'ataque de tamanho abortado no leitor (E_BLOB_CORRUPT/size), estado corrupt nomeado',
    resume: 'retomada após crash em 100% dos ciclos; origem sumida → failed/E_FILE_UNREADABLE',
    submitP95: 'p95 de submitOp ≤ 250 ms durante o upload nominal (outbox real sobre manifest.db)',
    pathSurface: 'renderer não consegue fornecer caminho em nenhum caminho de código (stage aceita só ticketId; TicketIssue sem path)',
    ticket: 'ticket 16 bytes, TTL 15 min, uso único (um stage bem-sucedido), escopo comunidade+caminho',
  },
  limitations: [
    'hyperdht/testnet e Hyperblobs reais ficam para o gate empacotado (mesma ressalva de POC-01/G3); replicação sparse e backpressure de rede não exercitados',
    'arquivos de 1 GiB/8 GiB do plano substituídos por amostras determinísticas até 32 MiB neste ambiente; throughput/disco completos ficam para o gate empacotado',
    'IPC-M/Electron real não exercitado: ticket emitido pela mesma superfície do main (§15.7) no processo; renderer fora do circuito',
    'p95 medido com host in-memory ack imediato — sem latência de rede; o teto §26.1 continua provisório até G9',
  ],
};

writeFileSync(join(outDir, 'gate-G5.json'), JSON.stringify(artifact, null, 2), 'utf8');
const passed = scenarios.filter((s) => s.ok).length;
console.log(`G5 ${profile}: ${veredito} — ${passed}/${scenarios.length} cenários`);
for (const s of result.steps) {
  if (!s.ok) console.log(`  FALHA ${s.id}: ${s.error ?? '?'}`);
}
if (!result.ok) process.exitCode = 1;
