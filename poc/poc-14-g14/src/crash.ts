// Cenário 5 — `SIGKILL` em cada ponto do caminho de append (critério 5 de §31.26).
//
// O oráculo é o de §31.13: depois da morte, o nó reabre, compara `core.length` com
// `self_high_water` e **não appenda** enquanto estiver `desynced`. Um fork só pode existir
// se ele appendar por cima de um índice que o par já tem com outro conteúdo — então o par é
// parte do teste, não decoração: ele replica tudo o que sobrevive e é ele quem grita
// `conflict` se um fork nascer.
//
// **O que isto mede e o que não mede.** `SIGKILL` mata o processo e não toca o page cache do
// SO; isso é falha de **processo**, que é o que §10.7.1 diz que `await core.append` cobre.
// Queda de energia é G4 e continua sem evidência.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import Hypercore from 'hypercore';

import { dmWorld } from './core.js';
import { abrirManifesto, classificar } from './manifesto.js';

export const PONTOS = ['antes-hw', 'entre', 'durante', 'depois'] as const;
export type Ponto = (typeof PONTOS)[number];

export type Rodada = {
  readonly ponto: Ponto | 'limpo';
  readonly repeticao: number;
  readonly morreu: boolean;
  readonly sinal: string | null;
  readonly codigo: number | null;
  readonly lengthDepois: number;
  readonly highWaterDepois: number;
  readonly estado: 'normal' | 'desynced';
  /** O filho leu a regra de §31.13 e se recusou a appendar. */
  readonly recusouAppend: boolean;
  /** `desynced` sem que bloco nenhum tenha sido perdido: o par também não tem o que falta. */
  readonly desyncedSemPerdaReal: boolean;
  readonly parNaHora: number;
  readonly fases: readonly string[];
};

export type Cenario5 = {
  readonly rodadas: readonly Rodada[];
  readonly mortes: number;
  readonly forks: number;
  readonly ondeConflitou: readonly string[];
  readonly desyncedObservado: number;
  readonly recusasDeAppend: number;
  readonly appendsAposDesynced: number;
  /** ACHADO-G14-05 — quantas vezes `desynced` apareceu sem perda nenhuma de bloco. */
  readonly desyncedSemPerdaReal: number;
  readonly aceitesDePerdaVazia: number;
  readonly lengthNuncaRegrediu: boolean;
  readonly parConvergiu: boolean;
  readonly comprimentoFinal: { escritor: number; par: number };
  readonly ok: boolean;
  readonly erro?: string;
};

function rodarFilho(script: string, args: readonly string[]): Promise<{ sinal: string | null; codigo: number | null; fases: string[] }> {
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buffer = '';
    filho.stdout.on('data', (c: Buffer) => {
      buffer += c.toString('utf8');
    });
    filho.on('close', (codigo, sinal) => {
      const fases = buffer
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => {
          try {
            return String((JSON.parse(l) as { fase: string }).fase);
          } catch {
            return 'ilegivel';
          }
        });
      resolve({ sinal, codigo, fases });
    });
  });
}

/**
 * `repeticoes` mortes por ponto, mais uma corrida limpa no fim de cada volta. O par replica
 * o que existir a cada passo, para que um fork seja detectado no ponto em que nascer e não
 * só no final.
 */
