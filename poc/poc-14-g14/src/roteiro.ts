// O par de logs que os cenários 1, 2 e 3 medem.
//
// Ele é construído com o cabo de escrita do núcleo e **interpretado enquanto é construído**,
// porque `dm.edit`, `dm.delete` e `dm.react` referenciam `messageId` — que é `dmEntityId`, e
// só existe depois de o `dmFold` aplicar a mensagem. É a mesma ordem que o produto tem: quem
// responde já interpretou o que responde.
//
// O roteiro cobre de propósito o que §31.6 declara e o que L-27 admite: escrita concorrente
// (os dois lados com `ack` baixo), `ack` mentiroso (`ackAhead`), `ts` retroativo
// (`clockSkewed` e o clamp de RD-5), referência quebrada, e registros hostis **dentro** do
// log — um par pode appendar o que quiser no próprio core.

import {
  DM_T0,
  dmFoldRecord,
  dmHello,
  dmRecord,
  emptyDmState,
  type DmOrigin,
  type DmSide,
  type DmState,
  type DmWorld,
} from './core.js';

export type Par = { lo: Buffer[]; hi: Buffer[] };

type Passo =
  | { t: 'msg'; o: DmOrigin; ack: number; texto: string; ts?: number; responde?: number }
  | { t: 'edit'; o: DmOrigin; ack: number; alvo: number; texto: string }
  | { t: 'delete'; o: DmOrigin; ack: number; alvo: number }
  | { t: 'react'; o: DmOrigin; ack: number; alvo: number; emoji: string; present: boolean }
  | { t: 'profile'; o: DmOrigin; ack: number; nome: string }
  | { t: 'hostil'; o: DmOrigin; ack: number; forma: 'lixo' | 'outra-conversa' | 'kind-desconhecido' | 'sig-corrompida' };

/**
 * O roteiro canônico do gate. `alvo` é o índice na lista de mensagens **aplicadas** até
 * aquele ponto (0 = a primeira que entrou).
 */
const ROTEIRO: readonly Passo[] = [
  { t: 'msg', o: 'lo', ack: 1, texto: 'oi' },
  { t: 'msg', o: 'hi', ack: 2, texto: 'oi de volta', responde: 0 },
  { t: 'msg', o: 'lo', ack: 2, texto: 'concorrente A' },
  // Escrita concorrente: `hi` escreve sem ter visto o anterior de `lo` (ack baixo).
  { t: 'msg', o: 'hi', ack: 2, texto: 'concorrente B' },
  { t: 'react', o: 'hi', ack: 3, alvo: 0, emoji: '👍', present: true },
  { t: 'edit', o: 'lo', ack: 3, alvo: 0, texto: 'oi (editado)' },
  { t: 'profile', o: 'hi', ack: 4, nome: 'hi renomeada' },
  // `ack` mentiroso — L-27: o par não escreveu tanto assim.
  { t: 'msg', o: 'lo', ack: 900, texto: 'ack adiante' },
  { t: 'hostil', o: 'hi', ack: 4, forma: 'outra-conversa' },
  { t: 'msg', o: 'hi', ack: 5, texto: 'depois do intruso' },
  // `ts` retroativo: RD-5 clampa dentro do log; `clockSkewed` sai da comparação causal.
  { t: 'msg', o: 'lo', ack: 900, texto: 'relógio para trás', ts: DM_T0 - 60_000 },
  { t: 'hostil', o: 'lo', ack: 900, forma: 'lixo' },
  { t: 'react', o: 'lo', ack: 900, alvo: 1, emoji: '🎉', present: true },
  { t: 'react', o: 'lo', ack: 900, alvo: 1, emoji: '🎉', present: false },
  { t: 'delete', o: 'hi', ack: 6, alvo: 3 },
  { t: 'hostil', o: 'hi', ack: 6, forma: 'kind-desconhecido' },
  { t: 'msg', o: 'hi', ack: 7, texto: 'última de hi' },
  { t: 'hostil', o: 'lo', ack: 900, forma: 'sig-corrompida' },
  { t: 'msg', o: 'lo', ack: 8, texto: 'última de lo', responde: 4 },
];

