import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { IdentityManager, computeHandle } from '../src/l0/identity/index.ts';
import { FallbackKeystoreOracle } from '../src/l0/keystore/index.ts';
import { resolveConfig } from '../src/l0/config/index.ts';
import { SystemClock, FixedClock } from '../src/l0/clock/index.ts';
import {
  AuthTokenStore,
  ProcessLock,
  comandoConfirmado,
  escopoDeConfirmacao,
  lockNativoDisponivel,
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
    const importado = await idManagerImport.importBundle(
      bundle,
      'senha-forte-123',
    );
    assert.equal(importado.record.publicKeyHex, idManager.publicKeyHex);
    assert.equal(importado.record.displayName, 'Alice');
    // §5.5 — as comunidades do backup saem da MESMA decodificação que recriou a identidade.
    assert.ok(Array.isArray(importado.communities));
    fs.rmSync(tmpEmpty, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  await t.test('computeHandle gera handle no formato @xxxx-xxxx', () => {
    const pk = Buffer.alloc(32, 0);
    pk[0] = 0xff;
    const h = computeHandle(pk);
    assert.ok(/^@[0-9a-z]{4}-[0-9a-z]{4}$/.test(h));
  });

  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

test('Fase 1 — L3: IPC-M e Lock (§10.8, §15.3, §15.7)', async (t) => {
  // A gramática de deep link de §3.5 mora em `app/src/main/deeplink.ts`, junto de quem
  // recebe `argv` e `open-url`, e é exercitada por `npm run smoke:deeplink` no `app/`. A
  // cópia que vivia em `l3/ipcMain` não tinha consumidor fora deste teste e já havia
  // divergido do produto (faltava a rota `u/<KEY64>`).

  await t.test('AuthTokenStore de uso único, TTL e escopo (§15.3)', () => {
    const store = new AuthTokenStore();
    const token = store.issue('identity.wipe', null, 10_000);
    assert.ok(token);
    // Comando diferente não consome...
    assert.equal(store.consume(token, 'community.end', null), false);
    // ...e o token some assim mesmo: apresentado é gasto.
    assert.equal(store.consume(token, 'identity.wipe', null), false);

    const token2 = store.issue('identity.wipe', null, 10_000);
    assert.equal(store.consume(token2, 'identity.wipe', null), true);
    assert.equal(store.consume(token2, 'identity.wipe', null), false);

    // §15.3 emendado — o token liga-se ao ALVO: o de uma comunidade não serve para outra.
    const tokenA = store.issue('community.end', 'comunidade-A', 10_000);
    assert.equal(store.consume(tokenA, 'community.end', 'comunidade-B'), false);
    const tokenA2 = store.issue('community.end', 'comunidade-A', 10_000);
    assert.equal(store.consume(tokenA2, 'community.end', 'comunidade-A'), true);

    // Escopo ausente e escopo presente não se confundem.
    const semAlvo = store.issue('core.reproject', null, 10_000);
    assert.equal(semAlvo && store.consume(semAlvo, 'core.reproject', 'comunidade-A'), false);

    // TTL vencido não consome.
    const vencido = store.issue('identity.wipe', null, -1);
    assert.equal(store.consume(vencido, 'identity.wipe', null), false);
  });

  await t.test('A tabela de §15.3 é fechada e o escopo sai do argumento', () => {
    assert.ok(comandoConfirmado('identity.wipe') !== null);
    assert.equal(comandoConfirmado('message.send'), null);
    assert.equal(comandoConfirmado('nao.existe'), null);
    assert.equal(escopoDeConfirmacao('identity.wipe', { communityId: 'c1' }), null);
    assert.equal(escopoDeConfirmacao('community.end', { communityId: 'c1' }), 'c1');
    // `core.reproject` sem `communityId` é "todas" — escopo nulo, e não string vazia.
    assert.equal(escopoDeConfirmacao('core.reproject', {}), null);
    assert.equal(escopoDeConfirmacao('dm.forget', { conversationId: 'k9' }), 'k9');
    // §15.3 emendado — `identity.export` não liga o token à frase secreta.
    assert.equal(escopoDeConfirmacao('identity.export', { passphrase: 'segredo' }), null);

    // O alvo de `blob.reveal` é um REGISTRO (§13.2), não texto: exigir string ali daria
    // escopo `null` sempre — uma ligação vazia, e consistente nos dois lados, portanto
    // invisível. A forma canônica ordena as chaves, então a ordem de inserção não conta.
    const blobA = { byteOffset: 1, blockOffset: 2, blockLength: 3, byteLength: 4 };
    const blobOrdemTrocada = { byteLength: 4, blockLength: 3, blockOffset: 2, byteOffset: 1 };
    const escopoA = escopoDeConfirmacao('blob.reveal', { blobId: blobA });
    assert.ok(escopoA !== null && escopoA.length > 0);
    assert.equal(escopoDeConfirmacao('blob.reveal', { blobId: blobOrdemTrocada }), escopoA);
    // E um blob diferente é um escopo diferente — senão a ligação não separaria nada.
    assert.notEqual(
      escopoDeConfirmacao('blob.reveal', { blobId: { ...blobA, byteOffset: 99 } }),
      escopoA,
    );
  });

  await t.test('ProcessLock: o `flock` de §10.8 existe nesta build', () => {
    // A regressão que este teste fecha: `l3/ipcMain` é ESM e chamava `require()` nu, que
    // não existe nesse escopo. A exceção era engolida, `fsext` ficava `null` e TODO
    // `acquire()` caía numa comparação de PID que não é exclusão nenhuma.
    const nativo = lockNativoDisponivel();
    assert.equal(nativo.ok, true, `flock indisponível: ${nativo.motivo}`);
  });

  await t.test('ProcessLock exclusivo entre PROCESSOS (§10.8)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-test-lock-'));
    const lock1 = new ProcessLock(tmpDir);
    lock1.acquire();
    assert.equal(lock1.isLocked, true);

    // O que importa é a exclusão entre PROCESSOS, e é o que faltava aqui: a versão
    // anterior adquiria e liberava um lock só, então passava mesmo sem `flock` algum.
    // Três filhos disparados juntos disputam o mesmo diretório; nenhum pode entrar.
    //
    // O filho é um `.mjs` de verdade, e não um `node -e`: em `-e` o Node define `require`
    // no objeto global, o que mascara justamente o defeito que este teste vigia.
    const moduloIpcMain = new URL('../src/l3/ipcMain/index.js', import.meta.url).href;
    const script = path.join(tmpDir, 'concorrente.mjs');
    fs.writeFileSync(
      script,
      `import { ProcessLock } from ${JSON.stringify(moduloIpcMain)};\n` +
        `const l = new ProcessLock(process.argv[2]);\n` +
        `try { l.acquire(); console.log('ADQUIRIU'); } catch (e) { console.log('RECUSADO:' + e.code); }\n`,
      'utf8',
    );
    const resultados = [0, 1, 2].map(() =>
      spawnSync(process.execPath, [script, tmpDir], { encoding: 'utf8' }).stdout.trim(),
    );
    assert.ok(
      resultados.every((r) => r.startsWith('RECUSADO:E_CORE_ALREADY_RUNNING')),
      `um processo concorrente entrou no diretório travado: ${JSON.stringify(resultados)}`,
    );

    lock1.release();
    assert.equal(lock1.isLocked, false);
    // Solto o lock, o próximo processo entra — senão o teste passaria com um lock quebrado.
    const depois = spawnSync(process.execPath, [script, tmpDir], { encoding: 'utf8' }).stdout.trim();
    assert.equal(depois, 'ADQUIRIU');

    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
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
    // §15.1(4) — o `evStale` sai depois de `IPC_STALE_MS` na saturação, não no instante em
    // que a janela enche. Aqui o prazo é curto para o teste não precisar esperar 3 s.
    staleMs: 40,
    // §15.3 — `destructCmd` não está na tabela do produto; este rig declara o próprio
    // extrator para exercitar a ligação por alvo na fronteira.
    escopoDeConfirmacao: (cmd, arg) =>
      cmd === 'destructCmd'
        ? ((arg as { communityId?: string } | null)?.communityId ?? null)
        : null,
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

    const token = tokenStore.issue('destructCmd', null, 10_000);
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
    const events: Array<{ t: string; subId?: number; evSeq?: number; data?: { count: number } }> = [];
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

    // Janela de 2: os dois primeiros passam, o terceiro em diante é descartado.
    for (const count of [1, 2, 3, 4, 5]) {
      server.emit('test.topic', { count });
      await new Promise((r) => setTimeout(r, 2));
    }
    // Antes do prazo de `IPC_STALE_MS` NÃO há `evStale` — §15.1(4) manda esperar.
    assert.equal(
      events.some((e) => e.t === 'evStale'),
      false,
      'evStale saiu antes de IPC_STALE_MS',
    );
    await new Promise((r) => setTimeout(r, 80));

    const evStale = events.find((e) => e.t === 'evStale') as
      | { subId: number; fromSeq: number; toSeq: number; dropped: number }
      | undefined;
    assert.ok(evStale !== undefined, 'Deveria ter recebido evStale por backpressure');
    assert.equal(evStale!.subId, subId);
    // §15.1(4) — `dropped` é a CONTAGEM descartada, e a faixa é a que se perdeu de fato.
    assert.equal(evStale!.dropped, 3);
    assert.equal(evStale!.fromSeq, 3);
    assert.equal(evStale!.toSeq, 5);
    // §15.1(3) — os entregues mantêm `evSeq` monotônico e o buraco denuncia a perda.
    const entregues = events.filter((e) => e.t === 'ev').map((e) => e.evSeq);
    assert.deepEqual(entregues, [1, 2]);

    // §15.1(5) — o ack que cobre a faixa anunciada retoma a emissão.
    clientPort.postMessage({ t: 'evAck', epoch: 1, subId, evSeq: evStale!.toSeq } as never);
    await new Promise((r) => setTimeout(r, 10));
    server.emit('test.topic', { count: 6 });
    await new Promise((r) => setTimeout(r, 10));
    const ultimo = events.filter((e) => e.t === 'ev').pop() as { data: { count: number }; evSeq: number } | undefined;
    assert.equal(ultimo?.data.count, 6);
    assert.equal(ultimo?.evSeq, 6);

    // Um `evAck` atrasado, de seq antigo, NÃO reabre a janela inteira: a marca só avança.
    clientPort.postMessage({ t: 'evAck', epoch: 1, subId, evSeq: 1 } as never);
    await new Promise((r) => setTimeout(r, 5));
    server.emit('test.topic', { count: 7 });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      (events.filter((e) => e.t === 'ev').pop() as { evSeq: number }).evSeq,
      7,
      'o ack antigo não podia ter retrocedido a marca',
    );
    clientPort.postMessage({ t: 'unsub', epoch: 1, subId } as never);
    await new Promise((r) => setTimeout(r, 10));
  });

  await t.test('main-confirmed: o token de um alvo não serve para outro (§15.3)', async () => {
    // Ponta a ponta pelo roteador real, com a tabela do produto e um `AuthTokenStore` de
    // verdade: é o caminho que um renderer comprometido percorreria.
    const [sPort, cPort] = MemoryIpcPort.createPair();
    const store = new AuthTokenStore();
    const srv = new IpcServer({
      epoch: 1,
      port: sPort,
      tokenVerifier: store,
      identityStatus: { isLoaded: true },
      buildChannel: 'prod',
      escopoDeConfirmacao,
    });
    const encerradas: string[] = [];
    srv.register('community.end', 'main-confirmed', (arg) => {
      encerradas.push((arg as { communityId: string }).communityId);
      return {};
    });

    const respostas = new Map<number, { ok: boolean; err?: { code: string } }>();
    cPort.onMessage((f) => {
      const frame = f as { t: string; id: number; ok: boolean; err?: { code: string } };
      if (frame.t === 'res') respostas.set(frame.id, frame);
    });

    // Token emitido para a comunidade A, usado contra a B: tem de ser recusado.
    const tokenA = store.issue('community.end', 'comunidade-A');
    cPort.postMessage({ t: 'req', epoch: 1, id: 900, cmd: 'community.end', arg: { communityId: 'comunidade-B' }, authToken: tokenA } as never);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(respostas.get(900)?.ok, false);
    assert.equal(respostas.get(900)?.err?.code, 'E_PERMISSION_DENIED');
    assert.deepEqual(encerradas, [], 'o handler rodou com um token de outro alvo');

    // E o token gasto na tentativa não sobrevive para o alvo certo — uso único.
    cPort.postMessage({ t: 'req', epoch: 1, id: 901, cmd: 'community.end', arg: { communityId: 'comunidade-A' }, authToken: tokenA } as never);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(respostas.get(901)?.ok, false);

    // Com o token do alvo certo, passa.
    const tokenA2 = store.issue('community.end', 'comunidade-A');
    cPort.postMessage({ t: 'req', epoch: 1, id: 902, cmd: 'community.end', arg: { communityId: 'comunidade-A' }, authToken: tokenA2 } as never);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(respostas.get(902)?.ok, true);
    assert.deepEqual(encerradas, ['comunidade-A']);
    srv.close();
  });

  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});