export async function cenario5(dir: string, script: string, repeticoes: number): Promise<Cenario5> {
  mkdirSync(dir, { recursive: true });
  const w = dmWorld();
  const rodadas: Rodada[] = [];
  const conflitos: string[] = [];
  let appendsAposDesynced = 0;
  let desyncedObservado = 0;
  let recusasDeAppend = 0;
  let desyncedSemPerdaTotal = 0;
  let aceitesDePerdaVazia = 0;
  let lengthNuncaRegrediu = true;
  let anterior = 0;
  let erro: string | undefined;
  let comprimentoFinal = { escritor: 0, par: 0 };
  let parConvergiu = false;

  const par = new Hypercore(join(dir, 'peer'), w.lo.core.publicKey, { compat: true });
  await par.ready();
  par.on('conflict', () => conflitos.push('par'));

  try {
    let repeticao = 0;
    for (const ponto of [...PONTOS, 'limpo' as const]) {
      for (let i = 0; i < (ponto === 'limpo' ? 1 : repeticoes); i++) {
        repeticao++;
        const { sinal, codigo, fases } = await rodarFilho(script, [dir, w.conversationId, ponto, String(repeticao)]);

        // O boot de §31.13, no processo do pai: reabrir, comparar, e só então decidir.
        const manifesto = abrirManifesto(join(dir, 'manifest.db'));
        const core = new Hypercore(join(dir, 'core'), { keyPair: w.lo.core, compat: true });
        core.on('conflict', () => conflitos.push('escritor'));
        await core.ready();
        const hw = manifesto.ler(w.conversationId);
        const estado = classificar(core.length, hw);
        if (estado === 'desynced') desyncedObservado++;
        if (core.length < anterior) lengthNuncaRegrediu = false;
        anterior = Math.max(anterior, core.length);
        const recusouAppend = fases.includes('desynced-recusou-append');
        if (recusouAppend) recusasDeAppend++;
        if (estado === 'desynced' && fases.includes('appendado')) appendsAposDesynced++;

        // O par replica o que existir agora. Se um fork nasceu, é aqui que ele aparece.
        const s1 = core.replicate(true) as { pipe(x: unknown): { pipe(y: unknown): void }; destroy(): void };
        const s2 = par.replicate(false) as { pipe(x: unknown): { pipe(y: unknown): void }; destroy(): void };
        s1.pipe(s2).pipe(s1);
        if (core.length > 0) {
          await Promise.race([
            par.download({ start: 0, end: core.length }).done(),
            new Promise((r) => setTimeout(r, 5_000)),
          ]);
        }
        s1.destroy();
        s2.destroy();

        // ACHADO-G14-05 — `desynced` com o par igualmente sem os blocos "faltantes" quer
        // dizer que eles nunca existiram: o `self_high_water` foi gravado para um append que
        // não chegou a acontecer. Não houve perda, e a saída (1) de §31.13 — restauração por
        // replicação — não tem de onde restaurar.
        const desyncedSemPerdaReal = estado === 'desynced' && par.length <= core.length;
        let recusou = recusouAppend;
        if (desyncedSemPerdaReal) {
          desyncedSemPerdaTotal++;
          // Uma escrita normal, agora, com a conversa em `desynced`: o caminho de escrita
          // precisa se recusar por conta própria. É a metade de §31.13 que o cenário 5 mede
          // e que nenhum outro passo alcança.
          await core.close();
          manifesto.fechar();
          const tentativa = await rodarFilho(script, [dir, w.conversationId, 'limpo', String(repeticao)]);
          if (tentativa.fases.includes('desynced-recusou-append')) {
            recusasDeAppend++;
            recusou = true;
          }
          if (tentativa.fases.includes('appendado')) appendsAposDesynced++;
          // Só então o harness aplica a segunda saída de §31.13 — o aceite explícito de
          // perda —, que aqui não perde nada, para a rodada seguinte ter o que medir.
          const m2 = abrirManifesto(join(dir, 'manifest.db'));
          m2.gravar(w.conversationId, core.length);
          m2.fechar();
          aceitesDePerdaVazia++;
        }

        rodadas.push({
          ponto,
          repeticao,
          morreu: sinal === 'SIGKILL',
          sinal,
          codigo,
          lengthDepois: core.length,
          highWaterDepois: hw,
          estado,
          recusouAppend: recusou,
          desyncedSemPerdaReal,
          parNaHora: par.length,
          fases,
        });

        comprimentoFinal = { escritor: core.length, par: par.length };
        if (!desyncedSemPerdaReal) {
          await core.close();
          manifesto.fechar();
        }
      }
    }
    parConvergiu = comprimentoFinal.par === comprimentoFinal.escritor;
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  } finally {
    await par.close();
    rmSync(dir, { recursive: true, force: true });
  }

  const mortes = rodadas.filter((r) => r.morreu).length;
  const r: Cenario5 = {
    rodadas,
    mortes,
    forks: conflitos.length,
    ondeConflitou: [...new Set(conflitos)],
    desyncedObservado,
    recusasDeAppend,
    appendsAposDesynced,
    desyncedSemPerdaReal: desyncedSemPerdaTotal,
    aceitesDePerdaVazia,
    lengthNuncaRegrediu,
    parConvergiu,
    comprimentoFinal,
    ok:
      erro === undefined &&
      conflitos.length === 0 &&
      appendsAposDesynced === 0 &&
      lengthNuncaRegrediu &&
      parConvergiu &&
      mortes === rodadas.filter((x) => x.ponto !== 'limpo').length,
  };
  return erro === undefined ? r : { ...r, erro };
}
