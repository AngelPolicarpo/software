import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform, arch, cpus, totalmem, hostname, release } from 'node:os';
import { createHash } from 'node:crypto';

const profile = (process.env.POC05_PROFILE ?? 'full') as 'quick' | 'full';
const outDir = join(process.cwd(), 'out', profile === 'full' ? 'gate-G3' : `gate-G3-${profile}`);

function sha256(p: string): string {
  try {
    return createHash('sha256').update(readFileSync(p)).digest('hex');
  } catch {
    return '<ausente>';
  }
}

// Roda o gate via core/test/invites-g3.test.ts + invites-helpers.test.ts
// O harness real com hyperdht/testnet fica para o gate empacotado; aqui provamos a hipótese com o mesmo fold/DS/admission de produto.
spawnSync('npm', ['run', 'build'], { cwd: join(process.cwd(), '../../core'), stdio: 'inherit' });
const res = spawnSync('node', ['--test', 'dist/test/invites-g3.test.js', 'dist/test/invites-helpers.test.js'], {
  cwd: join(process.cwd(), '../../core'),
  encoding: 'utf8',
  timeout: 120_000,
});

const ok = res.status === 0;
const output = (res.stdout ?? '') + '\n' + (res.stderr ?? '');

// Extrai contagem de cenários do TAP do core: 9 cenários em invites-g3 + 7 em helpers = 16, mas o gate conta 9 + delegated = 9 do harness
// Para o artefato, declaramos 4 cenários de alto nível (como em poc-07) que mapeiam para os 9 subtestes.
const scenarios = [
  { name: 'delegado por não-host (A08)', ok },
  { name: '100 convites por host e não-host', ok },
  { name: '10 concorrentes maxUses=1 → 1 ok (atomicidade)', ok },
  { name: 'replay liveProof/joinProof/challenge + R-10 + 6 desfechos', ok },
];

const veredito: 'confirmado' | 'invalidado' = ok ? 'confirmado' : 'invalidado';

mkdirSync(outDir, { recursive: true });
const artifact = {
  gate: 'G3',
  hypothesis: 'Convite delegado e consumo atômico (A08, POC-05)',
  profile,
  executedAt: new Date().toISOString(),
  host: hostname(),
  so: { platform: platform(), release: release(), arch: arch() },
  cpu: { model: cpus()[0]?.model ?? '?', cores: cpus().length },
  memGiB: +(totalmem() / 1024 ** 3).toFixed(1),
  runtime: { node: process.version },
  lockfile: { file: 'package-lock.json', sha256: sha256(join(process.cwd(), 'package-lock.json')) },
  coreLockfile: { file: '../../core/package-lock.json', sha256: sha256(join(process.cwd(), '../../core/package-lock.json')) },
  scenarios,
  veredito,
  criteria: {
    delegado: '100% dos convites delegados legítimos funcionam',
    atomic: '10 candidatos maxUses=1 → exatamente 1 entra, 9 E_INVITE_EXHAUSTED',
    replay: '0 replay aceito (liveProof amarra candidatePk, joinProof idempotente, challenge one-time)',
    preview: '6 desfechos alcançáveis (ok, banned, already-member, invalid, ended, unreachable)',
  },
  rawTap: output.slice(0, 8000),
  limitations: [
    'G4-E1 sem fsync (reusa §10.7.1) — só SIGKILL, não queda de energia',
    'rede in-memory via HostAdmission/Swarm — hyperdht/testnet real fica para gate empacotado (mesma ressalva de POC-01)',
  ],
};

writeFileSync(join(outDir, 'gate-G3.json'), JSON.stringify(artifact, null, 2), 'utf8');
console.log(`G3 ${profile}: ${veredito} — ${scenarios.filter((s) => s.ok).length}/${scenarios.length} cenários`);
console.log(output.slice(-2000));
if (!ok) process.exitCode = 1;
