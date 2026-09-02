// §31.15 — mídia numa conversa direta. Raiz de composição (§4).
//
// A seção é uma tabela de **remoções** sobre §17, e este arquivo é o que sobra depois delas.
// Vale §17.2 sem alteração — toda mídia é WebRTC no renderer, ponta a ponta, com DTLS-SRTP, e
// o núcleo nunca vê mídia. O que muda é quem faz o papel que §17 dá ao host:
//
//   | Peça de §17                       | Aqui                                              |
//   |-----------------------------------|---------------------------------------------------|
//   | Sinalização encaminhada pelo host | **Não existe.** SDP e ICE viajam no `p2p-dm/1`     |
//   | Ticket de mídia (§17.4)           | **Não existe.** A `remotePublicKey` é a autorização|
//   | STUN/TURN do host (§17.3)         | **Simétrico** — cada lado serve o outro            |
//   | STUN de terceiro                  | **Reutilizado sem alteração**                     |
//   | Roster, ocupação e fila           | **Não existem** — numa dupla o roster é a conversa |
//   | Revogação por moderação           | **Não existe** — não há moderação                 |
//   | Relay voluntário (§17.7)          | **Não existe** — **L-29**                         |
//
// **O que este arquivo NÃO tem, e cada ausência é a linha de cima.** Não há `MediaTicket`, não
// há `ticketId`, não há `signalIsAuthorized`, não há roster a difundir, não há revogação e não
// há caminho de relay a oferecer. Procurar aqui o análogo de `voiceCoordinator` é procurar a
// peça que §31.15 remove: `voiceCoordinator` existe para decidir **quem pode falar com quem**
// dentro de um conjunto, e num conjunto de dois autenticados por Noise não sobra decisão.
//
// **O serviço de §17.3, simétrico, e o que "simétrico" custa.** O serviço é por **nó**: o
// `MediaServer` do processo já escuta STUN/TURN na mesma socket UDP do UDX, demultiplexando
// pelo magic cookie, e uma conversa se registra nele como uma comunidade hospedada se
// registra — com o `conversationId` no slot do `communityId`, a mesma substituição de §31.14.
// O que a simetria obriga é a **travessia da oferta**: a credencial TURN que eu uso contra o
// serviço do par foi emitida com o `dmTurnSecret` DELE, e não é derivável aqui. Ela chega pelo
// `dm.call{on:true}` do par (§31.8), junto do endereço que ele serve. É por isso que a
// resposta de `dm.callJoin` pode nascer **sem** o par: numa dupla não há host que já saiba a
// resposta dos dois lados, e o que o outro serve chega quando ele entra.

import { MEDIA_TICKET_TTL_MS } from '../l1/fold/constants.ts';
import { dmTurnSecretFrom } from '../l0/corestore/index.ts';
import { issueTurnCredential, type TurnCredential } from '../l2/communityHost/stunTurn.ts';
import type { IceServer } from '../l2/voiceCoordinator/index.ts';
import type { DmOfertaDeMidia, DmTransport } from './dm.ts';

/** O recorte do `MediaHost` que uma conversa usa. Porta, e não import: ver `boot.ts`. */
export type DmMediaPort = {
  /** §17.3 — o que ESTE nó serve, mais o STUN de terceiro de §17.2 (marcado `terceiro`). */
  iceServers(): readonly IceServer[];
  registrar(c: { communityId: string; voice: { participantKeys(sessionId: string): ReadonlySet<string> }; turnSecret: Buffer }): void;
  esquecer(escopo: string): void;
};

export type DmCallDeps = {
  readonly transport: Pick<DmTransport, 'sinalizar' | 'anunciarChamada' | 'ofertaDoPar'>;
  /** §5.1 — a identidade local; `null` em `awaiting-identity`. */
  identity(): { readonly publicKey: Buffer } | null;
  /** §5.4 — a Data Key, insumo de `dmTurnSecret` (§31.3). Nunca sai daqui. */
  readonly dataKey: Buffer;
  /**
   * A chave do par desta conversa, do estado de `directMessages`. `null` quando a conversa
   * não existe ou não está em estado que autoriza canal (§31.8(4)) — e aí não há chamada.
   */
  peerKeyOf(conversationId: string): Buffer | null;
  /** `null` quando esta instalação não tem socket de mídia: sem serviço a oferecer. */
  midia(): DmMediaPort | null;
  onEvent(topic: string, data: Readonly<Record<string, unknown>>): void;
  now?(): number;
};

export type DmCallJoinOk = {
  readonly ok: true;
  /** §31.15 — o escopo do serviço é a conversa; não há `sessionId` de host a inventar. */
  readonly sessionId: string;
  readonly peerKey: string;
  readonly iceServers: readonly IceServer[];
  /** Presente só quando o par já está na chamada e já ofereceu o serviço dele. */
  readonly peerOnCall: boolean;
};

