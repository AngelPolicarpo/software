/**
 * `preload` — ponte segura entre renderer e main/utilityProcess (§3.1, §3.4)
 *
 * - Expõe `window.electron` com contextIsolation + sandbox
 * - **Transfere** a porta IPC-R ao mundo principal do renderer
 * - Encapsula `requestAuthToken` para comandos main-confirmed (§15.3)
 *
 * A transferência é por `window.postMessage(..., [port])`, e não por um getter no
 * `contextBridge`: o bridge serializa o que atravessa, e um `MessagePort` não sobrevive a
 * isso — o renderer receberia um objeto morto. `postMessage` com lista de transferência é o
 * único caminho que entrega a porta VIVA ao mundo principal.
 *
 * O preload também NÃO chama `port.start()`. Quem inicia é quem escuta: o `hello` do núcleo
 * (§15.1, primeiro quadro do canal) já pode estar na fila da porta quando ela chega aqui, e
 * iniciá-la sem listener descartaria justamente o quadro que fixa o `epoch`.
 */

import { contextBridge, ipcRenderer } from 'electron';

type DeepLink = { route: string; code?: string; ref?: string };

let epoch = 1;

ipcRenderer.on('ipc-r-port', (event) => {
  const port = event.ports[0];
  if (port === undefined) return;
  // A porta viaja na lista de transferência; o dado é só o rótulo que o renderer procura.
  window.postMessage({ tipo: 'ipc-r-port', epoch }, '*', [port]);
  // Mantido por compatibilidade com quem escuta o anúncio em vez da mensagem.
  window.dispatchEvent(new CustomEvent('ipc-r-ready', { detail: { epoch } }));
});

ipcRenderer.on('core-epoch', (_e, data: { epoch: number }) => {
  epoch = data.epoch;
  window.dispatchEvent(new CustomEvent('core-epoch', { detail: data }));
});

ipcRenderer.on('deeplink', (_e, data: DeepLink) => {
  window.dispatchEvent(new CustomEvent('deeplink', { detail: data }));
});

contextBridge.exposeInMainWorld('electron', {
  getEpoch: () => epoch,
  // U-06 — o renderer mostrou o impacto de sair e a pessoa confirmou.
  confirmExit: async (): Promise<void> => {
    await ipcRenderer.invoke('confirmExit');
  },
  requestAuthToken: async (cmd: string): Promise<{ ok: boolean; token?: string; code?: string }> => {
    return ipcRenderer.invoke('requestAuthToken', cmd) as Promise<{ ok: boolean; token?: string; code?: string }>;
  },
  on: (channel: string, listener: (...args: unknown[]) => void): void => {
    ipcRenderer.on(channel, (_e, ...args) => listener(...args));
  },
  off: (channel: string, listener: (...args: unknown[]) => void): void => {
    ipcRenderer.off(channel, listener as never);
  },
});

declare global {
  interface Window {
    electron: {
      getEpoch(): number;
      confirmExit(): Promise<void>;
      requestAuthToken(cmd: string): Promise<{ ok: boolean; token?: string; code?: string }>;
      on(channel: string, listener: (...args: unknown[]) => void): void;
      off(channel: string, listener: (...args: unknown[]) => void): void;
    };
  }
}
