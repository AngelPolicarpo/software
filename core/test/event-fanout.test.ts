/**
 * Evento do **lote projetado** (§15.5) e fan-out até o renderer (§15.1), com a ordem de
 * `DS-31` (`messages.appended` antes de `message.accepted`, §11.6 regra 2) exercitada com
 * projector real, `view.db` real, `manifest.db` real e a outbox real — nada de mock nas
 * peças que produzem a ordem.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { decodeHostRecord } from '../src/l1/opCodec/index.ts';
import { opId as opIdOf } from '../src/l1/idgen/index.ts';
import { coalesceBatch, type ProjectedEvent } from '../src/l1/projector/index.ts';
import { Outbox } from '../src/l2/outbox/index.ts';
import { EventFanout } from '../src/l3/ipcRenderer/fanout.ts';
import { IpcServer, type IpcPort } from '../src/l3/ipcRenderer/index.ts';
import { envelopeTargetResolver } from './helpers/composition.ts';
import { BUILD_A, makeProjector, setup } from './helpers/projector.ts';
import { genesis, joinMember, T0, type Genesis } from './helpers/world.ts';

type Cenario = {
  readonly g: Genesis;
  readonly log: readonly Uint8Array[];
  /** `seq` do primeiro e do último `message.send` de cada canal. */
  readonly geral: { from: number; to: number };
  readonly avisos: { from: number; to: number; channelId: string };
};

/** Um log com dois canais e mensagens em lote — o caso que agrega. */
function cenario(): Cenario {
  const g = genesis();
  const ana = joinMember(g, 'ana');

  const geralFrom = g.world.log.length;
  for (let i = 0; i < 12; i++) {
    g.world.submit({
      kind: 'message.send',
      author: ana,
      hostTs: T0 + 200 + i,
      // A menção entra numa mensagem só: `hasMention` do lote é a disjunção das 12.
      payload: { channelId: g.channelId, content: `olá ${i}`, mentions: i === 7 ? ['everyone'] : [] },
    });
  }
  const geralTo = g.world.log.length - 1;

  g.world.submit({
    kind: 'channel.create',
    author: g.founder,
    hostTs: T0 + 300,
    payload: { categoryId: g.categoryId, type: 0, name: 'avisos', readOnlyForRoleIds: [] },
  });
  const avisos = g.world.id(
    'channel',
    g.founder,
    g.world.authorSeq.get(g.founder.publicKey.toString('hex')) as number,
  );

  const avisosFrom = g.world.log.length;
  for (let i = 0; i < 3; i++) {
    g.world.submit({
      kind: 'message.send',
      author: ana,
      hostTs: T0 + 400 + i,
      payload: { channelId: avisos, content: `aviso ${i}`, mentions: [] },
    });
  }

  return {
    g,
    log: [...g.world.log],
    geral: { from: geralFrom, to: geralTo },
    avisos: { from: avisosFrom, to: g.world.log.length - 1, channelId: avisos },
  };
}

function appended(events: readonly ProjectedEvent[]): ProjectedEvent[] {
  return events.filter((e) => e.topic === 'messages.appended');
}

