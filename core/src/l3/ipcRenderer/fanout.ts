// Fan-out dos eventos de §15.5 até o renderer — L3, forma da fronteira, sem regra de
// domínio (§4).
//
// Os eventos nascem em dois lugares e por caminhos independentes:
//
//   - o **projector** (L1), que emite os `notify` do lote **depois** do commit (§10.7);
//   - a **outbox** (L2), que emite o desfecho de cada item (`message.accepted` pela
//     reconciliação, `message.failed`/`message.dropped` nas transições — §11.6, §11.7).
//
// Este módulo é o único ponto por onde os dois entram no `IpcServer`. Ele **não reordena**,
// não bufferiza e não inventa payload: entrega na ordem em que recebe, com o dado exatamente
// como a tabela de §15.5 o declara. É isso que preserva `DS-31` ponta a ponta — a ordem
// `messages.appended` → `message.accepted` é produzida pelo projector+reconciliação (§11.6
// regra 2) e sobrevive até o renderer porque a entrega aqui é síncrona e em ordem.
//
// Filtro de assinatura (§15.1 regra 2): duas assinaturas do mesmo tópico com filtros
// diferentes são independentes, e a comparação usa a **chave de roteamento** — não o payload.
// A distinção importa: `message.accepted{opId, clientRef, messageId, seq, channelId}` não
// carrega `communityId` na tabela, e acrescentá-lo ao dado para poder filtrar seria inventar
// superfície. A comunidade viaja ao lado, como rota, e o payload continua o da tabela.

import type { IpcServer } from './index.ts';

/** Forma comum do que projector e outbox emitem. Estrutural de propósito: L3 não importa L1. */
export type FanoutEvent = {
  readonly topic: string;
  readonly data: Readonly<Record<string, unknown>>;
};

/**
 * Chave de roteamento do evento. Serve **só** para casar o filtro da assinatura; nunca entra
 * no payload. Ausente = o evento não sabe responder por esse recorte.
 */
export type FanoutRoute = {
  readonly communityId?: string;
  readonly channelId?: string;
};

const ROUTE_KEYS = ['communityId', 'channelId'] as const;

export class EventFanout {
  readonly #server: Pick<IpcServer, 'emit'>;

  constructor(server: Pick<IpcServer, 'emit'>) {
    this.#server = server;
  }

  /**
   * Entrega um evento às assinaturas do tópico. O filtro casa quando **todo** campo que ele
   * declara tem o mesmo valor na rota; um filtro que o evento não sabe responder **não**
   * casa — entregar seria vazar sinal de outra comunidade para uma assinatura recortada.
   * Filtro ausente recebe tudo do tópico.
   */
  emit(ev: FanoutEvent, route: FanoutRoute = {}): void {
    const chave: Record<string, unknown> = {};
    for (const k of ROUTE_KEYS) {
      const v = route[k] ?? ev.data[k];
      if (v !== undefined && v !== null) chave[k] = v;
    }
    this.#server.emit(ev.topic, ev.data, (filter) => {
      if (filter === undefined || filter === null || typeof filter !== 'object') return true;
      for (const [k, v] of Object.entries(filter as Record<string, unknown>)) {
        if (v === undefined) continue;
        if (chave[k] !== v) return false;
      }
      return true;
    });
  }

  /**
   * Porta do `Projector.onEvent` (§10.5 passo 5). O lote chega já agregado e com
   * `communityId` no dado; a rota sai do próprio payload — inclusive `channelId`, que
   * `messages.appended` carrega.
   */
  fromProjector = (events: readonly FanoutEvent[]): void => {
    for (const ev of events) this.emit(ev);
  };

  /**
   * Porta do `Outbox.onOutcome` (§15.5, §11.6). A fila é por comunidade e o payload da tabela
   * não a nomeia: ela entra como rota, e o dado permanece o da tabela.
   */
  fromOutbox(communityId: string): (ev: FanoutEvent) => void {
    return (ev) => this.emit(ev, { communityId });
  }
}
