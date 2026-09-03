// §31.15 — mídia numa conversa direta. B62 / §109.
//
// O que este arquivo mede é a **tabela de remoções**: cada caso nomeia a peça de §17 que
// §31.15 tira e afirma que a propriedade sobrevive sem ela. Dois nós reais, com Noise de
// verdade e a superfície IPC-R do produto — a mesma montagem de `dm-ipc.test.ts`, e pela
// mesma razão: "a sinalização chegou ao outro lado" não é afirmável com cabo de mentira.
//
// **A mídia não entra aqui, e não deveria.** §17.2 vale sem alteração: WebRTC é do renderer,
// e o núcleo nunca vê mídia. O que o núcleo faz numa DM é o que este arquivo cobre — levar
// SDP/ICE pelo cabo autenticado, dizer que o outro está na chamada, e servir o STUN/TURN de
// §17.3 pelos dois lados. A evidência de duas pontas com mídia real é o smoke de §98.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dmTurnSecretFrom, hostTurnSecretFrom } from '../src/l0/corestore/index.ts';
import { issueTurnCredential, turnCredentialPassword } from '../src/l2/communityHost/stunTurn.ts';
import { criarDmCall, type DmMediaPort } from '../src/composition/dmCall.ts';
import type { DmOfertaDeMidia } from '../src/composition/dm.ts';

// ─── §31.3 / §5.2 — `ns/dmturn/1` ──────────────────────────────────────────────────────

describe('§31.15/§5.2 — `dmTurnSecret` é o irmão de `hostTurnSecret`, por conversa', () => {
  const dataKey = Buffer.alloc(32, 7);
  const conversa = 'a'.repeat(64);
  const outra = 'b'.repeat(64);

  it('é determinístico: o mesmo par (dataKey, conversationId) dá o mesmo segredo', () => {
    assert.deepEqual(dmTurnSecretFrom(dataKey, conversa), dmTurnSecretFrom(dataKey, conversa));
  });

  it('é POR CONVERSA — sem isso, a credencial que emito a um par valeria contra o serviço que presto a outro', () => {
    assert.notDeepEqual(dmTurnSecretFrom(dataKey, conversa), dmTurnSecretFrom(dataKey, outra));
  });

  it('é POR INSTALAÇÃO — o serviço é simétrico, e cada lado assina com a própria `dataKey`', () => {
    assert.notDeepEqual(dmTurnSecretFrom(dataKey, conversa), dmTurnSecretFrom(Buffer.alloc(32, 8), conversa));
  });

  it('é DIFERENTE do `hostTurnSecret` de mesmo id — os prefixos de §5.2 é que os separam', () => {
    assert.notDeepEqual(dmTurnSecretFrom(dataKey, conversa), hostTurnSecretFrom(dataKey, conversa));
  });

  it('a credencial em si é a de §17.3 sem alteração: mesmo `turn-cred/1`, mesmo `username`', () => {
    const segredo = dmTurnSecretFrom(dataKey, conversa);
    const par = Buffer.alloc(32, 3);
    const expira = 1_700_000_000_000;
    const cred = issueTurnCredential(segredo, conversa, par, expira);
    assert.equal(cred.username, `${conversa}:${expira}`);
    assert.equal(cred.password, turnCredentialPassword(segredo, conversa, par, expira));
  });
});

// ─── O coordenador de chamada, sem rede ────────────────────────────────────────────────

type Anuncio = { conversationId: string; on: boolean; oferta?: DmOfertaDeMidia };

function rig(opts: { comMidia: boolean }) {
  const anuncios: Anuncio[] = [];
  const sinais: Array<{ conversationId: string; sdp?: string; ice?: string }> = [];
  const eventos: Array<{ topic: string; data: Record<string, unknown> }> = [];
  const registrados = new Map<string, Buffer>();
  const ofertas = new Map<string, DmOfertaDeMidia>();
  const peerKey = Buffer.alloc(32, 42);
  const conversa = 'c'.repeat(64);

  const midia: DmMediaPort = {
    // §17.2/§99.13 — o do host (aqui, o deste nó) sem marca; o de terceiro com ela.
    iceServers: () => [{ urls: 'stun:1.2.3.4:9000' }, { urls: 'turn:1.2.3.4:9000?transport=udp' }, { urls: 'stun:externo:3478', terceiro: true }],
    registrar: (c) => registrados.set(c.communityId, c.turnSecret),
    esquecer: (id) => void registrados.delete(id),
  };

  const call = criarDmCall({
    transport: {
      sinalizar: (conversationId, a) => {
        sinais.push({ conversationId, ...a });
        return { ok: true };
      },
      anunciarChamada: (conversationId, on, oferta) => {
        anuncios.push({ conversationId, on, ...(oferta !== undefined ? { oferta } : {}) });
        return { ok: true };
      },
      ofertaDoPar: (id) => ofertas.get(id) ?? null,
    },
    identity: () => ({ publicKey: Buffer.alloc(32, 1) }),
    dataKey: Buffer.alloc(32, 5),
    peerKeyOf: (id) => (id === conversa ? peerKey : null),
    midia: () => (opts.comMidia ? midia : null),
    onEvent: (topic, data) => eventos.push({ topic, data: { ...data } }),
    now: () => 1_000,
  });

  return { call, anuncios, sinais, eventos, registrados, ofertas, conversa, peerKey, midia };
}

