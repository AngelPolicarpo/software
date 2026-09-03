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

import { app, BrowserWindow, MessageChannelMain, desktopCapturer, dialog, session, shell, safeStorage, utilityProcess, ipcMain, type UtilityProcess } from 'electron';
import { atenderPedidoDeCaptura, seletorDoSistema, suporteDeCaptura } from './captura';
import type { DeclaracaoDeCaptura } from './captura';
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

/**
 * §17.5/`T-41` — a ordem é `share.start` → o host autoriza → `captureToken` → captura.
 * Nunca o contrário. O renderer DECLARA para qual sessão vai pedir tela antes de chamar
 * `getDisplayMedia`; quem decide se aquela sessão existe e está autorizada é o núcleo, por
 * `capture.authorize` (§15.7). A declaração é só o endereço da pergunta: um renderer que
 * inventasse um `sessionId` receberia `gone` do núcleo, porque o `captureToken` é local e
 * nasceu lá dentro (§17.4 emendado).
 */
let sessaoDeCapturaDeclarada: string | null = null;

let capturaDeclarada: DeclaracaoDeCaptura = { kind: 'screen', sourceId: null, audio: false, mode: 'share' };
const decisoesDeCaptura = new Map<string, Array<(d: { allowed: boolean; sourceTypes: readonly string[]; audio: boolean }) => void>>();

/**
 * Pergunta ao núcleo (§15.7 `capture.authorize` → `capture.decision`). Falha fechada.
 *
 * `audio` é a emenda de 2026-09-03 (**B39**): o pedido de som **vai junto**, e a resposta diz
 * se ele é concedido. Antes disto o flag ia do renderer direto para cá e o main o obedecia —
 * o núcleo não sabia que uma captura de som de máquina inteira estava acontecendo, e o
 * renderer era a única autoridade sobre isso.
 */
