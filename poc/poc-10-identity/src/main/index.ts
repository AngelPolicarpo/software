/**
 * Processo main do POC-10 — gate G10.
 *
 * O main é ORÁCULO, não guardião: embrulha e desembrulha a Data Key com `safeStorage` e
 * nada mais (A13). Ele nunca vê a chave de identidade — não há caminho no código para isso.
 *
 * Também é dele a etapa 1 do lock composto (§10.8) e o parse do deep link (§3.5).
 */
import { app, BrowserWindow, MessageChannelMain, safeStorage, utilityProcess, type UtilityProcess } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { CoreCommand, CoreEvent, CoreOut, CoreReply, CoreToMain, DeepLink, WithoutId } from '../protocol/messages.js';

const SCENARIO = process.env.POC10_SCENARIO ?? 'smoke';
const RESULT_PATH = process.env.POC10_RESULT ?? '';
const T0 = Date.now();

type Step = { step: string; ok: boolean; ms: number; data?: unknown; error?: string };
class FinishSignal extends Error {}

const steps: Step[] = [];
const events: CoreEvent[] = [];
/** Todo quadro que passou pela IPC-R, guardado cru para a varredura de material de chave. */
const ipcRFrames: unknown[] = [];
const deepLinks: { raw: string; parsed: DeepLink | null }[] = [];
let child: UtilityProcess | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let singleInstance = true;
let secondInstanceForwards = 0;
const coreExits: { code: number; at: number }[] = [];

function finish(verdict: 'APROVADO' | 'REPROVADO', extra: Record<string, unknown> = {}): never {
  const out = {
    scenario: SCENARIO,
    verdict,
    totalMs: Date.now() - T0,
    packaged: app.isPackaged,
    keystore: keystoreInfo(),
    singleInstance,
    secondInstanceForwards,
    coreExits,
    deepLinks,
    // A varredura de G10 precisa dos quadros como eles foram; resumir aqui seria fraudar
    // o próprio critério.
    ipcRFrames,
    events,
    steps,
    ...extra,
  };
  const text = JSON.stringify(out, null, 2);
  if (RESULT_PATH) {
    fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true });
    fs.writeFileSync(RESULT_PATH, text);
  }
  process.stdout.write(`__POC10_RESULT__${JSON.stringify(out)}\n`);
  app.exit(verdict === 'APROVADO' ? 0 : 1);
  throw new FinishSignal('finish');
}

function keystoreInfo(): { available: boolean; backend: string } {
  let backend = 'n/a';
  try { backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform; } catch { backend = 'erro'; }
  return { available: safeStorage.isEncryptionAvailable(), backend };
}

/** §3.5(1): gramática fechada. O que não casar exatamente é descartado sem processamento. */
const RE_JOIN = /^comunidadep2p:\/\/join\/([0-9A-HJKMNP-TV-Z]{16})$/;
const RE_MSG = /^comunidadep2p:\/\/m\/([A-Za-z0-9_-]{86})$/;

function parseDeepLink(raw: string): DeepLink | null {
  const j = RE_JOIN.exec(raw);
  if (j) return { route: 'join', code: j[1]! };
  const m = RE_MSG.exec(raw);
  if (m) return { route: 'm', ref: m[1]! };
  return null;
}

function handleDeepLink(raw: string): void {
  const parsed = parseDeepLink(raw);
  deepLinks.push({ raw, parsed });
  if (!parsed) { process.stdout.write(`deeplink.rejected ${raw}\n`); return; }
  // §3.5(2): ao núcleo vai o dado estruturado, nunca a string original.
  // §3.5(3): deep link nunca dispara ação — aqui ele só seria posicionamento de UI.
  child?.postMessage({ kind: 'deeplink', parsed });
}

