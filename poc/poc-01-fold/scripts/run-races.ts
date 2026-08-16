/**
 * CENARIO 2 do gate G1 — as oito corridas de §21.1.
 *
 * Criterio de aprovacao (POC-01): "10 000 repeticoes por par de conflito", "cada uma
 * submetida em paralelo com o projetor pausado e com reinicio do host no intervalo",
 * "toda corrida rejeitada ANTES do append, com erro deterministico", "zero divergencia
 * entre replicas (hash de dump) em todos os cenarios".
 *
 * Cada repeticao roda DOIS ensaios sobre fixtures independentes:
 *   SERIAL   — projetor pausado, opA, REINICIO DO HOST, opB
 *   PARALELO — projetor pausado, opA e opB submetidas juntas (mesmo group commit)
 *
 * Oraculos, por ensaio:
 *   1. o desfecho de cada op e exatamente o de §21.1, com o codigo de erro nomeado;
 *   2. `core.length` cresce EXATAMENTE o numero de vencedoras — a perdedora nao e
 *      appendada (e a diferenca entre v1 e v2);
 *   3. `fold.panic == 0`.
 * Ao fim de cada comunidade:
 *   4. reprojecao total (§10.5) reproduz o mesmo hash de dump;
 *   5. duas replicas independentes, com replicacao Hypercore real, produzem o mesmo hash.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RACES, type RaceCase } from '../src/harness/races.ts';
import { createWorld, type World } from '../src/harness/world.ts';
import type { Envelope } from '../src/codec/opCodec.ts';
import type { SubmitResult } from '../src/host/host.ts';

export type RaceReport = {
  id: string;
  title: string;
  spec: string;
  repetitions: number;
  trials: number;
  communities: number;
  outcomesA: Record<string, number>;
  outcomesB: Record<string, number>;
  appendedDeltaHistogram: Record<string, number>;
  rejectedBeforeAppend: number;
  panics: number;
  reprojectionChecks: number;
  replicaChecks: number;
  divergences: Array<{ community: number; kind: string; hashes: string[] }>;
  failures: Array<{ rep: number; trial: string; detail: string }>;
  /** erro de fixture do harness (setup/teardown recusado) — nao e falha do `fold` */
  fixtureErrors: Array<{ rep: number; detail: string }>;
  ok: boolean;
  ms: number;
};

const bump = (m: Record<string, number>, k: string): void => {
  m[k] = (m[k] ?? 0) + 1;
};

function outcome(r: SubmitResult): string {
  return r.ok ? 'APPLIED' : r.code;
}

async function runCommunity(
  race: RaceCase,
  dir: string,
  root: string,
  reps: number,
  startRep: number,
  rep: RaceReport,
  batch: number,
): Promise<void> {
  const w: World = await createWorld({ dir, root, clients: 10, batch });
  try {
    for (let i = 0; i < reps; i++) {
      const n = startRep + i;
      try {
        await trialSerial(race, w, n, rep);
        await trialParallel(race, w, n, rep);
      } catch (err) {
        // Falha de FIXTURE (setup/teardown recusado) e erro do harness, nao do `fold`.
        // Registra e segue, para o gate nao perder os outros cenarios por causa disto.
        rep.fixtureErrors.push({ rep: n, detail: err instanceof Error ? err.message : String(err) });
        if (rep.fixtureErrors.length > 20) break;
      }
    }

    // --- Oraculo 4: reprojecao total reproduz o mesmo hash (§28.4 teste 1) ----------
    w.host.resumeProjector();
    const before = w.host.hash();
    const after = await w.host.reprojectAll();
    rep.reprojectionChecks++;
    if (before !== after) {
      rep.divergences.push({ community: rep.communities, kind: 'reprojection', hashes: [before, after] });
    }

    // --- Oraculo 5: duas replicas independentes (§28.4 teste 2) ---------------------
    const reps2 = await w.replicas(2, `${race.id}-${rep.communities}`);
    const hashes = [after, ...reps2.map((r) => r.hash())];
    rep.replicaChecks += reps2.length;
    if (new Set(hashes).size !== 1) {
      rep.divergences.push({ community: rep.communities, kind: 'replicas', hashes });
    }
    for (const r of reps2) {
      rep.panics += r.projector.metrics.panic;
      await r.close();
    }
    rep.panics += w.host.metrics.panic;
    rep.rejectedBeforeAppend += w.host.stats.rejectedBeforeAppend;
  } finally {
    await w.close();
  }
}

/** SERIAL: projetor pausado, opA, REINICIO DO HOST, opB. */
async function trialSerial(race: RaceCase, w: World, n: number, rep: RaceReport): Promise<void> {
  const fixture = (await race.setup(w, n)) as never;
  // O projetor precisa estar em dia para o snapshot de §10.6 ser consistente.
  w.host.resumeProjector();
  w.host.snapshotProjected();
  w.host.pauseProjector();

  const { a, b } = await race.ops(w, n, fixture);
  const len0 = w.host.core.length;
  const ra = await w.host.submit(a);
  // REINICIO: derruba o estado em memoria; o `DS` que decide `b` vem do LOG.
  await w.host.restartFromSnapshot();
  const rb = await w.host.submit(b);
  check(race, w, n, 'serial', ra, rb, len0, rep);

  w.host.resumeProjector();
  if (race.teardown) await race.teardown(w, n, fixture);
}

