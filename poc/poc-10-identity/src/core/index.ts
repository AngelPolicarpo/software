/**
 * Núcleo do POC-10 — gate G10. Roda no `utilityProcess`.
 *
 * Responsabilidades, e a regra normativa de cada uma:
 *   A13    gera a identidade aqui dentro; cifra a semente com uma Data Key; só a Data Key
 *          atravessa a IPC-M para o main embrulhar com `safeStorage`. A semente nunca sai.
 *   §10.8  adquire o lock composto na ordem exata e libera na ordem inversa.
 *   §18.6  `wipe` como máquina de estados retomável, gravada com FULL ANTES de cada etapa.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import type {
  CoreCommand, CoreEvent, CoreOut, CoreToMain, LockStage, MainToCore, WipeStage, WithoutId,
} from '../protocol/messages.js';

const T0 = Date.now();
const DATA_DIR = process.env.POC10_DATA_DIR ?? path.join(process.cwd(), '.poc10-data');
const P2P_DIR = path.join(DATA_DIR, 'p2p');
const LOCK_PATH = path.join(P2P_DIR, 'LOCK');
const WIPE_SENTINEL = path.join(P2P_DIR, 'WIPE');
const IDENTITY_PATH = path.join(DATA_DIR, 'identity.enc');
const DATAKEY_PATH = path.join(DATA_DIR, 'datakey.wrapped');
const ACCEPT_PATH = path.join(DATA_DIR, 'keystore-accepted');
const INSTALL_ID_PATH = path.join(DATA_DIR, 'install-id');

/** Injeção de falha: mata o processo logo APÓS gravar este estágio de wipe. */
const WIPE_CRASH_AT = process.env.POC10_WIPE_CRASH_AT ?? '';
/** Injeção de falha: mata o processo logo APÓS adquirir esta etapa do lock. */
const LOCK_CRASH_AT = process.env.POC10_LOCK_CRASH_AT ?? '';

const sodium = require('sodium-native');
const fsext = require('fs-native-extensions');
const Database = require('better-sqlite3');
const Corestore = require('corestore');

function out(m: CoreOut): void { process.parentPort.postMessage(m); }
function log(level: 'info' | 'warn' | 'error', msg: string): void { out({ e: 'log', level, msg }); }

// --- oráculo do main (A13) ---------------------------------------------------------------
let askId = 1;
const asks = new Map<number, { resolve: (v: MainToCore) => void; reject: (e: Error) => void }>();
function ask(q: WithoutId<CoreToMain>): Promise<MainToCore> {
  const id = askId++;
  return new Promise((resolve, reject) => {
    asks.set(id, { resolve, reject });
    setTimeout(() => { if (asks.delete(id)) reject(new Error('timeout no oráculo do main')); }, 20_000);
    out({ ...q, id } as CoreToMain);
  });
}

// --- estado ------------------------------------------------------------------------------
let lockFd: number | null = null;
const lockStages: LockStage[] = [];
let store: any = null;
let manifestDb: any = null;
let viewDb: any = null;
/** A semente vive SÓ aqui, em memória, e nunca entra em nenhum quadro de saída. */
let identitySeed: Buffer | null = null;
let identityPk: Buffer | null = null;
let keystore = { available: false, backend: 'desconhecido' };

function installId(): string {
  if (!fs.existsSync(INSTALL_ID_PATH)) {
    const b = Buffer.alloc(16);
    sodium.randombytes_buf(b);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(INSTALL_ID_PATH, b.toString('hex'));
  }
  return fs.readFileSync(INSTALL_ID_PATH, 'utf8').trim();
}

// --- §10.8, etapa 2: lock de arquivo com PID e install_id dentro --------------------------
type LockOwner = { pid: number; installId: string };

