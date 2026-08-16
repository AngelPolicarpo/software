/**
 * Simulador puro do `fold` — sem Hypercore, sem SQLite, sem I/O.
 *
 * §28.1 exige que os unitarios de `fold`/`opCodec`/`permissions`/`idgen` sejam
 * "sincronos, sem I/O". Este simulador monta `HostRecord`s assinados e os interpreta
 * direto, mantendo o `DecisionState` em memoria — a admissao de §11.4 em miniatura,
 * suficiente para a tabela de casos por `kind` x estagio x regra x fronteira.
 */
import { K } from '../protocol/kinds.ts';
import { ALL_PERMS, BASE_ROLE_INITIAL_PERMS, PERM } from '../protocol/permissions.ts';
import { blake2b256, keyPairFromSeed, sign, type KeyPair } from '../crypto/index.ts';
import { entityId } from '../codec/idgen.ts';
import {
  encodeEnvelope,
  encodeHostRecord,
  encodeOp,
  encodePayload,
  hostRecSigningHash,
  opSigningHash,
  type Envelope,
  type Payload,
} from '../codec/opCodec.ts';
import { foldRecord, newMetrics, type FoldResult } from '../fold/index.ts';
import { emptyState, type DecisionState } from '../fold/state.ts';
import { CHANNEL_TYPE } from '../fold/limits.ts';
import { RANK_BOTTOM, RANK_TOP } from '../fold/rank.ts';
import { OP_VERSION } from '../protocol/constants.ts';

const ZERO32 = Buffer.alloc(32);
const ZERO64 = Buffer.alloc(64);

export type SimActor = { name: string; keys: KeyPair; nextAuthorSeq: number };

export class Sim {
  readonly coreKeys: KeyPair;
  readonly communityKey: Buffer;
  readonly metrics = newMetrics();
  ds: DecisionState;
  seq = 0;
  hostTs: number;
  readonly actors = new Map<string, SimActor>();
  ids = { founderRole: '', baseRole: '', modRole: '', category: '', channel: '' };
  invite!: KeyPair;

  constructor(seedTag = 'sim/1', startTs = 1_755_000_000_000) {
    this.coreKeys = keyPairFromSeed(blake2b256('ns/log/1', Buffer.from(seedTag)));
    this.communityKey = this.coreKeys.publicKey;
    this.ds = emptyState(this.communityKey, this.communityKey.toString('hex'));
    this.hostTs = startTs;
  }

  actor(name: string): SimActor {
    let a = this.actors.get(name);
    if (!a) {
      a = { name, keys: keyPairFromSeed(blake2b256(`sim-actor/${name}`, this.communityKey)), nextAuthorSeq: 1 };
      this.actors.set(name, a);
    }
    return a;
  }

  envelope(
    who: string,
    kind: number,
    payload: Payload,
    opts?: { ts?: number; authorSeq?: number; communityKey?: Buffer; v?: number; badSig?: boolean },
  ): Envelope {
    const a = this.actor(who);
    const authorSeq = opts?.authorSeq ?? a.nextAuthorSeq++;
    const opBytes = encodeOp({
      v: opts?.v ?? OP_VERSION,
      communityId: opts?.communityKey ?? this.communityKey,
      kind,
      author: a.keys.publicKey,
      authorSeq,
      ts: opts?.ts ?? this.hostTs,
      payload: encodePayload(kind, payload),
    });
    const sig = opts?.badSig ? Buffer.alloc(64, 7) : sign(opSigningHash(opBytes), a.keys.secretKey);
    return { op: opBytes, sig };
  }

  record(env: Envelope, opts?: { hostTs?: number; flags?: number; badHostSig?: boolean }): Buffer {
    const envBytes = encodeEnvelope(env);
    const hostTs = opts?.hostTs ?? this.hostTs;
    const flags = opts?.flags ?? 0;
    const hostSig = opts?.badHostSig
      ? Buffer.alloc(64, 9)
      : sign(hostRecSigningHash(envBytes, hostTs, flags), this.coreKeys.secretKey);
    return encodeHostRecord({ envelope: envBytes, hostTs, flags, hostSig });
  }

  /** Interpreta um registro e AVANCA o estado (o caminho normal). */
  apply(rec: Buffer): FoldResult {
    const r = foldRecord(this.ds, rec, this.seq, this.metrics);
    this.ds = r.next;
    this.seq++;
    return r;
  }

  /** Interpreta SEM avancar — para testar um caso isolado contra o mesmo `prev`. */
  probe(rec: Buffer): FoldResult {
    return foldRecord(this.ds, rec, this.seq, this.metrics);
  }

  /** Atalho: monta, carimba e interpreta. */
  submit(
    who: string,
    kind: number,
    payload: Payload,
    opts?: {
      ts?: number;
      authorSeq?: number;
      communityKey?: Buffer;
      v?: number;
      badSig?: boolean;
      hostTs?: number;
      flags?: number;
      badHostSig?: boolean;
      advance?: boolean;
    },
  ): FoldResult {
    const env = this.envelope(who, kind, payload, opts);
    const rec = this.record(env, opts);
    return opts?.advance === false ? this.probe(rec) : this.apply(rec);
  }

