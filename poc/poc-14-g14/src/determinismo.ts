// Cenários 1 e 2 de POC-14 — o critério 1 de §31.26.
//
//   (1) a mesma dupla de logs entregue em ordens diferentes;
//   (2) inserção retroativa forçando a reinterpretação de §31.13 a partir de snapshot.
//
// A propriedade sob teste é estrutural: `ordKey(r)` é função só do próprio registro e da sua
// posição no próprio log, então a ordem de **entrega** não é entrada da função — a entrada é
// o par de logs. O gate mede isso pelo hash do dump, não pela igualdade de objetos.

import { hashDump, hashDe } from './dump.js';
import { No } from './projetor.js';
import { rng } from './fuzzer.js';
import { construirPar, type Par } from './roteiro.js';
import { mergeRecords, type DmOrigin, type DmWorld } from './core.js';

/** Uma ordem de entrega: quantos blocos de cada lado chegam, e em que sequência. */
export type Entrega = readonly DmOrigin[];

/**
 * As entregas possíveis são as intercalações dos dois logs **em ordem de índice** — um core
 * entrega o próprio log crescendo, e é o que a replicação faz. Aqui se sorteia `quantas`
 * delas, sempre incluindo as duas degeneradas (todo `lo` antes, todo `hi` antes).
 */
export function entregas(nLo: number, nHi: number, quantas: number, semente: number): Entrega[] {
  const todoLo: DmOrigin[] = [...Array(nLo).fill('lo'), ...Array(nHi).fill('hi')] as DmOrigin[];
  const todoHi: DmOrigin[] = [...Array(nHi).fill('hi'), ...Array(nLo).fill('lo')] as DmOrigin[];
  const alternado: DmOrigin[] = [];
  for (let i = 0; i < Math.max(nLo, nHi); i++) {
    if (i < nLo) alternado.push('lo');
    if (i < nHi) alternado.push('hi');
  }
  const out: Entrega[] = [todoLo, todoHi, alternado];
  const next = rng(semente);
  while (out.length < quantas) {
    const seq: DmOrigin[] = [];
    let a = nLo;
    let b = nHi;
    while (a > 0 || b > 0) {
      const escolheLo = b === 0 || (a > 0 && next() % 2 === 0);
      if (escolheLo) {
        seq.push('lo');
        a--;
      } else {
        seq.push('hi');
        b--;
      }
    }
    out.push(seq);
  }
  return out;
}

export type ResultadoNo = {
  readonly entrega: string;
  readonly hash: string;
  readonly interpretedOrdSum: number;
  readonly reinterpretacoes: number;
  readonly registrosReinterpretados: number;
  readonly msReinterpretando: number;
  readonly snapshotsDescartados: number;
  readonly eventosReordered: number;
};

/** Interpreta o par entregando bloco a bloco na ordem dada. */
export function rodarEntrega(w: DmWorld, par: Par, entrega: Entrega, snapshotEvery: number): { no: No; resultado: ResultadoNo } {
  const no = new No({ ctx: w.ctx, snapshotEvery });
  let i = 0;
  let j = 0;
  for (const o of entrega) {
    if (o === 'lo') {
      const rec = par.lo[i++];
      if (rec !== undefined) no.entregar({ lo: [rec] });
    } else {
      const rec = par.hi[j++];
      if (rec !== undefined) no.entregar({ hi: [rec] });
    }
  }
  const custo = no.reinterpretacoes;
  return {
    no,
    resultado: {
      entrega: `${entrega.filter((x) => x === 'lo').length}lo+${entrega.filter((x) => x === 'hi').length}hi:${hashDe(entrega.join('')).slice(0, 12)}`,
      hash: hashDump(no.state, no.tabelas),
      interpretedOrdSum: no.state.interpretedOrdSum,
      reinterpretacoes: custo.length,
      registrosReinterpretados: custo.reduce((a, c) => a + c.registrosReinterpretados, 0),
      msReinterpretando: Math.round(custo.reduce((a, c) => a + c.ms, 0) * 1000) / 1000,
      snapshotsDescartados: custo.reduce((a, c) => a + c.snapshotsDescartados, 0),
      eventosReordered: no.eventos.filter((e) => e.topic === 'dm.reordered').length,
    },
  };
}

export type Cenario1 = {
  readonly logs: { lo: number; hi: number };
  readonly aplicados: number;
  readonly recusados: number;
  readonly ordensDeEntrega: number;
  readonly hashUnico: boolean;
  readonly hashes: readonly string[];
  readonly hashReferencia: string;
  readonly ordSumPorRegistro: readonly { origin: string; index: number; ordSum: number }[];
  readonly ordSumEstavel: boolean;
  readonly nos: readonly ResultadoNo[];
  readonly ok: boolean;
};

