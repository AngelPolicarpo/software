import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createCore, type WritableCoreHandle } from '../src/l0/corestore/index.ts';
import { ManifestDb, type OutboxRow } from '../src/l0/manifest/index.ts';
import { openViewDb } from '../src/l0/view/index.ts';
import { HostAdmission } from '../src/l2/communityHost/index.ts';
import { Outbox, type OutboxObservation, type SubmitResult } from '../src/l2/outbox/index.ts';
import { Projector } from '../src/l1/projector/index.ts';
import { opId } from '../src/l1/idgen/index.ts';
import {
  decodeHostRecord,
  encodeHostRecord,
  hostRecordSigningHash,
} from '../src/l1/opCodec/index.ts';
import { genesis, joinMember, keypairFromSeed, makeRecord, sign, T0 } from './helpers/world.ts';

const COMMUNITY = 'community-test';

function tempPath(): { dir: string; db: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-'));
  return { dir, db: path.join(dir, 'manifest.db') };
}

function openTemp(): { manifest: ManifestDb; dir: string } {
  const { dir, db } = tempPath();
  return { manifest: new ManifestDb(db), dir };
}

function add(manifest: ManifestDb, id: string, channelId: string | null, authorSeq: number, now = 0): OutboxRow {
  const sequenceScope = channelId === null ? 'community' : `channel:${channelId}`;
  const result = manifest.enqueue({
    opId: id,
    communityId: COMMUNITY,
    channelId,
    sequenceScope,
    kind: 1,
    authorSeq,
    envelope: Buffer.from(id),
    clientRef: `ref-${id}`,
    now,
  });
  assert.equal(result.enqueued, true);
  return manifest.byOpId(id) as OutboxRow;
}

function observation(overrides: Partial<OutboxObservation> = {}): OutboxObservation {
  return {
    observedOp: () => null,
    watermark: () => 0,
    interpretedSeq: () => -1,
    ...overrides,
  };
}

function makeOutbox(
  manifest: ManifestDb,
  submit: (envelopes: readonly Buffer[]) => Promise<readonly SubmitResult[] | null>,
  observe = observation(),
  now = 0,
): Outbox {
  return new Outbox({ manifest, communityId: COMMUNITY, submit, observation: observe, now: () => now, random: () => 0.5 });
}

