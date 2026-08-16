/**
 * CENARIO 4 do gate G1 — DETERMINISMO DO `fold` (§28.4).
 *
 * "Tres testes, todos em CI, contra um core de referencia com >= 5 000 registros
 *  cobrindo os 38 `kind`s E >= 200 registros deliberadamente invalidos:
 *   1. Reprojecao identica: apagar `view.db` e reprojetar do `seq` 0 produz o mesmo hash
 *      de dump ordenado.
 *   2. Convergencia entre replicas: N replicas independentes produzem o mesmo hash.
 *   3. Snapshot equivalente: interpretar com snapshot a cada K registros produz o mesmo
 *      `DecisionState` que interpretar sem snapshot.
 *
 *  E o teste que protege a decisao-raiz A02. Se ele quebrar, a arquitetura deixou de ser
 *  verdade e precisa ser reavaliada, nao remendada." (§28.4)
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildCorpus } from '../src/harness/corpus.ts';
import { foldRecord, newMetrics } from '../src/fold/index.ts';
import { emptyState } from '../src/fold/state.ts';
import { deserializeDs, serializeDs } from '../src/node/snapshot.ts';
import { dumpHash, dumpText, openViewDb } from '../src/node/viewdb.ts';
import { Projector } from '../src/node/projector.ts';
import { blake2b256 } from '../src/crypto/index.ts';

export type DeterminismReport = {
  corpusRecords: number;
  invalidRecords: number;
  decisions: { APPLIED: number; REJECTED: number; IGNORED: number };
  kindsExercised: number;
  /** teste 1 */
  reprojection: { hashBefore: string; hashAfter: string; ok: boolean };
  /** teste 2 — replicas independentes, PROJECTOR_BATCH diferente em cada uma */
  replicas: Array<{ name: string; batch: number; hash: string; interpretedSeq: number }>;
  convergence: boolean;
  /** teste 3 */
  snapshot: Array<{ interval: number; dsHash: string; ok: boolean }>;
  dsHashNoSnapshot: string;
  snapshotEquivalence: boolean;
  panics: number;
  ok: boolean;
  ms: number;
  diffSample?: string;
};

/** Hash canonico do `DecisionState` (sem `messages`, que o snapshot nao carrega). */
function dsHash(blob: Buffer): string {
  return blake2b256('dsdump/1', blob).toString('hex');
}

