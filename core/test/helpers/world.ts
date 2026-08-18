/**
 * Fábrica de registros e de mundo para os testes do `fold`.
 *
 * Não é código de produto: mora em `test/` justamente porque o `fold` é puro e §28.1 exige
 * que ele seja testável **sem mock de rede, relógio ou banco** (§4). Tudo aqui é montar bytes
 * assinados e chamar `foldRecord`.
 */

import sodium from 'sodium-native';

import {
  KINDS,
  OP_VERSION,
  decodeEnvelope,
  decodeHostRecord,
  decodeOp,
  encodeEnvelope,
  encodeHostRecord,
  encodeOp,
  encodePayload,
  hostRecordSigningHash,
  opSigningHash,
  type KindName,
  type PayloadOf,
  type SequenceScope,
} from '../../src/l1/opCodec/index.ts';
import { ALL_PERMISSIONS, permissionNumber } from '../../src/l1/permissions/index.ts';
import { entityId } from '../../src/l1/idgen/index.ts';
import {
  emptyState,
  foldRecord,
  newMetrics,
  type DecisionState,
  type FoldMetrics,
  type FoldResult,
} from '../../src/l1/fold/index.ts';

export type Keypair = { publicKey: Buffer; secretKey: Buffer };

export function keypairFromSeed(label: string): Keypair {
  const seed = Buffer.alloc(32);
  Buffer.from(label, 'utf8').copy(seed);
  const publicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
  const secretKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
  sodium.crypto_sign_seed_keypair(publicKey, secretKey, seed);
  return { publicKey, secretKey };
}

function sign(message: Uint8Array, secretKey: Buffer): Buffer {
  const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, message, secretKey);
  return sig;
}

export const ZERO32 = Buffer.alloc(32);
export const ZERO64 = Buffer.alloc(64);

export type RecordOptions<K extends KindName> = {
  readonly kind: K;
  readonly payload: PayloadOf<K>;
  readonly author: Keypair;
  readonly sequenceScope?: SequenceScope;
  readonly authorSeq: number;
  readonly ts?: number;
  readonly hostTs?: number;
  readonly flags?: number;
  /** Estraga a assinatura do autor (estágio 4). */
  readonly corruptSig?: boolean;
  /** Estraga a assinatura do host (estágio 1). */
  readonly corruptHostSig?: boolean;
  /** Sobrescreve o `communityId` da `Op` (estágio 3). */
  readonly communityId?: Buffer;
  /** Sobrescreve a versão do protocolo (estágio 2). */
  readonly v?: number;
  /** Sobrescreve o número do `kind` (estágio 2). */
  readonly kindNumber?: number;
  /** Bytes de recheio no payload, para exercitar os tetos dos estágios 0 e 13. */
  readonly padding?: number;
};

function defaultSequenceScope<K extends KindName>(kind: K, payload: PayloadOf<K>): SequenceScope {
  if (kind === 'message.send') {
    const channelId = (payload as unknown as PayloadOf<'message.send'>).channelId;
    return { kind: 'channel', channelId };
  }
  return { kind: 'community' };
}

/** Monta o `HostRecord` completo, como o Hypercore o devolveria. */
export function makeRecord<K extends KindName>(
  core: Keypair,
  o: RecordOptions<K>,
): Buffer {
  const hostTs = o.hostTs ?? 1_000_000;
  let payload = encodePayload(o.kind, o.payload);
  if (o.padding !== undefined && o.padding > 0) {
    payload = Buffer.concat([payload, Buffer.alloc(o.padding, 0x41)]);
  }
  const op = encodeOp({
    v: o.v ?? OP_VERSION,
    communityId: o.communityId ?? core.publicKey,
    kind: o.kindNumber ?? KINDS[o.kind],
    author: o.author.publicKey,
    sequenceScope: o.sequenceScope ?? defaultSequenceScope(o.kind, o.payload),
    authorSeq: o.authorSeq,
    ts: o.ts ?? hostTs,
    payload,
  });
  const sig = o.corruptSig === true ? Buffer.alloc(64, 0xff) : sign(opSigningHash(op), o.author.secretKey);
  const envelope = encodeEnvelope({ op, sig });
  const flags = o.flags ?? 0;
  const hostSig =
    o.corruptHostSig === true
      ? Buffer.alloc(64, 0xff)
      : sign(hostRecordSigningHash(envelope, hostTs, flags), core.secretKey);
  return encodeHostRecord({ envelope, hostTs, flags, hostSig });
}

