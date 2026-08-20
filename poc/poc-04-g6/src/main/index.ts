/**
 * Main do POC-04 — para perfil full (Electron empacotado).
 * No quick, o harness roda sem Electron via Node worker.
 * Este arquivo só é usado quando empacotado; o quick usa scripts/run-all.ts direto.
 */
import { app, BrowserWindow, MessageChannelMain, utilityProcess } from 'electron';
import path from 'node:path';

let child: Electron.UtilityProcess | null = null;
let epoch = 1;

function spawn(): Electron.UtilityProcess {
  const c = utilityProcess.fork(path.join(__dirname, '../core/index.js'), [], { serviceName: 'poc04-core' });
  const ipcM = new MessageChannelMain();
  const ipcR = new MessageChannelMain();
  c.postMessage({ kind: 'ipc-m-port' }, [ipcM.port2 as unknown as Electron.MessagePortMain]);
  c.postMessage({ kind: 'ipc-r-port', epoch }, [ipcR.port1 as unknown as Electron.MessagePortMain]);
  // renderer receberia ipcR.port2 via BrowserWindow — stub para harness
  c.on('exit', () => {
    epoch++;
    setTimeout(() => { child = spawn(); }, 1000);
  });
  return c;
}

app.whenReady().then(() => {
  child = spawn();
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../renderer/preload.js'), sandbox: false } });
  void win.loadFile(path.join(__dirname, '../renderer/index.html'));
});