export type DmCall = {
  join(conversationId: string): DmCallJoinOk | { ok: false; code: string };
  leave(conversationId: string): { ok: true } | { ok: false; code: string };
  signal(conversationId: string, a: { sdp?: string; ice?: string }): { ok: true } | { ok: false; code: string };
  /**
   * O ouvinte de `dm.call` do transporte (§31.8). Ele faz duas coisas: reanuncia a minha
   * oferta quando o par entra depois de mim, e emite o `dm.callState` de §31.16.2 com a
   * lista de ICE já composta.
   */
  aoMudarChamadaDoPar(a: { conversationId: string; peerKeyHex: string; on: boolean }): void;
  /** As conversas em que ESTE nó está na chamada. Efêmero, como o roster que substitui. */
  ativas(): ReadonlySet<string>;
  close(): void;
};

/**
 * A união do que os dois lados servem, na forma que o renderer consome.
 *
 * Duas regras, e as duas vêm de §17.2/§99.13:
 *
 *   1. **O do par não é de terceiro.** Ele é o outro nó da conversa — o análogo exato do
 *      host —, então entra sem a marca e a coleta em duas fases o põe na fase 1. Marcá-lo
 *      faria o renderer esperar 2,5 s antes de tentar o único serviço que existe aqui.
 *   2. **O terceiro é o MEU**, e continua marcado. §31.15 reutiliza o STUN de terceiro "sem
 *      alteração", inclusive o carimbo `terceiro: true` — o servidor externo vê o IP de quem
 *      entra em chamada numa DM exatamente como vê numa comunidade.
 *
 * O que ESTE nó serve não entra na lista: um `stun:` para o próprio endereço público não
 * descobre mapeamento nenhum, e um `turn:` para si mesmo relayaria a mídia por dentro da
 * própria máquina. Quem usa o meu serviço é o par.
 */
function listaParaOAgente(locais: readonly IceServer[], doPar: DmOfertaDeMidia | null): readonly IceServer[] {
  const terceiros = locais.filter((s) => s.terceiro === true);
  const cred = doPar?.turnCredential;
  const doOutro: IceServer[] = (doPar?.iceServers ?? []).map((s) =>
    cred !== undefined && (s.urls.startsWith('turn:') || s.urls.startsWith('turns:'))
      ? { urls: s.urls, username: cred.username, credential: cred.password }
      : { urls: s.urls },
  );
  return [...doOutro, ...terceiros];
}

