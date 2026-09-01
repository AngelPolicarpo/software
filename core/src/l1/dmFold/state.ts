// `DmState` — §31.7.2, schema exato.
//
// Tudo aqui é derivado dos dois logs e recomputável. O `dmFold` **nunca** lê `view.db` nem
// `manifest.db` (§1.3 regra 1): recebe o `DmState` como argumento e devolve o próximo.
//
// **O que §31.7.2 diz que não existe, e não existe:** `members`, `roles`, `channels`,
// `categories`, `invites`, `joinedByInvite`, `relays`, `lastAuthorSeq` por escopo, cota
// determinística (§31.18 explica por que R-15 não tem análogo). `O(mensagens)` é o único
// termo que cresce, e vale para ele a mesma regra de residência de §8.1.
//
// A mutação é copy-on-write por container e por entidade (`DmDraft`), pela mesma razão de
// `fold/state.ts`: §31.7.1 exige que `next` difira de `prev` só no que o registro mudou, e
// pagar O(estado) por registro seria inviável.

import type { DmEffect } from './effects.ts';

export type Id = string;
export type KeyHex = string;

/** Qual dos dois logs — as coordenadas fixas de §31.6, `lo`/`hi` ordenados por byte (§31.2). */
export type DmOrigin = 'lo' | 'hi';

export const DM_ORIGINS: readonly DmOrigin[] = ['lo', 'hi'];

export function otherSide(o: DmOrigin): DmOrigin {
  return o === 'lo' ? 'hi' : 'lo';
}

export type DmMessageMeta = {
  author: Buffer;
  /** §31.6 — a chave de ordem. Uma vez escrito, um registro **nunca** muda de `ordSum`. */
  ordSum: number;
  authorSeq: number;
  deletedAt?: number;
  editedAt?: number;
  replyToId?: Id;
  hasAttachment: boolean;
  /**
   * RD-9 — emojis **distintos** já vistos nesta mensagem. Nunca encolhe: `present:false`
   * apaga a linha do reator em `dm_reactions`, mas não devolve a vaga do emoji. É a mesma
   * leitura que R-23 tem em `fold/apply.ts`, e é o que impede um par de contornar RD-9
   * alternando `present` para reciclar a contagem.
   */
  reactionEmojis: Set<string>;
};

export type DmSideState = {
  readonly identityKey: Buffer;
  /**
   * §31.7.2 — a chave do core daquele lado, fixada por RD-1 e **imutável** por RD-6. Ausente
   * enquanto o `dm.hello` daquele lado não tiver sido interpretado.
   */
  coreKey?: Buffer;
  displayName: string;
  avatarColor: number;
  /** Registros **interpretados** daquele lado, em qualquer desfecho (§31.7.3, estágio final). */
  length: number;
  lastAuthorSeq: number;
  /** RD-4 — `ack` já clampado, não decrescente. */
  lastAck: number;
  /** RD-5 — `ts` já clampado, não decrescente. */
  lastTs: number;
  /** RD-1 — gênese fora da forma. **Absorvente, POR LADO**: o outro lado segue legível. */
  invalid: boolean;
  /**
   * RD-11 — o core de blobs de DM daquele lado.
   *
   * **Acréscimo ao schema de §31.7.2, e uma lacuna de especificação registrada.** RD-11 manda
   * conferir que o `blobsCoreKey` de um anexo é "o core de blobs de DM do autor daquela
   * mensagem", mas `dmBlobsSeed = BLAKE2b('ns/dmblobs/1' ‖ identitySeed ‖ conversationId)`
   * (§31.3) só é derivável por quem tem o `identitySeed`, e nada declara a chave resultante:
   * ela não está no `dm.hello` de §31.5, não está no `dmHello` de §31.8 e não há um sétimo
   * `kind` (o catálogo é fechado). Como está escrita, a regra é verificável só sobre o
   * próprio lado — o que a tornaria assimétrica e faria as duas réplicas divergirem, contra
   * §31.1.
   *
   * O que este campo implementa é a única forma determinística e simétrica disponível sem
   * mudar o fio: o **primeiro** anexo de um lado vincula a chave, e todo anexo posterior
   * daquele lado precisa repetir a mesma. Isso fecha o caso de um par apontar cada anexo para
   * um core diferente, e **não** fecha o caso que RD-11 nomeia — o primeiro anexo ainda pode
   * apontar para um core arbitrário. Fechá-lo exige texto normativo (a chave declarada no
   * `dm.hello`, o que é mudança de `DM_VERSION`). Registrado em `docs/backlog.md`.
   */
  blobsCoreKey?: Buffer;
  /**
   * RD-5 / §31.6 — os `ts` já clampados dos registros deste lado, por índice, a partir de
   * `tsWindowBase`.
   *
   * **Acréscimo ao schema de §31.7.2, sem segunda leitura possível.** `clockSkewed` é
   * definido como "`ts` menor que o `ts` do registro mais recente que ele reconhece por
   * `ack`" — o registro do **outro** lado no índice `ack − 1`. `lastTs` não serve: ele é o
   * `ts` do último registro interpretado daquele lado, que na ordem canônica pode estar num
   * índice **maior** que `ack − 1`, e usá-lo marcaria `clockSkewed` onde não há impossibilidade
   * causal nenhuma.
   *
   * A janela é limitada: as consultas vêm dos `ack` do outro lado, que são não decrescentes
   * por RD-4, então tudo abaixo de `ack − 1` é podado e o que sobra é o atraso corrente.
   */
  tsWindow: readonly number[];
  /** O índice a que `tsWindow[0]` corresponde. */
  tsWindowBase: number;
};

