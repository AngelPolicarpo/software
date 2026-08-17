/**
 * Cabo de testes do `projector` — hypercore real em diretório temporário, `view.db` real em
 * arquivo. O projector é L1→L0 por contrato (§4): os testes dele **podem** fazer I/O — a
 * regra de pureza de §4 vale para `fold`/`opCodec`/`permissions`/`idgen`, não para o
 * projector (§28.1). O que não pode haver é aleatoriedade nem relógio de parede no que entra
 * no `fold`: o corpus é determinístico (§28.4).
 *
 * A escrita do core usa `hypercore` direto, e não o `corestore`: o módulo de produto é
 * deliberadamente só-leitura nesta fase (a escrita é do `communityHost`/outbox, fase 3, e a
 * barreira de durabilidade de §11 — P1 — não cruza o projector).
 */

import Hypercore from 'hypercore';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openCore, type CoreHandle } from '../../src/l0/corestore/index.ts';
import { dumpHash, openViewDb, type ViewDb } from '../../src/l0/view/index.ts';
import { Projector, type ProjectorOptions } from '../../src/l1/projector/index.ts';
import { keypairFromSeed, type Keypair } from './world.ts';

export type Harness = {
  dir: string;
  corePath: string;
  viewPath: string;
  core: CoreHandle;
  view: ViewDb;
  communityId: string;
  close(): Promise<void>;
};

/** Grava o log no hypercore com o par de chaves dado — a escrita que a fase 2 não dá ao produto. */
export async function writeCore(dir: string, keypair: Keypair, log: readonly Uint8Array[]): Promise<string> {
  const corePath = path.join(dir, 'core');
  const core = new Hypercore(corePath, {
    key: keypair.publicKey,
    keyPair: { publicKey: keypair.publicKey, secretKey: keypair.secretKey },
    compat: true,
  });
  await core.ready();
  for (const rec of log) await core.append(Buffer.from(rec));
  await core.close();
  return corePath;
}

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
}

export async function openHarness(dir: string, keypair: Keypair): Promise<{ core: CoreHandle; view: ViewDb; communityId: string }> {
  const core = await openCore(path.join(dir, 'core'), keypair.publicKey);
  const view = openViewDb(path.join(dir, 'view.db'));
  return { core, view, communityId: core.key.toString('hex') };
}

export async function setup(
  log: readonly Uint8Array[],
  keypair: Keypair = keypairFromSeed('core'),
): Promise<Harness & { dir: string }> {
  const dir = tempDir();
  await writeCore(dir, keypair, log);
  const { core, view, communityId } = await openHarness(dir, keypair);
  return {
    dir,
    corePath: path.join(dir, 'core'),
    viewPath: path.join(dir, 'view.db'),
    core,
    view,
    communityId,
    close: async () => {
      view.close();
      await core.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function makeProjector(
  h: Harness,
  opts: Partial<ProjectorOptions> & { foldBuildId: string },
): Projector {
  return new Projector(h.view, h.core, opts);
}

export function hashOf(h: Harness): string {
  return dumpHash(h.view, h.communityId).hash;
}

export const BUILD_A = 'build-a';
export const BUILD_B = 'build-b';