function readLockOwner(): LockOwner | null {
  try {
    const txt = fs.readFileSync(LOCK_PATH, 'utf8').trim();
    return txt ? (JSON.parse(txt) as LockOwner) : null;
  } catch { return null; }
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireFileLock(): void {
  fs.mkdirSync(P2P_DIR, { recursive: true });
  // `O_RDWR|O_CREAT` e NÃO `'a+'`: no Windows um fd em modo append recusa `ftruncate` com
  // EPERM, e o `'w+'` não serve porque truncaria ANTES do `tryLock` — apagando o PID do
  // dono legítimo quando o lock está ocupado. Medido no alvo win32-x64 em 2026-08-16.
  const fd = fs.openSync(LOCK_PATH, fs.constants.O_RDWR | fs.constants.O_CREAT);
  if (!fsext.tryLock(fd)) {
    const owner = readLockOwner();
    fs.closeSync(fd);
    // §10.8: lock órfão (PID inexistente ou de outro install_id) é quebrado automaticamente.
    // Um `flock` morre com o processo, então chegar aqui com dono vivo é conflito real.
    const err = Object.assign(
      new Error(`núcleo já em execução (pid ${owner?.pid ?? 'desconhecido'})`),
      { code: 'E_CORE_ALREADY_RUNNING' },
    );
    throw err;
  }
  const owner: LockOwner = { pid: process.pid, installId: installId() };
  fs.ftruncateSync(fd, 0);
  fs.writeSync(fd, JSON.stringify(owner), 0);
  fs.fsyncSync(fd);
  lockFd = fd;
}

function releaseFileLock(): void {
  if (lockFd === null) return;
  try { fsext.unlock(lockFd); } catch { /* já liberado */ }
  try { fs.closeSync(lockFd); } catch { /* já fechado */ }
  lockFd = null;
}

function maybeCrash(kind: 'lock' | 'wipe', stage: string): void {
  const want = kind === 'lock' ? LOCK_CRASH_AT : WIPE_CRASH_AT;
  if (want && want === stage) {
    log('warn', `injeção de falha: SIGKILL após ${kind}=${stage}`);
    process.kill(process.pid, 'SIGKILL');
  }
}

// --- wipe_state em manifest.db, gravado com FULL antes de cada etapa (§18.6) --------------
function setWipeStage(stage: WipeStage): void {
  if (manifestDb) {
    manifestDb.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
      .run('wipe_state', stage);
  }
  out({ e: 'wipeStage', stage });
}

function getWipeStage(): WipeStage {
  if (fs.existsSync(WIPE_SENTINEL)) return (fs.readFileSync(WIPE_SENTINEL, 'utf8').trim() || 'manifest-deleted') as WipeStage;
  if (!manifestDb) return 'none';
  const row = manifestDb.prepare('SELECT v FROM meta WHERE k = ?').get('wipe_state') as { v?: string } | undefined;
  return (row?.v as WipeStage) ?? 'none';
}

/**
 * Lê `wipe_state` SEM abrir o corestore, para a retomada de §18.6 poder acontecer "antes de
 * qualquer outra coisa" (§3.3).
 *
 * Por que não basta abrir tudo e depois checar: retomar de um estágio igual ou posterior a
 * `view-deleted` pula `cores-closed`, e então `key-wiped` remove o diretório do RocksDB que
 * este mesmo processo acabou de abrir. A reabertura seguinte falha com
 * "lock hold by current process ... No locks available". Medido em 2026-08-16.
 */
function readWipeStageBeforeOpening(): WipeStage {
  if (fs.existsSync(WIPE_SENTINEL)) return (fs.readFileSync(WIPE_SENTINEL, 'utf8').trim() || 'manifest-deleted') as WipeStage;
  const p = path.join(DATA_DIR, 'manifest.db');
  if (!fs.existsSync(p)) return 'none';
  let db: any = null;
  try {
    db = new Database(p, { readonly: true });
    const row = db.prepare('SELECT v FROM meta WHERE k = ?').get('wipe_state') as { v?: string } | undefined;
    return (row?.v as WipeStage) ?? 'none';
  } catch {
    return 'none';
  } finally {
    try { db?.close(); } catch { /* nada a fazer */ }
  }
}

// --- abertura do lock composto, na ordem de §10.8 -----------------------------------------
async function openComposite(): Promise<void> {
  // Etapa 1 (`app.requestSingleInstanceLock`) é do MAIN; ele só forka o núcleo se a tiver.
  if (!lockStages.includes('app-instance')) lockStages.push('app-instance');
  maybeCrash('lock', 'app-instance');

  if (lockFd === null) acquireFileLock();
  if (!lockStages.includes('lock-file')) lockStages.push('lock-file');
  maybeCrash('lock', 'lock-file');

  try {
    store = new Corestore(path.join(P2P_DIR, 'store'));
    await store.ready();
    if (!lockStages.includes('corestore-rocksdb')) lockStages.push('corestore-rocksdb');
    maybeCrash('lock', 'corestore-rocksdb');

    manifestDb = new Database(path.join(DATA_DIR, 'manifest.db'));
    for (const p of ['journal_mode = WAL', 'synchronous = FULL', 'foreign_keys = OFF', 'busy_timeout = 5000']) manifestDb.pragma(p);
    manifestDb.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    viewDb = new Database(path.join(DATA_DIR, 'view.db'));
    for (const p of ['journal_mode = WAL', 'synchronous = NORMAL', 'foreign_keys = OFF', 'busy_timeout = 5000']) viewDb.pragma(p);
    if (!lockStages.includes('sqlite')) lockStages.push('sqlite');
    maybeCrash('lock', 'sqlite');
  } catch (err) {
    // §10.8: falha em (3) ou (4) libera (2) antes de encerrar; nunca deixa lock pendurado.
    releaseFileLock();
    throw err;
  }
}

/** Ordem inversa da aquisição; o LOCK é sempre o último a sair. */
function closeComposite(): void {
  try { viewDb?.close(); } catch { /* já fechado */ }
  try { manifestDb?.close(); } catch { /* já fechado */ }
  viewDb = null; manifestDb = null;
  try { store?.close(); } catch { /* já fechado */ }
  store = null;
  releaseFileLock();
}

// --- identidade (A13) ---------------------------------------------------------------------
const SEED_BYTES = 32;

function newSeed(): Buffer {
  // Semente determinística quando o harness injeta uma: a varredura de disco/log/IPC-R
  // precisa saber QUAL padrão de bytes procurar. O núcleo nunca a escreve em lugar nenhum.
  const hex = process.env.POC10_TEST_SEED;
  if (hex && hex.length === SEED_BYTES * 2) return Buffer.from(hex, 'hex');
  const s = Buffer.alloc(SEED_BYTES);
  sodium.randombytes_buf(s);
  return s;
}

function secretboxSeal(plain: Buffer, key: Buffer): Buffer {
  const nonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES);
  sodium.randombytes_buf(nonce);
  const c = Buffer.alloc(plain.length + sodium.crypto_secretbox_MACBYTES);
  sodium.crypto_secretbox_easy(c, plain, nonce, key);
  return Buffer.concat([nonce, c]);
}

