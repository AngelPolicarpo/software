// Gate G11 — POC-11: superfície de decodificador de anexo (allowlist §13.6 + §8.6 sob fuzzing).
// Uso: POC11_PROFILE=quick|full node --expose-gc dist/scripts/run-all.js
// O perfil full (≥3×10⁵ casos) sobrescreve out/gate-G11/; quick (1×10⁵) escreve out/gate-G11-quick/.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch, cpus, totalmem, hostname, release } from 'node:os';
import { createHash } from 'node:crypto';

import { runFuzz, type Profile } from '../src/fuzz.js';

const profile = ((process.env['POC11_PROFILE'] ?? 'full') as Profile) === 'quick' ? 'quick' : 'full';
const outDir = join(process.cwd(), 'out', profile === 'full' ? 'gate-G11' : 'gate-G11-quick');

function sha256(p: string): string {
  try {
    return createHash('sha256').update(readFileSync(p)).digest('hex');
  } catch {
    return '<ausente>';
  }
}

// O código de produto precisa estar fresco: build do core inclui a barreira de camadas (§4).
console.log('G11 — build do core (tsc + check-layers)...');
const build = spawnSync('npm', ['run', 'build'], { cwd: join(process.cwd(), '..', '..', 'core'), stdio: 'inherit' });
if (build.status !== 0) {
  console.error('build do core falhou — gate abortado');
  process.exit(1);
}

console.log(`POC-11 / gate G11 — perfil ${profile}`);
const result = await runFuzz(profile);

const veredito: 'confirmado' | 'invalidado' = result.ok ? 'confirmado' : 'invalidado';
mkdirSync(outDir, { recursive: true });
const artifact = {
  gate: 'G11',
  hypothesis: 'Superfície de decodificador de anexo: allowlist §13.6 e limites de nome §8.6 não abrem exceção nem entregam tipo perigoso (POC-11, T-17/T-48/DR-41)',
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
  totalCases: result.totalCases,
  byCategory: result.byCategory,
  crashes: result.crashes,
  violations: result.violations,
  violationSamples: result.violationSamples,
  filesystemSampling: {
    sampled: result.fsSampled,
    rejectedAtTicket: result.fsRejectedAtTicket,
    staged: result.fsStaged,
    note: 'a cada 200 casos: nome inválido deve ser recusado no ticket (E_VALIDATION) sem tocar o disco; nome válido passa por ticket→stage→canReveal e não escapa do dataDir',
  },
  memory: result.memory,
  criteria: {
    zeroCrash: 'nenhuma função de decisão lança em nenhum caso (I0)',
    allowlist: 'nenhum arquivo fora da allowlist é revelável — executáveis bloqueados até para reveal, qualquer kind declarado (I2/I3)',
    nomes86: 'nenhum nome rejeitável de §8.6 chega ao filesystem — oráculo independente + recusa E_VALIDATION no ticket (I1/FS)',
    inline: 'renderização inline restrita a png/jpg/jpeg/gif/webp (I4); tabela kind×ext coerente com §13.6 (I5)',
    memoria: 'heap retorna a baseline + tolerância após GC (--expose-gc)',
  },
  veredito,
  limitations: [
    'decodificadores reais do Chromium (renderer empacotado com sandbox:true e CSP final) não exercitados neste harness — a superfície validada é a decisão de allowlist/quarentena §13.6 e os limites de nome §8.6 em código de produto; fuzzing do decoder empacotado fica para o gate empacotado',
    'marca de origem: no Linux alvo deste run nenhuma é aplicada por ausência de mecanismo padrão (§13.6 regra 3 — tratado como ausência de defesa, não defesa silenciosa); Zone.Identifier fica para o alvo Windows',
    'fuzzing determinístico com semente fixa (20260821); cobertura de mutação guiada por formato não substitui AFL/libFuzzer sobre o binário empacotado',
  ],
};

writeFileSync(join(outDir, 'gate-G11.json'), JSON.stringify(artifact, null, 2), 'utf8');
console.log(
  `G11 ${profile}: ${veredito} — ${result.totalCases.toLocaleString('pt-BR')} casos, ${result.crashes} crashes, ` +
    `${Object.values(result.violations).reduce((s, n) => s + n, 0)} violações, FS amostrado ${result.fsSampled} (${result.fsRejectedAtTicket} recusados no ticket, ${result.fsStaged} staged), ${result.ms} ms`,
);
for (const s of result.violationSamples) console.log(`  ${s}`);
if (!result.ok) process.exitCode = 1;
