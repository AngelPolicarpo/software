/**
 * `DecisionState` — backend-v2.md §8.1 (schema exato).
 *
 * Tudo aqui e derivado do log e recomputavel. O `fold` NUNCA le `view.db` nem
 * `manifest.db` (§1.3 regra 1); recebe o `DS` como argumento e devolve o proximo.
 *
 * O contrato de §8.0 exige `next === prev` quando o desfecho nao e `APPLIED`. Para nao
 * pagar O(estado) por registro, a mutacao usa copy-on-write por container e por entidade
 * (`Draft` abaixo): `prev` fica intacto, `next` compartilha tudo que nao mudou.
 */
import { QUOTA_BYTES_PER_WINDOW, QUOTA_OPS_PER_WINDOW, QUOTA_WINDOW_SEQS } from '../protocol/constants.ts';

export type Id = string;
export type KeyHex = string;

export type MemberState = 'active' | 'left' | 'banned';

/**
 * R-15 — cota deterministica por autor, em janela de `QUOTA_WINDOW_SEQS` registros.
 *
 * BURACO DE SPEC HOLE-05: §8.1 declara o campo com o tipo `RingCounter` e §8.3 R-15
 * define a semantica em uma linha, mas o schema do contador nao existe em lugar nenhum
 * da spec. A leitura literal implementada aqui — janela deslizante sobre o `seq` do log,
 * contando ops e bytes de payload dos registros do autor com
 * `seq > seqCorrente - QUOTA_WINDOW_SEQS` — e deterministica e esta declarada como
 * ASSUMPTION-05. Precisa virar schema normativo antes da fase 1.
 */
export type RingCounter = {
  /** pares (seq, bytes) dentro da janela, em ordem crescente de seq */
  entries: Array<{ seq: number; bytes: number }>;
  ops: number;
  bytes: number;
};

export function emptyRing(): RingCounter {
  return { entries: [], ops: 0, bytes: 0 };
}

function pruneRing(r: RingCounter, seq: number): RingCounter {
  const floor = seq - QUOTA_WINDOW_SEQS;
  if (r.entries.length === 0 || r.entries[0].seq > floor) return r;
  let i = 0;
  let ops = r.ops;
  let bytes = r.bytes;
  while (i < r.entries.length && r.entries[i].seq <= floor) {
    ops -= 1;
    bytes -= r.entries[i].bytes;
    i++;
  }
  return { entries: r.entries.slice(i), ops, bytes };
}

/** Devolve `null` se couber (com o novo registro contado), ou o motivo do estouro. */
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
  return {
    entries: [...p.entries, { seq, bytes }],
    ops: p.ops + 1,
    bytes: p.bytes + bytes,
  };
}

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

export type CommunityMeta = {
  exists: boolean;
  hostKey: Buffer;
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
};

export type DecisionState = {
  /** hex64 da chave publica do core do log (§6.2) */
  communityId: string;
  /** os 32 bytes da mesma chave — material de comparacao do estagio 3 e de `entityId` */
  communityKey: Buffer;
  interpretedSeq: number;
  opVersionSeen: number;
  partialInterpretation: boolean;
  lastHostTs: number;

  /**
   * R-27 / §8.4.1: comunidade marcada `invalid` quando o lote de genese desvia da forma.
   * BURACO DE SPEC HOLE-11: §8.1 nao tem campo para isso, embora R-27 e §8.4.1 exijam
   * o estado. Declarado como ASSUMPTION-11.
   */
  communityInvalid: boolean;

  community: CommunityMeta;
  members: Map<KeyHex, Member>;
  roles: Map<Id, Role>;
  categories: Map<Id, Category>;
  channels: Map<Id, Channel>;
  channelNameIndex: Map<string, Id>;
  messages: Map<Id, MessageMeta>;
  threadsByRoot: Map<Id, Id>;
  invites: Map<KeyHex, Invite>;
  joinedByInvite: Set<string>;
  lastAuthorSeq: Map<KeyHex, number>;
  relays: Map<KeyHex, unknown>;
};

export type Invite = {
  createdBy: Buffer;
  createdAt: number;
  expiresAt?: number;
  maxUses?: number;
  uses: number;
  revokedAt?: number;
};

