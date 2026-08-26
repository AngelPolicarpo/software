/**
 * A janela do smoke de §92 — o `main` de mentira que exercita o ciclo REAL de fechamento
 * com o preload REAL do produto. Rodado por `smoke-fechamento.mjs`, nunca à mão.
 *
 * O guarda aqui é o mesmo de `app/src/main/index.ts`: segura o primeiro `close`, pergunta
 * o impacto, desarma o prazo quando a resposta chega, e devolve o guarda ao lugar quando a
 * resposta é "cancelar".
 */
const { app, BrowserWindow, ipcMain } = require('electron');

const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) ?? '').split('=')[1];
const CENARIO = arg('cenario');
const PRELOAD = arg('preload');
const t0 = Date.now();
const log = (m) => console.log(`[${String(Date.now() - t0).padStart(5)}ms] ${m}`);

let win = null;
let confirmada = false;
let pedido = false;
let prazo = null;
let fechou = false;
let perguntas = 0;
/** `app.exit()` também destrói a janela: depois do relatório, `closed` não é veredito. */
let relatando = false;

ipcMain.handle('confirmExit', () => {
  clearTimeout(prazo);
  prazo = null;
  confirmada = true;
  win.close();
  return { ok: true };
});
ipcMain.handle('cancelExit', () => {
  clearTimeout(prazo);
  prazo = null;
  pedido = false;
  return { ok: true };
});

/**
 * O renderer do produto: `beforeunload` só veta **fora** do Electron, onde ele PERGUNTA.
 * No cenário `veto` ele veta sempre — é o comportamento anterior a §92, que tem de
 * reprovar; é essa linha que travava a janela de quem hospedava.
 */
function pagina(cenario) {
  const vetar = cenario === 'veto' ? 'true' : 'window.electron === undefined';
  const resposta = cenario === 'cancela' ? 'cancelExit' : 'confirmExit';
  const script =
    '<script>' +
    "window.addEventListener('beforeunload', function (e) { if (" + vetar + ') e.preventDefault(); });' +
    "window.electron.on('exit-impact', function () { window.electron." + resposta + '(); });' +
    '</script>host';
  return 'data:text/html,' + encodeURIComponent(script);
}

app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  win = new BrowserWindow({
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  await win.loadURL(pagina(CENARIO));

  win.on('close', (e) => {
    if (confirmada || pedido) return;
    e.preventDefault();
    pedido = true;
    perguntas++;
    win.webContents.send('exit-impact');
    prazo = setTimeout(() => {
      log('PRAZO');
      confirmada = true;
      win.close();
    }, 10_000);
  });
  win.on('closed', () => {
    fechou = true;
    // Impresso AQUI, e não no relatório do fim: fechar a janela dispara
    // `window-all-closed` → `app.quit()`, e o processo morre antes de qualquer relatório.
    // Um veredito que só o CASO QUE FALHA consegue imprimir não serve de veredito.
    if (!relatando) log('CLOSED');
  });

  setTimeout(() => win.close(), 400);

  if (CENARIO === 'cancela') {
    // Segundo X depois do cancelar: o guarda tem de perguntar DE NOVO, e nada pode ter
    // fechado a janela sozinho no intervalo.
    setTimeout(() => {
      log(`VIVA_APOS_CANCELAR=${!win.isDestroyed()}`);
      if (!win.isDestroyed()) win.close();
    }, 1_600);
    setTimeout(() => {
      relatando = true;
      log(`PERGUNTAS=${perguntas}`);
      log(`FECHOU=${fechou}`);
      app.exit(0);
    }, 2_600);
    return;
  }

  setTimeout(() => {
    relatando = true;
    log(`FECHOU=${fechou}`);
    app.exit(0);
  }, 2_600);
});
