// §86 — o ciclo de vida da chamada visto da COMPOSIÇÃO, que é a camada onde os defeitos
// moravam. Os módulos de §17.4/§17.5 estavam certos e testados; o que faltava era alguém
// chamá-los.
//
//   §17.4  — a revogação derivada do log (`sweepAgainst`) existia com teste e **nunca era
//            chamada em produção**: ban, kick, timeout, `channel.delete` e o fim da
//            comunidade não alcançavam mídia nenhuma;
//   §19.8  — "o host encerra a sessão de voz imediatamente, emitindo
//            `voice.failed{reason:'channel-deleted'}` e `voice.revoked` a cada
//            participante" — a segunda metade existia, a primeira não;
//   §22.1  — o loop `voice.liveness`, que é a rede de segurança do participante fantasma.
//
// O rig é de identidade única de propósito: o host participa da chamada como qualquer
// membro (§17.4), então a sessão inteira é observável sem segundo nó — e é justamente a
// ligação da composição, não a decisão de L2, que está sob teste aqui.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { openViewDb } from '../src/l0/view/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import { CHANNEL_TYPE } from '../src/l1/fold/index.ts';
import { MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import { bootCore, type CoreRuntime } from '../src/composition/boot.ts';
import { LOOP_INTERVALS, VOICE_LIVENESS_MS } from '../src/composition/jobs.ts';
import { DEFAULT_HELLO_MS } from '../src/l2/communityClient/index.ts';
import { tempDir } from './helpers/composition.ts';
import { keypairFromSeed } from './helpers/world.ts';

const DATA_KEY = Buffer.alloc(32, 86);

type Frame = Record<string, unknown>;
type Resposta = { ok: boolean; data: unknown; code: string | null };

async function rig(rotulo: string) {
  const dir = tempDir(rotulo);
  const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
  const view = openViewDb(path.join(dir, 'view.db'));
  const [coreSide, rendererSide] = MemoryIpcPort.createPair();
  const identity = keypairFromSeed(`${rotulo}-eu`);
  const runtime: CoreRuntime = await bootCore({
    dataDir: dir,
    manifest,
    view,
    swarm: new Swarm(),
    dataKey: DATA_KEY,
    identity: () => identity,
    identityProfile: () => ({ displayName: 'Dona Raiz', avatarColor: 3 }),
    foldBuildId: 'voz-ciclo-86',
    ipcPort: coreSide,
    epoch: 1,
    tokenVerifier: { consume: () => true },
    hostTurnSecret: () => Buffer.alloc(32, 7),
    schedule: () => 0,
    cancel: () => {},
  });
  const vivo = setInterval(() => {}, 5);

  const pendentes = new Map<number, (r: Resposta) => void>();
  const assinaturas = new Map<number, Frame[]>();
  let proximoId = 6000;
  rendererSide.onMessage((raw) => {
    const frame = raw as Frame;
    if (frame['t'] === 'res') {
      const resolver = pendentes.get(frame['id'] as number);
      if (resolver !== undefined) {
        pendentes.delete(frame['id'] as number);
        const erro = frame['err'] as { code?: string } | undefined;
        resolver({ ok: frame['ok'] as boolean, data: frame['data'], code: erro?.code ?? null });
      }
      return;
    }
    if (frame['t'] === 'ev') assinaturas.get(frame['subId'] as number)?.push(frame['data'] as Frame);
  });

  async function request(cmd: string, arg: unknown): Promise<Resposta> {
    const id = ++proximoId;
    return await new Promise<Resposta>((resolve) => {
      pendentes.set(id, resolve);
      rendererSide.postMessage({ t: 'req', epoch: 1, id, cmd, arg, authToken: 'ok' });
    });
  }

  async function ok(cmd: string, arg: unknown): Promise<Record<string, unknown>> {
    const r = await request(cmd, arg);
    assert.ok(r.ok, `${cmd} recusou: ${JSON.stringify(r)}`);
    return (r.data ?? {}) as Record<string, unknown>;
  }

  function assinar(topic: string): Frame[] {
    const id = ++proximoId;
    const lista: Frame[] = [];
    rendererSide.postMessage({ t: 'sub', epoch: 1, id, topic });
    rendererSide.onMessage((raw) => {
      const f = raw as Frame;
      if (f['t'] === 'subOk' && f['id'] === id) assinaturas.set(f['subId'] as number, lista);
    });
    return lista;
  }

  return {
    runtime,
    identity,
    request,
    ok,
    assinar,
    async close() {
      clearInterval(vivo);
      await runtime.close();
      await new Promise((res) => setTimeout(res, 25));
      view.close();
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    },
  };
}

/**
 * O `append` volta antes de o projector ter interpretado o lote (§10.5): a revogação
 * derivada do log é do lote PROJETADO, então esperar `core.length` alcançar
 * `interpretedSeq` é a barreira certa — não um `setImmediate` que só drena microtasks.
 */
async function projetado(c: { core: { length: number }; projector: { interpretedSeq: number } }): Promise<void> {
  for (let i = 0; i < 400 && c.projector.interpretedSeq < c.core.length - 1; i++) {
    await new Promise((res) => setTimeout(res, 5));
  }
  assert.equal(c.projector.interpretedSeq, c.core.length - 1, 'o projector não alcançou o log');
}

/** Comunidade nova + um canal de voz, que é onde a chamada acontece (§6.6, §17.4). */
async function comunidadeComVoz(r: Awaited<ReturnType<typeof rig>>) {
  const criada = (await r.ok('community.create', { name: 'Raiz', iconColor: 1 })) as {
    communityId: string;
    defaultChannelId: string;
  };
  // A categoria da gênese é a única que existe aqui; `channel.create` exige uma (§6.5).
  const categoriaId = [...r.runtime.get(criada.communityId)!.projector.ds.categories.keys()][0]!;
  const canal = (await r.ok('channel.create', {
    communityId: criada.communityId,
    categoryId: categoriaId,
    name: 'sala',
    type: CHANNEL_TYPE.voice,
  })) as { channelId: string };
  return { communityId: criada.communityId, vozId: canal.channelId, textoId: criada.defaultChannelId };
}

describe('§86.1 revogação derivada do log — o sweep que nunca era chamado (§17.4, §19.8)', { timeout: 120_000 }, () => {
  it('apagar o canal com chamada acontecendo encerra a sessão e nomeia o motivo', async () => {
    const r = await rig('voz-canal-apagado');
    try {
      const { communityId, vozId } = await comunidadeComVoz(r);
      const revogados = r.assinar('voice.revoked');
      const falhas = r.assinar('voice.failed');
      await new Promise((res) => setImmediate(res));

      const entrou = (await r.ok('voice.join', { communityId, channelId: vozId })) as { sessionId: string };
      const hospedada = r.runtime.get(communityId)!;
      assert.equal(hospedada.host!.voice.sessionCount, 1, 'a chamada não abriu');

      // §19.8 — a exclusão do canal passa pela mesma fila serializada da op.
      await r.ok('channel.delete', { communityId, channelId: vozId });
      await projetado(hospedada);

      // O defeito: `sweepAgainst` existia, tinha teste, e nenhum ponto da composição o
      // ligava ao lote projetado. A sessão sobrevivia ao `channel.delete` para sempre.
      assert.equal(hospedada.host!.voice.sessionCount, 0, 'a sessão sobreviveu ao canal apagado');
      assert.equal(revogados.at(-1)?.['targetKey'], r.identity.publicKey.toString('hex'));
      assert.equal(revogados.at(-1)?.['sessionId'], entrou.sessionId);
      // §19.8 pede as DUAS metades; só a revogação existia.
      assert.equal(falhas.at(-1)?.['reason'], 'channel-deleted', '`voice.failed` não saiu nomeado');
    } finally {
      await r.close();
    }
  });

  it('o fim da comunidade derruba a chamada que ainda estava aberta', async () => {
    const r = await rig('voz-comunidade-encerrada');
    try {
      const { communityId, vozId } = await comunidadeComVoz(r);
      const falhas = r.assinar('voice.failed');
      await new Promise((res) => setImmediate(res));

      await r.ok('voice.join', { communityId, channelId: vozId });
      const hospedada = r.runtime.get(communityId)!;
      assert.equal(hospedada.host!.voice.sessionCount, 1);

      await r.ok('community.end', { communityId, confirmName: 'Raiz' });
      await projetado(hospedada);

      assert.equal(hospedada.host!.voice.sessionCount, 0, 'a chamada sobreviveu ao fim da comunidade');
      assert.equal(falhas.at(-1)?.['reason'], 'community-ended');
    } finally {
      await r.close();
    }
  });
});

describe('§86.2 vivacidade — queda de conexão é saída (§17.4 emendado, §22.1)', { timeout: 120_000 }, () => {
  it('o loop `voice.liveness` tem corpo e não derruba o próprio host da chamada', async () => {
    const r = await rig('voz-vivacidade');
    try {
      const { communityId, vozId } = await comunidadeComVoz(r);
      await r.ok('voice.join', { communityId, channelId: vozId });
      const hospedada = r.runtime.get(communityId)!;
      assert.equal(hospedada.host!.voice.sessionCount, 1);

      // O host participa como qualquer membro e **não** tem conexão de si para si: sem a
      // linha que o isenta, o primeiro giro do loop o expulsaria da própria chamada.
      await r.runtime.loops!.runNow('voice.liveness');
      await r.runtime.loops!.runNow('voice.liveness');
      assert.equal(hospedada.host!.voice.sessionCount, 1, 'o loop expulsou o host da própria chamada');
      assert.equal(hospedada.host!.voice.sessionOf(vozId)!.participants.length, 1);
    } finally {
      await r.close();
    }
  });

  it('a cadência e o prazo saem da evidência que os alimenta, não de um número solto', () => {
    // §22.1 — a varredura roda na cadência do `hello`, que é o sinal que a alimenta…
    assert.equal(LOOP_INTERVALS['voice.liveness'], DEFAULT_HELLO_MS);
    // …e o prazo são três voltas dele: tolera um `hello` perdido sem derrubar ninguém de
    // uma chamada em que ainda está.
    assert.equal(VOICE_LIVENESS_MS, 3 * DEFAULT_HELLO_MS);
  });
});