export type DmState = {
  /** §31.2, hex64. */
  readonly conversationId: string;
  /** Os mesmos 32 bytes — material de comparação do estágio 2 e de `dmEntityId` (§31.4). */
  readonly conversationKey: Buffer;
  /** §31.7.2 — `−1` antes do primeiro registro. */
  interpretedOrdSum: number;
  dmVersionSeen: number;
  /** §31.4 — versão ou `kind` desconhecido nesta conversa; bloqueia escrita local nela. */
  partialInterpretation: boolean;
  sides: { readonly lo: DmSideState; readonly hi: DmSideState };
  messages: Map<Id, DmMessageMeta>;
};

function emptySide(identityKey: Buffer): DmSideState {
  return {
    identityKey,
    displayName: '',
    avatarColor: 0,
    length: 0,
    lastAuthorSeq: 0,
    lastAck: 0,
    lastTs: 0,
    invalid: false,
    tsWindow: [],
    tsWindowBase: 0,
  };
}

/**
 * §31.7.2 — `interpretedOrdSum = −1` antes do primeiro registro.
 *
 * `lo` e `hi` são as duas chaves de identidade **já ordenadas por byte** (§31.2). Quem chama
 * usa `dmCodec.dmPairOrder`; passar fora de ordem faria as coordenadas de §31.6 dependerem de
 * quem lê, que é exatamente o que a ordenação existe para impedir.
 */
export function emptyDmState(
  conversationKey: Buffer,
  loKey: Buffer,
  hiKey: Buffer,
  conversationId?: string,
): DmState {
  return {
    conversationId: conversationId ?? conversationKey.toString('hex'),
    conversationKey,
    interpretedOrdSum: -1,
    dmVersionSeen: 0,
    partialInterpretation: false,
    sides: { lo: emptySide(loKey), hi: emptySide(hiKey) },
    messages: new Map(),
  };
}

// ─── Copy-on-write ──────────────────────────────────────────────────────────────────────

type DmScalar = 'interpretedOrdSum' | 'dmVersionSeen' | 'partialInterpretation';

/**
 * Rascunho do próximo `DmState`. Clona `messages` só quando ele é tocado, uma mensagem só
 * quando ela é mutada, e um lado só quando ele muda — o resto continua sendo o objeto de
 * `prev`.
 *
 * `finish()` devolve `prev` **por identidade** quando nada mudou, o que dá ao teste de
 * determinismo do merge a mesma verificação barata que §28.4 já usa para o `fold`.
 */
export class DmDraft {
  readonly prev: DmState;
  #s: DmState;
  #messagesCloned = false;
  #sidesCloned = false;
  #sideCloned = new Set<DmOrigin>();
  #entityCloned = new Set<Id>();
  #dirty = false;

  constructor(prev: DmState) {
    this.prev = prev;
    this.#s = { ...prev };
  }

  get state(): DmState {
    return this.#s;
  }

  messages(): Map<Id, DmMessageMeta> {
    if (!this.#messagesCloned) {
      this.#s.messages = new Map(this.#s.messages);
      this.#messagesCloned = true;
      this.#dirty = true;
    }
    return this.#s.messages;
  }

  mutMessage(id: Id): DmMessageMeta | undefined {
    const container = this.messages();
    const v = container.get(id);
    if (v === undefined) return undefined;
    if (this.#entityCloned.has(id)) return v;
    const copia: DmMessageMeta = { ...v, reactionEmojis: new Set(v.reactionEmojis) };
    container.set(id, copia);
    this.#entityCloned.add(id);
    return copia;
  }

  /** O lado, já clonado para escrita. */
  side(o: DmOrigin): DmSideState {
    if (!this.#sidesCloned) {
      this.#s.sides = { ...this.#s.sides };
      this.#sidesCloned = true;
      this.#dirty = true;
    }
    if (!this.#sideCloned.has(o)) {
      const clone: DmSideState = { ...this.#s.sides[o], tsWindow: [...this.#s.sides[o].tsWindow] };
      this.#s.sides = { ...this.#s.sides, [o]: clone };
      this.#sideCloned.add(o);
    }
    return this.#s.sides[o];
  }

  setScalar<K extends DmScalar>(k: K, v: DmState[K]): void {
    if (this.#s[k] === v) return;
    this.#s[k] = v;
    this.#dirty = true;
  }

  /** Força a materialização de `next` mesmo quando o conteúdo não mudou. */
  touch(): void {
    this.#dirty = true;
  }

  finish(): DmState {
    return this.#dirty ? this.#s : this.prev;
  }
}

/** Lista vazia congelada — o desfecho sem efeitos não aloca. */
export const SEM_EFEITOS: readonly DmEffect[] = Object.freeze([]);
