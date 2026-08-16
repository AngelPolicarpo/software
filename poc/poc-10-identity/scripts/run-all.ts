/**
 * Harness do gate G10 — POC-10.
 *
 * Roda o ARTEFATO EMPACOTADO. A peça central é a varredura: o critério de aprovação exige
 * ZERO ocorrência da semente de identidade em disco não cifrado, em log ou em qualquer
 * quadro de IPC-R. Para procurar por um padrão de bytes é preciso conhecê-lo, então o
 * harness INJETA uma semente conhecida (`POC10_TEST_SEED`) e depois caça esses bytes.
 * O núcleo nunca a escreve; se ela aparecer, é vazamento de verdade.
 */
import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const PROFILE = process.env.POC10_PROFILE === 'full' ? 'full' : 'quick';
const OUT_DIR = path.join(ROOT, 'out', PROFILE === 'full' ? 'gate-G10' : 'gate-G10-quick');
const BIN = process.env.POC10_BIN ?? path.join(ROOT, 'release', 'linux-unpacked', 'poc-10-identity');

/** Backend do keystore no Linux. Sem isto o Electron autodetecta e, em WSL2, cai em
 *  `basic_text` — ver o achado registrado no REPORT. */
const SECRET_ENV = process.platform === 'linux' ? { XDG_CURRENT_DESKTOP: 'GNOME' } : {};

type Run = { ok: boolean; exitCode: number | null; wallMs: number; result: any; stdout: string; stderr: string };

function tmpData(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `poc10-${tag}-`));
}