describe('projector — evento do lote projetado (§15.5)', () => {
  it('agrega `messages.appended` por canal: um evento, com a faixa e a menção do lote', async () => {
    const c = cenario();
    const h = await setup(c.log);
    try {
      const lotes: ProjectedEvent[][] = [];
      const p = makeProjector(h, { foldBuildId: BUILD_A, onEvent: (evs) => lotes.push([...evs]) });
      await p.boot();

      // O log inteiro cabe em um lote (`PROJECTOR_BATCH` = 256): uma emissão só.
      assert.equal(lotes.length, 1);
      const eventos = appended(lotes[0] as ProjectedEvent[]);
      assert.equal(eventos.length, 2, 'um evento por canal, não um por registro');

      assert.deepEqual(eventos[0]?.data, {
        communityId: h.communityId,
        channelId: c.g.channelId,
        fromSeq: c.geral.from,
        toSeq: c.geral.to,
        hasMention: true,
      });
      assert.deepEqual(eventos[1]?.data, {
        communityId: h.communityId,
        channelId: c.avisos.channelId,
        fromSeq: c.avisos.from,
        toSeq: c.avisos.to,
        hasMention: false,
      });
    } finally {
      await h.close();
    }
  });

  it('a agregação preserva a ordem de estreia e não mistura alvos', () => {
    const saida = coalesceBatch([
      { topic: 'members.changed', data: { communityId: 'c', identityKeys: ['a'] } },
      { topic: 'messages.appended', data: { communityId: 'c', channelId: 'ch1', fromSeq: 4, toSeq: 4, hasMention: false } },
      { topic: 'message.updated', data: { communityId: 'c', messageId: 'm1', fields: ['content'] } },
      { topic: 'messages.appended', data: { communityId: 'c', channelId: 'ch2', fromSeq: 6, toSeq: 6, hasMention: true } },
      { topic: 'messages.appended', data: { communityId: 'c', channelId: 'ch1', fromSeq: 9, toSeq: 9, hasMention: true } },
      { topic: 'members.changed', data: { communityId: 'c', identityKeys: ['b', 'a'] } },
      { topic: 'message.updated', data: { communityId: 'c', messageId: 'm1', fields: ['pinnedAt'] } },
    ]);

    assert.deepEqual(
      saida.map((e) => e.topic),
      ['members.changed', 'messages.appended', 'message.updated', 'messages.appended'],
    );
    assert.deepEqual(saida[0]?.data, { communityId: 'c', identityKeys: ['a', 'b'] });
    // `fromSeq` mínimo, `toSeq` máximo, `hasMention` por disjunção.
    assert.deepEqual(saida[1]?.data, { communityId: 'c', channelId: 'ch1', fromSeq: 4, toSeq: 9, hasMention: true });
    assert.deepEqual(saida[2]?.data, { communityId: 'c', messageId: 'm1', fields: ['content', 'pinnedAt'] });
    assert.deepEqual(saida[3]?.data, { communityId: 'c', channelId: 'ch2', fromSeq: 6, toSeq: 6, hasMention: true });
  });
});

// ─── Fan-out (§15.1, §15.5) ───────────────────────────────────────────────────────────

type Wire = { topic: string; data: Record<string, unknown>; subId: number };

function serverDeTeste(): { server: IpcServer; wire: Wire[]; sub(topic: string, filter?: unknown): number } {
  const enviados: Array<Record<string, unknown>> = [];
  const port: IpcPort = {
    postMessage: (frame) => enviados.push(frame as unknown as Record<string, unknown>),
    onMessage: (listener) => {
      recebe = listener;
    },
  };
  let recebe: (frame: never) => void = () => {};
  const server = new IpcServer({
    epoch: 1,
    port,
    tokenVerifier: { consume: () => true },
    identityStatus: { isLoaded: true },
  });
  let id = 0;
  return {
    server,
    wire: enviados as unknown as Wire[],
    sub(topic, filter) {
      id += 1;
      recebe({ t: 'sub', epoch: 1, id, topic, ...(filter === undefined ? {} : { filter }) } as never);
      const ok = enviados.filter((f) => f['t'] === 'subOk').at(-1) as { subId: number };
      return ok.subId;
    },
  };
}

function eventosDe(wire: readonly Wire[], subId: number): Array<{ topic: string; data: unknown }> {
  return wire
    .filter((f) => (f as unknown as { t: string }).t === 'ev' && f.subId === subId)
    .map((f) => ({ topic: f.topic, data: f.data }));
}

describe('fan-out IPC-R — rota, filtro e payload (§15.1, §15.5)', () => {
  it('o filtro casa pela rota; `message.accepted` mantém o payload da tabela', () => {
    const t = serverDeTeste();
    const fanout = new EventFanout(t.server);
    const daComunidade = t.sub('message.accepted', { communityId: 'com-a' });
    const deOutra = t.sub('message.accepted', { communityId: 'com-b' });
    const semFiltro = t.sub('message.accepted');

    const desfecho = {
      topic: 'message.accepted',
      data: { opId: 'op1', clientRef: 'ref1', messageId: 'msg1', seq: 12, channelId: 'ch1' },
    };
    fanout.fromOutbox('com-a')(desfecho);

    assert.deepEqual(eventosDe(t.wire, daComunidade), [desfecho]);
    assert.deepEqual(eventosDe(t.wire, deOutra), []);
    assert.deepEqual(eventosDe(t.wire, semFiltro), [desfecho]);
    // A comunidade viaja como rota; inventá-la no payload seria superfície fora de §15.5.
    assert.equal('communityId' in (eventosDe(t.wire, daComunidade)[0]?.data as object), false);
  });

  it('o lote do projector roteia por comunidade e por canal', () => {
    const t = serverDeTeste();
    const fanout = new EventFanout(t.server);
    const doCanal = t.sub('messages.appended', { communityId: 'com-a', channelId: 'ch1' });
    const daComunidade = t.sub('messages.appended', { communityId: 'com-a' });

    fanout.fromProjector([
      { topic: 'messages.appended', data: { communityId: 'com-a', channelId: 'ch1', fromSeq: 1, toSeq: 3, hasMention: false } },
      { topic: 'messages.appended', data: { communityId: 'com-a', channelId: 'ch2', fromSeq: 4, toSeq: 4, hasMention: true } },
      { topic: 'messages.appended', data: { communityId: 'com-b', channelId: 'ch1', fromSeq: 7, toSeq: 7, hasMention: false } },
    ]);

    assert.deepEqual(eventosDe(t.wire, doCanal).map((e) => (e.data as { fromSeq: number }).fromSeq), [1]);
    assert.deepEqual(eventosDe(t.wire, daComunidade).map((e) => (e.data as { fromSeq: number }).fromSeq), [1, 4]);
  });

  it('filtro que o evento não sabe responder não casa', () => {
    const t = serverDeTeste();
    const fanout = new EventFanout(t.server);
    const recortado = t.sub('swarm.changed', { communityId: 'com-a' });
    fanout.emit({ topic: 'swarm.changed', data: { peerCount: 3, degraded: false } });
    assert.deepEqual(eventosDe(t.wire, recortado), []);
  });
});