function spawnCore(): UtilityProcess {
  const c = utilityProcess.fork(path.join(__dirname, '..', 'core', 'index.js'), [], {
    serviceName: 'poc10-core',
    stdio: 'pipe',
    env: { ...process.env, POC10_DATA_DIR: dataDir() },
  });
  c.stdout?.on('data', (b: Buffer) => process.stdout.write(`[core:out] ${b}`));
  c.stderr?.on('data', (b: Buffer) => process.stderr.write(`[core:err] ${b}`));

  c.on('message', (m: CoreOut) => {
    // Pedidos do núcleo ao oráculo (A13): a ÚNICA coisa que o main faz com material
    // criptográfico é embrulhar e desembrulhar a Data Key.
    if ('q' in m) { void answerOracle(m as CoreToMain); return; }
    if ('e' in m) { events.push(m as CoreEvent); return; }
    const rep = m as CoreReply;
    const p = pending.get(rep.id);
    if (!p) return;
    pending.delete(rep.id);
    if (rep.r === 'ok') p.resolve(rep.data);
    else p.reject(Object.assign(new Error(rep.message), { code: rep.code }));
  });

  // Sem isto, uma injeção de falha que mata o núcleo deixa o comando pendente esperando o
  // timeout inteiro. Nos seis estágios de wipe de §18.6 isso somava minutos de espera por
  // uma resposta que nunca vem — o cenário existe justamente para o núcleo morrer.
  c.on('exit', (code: number) => {
    coreExits.push({ code, at: Date.now() - T0 });
    for (const [, p] of pending) p.reject(Object.assign(new Error(`núcleo saiu com código ${code}`), { code: 'E_CORE_GONE' }));
    pending.clear();
  });
  return c;
}

async function answerOracle(q: CoreToMain): Promise<void> {
  try {
    if (q.q === 'keystoreInfo') {
      const k = keystoreInfo();
      child!.postMessage({ a: 'keystoreInfo', id: q.id, available: k.available, backend: k.backend });
    } else if (q.q === 'wrapDataKey') {
      const wrapped = safeStorage.encryptString(q.dataKeyB64);
      child!.postMessage({ a: 'wrapDataKey', id: q.id, wrappedB64: wrapped.toString('base64') });
    } else {
      const plain = safeStorage.decryptString(Buffer.from(q.wrappedB64, 'base64'));
      child!.postMessage({ a: 'unwrapDataKey', id: q.id, dataKeyB64: plain });
    }
  } catch (err) {
    child!.postMessage({ a: 'error', id: q.id, code: 'E_KEYSTORE', message: (err as Error).message });
  }
}

function dataDir(): string {
  return process.env.POC10_DATA_DIR ?? path.join(app.getPath('userData'), 'data');
}

function send(cmd: WithoutId<CoreCommand>, timeoutMs = 60_000): Promise<unknown> {
  const id = nextId++;
  return new Promise<unknown>((resolve, reject) => {
    const t = setTimeout(() => { if (pending.delete(id)) reject(new Error(`timeout em ${cmd.c}`)); }, timeoutMs);
    pending.set(id, {
      resolve: (v) => { clearTimeout(t); resolve(v); },
      reject: (e) => { clearTimeout(t); reject(e); },
    });
    child!.postMessage({ ...cmd, id });
  });
}

async function step(name: string, fn: () => Promise<unknown>): Promise<unknown> {
  const t = Date.now();
  try {
    const data = await fn();
    steps.push({ step: name, ok: true, ms: Date.now() - t, data });
    return data;
  } catch (err) {
    steps.push({ step: name, ok: false, ms: Date.now() - t, error: (err as Error).message });
    throw err;
  }
}

/** Exercita a IPC-R para que a varredura tenha quadros reais para inspecionar. */
async function exerciseIpcR(): Promise<unknown> {
  const ch = new MessageChannelMain();
  child!.postMessage({ kind: 'ipc-r-port' }, [ch.port1]);
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'renderer', 'preload.js'), sandbox: false } });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.postMessage('poc10:ipc-r', null, [ch.port2]);
  const frames = (await win.webContents.executeJavaScript('window.__poc10Exercise()')) as unknown[];
  ipcRFrames.push(...frames);
  win.destroy();
  return { quadros: frames.length };
}

