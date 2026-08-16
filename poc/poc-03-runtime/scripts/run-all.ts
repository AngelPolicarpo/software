/**
 * Harness do gate G0 — POC-03.
 *
 * Roda o ARTEFATO EMPACOTADO, nunca `electron .`: o critério de §3 POC-03 é explícito e
 * uma corrida em dev não conta. Cada cenário é um processo novo; este script só repete,
 * mata, cronometra e agrega.
 *
 *   POC03_PROFILE=quick  ~1 min, 10 cold starts   — para verificação
 *   POC03_PROFILE=full   o gate, 100 cold starts  — sobrescreve out/gate-G0/
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const PROFILE = process.env.POC03_PROFILE === 'full' ? 'full' : 'quick';
const OUT_DIR = path.join(ROOT, 'out', PROFILE === 'full' ? 'gate-G0' : 'gate-G0-quick');
const COLD_STARTS = PROFILE === 'full' ? 100 : 10;

const BIN = process.env.POC03_BIN ?? path.join(ROOT, 'release', 'linux-unpacked', 'poc-03-runtime');
const BIN_NOUNPACK = path.join(ROOT, 'release-nounpack', 'linux-unpacked', 'poc-03-runtime');

type RunResult = {
  scenario: string;
  verdict: string;
  totalMs: number;
  packaged: boolean;
  mainCrashed: boolean;
  childExits: { code: number; at: number }[];
  heartbeats: number;
  steps: { step: string; ok: boolean; ms: number; data?: unknown; error?: string }[];
  [k: string]: unknown;
};

type Run = { ok: boolean; exitCode: number | null; wallMs: number; result: RunResult | null; stderr: string };

function tmpData(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `poc03-${tag}-`));
}

function runOnce(scenario: string, opts: { bin?: string; dataDir?: string; timeoutMs?: number } = {}): Promise<Run> {
  const bin = opts.bin ?? BIN;
  const dataDir = opts.dataDir ?? tmpData(scenario);
  const resultPath = path.join(dataDir, 'result.json');
  const t0 = Date.now();

  return new Promise((resolve) => {
    const p = spawn(bin, ['--no-sandbox'], {
      env: { ...process.env, POC03_SCENARIO: scenario, POC03_DATA_DIR: dataDir, POC03_RESULT: resultPath },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    p.stderr.on('data', (b) => { stderr += String(b); });
    const killer = setTimeout(() => p.kill('SIGKILL'), opts.timeoutMs ?? 180_000);

    p.on('close', (code) => {
      clearTimeout(killer);
      let result: RunResult | null = null;
      try { result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as RunResult; } catch { /* sem resultado */ }
      resolve({ ok: code === 0 && result?.verdict === 'APROVADO', exitCode: code, wallMs: Date.now() - t0, result, stderr: stderr.slice(-2000) });
    });
  });
}