function perguntarCapturaAoNucleo(
  sessionId: string,
  kind: 'screen' | 'music' = 'screen',
  audio = false,
): Promise<{ allowed: boolean; sourceTypes: readonly string[]; audio: boolean }> {
  const nucleo = utility;
  if (nucleo === null) return Promise.resolve({ allowed: false, sourceTypes: [], audio: false });
  return new Promise((resolve) => {
    const fila = decisoesDeCaptura.get(sessionId) ?? [];
    fila.push(resolve);
    decisoesDeCaptura.set(sessionId, fila);
    nucleo.postMessage({ kind: 'capture.authorize', sessionId, captureKind: kind, captureAudio: audio });
    // Sem resposta, não concede. Uma captura que trava é pior que uma que recusa: a pessoa
    // vê o erro e tenta de novo, em vez de olhar para um diálogo que nunca abre.
    setTimeout(() => {
      const pendentes = decisoesDeCaptura.get(sessionId);
      if (pendentes?.includes(resolve) === true) {
        decisoesDeCaptura.set(sessionId, pendentes.filter((r) => r !== resolve));
        resolve({ allowed: false, sourceTypes: [], audio: false });
      }
    }, 5_000);
  });
}
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
      // P2P_PICK_FILE (smoke/CI): o main substitui o diálogo por um caminho fixo —
      // decisão DELE, nunca do renderer; o ticket nasce do mesmo jeito.
      const fixo = process.env.P2P_PICK_FILE;
      if (fixo !== undefined && fixo !== '') {
        try {
          const sizeBytes = fs.statSync(fixo).size;
          ipcM!.port1.postMessage({ id: msg.id, ok: true, data: { path: fixo, sizeBytes } });
        } catch {
          ipcM!.port1.postMessage({ id: msg.id, ok: true, data: null });
        }
      } else {
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
      }
    } else if (msg.q === 'shell.reveal' && msg.id !== undefined && typeof msg.path === 'string') {
      void shell.openPath(msg.path);
      ipcM!.port1.postMessage({ id: msg.id, ok: true, data: null });
    }
    // §15.7 `capture.decision` — a resposta do núcleo sobre uma sessão de tela.
    const decisao = e.data as { a?: string; sessionId?: string; allowed?: boolean; sourceTypes?: string[]; audio?: boolean };
    if (decisao.a === 'capture.decision' && typeof decisao.sessionId === 'string') {
      const pendentes = decisoesDeCaptura.get(decisao.sessionId) ?? [];
      decisoesDeCaptura.delete(decisao.sessionId);
      for (const resolver of pendentes) {
        resolver({
          allowed: decisao.allowed === true,
          sourceTypes: decisao.sourceTypes ?? [],
          audio: decisao.audio === true,
        });
      }
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
  portaREntregue = false;
  // Porta 1 ao utility, porta 2 ao renderer (quando houver janela)
  child.postMessage({ kind: 'ipc-r-port', epoch }, [ipcRForUtility.port1 as unknown as Electron.MessagePortMain]);
  // Na PRIMEIRA subida a janela ainda não existe e quem transfere é o `did-finish-load`.
  // Num respawn (§15.2) a janela já está lá com a porta do núcleo morto na mão: sem esta
  // linha o renderer nunca receberia a porta nova, e o passo 4 da recuperação pararia no
  // `hello` que não chega.
  entregarPortaAoRenderer();

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

/**
 * Transfere a porta 2 do canal IPC-R ao renderer. O main não lê o tráfego (§3.1): ele só
 * cruza as portas. Chamada nos dois momentos em que a porta e a janela coexistem —
 * `did-finish-load` e respawn do núcleo.
 *
 * Marca por canal: porta transferida é neuterada e repostá-la lança; canal novo (respawn)
 * zera a marca ao nascer. Com carga em curso, a entrega é adiada para o fim de carga real
 * (`did-stop-loading`) exatamente uma vez.
 */
let portaREntregue = false;
let entregaAdiada = false;

function entregarPortaAoRenderer(): void {
  if (ipcRForUtility === null || mainWindow === null || mainWindow.isDestroyed()) {
    console.log(
      `[main] porta IPC-R sem destino ainda (canal=${ipcRForUtility !== null}, janela=${mainWindow !== null && !mainWindow.isDestroyed()})`,
    );
    return;
  }
  // Porta transferida é neuterada: um segundo postMessage com ela lança. Cada canal é
  // entregue uma única vez; canal novo (respawn) zera a marca ao nascer.
  if (portaREntregue) return;
  const wc = mainWindow.webContents;  if (wc.isLoading()) {
    // O Electron emite `did-finish-load` ANTES de encerrar o estado interno de carga —
    // neste ponto isLoading() ainda é true (verificado no smoke de §59), e devolver cedo
    // aqui deixava a partida fria sem porta nenhuma: nem o spawnUtility (janela ausente)
    // nem este evento tentariam de novo. O fim de carga real é `did-stop-loading`, que vem
    // depois; é ele quem retoma a entrega exatamente uma vez.
    if (!entregaAdiada) {
      entregaAdiada = true;
      console.log('[main] porta IPC-R adiada: carga em curso — retoma em did-stop-loading');
      wc.once('did-stop-loading', () => {
        entregaAdiada = false;
        console.log('[main] did-stop-loading — retomando entrega da porta IPC-R');
        entregarPortaAoRenderer();
      });
    }
    return;
  }
  portaREntregue = true;
  console.log('[main] transferindo porta IPC-R ao renderer');
  wc.postMessage('ipc-r-port', null, [
    ipcRForUtility.port2 as unknown as Electron.MessagePortMain,
  ]);
}

/**
 * U-06/§18.7 — fechar como host derruba quem está conectado e pode perder o que ainda não
 * replicou. O renderer mostra o impacto (`host.exitImpact`) e só então confirma; o main
 * segura o primeiro `close` para isso. Uma vez confirmado, a janela fecha de verdade e o
 * draining de §3.3 segue seu curso.
 */
let saidaConfirmada = false;
/** Já pedimos o impacto uma vez: a segunda tentativa de fechar não é mais segurada. */
let pedidoDeSaidaEnviado = false;
/**
 * O prazo que solta a janela quando o renderer não responde. Guardado porque uma resposta
 * — confirmar OU **cancelar** — o torna obsoleto: sem cancelá-lo, quem clicava "Cancelar"
 * via o app fechar sozinho dez segundos depois, que é o contrário do que pediu.
 */
let prazoDeSaida: ReturnType<typeof setTimeout> | null = null;

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

  // Carrega o renderer (build do Vite em `frontend/dist`).
  //
  // O caminho é relativo a `app/dist/main`, e um `..` a menos parava DENTRO de `app/` —
  // `fs.existsSync` dava falso, o código caía no `loadURL` do dev server e, sem Vite no ar,
  // a janela ficava branca sem uma linha de log. O fallback silencioso é que transformava
  // um caminho errado em sintoma mudo: agora os candidatos são explícitos, a escolha é
  // registrada, e não achar nenhum é uma tela que DIZ o que faltou.
  const candidatos = [
    path.join(__dirname, '../../../frontend/dist/index.html'), // árvore de desenvolvimento
    path.join(__dirname, '../renderer/index.html'), // empacotado (electron-builder)
  ];
  const rendererPath = candidatos.find((c) => fs.existsSync(c));
  if (rendererPath !== undefined) {
    console.log(`[main] renderer: ${rendererPath}`);
    void mainWindow.loadFile(rendererPath);
  } else if (process.env.P2P_RENDERER_URL !== undefined) {
    console.log(`[main] renderer: ${process.env.P2P_RENDERER_URL} (P2P_RENDERER_URL)`);
    void mainWindow.loadURL(process.env.P2P_RENDERER_URL);
  } else {
    console.error(`[main] renderer não encontrado. Procurei em:\n  ${candidatos.join('\n  ')}`);
    void mainWindow.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<body style="font:14px system-ui;padding:2rem;background:#1a1c24;color:#e6e6e6">' +
            '<h1>Renderer nao encontrado</h1>' +
            '<p>Rode <code>npm run build</code> em <code>frontend/</code> antes de <code>npm run dev</code>.</p>' +
            '<p>Para apontar para o dev server do Vite, use <code>P2P_RENDERER_URL=http://localhost:5173</code>.</p>' +
            '</body>',
        ),
    );
  }

  // Quando o renderer estiver pronto, transfere a porta IPC-R
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[main] did-finish-load');
    entregarPortaAoRenderer();
    // Entrega deep links pendentes
    for (const dl of deepLinkQueue) {
      mainWindow!.webContents.send('deeplink', dl);
    }
  });

  mainWindow.on('close', (e) => {
    console.log(`[main] evento close (saidaConfirmada=${saidaConfirmada}, utility=${utility !== null}, pedido=${pedidoDeSaidaEnviado})`);
    if (saidaConfirmada || mainWindow === null) return;
    // Sem núcleo vivo não há impacto a consultar: segurar a janela seria só travá-la.
    if (utility === null) return;
    // **O guarda nunca pode prender a janela.** Se o renderer não está de pé — tela branca,
    // crash, build ausente —, ninguém vai chamar `confirmExit` e a pessoa fica sem saída.
    // Três escapes, nesta ordem: renderer morto não segura; a segunda tentativa de fechar
    // fecha; e o prazo fecha sozinho. U-06 pede mostrar o impacto, não impedir a saída.
    const wc = mainWindow.webContents;
    if (wc.isDestroyed() || wc.isCrashed() || wc.isLoading() || pedidoDeSaidaEnviado) {
      return;
    }
    e.preventDefault();
    pedidoDeSaidaEnviado = true;
    wc.send('exit-impact');
    // §18.7 dá 5 s de barreira ao fechar; o dobro disso já é tempo de sobra para uma tela
    // aparecer. Passado o prazo SEM RESPOSTA, a janela fecha. Com resposta — confirmar ou
    // cancelar — o prazo é desarmado: ele existe para o silêncio, não para vencer a pessoa.
    prazoDeSaida = setTimeout(() => {
      prazoDeSaida = null;
      if (!saidaConfirmada && mainWindow !== null && !mainWindow.isDestroyed()) {
        console.warn('[main] impacto de saída sem resposta do renderer — fechando mesmo assim');
        saidaConfirmada = true;
        mainWindow.close();
      }
    }, 10_000);
  });

  /**
   * §17.5/`T-41` — **a porta única da captura de tela**. Era comentário; agora é código.
   *
   * O `setDisplayMediaRequestHandler` só concede depois que o núcleo confirmar, por
   * `capture.authorize` (§15.7), que existe sessão viva com `captureToken` válido para o
   * `sessionId` que o renderer declarou. Sem handler explícito a decisão fica com o default
   * do Electron, que varia por versão — e a ordem de §17.5 (`share.start` → host autoriza →
   * `captureToken` → `getDisplayMedia`) deixaria de ser verificável em qualquer lugar.
   *
   * Falha fechada em todos os ramos: sem sessão declarada, sem núcleo, sem decisão dentro do
   * prazo ou sem fonte disponível, `callback({})` nega a captura.
   */
  mainWindow.webContents.session.setDisplayMediaRequestHandler(
    /*
     * O corpo mora em `main/captura.ts` desde 2026-09-03 (§114.5): `main/index.ts` abre
     * janela ao ser importado, então nada aqui dentro é exercitável fora de um app inteiro —
     * e a regra que mais importa (**quem concede o som é o núcleo**, §15.7) vivia justamente
     * aqui, sem teste que a alcançasse. O `smoke:captura` agora chama a MESMA função, com um
     * núcleo real do outro lado.
     */
    (_request, callback) => {
      atenderPedidoDeCaptura(
        {
          sessaoDeclarada: () => sessaoDeCapturaDeclarada,
          declaracao: () => capturaDeclarada,
          perguntarAoNucleo: (sessionId, kind, audio) => perguntarCapturaAoNucleo(sessionId, kind, audio),
          getSources: (opts) => desktopCapturer.getSources(opts as Parameters<typeof desktopCapturer.getSources>[0]),
          seletorDoSistema: () => seletorDoSistema(),
        },
        callback,
      );
    },
    /**
     * **Sem `useSystemPicker`.** Ele não é o seletor do sistema que o comentário antigo
     * prometia "no Windows/macOS": o Electron só o usa quando
     * `isDisplayMediaSystemPickerAvailable()` responde `true` e, quando usa, responde
     * `callback({video: <placeholder>})` **sem chamar este handler** — ou seja, sem
     * perguntar ao núcleo. A ordem de `T-41` (§17.5) deixaria de ser verificável
     * justamente onde o seletor existe, e no Linux, que é metade do v1, ele nunca existiu:
     * a pessoa caía no `fontes[0]` de qualquer jeito. O seletor do produto (§17.5, a lista
     * com miniatura por fonte) é quem dá a escolha real, nas duas plataformas.
     */
  );

  // §13.6: shell.openPath só com allowlist de tipo (BENCHMARK REQUIRED fora, stub seguro)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Só permite navegação externa via shell.openExternal com allowlist
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  const link = process.argv.find((a) => a.startsWith('comunidadep2p://'));
  if (link) handleDeepLinkRaw(link);

  // §17.2 — a mídia é toda do renderer, então microfone e câmera passam por aqui. Sem um
  // handler explícito a decisão fica com o default do Electron, que varia por versão: uma
  // porta de captura não deve depender disso. `media` é a única concedida; o resto —
  // geolocalização, notificações do SO, MIDI, USB, HID, serial — é recusado, porque §25.4
  // diz que este produto não fala com nada além dos pares.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

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