export async function runDeterminism(opts: {
  root: string;
  outDir: string;
  records: number;
  invalid: number;
  batches: number[];
  snapshotIntervals: number[];
}): Promise<DeterminismReport> {
  const t0 = Date.now();
  const dir = join(opts.outDir, 'determinism');
  mkdirSync(dir, { recursive: true });

  const corpus = await buildCorpus(join(dir, 'corpus'), opts.root, opts.records, opts.invalid);
  const { records, communityKey, world } = corpus;
  const communityId = communityKey.toString('hex');

  const rep: DeterminismReport = {
    corpusRecords: records.length,
    invalidRecords: opts.invalid,
    decisions: { APPLIED: 0, REJECTED: 0, IGNORED: 0 },
    kindsExercised: 0,
    reprojection: { hashBefore: '', hashAfter: '', ok: false },
    replicas: [],
    convergence: false,
    snapshot: [],
    dsHashNoSnapshot: '',
    snapshotEquivalence: false,
    panics: 0,
    ok: false,
    ms: 0,
  };

  // --- Teste 1: reprojecao identica ---------------------------------------------------
  rep.reprojection.hashBefore = world.host.hash();
  rep.reprojection.hashAfter = await world.host.reprojectAll();
  rep.reprojection.ok = rep.reprojection.hashBefore === rep.reprojection.hashAfter;
  if (!rep.reprojection.ok) rep.diffSample = 'reprojecao divergiu — ver dumps brutos';

  // --- Teste 2: N replicas independentes, com PROJECTOR_BATCH diferente ---------------
  // POC-01 pede `PROJECTOR_BATCH` em 32, 256 e 2048: se o tamanho do lote mudasse a
  // interpretacao, a projecao teria virado parte da decisao — que e o erro de v1.
  const texts: string[] = [];
  for (const batch of opts.batches) {
    const db = openViewDb(join(dir, `replica-b${batch}.db`));
    const proj = new Projector(db, communityId, { batch, rejectedLogMax: 2000 });
    let ds = emptyState(communityKey, communityId);
    ds = await proj.run(ds, async (seq) => records[seq] ?? null, records.length);
    rep.panics += proj.metrics.panic;
    rep.replicas.push({
      name: `batch-${batch}`,
      batch,
      hash: dumpHash(db, communityId).hash,
      interpretedSeq: ds.interpretedSeq,
    });
    texts.push(dumpText(db, communityId));
    if (batch === opts.batches[0]) {
      rep.decisions.APPLIED = proj.metrics.applied;
      rep.decisions.REJECTED = proj.metrics.rejected;
      rep.decisions.IGNORED = proj.metrics.ignored;
      rep.dsHashNoSnapshot = dsHash(serializeDs(ds));
    }
    db.close();
  }
  const allHashes = new Set([rep.reprojection.hashAfter, ...rep.replicas.map((r) => r.hash)]);
  rep.convergence = allHashes.size === 1;
  if (!rep.convergence && texts.length > 1) rep.diffSample = firstDiff(texts[0], texts[1]);

  // --- Teste 3: snapshot equivalente ---------------------------------------------------
  // Interpretar com snapshot a cada K registros precisa produzir o MESMO `DecisionState`
  // que interpretar sem snapshot. `messages`/`threadsByRoot` ficam fora do snapshot por
  // §10.6, entao a comparacao e sobre o `DS` serializado — que e o que o snapshot guarda.
  for (const interval of opts.snapshotIntervals) {
    const m = newMetrics();
    let ds = emptyState(communityKey, communityId);
    for (let seq = 0; seq < records.length; seq++) {
      ds = foldRecord(ds, records[seq], seq, m).next;
      if (interval > 0 && seq > 0 && seq % interval === 0) {
        // serializa e recarrega — o ciclo real de §10.6
        const reloaded = deserializeDs(serializeDs(ds));
        reloaded.messages = ds.messages; // §8.1: rematerializado de view.db, nao do snapshot
        reloaded.threadsByRoot = ds.threadsByRoot;
        ds = reloaded;
      }
    }
    rep.panics += m.panic;
    const h = dsHash(serializeDs(ds));
    rep.snapshot.push({ interval, dsHash: h, ok: h === rep.dsHashNoSnapshot });
  }
  rep.snapshotEquivalence = rep.snapshot.every((s) => s.ok);

  // Cobertura de `kind`s no corpus.
  const kinds = new Set<number>();
  for (const r of records) {
    // o `kind` esta em: bytes(env) -> bytes(op) -> v(1) cid(32) kind(2)
    const k = peekKind(r);
    if (k !== null) kinds.add(k);
  }
  rep.kindsExercised = kinds.size;

  rep.ok =
    rep.reprojection.ok && rep.convergence && rep.snapshotEquivalence && rep.panics === 0;
  rep.ms = Date.now() - t0;

  await world.close();
  rmSync(dir, { recursive: true, force: true });
  return rep;
}

function peekKind(rec: Buffer): number | null {
  const span = (b: Buffer): { s: number; l: number } | null => {
    if (b.length < 1) return null;
    const t = b[0];
    if (t < 0xfd) return b.length >= 1 + t ? { s: 1, l: t } : null;
    if (t === 0xfd) return b.length >= 3 && b.length >= 3 + b.readUInt16LE(1) ? { s: 3, l: b.readUInt16LE(1) } : null;
    if (t === 0xfe) return b.length >= 5 && b.length >= 5 + b.readUInt32LE(1) ? { s: 5, l: b.readUInt32LE(1) } : null;
    return null;
  };
  const e = span(rec);
  if (!e) return null;
  const env = rec.subarray(e.s, e.s + e.l);
  const o = span(env);
  if (!o) return null;
  const op = env.subarray(o.s, o.s + o.l);
  return op.length >= 35 ? op.readUInt16LE(33) : null;
}

function firstDiff(a: string, b: string): string {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return `linha ${i}:\n  A: ${la[i] ?? '<fim>'}\n  B: ${lb[i] ?? '<fim>'}`;
  }
  return '(sem diferenca textual)';
}
