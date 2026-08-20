// `ipcMain` — L3, fronteira de controle e canal IPC-M com o processo main (§4, §3.1, §3.2, §3.5, §15.3, §15.7).
//
// §4: depende de L2.
// §4: NUNCA contém regra de negócio de domínio.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// `fs-native-extensions` fornece `flock`/`LockFileEx` reais (§10.8, A16).
// No Windows `LockFileEx` é obrigatório; `ftruncate` em fd `a+` falha com EPERM.
// O piso portátil é `O_RDWR|O_CREAT` + `tryLock` — medido em G10 §3.1.2 (win32-x64 9/10 reprovados).
let fsext: { tryLockSync?: (fd: number) => boolean; tryLock?: (fd: number) => boolean; unlockSync?: (fd: number) => void; unlock?: (fd: number) => void } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  fsext = require('fs-native-extensions') as typeof fsext;
} catch {
  fsext = null;
}

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

  /** `install_id` persistido — distingue reinstalações no mesmo diretório (§10.8). */
  #installId(): string {
    const file = path.join(this.#dataDir, 'install-id');
    try {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (existing.length > 0) return existing;
    } catch {}
    const buf = crypto.randomBytes(16);
    const id = buf.toString('hex');
    try {
      fs.mkdirSync(this.#dataDir, { recursive: true });
      fs.writeFileSync(file, id, 'utf8');
    } catch {}
    return id;
  }

  #readOwner(lockPath: string): { pid?: number; install_id?: string; installId?: string } | null {
    try {
      const txt = fs.readFileSync(lockPath, 'utf8').trim();
      if (!txt) return null;
      return JSON.parse(txt) as { pid?: number; install_id?: string; installId?: string };
    } catch {
      return null;
    }
  }

  acquire(): void {
    fs.mkdirSync(this.#dataDir, { recursive: true });
    const lockPath = path.join(this.#dataDir, 'LOCK');
    // §10.8 / G10 §3.1.2: O_RDWR|O_CREAT é o único modo portátil.
    // `a+` recusa ftruncate no Windows (EPERM); `w+` truncaria antes do tryLock e apagaria
    // o PID do dono legítimo quando o lock está ocupado.
    const fd = fs.openSync(lockPath, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o600);
    try {
      // Se fs-native-extensions estiver disponível, usa flock/LockFileEx real.
      // Sem ele (ex.: teste sem rebuild), cai no fallback de PID check — suficiente para CI,
      // mas sem garantia de atomicidade entre processos.
      if (fsext !== null) {
        const tryLock: ((fd: number) => boolean) | undefined =
          (fsext.tryLockSync as ((fd: number) => boolean) | undefined) ??
          (fsext.tryLock as ((fd: number) => boolean) | undefined);
        if (tryLock !== undefined) {
          let locked = false;
          try {
            locked = tryLock(fd);
          } catch {
            locked = false;
          }
          if (!locked) {
            const owner = this.#readOwner(lockPath);
            fs.closeSync(fd);
            const err = Object.assign(
              new Error(`Diretório já em uso pelo processo ${owner?.pid ?? 'desconhecido'}`),
              { code: 'E_CORE_ALREADY_RUNNING', pid: owner?.pid },
            );
            throw err;
          }
        } else {
          // Fallback quando a API não tem tryLockSync
          const owner = this.#readOwner(lockPath);
          if (
            owner !== null &&
            typeof owner.pid === 'number' &&
            owner.pid !== process.pid &&
            this.#isPidAlive(owner.pid)
          ) {
            const curId = this.#installId();
            const ownerId = (owner.install_id ?? owner.installId) as string | undefined;
            // Lock órfão de outro install_id é quebrado automaticamente (§10.8) — com flock
            // isso é implícito (SO libera), sem flock precisamos verificar.
            if (ownerId === undefined || ownerId === curId) {
              fs.closeSync(fd);
              const err = Object.assign(
                new Error(`Diretório já em uso pelo processo ${owner.pid}`),
                { code: 'E_CORE_ALREADY_RUNNING', pid: owner.pid },
              );
              throw err;
            }
          }
        }
      } else {
        // Fallback sem fs-native-extensions — comportamento anterior, mas com O_RDWR|O_CREAT
        const owner = this.#readOwner(lockPath);
        if (
          owner !== null &&
          typeof owner.pid === 'number' &&
          owner.pid !== process.pid &&
          this.#isPidAlive(owner.pid)
        ) {
          fs.closeSync(fd);
          const err = Object.assign(
            new Error(`Diretório já em uso pelo processo ${owner.pid}`),
            { code: 'E_CORE_ALREADY_RUNNING', pid: owner.pid },
          );
          throw err;
        }
      }

      // Somente com o lock em mãos (flock ou fallback) podemos truncar e escrever.
      // Detecta órfão: se o arquivo continha PID morto ou install_id diferente, log lock.stolen.
      const prevOwner = this.#readOwner(lockPath);
      if (
        prevOwner !== null &&
        typeof prevOwner.pid === 'number' &&
        prevOwner.pid !== process.pid
      ) {
        const alive = this.#isPidAlive(prevOwner.pid);
        const curId = this.#installId();
        const prevId = (prevOwner.install_id ?? prevOwner.installId) as string | undefined;
        if (!alive || (prevId !== undefined && prevId !== curId)) {
          // lock órfão quebrado automaticamente — §10.8 exige log lock.stolen
          try {
            // não há logger aqui (L0→L3 sem dependência); usa stderr para auditoria
            process.stderr.write(`lock.stolen ${JSON.stringify({ prevPid: prevOwner.pid, prevInstallId: prevId, curInstallId: curId })}\n`);
          } catch {}
        }
      }

      const installId = this.#installId();
      fs.ftruncateSync(fd, 0);
      fs.writeSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          install_id: installId,
          installId,
          time: Date.now(),
        }),
        0,
      );
      try {
        fs.fsyncSync(fd);
      } catch {}
      this.#lockFd = fd;
    } catch (err) {
      try {
        // Se flock foi adquirido, precisa liberar antes de fechar
        if (fsext !== null) {
          const unlock: ((fd: number) => void) | undefined =
            (fsext.unlockSync as ((fd: number) => void) | undefined) ??
            (fsext.unlock as ((fd: number) => void) | undefined);
          try {
            if (unlock !== undefined) unlock(fd);
          } catch {}
        }
        fs.closeSync(fd);
      } catch {}
      throw err;
    }
  }

  release(): void {
    if (this.#lockFd !== null) {
      try {
        if (fsext !== null) {
          const unlock: ((fd: number) => void) | undefined =
            (fsext.unlockSync as ((fd: number) => void) | undefined) ??
            (fsext.unlock as ((fd: number) => void) | undefined);
          if (unlock !== undefined) {
            try {
              unlock(this.#lockFd);
            } catch {}
          }
        }
      } catch {}
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
