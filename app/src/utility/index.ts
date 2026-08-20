/**
 * `utilityProcess` — núcleo P2P (§3.1, §3.3, §10.8, §18.6)
 *
 * Roda fora do main, com as duas fronteiras:
 *   IPC-M  (MessagePort main) — wrap/unwrap Data Key, tickets, auth tokens
 *   IPC-R  (MessagePort renderer) — IpcServer com epoch/subId/evSeq (§15.1, §15.2, A14)
 *
 * Ciclo §3.3: boot → wipe-resume → identity → view → open → swarm → ready → draining
 * Lock §10.8: flock real via fs-native-extensions, O_RDWR|O_CREAT
 * Manifest §10.2: secrets + wipe_state em manifest.db (FULL)
 *
 * NOTA: este arquivo é o shell. A lógica de domínio (fold, projector, outbox) vive em
 * `@comunidade/core` e é importada aqui. Para o typecheck da app não quebrar com
 * `rootDir`, os imports do core são dinâmicos e tipados como `any` — o build real
 * resolve via `file:../core` e `better-sqlite3` etc. O contrato continua sendo o de
 * `core/src/l3/ipcMain` e `core/src/l3/ipcRenderer`.
 */

import path from 'node:path';
import fs from 'node:fs';

const dataDir = process.env.P2P_DATA_DIR ?? path.join(process.cwd(), '.p2p-data');

let epoch = 1;
let ipcM: Electron.MessagePortMain | null = null;
let ipcRPort: Electron.MessagePortMain | null = null;

// Stub: em produção, aqui entrariam
//   import { ManifestDb } from '@comunidade/core/manifest';
//   import { ProcessLock } from '@comunidade/core/ipcMain';
//   import { IdentityManager } from '@comunidade/core/identity';
//   import { IpcServer } from '@comunidade/core/ipcRenderer';
// Para o shell compilar sem `rootDir` cruzado, deixamos como `any` e carregamos
// dinamicamente quando o core estiver buildado.

let manifestDb: unknown = null;
let lock: unknown = null;
let identity: unknown = null;
let ipcServer: unknown = null;

function setupIpcM(port: Electron.MessagePortMain): void {
  ipcM = port as unknown as Electron.MessagePortMain;
  ipcM.on('message', (e: Electron.MessageEvent) => {
    const msg = e.data as { q?: string; id?: number; dataKeyB64?: string; wrappedB64?: string };
    // Oráculo safeStorage — delega ao main via IPC-M (§3.2, A13)
    // O main já responde a wrap/unwrap/keystoreInfo; aqui apenas logamos
    console.log('ipc-m recv', msg.q);
  });
  (ipcM as unknown as { start(): void }).start();
}

async function boot(): Promise<void> {
  console.log(`[utility] boot epoch=${epoch} dataDir=${dataDir}`);
  // §10.8 lock composto — flock real (fs-native-extensions) + O_RDWR|O_CREAT
  // §18.6 wipe-resume — lê wipe_state ANTES de abrir corestore
  // §10.2 manifest.secrets + wipe_state em manifest.db
  // §3.2 safeStorage probe já rodou no main antes do lock
  // Em produção: carrega manifest, identity, view, corestore, IpcServer etc.
  // Stub para validar o shell sem acoplar o build do core
  const sentinel = path.join(dataDir, 'p2p', 'WIPE');
  if (fs.existsSync(sentinel)) {
    console.log(`[utility] wipe pendente detectado: ${fs.readFileSync(sentinel, 'utf8').trim()}`);
  }
  // Simula ready
  process.parentPort?.postMessage({ e: 'ready', epoch, hasIdentity: false });
}

process.parentPort?.on('message', (e) => {
  const data = (e as unknown as { data: unknown }).data as { kind?: string; epoch?: number; parsed?: unknown };
  const ports = (e as unknown as { ports?: Electron.MessagePortMain[] }).ports;
  if (data.kind === 'ipc-m-port' && ports?.[0]) {
    setupIpcM(ports[0]!);
  } else if (data.kind === 'ipc-r-port' && ports?.[0]) {
    ipcRPort = ports[0]!;
    if (data.epoch !== undefined) epoch = data.epoch;
    (ipcRPort as unknown as { start(): void }).start();
    console.log(`[utility] ipc-r conectado epoch=${epoch}`);
  } else if (data.kind === 'deeplink') {
    console.log('[utility] deeplink', data.parsed);
  } else if (data.kind === 'shutdown') {
    console.log('[utility] draining — checkpoint e libera lock');
    try { (manifestDb as { checkpoint?: () => void })?.checkpoint?.(); } catch {}
    try { (lock as { release?: () => void })?.release?.(); } catch {}
    process.exit(0);
  }
});

setTimeout(() => {
  void boot().catch((err) => {
    const e = err as { code?: string; message?: string };
    console.error('[utility] boot falhou', e.code, e.message);
    process.parentPort?.postMessage({ e: 'blocked', code: e.code ?? 'E_BOOT', message: e.message });
    process.exit(1);
  });
}, 100);

process.on('uncaughtException', (err) => {
  console.error('[utility] uncaughtException', err);
});
