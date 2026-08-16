/**
 * Núcleo do POC-03 — roda dentro do `utilityProcess` (A16, backend-v2.md §29 fase 0).
 *
 * Exercita o que o gate G0 mede e nada além: carga dos quatro nativos, dois SQLite com os
 * PRAGMAs de §10.4, core do Hypercore com append, transação longa, Ed25519, heartbeat e as
 * duas injeções de falha. Não há domínio aqui — nem `fold`, nem `kind`s, nem outbox.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { AddonLoad, CoreCommand, CoreEvent, CoreOut, RuntimeStamp } from '../protocol/messages.js';

const T0 = Date.now();

// --- captura de qual .node o loader realmente abriu -----------------------------------
// É a prova de `asar` vs `asarUnpack`: dentro do asar o dlopen falha, e o caminho que
// aparece aqui mostra se o binário veio de `app.asar.unpacked`. Sem isso o relatório de
// carga diria só "carregou", que é justamente o que não basta para o gate.
const dlopened: string[] = [];
const realDlopen = process.dlopen.bind(process);
// Repassa os argumentos como vieram. Reconstruir a chamada com `flags` explícito quebra:
// `dlopen(mod, file, undefined)` é recusado com "invalid mode for dlopen()", e o
// `require-addon` engole o erro e relata "Cannot find addon" — um sintoma que não aponta
// para a causa.
(process as unknown as { dlopen: (...a: unknown[]) => unknown }).dlopen = (...args: unknown[]) => {
  dlopened.push(String(args[1]));
  return (realDlopen as unknown as (...a: unknown[]) => unknown)(...args);
};

type Loaded = { mod: unknown; load: AddonLoad };

function loadAddon(name: string, req: () => unknown): Loaded {
  const before = dlopened.length;
  try {
    const mod = req();
    // Todos os .node abertos durante ESTE require, não só o último: `corestore` arrasta
    // quickbit-native e sodium-native junto, e reportar só o último atribuía ao corestore
    // um binário que não é dele.
    const opened = dlopened.slice(before);
    const own = opened.find((p) => p.includes(`${path.sep}${name}${path.sep}`)) ?? null;
    return {
      mod,
      load: {
        name,
        loaded: true,
        resolved: own,
        alsoOpened: opened.filter((p) => p !== own),
        fromSourceBuild: own === null ? null : /[\\/](build[\\/]Release|prebuilds)[\\/]/.test(own),
        error: null,
      },
    };
  } catch (err) {
    return {
      mod: null,
      load: { name, loaded: false, resolved: null, fromSourceBuild: null, error: (err as Error).message },
    };
  }
}

const addons: AddonLoad[] = [];
const betterSqlite = loadAddon('better-sqlite3', () => require('better-sqlite3'));
addons.push(betterSqlite.load);
const sodium = loadAddon('sodium-native', () => require('sodium-native'));
addons.push(sodium.load);
const udx = loadAddon('udx-native', () => require('udx-native'));
addons.push(udx.load);
const corestoreMod = loadAddon('corestore', () => require('corestore'));
addons.push(corestoreMod.load);

// --- estado do núcleo ------------------------------------------------------------------
const DATA_DIR = process.env.POC03_DATA_DIR ?? path.join(process.cwd(), '.poc03-data');

let manifestDb: any = null;
let viewDb: any = null;
let store: any = null;
let core: any = null;
let heartbeatSeq = 0;

/**
 * A porta que chega ao núcleo é `MessagePortMain` (lado Node), não a `MessagePort` do DOM:
 * ela tem `on`/`start`, não `addEventListener`. Descrita estruturalmente para não arrastar
 * o pacote `electron` inteiro para dentro do `utilityProcess`.
 */
type PortMain = {
  on(ev: 'message', fn: (e: { data: unknown }) => void): void;
  postMessage(m: unknown): void;
  start(): void;
};
let ipcR: PortMain | null = null;

function out(m: CoreOut): void {
  process.parentPort.postMessage(m);
}
function log(level: 'info' | 'warn' | 'error', msg: string): void {
  out({ e: 'log', level, msg });
}

function runtimeStamp(): RuntimeStamp {
  const v = process.versions as NodeJS.ProcessVersions & { electron?: string; chrome?: string };
  return {
    electron: v.electron ?? 'n/a',
    chrome: v.chrome ?? 'n/a',
    node: v.node,
    v8: v.v8,
    platform: process.platform,
    arch: process.arch,
    // Quem sabe se o app está empacotado é o main (`app.isPackaged`): dentro do
    // `utilityProcess` não existe `app`, e `process.defaultApp` não é propagado ao filho —
    // o núcleo se declarava empacotado rodando por `electron .`, que é o oposto do que o
    // gate precisa distinguir.
    packaged: process.env.POC03_PACKAGED === '1',
    execPath: process.execPath,
  };
}