// ─── DS-31 ponta a ponta ──────────────────────────────────────────────────────────────

describe('DS-31 — `messages.appended` antes de `message.accepted` (§11.6 regra 2)', () => {
  it('a reconciliação só enxerga a op depois do lote que a projetou', async () => {
    const c = cenario();
    const h = await setup(c.log);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanout-'));
    const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
    try {
      // A op que a fila espera: a primeira mensagem do canal `geral`, já no log.
      const registro = decodeHostRecord(Buffer.from(c.log[c.geral.from] as Uint8Array));
      assert.notEqual(registro, null);
      const envelope = Buffer.from((registro as { envelope: Uint8Array }).envelope);
      const idDaOp = opIdOf(envelope);

      const t = serverDeTeste();
      const fanout = new EventFanout(t.server);
      const assinatura = t.sub('messages.appended', { communityId: h.communityId });
      const desfechos = t.sub('message.accepted', { communityId: h.communityId });

      const p = makeProjector(h, { foldBuildId: BUILD_A, onEvent: fanout.fromProjector });
      const resolver = envelopeTargetResolver();
      const outbox = new Outbox({
        manifest,
        communityId: h.communityId,
        // A fila nunca chega a submeter neste teste: o que se mede é a reconciliação.
        submit: async () => null,
        observation: {
          observedOp: (id) => p.observedOp(id),
          watermark: (item) => p.authorWatermark(Buffer.from(item.community_id, 'hex'), item.sequence_scope),
          interpretedSeq: () => p.interpretedSeq,
          resolveTarget: (item) => resolver(item as { envelope: Buffer }),
        },
        onOutcome: fanout.fromOutbox(h.communityId),
        now: () => T0,
      });
      const enfileirado = outbox.enqueue(envelope, {
        opId: idDaOp,
        channelId: c.g.channelId,
        sequenceScope: `channel:${c.g.channelId}`,
        kind: 1,
        authorSeq: 1,
        clientRef: 'ref-1',
      });
      assert.equal(enfileirado.enqueued, true);

      // Antes de projetar: a réplica não tem a op, e nada é aceito (§11.6, ramo indeterminado).
      assert.equal(outbox.reconcile(T0).removed, 0);
      assert.deepEqual(eventosDe(t.wire, desfechos), []);

      await p.boot();
      // Depois do commit do lote, o evento do lote já está no fio.
      assert.equal(eventosDe(t.wire, assinatura).length, 2, 'um evento por canal do lote');
      assert.deepEqual(eventosDe(t.wire, desfechos), []);

      assert.equal(outbox.reconcile(T0).removed, 1);
      const aceitos = eventosDe(t.wire, desfechos);
      assert.equal(aceitos.length, 1);
      assert.deepEqual(aceitos[0]?.data, {
        opId: idDaOp,
        clientRef: 'ref-1',
        messageId: (aceitos[0]?.data as { messageId: string }).messageId,
        // §11.6 regra 2: o `seq` exibido é o observado na réplica.
        seq: c.geral.from,
        channelId: c.g.channelId,
      });

      // A ordem no fio, que é o que `DS-31` cobra.
      const ordem = t.wire
        .filter((f) => (f as unknown as { t: string }).t === 'ev')
        .map((f) => f.topic)
        .filter((topic) => topic === 'messages.appended' || topic === 'message.accepted');
      assert.deepEqual(ordem, ['messages.appended', 'messages.appended', 'message.accepted']);
    } finally {
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true });
      await h.close();
    }
  });
});
