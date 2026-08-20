import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { IdentityManager, computeHandle } from '../src/l0/identity/index.ts';
import { FallbackKeystoreOracle } from '../src/l0/keystore/index.ts';
import { resolveConfig } from '../src/l0/config/index.ts';
import { SystemClock, FixedClock } from '../src/l0/clock/index.ts';
import {
  AuthTokenStore,
  ProcessLock,
  parseDeepLink,
} from '../src/l3/ipcMain/index.ts';
import { IpcServer, MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';

test('Fase 1 — L0: Config & Clock', () => {
  const cfg = resolveConfig();
  assert.equal(cfg.p2pBuildChannel, 'prod');
  assert.equal(cfg.ipcSubWindow, 256);
  assert.equal(cfg.ipcStaleMs, 3000);
  const customCfg = resolveConfig({
    p2pBuildChannel: 'dev',
    ipcSubWindow: 128,
  });
  assert.equal(customCfg.p2pBuildChannel, 'dev');
  assert.equal(customCfg.ipcSubWindow, 128);
  const sysClock = new SystemClock();
  assert.ok(sysClock.now() > 0);
  const fixed = new FixedClock(1000);
  assert.equal(fixed.now(), 1000);
  fixed.advance(500);
  assert.equal(fixed.now(), 1500);
});

test('Fase 1 — L0: Identity e Keystore (A13, §3.2, §5.5, §6.1)', async (t) => {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'p2p-test-identity-'),
  );
  const oracle = new FallbackKeystoreOracle();
  const idManager = new IdentityManager(tmpDir, oracle);

  await t.test('Criação de identidade e verificação de propriedades', async () => {
    assert.equal(idManager.isLoaded, false);
    const rec = await idManager.create('Alice', 1);
    assert.equal(idManager.isLoaded, true);
    assert.equal(rec.displayName, 'Alice');
    assert.equal(rec.avatarColor, 1);
    assert.ok(rec.handle.startsWith('@'));
    assert.equal(rec.publicKey.length, 32);
    await assert.rejects(
      async () => {
        await idManager.create('Alice2', 2);
      },
      (err: { code?: string }) => err.code === 'E_IDENTITY_EXISTS',
    );
  });

  await t.test('Assinatura e verificação Ed25519', () => {
    const data = Buffer.from('mensagem de teste', 'utf8');
    const sig = idManager.sign(data);
    assert.equal(sig.length, 64);
  });

  await t.test('Recarregamento persistido da identidade', async () => {
    const idManager2 = new IdentityManager(tmpDir, oracle);
    const loaded = await idManager2.load();
    assert.equal(loaded, true);
    assert.equal(idManager2.publicKeyHex, idManager.publicKeyHex);
    assert.equal(idManager2.handle, idManager.handle);
    assert.equal(idManager2.record?.displayName, 'Alice');
  });

  await t.test('Exportação e Importação com frase secreta (§5.5)', async () => {
    const bundle = idManager.exportBundle('senha-forte-123', [
      {
        communityId: 'c1',
        coreKey: Buffer.alloc(32, 1),
        blobsKey: Buffer.alloc(32, 2),
        communitySeed: Buffer.alloc(32, 3),
      },
    ]);
    assert.ok(bundle.length > 0);
    const tmpEmpty = fs.mkdtempSync(
      path.join(os.tmpdir(), 'p2p-test-id-import-'),
    );
    const idManagerImport = new IdentityManager(tmpEmpty, oracle);
    await assert.rejects(
      async () => {
        await idManagerImport.importBundle(bundle, 'senha-errada');
      },
      (err: { code?: string }) => err.code === 'E_BAD_PASSPHRASE',
    );
    const importedRec = await idManagerImport.importBundle(
      bundle,
      'senha-forte-123',
    );
    assert.equal(importedRec.publicKeyHex, idManager.publicKeyHex);
    assert.equal(importedRec.displayName, 'Alice');
    fs.rmSync(tmpEmpty, { recursive: true, force: true });
  });

  await t.test('computeHandle gera handle no formato @xxxx-xxxx', () => {
    const pk = Buffer.alloc(32, 0);
    pk[0] = 0xff;
    const h = computeHandle(pk);
    assert.ok(/^@[0-9a-z]{4}-[0-9a-z]{4}$/.test(h));
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Fase 1 — L3: IPC-M, Deep Links e Lock (§3.5, §10.8, §15.3, §15.7)', async (t) => {
  await t.test('Parse de Deep Links com gramática fechada (§3.5)', () => {
    const validJoin = parseDeepLink('comunidadep2p://join/0123456789ABCDEF');
    assert.deepEqual(validJoin, {
      route: 'join',
      code: '0123456789ABCDEF',
    });
    const validMsg = parseDeepLink('comunidadep2p://m/' + 'A'.repeat(86));
    assert.deepEqual(validMsg, {
      route: 'message',
      ref: 'A'.repeat(86),
    });
    assert.equal(parseDeepLink('comunidadep2p://join/invalid-short'), null);
    assert.equal(
      parseDeepLink('https://comunidadep2p.org/join/0123456789ABCDEF'),
      null,
    );
    assert.equal(parseDeepLink('javascript:alert(1)'), null);
  });

  await t.test('AuthTokenStore de uso único e TTL (§15.3)', () => {
    const store = new AuthTokenStore();
    const token = store.issue('identity.wipe', 10_000);
    assert.ok(token);
    assert.equal(store.consume(token, 'community.end'), false);
    const token2 = store.issue('identity.wipe', 10_000);
    assert.equal(store.consume(token2, 'identity.wipe'), true);
    assert.equal(store.consume(token2, 'identity.wipe'), false);
  });

  await t.test('ProcessLock exclusivo (§10.8)', () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'p2p-test-lock-'),
    );
    const lock1 = new ProcessLock(tmpDir);
    lock1.acquire();
    assert.equal(lock1.isLocked, true);
    lock1.release();
    assert.equal(lock1.isLocked, false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

test('Fase 1 — L3: IPC-R Protocolo e Backpressure (A14, §15.1, §15.2, §15.3)', async (t) => {
  const [serverPort, clientPort] = MemoryIpcPort.createPair();
  const tokenStore = new AuthTokenStore();
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'p2p-test-ipcr-'),
  );
  const oracle = new FallbackKeystoreOracle();
  const identity = new IdentityManager(tmpDir, oracle);
  const server = new IpcServer({
    epoch: 1,
    port: serverPort,
    tokenVerifier: tokenStore,
    identityStatus: identity,
    buildChannel: 'prod',
    subWindow: 2,
  });
  server.register('openCmd', 'open', async (arg: unknown) => {
    const a = arg as { x: number };
    return { received: a.x * 2 };
  });
  server.register('standardCmd', 'standard', async () => {
    return { ok: true };
  });
  server.register('destructCmd', 'main-confirmed', async () => {
    return { wiped: true };
  });

  await t.test('Envio de Hello com epoch', async () => {
    const received: unknown[] = [];
    clientPort.onMessage((f) => received.push(f));
    server.sendHello('1.0.0', 2, 3);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(received.length, 1);
    const hello = received[0] as { t: string; epoch: number; opVersion: number };
    assert.equal(hello.t, 'hello');
    assert.equal(hello.epoch, 1);
    assert.equal(hello.opVersion, 2);
  });

  await t.test('Comando Open executa sem identidade', async () => {
    let resFrame: unknown = null;
    const handler = (f: unknown): void => {
      const frame = f as { t: string; id: number; ok: boolean; data: { received: number } };
      if (frame.t === 'res' && frame.id === 101) resFrame = frame;
    };
    clientPort.onMessage(handler);
    clientPort.postMessage({
      t: 'req',
      epoch: 1,
      id: 101,
      cmd: 'openCmd',
      arg: { x: 21 },
    } as never);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(resFrame !== null);
    assert.equal((resFrame as { ok: boolean }).ok, true);
    assert.equal((resFrame as { data: { received: number } }).data.received, 42);
  });

  await t.test('Comando Standard recusa sem identidade com E_NO_IDENTITY', async () => {
    let resFrame: unknown = null;
    clientPort.onMessage((f) => {
      const frame = f as { t: string; id: number };
      if (frame.t === 'res' && frame.id === 102) resFrame = frame;
    });
    clientPort.postMessage({
      t: 'req',
      epoch: 1,
      id: 102,
      cmd: 'standardCmd',
      arg: {},
    } as never);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(resFrame !== null);
    assert.equal((resFrame as { ok: boolean }).ok, false);
    assert.equal((resFrame as { err: { code: string } }).err.code, 'E_NO_IDENTITY');
  });

  await t.test('Comando main-confirmed exige authToken válido', async () => {
    let resFrame: unknown = null;
    clientPort.onMessage((f) => {
      const frame = f as { t: string; id: number };
      if (frame.t === 'res' && frame.id === 103) resFrame = frame;
    });
    clientPort.postMessage({
      t: 'req',
      epoch: 1,
      id: 103,
      cmd: 'destructCmd',
      arg: {},
    } as never);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((resFrame as { ok: boolean }).ok, false);
    assert.equal((resFrame as { err: { code: string } }).err.code, 'E_PERMISSION_DENIED');

    const token = tokenStore.issue('destructCmd', 10_000);
    let resFrame2: unknown = null;
    clientPort.onMessage((f) => {
      const frame = f as { t: string; id: number };
      if (frame.t === 'res' && frame.id === 104) resFrame2 = frame;
    });
    clientPort.postMessage({
      t: 'req',
      epoch: 1,
      id: 104,
      cmd: 'destructCmd',
      arg: {},
      authToken: token,
    } as never);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(resFrame2 !== null);
    assert.equal((resFrame2 as { ok: boolean }).ok, true);
  });

  await t.test('Epoch diferente descarta quadro sem resposta (§15.1)', async () => {
    let responded = false;
    clientPort.onMessage((f) => {
      const frame = f as { id?: number };
      if ('id' in (frame as object) && (frame as { id: number }).id === 999) responded = true;
    });
    clientPort.postMessage({
      t: 'req',
      epoch: 99,
      id: 999,
      cmd: 'openCmd',
      arg: { x: 1 },
    } as never);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(responded, false);
  });

  await t.test('Assinatura e Backpressure de Eventos (ev, evAck, evStale)', async () => {
    const events: Array<{ t: string; subId?: number; data?: { count: number } }> = [];
    clientPort.onMessage((f) => {
      const frame = f as { t: string };
      if (frame.t === 'ev' || frame.t === 'evStale' || frame.t === 'subOk') events.push(frame as never);
    });
    clientPort.postMessage({
      t: 'sub',
      epoch: 1,
      id: 201,
      topic: 'test.topic',
    } as never);
    await new Promise((r) => setTimeout(r, 20));
    const subOk = events.find((e) => e.t === 'subOk') as { subId: number } | undefined;
    assert.ok(subOk !== undefined);
    const subId = subOk!.subId;
    server.emit('test.topic', { count: 1 });
    await new Promise((r) => setTimeout(r, 10));
    server.emit('test.topic', { count: 2 });
    await new Promise((r) => setTimeout(r, 10));
    server.emit('test.topic', { count: 3 });
    await new Promise((r) => setTimeout(r, 10));
    const evStale = events.find((e) => e.t === 'evStale') as { subId: number } | undefined;
    assert.ok(evStale !== undefined, 'Deveria ter recebido evStale por backpressure');
    assert.equal(evStale!.subId, subId);
    clientPort.postMessage({
      t: 'evAck',
      epoch: 1,
      subId,
      evSeq: 2,
    } as never);
    await new Promise((r) => setTimeout(r, 10));
    server.emit('test.topic', { count: 4 });
    await new Promise((r) => setTimeout(r, 10));
    const ev4 = events.filter((e) => e.t === 'ev').pop() as { data: { count: number } } | undefined;
    assert.equal(ev4?.data.count, 4);
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