/** O mundo de um teste: o core, o estado corrente e o `seq` do próximo registro. */
export class World {
  readonly core: Keypair;
  state: DecisionState;
  seq = 0;
  readonly metrics: FoldMetrics = newMetrics();
  readonly results: FoldResult[] = [];
  readonly authorSeq = new Map<string, number>();
  readonly sequenceScopes = new Map<string, SequenceScope>();
  /** O log cru, na ordem. É o que a reprojeção de §10.5 relê do zero. */
  readonly log: Uint8Array[] = [];

  constructor(core = keypairFromSeed('core')) {
    this.core = core;
    this.state = emptyState(core.publicKey);
  }

  /** Próximo `authorSeq` do autor, sem precisar contar à mão em cada teste. */
  next(author: Keypair): number {
    const hex = author.publicKey.toString('hex');
    const n = (this.authorSeq.get(hex) ?? 0) + 1;
    this.authorSeq.set(hex, n);
    return n;
  }

  /** Appenda um registro já montado e avança o `DS`. */
  push(rec: Uint8Array): FoldResult {
    const hostRecord = decodeHostRecord(rec);
    const envelope = hostRecord === null ? null : decodeEnvelope(hostRecord.envelope);
    const op = envelope === null ? null : decodeOp(envelope.op);
    if (op !== null) this.sequenceScopes.set(`${op.author.toString('hex')}:${op.authorSeq}`, op.sequenceScope);
    const r = foldRecord(this.state, rec, this.seq, this.metrics);
    this.state = r.next;
    this.log.push(rec);
    this.seq++;
    this.results.push(r);
    return r;
  }

  /** §10.5 — reprojeção total: reinterpreta o log inteiro a partir do `seq` 0. */
  reproject(): { state: DecisionState; results: FoldResult[] } {
    let state = emptyState(this.core.publicKey);
    const results: FoldResult[] = [];
    this.log.forEach((rec, seq) => {
      const r = foldRecord(state, rec, seq);
      state = r.next;
      results.push(r);
    });
    return { state, results };
  }

  submit<K extends KindName>(
    o: Omit<RecordOptions<K>, 'authorSeq'> & { authorSeq?: number },
  ): FoldResult {
    const sequenceScope = o.sequenceScope ?? this.scopeFor(o.kind, o.payload);
    const authorSeq = o.authorSeq ?? this.next(o.author);
    return this.push(makeRecord(this.core, { ...o, authorSeq, sequenceScope } as RecordOptions<K>));
  }

  private scopeFor<K extends KindName>(kind: K, payload: PayloadOf<K>): SequenceScope {
    if (kind === 'message.send') return { kind: 'channel', channelId: (payload as unknown as PayloadOf<'message.send'>).channelId };
    if (kind === 'thread.create') {
      const message = this.state.messages.get((payload as unknown as PayloadOf<'thread.create'>).rootMessageId);
      if (message !== undefined) return { kind: 'channel', channelId: message.channelId };
    }
    if (kind === 'message.edit' || kind === 'message.delete' || kind === 'message.pin' || kind === 'reaction.set') {
      const message = this.state.messages.get((payload as unknown as { messageId: string }).messageId);
      if (message !== undefined) return { kind: 'channel', channelId: message.channelId };
    }
    return { kind: 'community' };
  }

  id(t: Parameters<typeof entityId>[0], author: Keypair, authorSeq: number, explicitScope?: SequenceScope | string): string {
    const scope = explicitScope ?? this.sequenceScopes.get(`${author.publicKey.toString('hex')}:${authorSeq}`);
    const scopeKey =
      scope === undefined ? 'community' : typeof scope === 'string' ? scope : scope.kind === 'community' ? 'community' : `channel:${scope.channelId}`;
    return entityId(t, this.core.publicKey, author.publicKey, authorSeq, scopeKey);
  }
}