function secretboxOpen(sealed: Buffer, key: Buffer): Buffer {
  const n = sodium.crypto_secretbox_NONCEBYTES;
  const nonce = sealed.subarray(0, n);
  const c = sealed.subarray(n);
  const m = Buffer.alloc(c.length - sodium.crypto_secretbox_MACBYTES);
  if (!sodium.crypto_secretbox_open_easy(m, c, nonce, key)) {
    throw Object.assign(new Error('não foi possível decifrar'), { code: 'E_DECRYPT' });
  }
  return m;
}

function derivePk(seed: Buffer): Buffer {
  const pk = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
  const sk = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
  sodium.crypto_sign_seed_keypair(pk, sk, seed);
  sodium.sodium_memzero(sk);
  return pk;
}

async function loadOrCreateIdentity(): Promise<{ created: boolean }> {
  if (fs.existsSync(IDENTITY_PATH) && fs.existsSync(DATAKEY_PATH)) {
    const reply = await ask({ q: 'unwrapDataKey', wrappedB64: fs.readFileSync(DATAKEY_PATH, 'base64') });
    if (reply.a !== 'unwrapDataKey') throw Object.assign(new Error((reply as { message: string }).message), { code: 'E_KEYSTORE' });
    const dataKey = Buffer.from(reply.dataKeyB64, 'base64');
    identitySeed = secretboxOpen(fs.readFileSync(IDENTITY_PATH), dataKey);
    sodium.sodium_memzero(dataKey);
    identityPk = derivePk(identitySeed);
    return { created: false };
  }

  identitySeed = newSeed();
  identityPk = derivePk(identitySeed);
  const dataKey = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES);
  sodium.randombytes_buf(dataKey);

  const reply = await ask({ q: 'wrapDataKey', dataKeyB64: dataKey.toString('base64') });
  if (reply.a !== 'wrapDataKey') throw Object.assign(new Error((reply as { message: string }).message), { code: 'E_KEYSTORE' });

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(IDENTITY_PATH, secretboxSeal(identitySeed, dataKey));
  fs.writeFileSync(DATAKEY_PATH, Buffer.from(reply.wrappedB64, 'base64'));
  sodium.sodium_memzero(dataKey);
  return { created: true };
}