function runOnce(scenario: string, o: {
  dataDir?: string; seedHex?: string; env?: Record<string, string>; args?: string[]; timeoutMs?: number; degraded?: boolean;
} = {}): Promise<Run> {
  const dataDir = o.dataDir ?? tmpData(scenario);
  const resultPath = path.join(dataDir, `result-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const t0 = Date.now();
  return new Promise((resolve) => {
    const p = spawn(BIN, ['--no-sandbox', ...(o.args ?? [])], {
      env: {
        ...process.env,
        ...(o.degraded ? { XDG_CURRENT_DESKTOP: '' } : SECRET_ENV),
        POC10_SCENARIO: scenario,
        POC10_DATA_DIR: dataDir,
        POC10_RESULT: resultPath,
        ...(o.seedHex ? { POC10_TEST_SEED: o.seedHex } : {}),
        ...(o.env ?? {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (b) => { stdout += String(b); });
    p.stderr.on('data', (b) => { stderr += String(b); });
    const killer = setTimeout(() => p.kill('SIGKILL'), o.timeoutMs ?? 120_000);
    p.on('close', (code) => {
      clearTimeout(killer);
      let result: any = null;
      try { result = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch { /* pode não existir */ }
      resolve({ ok: code === 0 && result?.verdict === 'APROVADO', exitCode: code, wallMs: Date.now() - t0, result, stdout, stderr });
    });
  });
}

/** Procura a semente em três codificações: crua, hex e base64. */
function findSeed(hay: Buffer | string, seed: Buffer): string[] {
  const buf = Buffer.isBuffer(hay) ? hay : Buffer.from(hay);
  const hits: string[] = [];
  if (buf.includes(seed)) hits.push('bytes-crus');
  const txt = buf.toString('latin1');
  if (txt.includes(seed.toString('hex'))) hits.push('hex');
  if (txt.includes(seed.toString('base64'))) hits.push('base64');
  return hits;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
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
  const seed = crypto.randomBytes(32);
  const seedHex = seed.toString('hex');
  process.stdout.write(`POC-10 / gate G10 — perfil ${PROFILE}\nartefato: ${BIN}\n\n`);

  // --- D1: identidade criada, assinada e RECUPERADA após reinício ------------------------
  const dir = tmpData('recover');
  const first = await runOnce('smoke', { dataDir: dir, seedHex });
  const second = await runOnce('smoke', { dataDir: dir, seedHex });
  const pk1 = first.result?.events?.find((e: any) => e.e === 'ready')?.identityPublicKeyHex;
  const pk2 = second.result?.events?.find((e: any) => e.e === 'ready')?.identityPublicKeyHex;
  const criada = first.result?.steps?.find((s: any) => s.step === 'boot')?.data?.created;
  const recriada = second.result?.steps?.find((s: any) => s.step === 'boot')?.data?.created;
  record('D1', 'identidade criada, e recuperada igual após reinício',
    first.ok && second.ok && !!pk1 && pk1 === pk2 && criada === true && recriada === false,
    { publicKeyPrimeiroBoot: pk1, publicKeySegundoBoot: pk2, criadaNoPrimeiro: criada, criadaNoSegundo: recriada, keystore: first.result?.keystore });

  // --- D2: a semente não aparece em disco, log nem quadro de IPC-R -----------------------
  const arquivos = walk(dir);
  const vazDisco = arquivos
    .filter((f) => !path.basename(f).startsWith('result-'))
    .map((f) => ({ arquivo: path.relative(dir, f), hits: findSeed(fs.readFileSync(f), seed) }))
    .filter((r) => r.hits.length > 0);
  const vazLog = [
    { fonte: 'stdout#1', hits: findSeed(first.stdout, seed) },
    { fonte: 'stderr#1', hits: findSeed(first.stderr, seed) },
    { fonte: 'stdout#2', hits: findSeed(second.stdout, seed) },
    { fonte: 'stderr#2', hits: findSeed(second.stderr, seed) },
  ].filter((r) => r.hits.length > 0);
  const quadros = [...(first.result?.ipcRFrames ?? []), ...(second.result?.ipcRFrames ?? [])];
  const vazIpcR = quadros.map((q, i) => ({ i, hits: findSeed(JSON.stringify(q), seed) })).filter((r) => r.hits.length > 0);
  record('D2', 'zero ocorrência da semente em disco, log e IPC-R',
    vazDisco.length === 0 && vazLog.length === 0 && vazIpcR.length === 0,
    { arquivosVarridos: arquivos.length, quadrosIpcRVarridos: quadros.length, vazamentoDisco: vazDisco, vazamentoLog: vazLog, vazamentoIpcR: vazIpcR });

  // --- D3: o identity.enc existe e NÃO é a semente em claro ------------------------------
  const encPath = path.join(dir, 'identity.enc');
  const enc = fs.existsSync(encPath) ? fs.readFileSync(encPath) : Buffer.alloc(0);
  record('D3', 'a semente em disco está cifrada, não em claro',
    enc.length > 0 && !enc.includes(seed),
    { bytes: enc.length, contemSementeCrua: enc.includes(seed), primeiros16Hex: enc.subarray(0, 16).toString('hex') });

  // --- D4: segunda instância nunca abre o núcleo -----------------------------------------
  const busy = tmpData('busy');
  const [a, b] = await Promise.all([runOnce('smoke', { dataDir: busy, seedHex }), runOnce('smoke', { dataDir: busy, seedHex })]);
  const abriram = [a, b].filter((r) => r.result?.events?.some((e: any) => e.e === 'ready')).length;
  const perdedor = a.ok ? b : a;
  // §10.8 tem DUAS barreiras e o gate precisa saber qual disparou:
  //   etapa 1 `requestSingleInstanceLock` — o main encerra em SILÊNCIO (regra 1), sem
  //           escrever resultado; o marcador no stdout é a única prova de que passou por ali.
  //   etapa 2 lock de arquivo — o núcleo chega a subir e recusa com E_CORE_ALREADY_RUNNING.
  const barradoNaEtapa1 = perdedor.stdout.includes('__POC10_SECOND_INSTANCE__');
  const erroEtapa2 = perdedor.result?.steps?.find((s: any) => !s.ok)?.error ?? null;
  record('D4', 'dois launches concorrentes: exatamente um abre o núcleo', abriram === 1, {
    aOk: a.ok, bOk: b.ok, nucleosAbertos: abriram,
    barradoEm: barradoNaEtapa1 ? 'etapa 1 — app.requestSingleInstanceLock (saída silenciosa)'
      : erroEtapa2 ? 'etapa 2 — lock de arquivo' : 'indeterminado',
    erroDaEtapa2: erroEtapa2,
  });

  // --- D5: lock órfão é quebrado ----------------------------------------------------------
  const orphan = tmpData('orphan');
  fs.mkdirSync(path.join(orphan, 'p2p'), { recursive: true });
  // PID que não existe: o lock ficou de um processo morto sem liberar o arquivo.
  fs.writeFileSync(path.join(orphan, 'p2p', 'LOCK'), JSON.stringify({ pid: 999_999, installId: 'de-outra-instalacao' }));
  const afterOrphan = await runOnce('smoke', { dataDir: orphan, seedHex });
  record('D5', 'lock órfão de PID morto não impede a abertura', afterOrphan.ok, {
    abriu: afterOrphan.ok, lockStatus: afterOrphan.result?.steps?.find((s: any) => s.step === 'lockStatus')?.data,
  });

  // --- D6: ordem exata das 4 etapas do lock (§10.8) ---------------------------------------
  const stages = first.result?.events?.find((e: any) => e.e === 'ready')?.lockStages;
  const esperada = ['app-instance', 'lock-file', 'corestore-rocksdb', 'sqlite'];
  record('D6', 'lock composto adquirido na ordem exata de §10.8',
    JSON.stringify(stages) === JSON.stringify(esperada), { esperada, observada: stages });

  // --- D7: wipe retoma de TODOS os estágios ------------------------------------------------
  const estagios = ['requested', 'swarm-down', 'cores-closed', 'view-deleted', 'manifest-deleted', 'key-wiped'];
  const wipes: { estagio: string; retomouEcompletou: boolean; detalhe: unknown }[] = [];
  for (const est of estagios) {
    const d = tmpData(`wipe-${est}`);
    await runOnce('smoke', { dataDir: d, seedHex });                        // cria identidade
    // O núcleo se mata nesse estágio de propósito; o main reporta `E_CORE_GONE` e encerra.
    // 30 s é folga larga para um cenário cujo desfecho esperado é a morte do filho.
    await runOnce('wipe', { dataDir: d, seedHex, env: { POC10_WIPE_CRASH_AT: est }, timeoutMs: 30_000 });
    const resume = await runOnce('smoke', { dataDir: d, seedHex });         // boot deve retomar
    const boot = resume.result?.steps?.find((s: any) => s.step === 'boot')?.data;
    const limpo = !fs.existsSync(path.join(d, 'p2p', 'WIPE'));
    wipes.push({ estagio: est, retomouEcompletou: resume.ok && limpo, detalhe: { wipeRetomado: boot?.wipeRetomado ?? null, sentinelaRemovida: limpo } });
  }
  record('D7', 'wipe retoma e completa a partir de todos os estágios', wipes.every((w) => w.retomouEcompletou), wipes);

  // --- D8: basic_text recusa abrir sem aceite explícito -------------------------------------
  const insecure = await runOnce('insecure-refuse', { seedHex, degraded: true });
  record('D8', 'keystore degradado recusa abrir sem aceite (E_KEYSTORE_INSECURE)', insecure.ok, {
    backend: insecure.result?.keystore, observado: insecure.result?.steps?.find((s: any) => s.step === 'boot.sem.aceite')?.data,
  });

  // --- D9: export/import com frase certa e errada -------------------------------------------
  const ei = await runOnce('export-import', { seedHex });
  const errada = ei.result?.steps?.find((s: any) => s.step === 'import.frase.errada')?.data;
  const certa = ei.result?.steps?.find((s: any) => s.step === 'import.frase.certa')?.ok;
  record('D9', 'export/import: frase errada recusa, frase certa restaura', ei.ok && errada?.recusou === true && certa === true,
    { fraseErrada: errada, fraseCerta: certa, pkAposImport: ei.result?.steps?.find((s: any) => s.step === 'identityRead.apos.import')?.data });

  // --- D10: gramática fechada do deep link (§3.5) --------------------------------------------
  const dl = await runOnce('deeplink', { seedHex });
  const parse = dl.result?.steps?.find((s: any) => s.step === 'deeplink.parse')?.data;
  record('D10', 'deep link: só a gramática de §3.5 é aceita', dl.ok && parse?.aceitos === 1 && parse?.recusados === 3, parse);

  // --- artefato -------------------------------------------------------------------------------
  const aprovado = criteria.every((c) => c.ok);
  const artifact = {
    poc: 'POC-10', gate: 'G10',
    veredito: aprovado ? 'APROVADO' : 'REPROVADO',
    perfil: PROFILE,
    alvo: `${process.platform}-${process.arch}`,
    limitacaoDeEvidencia: process.platform === 'linux' ? 'G0-E1 — alvo Linux validado em WSL2 (A16)' : null,
    executadoEm: new Date().toISOString(),
    duracaoMs: Date.now() - t0,
    artefato: BIN,
    keystore: first.result?.keystore,
    criterios: criteria,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'gate-G10.json'), JSON.stringify(artifact, null, 2));
  process.stdout.write(`\n${aprovado ? 'APROVADO' : 'REPROVADO'} — ${criteria.filter((c) => c.ok).length}/${criteria.length} critérios\n`);
  process.stdout.write(`artefato: ${path.join(OUT_DIR, 'gate-G10.json')}\n`);
  process.exit(aprovado ? 0 : 1);
}

void main();
