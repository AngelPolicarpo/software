// §77 — a sinalização de §17.4 cujo destino é o PRÓPRIO host.
//
// Achado no teste de duas máquinas: a chamada ficava em "Conectando…" para sempre. A causa
// era estrutural e não aparecia em teste nenhum, porque nenhum exercitava a direção
// membro→host: `peerSignalRelay` procura o destino em `connections`, que é o mapa dos RPC
// servers REMOTOS. O host não abre conexão consigo mesmo, então procurá-lo ali devolve
// `null` e a sinalização morre com `E_PEER_UNREACHABLE`.
//
// Efeito: a negociação WebRTC ficava só de ida. Host→membro entregava; membro→host não. Com
// SDP precisando dos dois sentidos (oferta e resposta), nenhuma chamada fechava — e o lado
// que não recebia nada não tinha como saber a diferença entre "ninguém falou comigo" e
// "falaram e o quadro sumiu".

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { peerSignalRelay } from '../src/l3/rpcServer/media.ts';

const HOST = 'aa'.repeat(32);
const MEMBRO = 'bb'.repeat(32);

describe('§17.4 — o host como destino de sinalização', () => {
  it('sem o host no lookup, a sinalização para ele morre (o defeito)', () => {
    const conexoes = new Map<string, { notify: () => boolean }>();
    const relay = peerSignalRelay((k) => conexoes.get(k) ?? null);
    const r = relay.deliver({ sessionId: 's1', fromPeerKey: MEMBRO, toPeerKey: HOST, ticketId: 't', sdp: '{}' });
    assert.deepEqual(r, { ok: false, code: 'E_PEER_UNREACHABLE' });
  });

  it('com o host no lookup, a sinalização é entregue como evento local', () => {
    const entregues: Array<{ topic: string; corpo: Record<string, unknown> }> = [];
    const relay = peerSignalRelay((k) =>
      k === HOST
        ? {
            notify: (topic: string, body: Uint8Array) => {
              entregues.push({ topic, corpo: JSON.parse(Buffer.from(body).toString('utf8')) });
              return true;
            },
          }
        : null,
    );

    const r = relay.deliver({ sessionId: 's1', fromPeerKey: MEMBRO, toPeerKey: HOST, ticketId: 't1', sdp: '{"type":"offer"}' });

    assert.deepEqual(r, { ok: true });
    assert.equal(entregues.length, 1);
    assert.equal(entregues[0]!.topic, 'voice.signal');
    // §16.3 regra 4 — a origem é a da conexão de quem enviou, não o que o corpo afirma.
    assert.equal(entregues[0]!.corpo['peerKey'], MEMBRO);
    assert.equal(entregues[0]!.corpo['ticketId'], 't1');
    assert.equal(entregues[0]!.corpo['sdp'], '{"type":"offer"}');
  });

  it('destino que não é o host nem tem conexão continua inalcançável', () => {
    const relay = peerSignalRelay((k) => (k === HOST ? { notify: () => true } : null));
    const r = relay.deliver({ sessionId: 's1', fromPeerKey: HOST, toPeerKey: 'cc'.repeat(32), ticketId: 't', ice: '{}' });
    assert.deepEqual(r, { ok: false, code: 'E_PEER_UNREACHABLE' });
  });
});