// --- export/import com frase secreta -------------------------------------------------------
function keyFromPassphrase(passphrase: string, salt: Buffer): Buffer {
  const key = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES);
  sodium.crypto_pwhash(
    key, Buffer.from(passphrase), salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_DEFAULT,
  );
  return key;
}

function exportIdentity(passphrase: string): string {
  if (!identitySeed) throw Object.assign(new Error('sem identidade'), { code: 'E_NO_IDENTITY' });
  const salt = Buffer.alloc(sodium.crypto_pwhash_SALTBYTES);
  sodium.randombytes_buf(salt);
  const key = keyFromPassphrase(passphrase, salt);
  const bundle = Buffer.concat([salt, secretboxSeal(identitySeed, key)]);
  sodium.sodium_memzero(key);
  return bundle.toString('base64');
}

async function importIdentity(bundleB64: string, passphrase: string): Promise<{ publicKeyHex: string }> {
  const bundle = Buffer.from(bundleB64, 'base64');
  const salt = bundle.subarray(0, sodium.crypto_pwhash_SALTBYTES);
  const key = keyFromPassphrase(passphrase, salt);
  let seed: Buffer;
  try {
    seed = secretboxOpen(bundle.subarray(sodium.crypto_pwhash_SALTBYTES), key);
  } finally {
    sodium.sodium_memzero(key);
  }
  identitySeed = seed;
  identityPk = derivePk(seed);

  const dataKey = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES);
  sodium.randombytes_buf(dataKey);
  const reply = await ask({ q: 'wrapDataKey', dataKeyB64: dataKey.toString('base64') });
  if (reply.a !== 'wrapDataKey') throw Object.assign(new Error('keystore indisponível'), { code: 'E_KEYSTORE' });
  fs.writeFileSync(IDENTITY_PATH, secretboxSeal(seed, dataKey));
  fs.writeFileSync(DATAKEY_PATH, Buffer.from(reply.wrappedB64, 'base64'));
  sodium.sodium_memzero(dataKey);
  return { publicKeyHex: identityPk.toString('hex') };
}

// --- §18.6 wipe retomável -------------------------------------------------------------------
function rmIfExists(p: string): void {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* já foi */ }
}