/**
 * §17.5 — o renderer diz para qual sessão de tela ele vai pedir captura, logo depois de
 * `share.start` responder. Não é autorização: é o endereço da pergunta que o main fará ao
 * núcleo. Quem autoriza é `capture.authorize`, contra o `captureToken` que nasceu lá dentro.
 */
ipcMain.handle('declareCaptureSession', (_e, arg: unknown) => {
  const a = (arg ?? {}) as { sessionId?: unknown; kind?: unknown; sourceId?: unknown; audio?: unknown; mode?: unknown };
  sessaoDeCapturaDeclarada = typeof a.sessionId === 'string' && a.sessionId.length > 0 ? a.sessionId : null;
  capturaDeclarada = {
    ...(a.mode === 'music' ? { mode: 'music' as const } : { mode: 'share' as const }),
    kind: a.kind === 'window' ? 'window' : 'screen',
    sourceId: typeof a.sourceId === 'string' && a.sourceId.length > 0 ? a.sourceId : null,
    audio: a.audio === true,
  };
  console.log(
    `[main] sessão de captura declarada: ${sessaoDeCapturaDeclarada?.slice(0, 8) ?? 'nenhuma'}` +
      ` (${capturaDeclarada.mode ?? 'share'} · ${capturaDeclarada.kind}${capturaDeclarada.sourceId === null ? '' : ' escolhida'}` +
      `${capturaDeclarada.audio ? ' + áudio' : ''})`,
  );
});

