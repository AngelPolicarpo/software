/**
 * Processo main do POC-03 — gate G0.
 *
 * Monta a topologia de A16 / backend-v2.md §29: main, núcleo em `utilityProcess` e as
 * DUAS fronteiras separadas, cada uma com seu `MessageChannelMain`:
 *
 *   IPC-M  main     <-> núcleo   — ciclo de vida, heartbeat, comandos
 *   IPC-R  renderer <-> núcleo   — porta transferida; o main NÃO fica no meio do tráfego
 *
 * Não é o app do produto. Roda um cenário nomeado, escreve o resultado em JSON e sai; o
 * harness de `scripts/` é quem repete, mata e conta.
 */
import { app, BrowserWindow, MessageChannelMain, utilityProcess, type UtilityProcess } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { CoreCommand, CoreEvent, CoreOut, CoreReply, WithoutId } from '../protocol/messages.js';

const SCENARIO = process.env.POC03_SCENARIO ?? 'smoke';
const RESULT_PATH = process.env.POC03_RESULT ?? '';
const T_APP_START = Date.now();

type Step = { step: string; ok: boolean; ms: number; data?: unknown; error?: string };

/**
 * `finish` encerra o processo, mas `app.exit()` não interrompe o frame atual — sem um
 * sinal, o `throw` que satisfaz o tipo `never` vira "UnhandledPromiseRejection" no log e
 * suja a evidência. Esta classe é reconhecida pelo `catch` e ignorada.
 */
class FinishSignal extends Error {}

const steps: Step[] = [];
const events: CoreEvent[] = [];
let child: UtilityProcess | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let readyEvent: (CoreEvent & { e: 'ready' }) | null = null;
let childExit: { code: number; reason?: string } | null = null;
/** Histórico de saídas do núcleo. `childExit` é zerado antes de reerguer o filho, e sem
 *  este acumulador a morte por `SIGKILL` sumia da evidência exatamente no cenário que
 *  existe para prová-la. */
const childExits: { code: number; at: number }[] = [];
let mainCrashed = false;

function finish(verdict: 'APROVADO' | 'REPROVADO' | 'PARCIAL', extra: Record<string, unknown> = {}): never {
  const out = {
    scenario: SCENARIO,
    verdict,
    startedAt: new Date(T_APP_START).toISOString(),
    totalMs: Date.now() - T_APP_START,
    electron: process.versions.electron,
    packaged: app.isPackaged,
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    coreReady: readyEvent,
    childExit,
    childExits,
    mainCrashed,
    heartbeats: events.filter((e) => e.e === 'heartbeat').length,
    steps,
    ...extra,
  };
  const text = JSON.stringify(out, null, 2);
  if (RESULT_PATH) {
    fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true });
    fs.writeFileSync(RESULT_PATH, text);
  }
  process.stdout.write(`__POC03_RESULT__${JSON.stringify(out)}\n`);
  app.exit(verdict === 'APROVADO' ? 0 : 1);
  throw new FinishSignal('finish');
}

/** Caminho do núcleo compilado. Empacotado, ele vive dentro do asar; o addon, fora. */
function corePath(): string {
  return path.join(__dirname, '..', 'core', 'index.js');
}

function spawnCore(): { child: UtilityProcess; ipcM: MessageChannelMain } {
  const ipcM = new MessageChannelMain();
  const c = utilityProcess.fork(corePath(), [], {
    serviceName: 'poc03-core',
    stdio: 'pipe',
    env: {
      ...process.env,
      POC03_DATA_DIR: process.env.POC03_DATA_DIR ?? path.join(app.getPath('userData'), 'data'),
      POC03_PACKAGED: app.isPackaged ? '1' : '0',
    },
  });

  c.stdout?.on('data', (b: Buffer) => process.stdout.write(`[core:out] ${b}`));
  c.stderr?.on('data', (b: Buffer) => process.stderr.write(`[core:err] ${b}`));

  c.on('message', (m: CoreOut) => {
    if ('e' in m) {
      events.push(m);
      if (m.e === 'ready') readyEvent = m;
      return;
    }
    const p = pending.get((m as CoreReply).id);
    if (!p) return;
    pending.delete((m as CoreReply).id);
    if (m.r === 'ok') p.resolve(m.data);
    else p.reject(Object.assign(new Error(m.message), { code: m.code }));
  });

  c.on('exit', (code: number) => {
    childExit = { code };
    childExits.push({ code, at: Date.now() - T_APP_START });
    for (const [, p] of pending) p.reject(new Error(`núcleo saiu com código ${code}`));
    pending.clear();
  });

  return { child: c, ipcM };
}

function send(cmd: WithoutId<CoreCommand>, timeoutMs = 120_000): Promise<unknown> {
  const id = nextId++;
  return new Promise<unknown>((resolve, reject) => {
    const t = setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout de ${timeoutMs} ms em ${cmd.c}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => { clearTimeout(t); resolve(v); },
      reject: (e) => { clearTimeout(t); reject(e); },
    });
    child!.postMessage({ ...cmd, id } as CoreCommand);
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

function waitReady(timeoutMs = 30_000): Promise<CoreEvent & { e: 'ready' }> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (readyEvent) { clearInterval(iv); resolve(readyEvent); }
      else if (childExit) { clearInterval(iv); reject(new Error(`núcleo morreu antes do ready (código ${childExit.code})`)); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error('timeout esperando ready')); }
    }, 5);
  });
}

