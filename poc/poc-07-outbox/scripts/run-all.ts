/**
 * GATE G4 / POC-07 — orquestrador e produtor do ARTEFATO.
 *
 * `plano-de-validacao-experimental-v2.md`, cabeçalho:
 *   "Artefato obrigatório de todo gate: código mínimo do harness, lockfile, configuração,
 *    dataset, logs brutos, resultado por cenário, versão do SO e do runtime, critérios
 *    usados e uma decisão explícita — confirmado, confirmado com limite alterado ou
 *    invalidado."
 *
 * Uso:
 *   node dist/scripts/run-all.js               # execução completa do gate
 *   POC07_PROFILE=quick node dist/...          # execução curta, para desenvolvimento
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, cpus, hostname, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';

import { runCrashMatrix, type CrashReport } from './run-crash-matrix.ts';
import { runScenarios, type Cenario } from './run-scenarios.ts';
import { runThroughput, type ThroughputReport } from './run-throughput.ts';
import { render, type Artifact } from './render-report.ts';

const ROOT = process.cwd();

/** O artefato do gate é o `full`. Perfis de desenvolvimento escrevem em diretório próprio. */
function outDirFor(profile: string): string {
  return join(ROOT, 'out', profile === 'full' ? 'gate-G4' : `gate-G4-${profile}`);
}

const PROFILES = {
  full: { envelopes: 100_000, crashOps: 200, crashRepeticoes: 3 },
  quick: { envelopes: 3_000, crashOps: 40, crashRepeticoes: 1 },
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
      versions[dep] = (
        JSON.parse(readFileSync(join(ROOT, 'node_modules', dep, 'package.json'), 'utf8')) as { version: string }
      ).version;
    } catch {
      versions[dep] = '<nao instalado>';
    }
  }
  let distro = '';
  try {
    distro = (readFileSync('/etc/os-release', 'utf8').match(/PRETTY_NAME="(.*)"/) ?? [])[1] ?? '';
  } catch {
    /* não-Linux */
  }
  return {
    perfil: profile,
    executadoEm: new Date().toISOString(),
    host: hostname(),
    so: { platform: platform(), release: release(), arch: arch(), distro },
    cpu: { modelo: cpus()[0]?.model ?? '?', nucleos: cpus().length },
    memoriaTotalGiB: +(totalmem() / 1024 ** 3).toFixed(1),
    runtime: { node: process.version, v8: process.versions.v8 },
    dependencias: versions,
    lockfile: { arquivo: 'package-lock.json', sha256: sha256File(join(ROOT, 'package-lock.json')) },
  };
}

/**
 * O que este harness **não** cobre, dito antes de qualquer número. Um artefato que subdeclara
 * a própria limitação é o defeito que a leitura de G10 encontrou em 2026-08-16 (§2 do
 * sequenciamento): o veredito vale exatamente até onde a evidência vai.
 */
const LIMITACOES = [
  {
    id: 'G4-E1',
    o_que: 'Queda de energia não é medida — só morte de processo (`SIGKILL`).',
    porque:
      '`rocksdb-native` não expõe `WriteOptions` e o padrão do RocksDB é `sync=false`; ' +
      'sem `fsync` observado, o WAL fica no cache de página. `SIGKILL` não perde cache de ' +
      'página, corte de energia perde. §10.7.1 já declara o piso conservador.',
  },
  {
    id: 'G4-E2',
    o_que: 'Ambiente é WSL2 sobre ext4, e o custo de `fsync` medido pode não ser honesto.',
    porque:
      'O enfileiramento em `synchronous=FULL` mediu 0,1–0,2 ms/op, rápido demais para um ' +
      'fsync real de disco. O número de latência vale como piso, não como teto — a mesma ' +
      'ressalva de `G0-E1`.',
  },
  {
    id: 'G4-E3',
    o_que: 'Transporte é TCP em loopback, não Noise sobre `hyperdht` (§16.1).',
    porque:
      'O gate mede durabilidade e idempotência do caminho de escrita. O transporte precisa ' +
      'entregar ordem por conexão e permitir perder o ACK — as duas coisas o loopback dá.',
  },
  {
    id: 'G4-E4',
    o_que: 'A réplica lê o log por RPC do host, sem verificar prova de Merkle.',
    porque:
      'O adversário medido é o que mente no **ACK**, não o que mente nos **bytes**. ' +
      'Integridade de replicação é de G2, não deste gate.',
  },
  {
    id: 'G4-E5',
    o_que: 'A admissão implementa o estágio 6 de §8.2, não o `fold` completo.',
    porque:
      'A idempotência que este gate interroga é a de `(author, authorSeq)`. As 27 regras ' +
      'e os 38 `kind`s são evidência de G1, com 10⁷ entradas hostis.',
  },
] as const;

