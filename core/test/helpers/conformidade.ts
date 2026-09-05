/**
 * Auxiliares da varredura de conformidade do domínio puro.
 *
 * Só reexporta o que o teste precisa e conta quantos registros o `fold` interpretou — o `fold`
 * injetável de §10.6 é o único jeito de distinguir "boot que herdou snapshot" de "boot que
 * reprojetou": os dois terminam no mesmo `interpretedSeq`, e foi por isso que o defeito de
 * `loadSnapshot` sobreviveu a um teste que só olhava esse número.
 */

import { foldRecord } from '../../src/l1/fold/index.ts';

export { loadSnapshot, saveSnapshot } from '../../src/l1/projector/index.ts';

export function makeProjectorFold(): {
  fold: typeof foldRecord;
  contagem: { n: number };
} {
  const contagem = { n: 0 };
  const fold: typeof foldRecord = (prev, rec, seq, metrics) => {
    contagem.n++;
    return foldRecord(prev, rec, seq, metrics);
  };
  return { fold, contagem };
}
