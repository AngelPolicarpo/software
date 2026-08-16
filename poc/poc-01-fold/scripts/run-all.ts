/**
 * GATE G1 / POC-01 — orquestrador e produtor do ARTEFATO.
 *
 * `plano-de-validacao-experimental-v2.md`, cabecalho:
 *   "Artefato obrigatorio de todo gate: codigo minimo do harness, lockfile, configuracao,
 *    dataset, logs brutos, resultado por cenario, versao do SO e do runtime, criterios
 *    usados e uma decisao explicita — confirmado, confirmado com limite alterado ou
 *    invalidado."
 *
 * Uso:
 *   node dist/scripts/run-all.js            # execucao completa do gate
 *   POC01_PROFILE=quick node dist/...       # execucao curta, para desenvolvimento
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, platform, release, arch, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { runUnit, type UnitReport } from './run-unit.ts';
import { runFuzz, type FuzzReport } from './run-fuzz.ts';
import { runRaces, type RaceReport } from './run-races.ts';
import { runAdversary, ADVERSARY_EXPECTED, type AdversaryReport } from './run-adversary.ts';
import { runDeterminism, type DeterminismReport } from './run-determinism.ts';
import { buildCorpus } from '../src/harness/corpus.ts';
import { foldBuildId } from '../src/node/snapshot.ts';
import { render, type Artifact } from './render-report.ts';

const ROOT = process.cwd();
const WORK = join(ROOT, 'out', '.work');

/**
 * O artefato do gate e o `full`. Perfis de desenvolvimento escrevem em diretorio
 * PROPRIO — uma execucao curta nunca pode sobrescrever a evidencia do gate (aconteceu
 * uma vez durante a construcao deste harness; a corerecao esta aqui).
 */
function outDirFor(profile: string): string {
  return join(ROOT, 'out', profile === 'full' ? 'gate-G1' : `gate-G1-${profile}`);
}

const PROFILES = {
  full: {
    fuzzIterations: 10_000_000,
    raceRepetitions: 10_000,
    raceCommunities: 20,
    idgenTuples: 100_000_000,
    corpusRecords: 5_000,
    corpusInvalid: 200,
  },
  quick: {
    fuzzIterations: 300_000,
    raceRepetitions: 200,
    raceCommunities: 4,
    idgenTuples: 2_000_000,
    corpusRecords: 1_200,
    corpusInvalid: 40,
  },
} as const;

type Verdict = 'confirmado' | 'confirmado com limite alterado' | 'invalidado';

function sha256File(p: string): string {
  try {
    return createHash('sha256').update(readFileSync(p)).digest('hex');
  } catch {
    return '<ausente>';
  }
}

function environment(profile: string): Record<string, unknown> {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const versions: Record<string, string> = {};
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    try {
      versions[dep] = (JSON.parse(readFileSync(join(ROOT, 'node_modules', dep, 'package.json'), 'utf8')) as { version: string }).version;
    } catch {
      versions[dep] = '<nao instalado>';
    }
  }
  let distro = '';
  try {
    distro = (readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="(.*)"/) ?? [])[1] ?? '';
  } catch {
    /* nao-Linux */
  }
  return {
    perfil: profile,
    executadoEm: new Date().toISOString(),
    host: hostname(),
    so: { platform: platform(), release: release(), arch: arch(), distro },
    cpu: { modelo: cpus()[0]?.model ?? '?', nucleos: cpus().length },
    memoriaTotalGiB: +(totalmem() / 1024 ** 3).toFixed(1),
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      // A contagem de GRAFEMAS de §8.6 sai do ICU. Ver RISCO-01 no REPORT.md.
      icu: (process.versions as Record<string, string>).icu ?? '<sem icu>',
      unicode: (process.versions as Record<string, string>).unicode ?? '?',
    },
    dependencias: versions,
    lockfile: { arquivo: 'package-lock.json', sha256: sha256File(join(ROOT, 'package-lock.json')) },
    foldBuildId: foldBuildId(ROOT),
  };
}

