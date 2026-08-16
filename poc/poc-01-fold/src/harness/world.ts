/**
 * Mundo do harness: uma comunidade real, com Hypercore real, host com fila de admissao
 * serializada, projetor SQLite pausavel e N clientes.
 *
 * Segue §5.3 (semente e namespaces deterministicos), §19.1 (criar comunidade / lote de
 * genese) e §12 (convite) na parte que o gate precisa.
 */
import Hypercore from 'hypercore';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { K } from '../protocol/kinds.ts';
import { ALL_PERMS, PERM } from '../protocol/permissions.ts';
import { BASE_ROLE_INITIAL_PERMS } from '../protocol/permissions.ts';
import { blake2b256, keyPairFromSeed, randomBytes, sign, type KeyPair } from '../crypto/index.ts';
import { entityId } from '../codec/idgen.ts';
import { RANK_BOTTOM, RANK_TOP } from '../fold/rank.ts';
import { CHANNEL_TYPE } from '../fold/limits.ts';
import { Client } from '../client/client.ts';
import { CommunityHost, type Clock, type HostOpts } from '../host/host.ts';
import { Replica } from '../node/replica.ts';

const ZERO32 = Buffer.alloc(32);
const ZERO64 = Buffer.alloc(64);

/** Relogio injetavel (POC-01, linha "Ambiente"). Nunca `Date.now()` direto no harness. */
export class TestClock implements Clock {
  private t: number;
  constructor(start: number) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(t: number): void {
    this.t = t;
  }
}

export type WorldOpts = {
  dir: string;
  root: string;
  clients: number;
  batch: number;
  groupCommitMax?: number;
  clockStart?: number;
};

export type World = {
  host: CommunityHost;
  clock: TestClock;
  founder: Client;
  clients: Client[];
  communityKey: Buffer;
  communityId: string;
  coreKeyPair: KeyPair;
  blobsKeyPair: KeyPair;
  dir: string;
  hostOpts: HostOpts;
  ids: {
    founderRole: string;
    baseRole: string;
    generalCategory: string;
    generalChannel: string;
    modRole: string;
    targetRole: string;
  };
  invite: { keys: KeyPair; secret: Buffer };
  /** cria uma prova de adesao valida para um candidato (R-9) */
  joinProof: (candidate: Buffer) => Buffer;
  /** admite uma identidade nova pelo convite; devolve o cliente ja membro */
  admit: (name: string, keys?: KeyPair) => Promise<Client>;
  /** abre N replicas independentes, replica o core e interpreta tudo */
  replicas: (n: number, tag: string) => Promise<Replica[]>;
  close: () => Promise<void>;
};

export const DEFAULT_HOST_OPTS = {
  batch: 256,
  rejectedLogMax: 2000,
  groupCommitWindowMs: 4,
  groupCommitMax: 64,
  snapshotIntervalSeqs: 5000,
};

