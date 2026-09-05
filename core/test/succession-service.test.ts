// Fase de integração da sucessão — o serviço de §18.8 sobre o `fold` REAL dos dois lados:
// designação com escrow (R-17), assunção com camada b de R-18 e a reentrada assistida de
// L-23 (§18.8.1). As portas injetadas (submissão ⏱, criação do core novo, leitura do
// escrow) são cabos de teste: nenhuma delas decide nada.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deriveCommunityKeyPairs } from '../src/l0/corestore/index.ts';
import { deriveMemberBlobsPublicKey } from '../src/l2/blobs/index.ts';
import { identitySeedOf } from '../src/composition/community.ts';
import { HOST_INACTIVITY_MS } from '../src/l1/fold/constants.ts';
import { decodeEnvelope, decodeHostRecord, decodeOp, decodePayload, KINDS } from '../src/l1/opCodec/index.ts';
import { openSealedSeed, sealSeedFor, SuccessionService, type SuccessionDeps } from '../src/l2/succession/index.ts';
import { IpcClient, IpcServer, MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import { registerCoreCommands } from '../src/l3/ipcRenderer/commands.ts';
import type { DecisionState } from '../src/l1/fold/index.ts';
import {
  World,
  genesis,
  joinMember,
  joinProof,
  keypairFromSeed,
  makeRecord,
  T0,
  type Genesis,
  type Keypair,
} from './helpers/world.ts';

const SEMENTE = Buffer.alloc(32, 0x42);
const SEED_NOVA = Buffer.alloc(32, 0xAB);
const SUCESSOR = keypairFromSeed('sucessor-servico');
const ESTRANHO = keypairFromSeed('estranho-servico');
// O último registro da origem é o escrow em `T0 + 601`: o grace period conta a partir dele.
const ULTIMO_TS_ORIGEM = T0 + 601;
const DEPOIS_DO_GRACE = ULTIMO_TS_ORIGEM + HOST_INACTIVITY_MS + 1;

/** Origem cujo core deriva da semente — é o que o escrow entrega ao sucessor (§5.3). */
function origem(): { g: Genesis; ana: Keypair } {
  const par = deriveCommunityKeyPairs(SEMENTE).log;
  const g = genesis(new World(par));
  const ana = joinMember(g, 'ana-servico');
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
  g.world.submit({
    kind: 'member.setRoles',
    author: g.founder,
    hostTs: T0 + 210,
    payload: { targetKey: ana.publicKey, roleIds: [g.baseRoleId, g.world.id('role', g.founder, seqRole)] },
  });
  return { g, ana };
}

/** Porta ⏱: sela como o host do mundo faria e devolve o `seq` do registro aplicado. */
function submitSyncDe(mundos: ReadonlyMap<string, { world: World; author: Keypair; hostTs: number }>) {
  return async (communityId: string, input: { kindName: string; payload: Readonly<Record<string, unknown>> }) => {
    const alvo = mundos.get(communityId);
    if (alvo === undefined) return { ok: false as const, code: 'E_HOST_UNAVAILABLE' };
    const r = alvo.world.submit({
      kind: input.kindName as 'community.setSuccessors',
      author: alvo.author,
      hostTs: alvo.hostTs,
      payload: input.payload as never,
    });
    if (r.decision !== 'APPLIED') return { ok: false as const, code: 'reason' in r ? r.reason : 'E_INTERNAL' };
    return { ok: true as const, seq: alvo.world.seq - 1 };
  };
}

/** Lê do log cru o `wrappedSeed` endereçado a `targetHex` — o `DS` não guarda escrow (§8.1). */
function escrowNoLog(world: World, targetHex: string): Buffer | null {
  for (const rec of world.log) {
    const hostRecord = decodeHostRecord(rec);
    const envelope = hostRecord === null ? null : decodeEnvelope(hostRecord.envelope);
    const op = envelope === null ? null : decodeOp(envelope.op);
    if (op === null || op.kind !== KINDS['community.escrow']) continue;
    const p = decodePayload('community.escrow', op.payload);
    if (p !== null && p.targetKey.toString('hex') === targetHex) return Buffer.from(p.wrappedSeed);
  }
  return null;
}

type Cenario = {
  service: SuccessionService;
  g: Genesis;
  ana: Keypair;
  mundos: Map<string, { world: World; author: Keypair; hostTs: number }>;
  criados: { keyPair: { publicKey: Buffer; secretKey: Buffer }; records: readonly Buffer[] }[];
  estados: Map<string, () => DecisionState | null>;
};

function cenario(over: Partial<SuccessionDeps> & { identidade?: Keypair; agora?: number } = {}): Cenario {
  const { g, ana } = origem();
  const originId = g.world.core.publicKey.toString('hex');
  const mundos = new Map([[originId, { world: g.world, author: g.founder, hostTs: T0 + 600 }]]);
  const criados: Cenario['criados'] = [];
  const estados = new Map<string, () => DecisionState | null>([[originId, () => g.world.state]]);
  const identidade = over.identidade ?? g.founder;

  const deps: SuccessionDeps = {
    stateFor: (id) => estados.get(id)?.() ?? null,
    identity: () => identidade,
    communitySeed: (id) => (id === originId ? SEMENTE : null),
    sealedSeedFor: async (id) =>
      id === originId ? escrowNoLog(g.world, identidade.publicKey.toString('hex')) : null,
    submitSync: submitSyncDe(mundos),
    // §13.1 — derivação real, para o `member.join` da gênese publicar a chave que o boot
    // vai reconferir contra a derivada da identidade.
    memberBlobsCoreKeyFor: (cid) => deriveMemberBlobsPublicKey(identitySeedOf(identidade), cid),
    createContinuationCore: async ({ keyPair, records, communitySeed }) => {
      // §5.3 — a semente entregue à porta é a que rederiva o par do core: se um dia ela
      // deixar de bater, o boot abre a continuação sem poder escrever nela.
      assert.ok(deriveCommunityKeyPairs(communitySeed).log.publicKey.equals(keyPair.publicKey));
      criados.push({ keyPair, records });
      // A continuação vira um mundo próprio: o `fold` REAL interpreta o lote inteiro.
      const w = new World(keyPair as Keypair);
      records.forEach((rec) => {
        const r = w.push(rec);
        assert.equal(r.decision, 'APPLIED', `lote da continuação: ${'reason' in r ? r.reason : ''}`);
      });
      // Todo o lote é autorado pelo sucessor: o contador do mundo precisa continuar de onde
      // o plano parou, senão o próximo `authorSeq` repete um já consumido (§7.5).
      w.authorSeq.set(identidade.publicKey.toString('hex'), records.length);
      const id = keyPair.publicKey.toString('hex');
      estados.set(id, () => w.state);
      mundos.set(id, { world: w, author: identidade, hostTs: DEPOIS_DO_GRACE + 10 });
    },
    now: () => over.agora ?? T0 + 600,
    newCoreSeed: () => SEED_NOVA,
    ...(over.inactivityMs !== undefined ? { inactivityMs: over.inactivityMs } : {}),
  };
  return { service: new SuccessionService(deps), g, ana, mundos, criados, estados };
}

/** Designação feita pelo próprio host, como no fluxo real, sem passar pelo serviço. */
function designaSucessor(g: Genesis, alvo: Keypair = SUCESSOR): void {
  g.world.submit({
    kind: 'community.setSuccessors',
    author: g.founder,
    hostTs: T0 + 600,
    payload: { successorKeys: [alvo.publicKey] },
  });
  g.world.submit({
    kind: 'community.escrow',
    author: g.founder,
    hostTs: T0 + 601,
    payload: { targetKey: alvo.publicKey, wrappedSeed: sealSeedFor(alvo.publicKey, SEMENTE) },
  });
}

describe('§15.4 community.setSuccessors — designação com escrow (R-17, §18.8)', () => {
  it('appenda a lista e um escrow por sucessor; só o alvo abre a semente', async () => {
    const c = cenario();
    const originId = c.g.world.core.publicKey.toString('hex');
    const r = await c.service.setSuccessors({
      communityId: originId,
      successorKeys: [SUCESSOR.publicKey, ESTRANHO.publicKey],
    });
    assert.equal(r.ok, true);
    assert.ok(r.ok && r.escrowSeqs.length === 2);
    assert.deepEqual(
      c.g.world.state.community.successorKeys.map((k) => k.toString('hex')),
      [SUCESSOR.publicKey.toString('hex'), ESTRANHO.publicKey.toString('hex')],
      'a ordem é a prioridade (§18.8)',
    );

    const wrapped = escrowNoLog(c.g.world, SUCESSOR.publicKey.toString('hex'));
    assert.ok(wrapped !== null);
    const aberto = openSealedSeed(wrapped, SUCESSOR.publicKey, SUCESSOR.secretKey);
    assert.ok(aberto !== null && aberto.equals(SEMENTE), 'o sucessor recupera a semente da comunidade');
    assert.equal(openSealedSeed(wrapped, ESTRANHO.publicKey, ESTRANHO.secretKey), null);
  });

  it('R-17: quem não é o host corrente é recusado sem gastar op', async () => {
    const c = cenario({ identidade: keypairFromSeed('ana-servico') });
    const originId = c.g.world.core.publicKey.toString('hex');
    const antes = c.g.world.seq;
    const r = await c.service.setSuccessors({ communityId: originId, successorKeys: [SUCESSOR.publicKey] });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, 'E_NOT_HOST');
    assert.equal(c.g.world.seq, antes, 'nenhum registro entrou no log');
  });

  it('lista inválida é `E_VALIDATION`: acima do teto, repetida ou apontando para o próprio host', async () => {
    const c = cenario();
    const originId = c.g.world.core.publicKey.toString('hex');
    const seis = ['s1', 's2', 's3', 's4', 's5', 's6'].map((l) => keypairFromSeed(l).publicKey);
    for (const successorKeys of [
      seis,
      [SUCESSOR.publicKey, SUCESSOR.publicKey],
      [c.g.founder.publicKey],
    ]) {
      const r = await c.service.setSuccessors({ communityId: originId, successorKeys });
      assert.equal(!r.ok && r.code, 'E_VALIDATION');
    }
    assert.equal(c.g.world.state.community.successorKeys.length, 0);
  });
});