function pct(xs: number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

const criteria: { id: string; desc: string; ok: boolean; evidence: unknown }[] = [];
function record(id: string, desc: string, ok: boolean, evidence: unknown): void {
  criteria.push({ id, desc, ok, evidence });
  process.stdout.write(`  ${ok ? 'OK  ' : 'FALHA'}  ${id}  ${desc}\n`);
}

async function main(): Promise<void> {
  if (!fs.existsSync(BIN)) {
    process.stderr.write(`artefato empacotado não encontrado em ${BIN}\nrode: npm run build && npm run pack\n`);
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const t0 = Date.now();
  process.stdout.write(`POC-03 / gate G0 — perfil ${PROFILE}, ${COLD_STARTS} cold starts\nartefato: ${BIN}\n\n`);

  // --- C1: caminho funcional completo, empacotado ---------------------------------------
  const smoke = await runOnce('smoke');
  record('C1', 'caminho funcional completo no artefato empacotado', smoke.ok && smoke.result?.packaged === true, {
    verdict: smoke.result?.verdict, packaged: smoke.result?.packaged,
    passos: smoke.result?.steps.map((s) => ({ [s.step]: s.ok ? s.ms : s.error })),
  });

  // --- C2: cold start, p95 <= 4 s -------------------------------------------------------
  process.stdout.write(`  ... ${COLD_STARTS} cold starts\n`);
  const bootMs: number[] = [];
  const readyMs: number[] = [];
  let bootFails = 0;
  for (let i = 0; i < COLD_STARTS; i++) {
    const r = await runOnce('coldstart', { timeoutMs: 60_000 });
    if (!r.ok) bootFails++;
    else { bootMs.push(r.wallMs); readyMs.push(Number(r.result?.msToReady ?? 0)); }
  }
  const p95 = pct(bootMs, 95);
  record('C2', `p95 de boot <= 4000 ms (medido ${Math.round(p95)} ms)`, bootFails === 0 && p95 <= 4000, {
    corridas: COLD_STARTS, falhas: bootFails,
    bootWallMs: { min: Math.min(...bootMs), p50: pct(bootMs, 50), p95, max: Math.max(...bootMs) },
    coreReadyMs: { min: Math.min(...readyMs), p50: pct(readyMs, 50), p95: pct(readyMs, 95), max: Math.max(...readyMs) },
  });

  // --- C3: 10 000 appends, transações de 256 e 2 048, WAL e FTS5 ------------------------
  const bench = await runOnce('bench', { timeoutMs: 600_000 });
  const bStep = (n: string) => bench.result?.steps.find((s) => s.step === n);
  record('C3', '10 000 appends + transações 256/2048 + FTS5', bench.ok, {
    append: bStep('append.10000x256B')?.data, tx256: bStep('tx.256')?.data,
    tx2048: bStep('tx.2048')?.data, fts: bStep('fts.index')?.data,
  });

  // --- C4: crash por exceção nativa, main sobrevive -------------------------------------
  const cn = await runOnce('crash-native');
  record('C4', 'exceção nativa no núcleo não derruba o main', cn.ok && cn.result?.mainCrashed === false, {
    mainCrashed: cn.result?.mainCrashed, crash: cn.result?.steps.find((s) => s.step === 'crashNative')?.data,
  });

  // --- C5: SIGKILL do filho, restart e dado preservado ----------------------------------
  const ch = await runOnce('crash-hard');
  const reopened = ch.result?.reopened as { length?: number; keyHex?: string } | undefined;
  record('C5', 'SIGKILL do núcleo: main sobrevive, núcleo reergue, dado preservado',
    ch.ok && ch.result?.mainCrashed === false && (reopened?.length ?? 0) > 0, {
      mainCrashed: ch.result?.mainCrashed, childExits: ch.result?.childExits, aposReinicio: reopened,
    });

  // --- C6: três reinícios em 60 s sobre o MESMO diretório de dados ----------------------
  const shared = tmpData('restart');
  const restarts: { i: number; ok: boolean; wallMs: number; coreLength: unknown }[] = [];
  const tR = Date.now();
  for (let i = 0; i < 3; i++) {
    const r = await runOnce('smoke', { dataDir: shared, timeoutMs: 60_000 });
    restarts.push({ i, ok: r.ok, wallMs: r.wallMs, coreLength: (r.result?.steps.find((s) => s.step === 'openCore')?.data as { length?: number })?.length });
  }
  const restartWindow = Date.now() - tR;
  record('C6', `três reinícios sobre o mesmo dado em ${(restartWindow / 1000).toFixed(1)} s`,
    restarts.every((r) => r.ok) && restartWindow <= 60_000, { janelaMs: restartWindow, restarts });

  // --- C7: diretório de dados ocupado por outra instância -------------------------------
  // §3 POC-03 "arquivo de dados bloqueado". Duas instâncias no mesmo diretório: a segunda
  // precisa falhar com erro nomeado, não corromper nem ficar pendurada.
  const busyDir = tmpData('busy');
  const [a, b] = await Promise.all([runOnce('smoke', { dataDir: busyDir, timeoutMs: 90_000 }), runOnce('smoke', { dataDir: busyDir, timeoutMs: 90_000 })]);
  const umSo = (a!.ok ? 1 : 0) + (b!.ok ? 1 : 0) === 1;
  const perdedor = a!.ok ? b! : a!;
  record('C7', 'dois processos no mesmo diretório: exatamente um abre', umSo, {
    aOk: a!.ok, bOk: b!.ok,
    erroDoPerdedor: perdedor.result?.steps.find((s) => !s.ok)?.error ?? perdedor.stderr.split('\n').filter(Boolean).slice(-1)[0] ?? null,
  });

  // --- C8: addon dentro do asar (sem asarUnpack) ----------------------------------------
  let c8: unknown = 'variante não construída';
  let c8ok = false;
  if (fs.existsSync(BIN_NOUNPACK)) {
    const nu = await runOnce('smoke', { bin: BIN_NOUNPACK });
    const paths = (nu.result?.steps.find((s) => s.step === 'stat')?.data as { dlopenedAoFinal?: string[] })?.dlopenedAoFinal ?? [];
    c8ok = nu.ok;
    c8 = { verdict: nu.result?.verdict, extraidosParaTemp: paths.filter((p) => !p.includes('app.asar.unpacked')), total: paths.length };
  }
  record('C8', 'addon DENTRO do asar: Electron extrai para /tmp e carrega', c8ok, c8);

  // --- C10: as DUAS fronteiras, cada uma no seu MessageChannelMain -----------------------
  // Item de construção de §3 POC-03. A IPC-R sai do núcleo, atravessa o main e chega ao
  // renderer sem o main ler o tráfego: o `pid` que volta é o do núcleo, não o do main.
  const ipcr = await runOnce('smoke-ipcr');
  const rt = ipcr.result?.steps.find((s) => s.step === 'ipc-r.roundtrip')?.data as
    { reply?: { from?: string; pid?: number } } | undefined;
  record('C10', 'IPC-M e IPC-R separadas; renderer fala com o núcleo pela IPC-R',
    ipcr.ok && rt?.reply?.from === 'core', { respostaDoNucleo: rt?.reply ?? null });

  // --- C9: nenhum rebuild manual pós-empacotamento --------------------------------------
  const addonsBuild = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', 'gate-G0', 'addons-build.json'), 'utf8')) as {
    verdict: string; glibcFloor: string; aposCompilarNoContainer: { pkg: string; maxGlibc: string; verdict: string }[];
    prebuildsPublicadosNoNpm: { pkg: string; maxGlibc: string }[];
  };
  record('C9', `todo .node <= glibc ${addonsBuild.glibcFloor}, compilado no container, sem passo manual`,
    addonsBuild.verdict === 'APROVADO', {
      compilados: addonsBuild.aposCompilarNoContainer,
      seTivessemUsadoOsPrebuildsDoNpm: addonsBuild.prebuildsPublicadosNoNpm,
    });

  // --- C11: SBOM ---------------------------------------------------------------------------
  // §7 do plano: "G0 inclui SBOM, mas não auditoria de terceiros". O SBOM é artefato do
  // gate; a auditoria das dependências continua fora de escopo, e isso é declarado.
  const sbomPath = path.join(ROOT, 'out', 'gate-G0', 'sbom.cdx.json');
  let sbom: unknown = 'ausente — rode `npm run sbom`';
  let sbomOk = false;
  if (fs.existsSync(sbomPath)) {
    const s = JSON.parse(fs.readFileSync(sbomPath, 'utf8')) as { bomFormat?: string; specVersion?: string; components?: { name: string }[] };
    const nativos = (s.components ?? []).map((c) => c.name).filter((n) => /native|sqlite|sodium|udx|rocksdb/.test(n)).sort();
    sbomOk = s.bomFormat === 'CycloneDX' && (s.components?.length ?? 0) > 0;
    sbom = { formato: `${s.bomFormat} ${s.specVersion}`, componentes: s.components?.length, nativos, caminho: path.relative(ROOT, sbomPath) };
  }
  record('C11', 'SBOM CycloneDX das dependências de runtime', sbomOk, sbom);

  // --- artefato --------------------------------------------------------------------------
  const aprovado = criteria.every((c) => c.ok);
  const artifact = {
    poc: 'POC-03',
    gate: 'G0',
    veredito: aprovado ? 'APROVADO' : 'REPROVADO',
    perfil: PROFILE,
    alvo: `${process.platform}-${process.arch}`,
    limitacaoDeEvidencia: process.platform === 'linux' ? 'G0-E1 — alvo Linux validado em WSL2 (A16)' : null,
    executadoEm: new Date().toISOString(),
    duracaoMs: Date.now() - t0,
    artefato: BIN,
    electron: smoke.result?.steps.find((s) => s.step === 'core.ready')?.data,
    host: { glibc: null as string | null, kernel: os.release(), cpus: os.cpus().length, totalMemBytes: os.totalmem() },
    criterios: criteria,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'gate-G0.json'), JSON.stringify(artifact, null, 2));

  process.stdout.write(`\n${aprovado ? 'APROVADO' : 'REPROVADO'} — ${criteria.filter((c) => c.ok).length}/${criteria.length} critérios\n`);
  process.stdout.write(`artefato: ${path.join(OUT_DIR, 'gate-G0.json')}\n`);
  process.exit(aprovado ? 0 : 1);
}

void main();