export function criarDmCall(deps: DmCallDeps): DmCall {
  const now = deps.now ?? Date.now;
  /** `conversationId` → a chave do par, enquanto ESTE nó está na chamada. */
  const ativas = new Map<string, string>();
  /**
   * As conversas em que o PAR está na chamada, pelo último `dm.call` dele.
   *
   * Existe por uma razão só, e ela é um defeito real desta fatia: sem memória do estado
   * anterior, o reanúncio vira **ping-pong**. Eu recebo `on:true`, reanuncio; o par recebe o
   * meu `on:true`, reanuncia; e os dois lados ficam trocando notificação para sempre pelo
   * mesmo cabo — medido em duas pontas antes de existir esta linha. O reanúncio é resposta a
   * uma **transição** (o par entrou), não à repetição de um nível.
   */
  const parNaChamada = new Set<string>();

  /**
   * O roster de §17.3 para o `MediaServer`, numa dupla: as duas chaves da conversa.
   *
   * Não é uma concessão — é o que §31.15 quer dizer com "numa chamada de duas pessoas o
   * roster é a própria conversa". A permissão de RFC 5766 §9 continua valendo sobre este
   * conjunto, e ele é o menor possível: um TURN meu só encaminha para o par com quem eu
   * estou falando, nunca para quem obteve a credencial de outra forma.
   */
  const rosterDaConversa = {
    participantKeys(sessionId: string): ReadonlySet<string> {
      const peerHex = ativas.get(sessionId);
      if (peerHex === undefined) return new Set<string>();
      const eu = deps.identity();
      const s = new Set<string>([peerHex]);
      if (eu !== null) s.add(eu.publicKey.toString('hex'));
      return s;
    },
  };

  /** §31.15 — a credencial que ESTE nó emite, com o PRÓPRIO `dmTurnSecret`, para o par. */
  const credencialParaOPar = (conversationId: string, peerKey: Buffer): TurnCredential =>
    issueTurnCredential(
      dmTurnSecretFrom(deps.dataKey, conversationId),
      conversationId,
      peerKey,
      now() + MEDIA_TICKET_TTL_MS,
    );

  /** O que eu ofereço: só o que EU sirvo. O terceiro é configuração de cada lado (§17.2). */
  const minhaOferta = (conversationId: string, peerKey: Buffer): DmOfertaDeMidia => {
    const m = deps.midia();
    const meus = (m?.iceServers() ?? []).filter((s) => s.terceiro !== true);
    return {
      iceServers: meus.map((s) => ({ urls: s.urls })),
      // Sem endereço servível não há credencial a emitir: uma credencial para um serviço
      // que ninguém alcança é um caminho anunciado que responde 401 (§17.3).
      ...(meus.length > 0 ? { turnCredential: credencialParaOPar(conversationId, peerKey) } : {}),
    };
  };

  /**
   * §31.16.2 `dm.callState` — o único evento de chamada, e ele leva a lista **já composta**.
   *
   * Compor no núcleo, e não no renderer, é a mesma disciplina de `voiceJoin`: quem sabe o que
   * é serviço do par e o que é terceiro local é quem tem o `MediaHost`. Um renderer que
   * juntasse as duas listas teria de saber a diferença, e é justamente ela que a coleta em
   * duas fases de §99.13 usa para decidir a fase.
   */
  const emitirEstado = (conversationId: string, peerKeyHex: string, on: boolean): void => {
    const doPar = on ? deps.transport.ofertaDoPar(conversationId) : null;
    deps.onEvent('dm.callState', {
      conversationId,
      peerKey: peerKeyHex,
      on,
      ...(on ? { iceServers: listaParaOAgente(deps.midia()?.iceServers() ?? [], doPar) } : {}),
    });
  };

  return {
    join(conversationId: string): DmCallJoinOk | { ok: false; code: string } {
      const peerKey = deps.peerKeyOf(conversationId);
      if (peerKey === null) return { ok: false, code: 'E_NOT_FOUND' };
      const m = deps.midia();
      if (m !== null && !ativas.has(conversationId)) {
        // O escopo se registra ANTES do anúncio: o par pode responder com um Allocate no
        // instante seguinte, e um `dm.call` que sai antes do registro abriria a janela em
        // que a credencial que EU acabei de emitir é recusada pelo MEU próprio serviço.
        ativas.set(conversationId, peerKey.toString('hex'));
        m.registrar({
          communityId: conversationId,
          voice: rosterDaConversa,
          turnSecret: dmTurnSecretFrom(deps.dataKey, conversationId),
        });
      } else {
        ativas.set(conversationId, peerKey.toString('hex'));
      }
      // §31.15 — não há roster a difundir; o que existe é a notificação efêmera de que eu
      // estou na chamada, e ela leva o serviço junto. `E_PEER_UNREACHABLE` do transporte
      // **não** derruba a entrada: o par pode estar offline, e a chamada de um lado só é
      // uma chamada que ninguém atendeu ainda.
      deps.transport.anunciarChamada(conversationId, true, minhaOferta(conversationId, peerKey));
      return {
        ok: true,
        sessionId: conversationId,
        peerKey: peerKey.toString('hex'),
        iceServers: listaParaOAgente(m?.iceServers() ?? [], deps.transport.ofertaDoPar(conversationId)),
        peerOnCall: deps.transport.ofertaDoPar(conversationId) !== null,
      };
    },

    leave(conversationId: string): { ok: true } | { ok: false; code: string } {
      if (!ativas.has(conversationId)) return { ok: true };
      ativas.delete(conversationId);
      // Sair esquece o que eu sabia do outro: entrar de novo tem de reaprender, senão a
      // próxima chamada nasceria com o par marcado como presente sem ninguém ter dito.
      parNaChamada.delete(conversationId);
      // O escopo sai do serviço junto: manter o `turnSecret` registrado deixaria a
      // credencial que eu emiti valendo depois de a chamada acabar, que é a revogação de
      // §17.4 acontecendo pela única via que sobrou aqui — sair encerra (§31.15).
      deps.midia()?.esquecer(conversationId);
      deps.transport.anunciarChamada(conversationId, false);
      return { ok: true };
    },

    signal(conversationId, a) {
      if (!ativas.has(conversationId)) return { ok: false, code: 'E_SESSION_GONE' };
      return deps.transport.sinalizar(conversationId, a);
    },

    aoMudarChamadaDoPar(a: { conversationId: string; peerKeyHex: string; on: boolean }): void {
      // Ele entrou depois de mim: o `dm.call` que eu mandei foi para um canal em que ninguém
      // estava esperando, e ele não tem a minha oferta. Reanunciar é o análogo do
      // instantâneo que §16.3 manda o host mandar na conexão de um membro novo — só que aqui
      // não há host, então quem já está dentro é quem reanuncia.
      const jaSabia = parNaChamada.has(a.conversationId);
      if (a.on) parNaChamada.add(a.conversationId);
      else parNaChamada.delete(a.conversationId);
      // Repetição do mesmo nível não é notícia: nem para mim, nem para a tela. Reanunciar
      // aqui seria o ping-pong descrito em `parNaChamada`; reemitir seria acordar a UI sem
      // ter o que dizer.
      if (a.on === jaSabia) return;
      if (a.on && ativas.has(a.conversationId)) {
        const peerKey = deps.peerKeyOf(a.conversationId);
        if (peerKey !== null) {
          deps.transport.anunciarChamada(a.conversationId, true, minhaOferta(a.conversationId, peerKey));
        }
      }
      emitirEstado(a.conversationId, a.peerKeyHex, a.on);
    },

    ativas(): ReadonlySet<string> {
      return new Set(ativas.keys());
    },

    close(): void {
      const m = deps.midia();
      for (const id of ativas.keys()) m?.esquecer(id);
      ativas.clear();
      parNaChamada.clear();
    },
  };
}
