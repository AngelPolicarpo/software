// A projeção de uma comunidade não pode apagar a das outras (§10.1, §10.5).
//
// `view.db` é **um banco para todas as comunidades** (§10.1) e o `Projector` é **por
// comunidade**. Enquanto `reproject()` começava com `view.wipe()` — `DROP` de todas as
// tabelas —, abrir a segunda comunidade apagava o estado projetado da primeira, e o `#run`
// seguinte só refoldava o log da que estava abrindo. As quatro portas que abrem uma
// comunidade depois do boot passam pelo mesmo `openCommunity` → `projector.boot()`:
// `community.create`, `invite.redeem` (§12.4), a continuação descoberta de §18.8 e
// `identity.import`. Hospedar uma e entrar noutra esvaziava a primeira.
//
// O laço do boot (§3.3 `open`) transformava o acidente em regra: sem snapshot válido, cada
// comunidade reprojetava e derrubava a anterior — só a última sobrevivia, e reiniciar
// reproduzia o defeito em vez de curá-lo. `core.reproject` sem argumento, que §10.5 oferece
// como recuperação, tinha o mesmo furo pelo mesmo motivo.
//
// §10.5 é explícito: o `DROP`/recria (passo 2) é global e vem **antes** de "para cada
// comunidade, `fold` do `seq` 0" (passo 3). O passo 2 é do boot; o passo 3, do projetor,
// que limpa só o próprio escopo (`purgeCommunityData`).
//
// Verificado por mutação: voltar `reproject()` a `this.#view.wipe()` derruba os três casos.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { VIEW_SCHEMA_VERSION, openViewDb } from '../src/l0/view/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import { IdentityManager } from '../src/l0/identity/index.ts';
import { FallbackKeystoreOracle, acceptInsecure } from '../src/l0/keystore/index.ts';
import { MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import type { CoreRuntime } from '../src/composition/boot.ts';
import { bootCore } from '../src/composition/boot.ts';
import { silentLogger } from '../src/composition/logger.ts';
import { tempDir } from './helpers/composition.ts';
import { T0 } from './helpers/world.ts';

const DATA_KEY = Buffer.alloc(32, 66);

type Frame = Record<string, unknown>;
type Resposta = { ok: boolean; data: unknown; code: string | null };

function cabo(rendererSide: MemoryIpcPort) {
  const pendentes = new Map<number, (r: Resposta) => void>();
  let proximoId = 7000;
  rendererSide.onMessage((raw) => {
    const frame = raw as Frame;
    if (frame['t'] !== 'res') return;
    const resolver = pendentes.get(frame['id'] as number);
    if (resolver === undefined) return;
    pendentes.delete(frame['id'] as number);
    const erro = frame['err'] as { code?: string } | undefined;
    resolver({ ok: frame['ok'] as boolean, data: frame['data'], code: erro?.code ?? null });
  });
  return {
    async request(cmd: string, arg: unknown): Promise<Resposta> {
      const id = ++proximoId;
      return await new Promise<Resposta>((resolve) => {
        pendentes.set(id, resolve);
        rendererSide.postMessage({ t: 'req', epoch: 1, id, cmd, arg, authToken: 'ok' });
      });
    },
  };
}

/** Rig hospedeiro com identidade real. `dirDado` reabre a MESMA instalação (reboot). */
async function rigHost(rotulo: string, dirDado?: string) {
  const dir = dirDado ?? tempDir(rotulo);
  const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
  const view = openViewDb(path.join(dir, 'view.db'));
  const manager = new IdentityManager(dir, new FallbackKeystoreOracle(), manifest);
  if (!(await manager.load())) await manager.create('Dona Raiz', 3);
  acceptInsecure(dir, 'rig');
  const [coreSide, rendererSide] = MemoryIpcPort.createPair();
  const runtime: CoreRuntime = await bootCore({
    dataDir: dir,
    manifest,
    view,
    swarm: new Swarm(),
    dataKey: DATA_KEY,
    identity: () => manager.getKeyPair(),
    identityManager: manager,
    foldBuildId: `duas-comunidades-${rotulo}`,
    ipcPort: coreSide,
    epoch: 1,
    tokenVerifier: { consume: () => true },
    hostTurnSecret: () => Buffer.alloc(32, 7),
    now: () => T0 + 1000,
    schedule: () => 0,
    cancel: () => {},
    logger: silentLogger(),
  });
  const vivo = setInterval(() => {}, 5);
  return {
    runtime,
    manifest,
    view,
    dir,
    io: cabo(rendererSide),
    async fechar(apagar = true) {
      clearInterval(vivo);
      if (runtime.phase !== 'stopped') await runtime.close().catch(() => {});
      try {
        view.close();
      } catch {}
      try {
        manifest.close();
      } catch {}
      if (apagar) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    },
  };
}

/** `categoria/canal` de cada canal projetado, na ordem de §23.2. */
function salas(estrutura: unknown): string[] {
  const cats = (estrutura as { categories: Array<{ name: string; channels: Array<{ name: string }> }> }).categories;
  return cats.flatMap((c) => c.channels.map((ch) => `${c.name}/${ch.name}`));
}

async function criar(io: ReturnType<typeof cabo>, name: string, iconColor: number): Promise<string> {
  const r = await io.request('community.create', { name, iconColor });
  assert.ok(r.ok, JSON.stringify(r));
  return (r.data as Record<string, unknown>)['communityId'] as string;
}

async function estruturaDe(io: ReturnType<typeof cabo>, communityId: string): Promise<string[]> {
  const r = await io.request('query.structure', { communityId });
  assert.ok(r.ok, JSON.stringify(r));
  return salas(r.data);
}

describe('duas comunidades no mesmo núcleo — a projeção de uma não apaga a da outra (§10.1/§10.5)', () => {
  it('abrir a segunda preserva as salas da primeira', async () => {
    const r = await rigHost('abrir-segunda');
    try {
      const alfa = await criar(r.io, 'Alfa', 0);
      // Uma categoria a mais, para não depender só da gênese de §19.1.
      const cat = await r.io.request('category.create', { communityId: alfa, name: 'Salas' });
      assert.ok(cat.ok, JSON.stringify(cat));
      const antes = await estruturaDe(r.io, alfa);
      assert.deepEqual(antes, ['GERAL/geral']);
      assert.equal((await r.io.request('query.structure', { communityId: alfa })).ok, true);

      const beta = await criar(r.io, 'Beta', 2);

      assert.deepEqual(await estruturaDe(r.io, alfa), antes, 'Alfa perdeu a projeção ao abrir Beta');
      assert.deepEqual(await estruturaDe(r.io, beta), ['GERAL/geral'], 'Beta nasceu sem gênese');
      // A categoria vazia continua projetada: o que se mede é a tabela, não só o canal.
      const cats = ((await r.io.request('query.structure', { communityId: alfa })).data as { categories: Array<{ name: string }> }).categories;
      assert.deepEqual(cats.map((c) => c.name).sort(), ['GERAL', 'Salas']);
    } finally {
      await r.fechar();
    }
  });

  it('reiniciar o núcleo devolve as duas — o laço do boot não derruba a anterior (§3.3)', async () => {
    const primeiro = await rigHost('reboot');
    const dir = primeiro.dir;
    let alfa = '';
    let beta = '';
    try {
      alfa = await criar(primeiro.io, 'Alfa', 0);
      beta = await criar(primeiro.io, 'Beta', 2);
    } finally {
      await primeiro.fechar(false);
    }
    const segundo = await rigHost('reboot', dir);
    try {
      assert.deepEqual(await estruturaDe(segundo.io, alfa), ['GERAL/geral'], 'Alfa não voltou do log');
      assert.deepEqual(await estruturaDe(segundo.io, beta), ['GERAL/geral'], 'Beta não voltou do log');
      // §10.5 passo 2 é do boot, e é ele quem carimba a versão — sem o carimbo, todo boot
      // reprojetaria tudo do zero achando que o schema mudou.
      assert.equal(segundo.view.metaGet('view_schema_version'), VIEW_SCHEMA_VERSION);
    } finally {
      await segundo.fechar();
    }
  });

  it('core.reproject reconstrói do log sem apagar a outra, com e sem alvo (§10.5, §15.4)', async () => {
    const r = await rigHost('reproject');
    try {
      const alfa = await criar(r.io, 'Alfa', 0);
      const beta = await criar(r.io, 'Beta', 2);

      const uma = await r.io.request('core.reproject', { communityId: alfa });
      assert.ok(uma.ok, JSON.stringify(uma));
      assert.deepEqual(await estruturaDe(r.io, alfa), ['GERAL/geral']);
      assert.deepEqual(await estruturaDe(r.io, beta), ['GERAL/geral'], 'reprojetar Alfa apagou Beta');

      const todas = await r.io.request('core.reproject', {});
      assert.ok(todas.ok, JSON.stringify(todas));
      assert.deepEqual(await estruturaDe(r.io, alfa), ['GERAL/geral'], 'a reprojeção total perdeu Alfa');
      assert.deepEqual(await estruturaDe(r.io, beta), ['GERAL/geral'], 'a reprojeção total perdeu Beta');
    } finally {
      await r.fechar();
    }
  });
});
