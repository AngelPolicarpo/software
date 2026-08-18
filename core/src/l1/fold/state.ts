// `DecisionState` — §8.1, schema exato.
//
// Tudo aqui é derivado do log e recomputável. O `fold` **nunca** lê `view.db` nem
// `manifest.db` (§1.3 regra 1): recebe o `DS` como argumento e devolve o próximo.
//
// §8.0 exige que `next`, quando o desfecho não é `APPLIED`, difira de `prev` apenas em
// `interpretedSeq`, `lastAuthorSeq` e `partialInterpretation`. Pagar O(estado) por registro
// para garantir isso seria inviável num log de 200 000 mensagens, então a mutação é
// copy-on-write por container e por entidade (`Draft`): `prev` fica intacto e `next`
// compartilha tudo que não mudou.

import {
  QUOTA_BYTES_PER_WINDOW,
  QUOTA_OPS_PER_WINDOW,
  QUOTA_WINDOW_SEQS,
} from './constants.ts';

export type Id = string;
export type KeyHex = string;

/** §6.3 — ciclo do membro. `left` cobre saída e expulsão. */
export type MemberState = 'active' | 'left' | 'banned';

// ─── R-15 — cota determinística por autor ───────────────────────────────────────────────

/**
 * §8.1 declara o campo com o tipo `RingCounter`; R-15 define a **função**, e diz
 * explicitamente que `RingCounter` é implementação, não contrato — *"qualquer estrutura que
 * compute o mesmo par (ops, bytes) sobre a mesma janela é conforme"*.
 *
 * A janela é sobre `seq`, **não sobre tempo**: `J = {r : r.author = autor, S −
 * QUOTA_WINDOW_SEQS < seq(r) ≤ S}`. Entram em `J` os registros do autor que **alcançaram o
 * estágio 10**, `APPLIED` ou não — recusar num estágio posterior não devolve a cota, pela
 * mesma razão de §7.5: sem isso um autor inunda o log com ops que falham tarde e não paga
 * nada.
 */
export type RingCounter = {
  /** Pares `(seq, bytes)` dentro da janela, em ordem crescente de `seq`. */
  readonly entries: readonly { readonly seq: number; readonly bytes: number }[];
  readonly ops: number;
  readonly bytes: number;
};

export function emptyRing(): RingCounter {
  return { entries: [], ops: 0, bytes: 0 };
}

function pruneRing(r: RingCounter, seq: number): RingCounter {
  const piso = seq - QUOTA_WINDOW_SEQS;
  const primeiro = r.entries[0];
  if (primeiro === undefined || primeiro.seq > piso) return r;
  let i = 0;
  let ops = r.ops;
  let bytes = r.bytes;
  while (i < r.entries.length) {
    const e = r.entries[i];
    if (e === undefined || e.seq > piso) break;
    ops -= 1;
    bytes -= e.bytes;
    i++;
  }
  return { entries: r.entries.slice(i), ops, bytes };
}

/**
 * R-15 — o registro corrente **conta na própria verificação**. Devolve `null` quando cabe,
 * ou qual dos dois tetos estourou.
 */
export function ringWouldExceed(
  r: RingCounter,
  seq: number,
  bytes: number,
): 'ops' | 'bytes' | null {
  const p = pruneRing(r, seq);
  if (p.ops + 1 > QUOTA_OPS_PER_WINDOW) return 'ops';
  if (p.bytes + bytes > QUOTA_BYTES_PER_WINDOW) return 'bytes';
  return null;
}

export function ringAdd(r: RingCounter, seq: number, bytes: number): RingCounter {
  const p = pruneRing(r, seq);
  return { entries: [...p.entries, { seq, bytes }], ops: p.ops + 1, bytes: p.bytes + bytes };
}

// ─── As entidades de §8.1 ───────────────────────────────────────────────────────────────

export type Member = {
  state: MemberState;
  roleIds: Set<Id>;
  displayName: string;
  avatarColor: number;
  nickname?: string;
  blobsCoreKey?: Buffer;
  joinedAt: number;
  leftAt?: number;
  timeoutUntil?: number;
  bannedAt?: number;
  bannedBy?: Buffer;
  storageUsedBytes: number;
  /**
   * §8.1 declara `opBudget` e `byteBudget` como dois `RingCounter`, e R-15 descreve **uma**
   * janela com **dois** tetos. Um contador só já carrega ops e bytes, então os dois campos
   * do schema apontam para a mesma janela — leitura de G1, mantida aqui.
   */
  opBudget: RingCounter;
  byteBudget: RingCounter;
};

export type Role = {
  name: string;
  color: number;
  rank: string;
  permissions: Set<number>;
  mentionable: boolean;
  isFounder: boolean;
  isDefault: boolean;
  deletedAt?: number;
};

export type Category = { name: string; rank: string; deletedAt?: number };

export type Channel = {
  categoryId: Id;
  type: number;
  name: string;
  topic?: string;
  rank: string;
  readOnlyForRoleIds: Set<Id>;
  deletedAt?: number;
};