export async function createWorld(opts: WorldOpts): Promise<World> {
  mkdirSync(opts.dir, { recursive: true });
  const clock = new TestClock(opts.clockStart ?? 1_755_000_000_000);

  // §5.3 — semente de comunidade e namespaces deterministicos.
  const communitySeed = randomBytes(32);
  const coreKeyPair = keyPairFromSeed(blake2b256('ns/log/1', communitySeed));
  const blobsKeyPair = keyPairFromSeed(blake2b256('ns/blobs/1', communitySeed));
  const communityKey = coreKeyPair.publicKey;
  const communityId = communityKey.toString('hex');

  // `compat: true` faz `core.key === keyPair.publicKey`, que e o que §5.3/§6.2 assumem
  // ao dizer `communityId = hex(logKeyPair.publicKey)` e `coreKey = id`. Ver OBS-01.
  const core = new Hypercore(join(opts.dir, 'core'), { keyPair: coreKeyPair, compat: true });
  await core.ready();

  const hostOpts: HostOpts = {
    ...DEFAULT_HOST_OPTS,
    ...opts,
    batch: opts.batch,
    groupCommitMax: opts.groupCommitMax ?? DEFAULT_HOST_OPTS.groupCommitMax,
    root: opts.root,
  };
  const host = new CommunityHost(core, coreKeyPair, join(opts.dir, 'view.db'), clock, hostOpts);

  // Identidade do fundador — SEPARADA da chave do core (§5.1/§5.3).
  const founderSeed = randomBytes(32);
  const founder = new Client('founder', communityKey, keyPairFromSeed(founderSeed));
  const memberBlobsCore = keyPairFromSeed(
    blake2b256('ns/memberblobs/1', founderSeed, communityKey),
  );

  // --- Lote de genese (§19.1 passo 4, forma normativa em R-27) ---------------------
  const t0 = clock.now();
  const eid = (t: 'role' | 'category' | 'channel', authorSeq: number): string =>
    entityId(t, communityKey, founder.keys.publicKey, authorSeq);

  const founderRole = eid('role', 2);
  const baseRole = eid('role', 3);
  const generalCategory = eid('category', 5);
  const generalChannel = eid('channel', 6);

  const genesis = [
    founder.build(K.COMMUNITY_CREATE, {
      name: 'Comunidade POC-01',
      iconColor: 3,
      blobsKey: blobsKeyPair.publicKey,
    }, t0),
    founder.build(K.ROLE_CREATE, {
      name: 'Fundador',
      color: 0,
      permissions: [...ALL_PERMS], // §19.1: o Fundador recebe as 17
      mentionable: true,
    }, t0),
    founder.build(K.ROLE_CREATE, {
      name: 'Membro',
      color: 1,
      permissions: [...BASE_ROLE_INITIAL_PERMS],
      mentionable: false, // §6.4: cargo base nasce `false`
    }, t0),
    founder.build(K.MEMBER_JOIN, {
      invitePublicKey: ZERO32, // R-27: zerados na genese
      joinProof: ZERO64,
      displayName: 'Fundador',
      avatarColor: 2,
      blobsCoreKey: memberBlobsCore.publicKey,
    }, t0),
    founder.build(K.CATEGORY_CREATE, { name: 'GERAL' }, t0),
    founder.build(K.CHANNEL_CREATE, {
      categoryId: generalCategory,
      type: CHANNEL_TYPE.text,
      name: 'geral',
      readOnlyForRoleIds: [],
    }, t0),
  ];
  // §19.1 passo 5: UMA chamada `core.append(lote)`. Ou os 6 entram, ou nenhum.
  await host.appendGenesis(genesis, t0);
  assertGenesis(host, founderRole, baseRole, generalCategory, generalChannel);

  // --- Convite (§12.1/§12.2) --------------------------------------------------------
  const inviteSecret = randomBytes(10);
  const inviteKeys = keyPairFromSeed(blake2b256('invite-seed/1', inviteSecret));
  const joinProof = (candidate: Buffer): Buffer =>
    sign(blake2b256('invite-join/1', communityKey, inviteKeys.publicKey, candidate), inviteKeys.secretKey);

  clock.advance(1000);
  const r0 = await host.submit(
    founder.build(K.INVITE_CREATE, { invitePublicKey: inviteKeys.publicKey, maxUses: 10000 }, clock.now()),
  );
  if (!r0.ok) throw new Error(`invite.create recusado: ${r0.code}`);

  const admit = async (name: string, keys?: KeyPair): Promise<Client> => {
    const c = new Client(name, communityKey, keys);
    const blobs = keyPairFromSeed(blake2b256('ns/memberblobs/1', c.keys.publicKey, communityKey));
    clock.advance(10);
    const r = await host.submit(
      c.build(K.MEMBER_JOIN, {
        invitePublicKey: inviteKeys.publicKey,
        joinProof: joinProof(c.keys.publicKey),
        displayName: name.length >= 2 ? name : `m-${name}`,
        avatarColor: 1,
        blobsCoreKey: blobs.publicKey,
      }, clock.now()),
    );
    if (!r.ok) throw new Error(`member.join(${name}) recusado: ${r.code}`);
    return c;
  };

  const clients: Client[] = [];
  for (let i = 0; i < opts.clients; i++) clients.push(await admit(`cliente-${i}`));

  // --- Cargos de teste: Mod (acima do base, abaixo do Fundador) e Alvo -------------
  // R-20: o `fold` recalcula o `rank` pelos vizinhos; as dicas sao os ranks observados.
  clock.advance(10);
  const modSeq = founder.nextAuthorSeq;
  const rMod = await host.submit(
    founder.build(K.ROLE_CREATE, {
      name: 'Moderador',
      color: 2,
      permissions: [
        PERM.manage_roles,
        PERM.manage_channels,
        PERM.manage_messages,
        PERM.ban_members,
        PERM.send_messages,
        PERM.add_reactions,
        PERM.create_invite,
      ],
      mentionable: true,
      afterRank: RANK_BOTTOM,
      beforeRank: RANK_TOP,
    }, clock.now()),
  );
  if (!rMod.ok) throw new Error(`role.create(Moderador) recusado: ${rMod.code}`);
  const modRole = eid('role', modSeq);

  clock.advance(10);
  const tgtSeq = founder.nextAuthorSeq;
  const rTgt = await host.submit(
    founder.build(K.ROLE_CREATE, {
      name: 'Alvo',
      color: 3,
      permissions: [PERM.send_messages],
      mentionable: true,
      afterRank: RANK_BOTTOM,
      beforeRank: host.ds.roles.get(modRole)!.rank,
    }, clock.now()),
  );
  if (!rTgt.ok) throw new Error(`role.create(Alvo) recusado: ${rTgt.code}`);
  const targetRole = eid('role', tgtSeq);

  // Clientes 0..5 viram moderadores. As corridas precisam de DOIS (C1, "dois moderadores
  // editam o mesmo cargo"); os demais existem para que o SETUP de cada repeticao possa
  // rodizar de autor — senao um unico autor estoura a cota deterministica de R-15
  // (QUOTA_OPS_PER_WINDOW = 2 000 ops por janela de 10 000 registros), que e regra do
  // `fold` e nao do harness.
  for (const c of clients.slice(0, 6)) {
    clock.advance(10);
    const r = await host.submit(
      founder.build(K.MEMBER_SET_ROLES, { targetKey: c.keys.publicKey, roleIds: [baseRole, modRole] }, clock.now()),
    );
    if (!r.ok) throw new Error(`member.setRoles(${c.name}) recusado: ${r.code}`);
  }

  const streams: Array<{ destroy: () => void }> = [];
  const replicas = async (n: number, tag: string): Promise<Replica[]> => {
    const out: Replica[] = [];
    for (let i = 0; i < n; i++) {
      const rdir = join(opts.dir, `replica-${tag}-${i}`);
      mkdirSync(rdir, { recursive: true });
      const rc = new Hypercore(join(rdir, 'core'), core.key, { compat: true });
      await rc.ready();
      // Replicacao Hypercore REAL, por stream em processo. O que o gate precisa provar
      // e a convergencia da INTERPRETACAO; o transporte (hyperdht/testnet) e G2/G7.
      const s1 = core.replicate(true);
      const s2 = rc.replicate(false);
      s1.pipe(s2).pipe(s1);
      streams.push(s1, s2);
      await rc.update({ wait: true });
      // Baixa TODOS os blocos antes de interpretar (o `fold` e local, nao espera rede).
      const want: Array<Promise<unknown>> = [];
      for (let seq = 0; seq < core.length; seq++) want.push(rc.get(seq, { wait: true }));
      await Promise.all(want);
      const rep = new Replica(`${tag}-${i}`, rc, join(rdir, 'view.db'), communityKey, {
        ...hostOpts,
      });
      await rep.catchUp();
      out.push(rep);
    }
    return out;
  };

  return {
    host,
    clock,
    founder,
    clients,
    communityKey,
    communityId,
    coreKeyPair,
    blobsKeyPair,
    dir: opts.dir,
    hostOpts,
    ids: { founderRole, baseRole, generalCategory, generalChannel, modRole, targetRole },
    invite: { keys: inviteKeys, secret: inviteSecret },
    joinProof,
    admit,
    replicas,
    close: async () => {
      for (const st of streams) {
        try {
          st.destroy();
        } catch {
          /* stream ja fechado */
        }
      }
      await host.close();
    },
  };
}

function assertGenesis(
  host: CommunityHost,
  founderRole: string,
  baseRole: string,
  cat: string,
  chan: string,
): void {
  const ds = host.ds;
  const problems: string[] = [];
  if (!ds.community.exists) problems.push('community.exists=false');
  if (ds.communityInvalid) problems.push('communityInvalid=true');
  if (ds.interpretedSeq !== 5) problems.push(`interpretedSeq=${ds.interpretedSeq}`);
  if (!ds.roles.get(founderRole)?.isFounder) problems.push('cargo Fundador ausente');
  if (!ds.roles.get(baseRole)?.isDefault) problems.push('cargo base ausente');
  if (!ds.categories.has(cat)) problems.push('categoria GERAL ausente');
  if (!ds.channels.has(chan)) problems.push('canal #geral ausente');
  if (ds.members.size !== 1) problems.push(`members=${ds.members.size}`);
  if (problems.length > 0) throw new Error(`genese invalida: ${problems.join(', ')}`);
}
