/**
 * §28.4 — determinismo do `fold`/`projector`, em CI.
 *
 * Três testes, todos contra um core de referência com ≥ 5 000 registros cobrindo os 38
 * `kind`s **e** ≥ 200 registros deliberadamente inválidos:
 *
 *   1. **Reprojeção idêntica:** apagar `view.db` e reprojetar do `seq` 0 produz o mesmo hash
 *      de dump ordenado — e, além do que §28.4 pede, o **mesmo arquivo** byte a byte, que é
 *      a forma forte do "apagar e reprojetar reconstrói byte a byte" de §10.3.
 *   2. **Convergência entre réplicas:** réplicas independentes — cores e `view.db` distintos
 *      — produzem o mesmo hash.
 *   3. **Snapshot equivalente:** interpretar com snapshot a cada K registros produz o mesmo
 *      `DecisionState` (por serialização canônica) e o mesmo dump que interpretar sem.
 *
 * É o teste que protege a decisão-raiz A02. Se ele quebrar, a arquitetura deixou de ser
 * verdade e precisa ser reavaliada, não remendada (§28.4).
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { dumpHash, openViewDb } from '../src/l0/view/index.ts';
import { openCore } from '../src/l0/corestore/index.ts';
import { Projector, serializeDs } from '../src/l1/projector/index.ts';
import { buildCorpus } from './helpers/corpus.ts';
import { BUILD_A, tempDir, writeCore } from './helpers/projector.ts';
import { keypairFromSeed } from './helpers/world.ts';

const buildId = BUILD_A;

/** Hash do arquivo `view.db` depois de fechado — a forma forte de §10.3. */
function fileHash(dbPath: string): string {
  return createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
}

/**
 * Relógio fixo para a forma forte de §10.3. O único byte não derivado de `view.db` é o
 * `taken_at` do snapshot (§10.6) — carimbo de relógio de parede, cache e não estado. Com o
 * relógio injetado fixo, o arquivo **inteiro**, inclusive o snapshot, reconstrói byte a
 * byte; sem ele, a divergência fica restrita a esses 8 bytes e o hash de dump — que exclui
 * `ds_snapshot` por definição — é idêntico do mesmo jeito.
 */
const FIXED_NOW = 1_800_000_000_000;

/** Projeta um log inteiro num diretório limpo e devolve dump + bytes do arquivo. */
async function projectClean(
  log: readonly Uint8Array[],
  opts: { snapshotInterval?: number } = {},
): Promise<{ hash: string; rows: number; file: string; dsHex: string }> {
  const dir = tempDir();
  const corePath = await writeCore(dir, keypairFromSeed('core'), log);
  const core = await openCore(corePath, keypairFromSeed('core').publicKey);
  const view = openViewDb(path.join(dir, 'view.db'));
  const p = new Projector(view, core, {
    foldBuildId: buildId,
    now: () => FIXED_NOW,
    ...(opts.snapshotInterval !== undefined ? { snapshotInterval: opts.snapshotInterval } : {}),
  });
  await p.boot();
  const dsHex = serializeDs(p.ds).toString('hex');
  const { hash, rows } = dumpHash(view, core.key.toString('hex'));
  view.close();
  await core.close();
  const file = fileHash(path.join(dir, 'view.db'));
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  return { hash, rows, file, dsHex };
}

