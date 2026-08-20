// `ipcMain` — L3, fronteira de controle e canal IPC-M com o processo main (§4, §3.1, §3.2, §3.5, §15.3, §15.7).
//
// §4: depende de L2.
// §4: NUNCA contém regra de negócio de domínio.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const WIPE_STAGES = [
  'none',
  'requested',
  'swarm-down',
  'cores-closed',
  'view-deleted',
  'manifest-deleted',
  'key-wiped',
  'done',
] as const;

export type WipeStage = (typeof WIPE_STAGES)[number];

const RE_JOIN = /^comunidadep2p:\/\/join\/([0-9A-HJKMNP-TV-Z]{16})$/;
const RE_MSG = /^comunidadep2p:\/\/m\/([A-Za-z0-9_-]{86})$/;

export type DeepLink =
  | { route: 'join'; code: string }
  | { route: 'message'; ref: string };

export function parseDeepLink(raw: string): DeepLink | null {
  const j = RE_JOIN.exec(raw.trim());
  if (j !== null) return { route: 'join', code: j[1] as string };
  const m = RE_MSG.exec(raw.trim());
  if (m !== null) return { route: 'message', ref: m[1] as string };
  return null;
}

export class AuthTokenStore {
  readonly #tokens = new Map<
    string,
    { cmd: string; expiresAt: number }
  >();

  issue(cmd: string, ttlMs = 60_000): string {
    const token = crypto.randomBytes(32).toString('hex');
    this.#tokens.set(token, { cmd, expiresAt: Date.now() + ttlMs });
    return token;
  }

  consume(token: string, cmd: string): boolean {
    const entry = this.#tokens.get(token);
    if (entry === undefined) return false;
    this.#tokens.delete(token);
    if (Date.now() > entry.expiresAt) return false;
    return entry.cmd === cmd;
  }

  prune(): void {
    const now = Date.now();
    for (const [t, entry] of this.#tokens.entries()) {
      if (now > entry.expiresAt) this.#tokens.delete(t);
    }
  }
}

export class ProcessLock {
  readonly #dataDir: string;
  #lockFd: number | null = null;

  constructor(dataDir: string) {
    this.#dataDir = dataDir;
  }

  get isLocked(): boolean {
    return this.#lockFd !== null;
  }

  acquire(): void {
    fs.mkdirSync(this.#dataDir, { recursive: true });
    const lockPath = path.join(this.#dataDir, 'LOCK');
    let fd: number;
    try {
      fd = fs.openSync(lockPath, 'r+');
    } catch {
      fd = fs.openSync(lockPath, 'w+');
    }
    try {
      const content = fs.readFileSync(lockPath, 'utf8');
      if (content.trim().length > 0) {
        try {
          const parsed = JSON.parse(content) as { pid?: unknown };
          if (
            parsed !== null &&
            typeof parsed === 'object' &&
            typeof (parsed as { pid?: unknown }).pid === 'number'
          ) {
            const pid = (parsed as { pid: number }).pid;
            if (this.#isPidAlive(pid) && pid !== process.pid) {
              fs.closeSync(fd);
              const err = Object.assign(
                new Error(`Diretório já em uso pelo processo ${pid}`),
                { code: 'E_CORE_ALREADY_RUNNING', pid },
              );
              throw err;
            }
          }
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === 'E_CORE_ALREADY_RUNNING') throw e;
        }
      }
      fs.ftruncateSync(fd, 0);
      fs.writeSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          install_id: 'default',
          time: Date.now(),
        }),
        0,
      );
      this.#lockFd = fd;
    } catch (err) {
      try {
        fs.closeSync(fd);
      } catch {}
      throw err;
    }
  }

  release(): void {
    if (this.#lockFd !== null) {
      try {
        fs.closeSync(this.#lockFd);
      } catch {}
      this.#lockFd = null;
    }
  }

  #isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
