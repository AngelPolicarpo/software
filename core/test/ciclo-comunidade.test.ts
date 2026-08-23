// §57 — as três superfícies que faltavam no bloco "Comunidade" de §15.4 e a marca de L-5.
//
//   §15.4  — `community.activate {communityId | null}` troca a residência (§8.1, escolha
//            LOCAL); `community.end ⏱` é main-confirmed, só o host corrente, com draining
//            de §18.7 na resposta; `community.forget` apaga réplica left/removed;
//   §18.5  — comunidade encerrada: zero ops novas (fold estágio 5), core em leitura;
//   §6.1   — L-5: `displayNameCollision` marca todo membro ATIVO cujo nome normalizado
//            coincide com o de outro ativo; sair/rename desmarca.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { openViewDb } from '../src/l0/view/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import { IdentityManager } from '../src/l0/identity/index.ts';
import { FallbackKeystoreOracle, acceptInsecure } from '../src/l0/keystore/index.ts';
import { MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import type { CoreRuntime } from '../src/composition/boot.ts';
import { bootCore } from '../src/composition/boot.ts';
import { silentLogger } from '../src/composition/logger.ts';
import { tempDir } from './helpers/composition.ts';
import { T0, World, genesis, joinMember, keypairFromSeed } from './helpers/world.ts';

const DATA_KEY = Buffer.alloc(32, 66);

type Frame = Record<string, unknown>;
type Resposta = { ok: boolean; data: unknown; code: string | null };

function cabo(rendererSide: MemoryIpcPort) {
  const pendentes = new Map<number, (r: Resposta) => void>();
  let proximoId = 4000;
  rendererSide.onMessage((raw) => {
    const frame = raw as Frame;
    if (frame['t'] === 'res') {
      const resolver = pendentes.get(frame['id'] as number);
      if (resolver !== undefined) {
        pendentes.delete(frame['id'] as number);
        const erro = frame['err'] as { code?: string } | undefined;
        resolver({ ok: frame['ok'] as boolean, data: frame['data'], code: erro?.code ?? null });
      }
    }
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

async function esperar(cond: () => boolean, msg: string, timeoutMs = 10_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`${msg} (esperou ${timeoutMs} ms)`);
}

/** Rig hospedeiro com identidade real — o mesmo da fatia anterior. */
async function rigHost(rotulo: string) {
  const dir = tempDir(rotulo);
  const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
  const view = openViewDb(path.join(dir, 'view.db'));
  const manager = new IdentityManager(dir, new FallbackKeystoreOracle(), manifest);
  await manager.create('Dona Raiz', 3);
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
    foldBuildId: `ciclo-57-${rotulo}`,
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
    manager,
    dir,
    io: cabo(rendererSide),
    async fechar() {
      clearInterval(vivo);
      if (runtime.phase !== 'stopped') await runtime.close().catch(() => {});
      try {
        view.close();
      } catch {}
      try {
        manifest.close();
      } catch {}
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    },
  };
}

describe('§57.1 community.activate — residência do DS (§8.1, §15.4)', () => {
  it('ativa fixa full, null volta a light, e hospedada continua full pela regra', async () => {
    const r = await rigHost('activate');
    try {
      const criadas = await r.io.request('community.create', { name: 'Ativa', iconColor: 0 });
      assert.ok(criadas.ok, JSON.stringify(criadas));
      const cid = (criadas.data as Record<string, unknown>)['communityId'] as string;

      assert.equal(r.manifest.residencyOf(cid), 'full', 'hospedada nasce full pela regra');
      r.manifest.setResidencyActive(null);

      // Sem ativação explícita, uma comunidade não-hospedada seria light; a regra deriva.
      assert.equal(((await r.io.request('community.activate', { communityId: null })).data as { residency: string }).residency, 'light');

      const ativada = await r.io.request('community.activate', { communityId: cid });
      assert.ok(ativada.ok, JSON.stringify(ativada));
      assert.equal((ativada.data as { residency: string }).residency, 'full');
      assert.equal(r.manifest.residencyOf(cid), 'full');

      const nula = await r.io.request('community.activate', { communityId: null });
      assert.ok(nula.ok);
      assert.equal(r.manifest.getResidencyActive(), null);

      // Forma errada e desconhecida.
      assert.equal((await r.io.request('community.activate', {})).code, 'E_VALIDATION');
      assert.equal((await r.io.request('community.activate', { communityId: 'f'.repeat(64) })).code, 'E_NOT_FOUND');
    } finally {
      await r.fechar();
    }
  });
});

describe('§57.2 community.end — encerrar é do host corrente, com draining na resposta (§18.5/§18.7)', () => {
  it('host encerra: seq + replicatedTo, endedAt projetado, ops novas recusadas, segunda vez E_COMMUNITY_ENDED', async () => {
    const r = await rigHost('end');
    try {
      const criada = await r.io.request('community.create', { name: 'Fim', iconColor: 2 });
      assert.ok(criada.ok, JSON.stringify(criada));
      const cid = (criada.data as Record<string, unknown>)['communityId'] as string;
      const canal = (criada.data as Record<string, unknown>)['defaultChannelId'] as string;

      // Um motivo maior que o teto de §8.6 recusa antes de qualquer op.
      const motivoRuim = await r.io.request('community.end', { communityId: cid, reason: 'x'.repeat(300) });
      assert.equal(motivoRuim.code, 'E_VALIDATION');

      const fim = await r.io.request('community.end', { communityId: cid, reason: 'encerrando' });
      assert.ok(fim.ok, JSON.stringify(fim));
      const dados = fim.data as { seq: number; replicatedTo: number };
      const c = r.runtime.get(cid)!;
      assert.notEqual(c.projector.ds.community.endedAt, undefined, 'o fold não marcou endedAt');
      assert.equal(dados.replicatedTo, c.core.length - 1, 'a réplica local alcançou a cabeça no orçamento');
      assert.ok(dados.seq <= c.core.length - 1);

      // §18.5 — terminal: leitura segue, escrita recusa.
      assert.equal((await r.io.request('channel.create', { communityId: cid, categoryId: 'x', type: 0, name: 'novo' })).code, 'E_COMMUNITY_ENDED');
      const estrutura = await r.io.request('query.structure', { communityId: cid });
      assert.ok(estrutura.ok, 'comunidade encerrada permanece legível');

      const deNovo = await r.io.request('community.end', { communityId: cid });
      assert.equal(deNovo.code, 'E_COMMUNITY_ENDED');
    } finally {
      await r.fechar();
    }
  });

  it('quem não é host corrente recebe E_NOT_HOST antes de qualquer op', async () => {
    const dir = tempDir('end-membro');
    const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
    const view = openViewDb(path.join(dir, 'view.db'));
    const g = genesis(new World(keypairFromSeed('end-core')), keypairFromSeed('end-fundador'));
    const membro = joinMember(g, 'end-membro-eu');
    const cid = g.world.core.publicKey.toString('hex');
    manifest.upsertCommunity({
      communityId: cid,
      coreKey: g.world.core.publicKey,
      blobsKey: keypairFromSeed('end-blobs').publicKey,
      isHost: false,
      joinedAt: T0,
    });
    const nucleo = {
      key: g.world.core.publicKey,
      get length() {
        return g.world.log.length;
      },
      get: async (seq: number) => (g.world.log as Array<Uint8Array | undefined>)[seq] ?? null,
      onAppend: () => () => {},
      close: async () => {},
    };
    const [coreSide, rendererSide] = MemoryIpcPort.createPair();
    const runtimeMembro: CoreRuntime = await bootCore({
      dataDir: dir,
      manifest,
      view,
      swarm: new Swarm(),
      dataKey: DATA_KEY,
      identity: () => membro,
      foldBuildId: 'ciclo-57-membro',
      ipcPort: coreSide,
      epoch: 1,
      tokenVerifier: { consume: () => true },
      hostTurnSecret: () => Buffer.alloc(32, 7),
      now: () => T0,
      schedule: () => 0,
      cancel: () => {},
      logger: silentLogger(),
      openCore: async () => nucleo,
    });
    const vivo = setInterval(() => {}, 5);
    const io = cabo(rendererSide);
    try {
      const fim = await io.request('community.end', { communityId: cid });
      assert.equal(fim.code, 'E_NOT_HOST');
    } finally {
      clearInterval(vivo);
      await runtimeMembro.close().catch(() => {});
      view.close();
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  });

  it('comunidade desconhecida é E_NOT_FOUND', async () => {
    const r = await rigHost('end-desconhecida');
    try {
      assert.equal((await r.io.request('community.end', { communityId: 'a'.repeat(64) })).code, 'E_NOT_FOUND');
    } finally {
      await r.fechar();
    }
  });
});

describe('§57.3 community.forget — apagar a réplica de quem já saiu (§18.4)', () => {
  it('comunidade participada é E_VALIDATION; desconhecida E_NOT_FOUND; left sai do disco e do LS', async () => {
    const r = await rigHost('forget');
    try {
      const criada = await r.io.request('community.create', { name: 'Esquecível', iconColor: 4 });
      assert.ok(criada.ok, JSON.stringify(criada));
      const cid = (criada.data as Record<string, unknown>)['communityId'] as string;
      assert.ok(fs.existsSync(path.join(r.dir, 'cores', cid)), 'core deveria existir no disco');

      // Pré-condições da tabela: só left/removed é esquecível.
      assert.equal((await r.io.request('community.forget', { communityId: cid })).code, 'E_VALIDATION');
      assert.equal((await r.io.request('community.forget', { communityId: 'b'.repeat(64) })).code, 'E_NOT_FOUND');

      // Estado `left` pré-marcado no LS (o host não sai por op — §6.2): o esquecimento
      // desmonta o resto — runtime, swarm, LS/CS e disco.
      r.manifest.markCommunityLeft(cid, T0 + 100);
      const esquecida = await r.io.request('community.forget', { communityId: cid });
      assert.ok(esquecida.ok, JSON.stringify(esquecida));
      await esperar(() => !fs.existsSync(path.join(r.dir, 'cores', cid)), 'core não saiu do disco');
      assert.equal(r.runtime.get(cid), undefined, 'comunidade ainda aberta no runtime');
      assert.equal(r.manifest.getCommunity(cid), null, 'linha ainda no manifest');
    } finally {
      await r.fechar();
    }
  });

  it('fluxo de membro real: leave → forget sem deixar linha nem fila', async () => {
    const dir = tempDir('forget-membro');
    const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
    const view = openViewDb(path.join(dir, 'view.db'));
    const g = genesis(new World(keypairFromSeed('fg-core')), keypairFromSeed('fg-fundador'));
    const membro = joinMember(g, 'fg-membro');
    const cid = g.world.core.publicKey.toString('hex');
    manifest.upsertCommunity({
      communityId: cid,
      coreKey: g.world.core.publicKey,
      blobsKey: keypairFromSeed('fg-blobs').publicKey,
      isHost: false,
      joinedAt: T0,
    });
    manifest.advanceAuthorSeq(cid, `channel:${g.channelId}`, 2);
    const nucleo = {
      key: g.world.core.publicKey,
      get length() {
        return g.world.log.length;
      },
      get: async (seq: number) => (g.world.log as Array<Uint8Array | undefined>)[seq] ?? null,
      onAppend: () => () => {},
      close: async () => {},
    };
    const [coreSide, rendererSide] = MemoryIpcPort.createPair();
    const runtimeMembro: CoreRuntime = await bootCore({
      dataDir: dir,
      manifest,
      view,
      swarm: new Swarm(),
      dataKey: DATA_KEY,
      identity: () => membro,
      foldBuildId: 'ciclo-57-forget',
      ipcPort: coreSide,
      epoch: 1,
      tokenVerifier: { consume: () => true },
      hostTurnSecret: () => Buffer.alloc(32, 7),
      now: () => T0,
      schedule: () => 0,
      cancel: () => {},
      logger: silentLogger(),
      openCore: async () => nucleo,
    });
    const vivo = setInterval(() => {}, 5);
    const io = cabo(rendererSide);
    try {
      // Deixa um item na fila para provar que o purge não o deixa órfão.
      const enviada = await io.request('message.send', { communityId: cid, channelId: g.channelId, content: 'vai junto', mentions: [] });
      assert.ok(enviada.ok, JSON.stringify(enviada));

      const saida = await io.request('community.leave', { communityId: cid });
      assert.ok(saida.ok, JSON.stringify(saida));

      const esquecida = await io.request('community.forget', { communityId: cid });
      assert.ok(esquecida.ok, JSON.stringify(esquecida));
      assert.equal(manifest.getCommunity(cid), null);
      assert.deepEqual(((await io.request('query.outbox', {})).data as { items: unknown[] }).items, []);
    } finally {
      clearInterval(vivo);
      await runtimeMembro.close().catch(() => {});
      view.close();
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  });
});

describe('§57.4 L-5 — displayNameCollision no fold (§6.1)', () => {
  it('nomes equivalentes por NFKC+casefold+colapso colidem; rename e saída desmarcam', () => {
    const g = genesis(new World(keypairFromSeed('l5-core')), keypairFromSeed('l5-fundador'));
    const ana = joinMember(g, 'ana');
    const ana2 = joinMember(g, 'Ana');
    const outro = joinMember(g, 'outro');
    const hex = (k: { publicKey: Buffer }): string => k.publicKey.toString('hex');

    assert.equal(g.world.state.members.get(hex(ana))?.displayNameCollision, true, 'ana deveria colidir');
    assert.equal(g.world.state.members.get(hex(ana2))?.displayNameCollision, true, 'Ana deveria colidir');
    assert.notEqual(g.world.state.members.get(hex(outro))?.displayNameCollision, true);

    // Casefold + colapso: mais um nome equivalente entra e também colide.
    const ana3 = joinMember(g, '  ANA  ');
    assert.equal(g.world.state.members.get(hex(ana3))?.displayNameCollision, true);

    // Rename de um deles descola os demais.
    g.world.submit({
      kind: 'identity.update',
      author: ana3,
      hostTs: T0 + 200,
      payload: { displayName: 'Ana Clara' },
    });
    assert.equal(g.world.state.members.get(hex(ana3))?.displayNameCollision, undefined);
    assert.equal(g.world.state.members.get(hex(ana))?.displayNameCollision, true, 'ana e Ana seguem colidindo');

    // A saída de uma delas descola a outra.
    g.world.submit({ kind: 'member.leave', author: ana2, hostTs: T0 + 300, payload: {} });
    assert.equal(g.world.state.members.get(hex(ana))?.displayNameCollision, undefined, 'sobrando uma, não há colisão');

    // Determinismo: reprojeção do log inteiro produz as MESMAS marcas.
    const rp = g.world.reproject();
    assert.equal(rp.state.members.get(hex(ana))?.displayNameCollision, undefined);
  });
});