/** §8.1 — só metadado de **decisão**, ~120 B por mensagem. Conteúdo mora em `view.db`. */
export type MessageMeta = {
  channelId: Id;
  authorKey: KeyHex;
  deletedAt?: number;
  pinned: boolean;
  threadId?: Id;
  hasAttachment: boolean;
  attachmentBytes: number;
  reactionEmojis: Set<string>;
  hiddenByBan: boolean;
  orphaned: boolean;
};

export type Invite = {
  createdBy: Buffer;
  createdAt: number;
  expiresAt?: number;
  maxUses?: number;
  uses: number;
  revokedAt?: number;
};

export type Relay = {
  relayPublicKey: Buffer;
  expiresAt: number;
  withdrawnAt?: number;
};

export type CommunityMeta = {
  exists: boolean;
  hostKey: Buffer;
  /** Imutável: autor do lote de gênese (R-27). */
  founderKey: Buffer;
  blobsKey: Buffer;
  name: string;
  iconEmoji?: string;
  iconColor: number;
  description?: string;
  createdAt: number;
  endedAt?: number;
  successorKeys: Buffer[];
  originCommunityId?: string;
  /**
   * **Fora do schema de §8.1, e necessário.** R-18(a) manda toda réplica verificar `proof`
   * sobre `BLAKE2b('assume/1' ‖ newCommunityId ‖ originFinalSeq)`, e §5.2 confirma o
   * material. O valor entra no `opt<u64> originFinalSeq` da gênese (§7.4.5) — logo é
   * derivado do log e tem uma única origem possível —, mas `DecisionState.community` de §8.1
   * só declara `originCommunityId`. Sem este campo **R-18 não é implementável**.
   *
   * É o mesmo formato de `HOLE-11` (`communityInvalid`, exigido por R-27 e ausente de §8.1),
   * que foi fechado acrescentando o campo. Levantado em `docs/sequenciamento-pos-fase-0.md`
   * §17; não é decisão normativa, porque não há segunda leitura possível do valor.
   */
  originFinalSeq?: number;
};

export type DecisionState = {
  /** hex64 da chave pública do core do log (§6.2). */
  readonly communityId: string;
  /** Os mesmos 32 bytes — material de comparação do estágio 3 e de `entityId` (§7.3). */
  readonly communityKey: Buffer;
  interpretedSeq: number;
  opVersionSeen: number;
  partialInterpretation: boolean;
  /** R-27: gênese fora da forma. **Absorvente** — a partir daí todo registro é `REJECTED`. */
  communityInvalid: boolean;
  /** Monotonicidade de R-1. */
  lastHostTs: number;

  community: CommunityMeta;
  members: Map<KeyHex, Member>;
  roles: Map<Id, Role>;
  categories: Map<Id, Category>;
  channels: Map<Id, Channel>;
  /** Unicidade de R-6, chaveado por `${type}:${name}`. */
  channelNameIndex: Map<string, Id>;
  messages: Map<Id, MessageMeta>;
  /**
   * §8.1 — `threadId → id da mensagem raiz`. O nome antigo (`threadsByRoot`) dizia o inverso
   * do que o schema declarado sustenta: R-8 precisa resolver `threadId → canal` em O(1), e
   * R-24 ("uma thread por raiz") já é O(1) pelo `threadId` que a própria `MessageMeta`
   * carrega. Indexar por raiz deixaria R-8 varrendo o mapa (fecha `A-04`).
   */
  rootOfThread: Map<Id, Id>;
  invites: Map<KeyHex, Invite>;
  /** R-9, chaveado por `${invitePkHex}:${candidateHex}`. */
  joinedByInvite: Set<string>;
  /** §7.5 — idempotência sem janela, chave `${authorHex}\0${sequenceScope}`. */
  lastAuthorSeq: Map<KeyHex, number>;
  relays: Map<KeyHex, Relay>;
};

const ZERO32 = Buffer.alloc(32);

/** §8.1 — `interpretedSeq = −1` antes do primeiro registro. */
export function emptyState(communityKey: Buffer, communityId?: string): DecisionState {
  return {
    communityId: communityId ?? communityKey.toString('hex'),
    communityKey,
    interpretedSeq: -1,
    opVersionSeen: 0,
    partialInterpretation: false,
    communityInvalid: false,
    lastHostTs: 0,
    community: {
      exists: false,
      hostKey: ZERO32,
      founderKey: ZERO32,
      blobsKey: ZERO32,
      name: '',
      iconColor: 0,
      createdAt: 0,
      successorKeys: [],
    },
    members: new Map(),
    roles: new Map(),
    categories: new Map(),
    channels: new Map(),
    channelNameIndex: new Map(),
    messages: new Map(),
    rootOfThread: new Map(),
    invites: new Map(),
    joinedByInvite: new Set(),
    lastAuthorSeq: new Map(),
    relays: new Map(),
  };
}

// ─── Copy-on-write ──────────────────────────────────────────────────────────────────────