describe('§31.15 — a tabela de remoções, uma linha por caso', () => {
  it('Roster: `dm.callJoin` responde `peerOnCall`, e não uma lista — numa dupla o roster é a conversa', () => {
    const r = rig({ comMidia: true });
    const j = r.call.join(r.conversa);
    assert.equal(j.ok, true);
    assert.ok(j.ok);
    assert.equal(j.sessionId, r.conversa, 'o escopo do serviço é a conversa, não um id de sessão de host');
    assert.equal(j.peerKey, r.peerKey.toString('hex'));
    assert.equal(j.peerOnCall, false, 'ninguém do outro lado ainda — e chamar antes de o outro atender é o caso normal');
    assert.equal('roster' in j, false);
    assert.equal('tickets' in j, false, 'Ticket de mídia (§17.4): NÃO REUTILIZADO');
  });

  it('Ticket: `dm.signal` não tem `ticketId` nem `toPeerKey`, e a sinalização sai pelo próprio cabo', () => {
    const r = rig({ comMidia: false });
    r.call.join(r.conversa);
    assert.deepEqual(r.call.signal(r.conversa, { sdp: 'v=0' }), { ok: true });
    assert.deepEqual(r.sinais, [{ conversationId: r.conversa, sdp: 'v=0' }]);
  });

  it('Sinalizar fora da chamada é `E_SESSION_GONE` — não há host encaminhando para uma sessão que não existe', () => {
    const r = rig({ comMidia: false });
    assert.deepEqual(r.call.signal(r.conversa, { ice: '{}' }), { ok: false, code: 'E_SESSION_GONE' });
  });

  it('Conversa que não existe não vira chamada: `E_NOT_FOUND`', () => {
    const r = rig({ comMidia: true });
    assert.deepEqual(r.call.join('f'.repeat(64)), { ok: false, code: 'E_NOT_FOUND' });
  });

  it('STUN/TURN simétrico: entrar registra o escopo no serviço do processo, com o `dmTurnSecret` desta conversa', () => {
    const r = rig({ comMidia: true });
    r.call.join(r.conversa);
    assert.deepEqual(r.registrados.get(r.conversa), dmTurnSecretFrom(Buffer.alloc(32, 5), r.conversa));
  });

  it('Revogação por moderação não existe: o que encerra é SAIR, e sair solta o escopo na hora', () => {
    const r = rig({ comMidia: true });
    r.call.join(r.conversa);
    r.call.leave(r.conversa);
    assert.equal(r.registrados.has(r.conversa), false, 'manter o segredo registrado deixaria a credencial emitida valendo depois da chamada');
    assert.deepEqual(r.anuncios.at(-1), { conversationId: r.conversa, on: false });
    assert.deepEqual(r.call.ativas(), new Set());
  });

  it('Sair de uma chamada que não existe é no-op nomeado, como `voice.leave` sem sessão', () => {
    const r = rig({ comMidia: true });
    assert.deepEqual(r.call.leave(r.conversa), { ok: true });
    assert.equal(r.anuncios.length, 0);
  });
});

