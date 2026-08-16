/**
 * Preload do POC-03. Só existe para receber a porta da IPC-R e provar que o renderer fala
 * com o núcleo sem o main no meio. Nada de produto aqui.
 *
 * `contextBridge`, não `window.x = ...`: com `contextIsolation` ligado — o padrão desde o
 * Electron 12 — o `window` do preload não é o da página, e um `executeJavaScript` no mundo
 * principal não enxergaria nada.
 */
import { contextBridge, ipcRenderer } from 'electron';

let port: MessagePort | null = null;

ipcRenderer.on('poc03:ipc-r', (e) => {
  port = e.ports[0] ?? null;
  port?.start();
});

contextBridge.exposeInMainWorld('__poc03RoundTrip', () =>
  new Promise((resolve, reject) => {
    if (!port) return reject(new Error('IPC-R não chegou ao renderer'));
    const t = setTimeout(() => reject(new Error('timeout na IPC-R')), 10_000);
    port.addEventListener(
      'message',
      (ev) => { clearTimeout(t); resolve({ reply: (ev as MessageEvent).data, at: Date.now() }); },
      { once: true },
    );
    port.postMessage({ hello: 'do renderer', at: Date.now() });
  }),
);