export type ParConstruido = {
  readonly par: Par;
  /** Os `messageId` na ordem em que o `dmFold` os aplicou. */
  readonly messageIds: readonly string[];
  readonly aplicados: number;
  readonly recusados: number;
};

/**
 * Constrói o par de logs. O `DmState` usado aqui é só para descobrir os `messageId`; o que
 * o gate mede é a interpretação dos logs **prontos**, feita depois pelos nós.
 */
export function construirPar(w: DmWorld, roteiro: readonly Passo[] = ROTEIRO): ParConstruido {
  const par: Par = { lo: [], hi: [] };
  const messageIds: string[] = [];
  let s: DmState = emptyDmState(w.conversationKey, w.ctx.loKey, w.ctx.hiKey, w.conversationId);
  let aplicados = 0;
  let recusados = 0;

  const empurrar = (o: DmOrigin, rec: Buffer): void => {
    const index = par[o].length;
    par[o].push(rec);
    const r = dmFoldRecord(s, rec, o, index, w.ctx);
    s = r.next;
    if (r.decision === 'APPLIED') {
      aplicados++;
      if (typeof r.messageId === 'string') messageIds.push(r.messageId);
    } else {
      recusados++;
    }
  };

  const lado = (o: DmOrigin): DmSide => (o === 'lo' ? w.lo : w.hi);
  const seq = (o: DmOrigin): number => par[o].length + 1;

  empurrar('lo', dmHello(w, w.lo));
  empurrar('hi', dmHello(w, w.hi));

  for (const p of roteiro) {
    const o = p.o;
    const comum = { authorSeq: seq(o), ack: p.ack };
    switch (p.t) {
      case 'msg': {
        const payload: Record<string, unknown> = { content: p.texto };
        if (p.responde !== undefined) {
          const alvo = messageIds[p.responde];
          if (alvo !== undefined) payload['replyToId'] = alvo;
        }
        const opts: Record<string, unknown> = { kind: 'dm.message', ...comum, payload };
        if (p.ts !== undefined) opts['ts'] = p.ts;
        empurrar(o, dmRecord(w, lado(o), opts as never));
        break;
      }
      case 'edit':
        empurrar(o, dmRecord(w, lado(o), { kind: 'dm.edit', ...comum, payload: { messageId: messageIds[p.alvo] ?? 'dmsg-ausente', content: p.texto } } as never));
        break;
      case 'delete':
        empurrar(o, dmRecord(w, lado(o), { kind: 'dm.delete', ...comum, payload: { messageId: messageIds[p.alvo] ?? 'dmsg-ausente' } } as never));
        break;
      case 'react':
        empurrar(o, dmRecord(w, lado(o), { kind: 'dm.react', ...comum, payload: { messageId: messageIds[p.alvo] ?? 'dmsg-ausente', emoji: p.emoji, present: p.present } } as never));
        break;
      case 'profile':
        empurrar(o, dmRecord(w, lado(o), { kind: 'dm.profile', ...comum, payload: { displayName: p.nome, avatarColor: 3 } } as never));
        break;
      default: {
        if (p.forma === 'lixo') {
          empurrar(o, Buffer.from([0xff, 0x00, 0x13, 0x37]));
          break;
        }
        const base = { kind: 'dm.message', ...comum, payload: { content: 'intruso' } };
        if (p.forma === 'outra-conversa') {
          empurrar(o, dmRecord(w, lado(o), { ...base, conversationKey: Buffer.alloc(32, 0x5a) } as never));
        } else if (p.forma === 'kind-desconhecido') {
          empurrar(o, dmRecord(w, lado(o), { ...base, kindNumber: 4242 } as never));
        } else {
          empurrar(o, dmRecord(w, lado(o), { ...base, corruptSig: true } as never));
        }
      }
    }
  }

  return { par, messageIds, aplicados, recusados };
}
