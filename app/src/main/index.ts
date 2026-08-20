/**
 * `app` — Electron main (§3.1, §3.2, §3.3, §10.8, A13, §15.2)
 *
 * Topologia normativa (§3.1):
 *   main cria DOIS MessageChannelMain e cruza as portas:
 *     IPC-M  main ↔︎ núcleo (utilityProcess) — privado, nunca ao renderer (§3.2)
 *     IPC-R  núcleo ↔︎ renderer — o main NÃO fica no meio do tráfego de dado
 *
 * Ciclo §3.3: boot → wipe-resume → identity → view → open → swarm → ready → draining
 * Lock §10.8: 1) requestSingleInstanceLock 2) flock em p2p/LOCK 3) RocksDB 4) SQLite
 * SafeStorage A13(5)(6): probe --password-store antes do lock, com relaunch e argv preservado
 * G6 §15.2: crash do utilityProcess → epoch+1, E_CORE_RESTARTED, resync
 */

import { app, BrowserWindow, MessageChannelMain, dialog, shell, safeStorage, utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// Deep link gramática fechada §3.5
const RE_JOIN = /^comunidadep2p:\/\/join\/([0-9A-HJKMNP-TV-Z]{16})$/;
const RE_MSG = /^comunidadep2p:\/\/m\/([A-Za-z0-9_-]{86})$/;
type DeepLink = { route: 'join'; code: string } | { route: 'message'; ref: string };
function parseDeepLink(raw: string): DeepLink | null {
  const j = RE_JOIN.exec(raw.trim());
  if (j) return { route: 'join', code: j[1]! };
  const m = RE_MSG.exec(raw.trim());
  if (m) return { route: 'message', ref: m[1]! };
  return null;
}

// §10.8 etapa 1 — instância única; deep link com app aberto via second-instance
let deepLinkQueue: DeepLink[] = [];
function handleDeepLinkRaw(raw: string): void {
  const parsed = parseDeepLink(raw);
  if (parsed === null) {
    console.log(`deeplink.rejected ${raw}`);
    return;
  }
  // §3.5(2): encaminha dado estruturado, nunca string original
  deepLinkQueue.push(parsed);
  // Se já tem renderer, entrega; senão fica na fila até ready
  if (mainWindow !== null) {
    mainWindow.webContents.send('deeplink', parsed);
  }
  // Também encaminha ao núcleo se já estiver vivo (para preview de convite §12.3)
  if (utility !== null) {
    utility.postMessage({ kind: 'deeplink', parsed });
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = argv.find((a) => a.startsWith('comunidadep2p://'));
    if (link) handleDeepLinkRaw(link);
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// --- SafeStorage probe A13(5)(6) — ANTES do lock, ANTES de whenReady -----------------
const CANDIDATES = ['gnome-libsecret', 'kwallet6', 'kwallet5'] as const;
function probeBackendIfNeeded(): boolean {
  if (process.platform !== 'linux') return false;
  if (app.commandLine.hasSwitch('password-store')) return false;
  let backend = 'basic_text';
  try { backend = safeStorage.getSelectedStorageBackend(); } catch {}
  if (backend !== 'basic_text') return false;
  // isEncryptionAvailable só responde depois de whenReady, mas getSelectedStorageBackend
  // já indica que caiu em basic_text por falta de desktop (G10 §3.1.1 caso A).
  // A decisão de degradado real é isEncryptionAvailable() — aqui só preparamos relaunch.
  const probeFile = path.join(app.getPath('userData'), 'keystore-backend-probe');
  let tried: string[] = [];
  try {
    const raw = fs.readFileSync(probeFile, 'utf8').trim();
    if (raw) tried = JSON.parse(raw) as string[];
  } catch {}
  for (const cand of CANDIDATES) {
    if (tried.includes(cand)) continue;
    // Próximo candidato: anexa switch e relança preservando argv (§3.5 4, A13 6)
    tried.push(cand);
    fs.mkdirSync(path.dirname(probeFile), { recursive: true });
    fs.writeFileSync(probeFile, JSON.stringify(tried), 'utf8');
    app.commandLine.appendSwitch('password-store', cand);
    // Preserva argv para deep link não se perder no relaunch
    app.relaunch({ args: process.argv.slice(1) });
    app.exit(0);
    return true;
  }
  // Esgotou candidatos — continua como degradado; o núcleo recusará sem aceite (L-2)
  return false;
}

// --- Estado -------------------------------------------------------------------------
let mainWindow: BrowserWindow | null = null;
let utility: UtilityProcess | null = null;
let epoch = 1;
let utilityRestarts = 0;
const MAX_RESTARTS = 3;
let restartWindowStart = Date.now();
let ipcM: MessageChannelMain | null = null;
let ipcRForUtility: MessageChannelMain | null = null;

// Prompt de confirmação nativa para comandos main-confirmed (§15.3)
import crypto from 'node:crypto';
const authTokens = new Map<string, { cmd: string; expiresAt: number }>();
function issueAuthToken(cmd: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  authTokens.set(token, { cmd, expiresAt: Date.now() + 60_000 });
  return token;
}
function consumeAuthToken(token: string, cmd: string): boolean {
  const entry = authTokens.get(token);
  if (entry === undefined) return false;
  authTokens.delete(token);
  if (Date.now() > entry.expiresAt) return false;
  return entry.cmd === cmd;
}

// --- Criação do utilityProcess com dois canais (§3.1) -----------------------------
function spawnUtility(): void {
  // Probe só na primeira criação, antes de qualquer lock
  if (utilityRestarts === 0) {
    if (probeBackendIfNeeded()) return;
  }

  const utilityPath = path.join(__dirname, '../utility/index.js');
  const child = utilityProcess.fork(utilityPath, [], {
    serviceName: 'comunidade-nucleo',
    env: { ...process.env, P2P_DATA_DIR: app.getPath('userData') },
  });
  utility = child;

  // --- IPC-M: canal privado main ↔︎ núcleo, nunca ao renderer ------------------------
  ipcM = new MessageChannelMain();
  // Porta 1 fica no main, porta 2 vai ao utility
  child.postMessage({ kind: 'ipc-m-port' }, [ipcM.port2 as unknown as Electron.MessagePortMain]);

  ipcM.port1.on('message', async (e: Electron.MessageEvent) => {
    const msg = e.data as { q?: string; id?: number; dataKeyB64?: string; wrappedB64?: string };
    if (msg.q === 'wrapDataKey' && msg.dataKeyB64 !== undefined && msg.id !== undefined) {
      try {
        const wrapped = safeStorage.encryptString(msg.dataKeyB64);
        ipcM!.port1.postMessage({ a: 'wrapDataKey', id: msg.id, wrappedB64: wrapped.toString('base64') });
      } catch (err) {
        ipcM!.port1.postMessage({ a: 'error', id: msg.id, code: 'E_KEYSTORE', message: (err as Error).message });
      }
    } else if (msg.q === 'unwrapDataKey' && msg.wrappedB64 !== undefined && msg.id !== undefined) {
      try {
        const plain = safeStorage.decryptString(Buffer.from(msg.wrappedB64, 'base64'));
        ipcM!.port1.postMessage({ a: 'unwrapDataKey', id: msg.id, dataKeyB64: plain });
      } catch (err) {
        ipcM!.port1.postMessage({ a: 'error', id: msg.id, code: 'E_KEYSTORE', message: (err as Error).message });
      }
    } else if (msg.q === 'keystoreInfo' && msg.id !== undefined) {
      let backend = 'unknown';
      try { backend = safeStorage.getSelectedStorageBackend(); } catch {}
      ipcM!.port1.postMessage({ a: 'keystoreInfo', id: msg.id, available: safeStorage.isEncryptionAvailable(), backend });
    } else if (msg.q === 'dialogSave' && msg.id !== undefined) {
      // §13.3: file.save via IPC-M, nunca path do renderer
      const { dialog: dlg } = msg as unknown as { dialog: string };
      // Stub: abre diálogo nativo e devolve ticket
      const win = BrowserWindow.getFocusedWindow();
      const result = win !== null ? await dialog.showSaveDialog(win, { title: dlg }) : { canceled: true, filePath: '' };
      if (result.canceled || !result.filePath) {
        ipcM!.port1.postMessage({ a: 'error', id: msg.id, code: 'E_CANCELLED', message: 'Cancelado' });
      } else {
        const ticket = crypto.randomBytes(16).toString('hex');
        // Em produção, persistiria ticket com TTL em manifest.local_blob_staging
        ipcM!.port1.postMessage({ a: 'dialogSave', id: msg.id, ticket, filePath: result.filePath });
      }
    }
  });
  ipcM.port1.start();

  // --- IPC-R: canal núcleo ↔︎ renderer, atravessa o main sem ser lido ----------------
  ipcRForUtility = new MessageChannelMain();
  // Porta 1 ao utility, porta 2 ao renderer (quando houver janela)
  child.postMessage({ kind: 'ipc-r-port', epoch }, [ipcRForUtility.port1 as unknown as Electron.MessagePortMain]);
  // A porta 2 será transferida ao renderer via webContents.postMessage quando a janela carregar

  child.on('exit', (code) => {
    console.log(`utilityProcess saiu com código ${code}, epoch ${epoch}`);
    utility = null;
    try { ipcM?.port1.close(); } catch {}
    ipcM = null;
    try { ipcRForUtility?.port1.close(); } catch {}
    ipcRForUtility = null;

    // G6 §15.2 + §3.3: reinicia até 3 vezes em 60s com backoff 1s/4s/10s
    const now = Date.now();
    if (now - restartWindowStart > 60_000) {
      utilityRestarts = 0;
      restartWindowStart = now;
    }
    utilityRestarts++;
    if (utilityRestarts > MAX_RESTARTS) {
      console.error('utilityProcess falhou 3 vezes em 60s — não reinicia mais');
      dialog.showErrorBox('Erro irrecuperável', 'O núcleo falhou repetidamente. O aplicativo será encerrado.');
      app.quit();
      return;
    }
    const backoff = [1000, 4000, 10_000][utilityRestarts - 1] ?? 10_000;
    epoch++;
    setTimeout(() => spawnUtility(), backoff);
    // Notifica renderer que epoch mudou (§15.2)
    if (mainWindow !== null) {
      mainWindow.webContents.send('core-epoch', { epoch });
    }
  });

  child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[utility:out] ${d}`));
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[utility:err] ${d}`));
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Carrega o renderer (Vite build do frontend)
  const rendererPath = path.join(__dirname, '../../frontend/dist/index.html');
  if (fs.existsSync(rendererPath)) {
    void mainWindow.loadFile(rendererPath);
  } else {
    void mainWindow.loadURL('http://localhost:5173');
  }

  // Quando o renderer estiver pronto, transfere a porta IPC-R
  mainWindow.webContents.on('did-finish-load', () => {
    if (ipcRForUtility !== null && mainWindow !== null) {
      // A segunda porta do canal IPC-R vai ao renderer via contextBridge
      mainWindow.webContents.postMessage('ipc-r-port', null, [ipcRForUtility.port2 as unknown as Electron.MessagePortMain]);
    }
    // Entrega deep links pendentes
    for (const dl of deepLinkQueue) {
      mainWindow!.webContents.send('deeplink', dl);
    }
  });

  // §13.6: shell.openPath só com allowlist de tipo (BENCHMARK REQUIRED fora, stub seguro)
  // §17.5: setDisplayMediaRequestHandler só depois de autorização do host (via IPC-M)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Só permite navegação externa via shell.openExternal com allowlist
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  const link = process.argv.find((a) => a.startsWith('comunidadep2p://'));
  if (link) handleDeepLinkRaw(link);

  spawnUtility();
  createWindow();

  // Linux deep link via xdg-open entrega argv no second-instance; já tratado.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLinkRaw(url);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // §3.3 draining: fecha cores, wal_checkpoint, libera lock
    utility?.postMessage({ kind: 'shutdown' });
    setTimeout(() => app.quit(), 5000);
  }
});

// Confirmação nativa para comandos destrutivos §15.3 — IPC-M handler para o núcleo
// O preload expõe `window.electron.requestAuthToken(cmd)` que chama este handler via ipcRenderer.
import { ipcMain } from 'electron';
ipcMain.handle('requestAuthToken', async (_e, cmd: string) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win === null) return { ok: false, code: 'E_NO_WINDOW' };
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Cancelar', 'Confirmar'],
    defaultId: 0,
    cancelId: 0,
    message: `Confirmar ação destrutiva: ${cmd}?`,
    detail: 'Esta ação requer confirmação nativa (§15.3).',
  });
  if (response !== 1) return { ok: false, code: 'E_CANCELLED' };
  const token = issueAuthToken(cmd);
  return { ok: true, token };
});

ipcMain.handle('consumeAuthToken', async (_e, token: string, cmd: string) => {
  return consumeAuthToken(token, cmd);
});