/** IPC-R: a segunda porta vai do núcleo ao renderer, atravessando o main sem ser lida por ele. */
async function wireIpcR(): Promise<unknown> {
  const ipcR = new MessageChannelMain();
  child!.postMessage({ kind: 'ipc-r-port' }, [ipcR.port1]);

  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, '..', 'renderer', 'preload.js'), sandbox: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.postMessage('poc03:ipc-r', null, [ipcR.port2]);

  const echo = await win.webContents.executeJavaScript('window.__poc03RoundTrip()');
  win.destroy();
  return echo;
}

async function run(): Promise<void> {
  const spawned = spawnCore();
  child = spawned.child;
  child.postMessage({ kind: 'ipc-m-hello' });

  const ready = await step('core.ready', () => waitReady());
  const msToReady = (ready as { msToReady: number }).msToReady;

  if (SCENARIO === 'coldstart') {
    await step('ping', () => send({ c: 'ping' }));
    finish('APROVADO', { msToReady, bootMs: Date.now() - T_APP_START });
  }

  await step('addonReport', () => send({ c: 'addonReport' }));
  await step('openDbs', () => send({ c: 'openDbs' }));
  await step('openCore', () => send({ c: 'openCore' }));
  await step('flushProbe', () => send({ c: 'flushProbe' }));

  if (SCENARIO === 'crash-native') {
    // O núcleo deve morrer; o main NÃO pode. É o critério "zero crash do main causado
    // pelo filho" de §3 POC-03.
    await step('crashNative', async () => {
      try { await send({ c: 'crashNative' }, 10_000); return { threw: false }; }
      catch (e) { return { threw: true, message: (e as Error).message }; }
    });
    await new Promise((r) => setTimeout(r, 1500));
    finish(mainCrashed ? 'REPROVADO' : 'APROVADO', { mainSobreviveu: !mainCrashed });
  }

  if (SCENARIO === 'crash-hard') {
    await step('crashHard', async () => {
      try { await send({ c: 'crashHard' }, 8_000); } catch { /* esperado */ }
      return { sent: true };
    });
    await new Promise((r) => setTimeout(r, 2000));
    // Reinicia o núcleo no mesmo main: prova que o main sobreviveu e sabe reerguer o filho.
    readyEvent = null; childExit = null;
    const again = spawnCore();
    child = again.child;
    await step('core.ready.apos.sigkill', () => waitReady());
    await step('openDbs.apos.sigkill', () => send({ c: 'openDbs' }));
    const reopened = await step('openCore.apos.sigkill', () => send({ c: 'openCore' }));
    finish(mainCrashed ? 'REPROVADO' : 'APROVADO', { mainSobreviveu: !mainCrashed, reopened });
  }

  if (SCENARIO === 'bench') {
    // "10 000 appends" e as duas transações de §3 POC-03, sem o resto do caminho.
    await step('append.10000x256B', () => send({ c: 'append', count: 10_000, bytes: 256 }, 300_000));
    await step('tx.256', () => send({ c: 'txRows', rows: 256 }));
    await step('tx.2048', () => send({ c: 'txRows', rows: 2048 }));
    await step('fts.index', () => send({ c: 'ftsIndex', rows: 2048 }));
    await step('stat', () => send({ c: 'stat' }));
    finish(steps.every((s) => s.ok) ? 'APROVADO' : 'REPROVADO', { msToReady });
  }

  // smoke: o caminho completo
  await step('append.1000x256B', () => send({ c: 'append', count: 1000, bytes: 256 }));
  await step('tx.256', () => send({ c: 'txRows', rows: 256 }));
  await step('tx.2048', () => send({ c: 'txRows', rows: 2048 }));
  await step('fts.index', () => send({ c: 'ftsIndex', rows: 2048 }));
  await step('ed25519.1000', () => send({ c: 'signVerify', count: 1000 }));
  if (SCENARIO === 'smoke-ipcr') await step('ipc-r.roundtrip', () => wireIpcR());
  // O heartbeat é item de construção do POC-03; sem esperar um par de batidas o cenário
  // termina rápido demais para observar qualquer uma, e "heartbeats: 0" não prova nada.
  await step('heartbeat.observado', async () => {
    const antes = events.filter((e) => e.e === 'heartbeat').length;
    await new Promise((r) => setTimeout(r, 800));
    const depois = events.filter((e) => e.e === 'heartbeat').length;
    if (depois <= antes) throw new Error('nenhum heartbeat em 800 ms');
    return { antes, depois };
  });
  await step('stat', () => send({ c: 'stat' }));

  const bad = steps.filter((s) => !s.ok);
  finish(bad.length === 0 && !mainCrashed ? 'APROVADO' : 'REPROVADO', { msToReady });
}

process.on('uncaughtException', (err) => {
  mainCrashed = true;
  steps.push({ step: 'main.uncaughtException', ok: false, ms: Date.now() - T_APP_START, error: err.message });
  finish('REPROVADO');
});

app.whenReady()
  .then(() =>
    run().catch((err: Error) => {
      if (err instanceof FinishSignal) return;
      steps.push({ step: 'run', ok: false, ms: Date.now() - T_APP_START, error: err.message });
      finish('REPROVADO');
    }),
  )
  // `finish` sinaliza por throw para satisfazer o tipo `never`. Chamado de dentro do catch
  // acima, esse throw vira rejeição não tratada e suja o log da evidência.
  .catch((err: unknown) => { if (!(err instanceof FinishSignal)) throw err; });

app.on('window-all-closed', () => { /* o cenário decide quando sair, não a janela */ });
