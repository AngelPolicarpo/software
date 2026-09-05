// §18.4 lado do ALVO (B7) — observar o próprio ban/kick e entrar em modo removido.
//
// O que estes testes provam é que os passos 1–4 acontecem, e a parte mais fácil de esquecer:
// que eles acontecem **uma vez**. Cada lote projetado passa pelo mesmo gancho, e refazer o
// passo 2 empurraria `retain_until` para a frente a cada op nova — um prazo de 7 dias que
// nunca vence é o oposto de um prazo.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { openViewDb } from '../src/l0/view/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import { MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import { bootCore, type CoreRuntime } from '../src/composition/boot.ts';
import { aplicarRemocaoPropria, causaDaPropriaSaida, type RemocaoDeps } from '../src/composition/removido.ts';
import { silentLogger } from '../src/composition/logger.ts';
import { RpcServer } from '../src/l3/rpcServer/index.ts';
import { wireRefusedCommunityRpc } from '../src/composition/ports.ts';
import { rpcPair, tempDir } from './helpers/composition.ts';
import { T0, World, genesis, joinMember, keypairFromSeed, makeRecord } from './helpers/world.ts';

const DATA_KEY = Buffer.alloc(32, 66);

// ─── A decisão, pura ────────────────────────────────────────────────────────────────────

describe('§18.4 — por que esta instalação saiu (B7)', () => {
  const EU = 'ab'.repeat(32);

  function estado(state: 'active' | 'left' | 'banned' | 'ausente', joinedAt = T0) {
    return {
      members: state === 'ausente' ? new Map() : new Map([[EU, { state, joinedAt }]]),
    };
  }

  it('membro ativo não saiu', () => {
    assert.equal(causaDaPropriaSaida(estado('active'), EU, () => true), null);
  });

  it('banido é `banned`, sem consultar auditoria nenhuma', () => {
    let consultou = false;
    const causa = causaDaPropriaSaida(estado('banned'), EU, () => {
      consultou = true;
      return false;
    });
    assert.equal(causa, 'banned');
    assert.equal(consultou, false, 'o estado do membro já basta — ban não é ambíguo');
  });

  it('`left` com kick sobre mim na membresia corrente é `kicked`; sem ele é `left`', () => {
    assert.equal(causaDaPropriaSaida(estado('left'), EU, () => true), 'kicked');
    assert.equal(causaDaPropriaSaida(estado('left'), EU, () => false), 'left');
  });

  it('o kick consultado é o da membresia CORRENTE — um kick de antes de eu reentrar não conta', () => {
    let desdeVisto = -1;
    causaDaPropriaSaida(estado('left', T0 + 5_000), EU, (desde) => {
      desdeVisto = desde;
      return false;
    });
    assert.equal(desdeVisto, T0 + 5_000, 'a janela é o `joinedAt` da membresia corrente');
  });

  it('membro AUSENTE do mapa não é remoção — é réplica que ainda não interpretou o join', () => {
    // Tratar ausência como saída apagaria a comunidade de quem acabou de entrar nela.
    assert.equal(causaDaPropriaSaida(estado('ausente'), EU, () => true), null);
  });
});

// ─── Os passos, e a idempotência ────────────────────────────────────────────────────────

