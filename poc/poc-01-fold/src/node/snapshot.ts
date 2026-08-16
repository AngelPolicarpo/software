/**
 * Snapshot de `DecisionState` — backend-v2.md §10.6, e a regra de residencia de §8.1.
 *
 * - O snapshot serializa o `DS` EXCETO `messages`/`threadsByRoot`.
 * - Carrega o `foldBuildId` (hash do binario do `fold`); se nao bater, e DESCARTADO e o
 *   `fold` recomeca do 0. Snapshot e CACHE, nunca verdade.
 * - `messages`/`threadsByRoot` sao rematerializados a partir de `view.db` (§8.1,
 *   `residency = 'full'`) — a unica leitura de banco que o `fold` faz, deliberadamente
 *   delimitada e deterministica.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  emptyRing,
  emptyState,
  type Category,
  type Channel,
  type DecisionState,
  type Invite,
  type Member,
  type Role,
} from '../fold/state.ts';
import type { DB } from './viewdb.ts';

const FOLD_SOURCES = [
  'src/fold/index.ts',
  'src/fold/apply.ts',
  'src/fold/state.ts',
  'src/fold/limits.ts',
  'src/fold/rank.ts',
  'src/fold/targets.ts',
  'src/fold/effects.ts',
  'src/codec/opCodec.ts',
  'src/codec/wire.ts',
  'src/codec/idgen.ts',
  'src/protocol/constants.ts',
  'src/protocol/permissions.ts',
  'src/protocol/kinds.ts',
  'src/protocol/errors.ts',
];

let cachedBuildId: string | null = null;

/** §10.6 — hash do binario do `fold`. Muda => snapshot antigo e descartado. */
export function foldBuildId(root: string): string {
  if (cachedBuildId) return cachedBuildId;
  const h = createHash('sha256');
  for (const f of FOLD_SOURCES) {
    try {
      h.update(readFileSync(`${root}/${f}`));
    } catch {
      h.update(f);
    }
  }
  cachedBuildId = h.digest('hex').slice(0, 32);
  return cachedBuildId;
}

const hex = (b: Buffer): string => b.toString('hex');
const buf = (s: string): Buffer => Buffer.from(s, 'hex');

/**
 * JSON CANONICO — chaves ordenadas, recursivamente.
 *
 * OBS-03 (REPORT.md): sem isto, a ORDEM DE INSERCAO das propriedades entra no blob. Uma
 * entidade que ganha um campo opcional depois (ex.: `channel.update` setando `topic` num
 * canal que nasceu sem) serializa numa ordem; a mesma entidade reconstruida de um
 * snapshot serializa noutra. O conteudo e identico e o `fold` nunca divergiu — mas
 * qualquer verificacao que compare o BLOB (hash de snapshot, checksum de integridade,
 * comparacao entre replicas) acusaria falso positivo. §10.6 nao exige forma canonica
 * para o snapshot; deveria.
 */
function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export function serializeDs(s: DecisionState): Buffer {
  const o = {
    communityId: s.communityId,
    communityKey: hex(s.communityKey),
    interpretedSeq: s.interpretedSeq,
    opVersionSeen: s.opVersionSeen,
    partialInterpretation: s.partialInterpretation,
    lastHostTs: s.lastHostTs,
    communityInvalid: s.communityInvalid,
    community: {
      ...s.community,
      hostKey: hex(s.community.hostKey),
      founderKey: hex(s.community.founderKey),
      blobsKey: hex(s.community.blobsKey),
      successorKeys: s.community.successorKeys.map(hex),
    },
    members: [...s.members].map(([k, m]) => [
      k,
      {
        ...m,
        roleIds: [...m.roleIds].sort(),
        blobsCoreKey: m.blobsCoreKey ? hex(m.blobsCoreKey) : undefined,
        bannedBy: m.bannedBy ? hex(m.bannedBy) : undefined,
        opBudget: m.opBudget,
        byteBudget: undefined,
      },
    ]),
    roles: [...s.roles].map(([k, r]) => [k, { ...r, permissions: [...r.permissions].sort((a, b) => a - b) }]),
    categories: [...s.categories],
    channels: [...s.channels].map(([k, c]) => [k, { ...c, readOnlyForRoleIds: [...c.readOnlyForRoleIds].sort() }]),
    channelNameIndex: [...s.channelNameIndex],
    invites: [...s.invites].map(([k, i]) => [k, { ...i, createdBy: hex(i.createdBy) }]),
    joinedByInvite: [...s.joinedByInvite].sort(),
    lastAuthorSeq: [...s.lastAuthorSeq].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  };
  return Buffer.from(canonicalJson(o), 'utf8');
}