describe('§28.4 — determinismo do projector', () => {
  const corpus = buildCorpus();

  it('o core de referência tem ≥ 5 000 registros, cobre os 38 kinds e ≥ 200 inválidos', () => {
    assert.ok(corpus.size >= 5_000, `corpus de ${corpus.size} registros`);
    assert.equal(corpus.kindsCovered.size, 38, '38 kinds de §7.4');
    assert.ok(corpus.invalidCount >= 200, `${corpus.invalidCount} registros inválidos`);
    assert.ok(corpus.applied > 3_000, 'o corpus tem tráfego aplicado de verdade');
  });

  it('teste 1 — reprojeção idêntica: mesmo hash de dump e mesmo arquivo byte a byte', async () => {
    const a = await projectClean(corpus.log);
    const b = await projectClean(corpus.log);
    assert.equal(a.hash, b.hash, 'hash de dump ordenado (§28.4)');
    assert.equal(a.file, b.file, 'view.db reconstruído byte a byte (§10.3)');
    assert.ok(a.rows > 0);
  });

  it('teste 2 — convergência entre réplicas: dois cores e duas views independentes', async () => {
    // Dois cores escritos independentemente com os mesmos bytes.
    const dir1 = tempDir();
    const dir2 = tempDir();
    try {
      const kp = keypairFromSeed('core');
      await writeCore(dir1, kp, corpus.log);
      await writeCore(dir2, kp, corpus.log);
      const core1 = await openCore(path.join(dir1, 'core'), kp.publicKey);
      const core2 = await openCore(path.join(dir2, 'core'), kp.publicKey);
      const view1 = openViewDb(path.join(dir1, 'view.db'));
      const view2 = openViewDb(path.join(dir2, 'view.db'));
      const p1 = new Projector(view1, core1, { foldBuildId: buildId });
      const p2 = new Projector(view2, core2, { foldBuildId: buildId });
      await p1.boot();
      await p2.boot();
      const h1 = dumpHash(view1, core1.key.toString('hex'));
      const h2 = dumpHash(view2, core2.key.toString('hex'));
      assert.equal(h1.hash, h2.hash);
      assert.equal(serializeDs(p1.ds).toString('hex'), serializeDs(p2.ds).toString('hex'));
      view1.close();
      view2.close();
      await core1.close();
      await core2.close();
    } finally {
      fs.rmSync(dir1, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
      fs.rmSync(dir2, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  });

  it('teste 3 — snapshot equivalente: a cada K, com boot no meio, o estado não muda', async () => {
    // O caminho do snapshot é diferente por construção: o DS do meio é reconstruído do
    // snapshot + rematerialização de mensagens do view.db, e o resto do log é interpretado
    // de cima dele. Precisa terminar idêntico ao caminho sem snapshot.
    const K = 997;
    const sem = await projectClean(corpus.log, { snapshotInterval: 1_000_000_000 });

    const dir = tempDir();
    try {
      const kp = keypairFromSeed('core');
      const corePath = await writeCore(dir, kp, corpus.log);
      const viewPath = path.join(dir, 'view.db');
      const core = await openCore(corePath, kp.publicKey);
      const view = openViewDb(viewPath);
      const p1 = new Projector(view, core, { foldBuildId: buildId, snapshotInterval: K });
      await p1.boot();
      // Um "boot" de verdade: projector novo sobre a mesma view, continuando do snapshot.
      const p2 = new Projector(view, core, { foldBuildId: buildId, snapshotInterval: K });
      await p2.boot();
      const com = dumpHash(view, core.key.toString('hex'));
      assert.equal(com.hash, sem.hash, 'dump idêntico com e sem snapshot');
      assert.equal(serializeDs(p2.ds).toString('hex'), sem.dsHex, 'DecisionState idêntico (§28.4 teste 3)');
      view.close();
      await core.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  });

  it('reprojeção total a partir de um view.db corrompido pela metade converge', async () => {
    const dir = tempDir();
    try {
      const kp = keypairFromSeed('core');
      const corePath = await writeCore(dir, kp, corpus.log);
      const viewPath = path.join(dir, 'view.db');
      const core = await openCore(corePath, kp.publicKey);
      const view = openViewDb(viewPath);
      const p = new Projector(view, core, { foldBuildId: buildId, snapshotInterval: 500 });
      await p.boot();
      // Simula o crash no meio do caminho: a view existe, o marcador e o snapshot estão
      // atrás um do outro — o boot precisa detectar a inconsistência e reprojetar (§10.3).
      view.transaction(() => {
        view.setInterpretedSeqMarker(core.key.toString('hex'), 0);
      });
      const p2 = new Projector(view, core, { foldBuildId: buildId, snapshotInterval: 500 });
      await p2.boot();
      const { hash } = dumpHash(view, core.key.toString('hex'));
      const referência = await projectClean(corpus.log);
      assert.equal(hash, referência.hash);
      view.close();
      await core.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  });
});
