// `keystore` — L0, ponte IPC-M para wrap/unwrap da Data Key (§4, §3.2, §5.4, A13).
//
// §4: não depende de ninguém.
// §4: NUNCA vê a chave de identidade — apenas embrulha/desembrulha a Data Key simétrica.

import fs from 'node:fs';
import path from 'node:path';

export interface KeystoreOracle {
  wrapDataKey(dataKeyB64: string): Promise<string>;
  unwrapDataKey(wrappedB64: string): Promise<string>;
}

export interface SafeStorage {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export type KeystoreStatus = 'secure' | 'insecure-fallback' | 'degraded';

export class FallbackKeystoreOracle implements KeystoreOracle {
  status: 'insecure-fallback' = 'insecure-fallback';

  async wrapDataKey(dataKeyB64: string): Promise<string> {
    // Modo fallback/inseguro quando não há secret store (§3.2 L-2)
    return Buffer.from(`insecure:${dataKeyB64}`, 'utf8').toString('base64');
  }

  async unwrapDataKey(wrappedB64: string): Promise<string> {
    const raw = Buffer.from(wrappedB64, 'base64').toString('utf8');
    if (!raw.startsWith('insecure:')) {
      throw new Error('Formato de fallback inválido');
    }
    return raw.slice('insecure:'.length);
  }
}

/**
 * Oráculo real via `safeStorage` (Electron main).
 * §3.2: só a Data Key atravessa IPC-M, nunca a identidade.
 */
export class ElectronSafeStorageOracle implements KeystoreOracle {
  status: 'secure' = 'secure';
  readonly #safeStorage: SafeStorage;

  constructor(safeStorage: SafeStorage) {
    this.#safeStorage = safeStorage;
  }

  isAvailable(): boolean {
    return this.#safeStorage.isEncryptionAvailable();
  }

  backend(): string {
    try {
      return this.#safeStorage.getSelectedStorageBackend();
    } catch {
      return 'unknown';
    }
  }

  isDegraded(): boolean {
    // A13(5): degradado é isEncryptionAvailable() === false depois do probe,
    // nunca o nome do backend. getSelectedStorageBackend reporta intenção, não capacidade.
    return !this.#safeStorage.isEncryptionAvailable();
  }

  async wrapDataKey(dataKeyB64: string): Promise<string> {
    const wrapped = this.#safeStorage.encryptString(dataKeyB64);
    return wrapped.toString('base64');
  }

  async unwrapDataKey(wrappedB64: string): Promise<string> {
    const plain = this.#safeStorage.decryptString(Buffer.from(wrappedB64, 'base64'));
    return plain;
  }
}

/**
 * Oráculo via IPC-M para o utilityProcess.
 * O núcleo nunca chama safeStorage diretamente; pergunta ao main (A13).
 */
export class IpcKeystoreOracle implements KeystoreOracle {
  status: 'secure' = 'secure';
  readonly #port: {
    postMessage(msg: unknown): void;
    onMessage(listener: (msg: unknown) => void): void;
  };
  #nextId = 1;
  readonly #pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(port: { postMessage(msg: unknown): void; onMessage(listener: (msg: unknown) => void): void }) {
    this.#port = port;
    this.#port.onMessage((msg: unknown) => {
      const m = msg as { id?: number; a?: string; wrappedB64?: string; dataKeyB64?: string; available?: boolean; backend?: string; code?: string; message?: string };
      if (m.id === undefined || m.a === undefined) return;
      const p = this.#pending.get(m.id);
      if (p === undefined) return;
      this.#pending.delete(m.id);
      if (m.a === 'error') {
        p.reject(Object.assign(new Error(m.message ?? 'keystore error'), { code: m.code ?? 'E_KEYSTORE' }));
      } else if (m.a === 'wrapDataKey' && m.wrappedB64 !== undefined) {
        p.resolve(m.wrappedB64);
      } else if (m.a === 'unwrapDataKey' && m.dataKeyB64 !== undefined) {
        p.resolve(m.dataKeyB64);
      } else if (m.a === 'keystoreInfo') {
        p.resolve({ available: m.available ?? false, backend: m.backend ?? 'unknown' });
      } else {
        p.reject(new Error('Resposta de keystore inválida'));
      }
    });
  }

  #ask<T>(q: unknown): Promise<T> {
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        if (this.#pending.delete(id)) reject(new Error('timeout no oráculo do main'));
      }, 20_000);
      this.#pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v as T); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      this.#port.postMessage({ ...(q as object), id });
    });
  }

  async wrapDataKey(dataKeyB64: string): Promise<string> {
    return this.#ask<string>({ q: 'wrapDataKey', dataKeyB64 });
  }

  async unwrapDataKey(wrappedB64: string): Promise<string> {
    return this.#ask<string>({ q: 'unwrapDataKey', wrappedB64 });
  }

  async keystoreInfo(): Promise<{ available: boolean; backend: string }> {
    return this.#ask<{ available: boolean; backend: string }>({ q: 'keystoreInfo' });
  }
}

