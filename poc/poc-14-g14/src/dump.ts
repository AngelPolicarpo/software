// O **dump ordenado com hash** que POC-14 pede como métrica: "hash de dump do estado
// projetado por nó e por ordem de entrega".
//
// A leitura precisa ser canônica — ordenada por chave, sem `Map`, sem `Set` e sem
// identidade de objeto —, senão o hash mediria a ordem de inserção no `Map` em vez do
// estado. Ele cobre as duas metades: o `DmState` do `dmFold` e as tabelas de §31.12 que o
// projetor descartável monta a partir dos `DmEffect`.

import { createHash } from 'node:crypto';

import type { DmPrimitive, DmState } from './core.js';
import type { Tabelas } from './projetor.js';

function hex(b: Buffer | undefined | null): string | null {
  return b === undefined || b === null ? null : b.toString('hex');
}

function valor(v: DmPrimitive): unknown {
  return Buffer.isBuffer(v) ? { hex: v.toString('hex') } : v;
}

/** Uma leitura estável do `DmState`, independente da ordem de inserção. */
export function retratoEstado(s: DmState): unknown {
  const lado = (o: 'lo' | 'hi'): unknown => {
    const x = s.sides[o];
    return {
      identityKey: hex(x.identityKey),
      coreKey: hex(x.coreKey),
      displayName: x.displayName,
      avatarColor: x.avatarColor,
      length: x.length,
      lastAuthorSeq: x.lastAuthorSeq,
      lastAck: x.lastAck,
      lastTs: x.lastTs,
      invalid: x.invalid,
      blobsCoreKey: hex(x.blobsCoreKey),
    };
  };
  const msgs = [...s.messages.entries()]
    .map(([id, m]) => ({
      id,
      ordSum: m.ordSum,
      author: hex(m.author),
      authorSeq: m.authorSeq,
      deletedAt: m.deletedAt ?? null,
      editedAt: m.editedAt ?? null,
      replyToId: m.replyToId ?? null,
      hasAttachment: m.hasAttachment,
      reactions: [...m.reactionEmojis].sort(),
    }))
    .sort((a, b) => a.ordSum - b.ordSum || a.id.localeCompare(b.id));
  return {
    conversationId: s.conversationId,
    interpretedOrdSum: s.interpretedOrdSum,
    dmVersionSeen: s.dmVersionSeen,
    partialInterpretation: s.partialInterpretation,
    lo: lado('lo'),
    hi: lado('hi'),
    msgs,
  };
}

/** As tabelas de §31.12 do projetor descartável, ordenadas por chave. */
export function retratoTabelas(t: Tabelas): unknown {
  const out: Record<string, unknown[]> = {};
  for (const nome of [...t.keys()].sort()) {
    const linhas = t.get(nome);
    if (linhas === undefined) continue;
    out[nome] = [...linhas.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, row]) => ({
        k,
        row: Object.fromEntries(
          Object.entries(row)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([campo, v]) => [campo, valor(v)]),
        ),
      }));
  }
  return out;
}

/** O dump completo de um nó: estado do `dmFold` mais a projeção. */
export function dump(s: DmState, t: Tabelas): string {
  return JSON.stringify({ estado: retratoEstado(s), tabelas: retratoTabelas(t) });
}

export function hashDump(s: DmState, t: Tabelas): string {
  return createHash('sha256').update(dump(s, t)).digest('hex');
}

export function hashDe(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}