describe('manifest — estado local durável e escopado', () => {
  it('mantém contadores independentes por sequenceScope e sobrevive à reabertura', () => {
    const { manifest, dir } = openTemp();
    const db = path.join(dir, 'manifest.db');
    try {
      assert.equal(manifest.nextAuthorSeq(COMMUNITY, 'channel:ch-a'), 1);
      assert.equal(manifest.nextAuthorSeq(COMMUNITY, 'channel:ch-a'), 2);
      assert.equal(manifest.nextAuthorSeq(COMMUNITY, 'channel:ch-b'), 1);
      assert.equal(manifest.nextAuthorSeq(COMMUNITY, 'community'), 1);
      add(manifest, 'op-a', 'ch-a', 2);
      manifest.close();

      const reopened = new ManifestDb(db);
      try {
        assert.equal(reopened.nextAuthorSeq(COMMUNITY, 'channel:ch-a'), 3);
        assert.equal(reopened.all(COMMUNITY).length, 1);
      } finally {
        reopened.close();
      }
    } finally {
      if (fs.existsSync(db)) {
        try {
          manifest.close();
        } catch {
          // já fechado no caminho de reabertura
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a cabeça bloqueada para somente o canal correspondente', () => {
    const { manifest, dir } = openTemp();
    try {
      const a1 = add(manifest, 'a1', 'ch-a', 1);
      add(manifest, 'a2', 'ch-a', 2);
      add(manifest, 'b1', 'ch-b', 1);
      manifest.setState(a1.local_seq, 'sending');
      const groups = manifest.ready(COMMUNITY, 0, 32);
      assert.deepEqual([...groups.keys()], ['ch-b']);
      assert.deepEqual(groups.get('ch-b')?.map((row) => row.op_id), ['b1']);
    } finally {
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('outbox — reconciliação e recuperação', () => {
  it('nunca remove por watermark alto sem observar o opId', () => {
    const { manifest, dir } = openTemp();
    try {
      const row = add(manifest, 'missing', 'ch-a', 2);
      const outbox = makeOutbox(
        manifest,
        async () => null,
        observation({ watermark: () => 7, interpretedSeq: () => 7 }),
      );
      const result = outbox.reconcile();
      const current = manifest.byOpId(row.op_id);
      assert.equal(result.removed, 0);
      assert.equal(current?.state, 'failed');
      assert.equal(current?.last_error, 'E_AUTHOR_SEQ_OVERTAKEN');
    } finally {
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('remove somente quando a réplica observa o opId e preserva o seq observado', () => {
    const { manifest, dir } = openTemp();
    try {
      add(manifest, 'observed', 'ch-a', 4);
      const outbox = makeOutbox(manifest, async () => null, observation({ observedOp: () => ({ seq: 91 }) }));
      assert.deepEqual(outbox.reconcile(), { removed: 1, mismatch: 0, expired: 0 });
      assert.equal(manifest.byOpId('observed'), undefined);
    } finally {
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('transforma ACK sem observação em mismatch e volta a queued', () => {
    const { manifest, dir } = openTemp();
    try {
      const row = add(manifest, 'acked', 'ch-a', 1);
      manifest.setState(row.local_seq, 'awaiting-confirmation', { acked_seq: 8 });
      const outbox = makeOutbox(manifest, async () => null, observation({ interpretedSeq: () => 8 }));
      assert.deepEqual(outbox.reconcile(), { removed: 0, mismatch: 1, expired: 0 });
      assert.equal(manifest.byOpId('acked')?.state, 'queued');
      assert.equal(manifest.byOpId('acked')?.acked_seq, null);
    } finally {
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recupera sending no boot sem consumir tentativa nem trocar o envelope', () => {
    const { manifest, dir } = openTemp();
    try {
      const row = add(manifest, 'stranded', 'ch-a', 1);
      manifest.setState(row.local_seq, 'sending', { attempts: 4, next_attempt_at: 99 });
      const outbox = makeOutbox(manifest, async () => null, observation(), 100);
      assert.equal(outbox.recoverOnBoot(), 1);
      const current = manifest.byOpId('stranded') as OutboxRow;
      assert.equal(current.state, 'queued');
      assert.equal(current.attempts, 4);
      assert.equal(current.next_attempt_at, 100);
      assert.deepEqual(current.envelope, row.envelope);
    } finally {
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('envia canais independentes em lotes distintos e retém ambos em awaiting-confirmation', async () => {
    const { manifest, dir } = openTemp();
    try {
      add(manifest, 'a1', 'ch-a', 1);
      add(manifest, 'a2', 'ch-a', 2);
      add(manifest, 'b1', 'ch-b', 1);
      const calls: Buffer[][] = [];
      const outbox = makeOutbox(manifest, async (envelopes) => {
        calls.push(envelopes.map((envelope) => Buffer.from(envelope)));
        return envelopes.map((_, i) => ({ ok: true as const, seq: i + 10 }));
      });
      assert.equal(await outbox.flush(), 3);
      assert.deepEqual(calls.map((batch) => batch.length).sort(), [1, 2]);
      assert.deepEqual(manifest.all(COMMUNITY).map((row) => row.state), ['awaiting-confirmation', 'awaiting-confirmation', 'awaiting-confirmation']);
    } finally {
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('retry de falha transitória reutiliza exatamente o envelope persistido', async () => {
    const { manifest, dir } = openTemp();
    try {
      const original = add(manifest, 'retry', 'ch-a', 1).envelope;
      let now = 0;
      let calls = 0;
      const sent: Buffer[] = [];
      const outbox = new Outbox({
        manifest,
        communityId: COMMUNITY,
        observation: observation(),
        now: () => now,
        random: () => 0.5,
        submit: async (envelopes) => {
          calls++;
          sent.push(Buffer.from(envelopes[0] as Buffer));
          return calls === 1 ? null : [{ ok: true as const, seq: 3 }];
        },
      });
      await outbox.flush();
      assert.equal(manifest.byOpId('retry')?.state, 'queued');
      now = 2_000;
      await outbox.flush();
      assert.equal(manifest.byOpId('retry')?.state, 'awaiting-confirmation');
      assert.deepEqual(sent, [original, original]);
    } finally {
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('communityHost — grupo fora da seção crítica', () => {
  function envelopeFor(
    core: ReturnType<typeof keypairFromSeed>,
    author: ReturnType<typeof keypairFromSeed>,
    seq: number,
    channelId: string,
  ): Buffer {
    const record = makeRecord(core, {
      kind: 'message.send',
      author,
      authorSeq: seq,
      hostTs: T0 + seq,
      payload: { channelId, content: `mensagem-${seq}`, mentions: [] },
    });
    return decodeHostRecord(record)!.envelope;
  }

  it('agrupa submissões concorrentes e só publica o estado depois do append', async () => {
    const g = genesis();
    const records: Uint8Array[][] = [];
    let release!: () => void;
    const appendGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let length = g.world.seq;
    const core = {
      get length() {
        return length;
      },
      append: async (blocks: readonly Uint8Array[]) => {
        records.push(blocks.map((block) => Buffer.from(block)));
        await appendGate;
        length += blocks.length;
      },
    };
    const host = new HostAdmission({
      core,
      state: g.world.state,
      now: () => T0 + 10,
      groupWindowMs: 0,
      groupMax: 4,
      makeHostRecord: (envelope, hostTs) => {
        const flags = 0;
        const hostSig = sign(hostRecordSigningHash(envelope, hostTs, flags), g.world.core.secretKey);
        return encodeHostRecord({ envelope: Buffer.from(envelope), hostTs, flags, hostSig });
      },
    });
    const submissions = [1, 2, 3, 4].map((seq) => host.submit(envelopeFor(g.world.core, g.founder, seq, g.channelId)));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(records.length, 1);
    assert.equal(records[0]?.length, 4);
    assert.equal(host.state.interpretedSeq, g.world.state.interpretedSeq);
    release();
    const results = await Promise.all(submissions);
    assert.ok(results.every((result) => result.ok));
    assert.equal(host.state.interpretedSeq, g.world.state.interpretedSeq + 4);
  });

  it('falha de append não deixa watermark ou seq fantasma e permite o próximo grupo', async () => {
    const g = genesis();
    let attempts = 0;
    let length = g.world.seq;
    const core = {
      get length() {
        return length;
      },
      append: async (blocks: readonly Uint8Array[]) => {
        attempts++;
        if (attempts === 1) throw new Error('disk full');
        length += blocks.length;
      },
    };
    const host = new HostAdmission({
      core,
      state: g.world.state,
      now: () => T0 + 10,
      groupWindowMs: 0,
      groupMax: 2,
      makeHostRecord: (envelope, hostTs) => {
        const flags = 0;
        const hostSig = sign(hostRecordSigningHash(envelope, hostTs, flags), g.world.core.secretKey);
        return encodeHostRecord({ envelope: Buffer.from(envelope), hostTs, flags, hostSig });
      },
    });
    const before = host.state.interpretedSeq;
    const firstPromise = Promise.all([
      host.submit(envelopeFor(g.world.core, g.founder, 1, g.channelId)),
      host.submit(envelopeFor(g.world.core, g.founder, 2, g.channelId)),
    ]);
    await host.drain();
    const first = await firstPromise;
    assert.deepEqual(first.map((result) => result.ok), [false, false]);
    assert.equal(host.state.interpretedSeq, before);
    const nextPromise = host.submit(envelopeFor(g.world.core, g.founder, 3, g.channelId));
    await host.drain();
    const next = await nextPromise;
    assert.equal(next.ok, true);
    assert.equal(host.state.interpretedSeq, before + 1);
  });
});

describe('corestore — porta de append em lote', () => {
  it('faz um append real de vários registros e preserva a ordem', async () => {
    const { dir } = tempPath();
    let core: WritableCoreHandle | null = null;
    try {
      const keyPair = keypairFromSeed('real-core');
      core = await createCore(path.join(dir, 'core'), keyPair);
      await core.append([Buffer.from('a'), Buffer.from('b'), Buffer.from('c')]);
      assert.equal(core.length, 3);
      assert.deepEqual(await core.get(0), Buffer.from('a'));
      assert.deepEqual(await core.get(2), Buffer.from('c'));
    } finally {
      await core?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('outbox + host + projector — caminho de escrita completo', () => {
  it('só remove os quatro itens depois de observá-los na réplica local', async () => {
    const { dir } = tempPath();
    const g = genesis();
    const ana = joinMember(g, 'ana-integracao');
    const secondChannelSeq = g.world.next(g.founder);
    const secondChannel = g.world.id('channel', g.founder, secondChannelSeq);
    g.world.submit({
      kind: 'channel.create',
      author: g.founder,
      authorSeq: secondChannelSeq,
      hostTs: T0 + 150,
      payload: { categoryId: g.categoryId, type: 0, name: 'segundo', readOnlyForRoleIds: [] },
    });
    const blocks = [...g.world.log].map((block) => Buffer.from(block));
    const listeners = new Set<() => void>();
    const core = {
      key: g.world.core.publicKey,
      get length() {
        return blocks.length;
      },
      get: async (seq: number) => blocks[seq] ?? null,
      onAppend: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      append: async (newBlocks: readonly Uint8Array[]) => {
        blocks.push(...newBlocks.map((block) => Buffer.from(block)));
        for (const listener of listeners) listener();
      },
      close: async () => {},
    };
    const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
    const view = openViewDb(path.join(dir, 'view.db'));
    try {
      const projector = new Projector(view, core, { foldBuildId: 'outbox-integration' });
      await projector.boot();
      const host = new HostAdmission({
        core,
        state: projector.ds,
        groupMax: 4,
        makeHostRecord: (envelope, hostTs) => {
          const hostSig = sign(hostRecordSigningHash(envelope, hostTs, 0), g.world.core.secretKey);
          return encodeHostRecord({ envelope: Buffer.from(envelope), hostTs, flags: 0, hostSig });
        },
        now: () => T0 + 200,
      });
      const observation: OutboxObservation = {
        observedOp: (id) => projector.observedOp(id),
        watermark: (item) => projector.authorWatermark(ana.publicKey, item.sequence_scope),
        interpretedSeq: () => projector.interpretedSeq,
      };
      const outbox = new Outbox({
        manifest,
        communityId: g.world.core.publicKey.toString('hex'),
        observation,
        submit: async (envelopes) => Promise.all(envelopes.map((envelope) => host.submit(envelope))),
        now: () => T0 + 200,
        random: () => 0.5,
        batchMax: 4,
      });
      const ids: string[] = [];
      const channels = [g.channelId, secondChannel];
      for (let i = 0; i < 4; i++) {
        const channelId = channels[i % channels.length] as string;
        const scope = `channel:${channelId}`;
        const authorSeq = outbox.nextAuthorSeq(scope);
        const record = makeRecord(g.world.core, {
          kind: 'message.send',
          author: ana,
          authorSeq,
          sequenceScope: { kind: 'channel', channelId },
          hostTs: T0 + 201 + i,
          payload: { channelId, content: `integracao-${i}`, mentions: [] },
        });
        const envelope = decodeHostRecord(record)!.envelope;
        const id = opId(envelope);
        ids.push(id);
        const result = outbox.enqueue(envelope, {
          opId: id,
          channelId,
          sequenceScope: scope,
          kind: 1,
          authorSeq,
          clientRef: `client-${i}`,
        });
        assert.equal(result.enqueued, true);
      }
      await outbox.flush();
      assert.equal(manifest.all(g.world.core.publicKey.toString('hex')).filter((row) => row.state === 'awaiting-confirmation').length, 4);
      await projector.catchUp();
      assert.deepEqual(outbox.reconcile(), { removed: 4, mismatch: 0, expired: 0 });
      assert.ok(ids.every((id) => projector.observedOp(id) !== null));
      assert.equal(manifest.all(g.world.core.publicKey.toString('hex')).length, 0);
    } finally {
      view.close();
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
