// A ordem canônica de §31.6 — o merge determinístico.
//
// **Relógio vetorial de duas posições.** As coordenadas são fixas — `(posição no log de lo,
// posição no log de hi)`, com `lo`/`hi` os de §31.2 —, então a definição não depende de quem
// está lendo:
//
//     r do log de lo, no índice i  →  V(r) = ( i + 1 , r.ack )
//     r do log de hi, no índice j  →  V(r) = ( r.ack , j + 1 )
//
//     ordSum(r) = V(r).lo + V(r).hi                    // = índice + 1 + ack, nos dois lados
//     ordKey(r) = ( ordSum(r) , authorKey(r) )         // desempate por chave, byte ascendente
//
// **Regra normativa:** a ordem canônica de uma conversa é `ordKey` ascendente. Nenhum outro
// critério é canônico. `ts` é exibição; o índice no core é armazenamento.
//
// **Por que isto é um merge de dois ponteiros e não uma ordenação.** Por RD-4 o `ack` é não
// decrescente ao longo do log de quem escreve, e o índice cresce de 1 em 1; logo `ordSum` é
// **estritamente crescente** dentro de cada log. Se uma implementação precisar reordenar,
// alguma invariante quebrou.
//
// **Registros concorrentes** — os que nenhum dos dois havia visto quando o outro escreveu —
// empatam ou se aproximam em `ordSum` e são desempatados pela chave do autor. O desempate é
// arbitrário de propósito: qualquer critério que dependesse de relógio faria a ordem depender
// do ambiente, contra §1.5.

import { peekDmHeader } from '../dmCodec/index.ts';

import type { DmOrigin } from './state.ts';

/** `ordSum(r) = índice + 1 + ack`, com o `ack` já clampado por RD-4. */
export function ordSumOf(index: number, ackClamped: number): number {
  return index + 1 + ackClamped;
}

/**
 * RD-4 — `ack` é **clampado** para o valor anterior quando decresceria. Clamp determinístico,
 * não recusa: é o que preserva a monotonicidade de `ordSum` de que §31.6 depende.
 *
 * Um registro cujo cabeçalho não decodifica não tem `ack`; ele herda o anterior, pela mesma
 * regra, e é isso que mantém o planejador do merge e o `dmFold` de acordo sobre o `ordSum`
 * de um registro que o pipeline vai `IGNORED`.
 */
export function clampAck(raw: number | null, lastAck: number): number {
  if (raw === null || raw < lastAck) return lastAck;
  return raw;
}

/** Uma posição na ordem canônica. */
export type DmOrdRef = {
  readonly origin: DmOrigin;
  readonly index: number;
  readonly ordSum: number;
};

/**
 * `ordKey` ascendente: `ordSum`, e depois a chave do autor byte a byte.
 *
 * O autor de um registro é o dono do core de origem — o estágio 3 de §31.7.3 recusa qualquer
 * outra coisa —, então o desempate é por `loKey`/`hiKey`, sem depender de o registro
 * decodificar. `lo < hi` por construção (§31.2), logo `lo` vence todo empate.
 */
export function compareOrdKey(a: DmOrdRef, b: DmOrdRef): number {
  if (a.ordSum !== b.ordSum) return a.ordSum - b.ordSum;
  if (a.origin === b.origin) return a.index - b.index;
  return a.origin === 'lo' ? -1 : 1;
}

/**
 * A intercalação canônica dos dois logs, dada a lista de `ack` **crus** de cada lado (`null`
 * onde o cabeçalho não decodifica). O clamp de RD-4 é aplicado aqui, uma vez, para os dois
 * lados.
 *
 * É um merge de dois ponteiros: cada lista já está ordenada por `ordSum` estritamente
 * crescente, e o desempate entre as duas é a chave do autor.
 */
export function mergeOrder(
  loAcks: readonly (number | null)[],
  hiAcks: readonly (number | null)[],
): DmOrdRef[] {
  const seq = (acks: readonly (number | null)[], origin: DmOrigin): DmOrdRef[] => {
    const out: DmOrdRef[] = [];
    let last = 0;
    acks.forEach((raw, index) => {
      last = clampAck(raw, last);
      out.push({ origin, index, ordSum: ordSumOf(index, last) });
    });
    return out;
  };

  const lo = seq(loAcks, 'lo');
  const hi = seq(hiAcks, 'hi');

  const out: DmOrdRef[] = [];
  let i = 0;
  let j = 0;
  while (i < lo.length && j < hi.length) {
    const a = lo[i];
    const b = hi[j];
    if (a === undefined || b === undefined) break;
    if (compareOrdKey(a, b) <= 0) {
      out.push(a);
      i++;
    } else {
      out.push(b);
      j++;
    }
  }
  while (i < lo.length) {
    const a = lo[i];
    if (a !== undefined) out.push(a);
    i++;
  }
  while (j < hi.length) {
    const b = hi[j];
    if (b !== undefined) out.push(b);
    j++;
  }
  return out;
}

/**
 * Os `ack` crus de um log, lidos **só do cabeçalho em claro**. É isto que o cabeçalho em
 * claro de §31.4 compra: a ordem é computável sem a chave de conteúdo, sem abrir a AEAD e sem
 * um Ed25519 por registro.
 */
export function acksOf(records: readonly Uint8Array[]): (number | null)[] {
  return records.map((r) => peekDmHeader(r)?.ack ?? null);
}

/** A ordem canônica dos dois logs, a partir dos bytes. */
export function mergeRecords(
  loRecords: readonly Uint8Array[],
  hiRecords: readonly Uint8Array[],
): DmOrdRef[] {
  return mergeOrder(acksOf(loRecords), acksOf(hiRecords));
}
