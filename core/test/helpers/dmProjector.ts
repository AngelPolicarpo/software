/**
 * Cabo de testes do `dmProjector` — `view.db` real em arquivo, cores em memória.
 *
 * O core é de mentira **de propósito**, e a razão é o que este arquivo mede: §31.13 é sobre a
 * ordem em que os blocos **chegam**, e um hypercore de verdade em disco não dá controle
 * nenhum sobre isso. O que o projetor consome do `corestore` é o contrato `CoreHandle` de L0
 * — `length`, `get`, `onAppend` —, e é ele que está aqui, incluindo o caso que §10.5 passo 6
 * nomeia e que só um cabo consegue produzir: `length` adiante do bloco disponível (buraco de
 * replicação).
 *
 * Os registros, esses, são os de verdade: `helpers/dm.ts` assina e cifra como §31.4 manda, e
 * o `dmFold` que interpreta é o de produto.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { CoreHandle } from '../../src/l0/corestore/index.ts';
import { dmDumpHash, openViewDb, type ViewDb } from '../../src/l0/view/index.ts';
import type { DmOrigin } from '../../src/l1/dmFold/index.ts';
import {
  DmProjector,
  type DmCores,
  type DmProjectedEvent,
  type DmProjectorOptions,
} from '../../src/l1/dmProjector/index.ts';

import { dmWorld, type DmWorld } from './dm.ts';

/** Um core em memória: blocos, buracos e `append` observável. */
export class CoreFalso implements CoreHandle {
  readonly key: Buffer;
  readonly #blocos: Array<Uint8Array | null> = [];
  readonly #ouvintes = new Set<() => void>();

  constructor(key: Buffer) {
    this.key = key;
  }

  get length(): number {
    return this.#blocos.length;
  }

  get(seq: number): Promise<Uint8Array | null> {
    return Promise.resolve(this.#blocos[seq] ?? null);
  }

  onAppend(listener: () => void): () => void {
    this.#ouvintes.add(listener);
    return () => this.#ouvintes.delete(listener);
  }

  /** Entrega blocos. Cada `null` é um buraco: conta no `length`, e o `get` devolve `null`. */
  push(...recs: ReadonlyArray<Uint8Array | null>): void {
    for (const r of recs) this.#blocos.push(r);
    for (const l of [...this.#ouvintes]) l();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  /** Preenche um buraco já contado no `length` — o bloco que a replicação alcançou. */
  fill(seq: number, rec: Uint8Array): void {
    this.#blocos[seq] = rec;
    for (const l of [...this.#ouvintes]) l();
  }
}

export type DmHarness = {
  readonly world: DmWorld;
  readonly view: ViewDb;
  readonly cores: Record<DmOrigin, CoreFalso>;
  readonly eventos: DmProjectedEvent[];
  readonly dir: string;
  hash(): string;
  close(): void;
};

export const DM_BUILD_A = 'dm-build-a';
export const DM_BUILD_B = 'dm-build-b';

export function tempDirDm(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dmproj-'));
}

export function harness(world: DmWorld = dmWorld()): DmHarness {
  const dir = tempDirDm();
  const view = openViewDb(path.join(dir, 'view.db'));
  const cores = {
    lo: new CoreFalso(world.lo.core.publicKey),
    hi: new CoreFalso(world.hi.core.publicKey),
  };
  const eventos: DmProjectedEvent[] = [];
  return {
    world,
    view,
    cores,
    eventos,
    dir,
    hash: () => dmDumpHash(view, world.conversationId).hash,
    close: () => {
      view.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    },
  };
}

export function projetor(h: DmHarness, opts: Partial<DmProjectorOptions> = {}): DmProjector {
  return new DmProjector(h.view, h.cores as unknown as DmCores, h.world.ctx, {
    foldBuildId: DM_BUILD_A,
    now: () => 1_700_000_000_000,
    onEvent: (evs) => h.eventos.push(...evs),
    ...opts,
  });
}

/**
 * O oráculo: um nó **novo** que recebe os dois logs inteiros de uma vez, sem snapshot e sem
 * história. É a projeção contra a qual toda outra ordem de chegada é comparada — a mesma
 * referência que G14 usou no cenário 1.
 */
export async function referencia(
  world: DmWorld,
  lo: ReadonlyArray<Uint8Array>,
  hi: ReadonlyArray<Uint8Array>,
): Promise<{ hash: string; h: DmHarness }> {
  const h = harness(world);
  const p = projetor(h, { snapshotInterval: Number.MAX_SAFE_INTEGER });
  h.cores.lo.push(...lo);
  h.cores.hi.push(...hi);
  await p.boot();
  return { hash: h.hash(), h };
}
