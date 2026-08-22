// Testes da fase 10 — sucessão de host: escrow, continuação, camada b e arbitragem
// (§18.8, A23, R-18/R-19; emendas registradas em sequenciamento-pos-fase-0.md §27).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import sodium from 'sodium-native';

import { relayPossessionSigningHash, verifySignature } from '../src/l1/opCodec/index.ts';
import { HOST_INACTIVITY_MS } from '../src/l1/fold/constants.ts';
import {
  emptyState,
  foldRecord,
  newMetrics,
  type DecisionState,
} from '../src/l1/fold/index.ts';
import {
  InactivityWatch,
  chooseContinuation,
  dispositionFor,
  evaluateLayerB,
  openSealedSeed,
  planContinuation,
  sealSeedFor,
  type ContinuationClaim,
} from '../src/l2/succession/index.ts';
import { genesis, joinMember, keypairFromSeed, makeRecord, T0, type Genesis } from './helpers/world.ts';

const SUCESSOR = keypairFromSeed('sucessor-p1');
const OUTRO = keypairFromSeed('sucessor-p3');
const SEED_NOVA = Buffer.alloc(32, 0xAB);
const SEED_BLOBS_NOVA = Buffer.alloc(32, 0xCD);

function keypairDe(hexKey: string): { publicKey: Buffer; secretKey: Buffer } | null {
  void hexKey;
  return null;
}
void keypairDe;

/**
 * Origem real: gênese + cargo customizado + categoria/canal próprios + dois membros
 * (um banido) + mensagem, convite e relay — o que NÃO migra (L-15) também precisa existir.
 */
function origem(): { g: Genesis; ana: ReturnType<typeof keypairFromSeed>; bruno: ReturnType<typeof keypairFromSeed>; estadoFinal: DecisionState; communitySeed: Buffer } {
  const g = genesis();
  const ana = joinMember(g, 'ana');
  const bruno = joinMember(g, 'bruno');

  // cargo customizado com permissão de gestão de canal
  const seqRole = g.world.next(g.founder);
  g.world.push(
    makeRecord(g.world.core, {
      kind: 'role.create',
      author: g.founder,
      authorSeq: seqRole,
      hostTs: T0 + 200,
      payload: { name: 'Moderação', color: 2, permissions: [1, 8], mentionable: false },
    }),
  );
  const roleIdCustom = g.world.id('role', g.founder, seqRole);
  g.world.submit({
    kind: 'member.setRoles',
    author: g.founder,
    hostTs: T0 + 210,
    payload: { targetKey: ana.publicKey, roleIds: [roleIdCustom] },
  });

  // categoria e canal próprios (além do geral da gênese)
  const seqCat = g.world.next(g.founder);
  g.world.push(
    makeRecord(g.world.core, {
      kind: 'category.create',
      author: g.founder,
      authorSeq: seqCat,
      hostTs: T0 + 300,
      payload: { name: 'PROJETOS' },
    }),
  );
  const catId = g.world.id('category', g.founder, seqCat);
  const seqChan = g.world.next(g.founder);
  g.world.push(
    makeRecord(g.world.core, {
      kind: 'channel.create',
      author: g.founder,
      authorSeq: seqChan,
      hostTs: T0 + 310,
      payload: { categoryId: catId, type: 0, name: 'dev', readOnlyForRoleIds: [] },
    }),
  );
  const chanDevId = g.world.id('channel', g.founder, seqChan);

  // moderação: bruno banido
  g.world.submit({ kind: 'mod.ban', author: g.founder, hostTs: T0 + 400, payload: { targetKey: bruno.publicKey, reason: 'teste' } });

  // conteúdo efêmero ao lote L-15: mensagem, convite e voluntariado de relay
  g.world.submit({ kind: 'message.send', author: ana, hostTs: T0 + 500, payload: { channelId: chanDevId, content: 'não migro', mentions: [] } });
  g.world.submit({ kind: 'invite.create', author: g.founder, hostTs: T0 + 510, payload: { invitePublicKey: keypairFromSeed('convite-x').publicKey } });
  const relayPk = keypairFromSeed('relay-x').publicKey;
  
  g.world.submit({
    kind: 'relay.volunteer',
    author: g.founder,
    hostTs: T0 + 520,
    payload: { relayPublicKey: relayPk, expiresAt: T0 + 86_400_000, possession: signDetachedOf(relayPossessionSigningHash(relayPk), g.founder.secretKey) },
  });

  return { g, ana, bruno, estadoFinal: g.world.state, communitySeed: Buffer.alloc(32, 0x42) };
}