describe('§18.4 passos 1–4 — uma vez, e só uma (B7)', () => {
  function rig() {
    const dir = tempDir('removido-passos');
    const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
    const view = openViewDb(path.join(dir, 'view.db'));
    const cid = 'c'.repeat(64);
    manifest.upsertCommunity({
      communityId: cid,
      coreKey: Buffer.alloc(32, 1),
      blobsKey: Buffer.alloc(32, 2),
      isHost: false,
      joinedAt: T0,
    });
    const desligadas: string[] = [];
    const descartes: Array<{ cid: string; motivo: string }> = [];
    const eventos: Array<{ cid: string; cause: string }> = [];
    let agora = T0 + 1_000;
    const deps: RemocaoDeps = {
      manifest,
      view,
      now: () => agora,
      retentionDays: 7,
      desligarDaRede: (c) => desligadas.push(c),
      descartarFila: (c, motivo) => {
        descartes.push({ cid: c, motivo });
        return 3;
      },
      emitir: (c, cause) => eventos.push({ cid: c, cause }),
    };
    const fechar = (): void => {
      view.close();
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    };
    return { cid, manifest, deps, desligadas, descartes, eventos, fechar, avancar: (ms: number) => (agora += ms) };
  }

  it('ban: sai da rede, marca motivo e prazo, descarta a fila e emite o evento', () => {
    const r = rig();
    try {
      assert.equal(aplicarRemocaoPropria(r.deps, { communityId: r.cid, causa: 'banned' }), 'banned');

      assert.deepEqual(r.desligadas, [r.cid], 'passo 1');
      const linha = r.manifest.getCommunity(r.cid) as { removed_reason: string; retain_until: number; left_at: number };
      assert.equal(linha.removed_reason, 'banned', 'passo 2');
      assert.equal(linha.retain_until, T0 + 1_000 + 7 * 24 * 60 * 60 * 1000, 'passo 2 — REMOVED_RETENTION_DAYS');
      assert.equal(linha.left_at, T0 + 1_000);
      assert.deepEqual(r.descartes, [{ cid: r.cid, motivo: 'banned' }], 'passo 3');
      assert.deepEqual(r.eventos, [{ cid: r.cid, cause: 'banned' }], 'passo 4');
    } finally {
      r.fechar();
    }
  });

  it('o segundo lote não refaz nada — o prazo é do primeiro instante, não do último lote', () => {
    const r = rig();
    try {
      aplicarRemocaoPropria(r.deps, { communityId: r.cid, causa: 'banned' });
      const antes = (r.manifest.getCommunity(r.cid) as { retain_until: number }).retain_until;

      r.avancar(60_000);
      assert.equal(aplicarRemocaoPropria(r.deps, { communityId: r.cid, causa: 'banned' }), null);

      const depois = (r.manifest.getCommunity(r.cid) as { retain_until: number }).retain_until;
      assert.equal(depois, antes, 'refazer empurraria o prazo para a frente a cada op nova');
      assert.equal(r.desligadas.length, 1);
      assert.equal(r.descartes.length, 1);
      assert.equal(r.eventos.length, 1, 'e o renderer receberia `accessRevoked` a cada lote');
    } finally {
      r.fechar();
    }
  });

  it('`unauthorized` e `left` não descartam fila — os motivos de §11.7 são só ban e kick', () => {
    for (const causa of ['unauthorized', 'left'] as const) {
      const r = rig();
      try {
        assert.equal(aplicarRemocaoPropria(r.deps, { communityId: r.cid, causa }), causa);
        assert.deepEqual(r.descartes, [], `${causa} não tem motivo de descarte em §11.7`);
        assert.deepEqual(r.eventos, [{ cid: r.cid, cause: causa }]);
      } finally {
        r.fechar();
      }
    }
  });

  it('comunidade que não está no manifest não vira modo removido', () => {
    const r = rig();
    try {
      assert.equal(aplicarRemocaoPropria(r.deps, { communityId: 'f'.repeat(64), causa: 'banned' }), null);
      assert.deepEqual(r.desligadas, []);
    } finally {
      r.fechar();
    }
  });
});

// ─── O ciclo real: o ban chega pelo log e a réplica entra em modo histórico ──────────────

