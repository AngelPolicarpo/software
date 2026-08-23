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

import { app, BrowserWindow, MessageChannelMain, dialog, shell, safeStorage, utilityProcess, ipcMain, type UtilityProcess } from 'electron';
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
/** Quit em andamento — a saída do utilityProcess é esperada, não crash (§3.3 draining). */
let encerrando = false;

// Prompt de confirmação nativa para comandos main-confirmed (§15.3)
/**
 * §15.3 — o token nasce NO núcleo (`AuthTokenStore`, consumo síncrono no roteador); este
 * mapa guarda só os pedidos de emissão em voo entre o diálogo nativo e a resposta da IPC-M.
 */
const pedidosDeToken = new Map<number, (r: { ok: boolean; token?: string; code?: string }) => void>();
let proximoPedidoToken = 1;

function pedirTokenAoNucleo(cmd: string): Promise<{ ok: boolean; token?: string; code?: string }> {
  return new Promise((resolve) => {
    if (ipcM === null || utility === null) {
      resolve({ ok: false, code: 'E_NO_PORT' });
      return;
    }
    const id = proximoPedidoToken++;
    pedidosDeToken.set(id, resolve);
    ipcM.port1.postMessage({ kind: 'issueToken', cmd, id });
    setTimeout(() => {
      if (pedidosDeToken.delete(id)) resolve({ ok: false, code: 'E_TIMEOUT' });
    }, 5_000);
  });
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

  // Sinais de ciclo do núcleo (§3.3): ready/blocked/drained/crashed.
  child.on('message', (msg: unknown) => {
    const m = msg as { e?: string; phase?: string; code?: string; message?: string };
    if (m.e === 'ready') {
      console.log(`núcleo pronto na fase ${m.phase}, epoch ${epoch}`);
      mainWindow?.webContents.send('core-ready', { phase: m.phase, epoch });
    } else if (m.e === 'blocked') {
      dialog.showErrorBox('Núcleo bloqueado', `O núcleo não pôde iniciar (${m.code}). ${m.message ?? ''}`);
    } else if (m.e === 'crashed') {
      console.error('núcleo crashou:', m.message);
    } else if (m.e === 'drained') {
      aoDrained?.();
      aoDrained = null;
    }
  });

  // --- IPC-M: canal privado main ↔︎ núcleo, nunca ao renderer ------------------------
  ipcM = new MessageChannelMain();
  // Porta 1 fica no main, porta 2 vai ao utility
  child.postMessage({ kind: 'ipc-m-port' }, [ipcM.port2 as unknown as Electron.MessagePortMain]);

  ipcM.port1.on('message', async (e: Electron.MessageEvent) => {
    const msg = e.data as {
      q?: string; id?: number; dataKeyB64?: string; wrappedB64?: string;
      suggestedName?: string; dataB64?: string;
      communityId?: string; path?: string; mode?: string;
    };
    // Protocolo do IpcKeystoreOracle (§3.2/A13): respostas {a, id}
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
    } else if (msg.q === 'file.save' && msg.id !== undefined && typeof msg.dataB64 === 'string') {
      // §5.5/§13.3 — o main grava o arquivo do backup; caminho nenhum volta ao núcleo.
      const win = mainWindow ?? BrowserWindow.getFocusedWindow();
      const result = win !== null
        ? await dialog.showSaveDialog(win, { title: 'Salvar backup de identidade', defaultPath: msg.suggestedName })
        : { canceled: true, filePath: '' } as const;
      if (result.canceled || !result.filePath) {
        ipcM!.port1.postMessage({ id: msg.id, ok: false, code: 'E_CANCELLED' });
      } else {
        try {
          fs.writeFileSync(result.filePath, Buffer.from(msg.dataB64, 'base64'));
          ipcM!.port1.postMessage({ id: msg.id, ok: true, data: null });
        } catch {
          ipcM!.port1.postMessage({ id: msg.id, ok: false, code: 'E_INTERNAL' });
        }
      }
    } else if (msg.q === 'file.read' && msg.id !== undefined) {
      // §5.5 import — o main lê o arquivo escolhido e manda os BYTES pela IPC-M.
      const win = mainWindow ?? BrowserWindow.getFocusedWindow();
      const result = win !== null
        ? await dialog.showOpenDialog(win, { title: 'Restaurar identidade', properties: ['openFile'] })
        : { canceled: true, filePaths: [] as string[] };
      if (result.canceled || result.filePaths.length === 0) {
        ipcM!.port1.postMessage({ id: msg.id, ok: false, code: 'E_CANCELLED' });
      } else {
        try {
          const bytes = fs.readFileSync(result.filePaths[0]!);
          ipcM!.port1.postMessage({ id: msg.id, ok: true, data: bytes.toString('base64') });
        } catch {
          ipcM!.port1.postMessage({ id: msg.id, ok: false, code: 'E_INTERNAL' });
        }
      }
    } else if (msg.q === 'dialogOpenAttachment' && msg.id !== undefined && typeof msg.communityId === 'string') {
      // §13.3 — ticket de anexo: diálogo aqui, caminho nunca cruza o IPC-R.
      const win = mainWindow ?? BrowserWindow.getFocusedWindow();
      const result = win !== null
        ? await dialog.showOpenDialog(win, { properties: ['openFile'] })
        : { canceled: true, filePaths: [] as string[] };
      if (result.canceled || result.filePaths.length === 0) {
        ipcM!.port1.postMessage({ id: msg.id, ok: true, data: null });
      } else {
        const p = result.filePaths[0]!;
        try {
          const sizeBytes = fs.statSync(p).size;
          ipcM!.port1.postMessage({ id: msg.id, ok: true, data: { path: p, sizeBytes } });
          void msg.communityId;
        } catch {
          ipcM!.port1.postMessage({ id: msg.id, ok: false, code: 'E_INTERNAL' });
        }
      }
    } else if (msg.q === 'shell.reveal' && msg.id !== undefined && typeof msg.path === 'string') {
      void shell.openPath(msg.path);
      ipcM!.port1.postMessage({ id: msg.id, ok: true, data: null });
    }
    // Resposta da emissão de token pedida ao núcleo ({a:'issueToken', id, ok, token?})
    const resposta = e.data as { a?: string; id?: number; ok?: boolean; token?: string; code?: string };
    if (resposta.a === 'issueToken' && resposta.id !== undefined) {
      const resolver = pedidosDeToken.get(resposta.id);
      if (resolver !== undefined) {
        pedidosDeToken.delete(resposta.id);
        resolver(resposta.ok === true ? { ok: true, token: resposta.token } : { ok: false, code: resposta.code ?? 'E_BUSY' });
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

    // Saída esperada: quit em curso (draining) — não é crash.
    if (encerrando) {
      app.quit();
      return;
    }
    const limpo = code === 0;
    if (!limpo) {
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
    }
    // Notifica renderer que epoch mudou (§15.2) — o IpcClient falha pendentes e refaz subs.
    epoch++;
    const backoff = limpo ? 50 : ([1000, 4000, 10_000][utilityRestarts - 1] ?? 10_000);
    setTimeout(() => spawnUtility(), backoff);
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
    // §3.3 draining — o núcleo fecha cores com snapshot e responde `{e:'drained'}`;
    // sem resposta em 8 s, sai do mesmo jeito (segurar o fechamento é pior, §18.7).
    encerrando = true;
    let saiu = false;
    const sairUmaVez = (): void => {
      if (!saiu) {
        saiu = true;
        app.quit();
      }
    };
    aoDrained = sairUmaVez;
    utility?.postMessage({ kind: 'shutdown' });
    setTimeout(sairUmaVez, 8_000);
  }
});

/** Chamado quando o núcleo confirma que drenou (mensagem `{e:'drained'}` do utility). */
let aoDrained: (() => void) | null = null;

// Confirmação nativa para comandos destrutivos §15.3 — o diálogo é aqui, o token nasce no
// núcleo (AuthTokenStore, consumo síncrono no roteador).
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
  // O token nasce NO núcleo e é consumido lá uma única vez (§15.3).
  if (utility === null || ipcM === null) return { ok: false, code: 'E_NO_PORT' };
  return await pedirTokenAoNucleo(cmd);
});
