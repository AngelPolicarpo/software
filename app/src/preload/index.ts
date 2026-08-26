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

/**
 * Canal → (listener do renderer → embrulho realmente inscrito no `ipcRenderer`).
 * É o que torna `off` capaz de remover o que `on` inscreveu; ver o comentário em `on`.
 */
const embrulhos = new Map<string, Map<(...args: unknown[]) => void, (...args: unknown[]) => void>>();

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
  /**
   * §17.5/`T-41` — declara para qual sessão de tela a próxima captura será pedida. O main
   * usa isto só como endereço da pergunta que fará ao núcleo (`capture.authorize`, §15.7);
   * quem autoriza é o núcleo, contra o `captureToken` local. Chamado depois de
   * `share.start` responder e ANTES de `getDisplayMedia`, que é a ordem que §17.5 exige.
   */
  declareCaptureSession: async (arg: { sessionId: string | null; kind: 'screen' | 'window' }): Promise<void> => {
    await ipcRenderer.invoke('declareCaptureSession', arg);
  },
  /** U-06 — a pessoa desistiu de fechar. O main solta o prazo e volta a segurar o próximo. */
  cancelExit: async (): Promise<void> => {
    await ipcRenderer.invoke('cancelExit');
  },
  on: (channel: string, listener: (...args: unknown[]) => void): void => {
    // O `ipcRenderer` entrega `(event, ...args)` e o renderer não pode receber o `event`
    // (ele carrega `sender`, que atravessaria o contextIsolation). Daí o embrulho — e daí
    // o REGISTRO dele: `off` recebe o listener original, que nunca foi o que se inscreveu.
    // Sem este mapa, `off` removia um listener que não existia e devolvia sem erro: cada
    // reexecução do efeito de `AppShell` empilhava mais um `exit-impact` vivo, todos com
    // um `hostedImpact` congelado no instante em que foram criados.
    let porCanal = embrulhos.get(channel);
    if (porCanal === undefined) {
      porCanal = new Map();
      embrulhos.set(channel, porCanal);
    }
    if (porCanal.has(listener)) return; // inscrever duas vezes o mesmo é uma vez só
    const embrulho = (_e: unknown, ...args: unknown[]): void => listener(...args);
    porCanal.set(listener, embrulho);
    ipcRenderer.on(channel, embrulho as never);
  },
  off: (channel: string, listener: (...args: unknown[]) => void): void => {
    const porCanal = embrulhos.get(channel);
    const embrulho = porCanal?.get(listener);
    if (porCanal === undefined || embrulho === undefined) return;
    porCanal.delete(listener);
    ipcRenderer.off(channel, embrulho as never);
  },
});

declare global {
  interface Window {
    electron: {
      getEpoch(): number;
      confirmExit(): Promise<void>;
      cancelExit(): Promise<void>;
      requestAuthToken(cmd: string): Promise<{ ok: boolean; token?: string; code?: string }>;
      declareCaptureSession(arg: { sessionId: string | null; kind: 'screen' | 'window' }): Promise<void>;
      on(channel: string, listener: (...args: unknown[]) => void): void;
      off(channel: string, listener: (...args: unknown[]) => void): void;
    };
  }
}