async function runWipe(from: WipeStage): Promise<{ completou: boolean; retomadoDe: WipeStage }> {
  const order: WipeStage[] = ['requested', 'swarm-down', 'cores-closed', 'view-deleted', 'manifest-deleted', 'key-wiped', 'done'];
  const start = from === 'none' ? 0 : Math.max(0, order.indexOf(from));

  for (let i = start; i < order.length; i++) {
    const stage = order[i]!;

    // O estado é gravado ANTES da etapa. Se o processo morrer no meio, o boot seguinte
    // sabe que aquela etapa pode ter ficado pela metade e a refaz — todas são idempotentes.
    if (stage === 'manifest-deleted') {
      // A partir daqui não há mais banco onde gravar: o sentinela assume.
      fs.mkdirSync(P2P_DIR, { recursive: true });
      fs.writeFileSync(WIPE_SENTINEL, stage);
    } else if (stage !== 'done') {
      setWipeStage(stage);
    }
    maybeCrash('wipe', stage);

    switch (stage) {
      case 'requested': break;
      case 'swarm-down': break; // sem rede no POC-10
      case 'cores-closed':
        try { await store?.close(); } catch { /* já fechado */ }
        store = null;
        break;
      case 'view-deleted':
        try { viewDb?.close(); } catch { /* já fechado */ }
        viewDb = null;
        rmIfExists(path.join(DATA_DIR, 'view.db'));
        rmIfExists(path.join(DATA_DIR, 'view.db-wal'));
        rmIfExists(path.join(DATA_DIR, 'view.db-shm'));
        break;
      case 'manifest-deleted':
        try { manifestDb?.close(); } catch { /* já fechado */ }
        manifestDb = null;
        rmIfExists(path.join(DATA_DIR, 'manifest.db'));
        rmIfExists(path.join(DATA_DIR, 'manifest.db-wal'));
        rmIfExists(path.join(DATA_DIR, 'manifest.db-shm'));
        break;
      case 'key-wiped':
        fs.writeFileSync(WIPE_SENTINEL, stage);
        if (identitySeed) sodium.sodium_memzero(identitySeed);
        identitySeed = null; identityPk = null;
        rmIfExists(IDENTITY_PATH);
        rmIfExists(DATAKEY_PATH);
        rmIfExists(path.join(P2P_DIR, 'store'));
        break;
      case 'done':
        // §10.8: o LOCK é o ÚLTIMO recurso liberado, e só depois de `key-wiped`.
        releaseFileLock();
        rmIfExists(WIPE_SENTINEL);
        rmIfExists(LOCK_PATH);
        break;
    }
  }
  return { completou: true, retomadoDe: from };
}