describe('§31.15 — o que cada lado OFERECE, e o que cada lado USA', () => {
  it('eu ofereço só o que EU sirvo: o STUN de terceiro é configuração de cada lado (§17.2)', () => {
    const r = rig({ comMidia: true });
    r.call.join(r.conversa);
    const oferta = r.anuncios[0]?.oferta;
    assert.ok(oferta);
    assert.deepEqual(
      oferta.iceServers.map((s) => s.urls),
      ['stun:1.2.3.4:9000', 'turn:1.2.3.4:9000?transport=udp'],
      'o `terceiro: true` não sai daqui — anunciá-lo ao par diria que o servidor externo é meu',
    );
    assert.equal(oferta.turnCredential?.username, `${r.conversa}:${1_000 + 5 * 60_000}`);
  });

  it('a credencial que eu ofereço é assinada com o MEU segredo, para a chave DELE', () => {
    const r = rig({ comMidia: true });
    r.call.join(r.conversa);
    const cred = r.anuncios[0]?.oferta?.turnCredential;
    assert.ok(cred);
    const esperada = issueTurnCredential(
      dmTurnSecretFrom(Buffer.alloc(32, 5), r.conversa),
      r.conversa,
      r.peerKey,
      1_000 + 5 * 60_000,
    );
    assert.deepEqual(cred, esperada);
  });

  it('sem endereço servível não sai credencial: um `turn:` anunciado sem serviço responde 401', () => {
    const r = rig({ comMidia: false });
    r.call.join(r.conversa);
    assert.deepEqual(r.anuncios[0]?.oferta, { iceServers: [] });
  });

  it('eu USO o serviço DELE sem a marca de terceiro, e o meu terceiro COM ela', () => {
    const r = rig({ comMidia: true });
    r.ofertas.set(r.conversa, {
      iceServers: [{ urls: 'stun:9.9.9.9:1000' }, { urls: 'turn:9.9.9.9:1000?transport=udp' }],
      turnCredential: { username: 'u', password: 'p' },
    });
    const j = r.call.join(r.conversa);
    assert.ok(j.ok);
    assert.deepEqual(j.iceServers, [
      { urls: 'stun:9.9.9.9:1000' },
      // A credencial dele costurada na entrada `turn:` dele — como `voiceJoin` faz (§17.3).
      { urls: 'turn:9.9.9.9:1000?transport=udp', username: 'u', credential: 'p' },
      // §17.2 — o terceiro continua carimbado: ele vê o IP de quem entra em chamada, numa
      // DM exatamente como numa comunidade.
      { urls: 'stun:externo:3478', terceiro: true },
    ]);
    assert.equal(j.peerOnCall, true);
  });

  it('o que ESTE nó serve não entra na MINHA lista: um `stun:` para o próprio endereço não descobre mapeamento nenhum', () => {
    const r = rig({ comMidia: true });
    const j = r.call.join(r.conversa);
    assert.ok(j.ok);
    assert.deepEqual(j.iceServers, [{ urls: 'stun:externo:3478', terceiro: true }]);
  });
});

