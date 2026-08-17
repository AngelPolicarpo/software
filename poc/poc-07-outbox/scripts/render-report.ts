// `resultado.md` — a leitura humana do artefato. Só formata; nenhum julgamento novo.

export type Artifact = {
  gate: string;
  poc: string;
  hipotese: Record<string, string>;
  adrsCobertas: string[];
  ambiente: Record<string, unknown>;
  limitacaoDeEvidencia: readonly { id: string; o_que: string; porque: string }[];
  duracaoTotalMs: number;
  criterios: readonly { id: string; criterio: string; medido: string; atendido: boolean; parcial: boolean }[];
  decisao: string;
  cenarios: {
    matrizDeCrash: { ok: boolean; casos: readonly Record<string, unknown>[] };
    nomeados: { ok: boolean; cenarios: readonly { nome: string; pergunta: string; medido: string; ok: boolean }[] };
    vazao: Record<string, unknown>;
  };
};

export function render(a: Artifact): string {
  const l: string[] = [];
  const amb = a.ambiente as { so?: { distro?: string; platform?: string }; runtime?: { node?: string }; perfil?: string };
  l.push(`# ${a.gate} / ${a.poc} — resultado`);
  l.push('');
  l.push(`**Decisão: ${a.decisao.toUpperCase()}**`);
  l.push('');
  l.push(
    `Perfil \`${amb.perfil ?? '?'}\` · ${amb.so?.distro ?? amb.so?.platform ?? '?'} · Node ${amb.runtime?.node ?? '?'} · ` +
      `${(a.duracaoTotalMs / 1000 / 60).toFixed(1)} min · ADRs ${a.adrsCobertas.join(', ')}`,
  );
  l.push('');
  l.push('## Hipótese');
  l.push('');
  for (const [k, v] of Object.entries(a.hipotese)) l.push(`- **(${k})** ${v}`);
  l.push('');
  l.push('## Critérios');
  l.push('');
  l.push('| | Critério | Medido |');
  l.push('|---|---|---|');
  for (const c of a.criterios) {
    const marca = c.atendido ? '**OK**' : c.parcial ? '~' : '**FALHA**';
    l.push(`| ${marca} ${c.id} | ${c.criterio} | ${c.medido} |`);
  }
  l.push('');
  l.push('## Limitação de evidência');
  l.push('');
  l.push('O veredito vale exatamente até onde a evidência vai.');
  l.push('');
  l.push('| # | O que não é medido | Por quê |');
  l.push('|---|---|---|');
  for (const e of a.limitacaoDeEvidencia) l.push(`| \`${e.id}\` | ${e.o_que} | ${e.porque} |`);
  l.push('');
  l.push('## Matriz de crash (§28.3)');
  l.push('');
  l.push('| Ponto de kill | Morreu | Perdidas | Duplicadas | No log | Na fila | Convergiu |');
  l.push('|---|---|---|---|---|---|---|');
  for (const c of a.cenarios.matrizDeCrash.casos) {
    l.push(
      `| \`${String(c.ponto)}\` | ${String(c.morreu)} | ${String(c.perdidas)} | ${String(c.duplicadas)} | ` +
        `${String(c.noLog)} | ${String(c.naOutbox)} | ${String(c.convergiu)} |`,
    );
  }
  l.push('');
  l.push('## Cenários nomeados');
  l.push('');
  l.push('| | Cenário | Pergunta | Medido |');
  l.push('|---|---|---|---|');
  for (const c of a.cenarios.nomeados.cenarios) {
    l.push(`| ${c.ok ? '**OK**' : '**FALHA**'} | ${c.nome} | ${c.pergunta} | ${c.medido} |`);
  }
  l.push('');
  l.push('## Vazão');
  l.push('');
  l.push('```json');
  l.push(JSON.stringify(a.cenarios.vazao, null, 2));
  l.push('```');
  l.push('');
  return l.join('\n');
}
