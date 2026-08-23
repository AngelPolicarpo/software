/**
 * Ponte com o shell Electron (§3.1, §3.4, §3.5).
 *
 * O preload (`app/src/preload/index.ts`) entrega quatro coisas ao renderer, todas por
 * `window.electron` ou por `CustomEvent` no `window`:
 *
 *   - a porta IPC-R transferida por `webContents.postMessage('ipc-r-port')` e repassada pelo
 *     preload ao mundo principal com `window.postMessage(..., [port])` — a única forma de a
 *     porta chegar VIVA aqui, já que o `contextBridge` serializa o que atravessa. Uma porta
 *     NOVA chega a cada núcleo novo (§15.2);
 *   - o epoch corrente e seus bumps (`core-epoch`), o sinal de §15.2;
 *   - os deep links já **parseados** pelo main (`deeplink`) — §3.5(2): o main encaminha
 *     dado estruturado, nunca a string original;
 *   - `requestAuthToken(cmd)`, o único caminho para o token de §15.3. O renderer não o
 *     fabrica: ele nasce no núcleo depois do diálogo nativo.
 *
 * Fora do Electron (`npm run dev` no navegador) nada disso existe. Aqui isso não é um erro
 * a esconder: `conectar()` devolve o motivo e a UI diz que está sem núcleo, em vez de
 * fingir dado.
 */

import { IpcClient } from "./client";
import { IpcCommandError, type RendererPort } from "./frames";

export interface DeepLink {
  route: "join" | "message";
  code?: string;
  ref?: string;
}

export interface PonteElectron {
  getEpoch(): number;
  requestAuthToken(cmd: string): Promise<{ ok: boolean; token?: string; code?: string }>;
  on(channel: string, listener: (...args: unknown[]) => void): void;
  off(channel: string, listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    electron?: PonteElectron;
  }
}

export function pontePresente(): boolean {
  return typeof window !== "undefined" && window.electron !== undefined;
}

/**
 * Espera a porta chegar do preload. A escuta é registrada ANTES de qualquer `await`: a
 * transferência acontece no `did-finish-load`, que pode ser antes deste código rodar em
 * recarga de janela — por isso o listener fica de pé para sempre e a porta mais recente
 * vence.
 */
function esperarPorta(timeoutMs: number): Promise<RendererPort> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", aoRecado);
      reject(new Error("o shell não transferiu a porta IPC-R"));
    }, timeoutMs);
    function aoRecado(ev: MessageEvent): void {
      if ((ev.data as { tipo?: string } | null)?.tipo !== "ipc-r-port") return;
      const porta = ev.ports[0];
      if (porta === undefined) return;
      clearTimeout(timer);
      window.removeEventListener("message", aoRecado);
      resolve(porta as unknown as RendererPort);
    }
    window.addEventListener("message", aoRecado);
  });
}

export interface Conexao {
  readonly cliente: IpcClient;
  readonly coreVersion: string;
  readonly epoch: number;
}

/**
 * Liga o cliente à porta e completa o aperto de mão. O `core-epoch` do main é ouvido para
 * sempre — inclusive depois desta promessa resolver, que é justamente quando o núcleo pode
 * cair (§15.2).
 */
export async function conectar(cliente: IpcClient, timeoutMs = 30_000): Promise<Conexao> {
  if (!pontePresente()) {
    throw new IpcCommandError({
      code: "E_NO_SHELL",
      message: "Esta janela não está rodando dentro do shell Electron do produto",
    });
  }
  window.addEventListener("core-epoch", (ev) => {
    const detalhe = (ev as CustomEvent<{ epoch: number }>).detail;
    if (typeof detalhe?.epoch === "number") cliente.handleCoreEpoch(detalhe.epoch);
  });
  // Cada núcleo novo traz uma porta nova (§15.2 passo 2): o cliente troca de porta e o
  // `hello` que vier por ela fixa o epoch. Ficar preso à primeira porta faria o produto
  // sobreviver ao crash mudo.
  window.addEventListener("message", (ev) => {
    if ((ev.data as { tipo?: string } | null)?.tipo !== "ipc-r-port") return;
    const porta = ev.ports[0];
    if (porta === undefined || !cliente.conectado) return;
    cliente.attach(porta as unknown as RendererPort);
  });
  const porta = await esperarPorta(timeoutMs);
  cliente.attach(porta);
  const hello = await cliente.waitForHello(timeoutMs);
  return { cliente, coreVersion: hello.coreVersion, epoch: hello.epoch };
}

/** Deep links já parseados pelo main. Devolve o cancelador. */
export function ouvirDeepLinks(handler: (link: DeepLink) => void): () => void {
  function aoLink(ev: Event): void {
    const detalhe = (ev as CustomEvent<DeepLink>).detail;
    if (detalhe !== undefined && detalhe !== null) handler(detalhe);
  }
  window.addEventListener("deeplink", aoLink);
  return () => window.removeEventListener("deeplink", aoLink);
}

/**
 * §15.3 — pede ao main o token de uso único para um comando `main-confirmed`. O cancelamento
 * do diálogo nativo é `E_CANCELLED`, um desfecho normal: a UI o trata como "o usuário
 * desistiu", não como falha.
 */
export async function pedirToken(cmd: string): Promise<string> {
  const ponte = window.electron;
  if (ponte === undefined) {
    throw new IpcCommandError({ code: "E_NO_SHELL", message: "Sem shell para confirmar a ação" });
  }
  const r = await ponte.requestAuthToken(cmd);
  if (!r.ok || r.token === undefined) {
    throw new IpcCommandError({
      code: r.code ?? "E_PERMISSION_DENIED",
      message: r.code === "E_CANCELLED" ? "Ação cancelada" : "Confirmação nativa indisponível",
    });
  }
  return r.token;
}