async function run(): Promise<void> {
  child = spawnCore();

  if (SCENARIO === 'insecure-refuse') {
    // A13(5): sem aceite, o núcleo recusa abrir em keystore degradado.
    const r = await step('boot.sem.aceite', async () => {
      try { await send({ c: 'boot' }); return { recusou: false }; }
      catch (e) { return { recusou: true, code: (e as { code?: string }).code, message: (e as Error).message }; }
    });
    const rec = r as { recusou: boolean; code?: string };
    const esperaRecusa = !safeStorage.isEncryptionAvailable() || keystoreInfo().backend === 'basic_text';
    finish(rec.recusou === esperaRecusa && (!esperaRecusa || rec.code === 'E_KEYSTORE_INSECURE') ? 'APROVADO' : 'REPROVADO',
      { esperaRecusa, observado: rec });
  }

  await step('boot', () => send({ c: 'boot' }));
  await step('identityRead', () => send({ c: 'identityRead' }));
  await step('identitySign', () => send({ c: 'identitySign', message: 'gate G10' }));
  await step('lockStatus', () => send({ c: 'lockStatus' }));
  await step('ipc-r', () => exerciseIpcR());

  if (SCENARIO === 'export-import') {
    const exp = (await step('export', () => send({ c: 'identityExport', passphrase: 'frase-certa' }))) as { bundleB64: string };
    await step('import.frase.errada', async () => {
      try { await send({ c: 'identityImport', bundleB64: exp.bundleB64, passphrase: 'frase-ERRADA' }); return { recusou: false }; }
      catch (e) { return { recusou: true, code: (e as { code?: string }).code }; }
    });
    await step('import.frase.certa', () => send({ c: 'identityImport', bundleB64: exp.bundleB64, passphrase: 'frase-certa' }));
    await step('identityRead.apos.import', () => send({ c: 'identityRead' }));
  }

  if (SCENARIO === 'wipe') {
    await step('wipe', () => send({ c: 'wipe' }, 120_000));
    await step('lockStatus.apos.wipe', () => send({ c: 'lockStatus' }));
  }

  if (SCENARIO === 'deeplink') {
    for (const raw of [
      'comunidadep2p://join/0123456789ABCDEF',
      'comunidadep2p://join/muito-curto',
      'comunidadep2p://evil/../../etc/passwd',
      'javascript:alert(1)',
    ]) handleDeepLink(raw);
    await step('deeplink.parse', async () => ({
      aceitos: deepLinks.filter((d) => d.parsed).length,
      recusados: deepLinks.filter((d) => !d.parsed).length,
      detalhe: deepLinks,
    }));
  }

  await step('stat', () => send({ c: 'stat' }));
  finish(steps.every((s) => s.ok) ? 'APROVADO' : 'REPROVADO');
}

// --- §10.8 etapa 1 + §3.5(4): instância primeiro, dado depois -------------------------------
if (!app.requestSingleInstanceLock()) {
  // Uma segunda instância NUNCA abre o núcleo: encaminha o argv e encerra em silêncio.
  singleInstance = false;
  process.stdout.write(`__POC10_SECOND_INSTANCE__${JSON.stringify({ argv: process.argv.slice(1) })}\n`);
  app.exit(0);
} else {
  app.on('second-instance', (_e, argv) => {
    secondInstanceForwards++;
    const link = argv.find((a) => a.startsWith('comunidadep2p://'));
    if (link) handleDeepLink(link);
  });

  app.whenReady()
    .then(() => {
      const link = process.argv.find((a) => a.startsWith('comunidadep2p://'));
      if (link) handleDeepLink(link);
      return run().catch((err: Error) => {
        if (err instanceof FinishSignal) return;
        steps.push({ step: 'run', ok: false, ms: Date.now() - T0, error: err.message });
        finish('REPROVADO');
      });
    })
    // `finish` sinaliza por throw para satisfazer o tipo `never`. Chamado de dentro do
    // catch acima, esse throw vira rejeição não tratada e suja o log da evidência.
    .catch((err: unknown) => { if (!(err instanceof FinishSignal)) throw err; });
}

app.on('window-all-closed', () => { /* o cenário decide quando sair */ });