export function emptyState(communityKey: Buffer, communityId: string): DecisionState {
  return {
    communityId,
    communityKey,
    interpretedSeq: -1,
    opVersionSeen: 0,
    partialInterpretation: false,
    lastHostTs: 0,
    communityInvalid: false,
    community: {
      exists: false,
      hostKey: Buffer.alloc(32),
      founderKey: Buffer.alloc(32),
      blobsKey: Buffer.alloc(32),
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
    threadsByRoot: new Map(),
    invites: new Map(),
    joinedByInvite: new Set(),
    lastAuthorSeq: new Map(),
    relays: new Map(),
  };
}

// ---------------------------------------------------------------------------------
// Copy-on-write
// ---------------------------------------------------------------------------------

type Container =
  | 'members'
  | 'roles'
  | 'categories'
  | 'channels'
  | 'channelNameIndex'
  | 'messages'
  | 'threadsByRoot'
  | 'lastAuthorSeq'
  | 'invites'
  | 'joinedByInvite';

export class Draft {
  readonly prev: DecisionState;
  private s: DecisionState;
  private cloned = new Set<Container | 'community'>();
  private clonedEntities = new Set<string>();
  private dirty = false;

  constructor(prev: DecisionState) {
    this.prev = prev;
    this.s = { ...prev };
  }

  /** Estado corrente do rascunho (leituras). */
  get state(): DecisionState {
    return this.s;
  }

  private ensure<T extends Container>(name: T): DecisionState[T] {
    if (!this.cloned.has(name)) {
      const src = this.s[name];
      this.s[name] = (src instanceof Map ? new Map(src) : new Set(src)) as DecisionState[T];
      this.cloned.add(name);
      this.dirty = true;
    }
    return this.s[name];
  }

  members(): Map<KeyHex, Member> {
    return this.ensure('members');
  }
  roles(): Map<Id, Role> {
    return this.ensure('roles');
  }
  categories(): Map<Id, Category> {
    return this.ensure('categories');
  }
  channels(): Map<Id, Channel> {
    return this.ensure('channels');
  }
  channelNameIndex(): Map<string, Id> {
    return this.ensure('channelNameIndex');
  }
  messages(): Map<Id, MessageMeta> {
    return this.ensure('messages');
  }
  threadsByRoot(): Map<Id, Id> {
    return this.ensure('threadsByRoot');
  }
  lastAuthorSeq(): Map<KeyHex, number> {
    return this.ensure('lastAuthorSeq');
  }
  invites(): Map<KeyHex, Invite> {
    return this.ensure('invites');
  }
  joinedByInvite(): Set<string> {
    return this.ensure('joinedByInvite');
  }

  /** Devolve uma copia mutavel da entidade, ja instalada no container clonado. */
  mutMember(k: KeyHex): Member | undefined {
    const m = this.members().get(k);
    if (!m) return undefined;
    const tag = `m:${k}`;
    if (this.clonedEntities.has(tag)) return m;
    const copy: Member = { ...m, roleIds: new Set(m.roleIds), opBudget: m.opBudget, byteBudget: m.byteBudget };
    this.members().set(k, copy);
    this.clonedEntities.add(tag);
    return copy;
  }

  mutRole(id: Id): Role | undefined {
    const r = this.roles().get(id);
    if (!r) return undefined;
    const tag = `r:${id}`;
    if (this.clonedEntities.has(tag)) return r;
    const copy: Role = { ...r, permissions: new Set(r.permissions) };
    this.roles().set(id, copy);
    this.clonedEntities.add(tag);
    return copy;
  }

  mutCategory(id: Id): Category | undefined {
    const c = this.categories().get(id);
    if (!c) return undefined;
    const tag = `cat:${id}`;
    if (this.clonedEntities.has(tag)) return c;
    const copy: Category = { ...c };
    this.categories().set(id, copy);
    this.clonedEntities.add(tag);
    return copy;
  }

  mutChannel(id: Id): Channel | undefined {
    const c = this.channels().get(id);
    if (!c) return undefined;
    const tag = `ch:${id}`;
    if (this.clonedEntities.has(tag)) return c;
    const copy: Channel = { ...c, readOnlyForRoleIds: new Set(c.readOnlyForRoleIds) };
    this.channels().set(id, copy);
    this.clonedEntities.add(tag);
    return copy;
  }

  mutMessage(id: Id): MessageMeta | undefined {
    const m = this.messages().get(id);
    if (!m) return undefined;
    const tag = `msg:${id}`;
    if (this.clonedEntities.has(tag)) return m;
    const copy: MessageMeta = { ...m, reactionEmojis: new Set(m.reactionEmojis) };
    this.messages().set(id, copy);
    this.clonedEntities.add(tag);
    return copy;
  }

  community(): CommunityMeta {
    if (!this.cloned.has('community')) {
      this.s.community = { ...this.s.community, successorKeys: [...this.s.community.successorKeys] };
      this.cloned.add('community');
      this.dirty = true;
    }
    return this.s.community;
  }

  setScalar<K extends 'interpretedSeq' | 'opVersionSeen' | 'partialInterpretation' | 'lastHostTs' | 'communityInvalid'>(
    k: K,
    v: DecisionState[K],
  ): void {
    if (this.s[k] === v) return;
    this.s[k] = v;
    this.dirty = true;
  }

  /** `next` do FoldResult. Devolve `prev` intacto quando nada mudou. */
  finish(): DecisionState {
    return this.dirty ? this.s : this.prev;
  }

  /** Forca a materializacao de `next` mesmo sem mudanca de conteudo. */
  touch(): void {
    this.dirty = true;
  }
}