function signDetachedOf(msg: Uint8Array, sk: Buffer): Buffer {
  const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, msg, sk);
  return sig;
}

/** Aplica os registros do plano num estado novo via `foldRecord` REAL. */
function aplicar(plan: ReturnType<typeof planContinuation>): DecisionState {
  let state: DecisionState = emptyState(plan.newCoreKeyPair.publicKey);
  const metrics = newMetrics();
  plan.records.forEach((rec, i) => {
    const r = foldRecord(state, rec, i, metrics);
    state = r.next;
    assert.equal(r.decision, 'APPLIED', `seq ${i}: ${r.decision}/${'reason' in r ? r.reason : ''}`);
  });
  return state;
}

// ─── Escrow (§18.8) ─────────────────────────────────────────────────────────────────────

describe('escrow da semente', () => {
  it('só o sucessor alvo abre; chave errada e selo adulterado devolvem null', () => {
    const seed = Buffer.alloc(32, 7);
    const alvo = keypairFromSeed('escrow-alvo');
    const intruso = keypairFromSeed('escrow-intruso');
    const wrapped = sealSeedFor(alvo.publicKey, seed);

    const aberto = openSealedSeed(wrapped, alvo.publicKey, alvo.secretKey);
    assert.ok(aberto !== null && aberto.equals(seed));
    assert.equal(openSealedSeed(wrapped, intruso.publicKey, intruso.secretKey), null);
    const adulterado = Buffer.from(wrapped);
    adulterado[adulterado.length - 1] = (adulterado.at(-1) ?? 0) ^ 0xff;
    assert.equal(openSealedSeed(adulterado, alvo.publicKey, alvo.secretKey), null);
    assert.equal(openSealedSeed(Buffer.alloc(4), alvo.publicKey, alvo.secretKey), null);
  });
});

describe('relógio de inatividade (grace period)', () => {
  it('abre só depois de HOST_INACTIVITY_MS sem registro novo', () => {
    const w = new InactivityWatch({ ttlMs: HOST_INACTIVITY_MS });
    const lastTs = 1_000_000;
    assert.equal(w.isInactive(lastTs, lastTs + HOST_INACTIVITY_MS - 1), false);
    assert.equal(w.isInactive(lastTs, lastTs + HOST_INACTIVITY_MS), true);
    assert.equal(w.graceRemainingMs(lastTs, lastTs + 100), HOST_INACTIVITY_MS - 100);
    assert.equal(w.graceRemainingMs(lastTs, lastTs + HOST_INACTIVITY_MS + 5), 0);
  });
});

// ─── Continuação (§18.8 passos 2–6) ─────────────────────────────────────────────────────

