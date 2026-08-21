import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import sodium from 'sodium-native';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import { HostAdmission } from '../src/l2/communityHost/index.ts';
import {
  InviteManager,
  generateInviteSecret,
  inviteSecretToCode,
  deriveInviteKeypair,
  createLiveProof,
  createJoinProof,
  verifyLiveProof,
} from '../src/l2/invites/index.ts';
import {
  encodeOp,
  encodeEnvelope,
  encodeHostRecord,
  hostRecordSigningHash,
  opSigningHash,
} from '../src/l1/opCodec/index.ts';
import { KINDS } from '../src/l1/opCodec/kinds.ts';
import { OP_VERSION } from '../src/l1/opCodec/index.ts';
import { encodePayload } from '../src/l1/opCodec/payloads.ts';
import { permissionNumber } from '../src/l1/permissions/index.ts';
import { genesis as makeGenesis, keypairFromSeed, type World, type Genesis, type Keypair, T0 } from './helpers/world.ts';

function signOp(opBytes: Buffer, secretKey: Buffer): Buffer {
  const digest = opSigningHash(opBytes);
  const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, digest, secretKey);
  return sig;
}

function makeInviteCreateEnvelope(
  communityKey: Buffer,
  author: Keypair,
  invitePublicKey: Buffer,
  authorSeq: number,
  opts: { expiresAt?: number; maxUses?: number; label?: string } = {},
): Buffer {
  const payload = encodePayload('invite.create', {
    invitePublicKey,
    ...(opts.expiresAt !== undefined ? { expiresAt: opts.expiresAt } : {}),
    ...(opts.maxUses !== undefined ? { maxUses: opts.maxUses } : {}),
    ...(opts.label !== undefined ? { label: opts.label } : {}),
  });
  const op = encodeOp({
    v: OP_VERSION,
    communityId: communityKey,
    kind: KINDS['invite.create'],
    author: author.publicKey,
    sequenceScope: { kind: 'community' },
    authorSeq,
    ts: T0,
    payload,
  });
  const sig = signOp(op, author.secretKey);
  return encodeEnvelope({ op, sig });
}

function makeMemberJoinEnvelope(
  communityId: Buffer,
  candidate: Keypair,
  invitePublicKey: Buffer,
  joinProof: Buffer,
  displayName: string,
  avatarColor: number,
  blobsCoreKey: Buffer,
  authorSeq: number,
): Buffer {
  const payload = encodePayload('member.join', {
    invitePublicKey,
    joinProof,
    displayName,
    avatarColor,
    blobsCoreKey,
  });
  const op = encodeOp({
    v: OP_VERSION,
    communityId,
    kind: KINDS['member.join'],
    author: candidate.publicKey,
    sequenceScope: { kind: 'community' },
    authorSeq,
    ts: T0,
    payload,
  });
  const sig = signOp(op, candidate.secretKey);
  return encodeEnvelope({ op, sig });
}

function makeHostRecord(envelope: Buffer, hostTs: number, hostKeypair: Keypair): Buffer {
  const flags = 0;
  const digest = hostRecordSigningHash(envelope, hostTs, flags);
  const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, digest, hostKeypair.secretKey);
  return encodeHostRecord({ envelope, hostTs, flags, hostSig: sig });
}

class MemoryCore {
  length = 0;
  readonly key: Buffer;
  readonly records: Buffer[] = [];
  shouldFail = false;
  constructor(key: Buffer) {
    this.key = key;
  }
  async append(blocks: readonly Uint8Array[]): Promise<void> {
    if (this.shouldFail) throw new Error('append fail');
    for (const b of blocks) this.records.push(Buffer.from(b));
    this.length += blocks.length;
  }
}

function nextSeqFor(admission: HostAdmission, author: Keypair): number {
  const key = `${author.publicKey.toString('hex')}\u0000community`;
  return (admission.state.lastAuthorSeq.get(key) ?? 0) + 1;
}