describe('§18.4 — o ban chega pelo log e a comunidade vira esquecível (B7)', () => {
  it('o alvo observa o próprio ban, marca a réplica e `community.forget` passa a ser possível', async () => {
    const dir = tempDir('removido-ciclo');
    const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
    const view = openViewDb(path.join(dir, 'view.db'));
    const g = genesis(new World(keypairFromSeed('rm-core')), keypairFromSeed('rm-fundador'));
    const membro = joinMember(g, 'rm-membro');
    const cid = g.world.core.publicKey.toString('hex');
    manifest.upsertCommunity({
      communityId: cid,
      coreKey: g.world.core.publicKey,
      blobsKey: keypairFromSeed('rm-blobs').publicKey,
      isHost: false,
      joinedAt: T0,
    });
    manifest.advanceAuthorSeq(cid, `channel:${g.channelId}`, 2);

    let aoAnexar: (() => void) | null = null;
    const nucleo = {
      key: g.world.core.publicKey,
      get length() {
        return g.world.log.length;
      },
      get: async (seq: number) => (g.world.log as Array<Uint8Array | undefined>)[seq] ?? null,
      onAppend: (l: () => void) => {
        aoAnexar = l;
        return () => {
          aoAnexar = null;
        };
      },
      close: async () => {},
    };
    const [coreSide, rendererSide] = MemoryIpcPort.createPair();
    const eventos: Array<{ topic: string; data: Record<string, unknown> }> = [];
    rendererSide.onMessage((raw) => {
      const f = raw as Record<string, unknown>;
      if (f['t'] === 'ev') eventos.push({ topic: f['topic'] as string, data: f['data'] as Record<string, unknown> });
    });

    const runtime: CoreRuntime = await bootCore({
      dataDir: dir,
      manifest,
      view,
      swarm: new Swarm(),
      dataKey: DATA_KEY,
      identity: () => membro,
      foldBuildId: 'b7-removido',
      ipcPort: coreSide,
      epoch: 1,
      tokenVerifier: { consume: () => true },
      hostTurnSecret: () => Buffer.alloc(32, 7),
      now: () => T0 + 2_000,
      schedule: () => 0,
      cancel: () => {},
      logger: silentLogger(),
      openCore: async () => nucleo,
    });
    const vivo = setInterval(() => {}, 5);
    // §15.1 — evento só chega a quem assinou; sem isto o `emit` não empurra nada.
    rendererSide.postMessage({ t: 'sub', epoch: 1, id: 9001, topic: 'community.accessRevoked' });
    try {
      // Antes do ban: réplica normal, e `community.forget` recusa porque nada a marcou.
      const antes = manifest.getCommunity(cid) as { removed_reason: string | null };
      assert.equal(antes.removed_reason, null);

      // O host bane o alvo. Em v2 o alvo AINDA replica quando isto chega (§14.3), que é o
      // que torna o gatilho de §18.4 alcançável.
      g.world.push(
        makeRecord(g.world.core, {
          kind: 'mod.ban',
          author: g.founder,
          authorSeq: g.world.next(g.founder),
          hostTs: T0 + 1_500,
          payload: { targetKey: membro.publicKey },
        }),
      );
      (aoAnexar as (() => void) | null)?.();
      await esperar(
        () => (manifest.getCommunity(cid) as { removed_reason: string | null }).removed_reason !== null,
        'a réplica não entrou em modo removido',
      );

      const linha = manifest.getCommunity(cid) as { removed_reason: string; retain_until: number };
      assert.equal(linha.removed_reason, 'banned');
      assert.equal(linha.retain_until, T0 + 2_000 + 7 * 24 * 60 * 60 * 1000);
      assert.ok(
        eventos.some((e) => e.topic === 'community.accessRevoked' && e.data['cause'] === 'banned'),
        'o renderer não recebeu `accessRevoked{banned}` — é o que abre a tela de U-16',
      );
    } finally {
      clearInterval(vivo);
      await runtime.close().catch(() => {});
      view.close();
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  });
});

describe('§18.4 SEGUNDO gatilho — a recusa do host chega e a réplica sai de reconnecting', () => {
  it('`hello` recusado com E_NOT_AUTHORIZED_FOR_COMMUNITY vira modo removido `unauthorized`', async () => {
    const dir = tempDir('removido-unauthorized');
    const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
    const view = openViewDb(path.join(dir, 'view.db'));
    const g = genesis(new World(keypairFromSeed('un-core')), keypairFromSeed('un-fundador'));
    const membro = joinMember(g, 'un-membro');
    const cid = g.world.core.publicKey.toString('hex');
    manifest.upsertCommunity({
      communityId: cid,
      coreKey: g.world.core.publicKey,
      blobsKey: keypairFromSeed('un-blobs').publicKey,
      isHost: false,
      joinedAt: T0,
    });

    // O log NÃO carrega o ban: é exatamente o caso de §18.4 que o primeiro gatilho não
    // alcança — o alvo foi removido enquanto estava offline e os pares recusam o canal de
    // replicação, então o bloco do `mod.ban` nunca chega até ele.
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
    const eventos: Array<{ topic: string; data: Record<string, unknown> }> = [];
    rendererSide.onMessage((raw) => {
      const f = raw as Record<string, unknown>;
      if (f['t'] === 'ev') eventos.push({ topic: f['topic'] as string, data: f['data'] as Record<string, unknown> });
    });

    const runtime: CoreRuntime = await bootCore({
      dataDir: dir,
      manifest,
      view,
      swarm: new Swarm(),
      dataKey: DATA_KEY,
      identity: () => membro,
      foldBuildId: 'b7-unauthorized',
      ipcPort: coreSide,
      epoch: 1,
      tokenVerifier: { consume: () => true },
      hostTurnSecret: () => Buffer.alloc(32, 7),
      now: () => T0 + 2_000,
      schedule: () => 0,
      cancel: () => {},
      logger: silentLogger(),
      openCore: async () => nucleo,
    });
    const vivo = setInterval(() => {}, 5);
    rendererSide.postMessage({ t: 'sub', epoch: 1, id: 9002, topic: 'community.accessRevoked' });
    try {
      // O host do outro lado do cabo é um canal RECUSADO de §14.3(1): nenhum método servido,
      // só o código. Antes desta rodada o transporte não abria canal nenhum para o banido, e
      // era esse silêncio que deixava a instalação em `reconnecting` para sempre.
      const [ladoMembro, ladoHost] = rpcPair();
      wireRefusedCommunityRpc(new RpcServer({ protocol: 'community', transport: ladoHost }));
      runtime.attachHostChannel({ communityId: cid, transport: ladoMembro });

      await esperar(
        () => (manifest.getCommunity(cid) as { removed_reason: string | null }).removed_reason !== null,
        'a recusa do host não virou modo removido',
      );
      const linha = manifest.getCommunity(cid) as { removed_reason: string; retain_until: number };
      assert.equal(linha.removed_reason, 'unauthorized');
      assert.ok(
        eventos.some((e) => e.topic === 'community.accessRevoked' && e.data['cause'] === 'unauthorized'),
        'o renderer não recebeu `accessRevoked{unauthorized}` — é o que abre a tela de U-16',
      );
    } finally {
      clearInterval(vivo);
      await runtime.close().catch(() => {});
      view.close();
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  });
});

async function esperar(cond: () => boolean, msg: string, timeoutMs = 3_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`${msg} (esperou ${timeoutMs} ms)`);
}