// ─── Lote de gênese (§19.1, forma normativa em R-27) ────────────────────────────────────

export type Genesis = {
  readonly world: World;
  readonly founder: Keypair;
  readonly founderRoleId: string;
  readonly baseRoleId: string;
  readonly categoryId: string;
  readonly channelId: string;
};

const TODAS = ALL_PERMISSIONS.map(permissionNumber);
/** §19.1: o cargo base nasce com estas quatro. */
const BASE_PERMS = ['send_messages', 'attach_files', 'add_reactions', 'voice_speak'].map((p) =>
  permissionNumber(p as (typeof ALL_PERMISSIONS)[number]),
);

/**
 * Carimbo base dos testes. É epoch real (2025-08) e não um número pequeno: os limites de §8.6
 * e o `CLOCK_ACCEPT_MS` de 24 h são janelas **relativas ao `hostTs`**, e com `hostTs` menor
 * que a janela um carimbo retroativo não consegue sair dela.
 */
export const T0 = 1_755_000_000_000;

/** Os seis registros de `seq` 0..5, na ordem exata que R-27 exige. */
export function genesis(world = new World(), founder = keypairFromSeed('founder')): Genesis {
  const hostTs = T0;
  world.submit({
    kind: 'community.create',
    author: founder,
    hostTs,
    payload: { name: 'Comunidade', iconColor: 0, blobsKey: keypairFromSeed('blobs').publicKey },
  });
  world.submit({
    kind: 'role.create',
    author: founder,
    hostTs,
    payload: { name: 'Fundador', color: 0, permissions: TODAS, mentionable: true },
  });
  world.submit({
    kind: 'role.create',
    author: founder,
    hostTs,
    payload: { name: 'Membro', color: 6, permissions: BASE_PERMS, mentionable: false },
  });
  world.submit({
    kind: 'member.join',
    author: founder,
    hostTs,
    payload: {
      invitePublicKey: ZERO32,
      joinProof: ZERO64,
      displayName: 'Fundador',
      avatarColor: 0,
      blobsCoreKey: keypairFromSeed('mb-founder').publicKey,
    },
  });
  world.submit({
    kind: 'category.create',
    author: founder,
    hostTs,
    payload: { name: 'GERAL' },
  });
  const categoryId = world.id('category', founder, 5);
  world.submit({
    kind: 'channel.create',
    author: founder,
    hostTs,
    payload: { categoryId, type: 0, name: 'geral', readOnlyForRoleIds: [] },
  });

  return {
    world,
    founder,
    founderRoleId: world.id('role', founder, 2),
    baseRoleId: world.id('role', founder, 3),
    categoryId,
    channelId: world.id('channel', founder, 6),
  };
}

/** Um membro novo, já dentro da comunidade, com o cargo base. */
export function joinMember(g: Genesis, label: string, hostTs = T0 + 100): Keypair {
  const membro = keypairFromSeed(label);
  const segredo = keypairFromSeed(`invite-${label}`);
  const conviteSeq = g.world.next(g.founder);
  g.world.push(
    makeRecord(g.world.core, {
      kind: 'invite.create',
      author: g.founder,
      authorSeq: conviteSeq,
      hostTs,
      payload: { invitePublicKey: segredo.publicKey },
    }),
  );
  g.world.submit({
    kind: 'member.join',
    author: membro,
    hostTs,
    payload: {
      invitePublicKey: segredo.publicKey,
      joinProof: joinProof(g.world.core.publicKey, segredo, membro.publicKey),
      displayName: label,
      avatarColor: 1,
      blobsCoreKey: keypairFromSeed(`mb-${label}`).publicKey,
    },
  });
  return membro;
}

/** R-9 — `BLAKE2b('invite-join/1' ‖ communityId ‖ invitePk ‖ author)`, assinado pelo convite. */
export function joinProof(communityId: Buffer, invite: Keypair, candidate: Buffer): Buffer {
  const digest = Buffer.alloc(32);
  sodium.crypto_generichash_batch(digest, [
    Buffer.from('invite-join/1', 'utf8'),
    communityId,
    invite.publicKey,
    candidate,
  ]);
  return sign(digest, invite.secretKey);
}

export { sign };
