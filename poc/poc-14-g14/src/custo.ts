// O custo de interpretar um log inteiro — a métrica que POC-14 pede como "número de
// reinterpretações e o custo delas", medida no ponto que o cenário 2 não alcança: o que
// acontece quando a reinterpretação parte do **zero** e a conversa é grande.
//
// **ACHADO-G14-04.** A cópia-na-escrita do `DmDraft` (§31.7.2) é por **container**: o
// primeiro registro que toca `messages` clona o `Map` inteiro, e o que toca um lado clona a
// janela de `ts` daquele lado. Isso é O(estado) por registro, então reinterpretar `n`
// registros do zero cresce mais que linear no `n`. Não é desvio de §31.7.2 — é o preço do
// arranjo que ela escolhe, o mesmo do `fold` de §8 — e é exatamente o que o snapshot de
// `dm_ds_snapshot` (§31.13) existe para não deixar aparecer no boot.
//
// A segunda metade da medida é a janela de `ts`: ela é podada pelo `ack` do **outro** lado
// (RD-4, não decrescente), então quando o par não escreve nada a poda nunca roda e a janela
// fica do tamanho do log não reconhecido. §31.7.2 diz "do tamanho do atraso" e o atraso, aí,
// é o log inteiro — o comportamento está certo; o que o gate acrescenta é o número.

import { dmFoldRecord, dmHello, dmRecord, type DmState, type DmWorld } from './core.js';

export type Amostra = {
  /** Registros interpretados nesta amostra. */
  readonly registros: number;
  readonly ms: number;
  readonly msPorRegistro: number;
  readonly mensagensNoEstado: number;
  readonly janelaLo: number;
  readonly janelaHi: number;
};

export type CustoDeReinterpretacao = {
  /** Conversa viva: os dois lados escrevem e reconhecem um ao outro. */
  readonly comAckDoPar: readonly Amostra[];
  /** Um lado só: o par nunca escreve, então nunca reconhece. */
  readonly semAckDoPar: readonly Amostra[];
  /** ms/registro do maior sobre o do menor. Linear ≈ 1; acima disso a curva é super-linear. */
  readonly fatorComAck: number;
  readonly fatorSemAck: number;
  readonly crescimentoDoLog: number;
  readonly superLinear: boolean;
  readonly janelaCresceSemAck: boolean;
  readonly janelaLimitadaComAck: boolean;
};

function abrir(w: DmWorld): DmState {
  let s = w.state();
  s = dmFoldRecord(s, dmHello(w, w.lo), 'lo', 0, w.ctx).next;
  s = dmFoldRecord(s, dmHello(w, w.hi), 'hi', 0, w.ctx).next;
  return s;
}

/** `n` mensagens de `lo`; se `comAck`, `hi` responde a cada uma e reconhece o que leu. */
function medir(w: DmWorld, n: number, comAck: boolean): Amostra {
  let s = abrir(w);
  let iLo = 1;
  let iHi = 1;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) {
    s = dmFoldRecord(
      s,
      dmRecord(w, w.lo, { kind: 'dm.message', authorSeq: iLo + 1, ack: comAck ? iHi : 1, payload: { content: `m${i}` } } as never),
      'lo',
      iLo,
      w.ctx,
    ).next;
    iLo++;
    if (comAck) {
      s = dmFoldRecord(
        s,
        dmRecord(w, w.hi, { kind: 'dm.message', authorSeq: iHi + 1, ack: iLo, payload: { content: `r${i}` } } as never),
        'hi',
        iHi,
        w.ctx,
      ).next;
      iHi++;
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const registros = comAck ? n * 2 : n;
  return {
    registros,
    ms: Math.round(ms * 100) / 100,
    msPorRegistro: Math.round((ms / registros) * 10000) / 10000,
    mensagensNoEstado: s.messages.size,
    janelaLo: s.sides.lo.tsWindow.length,
    janelaHi: s.sides.hi.tsWindow.length,
  };
}

export function custoDeReinterpretacao(w: DmWorld, tamanhos: readonly number[]): CustoDeReinterpretacao {
  const comAckDoPar = tamanhos.map((n) => medir(w, n, true));
  const semAckDoPar = tamanhos.map((n) => medir(w, n, false));
  const fator = (xs: readonly Amostra[]): number => {
    const a = xs[0];
    const b = xs.at(-1);
    if (a === undefined || b === undefined || a.msPorRegistro === 0) return 0;
    return Math.round((b.msPorRegistro / a.msPorRegistro) * 100) / 100;
  };
  const primeiro = tamanhos[0] ?? 1;
  const ultimo = tamanhos.at(-1) ?? 1;
  const crescimentoDoLog = Math.round((ultimo / primeiro) * 100) / 100;
  const ultimoSem = semAckDoPar.at(-1);
  const fatorComAck = fator(comAckDoPar);
  return {
    comAckDoPar,
    semAckDoPar,
    fatorComAck,
    fatorSemAck: fator(semAckDoPar),
    crescimentoDoLog,
    // Linear seria ms/registro constante. Uma folga de 20 % absorve ruído de medição.
    superLinear: fatorComAck > 1.2,
    janelaCresceSemAck: ultimoSem !== undefined && ultimoSem.janelaLo >= ultimoSem.registros - 1,
    janelaLimitadaComAck: comAckDoPar.every((a) => a.janelaLo <= 8 && a.janelaHi <= 8),
  };
}