describe('§15.4 community.assumeHost — continuação (R-18, §18.8)', () => {
  /** O host designa e escrowa **antes** de sumir; quem roda o serviço depois é o sucessor. */
  function comEscrow(over: Parameters<typeof cenario>[0] = {}) {
    const c = cenario({ identidade: SUCESSOR, agora: DEPOIS_DO_GRACE, ...over });
    designaSucessor(c.g);
    return c;
  }

  it('cria a continuação, devolve o id novo e o `seq` 6 do assumeHost', async () => {
    const c = comEscrow();
    const originId = c.g.world.core.publicKey.toString('hex');
    const r = await c.service.assumeHost({ communityId: originId });
    assert.equal(r.ok, true, !r.ok ? r.code : '');
    if (!r.ok) return;
    assert.equal(r.seq, 6, 'assumeHost é o seq 6, logo após a gênese de R-27');
    assert.equal(c.criados.length, 1);
    assert.equal(r.newCommunityId, c.criados[0]!.keyPair.publicKey.toString('hex'));

    const novo = c.estados.get(r.newCommunityId)!()!;
    assert.ok(novo.community.hostKey.equals(SUCESSOR.publicKey));
    assert.equal(novo.community.originCommunityId, originId);
    assert.equal(c.g.world.state.community.hostKey.toString('hex'), c.g.founder.publicKey.toString('hex'));
    assert.equal(
      c.g.world.results.filter((x) => x.decision !== 'APPLIED').length,
      0,
      'nada foi escrito no core antigo pela assunção',
    );
  });

  it('camada b recusa: grace period aberto, quem não é sucessor e escrow ausente', async () => {
    const cedo = comEscrow({ agora: T0 + 600 });
    const originId = cedo.g.world.core.publicKey.toString('hex');
    const r1 = await cedo.service.assumeHost({ communityId: originId });
    assert.equal(!r1.ok && r1.code, 'E_SUCCESSION_DENIED');
    assert.equal(cedo.criados.length, 0);

    const outro = cenario({ identidade: ESTRANHO, agora: DEPOIS_DO_GRACE });
    designaSucessor(outro.g);
    const r2 = await outro.service.assumeHost({
      communityId: outro.g.world.core.publicKey.toString('hex'),
    });
    assert.equal(!r2.ok && r2.code, 'E_SUCCESSION_DENIED');

    // Sucessor legítimo, mas sem escrow no log: a lista sozinha não dá posse da semente.
    const semEscrow = cenario({ identidade: SUCESSOR, agora: DEPOIS_DO_GRACE });
    semEscrow.g.world.submit({
      kind: 'community.setSuccessors',
      author: semEscrow.g.founder,
      hostTs: T0 + 600,
      payload: { successorKeys: [SUCESSOR.publicKey] },
    });
    const r3 = await semEscrow.service.assumeHost({
      communityId: semEscrow.g.world.core.publicKey.toString('hex'),
    });
    assert.equal(!r3.ok && r3.code, 'E_SUCCESSION_DENIED');
  });
});