/** §10.4 — os PRAGMAs são normativos e os dois bancos diferem de propósito. */
function openDbs(): { manifest: string[]; view: string[] } {
  const Database = betterSqlite.mod as new (p: string) => any;
  fs.mkdirSync(DATA_DIR, { recursive: true });

  manifestDb = new Database(path.join(DATA_DIR, 'manifest.db'));
  const manifestPragmas = [
    'journal_mode = WAL',
    'synchronous = FULL',
    'foreign_keys = OFF',
    'busy_timeout = 5000',
    'temp_store = MEMORY',
    'cache_size = -8000',
  ];
  for (const p of manifestPragmas) manifestDb.pragma(p);

  viewDb = new Database(path.join(DATA_DIR, 'view.db'));
  const viewPragmas = [
    'journal_mode = WAL',
    'synchronous = NORMAL',
    'foreign_keys = OFF',
    'busy_timeout = 5000',
    'temp_store = MEMORY',
    'mmap_size = 268435456',
    'cache_size = -32000',
  ];
  for (const p of viewPragmas) viewDb.pragma(p);

  manifestDb.exec('CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)');
  viewDb.exec('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, channel TEXT NOT NULL, content TEXT NOT NULL)');
  viewDb.exec("CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, content='messages', content_rowid='id')");

  // Ler de volta prova que o PRAGMA pegou — vários são silenciosamente ignorados quando
  // o valor é inválido ou quando o banco já está em outro modo.
  const read = (db: any, keys: string[]): string[] =>
    keys.map((k) => `${k}=${JSON.stringify(db.pragma(k, { simple: true }))}`);
  const keys = ['journal_mode', 'synchronous', 'foreign_keys', 'busy_timeout', 'temp_store', 'cache_size'];
  return { manifest: read(manifestDb, keys), view: read(viewDb, [...keys, 'mmap_size']) };
}

async function openCore(): Promise<Record<string, unknown>> {
  const Corestore = corestoreMod.mod as new (dir: string) => any;
  store = new Corestore(path.join(DATA_DIR, 'p2p'));
  core = store.get({ name: 'poc03-runtime' });
  await core.ready();
  return {
    length: core.length,
    byteLength: core.byteLength,
    // OBS-01 do POC-01: `core.key` é o hash do manifesto, não a chave pública do par.
    // Registrado aqui como medida, não como decisão — quem decide é a fase 2.
    keyHex: Buffer.from(core.key).toString('hex'),
    discoveryKeyHex: Buffer.from(core.discoveryKey).toString('hex'),
    writable: core.writable,
  };
}

/**
 * OBS-02 do POC-01: `await core.flush()` não existe em hypercore@11.35.1, e a observação
 * registrada era que `core.state.flush()` lança sem transação aberta. Aqui a chamada é
 * feita de verdade, antes e depois de um append, porque a fase 3 vai precisar saber qual é
 * a barreira de durabilidade real — inventá-la a partir da assinatura seria adivinhação.
 */
async function flushProbe(): Promise<Record<string, unknown>> {
  const names = ['flush', 'sync', 'fsync', 'close', 'update', 'truncate'];
  const onCore: Record<string, string> = {};
  for (const n of names) onCore[n] = typeof core?.[n];
  const onState: Record<string, string> = {};
  if (core?.state) for (const n of names) onState[n] = typeof core.state[n];

  const attempt = async (label: string, fn: () => unknown): Promise<Record<string, unknown>> => {
    const t = process.hrtime.bigint();
    try {
      const r = await fn();
      return { label, ok: true, ms: Number(process.hrtime.bigint() - t) / 1e6, returned: r === undefined ? 'undefined' : typeof r };
    } catch (err) {
      const e = err as Error;
      // A primeira linha do stack diz se o erro nasceu aqui ou dentro do hypercore. Sem
      // isso, "Cannot read properties of null" parece defeito do POC e não do que ele mede.
      const origem = (e.stack ?? '').split('\n').slice(1, 3).map((s) => s.trim());
      return { label, ok: false, error: e.message, origem };
    }
  };

  const chamadas: Record<string, unknown>[] = [];
  chamadas.push(await attempt('state.flush() com log vazio', () => core.state.flush()));
  await core.append(Buffer.from('barreira de durabilidade'));
  chamadas.push(await attempt('state.flush() após append', () => core.state.flush()));
  chamadas.push(await attempt('core.flush() (OBS-02)', () => core.flush()));

  return {
    hypercoreVersion: require('hypercore/package.json').version,
    onCore,
    onState,
    hasState: Boolean(core?.state),
    chamadas,
  };
}