// --- comandos --------------------------------------------------------------------------------
async function handle(cmd: CoreCommand): Promise<unknown> {
  switch (cmd.c) {
    case 'boot': {
      const info = await ask({ q: 'keystoreInfo' });
      if (info.a !== 'keystoreInfo') throw new Error('main não respondeu sobre o keystore');
      keystore = { available: info.available, backend: info.backend };

      // A13(5): `basic_text` é modo degradado EXPLÍCITO. O núcleo recusa abrir até haver
      // aceite dedicado — e o aceite é persistido, para a UI poder exibi-lo depois.
      const degraded = !info.available || info.backend === 'basic_text';
      if (degraded && !fs.existsSync(ACCEPT_PATH)) {
        throw Object.assign(
          new Error(`keystore inseguro (${info.backend}); exige aceite explícito`),
          { code: 'E_KEYSTORE_INSECURE' },
        );
      }

      // §3.3 / §18.6: "antes de qualquer outra coisa" é literal. O estado do wipe é lido
      // com o LOCK em mãos mas com corestore e bancos AINDA FECHADOS; só assim os estágios
      // que apagam diretórios não colidem com handles que este mesmo boot teria aberto.
      lockStages.push('app-instance');
      acquireFileLock();
      lockStages.push('lock-file');

      const pendente = readWipeStageBeforeOpening();
      let retomado: unknown = null;
      if (pendente !== 'none' && pendente !== 'done') {
        log('warn', `wipe pendente em '${pendente}': retomando antes de abrir corestore e bancos`);
        retomado = await runWipe(pendente);
        acquireFileLock(); // o estágio `done` liberou o LOCK; o boot segue precisando dele
      }

      await openComposite();

      const { created } = await loadOrCreateIdentity();
      out({ e: 'ready', pid: process.pid, msToReady: Date.now() - T0, lockStages, identityPublicKeyHex: identityPk!.toString('hex') });
      return { created, lockStages, keystore, degraded, wipeRetomado: retomado };
    }

    case 'identityRead':
      // Só a pública. A semente não tem caminho de saída neste switch — de propósito.
      return { publicKeyHex: identityPk?.toString('hex') ?? null, hasIdentity: identitySeed !== null };

    case 'identitySign': {
      if (!identitySeed) throw Object.assign(new Error('sem identidade'), { code: 'E_NO_IDENTITY' });
      const pk = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
      const sk = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
      sodium.crypto_sign_seed_keypair(pk, sk, identitySeed);
      const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
      const msg = Buffer.from(cmd.message);
      sodium.crypto_sign_detached(sig, msg, sk);
      sodium.sodium_memzero(sk);
      return { signatureHex: sig.toString('hex'), verifies: sodium.crypto_sign_verify_detached(sig, msg, pk) };
    }

    case 'identityExport':
      return { bundleB64: exportIdentity(cmd.passphrase) };

    case 'identityImport':
      return importIdentity(cmd.bundleB64, cmd.passphrase);

    case 'lockStatus': {
      const owner = readLockOwner();
      return { stages: lockStages, owner, ownerAlive: owner ? pidAlive(owner.pid) : null, holdingFd: lockFd !== null };
    }

    case 'wipe':
      return runWipe(getWipeStage() === 'none' ? 'requested' : getWipeStage());

    case 'acceptInsecureKeystore':
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(ACCEPT_PATH, JSON.stringify({ acceptedAt: new Date().toISOString(), backend: keystore.backend }));
      return { accepted: true, persistidoEm: ACCEPT_PATH };

    case 'stat':
      return { upMs: Date.now() - T0, rss: process.memoryUsage().rss, lockStages, keystore, wipeStage: getWipeStage() };

    case 'shutdown':
      closeComposite();
      setTimeout(() => process.exit(0), 10);
      return { bye: true };
  }
}

// --- IPC ---------------------------------------------------------------------------------------
type PortMain = { on(e: 'message', f: (ev: { data: unknown }) => void): void; postMessage(m: unknown): void; start(): void };
let ipcR: PortMain | null = null;

process.parentPort.on('message', (e) => {
  const d = e.data as { kind?: string } & Partial<MainToCore> & Partial<CoreCommand>;

  if (d.kind === 'ipc-r-port') {
    ipcR = (e.ports[0] as unknown as PortMain) ?? null;
    ipcR?.on('message', (ev) => {
      const q = ev.data as { c: string };
      // A13(4): as duas respostas possíveis não têm campo capaz de carregar chave privada.
      if (q.c === 'identity.publicKey') ipcR!.postMessage({ r: 'identity.publicKey', publicKeyHex: identityPk?.toString('hex') ?? '' });
      else ipcR!.postMessage({ r: 'identity.status', hasIdentity: identitySeed !== null, keystoreBackend: keystore.backend, degraded: !keystore.available });
    });
    ipcR?.start();
    return;
  }

  if (typeof d.a === 'string') {
    const p = asks.get(d.id!);
    if (p) { asks.delete(d.id!); p.resolve(d as MainToCore); }
    return;
  }

  const cmd = d as CoreCommand;
  void handle(cmd)
    .then((data) => out({ r: 'ok', id: cmd.id, data }))
    .catch((err: Error & { code?: string }) => out({ r: 'err', id: cmd.id, code: err.code ?? 'E_CORE', message: err.message }));
});

process.on('exit', () => releaseFileLock());