// --- Probe --password-store (A13 5+6) -------------------------------------------

const CANDIDATE_BACKENDS = ['gnome-libsecret', 'kwallet6', 'kwallet5'] as const;

/**
 * Probe de backend de secret store no Linux (A13 5+6).
 * Deve rodar ANTES do lock composto (§10.8) e ANTES de app.whenReady() — cada candidato
 * custa um relaunch, e o switch só vale antes do ready. Preserva argv para não perder
 * deep link (§3.5 4).
 *
 * Retorna `true` se relançou (o processo atual deve encerrar), `false` se pode continuar.
 * Em Electron real, o caller deve verificar `app.isReady()` antes de chamar.
 */
export function probeSafeStorageIfNeeded(opts: {
  app: { commandLine: { hasSwitch(name: string): boolean; getSwitchValue(name: string): string; appendSwitch(name: string, value: string): void }; relaunch(opts?: { args: string[] }): void; exit(code?: number): void };
  safeStorage: SafeStorage;
  dataDir: string;
  argv: string[];
}): boolean {
  if (process.platform !== 'linux') return false;
  // Se o usuário já forçou um backend, não probe.
  if (opts.app.commandLine.hasSwitch('password-store')) return false;
  // Se a API já diz disponível, não precisa probe.
  if (opts.safeStorage.isEncryptionAvailable()) return false;
  const backend = (() => {
    try { return opts.safeStorage.getSelectedStorageBackend(); } catch { return 'basic_text'; }
  })();
  // Só probe quando caiu em basic_text por autodetecção — caso A do gate G10.
  if (backend !== 'basic_text') return false;

  // Persistência do backend aprovado (A13 6): evita repetir probe no próximo boot.
  const probeFile = path.join(opts.dataDir, 'keystore-backend');
  try {
    const persisted = fs.readFileSync(probeFile, 'utf8').trim();
    if (persisted && CANDIDATE_BACKENDS.includes(persisted as typeof CANDIDATE_BACKENDS[number])) {
      // Já temos um backend aprovado persistido — aplica e relança uma vez.
      opts.app.commandLine.appendSwitch('password-store', persisted);
      // Preserva argv para deep link
      opts.app.relaunch({ args: opts.argv.slice(1) });
      opts.app.exit(0);
      return true;
    }
  } catch {}

  // Tenta cada candidato; o primeiro que tornar isEncryptionAvailable true vence.
  // Como requires relaunch para testar, este loop na verdade é executado incrementalmente:
  // cada boot tenta o próximo candidato até esgotar. Para implementação real, o main
  // deve persistir o índice do próximo candidato e relançar.
  // Aqui deixamos o contrato para o shell Electron implementar o loop completo —
  // este helper apenas documenta a ordem e expõe a lista.

  // Se chegou aqui sem backend persistido, o caller deve iniciar o loop de probe.
  // Por simplicidade no core, não relançamos automaticamente sem estado de índice.
  return false;
}

/** Verifica se o keystore está degradado e se precisa de aceite explícito (A13 5, L-2). */
export function isKeystoreDegraded(safeStorage: SafeStorage): boolean {
  try {
    return !safeStorage.isEncryptionAvailable();
  } catch {
    return true;
  }
}

/** Caminho do arquivo de aceite do modo inseguro (persistido, como em poc-10-identity). */
export function keystoreAcceptedPath(dataDir: string): string {
  return path.join(dataDir, 'keystore-accepted');
}

export function hasAcceptedInsecure(dataDir: string): boolean {
  return fs.existsSync(keystoreAcceptedPath(dataDir));
}

export function acceptInsecure(dataDir: string, backend: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(keystoreAcceptedPath(dataDir), JSON.stringify({ acceptedAt: new Date().toISOString(), backend }), 'utf8');
}
