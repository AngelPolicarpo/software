/**
 * Renderiza `out/gate-G1/resultado.md` a partir de `out/gate-G1/gate-G1.json`.
 *
 * Separado de `run-all.ts` de proposito: o artefato do gate precisa ser **regenerável
 * sem reexecutar o gate**. Os dados são o JSON; isto aqui é só apresentação.
 *
 *   node dist/scripts/render-report.js [caminho-do-gate-G1.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FuzzReport } from './run-fuzz.ts';
import type { RaceReport } from './run-races.ts';
import type { AdversaryReport } from './run-adversary.ts';
import type { DeterminismReport } from './run-determinism.ts';
import type { UnitReport } from './run-unit.ts';

export type Criterion = {
  id: string;
  criterio: string;
  medido: string;
  atendido: boolean;
  parcial: boolean;
};

export type Artifact = {
  gate: string;
  poc: string;
  hipotese: { a: string; b: string };
  adrsCobertas: string[];
  ambiente: Record<string, unknown>;
  duracaoTotalMs: number;
  criterios: Criterion[];
  decisao: string;
  cenarios: {
    unitarios: UnitReport;
    fuzzerTotalidade: FuzzReport;
    corridas: RaceReport[];
    hostAdversario: AdversaryReport & { esperados: Record<string, string> };
    determinismo: DeterminismReport;
  };
};

/**
 * A ressalva de cada critério "atendido, mas não pela letra". É o que transforma
 * `confirmado` em `confirmado com limite alterado`, e precisa estar VISÍVEL no artefato —
 * um leitor que só olhe a tabela não pode sair achando que passou limpo.
 */
const RESSALVAS: Record<string, string> = {
  A5:
    'Um dos 15 registros adversários é `APPLIED`: o `hostTs` retroativo (X3a). ' +
    '**R-1 (§8.3) manda CLAMPAR, não recusar** — e `backend-v2.md` tem precedência sobre o ' +
    'plano de validação (§0.2). O registro entra com `hostTs = lastHostTs`, sem nenhum efeito ' +
    'retroativo, e todas as réplicas concordam. O critério literal do POC-01 ("REJECTED ou ' +
    'IGNORED") não é atendido porque **é incompatível com R-1**. Ver CONFLITO-01 no REPORT.md.',
};

function situacao(c: Criterion): string {
  if (!c.atendido) return '**NÃO ATENDIDO**';
  return c.parcial ? 'ATENDIDO **com ressalva**' : 'ATENDIDO';
}

