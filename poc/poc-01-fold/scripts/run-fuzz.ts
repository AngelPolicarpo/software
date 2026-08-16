/**
 * CENARIO 1 do gate G1 — FUZZER DE TOTALIDADE (§28.1, §8.5).
 *
 * "≥ 10^7 entradas aleatorias e mutadas provando que NENHUMA lanca e que toda uma delas
 *  mapeia para um dos tres desfechos. `fold.panic` precisa ser 0. Este teste e o que
 *  sustenta §8.5." (§28.1)
 *
 * Aprovacao (POC-01): `fold.panic = 0` em TODAS as 10^7 entradas.
 */
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type FuzzReport = {
  iterations: number;
  workers: number;
  seed: string;
  panics: number;
  unknownDecision: number;
  missingReason: number;
  effectsWhenNotApplied: number;
  byStrategy: Record<string, { n: number; APPLIED: number; REJECTED: number; IGNORED: number }>;
  reasons: Record<string, number>;
  /** cobertura por estagio de §8.2, inferida pelo codigo do desfecho */
  byStage: Record<string, number>;
  unknownReasonCodes: Array<{ strategy: string; reason: string }>;
  panicSamples: Array<{ strategy: string; input: string; err: string }>;
  corpusRecords: number;
  ms: number;
  rate: number;
  ok: boolean;
};

export async function runFuzz(opts: {
  records: Buffer[];
  keys: {
    communityKey: Buffer;
    coreSecretKey: Buffer;
    authors: Array<{ publicKey: Buffer; secretKey: Buffer }>;
    ids: { channels: string[]; categories: string[]; roles: string[]; messages: string[] };
    baseHostTs: number;
  };
  iterations: number;
  seed: bigint;
  workers?: number;
}): Promise<FuzzReport> {
  const t0 = Date.now();
  const n = opts.workers ?? Math.max(1, Math.min(cpus().length, 16));
  const per = Math.ceil(opts.iterations / n);
  const here = dirname(fileURLToPath(import.meta.url));
  const workerFile = join(here, 'fuzz-worker.js');

  const rep: FuzzReport = {
    iterations: 0,
    workers: n,
    seed: opts.seed.toString(),
    panics: 0,
    unknownDecision: 0,
    missingReason: 0,
    effectsWhenNotApplied: 0,
    byStrategy: {},
    reasons: {},
    byStage: {},
    unknownReasonCodes: [],
    panicSamples: [],
    corpusRecords: opts.records.length,
    ms: 0,
    rate: 0,
    ok: false,
  };

  let lastPrint = Date.now();
  const progress = new Array<number>(n).fill(0);

  await Promise.all(
    Array.from({ length: n }, (_, id) =>
      new Promise<void>((resolve, reject) => {
        const w = new Worker(workerFile, {
          workerData: {
            records: opts.records,
            keys: opts.keys,
            iterations: per,
            seed: (opts.seed + BigInt(id) * 0x1000_0000_0000_0001n).toString(),
            id,
          },
        });
        w.on('message', (m: Record<string, never>) => {
          const msg = m as unknown as { t: string } & Record<string, never>;
          if (msg.t === 'progress') {
            progress[(msg as unknown as { id: number }).id] = (msg as unknown as { done: number }).done;
            if (Date.now() - lastPrint > 5000) {
              lastPrint = Date.now();
              const done = progress.reduce((a, b) => a + b, 0);
              const el = (Date.now() - t0) / 1000;
              console.log(
                `        ${(done / 1e6).toFixed(2)}M / ${(opts.iterations / 1e6).toFixed(0)}M ` +
                  `(${(done / el / 1000).toFixed(0)}k/s)`,
              );
            }
            return;
          }
          const d = msg as unknown as {
            iterations: number;
            panics: number;
            buildPanics: number;
            unknownDecision: number;
            missingReason: number;
            effectsWhenNotApplied: number;
            byStrategy: Record<string, { n: number; APPLIED: number; REJECTED: number; IGNORED: number }>;
            reasons: Record<string, number>;
            byStage: Record<string, number>;
            badReason: Array<{ strategy: string; reason: string }>;
            panicSamples: Array<{ strategy: string; input: string; err: string }>;
          };
          rep.iterations += d.iterations;
          rep.panics += d.panics + d.buildPanics;
          rep.unknownDecision += d.unknownDecision;
          rep.missingReason += d.missingReason;
          rep.effectsWhenNotApplied += d.effectsWhenNotApplied;
          for (const [k, v] of Object.entries(d.byStage)) rep.byStage[k] = (rep.byStage[k] ?? 0) + v;
          for (const [k, v] of Object.entries(d.byStrategy)) {
            const s = (rep.byStrategy[k] ??= { n: 0, APPLIED: 0, REJECTED: 0, IGNORED: 0 });
            s.n += v.n;
            s.APPLIED += v.APPLIED;
            s.REJECTED += v.REJECTED;
            s.IGNORED += v.IGNORED;
          }
          for (const [k, v] of Object.entries(d.reasons)) rep.reasons[k] = (rep.reasons[k] ?? 0) + v;
          rep.unknownReasonCodes.push(...d.badReason.slice(0, 5));
          rep.panicSamples.push(...d.panicSamples.slice(0, 3));
        });
        w.on('error', reject);
        w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${id} saiu com ${code}`))));
      }),
    ),
  );

  rep.ms = Date.now() - t0;
  rep.rate = Math.round(rep.iterations / (rep.ms / 1000));
  rep.ok =
    rep.panics === 0 &&
    rep.unknownDecision === 0 &&
    rep.missingReason === 0 &&
    rep.effectsWhenNotApplied === 0 &&
    rep.unknownReasonCodes.length === 0;
  return rep;
}