describe('plano da continuação aplicado pelo fold REAL', () => {
  function planoDaOrigem() {
    const o = origem();
    // chaves do core ANTIGO derivadas da semente decifrada — aqui, a própria fixture
    const oldCoreSecretKey = o.g.world.core.secretKey;
    const plan = planContinuation({
      originState: o.estadoFinal,
      originCoreSecretKey: oldCoreSecretKey,
      successorIdentity: SUCESSOR,
      newCoreSeed: SEED_NOVA,
      newBlobsSeed: SEED_BLOBS_NOVA,
      hostTs: T0 + 40 * 24 * 60 * 60 * 1000,
    });
    return { ...o, plan };
  }

  it('todos os registros são ACCEPTED; assumeHost valida R-18a na seq 6 e o host vira o sucessor', () => {
    const { plan, g } = planoDaOrigem();
    const novo = aplicar(plan);
    assert.equal(plan.records.length > 6, true);
    assert.notEqual(novo.communityId, g.world.state.communityId);
    assert.equal(novo.community.originCommunityId, g.world.state.communityId);
    assert.equal(novo.community.originFinalSeq, g.world.state.interpretedSeq);
    assert.ok(novo.community.hostKey.equals(SUCESSOR.publicKey));
    assert.ok(novo.community.blobsKey.equals(plan.newBlobsKey));
  });

  it('a prova é posse da chave de escrita ANTIGA, não da nova', () => {
    const { plan, g } = planoDaOrigem();
    const digestAntigo = Buffer.allocUnsafe(32);
    sodium.crypto_generichash_batch(digestAntigo, [
      Buffer.from('assume/1'),
      plan.newCoreKeyPair.publicKey,
      (() => {
        const b = Buffer.alloc(8);
        b.writeBigUInt64LE(BigInt(plan.originFinalSeq));
        return b;
      })(),
    ]);
    
    assert.equal(verifySignature(plan.proof, digestAntigo, g.world.core.publicKey), true);
    assert.equal(verifySignature(plan.proof, digestAntigo, plan.newCoreKeyPair.publicKey), false);
  });

  it('estrutura idêntica à origem (cargos, categorias, canais); membros NÃO são reconstruídos — ACHADO-G12-01', () => {
    const { plan, estadoFinal } = planoDaOrigem();
    const novo = aplicar(plan);

    const nomesDe = <T extends { name: string; deletedAt?: number }>(m: Map<string, T>) =>
      [...m.values()].filter((r) => r.deletedAt === undefined).map((r) => r.name).sort();
    assert.deepEqual(nomesDe(novo.roles), nomesDe(estadoFinal.roles));
    assert.deepEqual(nomesDe(novo.categories), nomesDe(estadoFinal.categories));
    assert.deepEqual(nomesDe(novo.channels), nomesDe(estadoFinal.channels));

    // ACHADO-G12-01: a continuação nasce só com o sucessor. `member.join` cria a
    // membresia do PRÓPRIO autor e a prova de convite vincula o communityId novo — o
    // sucessor não pode reconstruir terceiros. Convergência de membros fica para a rota
    // de reentrada por convites, até decisão normativa (§27).
    const ativosOrigem = [...estadoFinal.members].filter(([, m]) => m.state !== 'left');
    assert.ok(ativosOrigem.length >= 3);
    assert.equal(novo.members.size, 1);
    assert.equal(novo.members.get(SUCESSOR.publicKey.toString('hex'))?.state, 'active');
  });

  it('mensagens, convites e relays não migram (L-15)', () => {
    const { plan, estadoFinal } = planoDaOrigem();
    const novo = aplicar(plan);
    assert.equal(estadoFinal.messages.size > 0, true);
    assert.equal(novo.messages.size, 0);
    assert.equal(estadoFinal.invites.size > 0, true);
    assert.equal(novo.invites.size, 0);
    assert.equal(estadoFinal.relays.size > 0, true);
    assert.equal(novo.relays.size, 0);
  });

  it('a forma zerada continua restrita ao fundador em gênese — nem em continuação o host reconstrói terceiros', () => {
    // (a) comunidade NORMAL sem originCommunityId: zero-form pós-gênese é recusada
    const g = genesis();
    joinMember(g, 'extra');
    const antes = g.world.state;
    const zeroJoin = makeRecord(g.world.core, {
      kind: 'member.join',
      author: g.founder,
      authorSeq: g.world.next(g.founder),
      hostTs: T0 + 900,
      payload: {
        invitePublicKey: Buffer.alloc(32),
        joinProof: Buffer.alloc(64),
        displayName: 'Fantasma',
        avatarColor: 0,
        blobsCoreKey: Buffer.alloc(32, 1),
      },
    });
    const r = foldRecord(antes, zeroJoin, g.world.seq, newMetrics());
    assert.equal(r.decision, 'REJECTED');
    assert.equal('reason' in r ? r.reason : '', 'E_INVITE_INVALID');

    // (b) ACHADO-G12-01 na prática: na continuação, o join do host só cria a membresia
    // DELE (autoria = membresia). Um segundo zero-form não cria ninguém novo.
    const { plan } = planoDaOrigem();
    let st = emptyState(plan.newCoreKeyPair.publicKey);
    plan.records.forEach((rec, i) => {
      const rr = foldRecord(st, rec, i, newMetrics());
      st = rr.next;
    });
    const outroZeroForm = makeRecord(
      { publicKey: plan.newCoreKeyPair.publicKey, secretKey: plan.newCoreKeyPair.secretKey },
      {
        kind: 'member.join',
        author: SUCESSOR,
        authorSeq: plan.records.length + 1,
        hostTs: T0,
        payload: {
          invitePublicKey: Buffer.alloc(32),
          joinProof: Buffer.alloc(64),
          displayName: 'De Novo',
          avatarColor: 0,
          blobsCoreKey: Buffer.alloc(32, 2),
        },
      },
    );
    const r2 = foldRecord(st, outroZeroForm, plan.records.length, newMetrics());
    assert.equal(r2.decision, 'REJECTED');
    assert.equal(novoMembros(st), 1);
  });
});