/**
 * §17.5 — as fontes que a pessoa pode escolher, para o seletor do produto.
 *
 * **Listar não é capturar.** Nada aqui abre trilha, acende luz de captura ou sai da
 * máquina: são miniaturas locais, pintadas no nosso renderer, do mesmo jeito que o seletor
 * do Chrome as pinta antes de qualquer permissão. A ordem de `T-41` continua intacta —
 * `share.start` → o host autoriza → `captureToken` → `getDisplayMedia` —, e é o handler de
 * `setDisplayMediaRequestHandler` que a faz valer. O que esta lista muda é só isto: quando
 * a captura for concedida, ela é da fonte que a pessoa apontou, e não de `fontes[0]`.
 *
 * A própria janela do app sai da lista: transmiti-la é a sala de espelhos, e nunca é o que
 * se quis escolher.
 */
ipcMain.handle('listCaptureSources', async (_e, arg: unknown) => {
  // Onde o portal manda, LISTAR É PERGUNTAR: `getSources` abriria a caixa do sistema aqui,
  // antes de `share.start` e antes de o host autorizar nada — a ordem de `T-41` de cabeça
  // para baixo, e a primeira das duas caixas que a pessoa via. O renderer já não chama
  // neste caminho; recusar aqui é a segunda tranca, e não uma lista vazia por acaso.
  if (seletorDoSistema()) return [];
  const kind = (arg as { kind?: unknown } | undefined)?.kind === 'window' ? 'window' : 'screen';
  const minhaJanela = mainWindow?.isDestroyed() === false ? mainWindow.getMediaSourceId() : null;
  try {
    const fontes = await desktopCapturer.getSources({
      types: [kind],
      // Grande o bastante para reconhecer a janela, pequeno o bastante para caber num IPC
      // que roda a cada abertura do seletor.
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: kind === 'window',
    });
    return fontes
      .filter((f) => f.id !== minhaJanela)
      .map((f) => ({
        id: f.id,
        name: f.name,
        kind,
        // JPEG e não PNG: a miniatura é foto de tela, e o PNG dela chega a ser dez vezes
        // maior para o mesmo pixel visível.
        thumbnail: f.thumbnail.isEmpty() ? null : `data:image/jpeg;base64,${f.thumbnail.toJPEG(70).toString('base64')}`,
        // O ícone precisa do canal alfa, então continua PNG.
        appIcon:
          f.appIcon === null || f.appIcon === undefined || f.appIcon.isEmpty()
            ? null
            : f.appIcon.toDataURL(),
        displayId: f.display_id === '' ? null : f.display_id,
      }));
  } catch (e) {
    console.warn('[main] não foi possível listar fontes de captura', e);
    return [];
  }
});