async function handle(cmd: CoreCommand): Promise<unknown> {
  switch (cmd.c) {
    case 'ping':
      return { pong: true, upMs: Date.now() - T0 };

    case 'addonReport':
      return { addons, dlopened, runtime: runtimeStamp() };

    case 'openDbs':
      return openDbs();

    case 'openCore':
      return openCore();

    case 'flushProbe':
      return flushProbe();

    case 'append': {
      const payload = Buffer.alloc(cmd.bytes, 0x61);
      const t = Date.now();
      const batch: Buffer[] = [];
      for (let i = 0; i < cmd.count; i++) batch.push(payload);
      await core.append(batch);
      return { appended: cmd.count, length: core.length, byteLength: core.byteLength, ms: Date.now() - t };
    }

    case 'txRows': {
      // "Transação longa" de §3 POC-03: uma transação só, N linhas, medida ponta a ponta.
      const stmt = viewDb.prepare('INSERT INTO messages (channel, content) VALUES (?, ?)');
      const tx = viewDb.transaction((n: number) => {
        for (let i = 0; i < n; i++) stmt.run('c1', `linha ${i} de uma transação de ${n}`);
      });
      const t = process.hrtime.bigint();
      tx(cmd.rows);
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      return { rows: cmd.rows, ms, total: viewDb.prepare('SELECT count(*) n FROM messages').get().n };
    }

    case 'ftsIndex': {
      const tx = viewDb.transaction((n: number) => {
        const s = viewDb.prepare('INSERT INTO messages_fts (rowid, content) SELECT id, content FROM messages LIMIT ?');
        s.run(n);
      });
      const t = process.hrtime.bigint();
      tx(cmd.rows);
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      const hits = viewDb.prepare("SELECT count(*) n FROM messages_fts WHERE messages_fts MATCH 'transação'").get().n;
      return { indexed: cmd.rows, ms, hits };
    }

    case 'signVerify': {
      const s = sodium.mod as any;
      const pk = Buffer.alloc(s.crypto_sign_PUBLICKEYBYTES);
      const sk = Buffer.alloc(s.crypto_sign_SECRETKEYBYTES);
      s.crypto_sign_keypair(pk, sk);
      const msg = Buffer.from('POC-03 gate G0 — verificação Ed25519 real, não simulada');
      const sig = Buffer.alloc(s.crypto_sign_BYTES);
      const t = process.hrtime.bigint();
      let okCount = 0;
      for (let i = 0; i < cmd.count; i++) {
        s.crypto_sign_detached(sig, msg, sk);
        if (s.crypto_sign_verify_detached(sig, msg, pk)) okCount++;
      }
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      // Uma assinatura adulterada precisa reprovar, senão "verificou" não quer dizer nada.
      const tampered = Buffer.from(sig);
      tampered[0] = (tampered[0]! ^ 0xff) & 0xff;
      const rejects = s.crypto_sign_verify_detached(tampered, msg, pk) === false;
      return { count: cmd.count, okCount, rejectsTampered: rejects, ms, udxLoaded: udx.load.loaded };
    }

    case 'stat':
      return {
        upMs: Date.now() - T0,
        rss: process.memoryUsage().rss,
        heapUsed: process.memoryUsage().heapUsed,
        coreLength: core?.length ?? null,
        heartbeats: heartbeatSeq,
        // A lista completa só fecha aqui: `better-sqlite3` e o binding do `corestore`
        // abrem o .node PREGUIÇOSAMENTE, na primeira conexão, não no `require`. Para o
        // critério "taxa de carga do addon" isso significa que bootar não basta — uma
        // falha de asarUnpack só apareceria ao abrir o banco, e o boot teria dito "ok".
        dlopenedAoFinal: [...dlopened],
      };

    case 'crashNative': {
      // Exceção vinda de dentro do addon, não um `throw` de JS: better-sqlite3 lança do
      // C++ quando a conexão já foi fechada. É o "crash por exceção nativa" de §3.
      log('warn', 'crashNative: fechando o banco e usando o handle morto');
      manifestDb.close();
      manifestDb.prepare('SELECT 1').get();
      return { unreachable: true };
    }

    case 'crashHard':
      log('warn', 'crashHard: process.kill(self, SIGKILL)');
      setTimeout(() => process.kill(process.pid, 'SIGKILL'), 10);
      return { killing: true };

    case 'shutdown':
      setTimeout(() => process.exit(0), 10);
      return { bye: true };
  }
}

// --- IPC-M ------------------------------------------------------------------------------
process.parentPort.on('message', (e) => {
  const first = e.data as { kind?: string } | CoreCommand;
  // A porta da IPC-R chega pelo main, transferida; o main não fica no meio do tráfego.
  if ((first as { kind?: string }).kind === 'ipc-r-port') {
    ipcR = (e.ports[0] as unknown as PortMain) ?? null;
    if (ipcR) {
      ipcR.on('message', (ev: { data: unknown }) => ipcR!.postMessage({ echo: ev.data, from: 'core', pid: process.pid }));
      ipcR.start();
      log('info', 'IPC-R conectada ao núcleo');
    }
    return;
  }
  const cmd = first as CoreCommand;
  void handle(cmd)
    .then((data) => out({ r: 'ok', id: cmd.id, data }))
    .catch((err: Error) => out({ r: 'err', id: cmd.id, code: err.name || 'E_CORE', message: err.message }));
});

setInterval(() => {
  heartbeatSeq++;
  out({ e: 'heartbeat', pid: process.pid, seq: heartbeatSeq, rssBytes: process.memoryUsage().rss });
}, 250);

out({ e: 'ready', pid: process.pid, msToReady: Date.now() - T0, runtime: runtimeStamp() });