function novoMembros(state: DecisionState): number {
  return state.members.size;
}

// ─── Camada b e arbitragem (L-16) ───────────────────────────────────────────────────────

const ORIGEM_FACTS = {
  communityIdHex: 'aa'.repeat(32),
  successorKeysHex: [SUCESSOR.publicKey.toString('hex'), 'bb'.repeat(32), OUTRO.publicKey.toString('hex')],
  lastHostTs: 1_000_000,
};

function claimDe(author: { readonly publicKey: Buffer }): ContinuationClaim {
  return {
    communityIdHex: 'cc'.repeat(32),
    originCommunityIdHex: ORIGEM_FACTS.communityIdHex,
    originFinalSeq: 42,
    assumedByHex: author.publicKey.toString('hex'),
  };
}

describe('camada b de R-18 e arbitragem de L-16', () => {
  const ttl = HOST_INACTIVITY_MS;

  it('não-sucedor, grace period aberto e origem encerrada recusam', () => {
    const agora = ORIGEM_FACTS.lastHostTs + ttl + 1;
    assert.equal(evaluateLayerB({ claim: claimDe(keypairFromSeed('estranho')), origin: ORIGEM_FACTS, ttlMs: ttl, now: agora }).ok, false);
    const dentro = evaluateLayerB({ claim: claimDe(SUCESSOR), origin: ORIGEM_FACTS, ttlMs: ttl, now: ORIGEM_FACTS.lastHostTs + ttl - 1 });
    assert.deepEqual(dentro, { ok: false, reason: 'grace-period' });
    const encerrada = evaluateLayerB({
      claim: claimDe(SUCESSOR),
      origin: { ...ORIGEM_FACTS, endedAt: ORIGEM_FACTS.lastHostTs },
      ttlMs: ttl,
      now: agora,
    });
    assert.deepEqual(encerrada, { ok: false, reason: 'origin-ended' });
  });

  it('prioridade vem da ordem da lista; escopo divergente é mismatch', () => {
    const agora = ORIGEM_FACTS.lastHostTs + ttl + 1;
    const p1 = evaluateLayerB({ claim: claimDe(SUCESSOR), origin: ORIGEM_FACTS, ttlMs: ttl, now: agora });
    const p3 = evaluateLayerB({ claim: claimDe(OUTRO), origin: ORIGEM_FACTS, ttlMs: ttl, now: agora });
    assert.deepEqual(p1, { ok: true, priorityIndex: 0 });
    assert.deepEqual(p3, { ok: true, priorityIndex: 2 });
    const outroEscopo = evaluateLayerB({
      claim: { ...claimDe(SUCESSOR), originCommunityIdHex: 'ff'.repeat(32) },
      origin: ORIGEM_FACTS,
      ttlMs: ttl,
      now: agora,
    });
    assert.deepEqual(outroEscopo, { ok: false, reason: 'scope-mismatch' });
  });

  it('L-16: réplica segue a de maior prioridade; as demais ficam órfãs', () => {
    const candidatos = [
      { claim: claimDe(OUTRO), priorityIndex: 2 }, // assumida primeiro
      { claim: claimDe(SUCESSOR), priorityIndex: 0 },
    ];
    const r = chooseContinuation(candidatos);
    assert.notEqual(r, null);
    if (r === null) return;
    assert.equal(r.chosen.claim.assumedByHex, SUCESSOR.publicKey.toString('hex'));
    assert.equal(r.orphans.length, 1);
  });

  it('disposition: com origem válida migra; falha marca disputed SEM migrar; sem origem segue a camada a', () => {
    const agora = ORIGEM_FACTS.lastHostTs + ttl + 1;
    assert.deepEqual(dispositionFor({ claim: claimDe(SUCESSOR), origin: ORIGEM_FACTS, ttlMs: ttl, now: agora }), { migrate: true });
    const invalida = dispositionFor({ claim: claimDe(keypairFromSeed('fora')), origin: ORIGEM_FACTS, ttlMs: ttl, now: agora });
    assert.deepEqual(invalida, { migrate: false, disputed: true, reason: 'not-successor' });
    assert.deepEqual(dispositionFor({ claim: claimDe(SUCESSOR), origin: null, ttlMs: ttl, now: agora }), { migrate: true });
  });
});