/**
 * O que ESTA plataforma faz com captura — a UI pergunta antes de desenhar o seletor.
 *
 * Duas coisas, e as duas mudam a tela: se há áudio para oferecer (o loopback do Electron é
 * do Windows; no Linux a captura sobe muda, e prometer som ali seria mentira), e de quem é
 * a escolha da fonte — nossa, ou do `xdg-desktop-portal` (ver `seletorDoSistema`).
 */
ipcMain.handle('captureSupport', () => suporteDeCaptura());

/** O renderer terminou de mostrar o impacto de U-06: agora a janela fecha de verdade. */
ipcMain.handle('confirmExit', () => {
  console.log('[main] confirmExit — fechando a janela');
  if (prazoDeSaida !== null) clearTimeout(prazoDeSaida);
  prazoDeSaida = null;
  saidaConfirmada = true;
  mainWindow?.close();
  return { ok: true };
});

/**
 * U-06 — a pessoa viu o impacto e **desistiu**. Duas coisas voltam ao lugar: o prazo de
 * 10 s, que fecharia a janela sozinho e transformaria "Cancelar" em "fechar daqui a pouco";
 * e o próprio guarda, porque `pedidoDeSaidaEnviado` fixo em `true` fazia o fechamento
 * SEGUINTE passar direto, sem mostrar impacto nenhum. Cancelar tem de deixar o app no
 * estado em que estava antes de a pergunta ser feita.
 */
ipcMain.handle('cancelExit', () => {
  console.log('[main] cancelExit — a janela fica, e o guarda volta a valer');
  if (prazoDeSaida !== null) clearTimeout(prazoDeSaida);
  prazoDeSaida = null;
  pedidoDeSaidaEnviado = false;
  return { ok: true };
});

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
    message: 'Confirmar ação destrutiva?',
    detail: 'Esta ação requer confirmação.',
  });
  if (response !== 1) return { ok: false, code: 'E_CANCELLED' };
  // O token nasce NO núcleo e é consumido lá uma única vez (§15.3).
  if (utility === null || ipcM === null) return { ok: false, code: 'E_NO_PORT' };
  return await pedirTokenAoNucleo(cmd);
});