export function render(a: Artifact): string {
  const env = a.ambiente as Record<string, string>;
  const { fuzzerTotalidade: fuzz, corridas: races, hostAdversario: adv, determinismo: det, unitarios: unit } = a.cenarios;
  const L: string[] = [];

  L.push('# Resultado do gate G1 — POC-01', '');
  L.push(`**Decisão: ${a.decisao.toUpperCase()}**`, '');
  L.push(
    `Executado em ${env.executadoEm} · perfil \`${env.perfil}\` · foldBuildId \`${env.foldBuildId}\` · ` +
      `duração ${(a.duracaoTotalMs / 60000).toFixed(1)} min`,
    '',
  );

  const ressalvados = a.criterios.filter((c) => c.atendido && c.parcial);
  const reprovados = a.criterios.filter((c) => !c.atendido);

  if (reprovados.length > 0) {
    L.push('> **Por que a decisão é `invalidado`:**', '');
    for (const c of reprovados) L.push(`> - **${c.id}** não foi atendido — ${c.medido}`);
    L.push('');
  } else if (ressalvados.length > 0) {
    L.push(
      '> **Por que a decisão não é `confirmado` puro.** Todos os critérios foram atendidos, mas',
      `> ${ressalvados.length === 1 ? 'um deles não o é' : 'alguns não o são'} pela letra do plano de validação —`,
      '> e a divergência é do **próprio conjunto normativo**, não do resultado medido:',
      '',
    );
    for (const c of ressalvados) L.push(`> - **${c.id}** — ${RESSALVAS[c.id] ?? 'ver REPORT.md'}`, '');
  }

  L.push('## Hipótese sob teste', '');
  L.push(`**(a)** ${a.hipotese.a}`, '');
  L.push(`**(b)** ${a.hipotese.b}`, '');
  L.push(`ADRs cobertas: ${a.adrsCobertas.join(', ')}.`, '');

  L.push('## Critérios de aprovação', '');
  L.push('| # | Critério | Medido | Situação |', '|---|---|---|---|');
  for (const c of a.criterios) L.push(`| ${c.id} | ${c.criterio} | ${c.medido} | ${situacao(c)} |`);
  L.push('');

  L.push('## Cenário 1 — fuzzer de totalidade (§28.1, §8.5)', '');
  L.push(
    `Entradas: **${fuzz.iterations.toLocaleString('pt-BR')}** · semente \`${fuzz.seed}\` · ` +
      `${fuzz.workers} workers · ${fuzz.rate.toLocaleString('pt-BR')} entradas/s · ${(fuzz.ms / 1000).toFixed(0)}s`,
    '',
  );
  L.push(
    `\`fold.panic\` = **${fuzz.panics}** · desfecho fora dos três = **${fuzz.unknownDecision}** · ` +
      `\`reason\` ausente = **${fuzz.missingReason}** · efeitos sem APPLIED = **${fuzz.effectsWhenNotApplied}** · ` +
      `código fora do catálogo de §20.2 = **${fuzz.unknownReasonCodes.length}**`,
    '',
  );
  L.push('### Cobertura por estágio de §8.2', '', '| Estágio | Entradas |', '|---:|---:|');
  for (const k of Object.keys(fuzz.byStage).sort((x, y) => +x - +y)) {
    L.push(`| ${k} | ${fuzz.byStage[k].toLocaleString('pt-BR')} |`);
  }
  L.push('', 'Estágios 5 (comunidade encerrada) e 9 (timeout) exigem `community.end` e `mod.timeout`,', 'fora dos 16 `kind`s deste PoC — ver REPORT.md §6.', '');
  L.push('### Desfecho por estratégia', '', '| Estratégia | n | APPLIED | REJECTED | IGNORED |', '|---|---:|---:|---:|---:|');
  for (const [k, v] of Object.entries(fuzz.byStrategy).sort()) {
    L.push(`| \`${k}\` | ${v.n.toLocaleString('pt-BR')} | ${v.APPLIED} | ${v.REJECTED} | ${v.IGNORED} |`);
  }
  L.push('');
  L.push('### Motivos observados', '', '| Código | Ocorrências |', '|---|---:|');
  for (const [k, v] of Object.entries(fuzz.reasons).sort((x, y) => y[1] - x[1])) {
    L.push(`| \`${k}\` | ${v.toLocaleString('pt-BR')} |`);
  }
  L.push('');

  L.push('## Cenário 2 — as oito corridas de §21.1', '');
  L.push(
    'Cada repetição roda dois ensaios: **serial** (projetor pausado, op A, reinício do host, op B) e',
    '**paralelo** (as duas na mesma seção crítica, mesmo group commit de §11.5).',
    '',
  );
  L.push('| # | Corrida | Rep. | Ensaios | Desfecho de A | Desfecho de B | Δ append | Diverg. | Situação |', '|---|---|---:|---:|---|---|---|---:|---|');
  for (const r of races) {
    const fmt = (m: Record<string, number>): string =>
      Object.entries(m).map(([k, v]) => `\`${k}\`×${v.toLocaleString('pt-BR')}`).join('<br>');
    const d = Object.entries(r.appendedDeltaHistogram).map(([k, v]) => `+${k}×${v.toLocaleString('pt-BR')}`).join('<br>');
    L.push(
      `| ${r.id} | ${r.title} | ${r.repetitions.toLocaleString('pt-BR')} | ${r.trials.toLocaleString('pt-BR')} | ` +
        `${fmt(r.outcomesA)} | ${fmt(r.outcomesB)} | ${d} | ${r.divergences.length} | ${r.ok ? 'OK' : '**FALHA**'} |`,
    );
  }
  L.push('');
  L.push(
    `Ops recusadas **antes do append**, somando as oito: **${races
      .reduce((x, r) => x + r.rejectedBeforeAppend, 0)
      .toLocaleString('pt-BR')}**. ` +
      `Reprojeções totais conferidas: **${races.reduce((x, r) => x + r.reprojectionChecks, 0)}**. ` +
      `Réplicas independentes conferidas: **${races.reduce((x, r) => x + r.replicaChecks, 0)}**. ` +
      `Erros de fixture do harness: **${races.reduce((x, r) => x + r.fixtureErrors.length, 0)}**.`,
    '',
  );

  L.push('## Cenário 3 — host adversário (§1.4, §28.5)', '');
  L.push('| # | Ataque | Regra que decide | Decisão | Motivo | Réplicas concordam | Neutralizado |', '|---|---|---|---|---|---|---|');
  for (const c of adv.cases) {
    L.push(
      `| ${c.id} | ${c.title} | ${c.spec} | \`${c.decisions[0]?.decision ?? '?'}\` | ` +
        `\`${c.decisions[0]?.reason ?? '—'}\` | ${c.agree ? 'sim' : '**NÃO**'} | ${c.neutralized ? 'sim' : 'ver nota'} |`,
    );
  }
  L.push('');
  for (const c of adv.cases) if (c.note) L.push(`> **${c.id}** — ${c.note}`, '');
  L.push(`Réplicas: ${adv.replicas.map((r) => `\`${r}\``).join(', ')} — incluindo a do **próprio host adversário**.`, '');
  L.push(`Hash de dump idêntico em todas: **${adv.converged}**. \`fold.panic\`: **${adv.panics}**.`, '');

  L.push('## Cenário 4 — determinismo do `fold` (§28.4)', '');
  L.push(
    `Core de referência: **${det.corpusRecords.toLocaleString('pt-BR')}** registros, dos quais ` +
      `**${det.invalidRecords}** deliberadamente inválidos (appendados pelo caminho do adversário — ` +
      'a admissão de §11.4 os recusaria antes do append).',
    '',
  );
  L.push(
    `Decisões: APPLIED **${det.decisions.APPLIED.toLocaleString('pt-BR')}** · ` +
      `REJECTED **${det.decisions.REJECTED}** · IGNORED **${det.decisions.IGNORED}**.`,
    '',
  );
  L.push(
    `**1. Reprojeção idêntica** (§28.4 teste 1): ${det.reprojection.ok ? '**OK**' : '**DIVERGIU**'} — ` +
      `\`${det.reprojection.hashBefore.slice(0, 32)}…\``,
    '',
  );
  L.push('**2. Convergência entre réplicas** (§28.4 teste 2), com `PROJECTOR_BATCH` distinto em cada uma:', '');
  L.push('| Réplica | batch | interpretedSeq | hash do dump ordenado |', '|---|---:|---:|---|');
  for (const r of det.replicas) L.push(`| ${r.name} | ${r.batch} | ${r.interpretedSeq} | \`${r.hash.slice(0, 32)}…\` |`);
  L.push('', `Convergiram: **${det.convergence}**.`, '');
  L.push('**3. Snapshot equivalente** (§28.4 teste 3):', '', '| Intervalo de snapshot | `DecisionState` igual ao sem snapshot |', '|---|---|');
  for (const sn of det.snapshot) L.push(`| ${sn.interval === 0 ? 'sem snapshot' : sn.interval} | ${sn.ok ? 'sim' : '**NÃO**'} |`);
  L.push('');

  L.push('## Cenário 0 — unitários (§28.1)', '');
  L.push('| Suíte | Casos | Falhas |', '|---|---:|---:|');
  for (const s of unit.suites) L.push(`| ${s.name} | ${s.total.toLocaleString('pt-BR')} | ${s.failed} |`);
  L.push('');
  L.push(
    `Casos de \`fold\`: **${unit.foldCases.toLocaleString('pt-BR')}** (§28.1 pede ≥ 1 200). ` +
      `\`idgen\`: **${unit.idgenTuples.toLocaleString('pt-BR')}** tuplas, **${unit.idgenCollisions}** colisões de ` +
      'prefixo de 64 bits (uma colisão de 128 bits seria necessariamente também uma de 64, ' +
      'então zero aqui implica zero lá).',
    '',
  );

  L.push('## Ambiente e versões', '', '```json', JSON.stringify(a.ambiente, null, 2), '```', '');
  L.push('## Arquivos do artefato', '');
  L.push('| Arquivo | Conteúdo |', '|---|---|');
  L.push('| `gate-G1.json` | artefato completo, todos os cenários, dado bruto |');
  L.push('| `resultado.md` | este documento (regenerável: `node dist/scripts/render-report.js`) |');
  L.push('| `ambiente.json` | SO, runtime, ICU, dependências, sha256 do lockfile, `foldBuildId` |');
  L.push('| `unitarios.json` · `fuzzer.json` · `corridas.json` · `adversario.json` · `determinismo.json` | por cenário |');
  L.push('| `execucao.log` | log bruto da execução |');
  L.push('| `../../REPORT.md` | leitura da spec, buracos, conflitos e a justificativa da decisão |');
  L.push('');
  return L.join('\n');
}

// Modo CLI — so quando executado DIRETO. `run-all.ts` importa `render` e nao dispara isto.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2] ?? join(process.cwd(), 'out', 'gate-G1', 'gate-G1.json');
  const artifact = JSON.parse(readFileSync(target, 'utf8')) as Artifact;
  writeFileSync(join(dirname(target), 'resultado.md'), render(artifact));
  console.log(`resultado.md regenerado a partir de ${target}`);
}
