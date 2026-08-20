/**
 * `preload` — ponte segura entre renderer e main/utilityProcess (§3.1, §3.4)
 *
 * - Expõe `window.electron` com contextIsolation + sandbox
 * - Transfere a porta IPC-R do main ao renderer via `postMessage`
 * - Encapsula `requestAuthToken` para comandos main-confirmed (§15.3)
 */

import { contextBridge, ipcRenderer } from 'electron';

type DeepLink = { route: string; code?: string; ref?: string };

let ipcRPort: MessagePort | null = null;
let epoch = 1;

ipcRenderer.on('ipc-r-port', (event) => {
  const port = event.ports[0] as unknown as MessagePort;
  if (port) {
    ipcRPort = port;
    ipcRPort.start();
    window.dispatchEvent(new CustomEvent('ipc-r-ready', { detail: { epoch } }));
  }
});

ipcRenderer.on('core-epoch', (_e, data: { epoch: number }) => {
  epoch = data.epoch;
  window.dispatchEvent(new CustomEvent('core-epoch', { detail: data }));
});

ipcRenderer.on('deeplink', (_e, data: DeepLink) => {
  window.dispatchEvent(new CustomEvent('deeplink', { detail: data }));
});

contextBridge.exposeInMainWorld('electron', {
  getIpcRPort: () => ipcRPort,
  getEpoch: () => epoch,
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
      getIpcRPort(): MessagePort | null;
      getEpoch(): number;
      requestAuthToken(cmd: string): Promise<{ ok: boolean; token?: string; code?: string }>;
      on(channel: string, listener: (...args: unknown[]) => void): void;
      off(channel: string, listener: (...args: unknown[]) => void): void;
    };
  }
}
