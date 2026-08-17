// Ciclo de vida dos processos separados.
//
// O orquestrador nunca fala com o host ou o cliente por dentro: ele os **spawna**, lê uma
// linha de JSON do stdout e observa o código de saída. É o que torna `SIGKILL` um evento real
// e não uma simulação — e o que faz o veredito depender do disco, não da memória de quem
// morreu.

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

import { SIGKILL_EXIT } from './kill.ts';

const NODE = process.execPath;

export type HostHandle = {
  readonly port: number;
  readonly proc: ChildProcess;
  /** Espera o processo terminar; devolve o código (ou 137 quando morreu de `SIGKILL`). */
  wait(): Promise<number>;
  /** SIGTERM, e SIGKILL se o prazo estourar. Nunca espera para sempre. */
  shutdown(prazoMs?: number): Promise<number>;
  kill(): void;
};

function distScript(root: string, nome: string): string {
  return join(root, 'dist', 'scripts', nome);
}

/** Sobe o host e espera o handshake `{ready:true,port}`. `null` se ele morreu antes. */
export async function startHost(opts: {
  root: string;
  dir: string;
  adversary?: string;
  killAt?: string;
  port?: number;
}): Promise<HostHandle | null> {
  const proc = spawn(NODE, [distScript(opts.root, 'host-main.js')], {
    env: {
      ...process.env,
      POC07_DIR: opts.dir,
      POC07_ADVERSARY: opts.adversary ?? 'none',
      POC07_KILL_AT: opts.killAt ?? '',
      POC07_PORT: String(opts.port ?? 0),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const port = await new Promise<number | null>((resolve) => {
    let buf = '';
    const aoDados = (c: Buffer): void => {
      buf += c.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      try {
        const m = JSON.parse(buf.slice(0, nl)) as { ready?: boolean; port?: number };
        if (m.ready === true && typeof m.port === 'number') {
          proc.stdout?.off('data', aoDados);
          resolve(m.port);
        }
      } catch {
        resolve(null);
      }
    };
    proc.stdout?.on('data', aoDados);
    proc.once('exit', () => resolve(null));
    setTimeout(() => resolve(null), 20_000).unref?.();
  });

  if (port === null) {
    proc.kill('SIGKILL');
    return null;
  }
  // Drena o resto do stdout/stderr para não encher o pipe e travar o filho.
  proc.stdout?.resume();
  proc.stderr?.resume();

  const wait = (): Promise<number> =>
    new Promise<number>((resolve) => {
      if (proc.exitCode !== null) return resolve(proc.exitCode);
      if (proc.signalCode !== null) return resolve(SIGKILL_EXIT);
      proc.once('exit', (code, signal) => resolve(signal !== null ? SIGKILL_EXIT : (code ?? 0)));
    });

  return {
    port,
    proc,
    wait,
    /**
     * Encerramento ordenado com prazo. `server.close()` do Node só chama de volta quando a
     * **última conexão** fecha, então um socket pendurado seguraria o host para sempre e o
     * orquestrador junto. Depois do prazo, `SIGKILL` — o gate não pode travar, e a
     * durabilidade nunca dependeu de shutdown limpo (§28.3).
     */
    shutdown: async (prazoMs = 5_000) => {
      proc.kill('SIGTERM');
      const timer = setTimeout(() => proc.kill('SIGKILL'), prazoMs);
      timer.unref?.();
      const code = await wait();
      clearTimeout(timer);
      return code;
    },
    kill: () => proc.kill('SIGKILL'),
  };
}

export type ClientResult = {
  /** `null` quando o processo morreu antes de escrever a linha — o caso interessante. */
  readonly saida: Record<string, unknown> | null;
  readonly code: number;
  readonly morreuDeSigkill: boolean;
  readonly stderr: string;
};

/** Roda um cliente até o fim (ou até a morte) e devolve o que ele conseguiu dizer. */
export async function runClient(opts: {
  root: string;
  dir: string;
  port: number;
  author?: string;
  community?: string;
  n?: number;
  killAt?: string;
  phases?: string;
  timeoutMs?: number;
}): Promise<ClientResult> {
  const proc = spawn(NODE, [distScript(opts.root, 'client-main.js')], {
    env: {
      ...process.env,
      POC07_DIR: opts.dir,
      POC07_PORT: String(opts.port),
      POC07_AUTHOR: opts.author ?? '11'.repeat(32),
      POC07_COMMUNITY: opts.community ?? '22'.repeat(32),
      POC07_N: String(opts.n ?? 0),
      POC07_KILL_AT: opts.killAt ?? '',
      POC07_PHASES: opts.phases ?? 'enqueue,flush,project,reconcile',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let out = '';
  let err = '';
  proc.stdout?.on('data', (c: Buffer) => {
    out += c.toString('utf8');
  });
  proc.stderr?.on('data', (c: Buffer) => {
    err += c.toString('utf8');
  });

  const timer = setTimeout(() => proc.kill('SIGKILL'), opts.timeoutMs ?? 120_000);
  timer.unref?.();
  const { code, signal } = await new Promise<{ code: number; signal: string | null }>((resolve) => {
    proc.once('exit', (c, s) => resolve({ code: c ?? 0, signal: s }));
  });
  clearTimeout(timer);

  let saida: Record<string, unknown> | null = null;
  const linha = out.trim().split('\n').at(-1);
  if (linha !== undefined && linha.startsWith('{')) {
    try {
      saida = JSON.parse(linha) as Record<string, unknown>;
    } catch {
      saida = null;
    }
  }
  return { saida, code: signal !== null ? SIGKILL_EXIT : code, morreuDeSigkill: signal === 'SIGKILL', stderr: err };
}