describe('§18.8.1 — reentrada assistida (L-23)', () => {
  async function continuacao() {
    const c = cenario({ identidade: SUCESSOR, agora: DEPOIS_DO_GRACE });
    const originId = c.g.world.core.publicKey.toString('hex');
    designaSucessor(c.g);
    const r = await c.service.assumeHost({ communityId: originId });
    assert.ok(r.ok);
    return { c, originId, continuationId: r.ok ? r.newCommunityId : '' };
  }

  /** Reentrada real: o sucessor publica o convite e a pessoa entra assinando o próprio join. */
  function reentra(mundo: World, quem: Keypair, host: Keypair, label: string) {
    const segredo = keypairFromSeed(`convite-reentrada-${label}`);
    mundo.submit({
      kind: 'invite.create',
      author: host,
      hostTs: DEPOIS_DO_GRACE + 20,
      payload: { invitePublicKey: segredo.publicKey },
    });
    return mundo.submit({
      kind: 'member.join',
      author: quem,
      hostTs: DEPOIS_DO_GRACE + 21,
      payload: {
        invitePublicKey: segredo.publicKey,
        joinProof: joinProof(mundo.core.publicKey, segredo, quem.publicKey),
        displayName: label,
        avatarColor: 1,
        blobsCoreKey: keypairFromSeed(`mb-${label}`).publicKey,
      },
    });
  }

  it('pendentes = ativos da origem que ainda não voltaram; o sucessor nunca está na lista', async () => {
    const { c, continuationId } = await continuacao();
    const pendentes = c.service.pendingReentry(continuationId).map((k) => k.toString('hex'));
    assert.deepEqual(
      [...pendentes].sort(),
      [c.g.founder.publicKey.toString('hex'), c.ana.publicKey.toString('hex')].sort(),
    );
    assert.ok(!pendentes.includes(SUCESSOR.publicKey.toString('hex')));

    const mundo = c.mundos.get(continuationId)!.world;
    const r = reentra(mundo, c.ana, SUCESSOR, 'ana-servico');
    assert.equal(r.decision, 'APPLIED');
    const depois = c.service.pendingReentry(continuationId).map((k) => k.toString('hex'));
    assert.deepEqual(depois, [c.g.founder.publicKey.toString('hex')], 'quem voltou sai da lista');
  });

  it('quem volta recupera os cargos que tinha na origem, casados por nome', async () => {
    const { c, continuationId } = await continuacao();
    const mundo = c.mundos.get(continuationId)!.world;
    reentra(mundo, c.ana, SUCESSOR, 'ana-servico');

    const r = await c.service.restoreRolesFor({
      continuationId,
      memberKeyHex: c.ana.publicKey.toString('hex'),
    });
    assert.equal(r.ok, true);
    const nomes = [...(mundo.state.members.get(c.ana.publicKey.toString('hex'))?.roleIds ?? [])]
      .map((id) => mundo.state.roles.get(id)?.name)
      .sort();
    assert.deepEqual(nomes, ['Membro', 'Moderação'], 'o cargo customizado volta pelo nome');
  });

  it('o Fundador não é restaurado: na continuação o fundador é o sucessor', async () => {
    const { c, continuationId } = await continuacao();
    const mundo = c.mundos.get(continuationId)!.world;
    reentra(mundo, c.g.founder, SUCESSOR, 'host-antigo');

    const r = await c.service.restoreRolesFor({
      continuationId,
      memberKeyHex: c.g.founder.publicKey.toString('hex'),
    });
    // Só tinha Fundador e base na origem: nada a devolver além do base que R-3 já deu.
    assert.equal(r.ok && 'skipped' in r && r.skipped, true);
    const nomes = [...(mundo.state.members.get(c.g.founder.publicKey.toString('hex'))?.roleIds ?? [])]
      .map((id) => mundo.state.roles.get(id)?.name);
    assert.deepEqual(nomes, ['Membro']);
    assert.ok(mundo.state.community.hostKey.equals(SUCESSOR.publicKey));
  });

  it('quem não é membro da continuação não tem cargo a restaurar', async () => {
    const { c, continuationId } = await continuacao();
    const r = await c.service.restoreRolesFor({
      continuationId,
      memberKeyHex: c.ana.publicKey.toString('hex'),
    });
    assert.equal(!r.ok && r.code, 'E_NOT_MEMBER');
  });
});