  tick(ms = 10): number {
    this.hostTs += ms;
    return this.hostTs;
  }

  entity(t: 'role' | 'category' | 'channel' | 'message', who: string, authorSeq: number): string {
    return entityId(t, this.communityKey, this.actor(who).keys.publicKey, authorSeq);
  }

  /** Genese normativa de §19.1 / R-27, mais um convite e alguns membros. */
  bootstrap(members = 4): void {
    const f = this.actor('fundador');
    this.ids.founderRole = this.entity('role', 'fundador', 2);
    this.ids.baseRole = this.entity('role', 'fundador', 3);
    this.ids.category = this.entity('category', 'fundador', 5);
    this.ids.channel = this.entity('channel', 'fundador', 6);

    const must = (r: FoldResult, what: string): void => {
      if (r.decision !== 'APPLIED') throw new Error(`sim.bootstrap ${what}: ${r.decision} ${r.reason}`);
    };
    must(this.submit('fundador', K.COMMUNITY_CREATE, { name: 'Sim', iconColor: 1, blobsKey: ZERO32 }), 'community.create');
    must(this.submit('fundador', K.ROLE_CREATE, { name: 'Fundador', color: 0, permissions: [...ALL_PERMS], mentionable: true }), 'role.create F');
    must(this.submit('fundador', K.ROLE_CREATE, { name: 'Membro', color: 1, permissions: [...BASE_ROLE_INITIAL_PERMS], mentionable: false }), 'role.create base');
    must(this.submit('fundador', K.MEMBER_JOIN, { invitePublicKey: ZERO32, joinProof: ZERO64, displayName: 'Fundador', avatarColor: 1, blobsCoreKey: ZERO32 }), 'member.join');
    must(this.submit('fundador', K.CATEGORY_CREATE, { name: 'GERAL' }), 'category.create');
    must(this.submit('fundador', K.CHANNEL_CREATE, { categoryId: this.ids.category, type: CHANNEL_TYPE.text, name: 'geral', readOnlyForRoleIds: [] }), 'channel.create');

    this.tick();
    this.invite = keyPairFromSeed(blake2b256('invite-seed/1', this.communityKey));
    must(this.submit('fundador', K.INVITE_CREATE, { invitePublicKey: this.invite.publicKey, maxUses: 10000 }), 'invite.create');

    for (let i = 0; i < members; i++) {
      const r = this.join(`m${i}`);
      if (r.decision !== 'APPLIED') throw new Error(`sim.bootstrap join m${i}: ${r.decision} ${r.reason}`);
    }

    if (members < 2) return; // sem membros nao ha a quem atribuir o cargo de moderador

    this.tick();
    const modSeq = f.nextAuthorSeq;
    must(
      this.submit('fundador', K.ROLE_CREATE, {
        name: 'Moderador',
        color: 2,
        permissions: [PERM.manage_roles, PERM.manage_channels, PERM.manage_messages, PERM.ban_members, PERM.send_messages, PERM.add_reactions, PERM.create_invite, PERM.kick_members],
        mentionable: true,
        afterRank: RANK_BOTTOM,
        beforeRank: RANK_TOP,
      }),
      'role.create mod',
    );
    this.ids.modRole = this.entity('role', 'fundador', modSeq);
    this.tick();
    must(this.submit('fundador', K.MEMBER_SET_ROLES, { targetKey: this.actor('m0').keys.publicKey, roleIds: [this.ids.baseRole, this.ids.modRole] }), 'setRoles m0');
    this.tick();
    must(this.submit('fundador', K.MEMBER_SET_ROLES, { targetKey: this.actor('m1').keys.publicKey, roleIds: [this.ids.baseRole, this.ids.modRole] }), 'setRoles m1');
  }

  /** Admite um ator novo pelo convite (R-9). */
  join(name: string): FoldResult {
    const a = this.actor(name);
    this.tick();
    const proof = sign(
      blake2b256('invite-join/1', this.communityKey, this.invite.publicKey, a.keys.publicKey),
      this.invite.secretKey,
    );
    return this.submit(name, K.MEMBER_JOIN, {
      invitePublicKey: this.invite.publicKey,
      joinProof: proof,
      displayName: name.length >= 2 ? name : `${name}-x`,
      avatarColor: 2,
      blobsCoreKey: ZERO32,
    });
  }

  /** Envia uma mensagem e devolve o id determinístico dela. */
  sendMessage(who: string, content = 'ola mundo', channelId?: string): { res: FoldResult; id: string } {
    const a = this.actor(who);
    const seq = a.nextAuthorSeq;
    this.tick();
    const res = this.submit(who, K.MESSAGE_SEND, {
      channelId: channelId ?? this.ids.channel,
      content,
      mentions: [],
    });
    return { res, id: this.entity('message', who, seq) };
  }
}
