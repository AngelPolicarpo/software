import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { IdentityManager } from '../src/l0/identity/index.ts';
import { FallbackKeystoreOracle } from '../src/l0/keystore/index.ts';
import { ProcessLock } from '../src/l3/ipcMain/index.ts';

// Simula a máquina de estados retomável do identity.wipe de §18.6
async function executeWipe(
  dataDir: string,
  manifestDb: ManifestDb,
  identityManager: IdentityManager,
  lock: ProcessLock,
  crashAtStage?: string,
): Promise<{ completed: boolean; stoppedAt?: string }> {
  const STAGES = [
    'requested',
    'swarm-down',
    'cores-closed',
    'view-deleted',
    'manifest-deleted',
    'key-wiped',
    'done',
  ] as const;
  let currentStage = (manifestDb.metaGet('wipe_state') as string | null) ?? 'none';
  const startIndex =
    currentStage === 'none' ? 0 : Math.max(0, STAGES.indexOf(currentStage as typeof STAGES[number]));
  for (let i = startIndex; i < STAGES.length; i++) {
    const stage = STAGES[i] as string;
    if (stage === 'manifest-deleted') {
      fs.writeFileSync(path.join(dataDir, 'WIPE'), stage, 'utf8');
    } else if (stage !== 'done' && stage !== 'key-wiped') {
      manifestDb.metaSet('wipe_state', stage);
    }
    if (crashAtStage !== undefined && crashAtStage === stage) {
      return { completed: false, stoppedAt: stage };
    }
    switch (stage) {
      case 'view-deleted': {
        const viewDbPath = path.join(dataDir, 'view.db');
        if (fs.existsSync(viewDbPath)) fs.rmSync(viewDbPath, { force: true });
        break;
      }
      case 'manifest-deleted': {
        const manifestPath = path.join(dataDir, 'manifest.db');
        if (fs.existsSync(manifestPath)) fs.rmSync(manifestPath, { force: true });
        break;
      }
      case 'key-wiped': {
        identityManager.wipe();
        const keyPath = path.join(dataDir, 'identity.enc');
        const dataKeyPath = path.join(dataDir, 'datakey.wrapped');
        if (fs.existsSync(keyPath)) fs.rmSync(keyPath, { force: true });
        if (fs.existsSync(dataKeyPath)) fs.rmSync(dataKeyPath, { force: true });
        break;
      }
      case 'done': {
        const wipeSentinel = path.join(dataDir, 'WIPE');
        if (fs.existsSync(wipeSentinel)) fs.rmSync(wipeSentinel, { force: true });
        break;
      }
      default:
        break;
    }
  }
  lock.release();
  return { completed: true };
}

test('Fase 1 — §18.6 / §10.8: identity.wipe máquina de estados retomável', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-test-wipe-'));
  const oracle = new FallbackKeystoreOracle();
  const identity = new IdentityManager(tmpDir, oracle);
  await identity.create('WipeUser', 3);
  const manifestPath = path.join(tmpDir, 'manifest.db');
  const manifestDb = new ManifestDb(manifestPath);
  const lock = new ProcessLock(tmpDir);
  lock.acquire();

  await t.test('Crash simulado no estágio view-deleted e retomada até conclusão', async () => {
    const viewPath = path.join(tmpDir, 'view.db');
    fs.writeFileSync(viewPath, 'view content', 'utf8');
    const step1 = await executeWipe(tmpDir, manifestDb, identity, lock, 'view-deleted');
    assert.equal(step1.completed, false);
    assert.equal(step1.stoppedAt, 'view-deleted');
    assert.equal(manifestDb.metaGet('wipe_state'), 'view-deleted');
    const step2 = await executeWipe(tmpDir, manifestDb, identity, lock);
    assert.equal(step2.completed, true);
    assert.equal(lock.isLocked, false);
    assert.equal(identity.isLoaded, false);
    assert.equal(fs.existsSync(path.join(tmpDir, 'identity.enc')), false);
    assert.equal(fs.existsSync(path.join(tmpDir, 'WIPE')), false);
  });

  try {
    manifestDb.close();
  } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