export function deserializeDs(blob: Buffer): DecisionState {
  const o = JSON.parse(blob.toString('utf8'));
  const s = emptyState(buf(o.communityKey), o.communityId);
  s.interpretedSeq = o.interpretedSeq;
  s.opVersionSeen = o.opVersionSeen;
  s.partialInterpretation = o.partialInterpretation;
  s.lastHostTs = o.lastHostTs;
  s.communityInvalid = o.communityInvalid;
  s.community = {
    ...o.community,
    hostKey: buf(o.community.hostKey),
    founderKey: buf(o.community.founderKey),
    blobsKey: buf(o.community.blobsKey),
    successorKeys: (o.community.successorKeys as string[]).map(buf),
  };
  for (const [k, m] of o.members as Array<[string, Record<string, unknown>]>) {
    const ring = (m.opBudget as Member['opBudget']) ?? emptyRing();
    s.members.set(k, {
      ...(m as unknown as Member),
      roleIds: new Set(m.roleIds as string[]),
      blobsCoreKey: m.blobsCoreKey ? buf(m.blobsCoreKey as string) : undefined,
      bannedBy: m.bannedBy ? buf(m.bannedBy as string) : undefined,
      opBudget: ring,
      byteBudget: ring,
    });
  }
  for (const [k, r] of o.roles as Array<[string, Record<string, unknown>]>) {
    s.roles.set(k, { ...(r as unknown as Role), permissions: new Set(r.permissions as number[]) });
  }
  for (const [k, c] of o.categories as Array<[string, Category]>) s.categories.set(k, c);
  for (const [k, c] of o.channels as Array<[string, Record<string, unknown>]>) {
    s.channels.set(k, { ...(c as unknown as Channel), readOnlyForRoleIds: new Set(c.readOnlyForRoleIds as string[]) });
  }
  for (const [k, v] of o.channelNameIndex as Array<[string, string]>) s.channelNameIndex.set(k, v);
  for (const [k, i] of o.invites as Array<[string, Record<string, unknown>]>) {
    s.invites.set(k, { ...(i as unknown as Invite), createdBy: buf(i.createdBy as string) });
  }
  for (const p of o.joinedByInvite as string[]) s.joinedByInvite.add(p);
  for (const [k, v] of o.lastAuthorSeq as Array<[string, number]>) s.lastAuthorSeq.set(k, v);
  return s;
}

/**
 * §8.1 (regra de residencia) — rematerializa `messages`/`threadsByRoot` a partir de
 * `view.db`, que os materializa. Leitura de chave primaria, deterministica e local,
 * sobre o MESMO PREFIXO que o `fold` ja interpretou.
 */
export function loadMessagesFromView(db: DB, communityId: string, s: DecisionState): void {
  const rows = db
    .prepare(
      'SELECT id, channel_id, author_key, deleted_at, pinned, thread_id, hidden_by_ban, orphaned FROM messages WHERE community_id = ? ORDER BY id',
    )
    .all(communityId) as Array<{
    id: string;
    channel_id: string;
    author_key: Buffer;
    deleted_at: number | null;
    pinned: number;
    thread_id: string | null;
    hidden_by_ban: number;
    orphaned: number;
  }>;
  const emojis = new Map<string, Set<string>>();
  for (const r of db
    .prepare('SELECT DISTINCT message_id, emoji FROM reactions WHERE community_id = ?')
    .all(communityId) as Array<{ message_id: string; emoji: string }>) {
    let set = emojis.get(r.message_id);
    if (!set) {
      set = new Set();
      emojis.set(r.message_id, set);
    }
    set.add(r.emoji);
  }
  s.messages.clear();
  for (const r of rows) {
    s.messages.set(r.id, {
      channelId: r.channel_id,
      authorKey: r.author_key.toString('hex'),
      deletedAt: r.deleted_at ?? undefined,
      pinned: r.pinned === 1,
      threadId: r.thread_id ?? undefined,
      hasAttachment: false,
      attachmentBytes: 0,
      reactionEmojis: emojis.get(r.id) ?? new Set(),
      hiddenByBan: r.hidden_by_ban === 1,
      orphaned: r.orphaned === 1,
    });
  }
}

export function saveSnapshot(db: DB, communityId: string, s: DecisionState, buildId: string, at: number): void {
  db.prepare(
    'INSERT OR REPLACE INTO ds_snapshot(community_id, interpreted_seq, blob, fold_build_id, taken_at) VALUES (?,?,?,?,?)',
  ).run(communityId, s.interpretedSeq, serializeDs(s), buildId, at);
}

/** Devolve `null` quando nao ha snapshot ou o `foldBuildId` nao bate (§10.6). */
export function loadSnapshot(db: DB, communityId: string, buildId: string): DecisionState | null {
  const row = db
    .prepare('SELECT interpreted_seq, blob, fold_build_id FROM ds_snapshot WHERE community_id = ?')
    .get(communityId) as { interpreted_seq: number; blob: Buffer; fold_build_id: string } | undefined;
  if (!row) return null;
  if (row.fold_build_id !== buildId) return null;
  try {
    const s = deserializeDs(row.blob);
    loadMessagesFromView(db, communityId, s);
    return s;
  } catch {
    return null; // snapshot inconsistente => recomeca do seq 0 (§10.3)
  }
}