/** PARALELO: projetor pausado, as duas ops no MESMO group commit. */
async function trialParallel(race: RaceCase, w: World, n: number, rep: RaceReport): Promise<void> {
  const fixture = (await race.setup(w, n + 500_000)) as never;
  w.host.pauseProjector();
  const { a, b } = await race.ops(w, n + 500_000, fixture);
  const len0 = w.host.core.length;
  const [ra, rb] = await submitTogether(w, a, b);
  check(race, w, n, 'paralelo', ra, rb, len0, rep);
  w.host.resumeProjector();
  if (race.teardown) await race.teardown(w, n + 500_000, fixture);
}

/**
 * Submete as duas SEM `await` entre elas. Como `CommunityHost.submit` agenda o dreno num
 * microtask, as duas entram na fila ANTES de qualquer decisao e sao decididas dentro da
 * MESMA secao critica, no mesmo group commit (§11.4, §11.5). A ordem e a de chegada na
 * fila — que e o que §21.1 diz resolver a corrida.
 */
function submitTogether(w: World, a: Envelope, b: Envelope): Promise<[SubmitResult, SubmitResult]> {
  const pa = w.host.submit(a);
  const pb = w.host.submit(b);
  return Promise.all([pa, pb]) as Promise<[SubmitResult, SubmitResult]>;
}

function check(
  race: RaceCase,
  w: World,
  n: number,
  trial: string,
  ra: SubmitResult,
  rb: SubmitResult,
  len0: number,
  rep: RaceReport,
): void {
  rep.trials++;
  const oa = outcome(ra);
  const ob = outcome(rb);
  bump(rep.outcomesA, oa);
  bump(rep.outcomesB, ob);
  const delta = w.host.core.length - len0;
  bump(rep.appendedDeltaHistogram, String(delta));

  if (oa !== race.expect.a) {
    rep.failures.push({ rep: n, trial, detail: `A: esperado ${race.expect.a}, obtido ${oa}` });
  }
  if (ob !== race.expect.b) {
    rep.failures.push({ rep: n, trial, detail: `B: esperado ${race.expect.b}, obtido ${ob}` });
  }
  if (delta !== race.expect.appended) {
    // Oraculo 2 — o mais importante: a perdedora NAO pode ter sido appendada.
    rep.failures.push({
      rep: n,
      trial,
      detail: `append: esperado +${race.expect.appended}, obtido +${delta} (perdedora appendada?)`,
    });
  }
}

export async function runRaces(opts: {
  root: string;
  outDir: string;
  repetitions: number;
  communities: number;
  batch: number;
  only?: string[];
}): Promise<RaceReport[]> {
  const reports: RaceReport[] = [];
  const cases = opts.only ? RACES.filter((r) => opts.only!.includes(r.id)) : RACES;
  for (const race of cases) {
    const t0 = Date.now();
    const rep: RaceReport = {
      id: race.id,
      title: race.title,
      spec: race.spec,
      repetitions: opts.repetitions,
      trials: 0,
      communities: 0,
      outcomesA: {},
      outcomesB: {},
      appendedDeltaHistogram: {},
      rejectedBeforeAppend: 0,
      panics: 0,
      reprojectionChecks: 0,
      replicaChecks: 0,
      divergences: [],
      failures: [],
      fixtureErrors: [],
      ok: false,
      ms: 0,
    };
    // C8 cria um membro novo por repeticao; menos repeticoes por comunidade evita um
    // `DecisionState` com dezenas de milhares de membros num unico snapshot.
    const communities = race.needsFreshVictim ? Math.max(opts.communities, 50) : opts.communities;
    const perCommunity = Math.ceil(opts.repetitions / communities);
    let done = 0;
    for (let c = 0; c < communities && done < opts.repetitions; c++) {
      const reps = Math.min(perCommunity, opts.repetitions - done);
      const dir = join(opts.outDir, 'worlds', `${race.id}-${c}`);
      mkdirSync(dir, { recursive: true });
      await runCommunity(race, dir, opts.root, reps, done, rep, opts.batch);
      rep.communities++;
      done += reps;
      rmSync(dir, { recursive: true, force: true });
      if (rep.failures.length > 50) break; // reprovado; nao gasta 10 minutos provando
    }
    rep.repetitions = done;
    rep.ms = Date.now() - t0;
    rep.ok =
      rep.failures.length === 0 &&
      rep.divergences.length === 0 &&
      rep.panics === 0 &&
      rep.fixtureErrors.length === 0;
    reports.push(rep);
    const mark = rep.ok ? 'OK  ' : 'FALHA';
    console.log(
      `  ${mark} ${race.id} ${race.title} — ${rep.repetitions} rep / ${rep.trials} ensaios / ` +
        `${rep.communities} comunidades / ${(rep.ms / 1000).toFixed(1)}s` +
        (rep.ok ? '' : ` — ${rep.failures.length} falhas, ${rep.divergences.length} divergencias, ${rep.fixtureErrors.length} erros de fixture`),
    );
    if (!rep.ok) {
      for (const f of rep.failures.slice(0, 5)) console.log(`        rep ${f.rep} [${f.trial}] ${f.detail}`);
      for (const f of rep.fixtureErrors.slice(0, 3)) console.log(`        rep ${f.rep} [fixture] ${f.detail}`);
    }
  }
  return reports;
}