async function main(): Promise<void> {
  const profileName = (process.env.POC07_PROFILE ?? 'full') as keyof typeof PROFILES;
  const P = PROFILES[profileName] ?? PROFILES.full;
  const OUT = outDirFor(profileName);
  mkdirSync(OUT, { recursive: true });
  const WORK = mkdtempSync(join(tmpdir(), 'poc07-gate-'));

  const env = environment(profileName);
  const t0 = Date.now();
  const log = (m: string): void => console.log(m);

  log('\n=== GATE G4 / POC-07 — durabilidade da outbox e idempotência sob crash ===');
  log(`perfil: ${profileName} · node ${process.version} · ${P.envelopes.toLocaleString('pt-BR')} envelopes\n`);

  // --- 1. Matriz de crash (§28.3) -------------------------------------------------------
  log(`[1/3] matriz de crash — 9 pontos × ${P.crashRepeticoes} repetição(ões), ${P.crashOps} ops cada…`);
  const crash: CrashReport = await runCrashMatrix({
    root: ROOT,
    work: join(WORK, 'crash'),
    ops: P.crashOps,
    repeticoes: P.crashRepeticoes,
    log,
  });
  log(`      ${crash.ok ? 'OK   ' : 'FALHA'} ${crash.casos.length} casos · ${(crash.ms / 1000).toFixed(0)}s`);

  // --- 2. Cenários nomeados -------------------------------------------------------------
  log('\n[2/3] cenários nomeados de POC-07…');
  const cen = await runScenarios({ root: ROOT, work: join(WORK, 'cenarios'), log });
  log(`      ${cen.ok ? 'OK   ' : 'FALHA'} ${cen.cenarios.length} cenários · ${(cen.ms / 1000).toFixed(0)}s`);

  // --- 3. Vazão e latência --------------------------------------------------------------
  log(`\n[3/3] vazão — ${P.envelopes.toLocaleString('pt-BR')} envelopes…`);
  const vazao: ThroughputReport = await runThroughput({
    root: ROOT,
    work: join(WORK, 'vazao'),
    envelopes: P.envelopes,
    log,
  });
  log(
    `      ${vazao.ok ? 'OK   ' : 'FALHA'} log=${vazao.noLog}/${vazao.envelopes} · ` +
      `p95=${vazao.p95Ms}ms · grupo médio=${vazao.grupoMedio} (máx ${vazao.maiorGrupo}) · ` +
      `${vazao.opsPorSegundo}/s · ${(vazao.ms / 1000).toFixed(0)}s`,
  );

  // --- Critérios de aprovação de POC-07 -------------------------------------------------
  const perdidasCrash = crash.casos.reduce((a, c) => a + c.perdidas, 0);
  const duplicadasCrash = crash.casos.reduce((a, c) => a + c.duplicadas, 0);
  const convergiuSempre = crash.casos.every((c) => c.convergiu);
  const morreuDeVerdade = crash.casos.filter((c) => c.morreu).length;
  const cenario = (n: string): Cenario | undefined => cen.cenarios.find((c) => c.nome.startsWith(n));
  const adversario = cenario('host adversário');
  const P95_ALVO_MS = 60; // §26.1

  const criteria = [
    {
      id: 'A1',
      criterio: '**zero** perda de operação confirmada, em todos os pontos de kill e na vazão',
      medido: `matriz: ${perdidasCrash} perdidas em ${crash.casos.length} casos (${morreuDeVerdade} com morte real) · vazão: ${vazao.perdidas} perdidas em ${vazao.envelopes}`,
      atendido: perdidasCrash === 0 && vazao.perdidas === 0,
      parcial: false,
    },
    {
      id: 'A2',
      criterio: '**zero** duplicata lógica — nunca dois `seq` para o mesmo `(author, authorSeq)`',
      medido: `matriz: ${duplicadasCrash} · vazão: ${vazao.duplicadas} · reenvio do mesmo envelope 3× produz um seq só`,
      atendido: duplicadasCrash === 0 && vazao.duplicadas === 0 && (cenario('reenvio')?.ok ?? false),
      parcial: false,
    },
    {
      id: 'A3',
      criterio: 'todo envelope incerto reconciliado por **observação da própria réplica**',
      medido: `ACK perdido: ${cenario('ACK perdido')?.medido ?? '—'}`,
      atendido: cenario('ACK perdido')?.ok ?? false,
      parcial: false,
    },
    {
      id: 'A4',
      criterio: 'nenhum item commitado da outbox perdido em **nenhum** ponto de kill; o boot sempre converge',
      medido: `${crash.casos.filter((c) => c.convergiu).length}/${crash.casos.length} convergiram · queimados por crash entre reserva e commit: ${crash.casos.reduce((a, c) => a + c.queimadas, 0)} (§7.5 permite)`,
      atendido: convergiuSempre && crash.ok,
      parcial: false,
    },
    {
      id: 'A5',
      criterio: 'o host adversário produz `ackMismatch > 0` e o item volta a `queued` — **nunca** reportado como entregue',
      medido: adversario?.medido ?? '—',
      atendido: adversario?.ok ?? false,
      parcial: false,
    },
    {
      id: 'A6',
      criterio: `p95 de submissão dentro de ${P95_ALVO_MS} ms com group commit (§26.1; se falhar, renegocia-se o alvo, nunca a barreira)`,
      medido: `p50=${vazao.p50Ms}ms p95=${vazao.p95Ms}ms p99=${vazao.p99Ms}ms · grupo médio ${vazao.grupoMedio}, máx ${vazao.maiorGrupo} · enfileiramento FULL ${vazao.enqueueMsPorOp}ms/op · WAL manifest ${vazao.walBytes.manifest}B`,
      atendido: vazao.p95Ms <= P95_ALVO_MS && vazao.maiorGrupo > 1,
      parcial: false,
    },
    {
      id: 'A7',
      criterio: 'nenhuma dependência de shutdown limpo para durabilidade — todo caso é `SIGKILL`',
      medido: `${morreuDeVerdade} casos com morte real por SIGKILL, todos recuperados sem close nem checkpoint`,
      atendido: morreuDeVerdade > 0 && crash.ok,
      parcial: false,
    },
    {
      id: 'A8',
      criterio: 'os cenários nomeados de POC-07, todos com oráculo explícito',
      medido: `${cen.cenarios.filter((c) => c.ok).length}/${cen.cenarios.length} cenários`,
      atendido: cen.ok,
      parcial: false,
    },
  ];

  const reprovado = criteria.some((c) => !c.atendido && !c.parcial);
  const comRessalva = criteria.some((c) => c.parcial);
  const verdict: Verdict = reprovado ? 'invalidado' : comRessalva ? 'confirmado com limite alterado' : 'confirmado';

  const artifact = {
    gate: 'G4',
    poc: 'POC-07',
    hipotese: {
      a: 'Uma operação confirmada não desaparece após queda.',
      b: 'Uma não confirmada permanece reenviável.',
      c: 'Qualquer retry do mesmo envelope produz exatamente um aceite lógico.',
      d: 'Nenhum item é descartado por idade sem reconciliação.',
    },
    adrsCobertas: ['A03', 'A05', 'A06'],
    ambiente: env,
    limitacaoDeEvidencia: LIMITACOES,
    duracaoTotalMs: Date.now() - t0,
    criterios: criteria,
    decisao: verdict,
    cenarios: { matrizDeCrash: crash, nomeados: cen, vazao },
  };

  writeFileSync(join(OUT, 'gate-G4.json'), JSON.stringify(artifact, null, 2));
  writeFileSync(join(OUT, 'ambiente.json'), JSON.stringify(env, null, 2));
  writeFileSync(join(OUT, 'matriz-de-crash.json'), JSON.stringify(crash, null, 2));
  writeFileSync(join(OUT, 'cenarios.json'), JSON.stringify(cen, null, 2));
  writeFileSync(join(OUT, 'vazao.json'), JSON.stringify(vazao, null, 2));
  writeFileSync(join(OUT, 'criterios.json'), JSON.stringify({ decisao: verdict, criterios: criteria }, null, 2));
  writeFileSync(join(OUT, 'resultado.md'), render(artifact as unknown as Artifact));
  rmSync(WORK, { recursive: true, force: true });

  log('\n--- critérios de aprovação de POC-07 ---');
  for (const cr of criteria) {
    log(`  ${cr.atendido ? '[OK]  ' : cr.parcial ? '[~]   ' : '[FALHA]'} ${cr.id}: ${cr.medido}`);
  }
  log(`\n>>> DECISÃO DO GATE G4: ${verdict.toUpperCase()}`);
  log(`>>> artefato: ${OUT}`);
  log(`>>> tempo total: ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min\n`);

  process.exitCode = verdict === 'invalidado' ? 1 : 0;
}

await main();
