/**
 * Worker do fuzzer de totalidade (§28.1, §8.5).
 *
 * Cada worker reconstroi o `DecisionState` de referencia foldando o corpus do `seq` 0 —
 * o `fold` e puro, entao o estado e identico em todos eles — e depois submete entradas
 * geradas contra esse mesmo `prev`, verificando que TODA entrada mapeia para um dos tres
 * desfechos, que o codigo de motivo esta no catalogo de §20.2, e que NENHUMA lanca.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { E, type ErrorCode } from '../src/protocol/errors.ts';
import { clearPanic, foldRecord, lastPanic, newMetrics } from '../src/fold/index.ts';
import { emptyState } from '../src/fold/state.ts';
import { Rng, STAGE_OF_REASON, STRATEGIES, generate, type FuzzKeys, type Strategy } from '../src/harness/mutate.ts';

type In = {
  records: Uint8Array[];
  keys: {
    communityKey: Uint8Array;
    coreSecretKey: Uint8Array;
    authors: Array<{ publicKey: Uint8Array; secretKey: Uint8Array }>;
    ids: { channels: string[]; categories: string[]; roles: string[]; messages: string[] };
    baseHostTs: number;
  };
  iterations: number;
  seed: string;
  id: number;
};
const wd = workerData as In;

const keys: FuzzKeys = {
  communityKey: Buffer.from(wd.keys.communityKey),
  coreSecretKey: Buffer.from(wd.keys.coreSecretKey),
  authors: wd.keys.authors.map((a) => ({ publicKey: Buffer.from(a.publicKey), secretKey: Buffer.from(a.secretKey) })),
  ids: wd.keys.ids,
  baseHostTs: wd.keys.baseHostTs,
};
const corpus = wd.records.map((r) => Buffer.from(r));
const VALID_CODES = new Set<string>(Object.values(E) as ErrorCode[]);

// 1. reconstroi o `prev` de referencia (o `fold` e puro: identico em todos os workers).
const metrics = newMetrics();
let base = emptyState(keys.communityKey, keys.communityKey.toString('hex'));
for (let seq = 0; seq < corpus.length; seq++) base = foldRecord(base, corpus[seq], seq, metrics).next;
const buildPanics = metrics.panic;
const corpusApplied = metrics.applied;

// 2. fuzz.
const rng = new Rng(BigInt(wd.seed));
const byStrategy: Record<string, { n: number; APPLIED: number; REJECTED: number; IGNORED: number }> = {};
const reasons: Record<string, number> = {};
const byStage: Record<string, number> = {};
const badReason: Array<{ strategy: string; reason: string }> = [];
const panics: Array<{ strategy: string; input: string; err: string }> = [];
let unknownDecision = 0;
let missingReason = 0;
let effectsWhenNotApplied = 0;
const baseSeq = corpus.length;

for (let i = 0; i < wd.iterations; i++) {
  const strategy: Strategy = STRATEGIES[rng.int(STRATEGIES.length)];
  const input = generate(rng, corpus, keys, strategy);
  // "`seq` fora de ordem": o registro e interpretado numa posicao arbitraria do log,
  // inclusive dentro da faixa da genese (0..5), onde R-27 manda.
  const seq = rng.int(4) === 0 ? rng.int(baseSeq + 50) : baseSeq;
  const before = metrics.panic;
  clearPanic();
  const res = foldRecord(base, input, seq, metrics);

  let s = byStrategy[strategy];
  if (!s) { s = { n: 0, APPLIED: 0, REJECTED: 0, IGNORED: 0 }; byStrategy[strategy] = s; }
  s.n++;
  if (res.decision === 'APPLIED' || res.decision === 'REJECTED' || res.decision === 'IGNORED') s[res.decision]++;
  else unknownDecision++;

  if (res.decision === 'APPLIED') {
    byStage['15'] = (byStage['15'] ?? 0) + 1;
  } else {
    // §8.0: `reason` esta PRESENTE quando REJECTED ou IGNORED.
    const r = res.reason;
    if (r === undefined) missingReason++;
    else {
      reasons[r] = (reasons[r] ?? 0) + 1;
      if (!VALID_CODES.has(r)) badReason.push({ strategy, reason: r });
      const st = String(STAGE_OF_REASON[r] ?? 0);
      byStage[st] = (byStage[st] ?? 0) + 1;
    }
    // §8.0: `effects` VAZIO quando nao APPLIED.
    if (res.effects.length > 0) effectsWhenNotApplied++;
  }
  if (metrics.panic > before && panics.length < 20) {
    panics.push({ strategy, input: input.subarray(0, 96).toString('hex'), err: lastPanic?.err ?? '?' });
  }
  if (i % 250_000 === 0) parentPort!.postMessage({ t: 'progress', id: wd.id, done: i });
}

parentPort!.postMessage({
  t: 'done',
  id: wd.id,
  iterations: wd.iterations,
  panics: metrics.panic,
  buildPanics,
  corpusApplied,
  unknownDecision,
  missingReason,
  effectsWhenNotApplied,
  byStrategy,
  reasons,
  byStage,
  badReason,
  panicSamples: panics,
});