describe('G3 — Convite delegado e consumo atômico (POC-05)', () => {
  let world: World;
  let g: Genesis;
  let core: MemoryCore;
  let swarmHost: Swarm;
  let manifestHost: ManifestDb;
  let manifestNonHost: ManifestDb;
  let admission: HostAdmission;
  let managerHost: InviteManager;

  beforeEach(() => {
    const holder = makeGenesis();
    world = holder.world;
    g = holder;
    core = new MemoryCore(world.core.publicKey);
    core.length = world.seq;
    swarmHost = new Swarm();
    manifestHost = new ManifestDb(':memory:');
    manifestNonHost = new ManifestDb(':memory:');
    admission = new HostAdmission({
      core,
      state: world.state,
      makeHostRecord: (env, hostTs) => makeHostRecord(env as Buffer, hostTs, world.core),
      now: () => T0,
      groupWindowMs: 4,
      groupMax: 1,
    });
    managerHost = new InviteManager({
      communityId: world.core.publicKey.toString('hex'),
      swarm: swarmHost,
      manifest: manifestHost,
      hostAdmission: admission,
      getDecisionState: () => admission.state,
      hostPublicKey: world.core.publicKey,
      clock: { now: () => T0 },
    });
  });

  afterEach(async () => {
    await admission.drain();
  });

  it('convite delegado criado por não-host é resgatável (A08, F-02)', async () => {
    // Cria bianca como membro via founder invite
    const segBiancaInvite = keypairFromSeed('invite-bianca');
    const envInvBianca = makeInviteCreateEnvelope(world.core.publicKey, g.founder, segBiancaInvite.publicKey, nextSeqFor(admission, g.founder));
    let r = await admission.submit(envInvBianca);
    assert.equal(r.ok, true);
    const bianca = keypairFromSeed('bianca');
    const jpBianca = (() => {
      const d = Buffer.alloc(32);
      sodium.crypto_generichash_batch(d, [Buffer.from('invite-join/1', 'utf8'), world.core.publicKey, segBiancaInvite.publicKey, bianca.publicKey]);
      const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
      sodium.crypto_sign_detached(sig, d, segBiancaInvite.secretKey);
      return sig;
    })();
    const envJoinBianca = makeMemberJoinEnvelope(world.core.publicKey, bianca, segBiancaInvite.publicKey, jpBianca, 'Bianca', 1, keypairFromSeed('mb-bianca').publicKey, 1);
    r = await admission.submit(envJoinBianca);
    assert.equal(r.ok, true);
    assert.equal(admission.state.members.get(bianca.publicKey.toString('hex'))?.state, 'active');

    // Cria cargo Convidador com create_invite e atribui a Bianca — via admission para manter DS consistente
    const payloadRole = encodePayload('role.create', {
      name: 'Convidador',
      color: 1,
      permissions: [permissionNumber('create_invite')],
      mentionable: true,
    });
    const opRole = encodeOp({
      v: OP_VERSION,
      communityId: world.core.publicKey,
      kind: KINDS['role.create'],
      author: g.founder.publicKey,
      sequenceScope: { kind: 'community' },
      authorSeq: nextSeqFor(admission, g.founder),
      ts: T0,
      payload: payloadRole,
    });
    const sigRole = signOp(opRole, g.founder.secretKey);
    const envRole = encodeEnvelope({ op: opRole, sig: sigRole });
    r = await admission.submit(envRole);
    assert.equal(r.ok, true);
    // encontra id do cargo Convidador recém criado
    let convidadorId: string | null = null;
    for (const [id, role] of admission.state.roles) {
      if (role.name === 'Convidador') convidadorId = id;
    }
    assert.ok(convidadorId !== null);

    // atribui cargo a Bianca
    const biancaMember = admission.state.members.get(bianca.publicKey.toString('hex'))!;
    const newRoleIds = [...biancaMember.roleIds, convidadorId!];
    const payloadSet = encodePayload('member.setRoles', { targetKey: bianca.publicKey, roleIds: newRoleIds });
    const opSet = encodeOp({
      v: OP_VERSION,
      communityId: world.core.publicKey,
      kind: KINDS['member.setRoles'],
      author: g.founder.publicKey,
      sequenceScope: { kind: 'community' },
      authorSeq: nextSeqFor(admission, g.founder),
      ts: T0,
      payload: payloadSet,
    });
    const sigSet = signOp(opSet, g.founder.secretKey);
    const envSet = encodeEnvelope({ op: opSet, sig: sigSet });
    r = await admission.submit(envSet);
    assert.equal(r.ok, true);

    // Bianca cria convite delegado — host valida sem conhecer segredo
    const secretDel = generateInviteSecret();
    const { publicKey: pkDel, secretKey: skDel } = deriveInviteKeypair(secretDel);
    const codeDel = inviteSecretToCode(secretDel);
    manifestNonHost.setInviteSecret({ invitePublicKey: pkDel, communityId: world.core.publicKey.toString('hex'), secret: secretDel });
    const envDel = makeInviteCreateEnvelope(world.core.publicKey, bianca, pkDel, nextSeqFor(admission, bianca));
    const resDel = await admission.submit(envDel);
    assert.equal(resDel.ok, true);
    assert.ok(admission.state.invites.has(pkDel.toString('hex')));
    managerHost.announceInvite(pkDel);

    // candidato resgata
    const candidato = keypairFromSeed('carlos');
    const ch = managerHost.createChallenge();
    const live = createLiveProof(skDel, pkDel, world.core.publicKey, candidato.publicKey, ch.challenge);
    const preview = managerHost.preview({
      invitePublicKey: pkDel,
      candidatePublicKey: candidato.publicKey,
      liveProof: live,
      challenge: ch.challenge,
    });
    assert.equal((preview as { status: string }).status, 'ok');
    const jp = createJoinProof(skDel, world.core.publicKey, pkDel, candidato.publicKey);
    const envJoin = makeMemberJoinEnvelope(world.core.publicKey, candidato, pkDel, jp, 'Carlos', 1, keypairFromSeed('mb-carlos').publicKey, 1);
    const ch2 = managerHost.createChallenge();
    const live2 = createLiveProof(skDel, pkDel, world.core.publicKey, candidato.publicKey, ch2.challenge);
    const redeemed = await managerHost.redeem({
      envelope: envJoin,
      liveProof: live2,
      challenge: ch2.challenge,
      candidatePublicKey: candidato.publicKey,
      invitePublicKey: pkDel,
    });
    assert.equal(redeemed.ok, true);
    assert.equal(admission.state.members.get(candidato.publicKey.toString('hex'))?.state, 'active');
    // código só na instalação de quem criou (U-04)
    assert.equal(manifestHost.getInviteSecret(pkDel.toString('hex')), null);
    assert.notEqual(manifestNonHost.getInviteSecret(pkDel.toString('hex')), null);
    assert.equal(codeDel, inviteSecretToCode(secretDel));
    await admission.drain();
  });

  it('maxUses é aplicado atomicamente — 10 resgates simultâneos com maxUses=1 entrega exatamente 1 (G3 gate)', async () => {
    const secret = generateInviteSecret();
    const { publicKey: pk, secretKey: sk } = deriveInviteKeypair(secret);
    const env = makeInviteCreateEnvelope(world.core.publicKey, g.founder, pk, nextSeqFor(admission, g.founder), { maxUses: 1 });
    const resCreate = await admission.submit(env);
    assert.equal(resCreate.ok, true);
    await admission.drain();
    const candidatos = Array.from({ length: 10 }, (_, i) => keypairFromSeed(`cand-${i}`));
    const envelopes = candidatos.map((cand, i) => {
      const jp = createJoinProof(sk, world.core.publicKey, pk, cand.publicKey);
      return {
        cand,
        env: makeMemberJoinEnvelope(world.core.publicKey, cand, pk, jp, `Cand${i}`, 1, keypairFromSeed(`mb-cand-${i}`).publicKey, 1),
      };
    });
    // preview de todos antes — todos ok
    for (const e of envelopes) {
      const ch = managerHost.createChallenge();
      const live = createLiveProof(sk, pk, world.core.publicKey, e.cand.publicKey, ch.challenge);
      const pre = managerHost.preview({
        invitePublicKey: pk,
        candidatePublicKey: e.cand.publicKey,
        liveProof: live,
        challenge: ch.challenge,
      });
      assert.equal((pre as { status: string }).status, 'ok');
    }
    const results = await Promise.all(
      envelopes.map(async (e) => {
        const ch = managerHost.createChallenge();
        const live = createLiveProof(sk, pk, world.core.publicKey, e.cand.publicKey, ch.challenge);
        return managerHost.redeem({
          envelope: e.env,
          liveProof: live,
          challenge: ch.challenge,
          candidatePublicKey: e.cand.publicKey,
          invitePublicKey: pk,
        });
      }),
    );
    const oks = results.filter((r) => r.ok);
    const fails = results.filter((r) => !r.ok);
    assert.equal(oks.length, 1);
    assert.equal(fails.length, 9);
    for (const f of fails) assert.equal((f as { code: string }).code, 'E_INVITE_EXHAUSTED');
    const membrosNovos = candidatos.filter((c) => admission.state.members.get(c.publicKey.toString('hex'))?.state === 'active');
    assert.equal(membrosNovos.length, 1);
    assert.equal(admission.state.invites.get(pk.toString('hex'))?.uses, 1);
    await admission.drain();
  });

  it('os seis desfechos de preview são alcançáveis (§12.3)', async () => {
    const secretOk = generateInviteSecret();
    const { publicKey: pkOk, secretKey: skOk } = deriveInviteKeypair(secretOk);
    await admission.submit(makeInviteCreateEnvelope(world.core.publicKey, g.founder, pkOk, nextSeqFor(admission, g.founder)));
    await admission.drain();

    // revoked
    const secRev = generateInviteSecret();
    const { publicKey: pkRev, secretKey: skRev } = deriveInviteKeypair(secRev);
    await admission.submit(makeInviteCreateEnvelope(world.core.publicKey, g.founder, pkRev, nextSeqFor(admission, g.founder)));
    await admission.drain();
    {
      const payload = encodePayload('invite.revoke', { invitePublicKey: pkRev });
      const op = encodeOp({
        v: OP_VERSION,
        communityId: world.core.publicKey,
        kind: KINDS['invite.revoke'],
        author: g.founder.publicKey,
        sequenceScope: { kind: 'community' },
        authorSeq: nextSeqFor(admission, g.founder),
        ts: T0,
        payload,
      });
      const sig = signOp(op, g.founder.secretKey);
      const env = encodeEnvelope({ op, sig });
      const r = await admission.submit(env);
      assert.equal(r.ok, true);
      await admission.drain();
    }

    // membro banido
    const banido = keypairFromSeed('banido');
    const segBan = keypairFromSeed('invite-ban');
    await admission.submit(makeInviteCreateEnvelope(world.core.publicKey, g.founder, segBan.publicKey, nextSeqFor(admission, g.founder)));
    await admission.drain();
    const jpBan = (() => {
      const d = Buffer.alloc(32);
      sodium.crypto_generichash_batch(d, [Buffer.from('invite-join/1', 'utf8'), world.core.publicKey, segBan.publicKey, banido.publicKey]);
      const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
      sodium.crypto_sign_detached(sig, d, segBan.secretKey);
      return sig;
    })();
    const envBanJoin = makeMemberJoinEnvelope(world.core.publicKey, banido, segBan.publicKey, jpBan, 'Banido', 1, keypairFromSeed('mb-banido').publicKey, 1);
    let r = await admission.submit(envBanJoin);
    assert.equal(r.ok, true);
    await admission.drain();
    {
      const payload = encodePayload('mod.ban', { targetKey: banido.publicKey });
      const op = encodeOp({
        v: OP_VERSION,
        communityId: world.core.publicKey,
        kind: KINDS['mod.ban'],
        author: g.founder.publicKey,
        sequenceScope: { kind: 'community' },
        authorSeq: nextSeqFor(admission, g.founder),
        ts: T0,
        payload,
      });
      const sig = signOp(op, g.founder.secretKey);
      const env = encodeEnvelope({ op, sig });
      const rr = await admission.submit(env);
      assert.equal(rr.ok, true);
      await admission.drain();
    }

    const candOk = keypairFromSeed('cand-ok');
    {
      const ch = managerHost.createChallenge();
      const live = createLiveProof(skOk, pkOk, world.core.publicKey, candOk.publicKey, ch.challenge);
      const pre = managerHost.preview({ invitePublicKey: pkOk, candidatePublicKey: candOk.publicKey, liveProof: live, challenge: ch.challenge });
      assert.equal((pre as { status: string }).status, 'ok');
    }
    {
      const chInv = managerHost.createChallenge();
      const liveInv = createLiveProof(skRev, pkRev, world.core.publicKey, candOk.publicKey, chInv.challenge);
      const preInv = managerHost.preview({ invitePublicKey: pkRev, candidatePublicKey: candOk.publicKey, liveProof: liveInv, challenge: chInv.challenge });
      assert.equal((preInv as { status: string }).status, 'invalid');
    }
    {
      const chBan = managerHost.createChallenge();
      const liveBan = createLiveProof(skOk, pkOk, world.core.publicKey, banido.publicKey, chBan.challenge);
      const preBan = managerHost.preview({ invitePublicKey: pkOk, candidatePublicKey: banido.publicKey, liveProof: liveBan, challenge: chBan.challenge });
      assert.equal((preBan as { status: string }).status, 'banned');
    }
    {
      const chAlready = managerHost.createChallenge();
      const liveAlready = createLiveProof(skOk, pkOk, world.core.publicKey, g.founder.publicKey, chAlready.challenge);
      const preAlready = managerHost.preview({ invitePublicKey: pkOk, candidatePublicKey: g.founder.publicKey, liveProof: liveAlready, challenge: chAlready.challenge });
      assert.equal((preAlready as { status: string }).status, 'already-member');
    }
    // ended
    (admission.state.community as unknown as { endedAt?: number }).endedAt = T0;
    {
      const candEnded = keypairFromSeed('cand-ended');
      const chEnded = managerHost.createChallenge();
      const liveEnded = createLiveProof(skOk, pkOk, world.core.publicKey, candEnded.publicKey, chEnded.challenge);
      const preEnded = managerHost.preview({ invitePublicKey: pkOk, candidatePublicKey: candEnded.publicKey, liveProof: liveEnded, challenge: chEnded.challenge });
      assert.equal((preEnded as { status: string }).status, 'ended');
    }
    delete (admission.state.community as unknown as { endedAt?: number }).endedAt;
    await admission.drain();
  });

  it('replay de liveProof por terceiro que observa tópico é recusado (T-06)', async () => {
    const secret = generateInviteSecret();
    const { publicKey: pk, secretKey: sk } = deriveInviteKeypair(secret);
    await admission.submit(makeInviteCreateEnvelope(world.core.publicKey, g.founder, pk, nextSeqFor(admission, g.founder)));
    await admission.drain();
    const cand = keypairFromSeed('cand-live');
    const terceiro = keypairFromSeed('terceiro');
    const ch = managerHost.createChallenge();
    const live = createLiveProof(sk, pk, world.core.publicKey, cand.publicKey, ch.challenge);
    const replayOk = verifyLiveProof(pk, world.core.publicKey, terceiro.publicKey, ch.challenge, live);
    assert.equal(replayOk, false);
    const pre = managerHost.preview({ invitePublicKey: pk, candidatePublicKey: terceiro.publicKey, liveProof: live, challenge: ch.challenge });
    assert.equal((pre as { status: string }).status, 'proof-invalid');
    await admission.drain();
  });

  it('replay de joinProof já usado é recusado (R-9 par idempotente)', async () => {
    const secret = generateInviteSecret();
    const { publicKey: pk, secretKey: sk } = deriveInviteKeypair(secret);
    await admission.submit(makeInviteCreateEnvelope(world.core.publicKey, g.founder, pk, nextSeqFor(admission, g.founder), { maxUses: 2 }));
    await admission.drain();
    const cand = keypairFromSeed('cand-join-replay');
    const jp = createJoinProof(sk, world.core.publicKey, pk, cand.publicKey);
    const env = makeMemberJoinEnvelope(world.core.publicKey, cand, pk, jp, 'Replay', 1, keypairFromSeed('mb-replay').publicKey, 1);
    const ch1 = managerHost.createChallenge();
    const live1 = createLiveProof(sk, pk, world.core.publicKey, cand.publicKey, ch1.challenge);
    const r1 = await managerHost.redeem({ envelope: env, liveProof: live1, challenge: ch1.challenge, candidatePublicKey: cand.publicKey, invitePublicKey: pk });
    assert.equal(r1.ok, true);
    await admission.drain();
    const ch2 = managerHost.createChallenge();
    const live2 = createLiveProof(sk, pk, world.core.publicKey, cand.publicKey, ch2.challenge);
    const r2 = await managerHost.redeem({ envelope: env, liveProof: live2, challenge: ch2.challenge, candidatePublicKey: cand.publicKey, invitePublicKey: pk });
    assert.equal(r2.ok, false);
    assert.ok((r2 as { code: string }).code === 'E_DUPLICATE' || (r2 as { code: string }).code === 'E_INVITE_INVALID');
    await admission.drain();
  });

  it('challenge repetido é consumido uma vez (replay fechado)', async () => {
    const secret = generateInviteSecret();
    const { publicKey: pk, secretKey: sk } = deriveInviteKeypair(secret);
    await admission.submit(makeInviteCreateEnvelope(world.core.publicKey, g.founder, pk, nextSeqFor(admission, g.founder)));
    await admission.drain();
    const cand = keypairFromSeed('cand-chal');
    const ch = managerHost.createChallenge();
    const live = createLiveProof(sk, pk, world.core.publicKey, cand.publicKey, ch.challenge);
    const pre1 = managerHost.preview({ invitePublicKey: pk, candidatePublicKey: cand.publicKey, liveProof: live, challenge: ch.challenge });
    assert.equal((pre1 as { status: string }).status, 'ok');
    const pre2 = managerHost.preview({ invitePublicKey: pk, candidatePublicKey: cand.publicKey, liveProof: live, challenge: ch.challenge });
    assert.equal((pre2 as { status: string }).status, 'proof-invalid');
    await admission.drain();
  });

  it('emissor banido depois de emitir tem convites revogados (R-10)', async () => {
    const emissor = keypairFromSeed('emissor-r10');
    const segEmissorInvite = keypairFromSeed('invite-emissor');
    await admission.submit(makeInviteCreateEnvelope(world.core.publicKey, g.founder, segEmissorInvite.publicKey, nextSeqFor(admission, g.founder)));
    await admission.drain();
    const jpEm = (() => {
      const d = Buffer.alloc(32);
      sodium.crypto_generichash_batch(d, [Buffer.from('invite-join/1', 'utf8'), world.core.publicKey, segEmissorInvite.publicKey, emissor.publicKey]);
      const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
      sodium.crypto_sign_detached(sig, d, segEmissorInvite.secretKey);
      return sig;
    })();
    const envJoinEm = makeMemberJoinEnvelope(world.core.publicKey, emissor, segEmissorInvite.publicKey, jpEm, 'Emissor', 1, keypairFromSeed('mb-emissor').publicKey, 1);
    let rr = await admission.submit(envJoinEm);
    assert.equal(rr.ok, true);
    await admission.drain();
    // concede create_invite ao emissor para que invite.create seja autorizado (R-9 precisa da permissão)
    {
      const payloadRole = encodePayload('role.create', {
        name: 'ConvidadorR10',
        color: 2,
        permissions: [permissionNumber('create_invite')],
        mentionable: true,
      });
      const opRole = encodeOp({
        v: OP_VERSION,
        communityId: world.core.publicKey,
        kind: KINDS['role.create'],
        author: g.founder.publicKey,
        sequenceScope: { kind: 'community' },
        authorSeq: nextSeqFor(admission, g.founder),
        ts: T0,
        payload: payloadRole,
      });
      const sigRole = signOp(opRole, g.founder.secretKey);
      const envRole = encodeEnvelope({ op: opRole, sig: sigRole });
      const rRole = await admission.submit(envRole);
      assert.equal(rRole.ok, true);
      await admission.drain();
      let convId: string | null = null;
      for (const [id, role] of admission.state.roles) if (role.name === 'ConvidadorR10') convId = id;
      assert.ok(convId !== null);
      const memEm = admission.state.members.get(emissor.publicKey.toString('hex'))!;
      const newIds = [...memEm.roleIds, convId!];
      const payloadSet = encodePayload('member.setRoles', { targetKey: emissor.publicKey, roleIds: newIds });
      const opSet = encodeOp({
        v: OP_VERSION,
        communityId: world.core.publicKey,
        kind: KINDS['member.setRoles'],
        author: g.founder.publicKey,
        sequenceScope: { kind: 'community' },
        authorSeq: nextSeqFor(admission, g.founder),
        ts: T0,
        payload: payloadSet,
      });
      const sigSet = signOp(opSet, g.founder.secretKey);
      const envSet = encodeEnvelope({ op: opSet, sig: sigSet });
      const rSet = await admission.submit(envSet);
      assert.equal(rSet.ok, true);
      await admission.drain();
    }
    const secretEm = generateInviteSecret();
    const { publicKey: pkEm, secretKey: skEm } = deriveInviteKeypair(secretEm);
    const rInv = await admission.submit(makeInviteCreateEnvelope(world.core.publicKey, emissor, pkEm, nextSeqFor(admission, emissor)));
    assert.equal(rInv.ok, true);
    await admission.drain();
    assert.equal(admission.state.invites.get(pkEm.toString('hex'))?.revokedAt, undefined);
    {
      const payload = encodePayload('mod.ban', { targetKey: emissor.publicKey });
      const op = encodeOp({
        v: OP_VERSION,
        communityId: world.core.publicKey,
        kind: KINDS['mod.ban'],
        author: g.founder.publicKey,
        sequenceScope: { kind: 'community' },
        authorSeq: nextSeqFor(admission, g.founder),
        ts: T0,
        payload,
      });
      const sig = signOp(op, g.founder.secretKey);
      const env = encodeEnvelope({ op, sig });
      const r = await admission.submit(env);
      assert.equal(r.ok, true);
      await admission.drain();
    }
    assert.notEqual(admission.state.invites.get(pkEm.toString('hex'))?.revokedAt, undefined);
    const cand = keypairFromSeed('cand-r10');
    const jp = createJoinProof(skEm, world.core.publicKey, pkEm, cand.publicKey);
    const envJoin = makeMemberJoinEnvelope(world.core.publicKey, cand, pkEm, jp, 'CandR10', 1, keypairFromSeed('mb-r10').publicKey, 1);
    const ch = managerHost.createChallenge();
    const live = createLiveProof(skEm, pkEm, world.core.publicKey, cand.publicKey, ch.challenge);
    const pre = managerHost.preview({ invitePublicKey: pkEm, candidatePublicKey: cand.publicKey, liveProof: live, challenge: ch.challenge });
    assert.equal((pre as { status: string }).status, 'invalid');
    // redeem com challenge fresco (preview já consumiu ch) -> precisa novo challenge
    const ch2 = managerHost.createChallenge();
    const live2 = createLiveProof(skEm, pkEm, world.core.publicKey, cand.publicKey, ch2.challenge);
    const redeemed = await managerHost.redeem({ envelope: envJoin, liveProof: live2, challenge: ch2.challenge, candidatePublicKey: cand.publicKey, invitePublicKey: pkEm });
    assert.equal(redeemed.ok, false);
    assert.equal((redeemed as { code: string }).code, 'E_INVITE_INVALID');
    await admission.drain();
  });

  it('preview com proof errada fecha conexão sem segunda tentativa (§12.3)', async () => {
    const secret = generateInviteSecret();
    const { publicKey: pk } = deriveInviteKeypair(secret);
    await admission.submit(makeInviteCreateEnvelope(world.core.publicKey, g.founder, pk, nextSeqFor(admission, g.founder)));
    await admission.drain();
    const cand = keypairFromSeed('cand-err');
    const ch = managerHost.createChallenge();
    const badProof = Buffer.alloc(64, 0xff);
    const pre = managerHost.preview({ invitePublicKey: pk, candidatePublicKey: cand.publicKey, liveProof: badProof, challenge: ch.challenge });
    assert.equal((pre as { status: string }).status, 'proof-invalid');
    const pre2 = managerHost.preview({ invitePublicKey: pk, candidatePublicKey: cand.publicKey, liveProof: badProof, challenge: ch.challenge });
    assert.equal((pre2 as { status: string }).status, 'proof-invalid');
    await admission.drain();
  });

  it('host offline: redeem falha com E_HOST_UNAVAILABLE quando admission null', async () => {
    const secret = generateInviteSecret();
    const { publicKey: pk, secretKey: sk } = deriveInviteKeypair(secret);
    await admission.submit(makeInviteCreateEnvelope(world.core.publicKey, g.founder, pk, nextSeqFor(admission, g.founder)));
    await admission.drain();
    const offlineManager = new InviteManager({
      communityId: world.core.publicKey.toString('hex'),
      swarm: new Swarm(),
      manifest: manifestHost,
      hostAdmission: null,
      getDecisionState: () => admission.state,
      hostPublicKey: world.core.publicKey,
      clock: { now: () => T0 },
    });
    const cand = keypairFromSeed('cand-off');
    const jp = createJoinProof(sk, world.core.publicKey, pk, cand.publicKey);
    const env = makeMemberJoinEnvelope(world.core.publicKey, cand, pk, jp, 'Off', 1, keypairFromSeed('mb-off').publicKey, 1);
    const ch = offlineManager.createChallenge();
    const live = createLiveProof(sk, pk, world.core.publicKey, cand.publicKey, ch.challenge);
    const res = await offlineManager.redeem({ envelope: env, liveProof: live, challenge: ch.challenge, candidatePublicKey: cand.publicKey, invitePublicKey: pk });
    assert.equal(res.ok, false);
    assert.equal((res as { code: string }).code, 'E_HOST_UNAVAILABLE');
    await admission.drain();
  });
});