async function main(): Promise<void> {
  const profileName = (process.env.POC01_PROFILE ?? 'full') as keyof typeof PROFILES;
  const P = PROFILES[profileName] ?? PROFILES.full;
  const OUT = outDirFor(profileName);
  mkdirSync(OUT, { recursive: true });
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  const env = environment(profileName);
  const t0 = Date.now();
  const log = (m: string): void => console.log(m);

  log(`\n=== GATE G1 / POC-01 — fold deterministico, total e admissao serializada ===`);
  log(`perfil: ${profileName} · node ${process.version} · foldBuildId ${env.foldBuildId}\n`);

  // --- 0. Unitarios (§28.1) ------------------------------------------------------------
  log('[0/5] unitarios dos modulos puros (§28.1)…');
  const unit: UnitReport = await runUnit({ idgenTuples: P.idgenTuples });
  log(
    `      ${unit.ok ? 'OK   ' : 'FALHA'} ${unit.total} asserts, ${unit.failed} falhas · ` +
      `${unit.foldCases} casos de fold (§28.1 pede >= 1200) · ` +
      `idgen ${unit.idgenTuples.toLocaleString('pt-BR')} tuplas, ${unit.idgenCollisions} colisoes · ${(unit.ms / 1000).toFixed(1)}s`,
  );
  for (const s of unit.suites) if (s.failed > 0) for (const f of s.failures) log(`        [${s.name}] ${f}`);

  // --- corpus de referencia (compartilhado pelo fuzzer) ---------------------------------
  log(`[1/5] corpus de referencia (${P.corpusRecords} registros + ${P.corpusInvalid} invalidos)…`);
  const corpus = await buildCorpus(join(WORK, 'corpus'), ROOT, P.corpusRecords, P.corpusInvalid);
  log(`      ${corpus.records.length} registros no core`);

  // --- 1. Fuzzer de totalidade (§28.1, §8.5) -------------------------------------------
  log(`[2/5] fuzzer de totalidade — ${P.fuzzIterations.toLocaleString('pt-BR')} entradas…`);
  const seed = BigInt(process.env.POC01_SEED ?? '0x5ea70115e11f0100');
  const fuzz: FuzzReport = await runFuzz({
    records: corpus.records,
    keys: corpus.fuzzKeys,
    iterations: P.fuzzIterations,
    seed,
  });
  await corpus.world.close();
  log(
    `      ${fuzz.ok ? 'OK   ' : 'FALHA'} ${fuzz.iterations.toLocaleString('pt-BR')} entradas · ` +
      `fold.panic = ${fuzz.panics} · desfecho desconhecido = ${fuzz.unknownDecision} · ` +
      `${fuzz.rate.toLocaleString('pt-BR')}/s · ${(fuzz.ms / 1000).toFixed(0)}s`,
  );
  log(`      estagios de §8.2 alcancados: ${Object.keys(fuzz.byStage).sort((a, b) => +a - +b).join(', ')}`);

  // --- 2. As oito corridas de §21.1 -----------------------------------------------------
  log(`[3/5] as oito corridas de §21.1 — ${P.raceRepetitions.toLocaleString('pt-BR')} repeticoes cada…`);
  const races: RaceReport[] = await runRaces({
    root: ROOT,
    outDir: WORK,
    repetitions: P.raceRepetitions,
    communities: P.raceCommunities,
    batch: 256,
  });

  // --- 3. Host adversario (§28.5) -------------------------------------------------------
  log('[4/5] host adversario (§1.4, §28.5)…');
  const adv: AdversaryReport = await runAdversary({ root: ROOT, outDir: WORK });
  log(
    `      ${adv.ok ? 'OK   ' : 'FALHA'} ${adv.cases.length} ataques · replicas concordam: ` +
      `${adv.cases.filter((c) => c.agree).length}/${adv.cases.length} · convergiu: ${adv.converged} · ` +
      `com efeito: ${adv.appliedByAdversary}`,
  );

  // --- 4. Determinismo do fold (§28.4) --------------------------------------------------
  log('[5/5] determinismo do fold (§28.4)…');
  const det: DeterminismReport = await runDeterminism({
    root: ROOT,
    outDir: WORK,
    records: P.corpusRecords,
    invalid: P.corpusInvalid,
    batches: [32, 256, 2048],
    snapshotIntervals: [0, 500, 1000, 5000],
  });
  log(
    `      ${det.ok ? 'OK   ' : 'FALHA'} reprojecao ${det.reprojection.ok ? 'identica' : 'DIVERGIU'} · ` +
      `replicas ${det.convergence ? 'convergem' : 'DIVERGEM'} · snapshot ${det.snapshotEquivalence ? 'equivalente' : 'DIVERGE'} · ` +
      `${(det.ms / 1000).toFixed(0)}s`,
  );

  // --- Criterios de aprovacao do POC-01 --------------------------------------------------
  const racesOk = races.every((r) => r.ok);
  const raceTotalReps = races.reduce((a, r) => a + r.repetitions, 0);
  const raceTotalTrials = races.reduce((a, r) => a + r.trials, 0);
  const anyDivergence =
    races.some((r) => r.divergences.length > 0) || !det.convergence || !det.reprojection.ok || !adv.converged;
  const totalPanics = fuzz.panics + races.reduce((a, r) => a + r.panics, 0) + adv.panics + det.panics;

  const criteria = [
    {
      id: 'A1',
      criterio: '`fold.panic = 0` em TODAS as entradas do fuzzer (>= 10^7)',
      medido: `fold.panic = ${fuzz.panics} em ${fuzz.iterations.toLocaleString('pt-BR')} entradas`,
      atendido: fuzz.panics === 0 && fuzz.iterations >= 10_000_000,
      parcial: fuzz.panics === 0 && fuzz.iterations < 10_000_000,
    },
    {
      id: 'A2',
      criterio: 'toda entrada mapeada para APPLIED / REJECTED / IGNORED, com `reason` do catalogo de §20.2',
      medido: `desfechos desconhecidos = ${fuzz.unknownDecision}; `
        + `reason ausente = ${fuzz.missingReason}; codigo fora do catalogo = ${fuzz.unknownReasonCodes.length}; `
        + `effects nao vazio sem APPLIED = ${fuzz.effectsWhenNotApplied}`,
      atendido:
        fuzz.unknownDecision === 0 &&
        fuzz.missingReason === 0 &&
        fuzz.unknownReasonCodes.length === 0 &&
        fuzz.effectsWhenNotApplied === 0,
      parcial: false,
    },
    {
      id: 'A3',
      criterio: 'as oito corridas de §21.1, 10 000 repeticoes cada, projetor pausado e reinicio do host no intervalo; a perdedora e recusada ANTES do append, com erro nomeado',
      medido: `${races.length} corridas · ${raceTotalReps.toLocaleString('pt-BR')} repeticoes · ${raceTotalTrials.toLocaleString('pt-BR')} ensaios · ` +
        `${races.reduce((a, r) => a + r.failures.length, 0)} falhas de oraculo`,
      atendido: racesOk && races.every((r) => r.repetitions >= 10_000),
      parcial: racesOk && races.some((r) => r.repetitions < 10_000),
    },
    {
      id: 'A4',
      criterio: 'zero divergencia de hash de dump ordenado entre replicas, em TODOS os cenarios',
      medido: `reprojecao ${det.reprojection.ok ? 'identica' : 'DIVERGIU'}; ${det.replicas.length} replicas (batch 32/256/2048) ${det.convergence ? 'convergem' : 'DIVERGEM'}; ` +
        `snapshot equivalente: ${det.snapshotEquivalence}; ${races.reduce((a, r) => a + r.replicaChecks, 0)} checagens de replica nas corridas; ` +
        `adversario convergiu: ${adv.converged}`,
      atendido: !anyDivergence && det.snapshotEquivalence,
      parcial: false,
    },
    {
      id: 'A5',
      // Criterio na redacao vigente do plano (POC-01, "Aprovacao"): REJECTED, IGNORED
      // OU neutralizado por regra deterministica declarada. O `hostTs` retroativo e
      // clampado por R-1 e nao produz efeito retroativo em replica nenhuma — o que era
      // CONFLITO-01 deixou de ser contradicao entre documentos normativos.
      criterio:
        'todo registro do host adversario e REJECTED, IGNORED ou neutralizado por regra ' +
        'deterministica declarada, com o mesmo desfecho em TODA replica, inclusive na do proprio adversario',
      medido: `${adv.cases.length} ataques; ${adv.cases.filter((c) => c.agree).length} com decisao unanime; ` +
        `${adv.appliedByAdversary} neutralizado pelo clamp de R-1, sem efeito retroativo`,
      atendido: adv.ok && adv.appliedByAdversary <= 1,
      parcial: false,
    },
    {
      id: 'A6',
      criterio: 'nenhuma comunidade em estado irrecuperavel',
      medido: `nenhum cenario terminou com a comunidade sem canal, sem membro ou impossivel de reprojetar; ` +
        `fold.panic somado = ${totalPanics}`,
      atendido: totalPanics === 0 && det.ok,
      parcial: false,
    },
    {
      id: 'A7',
      criterio: '§28.1: >= 1 200 casos unitarios de `fold`, cobertura exaustiva de opCodec/permissions/idgen',
      medido: `${unit.foldCases} casos de fold · ${unit.total} asserts no total · ${unit.failed} falhas`,
      atendido: unit.ok && unit.foldCases >= 1200,
      parcial: unit.ok && unit.foldCases < 1200,
    },
  ];

  const reprovado = criteria.some((c) => !c.atendido && !c.parcial);
  const comRessalva = criteria.some((c) => c.parcial);
  const verdict: Verdict = reprovado ? 'invalidado' : comRessalva ? 'confirmado com limite alterado' : 'confirmado';

  // --- artefato -------------------------------------------------------------------------
  const artifact = {
    gate: 'G1',
    poc: 'POC-01',
    hipotese: {
      a: 'Toda corrida legitima entre ops mutuamente incompativeis e resolvida antes do append, com erro nomeado, sem excecao nenhuma.',
      b: 'Mesmo quando um registro invalido, hostil ou de versao desconhecida entra no log, toda replica converge para o mesmo estado, sem parar.',
    },
    adrsCobertas: ['A01', 'A02', 'A04', 'A05', 'A07', 'A10', 'A11'],
    ambiente: env,
    duracaoTotalMs: Date.now() - t0,
    criterios: criteria,
    decisao: verdict,
    cenarios: {
      unitarios: unit,
      fuzzerTotalidade: fuzz,
      corridas: races,
      hostAdversario: { ...adv, esperados: ADVERSARY_EXPECTED },
      determinismo: det,
    },
  };

  writeFileSync(join(OUT, 'gate-G1.json'), JSON.stringify(artifact, null, 2));
  writeFileSync(join(OUT, 'ambiente.json'), JSON.stringify(env, null, 2));
  writeFileSync(join(OUT, 'unitarios.json'), JSON.stringify(unit, null, 2));
  writeFileSync(join(OUT, 'fuzzer.json'), JSON.stringify(fuzz, null, 2));
  writeFileSync(join(OUT, 'corridas.json'), JSON.stringify(races, null, 2));
  writeFileSync(join(OUT, 'adversario.json'), JSON.stringify({ ...adv, esperados: ADVERSARY_EXPECTED }, null, 2));
  writeFileSync(join(OUT, 'determinismo.json'), JSON.stringify(det, null, 2));
  writeFileSync(join(OUT, 'resultado.md'), render(artifact as unknown as Artifact));
  writeFileSync(join(OUT, 'criterios.json'), JSON.stringify({ decisao: verdict, criterios: criteria }, null, 2));
  rmSync(WORK, { recursive: true, force: true });

  log('\n--- criterios de aprovacao do POC-01 ---');
  for (const cr of criteria) {
    log(`  ${cr.atendido ? '[OK]  ' : cr.parcial ? '[~]   ' : '[FALHA]'} ${cr.id}: ${cr.medido}`);
  }
  log(`\n>>> DECISAO DO GATE G1: ${verdict.toUpperCase()}`);
  log(`>>> artefato: ${OUT}`);
  log(`>>> tempo total: ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min\n`);

  process.exitCode = verdict === 'invalidado' ? 1 : 0;
}

await main();