/**
 * Cenário 1 — a mesma dupla de logs, entregue em `quantas` ordens diferentes, mais um
 * segundo "nó" que interpreta os dois logs prontos de uma vez. Todos precisam produzir o
 * mesmo hash de dump.
 */
export function cenario1(w: DmWorld, quantas: number, semente: number): Cenario1 {
  const construido = construirPar(w);
  const par = construido.par;
  const ordens = entregas(par.lo.length, par.hi.length, quantas, semente);

  const nos = ordens.map((e) => rodarEntrega(w, par, e, 4).resultado);
  // O nó que recebeu os dois logs prontos — sem snapshot e sem reinterpretação nenhuma.
  const deUmaVez = rodarEntrega(w, par, [...Array(par.lo.length).fill('lo'), ...Array(par.hi.length).fill('hi')] as DmOrigin[], 0);
  const referencia = hashDump(deUmaVez.no.state, deUmaVez.no.tabelas);

  const hashes = [...new Set([referencia, ...nos.map((n) => n.hash)])];
  const ordem = mergeRecords(par.lo, par.hi);

  // Um registro NUNCA muda de chave: o `ordSum` de cada `(origin, index)` precisa ser o
  // mesmo em todo prefixo do par.
  let ordSumEstavel = true;
  for (let corte = 0; corte <= par.lo.length; corte++) {
    for (const r of mergeRecords(par.lo.slice(0, corte), par.hi)) {
      const igual = ordem.find((x) => x.origin === r.origin && x.index === r.index);
      if (igual === undefined || igual.ordSum !== r.ordSum) ordSumEstavel = false;
    }
  }

  const hashUnico = hashes.length === 1;
  return {
    logs: { lo: par.lo.length, hi: par.hi.length },
    aplicados: construido.aplicados,
    recusados: construido.recusados,
    ordensDeEntrega: ordens.length,
    hashUnico,
    hashes,
    hashReferencia: referencia,
    ordSumPorRegistro: ordem.map((r) => ({ origin: r.origin, index: r.index, ordSum: r.ordSum })),
    ordSumEstavel,
    nos,
    ok: hashUnico && ordSumEstavel,
  };
}

export type Cenario2 = {
  readonly hashReferencia: string;
  /** (a) o log do par chega inteiro depois: o ponto de inserção é o começo da conversa. */
  readonly doComeco: { hash: string; partiuDe: readonly string[]; registros: number; ms: number };
  /** (b) o log do par chega em duas partes: o ponto de inserção cai no MEIO da história. */
  readonly doMeio: { hash: string; partiuDe: readonly string[]; registros: number; snapshotsDescartados: number; ms: number };
  readonly hashPorSnapshotEvery: readonly {
    snapshotEvery: number;
    hashDoComeco: string;
    hashDoMeio: string;
    reinterpretacoes: number;
    registros: number;
    ms: number;
    partiuDe: readonly string[];
  }[];
  readonly convergiu: boolean;
  readonly partiuDeSnapshot: boolean;
  readonly emitiuReordered: boolean;
  readonly buildIdErradoDescartaSnapshot: boolean;
  readonly custo: readonly { fromOrdSum: number; partiuDe: string; registrosReinterpretados: number; snapshotsDescartados: number; ms: number }[];
  readonly ok: boolean;
};

/**
 * Cenário 2 — inserção retroativa.
 *
 * Duas formas, e as duas importam. Em **(a)** o log de `hi` chega inteiro depois do de `lo`:
 * o menor `ordSum` que chega é o da gênese de `hi`, o ponto de inserção é o começo da
 * conversa, e não existe snapshot anterior a ele — a reinterpretação parte do zero, e é o
 * comportamento correto, não uma falha. Em **(b)** o nó já tem um prefixo dos dois logs e o
 * resto de `hi` chega depois: o ponto de inserção cai no meio, e é aí que §31.13 manda
 * recarregar *o snapshot mais recente anterior ou igual* — o caso que decide se o snapshot
 * de `dm_ds_snapshot` serve para alguma coisa.
 */