type MapContainer =
  | 'members'
  | 'roles'
  | 'categories'
  | 'channels'
  | 'channelNameIndex'
  | 'messages'
  | 'rootOfThread'
  | 'lastAuthorSeq'
  | 'invites'
  | 'relays';

type Scalar =
  | 'interpretedSeq'
  | 'opVersionSeen'
  | 'partialInterpretation'
  | 'lastHostTs'
  | 'communityInvalid';

/**
 * Rascunho do próximo `DS`. Clona um container só quando ele é tocado, e uma entidade só
 * quando ela é mutada — o resto continua sendo o objeto de `prev`.
 *
 * `finish()` devolve `prev` **por identidade** quando nada mudou. É o que dá a §28.4 um
 * teste barato: reprojetar o mesmo prefixo tem de produzir a mesma cadeia de estados.
 */
export class Draft {
  readonly prev: DecisionState;
  #s: DecisionState;
  #cloned = new Set<MapContainer | 'community' | 'joinedByInvite'>();
  #clonedEntities = new Set<string>();
  #dirty = false;

  constructor(prev: DecisionState) {
    this.prev = prev;
    this.#s = { ...prev };
  }

  /** Estado corrente do rascunho — inclui o que já foi mutado neste registro. */
  get state(): DecisionState {
    return this.#s;
  }

  #ensure<T extends MapContainer>(name: T): DecisionState[T] {
    if (!this.#cloned.has(name)) {
      // O `Map` é homogêneo por container; a união de `DecisionState[T]` é o que o
      // construtor genérico não consegue estreitar sozinho.
      const origem = this.#s[name] as ReadonlyMap<unknown, unknown>;
      this.#s[name] = new Map(origem) as DecisionState[T];
      this.#cloned.add(name);
      this.#dirty = true;
    }
    return this.#s[name];
  }

  members(): Map<KeyHex, Member> {
    return this.#ensure('members');
  }
  roles(): Map<Id, Role> {
    return this.#ensure('roles');
  }
  categories(): Map<Id, Category> {
    return this.#ensure('categories');
  }
  channels(): Map<Id, Channel> {
    return this.#ensure('channels');
  }
  channelNameIndex(): Map<string, Id> {
    return this.#ensure('channelNameIndex');
  }
  messages(): Map<Id, MessageMeta> {
    return this.#ensure('messages');
  }
  rootOfThread(): Map<Id, Id> {
    return this.#ensure('rootOfThread');
  }
  lastAuthorSeq(): Map<KeyHex, number> {
    return this.#ensure('lastAuthorSeq');
  }
  invites(): Map<KeyHex, Invite> {
    return this.#ensure('invites');
  }
  relays(): Map<KeyHex, Relay> {
    return this.#ensure('relays');
  }

  joinedByInvite(): Set<string> {
    if (!this.#cloned.has('joinedByInvite')) {
      this.#s.joinedByInvite = new Set(this.#s.joinedByInvite);
      this.#cloned.add('joinedByInvite');
      this.#dirty = true;
    }
    return this.#s.joinedByInvite;
  }

  community(): CommunityMeta {
    if (!this.#cloned.has('community')) {
      this.#s.community = {
        ...this.#s.community,
        successorKeys: [...this.#s.community.successorKeys],
      };
      this.#cloned.add('community');
      this.#dirty = true;
    }
    return this.#s.community;
  }

  #mut<T extends object>(
    container: Map<string, T>,
    tag: string,
    id: string,
    clone: (v: T) => T,
  ): T | undefined {
    const v = container.get(id);
    if (v === undefined) return undefined;
    const chave = `${tag}:${id}`;
    if (this.#clonedEntities.has(chave)) return v;
    const copia = clone(v);
    container.set(id, copia);
    this.#clonedEntities.add(chave);
    return copia;
  }

  mutMember(k: KeyHex): Member | undefined {
    return this.#mut(this.members(), 'm', k, (m) => ({ ...m, roleIds: new Set(m.roleIds) }));
  }

  mutRole(id: Id): Role | undefined {
    return this.#mut(this.roles(), 'r', id, (r) => ({ ...r, permissions: new Set(r.permissions) }));
  }

  mutCategory(id: Id): Category | undefined {
    return this.#mut(this.categories(), 'cat', id, (c) => ({ ...c }));
  }

  mutChannel(id: Id): Channel | undefined {
    return this.#mut(this.channels(), 'ch', id, (c) => ({
      ...c,
      readOnlyForRoleIds: new Set(c.readOnlyForRoleIds),
    }));
  }

  mutMessage(id: Id): MessageMeta | undefined {
    return this.#mut(this.messages(), 'msg', id, (m) => ({
      ...m,
      reactionEmojis: new Set(m.reactionEmojis),
    }));
  }

  setScalar<K extends Scalar>(k: K, v: DecisionState[K]): void {
    if (this.#s[k] === v) return;
    this.#s[k] = v;
    this.#dirty = true;
  }

  /** Força a materialização de `next` mesmo quando o conteúdo não mudou. */
  touch(): void {
    this.#dirty = true;
  }

  finish(): DecisionState {
    return this.#dirty ? this.#s : this.prev;
  }
}