describe('§31.15 — "o outro está na chamada", a notificação que substitui o roster', () => {
  it('o par entrando DEPOIS de mim faz eu reanunciar: o `dm.call` que eu mandei foi para ninguém', () => {
    const r = rig({ comMidia: true });
    r.call.join(r.conversa);
    assert.equal(r.anuncios.length, 1);
    r.ofertas.set(r.conversa, { iceServers: [{ urls: 'stun:9.9.9.9:1000' }] });
    r.call.aoMudarChamadaDoPar({ conversationId: r.conversa, peerKeyHex: r.peerKey.toString('hex'), on: true });
    assert.equal(r.anuncios.length, 2, 'sem o reanúncio, o outro lado nunca receberia o meu serviço');
    assert.equal(r.anuncios[1]?.on, true);
  });

  it('o `dm.callState` leva a lista JÁ COMPOSTA — compor no renderer exigiria que ele soubesse o que é terceiro', () => {
    const r = rig({ comMidia: true });
    r.call.join(r.conversa);
    r.ofertas.set(r.conversa, { iceServers: [{ urls: 'stun:9.9.9.9:1000' }] });
    r.call.aoMudarChamadaDoPar({ conversationId: r.conversa, peerKeyHex: r.peerKey.toString('hex'), on: true });
    const ev = r.eventos.at(-1);
    assert.equal(ev?.topic, 'dm.callState');
    assert.equal(ev?.data['on'], true);
    assert.deepEqual(ev?.data['iceServers'], [{ urls: 'stun:9.9.9.9:1000' }, { urls: 'stun:externo:3478', terceiro: true }]);
  });

  it('o par SAINDO não leva lista nenhuma, e não me faz reanunciar', () => {
    const r = rig({ comMidia: true });
    const par = { conversationId: r.conversa, peerKeyHex: r.peerKey.toString('hex') };
    r.call.join(r.conversa);
    r.call.aoMudarChamadaDoPar({ ...par, on: true });
    r.call.aoMudarChamadaDoPar({ ...par, on: false });
    assert.equal(r.anuncios.length, 2, 'o reanúncio é do `on:true`; a saída dele não pede nada de mim');
    const ev = r.eventos.at(-1);
    assert.equal(ev?.data['on'], false);
    assert.equal('iceServers' in (ev?.data ?? {}), false);
  });

  it('repetir o MESMO nível não reanuncia nem reemite — sem isto o reanúncio vira ping-pong', () => {
    const r = rig({ comMidia: true });
    const par = { conversationId: r.conversa, peerKeyHex: r.peerKey.toString('hex') };
    r.call.join(r.conversa);
    r.call.aoMudarChamadaDoPar({ ...par, on: true });
    assert.equal(r.anuncios.length, 2);
    assert.equal(r.eventos.length, 1);
    // O par respondendo ao meu reanúncio com o reanúncio dele: aqui o laço tem de parar. Sem
    // esta guarda os dois lados trocam `dm.call` para sempre pelo mesmo cabo — foi assim que
    // o defeito apareceu, com dezenas de quadros entre dois nós que só queriam se avisar.
    r.call.aoMudarChamadaDoPar({ ...par, on: true });
    r.call.aoMudarChamadaDoPar({ ...par, on: true });
    assert.equal(r.anuncios.length, 2);
    assert.equal(r.eventos.length, 1);
  });

  it('sair esquece o que eu sabia do par: a próxima chamada não nasce com ele já presente', () => {
    const r = rig({ comMidia: true });
    const par = { conversationId: r.conversa, peerKeyHex: r.peerKey.toString('hex') };
    r.call.join(r.conversa);
    r.call.aoMudarChamadaDoPar({ ...par, on: true });
    r.call.leave(r.conversa);
    const j = r.call.join(r.conversa);
    assert.ok(j.ok);
    r.call.aoMudarChamadaDoPar({ ...par, on: true });
    assert.equal(r.eventos.at(-1)?.data['on'], true, 'a transição tem de voltar a ser notícia');
  });

  it('o par entrando sem que EU esteja na chamada ainda emite o estado: é assim que a chamada toca', () => {
    const r = rig({ comMidia: true });
    r.call.aoMudarChamadaDoPar({ conversationId: r.conversa, peerKeyHex: r.peerKey.toString('hex'), on: true });
    assert.equal(r.anuncios.length, 0, 'não anuncio uma chamada em que não entrei');
    assert.equal(r.eventos.at(-1)?.topic, 'dm.callState');
    assert.equal(r.eventos.at(-1)?.data['on'], true);
  });
});

describe('§31.15 (emenda de 2026-09-03) — a tela da DM e o que a autoriza', () => {
  /**
   * O objeto que `capture.authorize` (§15.7) consulta numa conversa direta.
   *
   * Numa comunidade a resposta sai do `captureToken` que a sessão de tela cunhou. Numa DM
   * **não há sessão de tela** — §31.15 a remove com o host —, e o `sessionId` que o main
   * declara é o `conversationId`. O único fato local que sobra é "eu estou nesta chamada
   * agora", e ele é exatamente tão forte quanto o token era: os dois são estado deste
   * processo, e nenhum dos dois vai ao host.
   */
  function autorizaCaptura(call: { ativas(): ReadonlySet<string> }, sessionId: string): boolean {
    return call.ativas().has(sessionId);
  }

  it('a chamada de pé É a autorização: sem sessão de tela, é ela que responde', () => {
    const r = rig({ comMidia: true });
    assert.equal(autorizaCaptura(r.call, r.conversa), false, 'fora da chamada não há o que capturar para ninguém');
    r.call.join(r.conversa);
    assert.equal(autorizaCaptura(r.call, r.conversa), true);
  });

  it('sair fecha a captura no mesmo instante — é o que substitui a revogação de §17.5', () => {
    const r = rig({ comMidia: true });
    r.call.join(r.conversa);
    r.call.leave(r.conversa);
    // §17.5 revoga por moderação; aqui não há moderação, e o que encerra é sair. A captura
    // não pode sobreviver à chamada: sobreviveria como sessão de tela órfã, que é o defeito
    // que a emenda de 2026-08-26 tirou da comunidade.
    assert.equal(autorizaCaptura(r.call, r.conversa), false);
  });

  it('uma conversa que NÃO está em chamada não autoriza captura de outra que está', () => {
    const r = rig({ comMidia: true });
    r.call.join(r.conversa);
    assert.equal(autorizaCaptura(r.call, 'f'.repeat(64)), false);
  });
});