// ─── Fronteira IPC-R (§15.3, §15.4 "Comunidade") ────────────────────────────────────────

describe('§15.4 — as duas superfícies de sucessão no roteador IPC-R', () => {
  /** Roteador com só a superfície de sucessão registrada; `authToken` sempre válido. */
  async function rig(service: SuccessionService, tokenOk = true) {
    const [coreSide, rendererSide] = MemoryIpcPort.createPair();
    const server = new IpcServer({
      epoch: 1,
      port: coreSide,
      tokenVerifier: { consume: () => tokenOk },
      identityStatus: { isLoaded: true },
    });
    registerCoreCommands(server, {
      diagnostics: { run: async () => ({}) as never, snapshot: () => ({}) as never } as never,
      search: { search: () => ({}) as never } as never,
      succession: service,
    });
    const client = new IpcClient();
    client.attach(rendererSide);
    const hello = client.waitForHello(1_000);
    server.sendHello('sucessao', 2);
    await hello;
    return client;
  }

  it('`community.setSuccessors` devolve `{seq}` e converte hex do renderer', async () => {
    const c = cenario();
    const client = await rig(c.service);
    const r = (await client.request('community.setSuccessors', {
      communityId: c.g.world.core.publicKey.toString('hex'),
      successorKeys: [SUCESSOR.publicKey.toString('hex')],
    })) as { seq: number };
    assert.equal(typeof r.seq, 'number');
    assert.deepEqual(
      c.g.world.state.community.successorKeys.map((k) => k.toString('hex')),
      [SUCESSOR.publicKey.toString('hex')],
    );
  });

  it('chave fora da forma é `E_VALIDATION` na fronteira, antes de qualquer op', async () => {
    const c = cenario();
    const client = await rig(c.service);
    const antes = c.g.world.seq;
    await assert.rejects(
      () =>
        client.request('community.setSuccessors', {
          communityId: c.g.world.core.publicKey.toString('hex'),
          successorKeys: ['nao-e-hex'],
        }),
      (e: { code?: string }) => e.code === 'E_VALIDATION',
    );
    assert.equal(c.g.world.seq, antes);
  });

  it('o código do serviço chega ao renderer: R-17 vira `E_NOT_HOST`', async () => {
    const c = cenario({ identidade: keypairFromSeed('ana-servico') });
    const client = await rig(c.service);
    await assert.rejects(
      () =>
        client.request('community.setSuccessors', {
          communityId: c.g.world.core.publicKey.toString('hex'),
          successorKeys: [SUCESSOR.publicKey.toString('hex')],
        }),
      (e: { code?: string }) => e.code === 'E_NOT_HOST',
    );
  });

  it('`community.assumeHost` é main-confirmed: sem token confirmado, nem chega ao serviço', async () => {
    const c = cenario({ identidade: SUCESSOR, agora: DEPOIS_DO_GRACE });
    designaSucessor(c.g);
    const client = await rig(c.service, false);
    await assert.rejects(
      () => client.request('community.assumeHost', { communityId: c.g.world.core.publicKey.toString('hex') }),
      (e: { code?: string }) => e.code === 'E_PERMISSION_DENIED',
    );
    assert.equal(c.criados.length, 0, 'nenhuma continuação foi criada');
  });

  it('com token confirmado, `community.assumeHost` devolve `{newCommunityId, seq}`', async () => {
    const c = cenario({ identidade: SUCESSOR, agora: DEPOIS_DO_GRACE });
    designaSucessor(c.g);
    const client = await rig(c.service);
    // §15.3: main-confirmed exige o `authToken` emitido pelo main após confirmação nativa.
    const r = (await client.request(
      'community.assumeHost',
      { communityId: c.g.world.core.publicKey.toString('hex') },
      'token-confirmado',
    )) as { newCommunityId: string; seq: number };
    assert.equal(r.seq, 6);
    assert.equal(r.newCommunityId, c.criados[0]!.keyPair.publicKey.toString('hex'));
  });
});