export function cenario2(w: DmWorld, cadencias: readonly number[]): Cenario2 {
  const { par } = construirPar(w);
  const meio = Math.max(1, Math.floor(par.hi.length / 2));

  const referencia = new No({ ctx: w.ctx, snapshotEvery: 0 });
  referencia.entregar({ lo: par.lo, hi: par.hi });
  const hashReferencia = hashDump(referencia.state, referencia.tabelas);

  const rodarDoComeco = (cadencia: number): No => {
    const no = new No({ ctx: w.ctx, snapshotEvery: cadencia });
    no.entregar({ lo: par.lo });
    no.entregar({ hi: par.hi });
    return no;
  };

  const rodarDoMeio = (cadencia: number): No => {
    const no = new No({ ctx: w.ctx, snapshotEvery: cadencia });
    // O nó já conhece os dois lados até um ponto…
    no.entregar({ lo: par.lo.slice(0, 2), hi: par.hi.slice(0, meio) });
    // …e o resto de `lo` empurra a interpretação bem à frente…
    no.entregar({ lo: par.lo.slice(2) });
    // …e só então o resto de `hi` chega, com `ordSum` abaixo da cabeça corrente.
    no.entregar({ hi: par.hi.slice(meio) });
    return no;
  };

  const soma = (no: No): { registros: number; ms: number; descartados: number; partiuDe: string[] } => ({
    registros: no.reinterpretacoes.reduce((a, c) => a + c.registrosReinterpretados, 0),
    ms: Math.round(no.reinterpretacoes.reduce((a, c) => a + c.ms, 0) * 1000) / 1000,
    descartados: no.reinterpretacoes.reduce((a, c) => a + c.snapshotsDescartados, 0),
    partiuDe: no.reinterpretacoes.map((c) => c.partiuDe),
  });

  const linhas: Cenario2['hashPorSnapshotEvery'] = cadencias.map((cadencia) => {
    const a = rodarDoComeco(cadencia);
    const b = rodarDoMeio(cadencia);
    const sa = soma(a);
    const sb = soma(b);
    return {
      snapshotEvery: cadencia,
      hashDoComeco: hashDump(a.state, a.tabelas),
      hashDoMeio: hashDump(b.state, b.tabelas),
      reinterpretacoes: a.reinterpretacoes.length + b.reinterpretacoes.length,
      registros: sa.registros + sb.registros,
      ms: Math.round((sa.ms + sb.ms) * 1000) / 1000,
      partiuDe: [...new Set([...sa.partiuDe, ...sb.partiuDe])],
    };
  });

  const comeco = rodarDoComeco(3);
  const doMeioNo = rodarDoMeio(3);
  const sComeco = soma(comeco);
  const sMeio = soma(doMeioNo);
  const doComeco = {
    hash: hashDump(comeco.state, comeco.tabelas),
    partiuDe: sComeco.partiuDe,
    registros: sComeco.registros,
    ms: sComeco.ms,
  };
  const doMeio = {
    hash: hashDump(doMeioNo.state, doMeioNo.tabelas),
    partiuDe: sMeio.partiuDe,
    registros: sMeio.registros,
    snapshotsDescartados: sMeio.descartados,
    ms: sMeio.ms,
  };

  // §10.6 — um snapshot cuja procedência não bate é descartado e o `dmFold` recomeça do zero.
  const outroBuild = new No({ ctx: w.ctx, snapshotEvery: 3, foldBuildId: 'build-A' });
  outroBuild.entregar({ lo: par.lo.slice(0, 2), hi: par.hi.slice(0, meio) });
  outroBuild.entregar({ lo: par.lo.slice(2) });
  // Todo snapshot passa a declarar outra procedência — §10.6: nenhum deles serve mais.
  outroBuild.snapshots = outroBuild.snapshots.map((s) => ({ ...s, foldBuildId: 'build-B' }));
  const antesDaTroca = outroBuild.reinterpretacoes.length;
  outroBuild.entregar({ hi: par.hi.slice(meio) });
  const depoisDaTroca = outroBuild.reinterpretacoes.slice(antesDaTroca);
  const buildIdErradoDescartaSnapshot =
    depoisDaTroca.length > 0 &&
    depoisDaTroca.every((c) => c.partiuDe === 'zero') &&
    hashDump(outroBuild.state, outroBuild.tabelas) === hashReferencia;

  const convergiu =
    linhas.every((l) => l.hashDoComeco === hashReferencia && l.hashDoMeio === hashReferencia) &&
    doComeco.hash === hashReferencia &&
    doMeio.hash === hashReferencia;
  const partiuDeSnapshot = doMeio.partiuDe.includes('snapshot');
  const emitiuReordered =
    comeco.eventos.some((e) => e.topic === 'dm.reordered') && doMeioNo.eventos.some((e) => e.topic === 'dm.reordered');

  return {
    hashReferencia,
    doComeco,
    doMeio,
    hashPorSnapshotEvery: linhas,
    convergiu,
    partiuDeSnapshot,
    emitiuReordered,
    buildIdErradoDescartaSnapshot,
    custo: [...comeco.reinterpretacoes, ...doMeioNo.reinterpretacoes].map((c) => ({
      fromOrdSum: c.fromOrdSum,
      partiuDe: c.partiuDe,
      registrosReinterpretados: c.registrosReinterpretados,
      snapshotsDescartados: c.snapshotsDescartados,
      ms: Math.round(c.ms * 1000) / 1000,
    })),
    ok: convergiu && partiuDeSnapshot && emitiuReordered && buildIdErradoDescartaSnapshot,
  };
}
