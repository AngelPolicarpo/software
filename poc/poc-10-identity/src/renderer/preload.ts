/**
 * Preload do POC-10. Exercita a IPC-R e devolve os quadros CRUS ao main, para a varredura
 * de material de chave do gate G10 poder inspecioná-los.
 *
 * `contextBridge`, não `window.x = ...`: com `contextIsolation` ligado — o padrão desde o
 * Electron 12 — o `window` do preload não é o da página, e um `executeJavaScript` no mundo
 * principal não enxergaria nada.
 */
import { contextBridge, ipcRenderer } from 'electron';

let port: MessagePort | null = null;
ipcRenderer.on('poc10:ipc-r', (e) => { port = e.ports[0] ?? null; port?.start(); });

contextBridge.exposeInMainWorld('__poc10Exercise', () =>
  new Promise<unknown[]>((resolve, reject) => {
    if (!port) return reject(new Error('IPC-R não chegou ao renderer'));
    const frames: unknown[] = [];
    const t = setTimeout(() => resolve(frames), 3000);
    port.addEventListener('message', (ev) => {
      frames.push((ev as MessageEvent).data);
      if (frames.length >= 2) { clearTimeout(t); resolve(frames); }
    });
    port.postMessage({ c: 'identity.publicKey' });
    port.postMessage({ c: 'identity.status' });
  }),
);
