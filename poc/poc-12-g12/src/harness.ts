// Cenários do POC-12 / G12 no escopo Node — sucessão de host sobre os módulos REAIS do
// core (fold, opCodec, succession). Os escrows são lidos do LOG bruto da origem e abertos
// com as chaves de cada sucessor; a continuação é validada pelo `foldRecord` real.

import sodium from 'sodium-native';

import { core, type DecisionState } from './core.js';

export type Profile = 'quick' | 'full';

export interface Step {
  id: string;
  desc: string;
  ok: boolean;
}

export interface ScenarioOutcome {
  steps: Step[];
  metrics: Record<string, unknown>;
  ok: boolean;
}

interface Origin {
  g: ReturnType<typeof core.genesis>;
  communitySeed: Buffer;
  successors: { publicKey: Buffer; secretKey: Buffer }[];
  /** Escrow lido do log bruto: pk do alvo (hex) → wrappedSeed. */
  wrappedByPkHex: Map<string, Buffer>;
}

/** Origem real: sucessores designados, escrows appendados, membros de conteúdo. */
function buildOrigin(t0: number, profile: Profile): Origin {
  const g = core.genesis();
  if (profile === 'full') {
    for (const label of ['m0', 'm1']) core.joinMember(g, label);
  }
  const successors = [
    core.keypairFromSeed('suc-p0'),
    core.keypairFromSeed('suc-p1'),
    core.keypairFromSeed('suc-p2'),
  ];

  let ts = g.world.state.lastHostTs + 10;
  g.world.submit({
    kind: 'community.setSuccessors',
    author: g.founder,
    hostTs: ts,
    payload: { successorKeys: successors.map((s) => s.publicKey) },
  });

  // a semente escrowada É a que deriva o core antigo (§5.3) — mesma construção de
  // helpers/world.ts (`keypairFromSeed('core')`) para o escrow fechar o ciclo real
  const communitySeed = Buffer.alloc(32);
  Buffer.from('core', 'utf8').copy(communitySeed);
  for (const suc of successors) {
    ts += 10;
    g.world.submit({
      kind: 'community.escrow',
      author: g.founder,
      hostTs: ts,
      payload: { targetKey: suc.publicKey, wrappedSeed: core.sealSeedFor(suc.publicKey, communitySeed) },
    });
  }

  // leitura do escrow no LOG BRUTO (kind#44) — o fold não guarda o conteúdo (é opaco)
  const KIND_ESCROW = 44;
  const wrappedByPkHex = new Map<string, Buffer>();
  for (const rec of g.world.log) {
    const hr = core.decodeHostRecord(rec);
    const env = hr !== null ? core.decodeEnvelope(hr.envelope) : null;
    const op = env !== null ? core.decodeOp(env.op) : null;
    if (op === null || op.kind !== KIND_ESCROW) continue;
    const payload = core.decodePayload('community.escrow', op.payload);
    if (payload === null) continue;
    wrappedByPkHex.set(payload.targetKey.toString('hex'), payload.wrappedSeed);
  }

  return { g, communitySeed, successors, wrappedByPkHex };
}

function deriveOldCoreKeys(communitySeed: Buffer): { publicKey: Buffer; secretKey: Buffer } {
  const pk = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
  const sk = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
  sodium.crypto_sign_seed_keypair(pk, sk, communitySeed);
  return { publicKey: pk, secretKey: sk };
}

/** Aplica registros via fold REAL a partir da chave de comunidade conhecida. */
function applyAll(records: readonly Buffer[], communityKey: Buffer): {
  state: DecisionState;
  decisions: { seq: number; decision: string; reason?: string }[];
} {
  let state: DecisionState = core.emptyState(communityKey);
  const decisions: { seq: number; decision: string; reason?: string }[] = [];
  records.forEach((rec, seq) => {
    const r = core.foldRecord(state, rec, seq, core.newMetrics());
    decisions.push(r.reason === undefined ? { seq, decision: r.decision } : { seq, decision: r.decision, reason: r.reason });
    state = r.decision === 'APPLIED' ? r.next : state;
  });
  return { state, decisions };
}

export async function runScenarios(profile: Profile): Promise<ScenarioOutcome> {
  const t0 = 1_900_000_000_000;
  const steps: Step[] = [];
  const metrics: Record<string, unknown> = {};
  const ttl = core.HOST_INACTIVITY_MS;

  // ── S1 — escrow lido do log: só o alvo abre; intruso/adulterado → null ──────────────
  {
    const origin = buildOrigin(t0, profile);
    const p1 = origin.successors[1]!;
    const abertos = origin.successors.filter((s) => {
      const w = origin.wrappedByPkHex.get(s.publicKey.toString('hex'));
      return w !== undefined && core.openSealedSeed(w, s.publicKey, s.secretKey)?.equals(origin.communitySeed) === true;
    });
    const wP0 = origin.wrappedByPkHex.get(origin.successors[0]!.publicKey.toString('hex'));
    if (wP0 === undefined) throw new Error('escrow do p0 ausente no log');
    const p1abreP0 = core.openSealedSeed(wP0, p1.publicKey, p1.secretKey);
    const corrompido = (() => {
      const w = Buffer.from(wP0);
      w[w.length - 1] = (w.at(-1) ?? 0) ^ 0xff;
      return core.openSealedSeed(w, origin.successors[0]!.publicKey, origin.successors[0]!.secretKey);
    })();
    steps.push({
      id: 'S1',
      desc: 'escrow crypto_box_seal por sucessor, lido do log bruto — só o alvo abre; intruso e adulterado → null',
      ok: abertos.length === origin.successors.length && p1abreP0 === null && corrompido === null,
    });
    metrics['S1'] = {
      escrowsNoLog: origin.wrappedByPkHex.size,
      abriramProprio: abertos.length,
      intrusoRecusado: p1abreP0 === null,
      adulteradoRecusado: corrompido === null,
    };
  }

  // ── S2/S3/S4 — grace period + continuação aceita pelo fold REAL + estrutura ─────────
  {
    const origin = buildOrigin(t0, profile);
    const p0 = origin.successors[0]!;
    const facts = {
      communityIdHex: origin.g.world.state.communityId,
      successorKeysHex: origin.successors.map((s) => s.publicKey.toString('hex')),
      lastHostTs: origin.g.world.state.lastHostTs,
    };
    const oldCore = deriveOldCoreKeys(origin.communitySeed);

    const claim = {
      communityIdHex: '', // preenchido após o plano
      originCommunityIdHex: facts.communityIdHex,
      originFinalSeq: origin.g.world.state.interpretedSeq,
      assumedByHex: p0.publicKey.toString('hex'),
    };
    const antesDoGrace = core.evaluateLayerB({ claim, origin: facts, ttlMs: ttl, now: facts.lastHostTs + ttl - 1 });
    const aposGrace = core.evaluateLayerB({ claim, origin: facts, ttlMs: ttl, now: facts.lastHostTs + ttl + 1 });
    const estranho = core.evaluateLayerB({
      claim: { ...claim, assumedByHex: hexDe('fora-da-lista') },
      origin: facts,
      ttlMs: ttl,
      now: facts.lastHostTs + ttl + 1,
    });

    const plan = core.planContinuation({
      originState: origin.g.world.state,
      originCoreSecretKey: oldCore.secretKey,
      successorIdentity: p0,
      newCoreSeed: Buffer.alloc(32, 0xAB),
      newBlobsSeed: Buffer.alloc(32, 0xCD),
      hostTs: facts.lastHostTs + ttl + 10,
    });
    const claimCompleto = { ...claim, communityIdHex: plan.newCoreKeyPair.publicKey.toString('hex') };
    const aposGraceComId = core.evaluateLayerB({ claim: claimCompleto, origin: facts, ttlMs: ttl, now: facts.lastHostTs + ttl + 1 });

    const { state: novo, decisions } = applyAll(plan.records, plan.newCoreKeyPair.publicKey);
    const todosAplicados = decisions.every((d) => d.decision === 'APPLIED');

    // R-18(a): prova verifica contra a chave pública do core ANTIGO — não contra a nova
    const digest = (() => {
      const b = Buffer.allocUnsafe(32);
      sodium.crypto_generichash_batch(b, [
        Buffer.from('assume/1'),
        plan.newCoreKeyPair.publicKey,
        (() => {
          const x = Buffer.alloc(8);
          x.writeBigUInt64LE(BigInt(plan.originFinalSeq));
          return x;
        })(),
      ]);
      return b;
    })();
    const provaOk = core.verifySignature(plan.proof, digest, origin.g.world.core.publicKey);
    const provaNaoENova = !core.verifySignature(plan.proof, digest, plan.newCoreKeyPair.publicKey);

    steps.push({
      id: 'S2',
      desc: 'grace period (camada b de R-18) — antes de HOST_INACTIVITY_MS ninguém assume; depois abre pela lista; fora dela nunca',
      ok:
        chavesDerivam(oldCore, origin.g.world.core) &&
        antesDoGrace.ok === false &&
        antesDoGrace.reason === 'grace-period' &&
        aposGrace.ok === true &&
        estranho.ok === false &&
        estranho.reason === 'not-successor' &&
        aposGraceComId.ok === true,
    });
    metrics['S2'] = {
      chavesDerivadasDaSeed: chavesDerivam(oldCore, origin.g.world.core),
      antesDoGrace,
      aposGrace,
      foraDaLista: estranho,
    };

    steps.push({
      id: 'S3',
      desc: 'continuação aceita pelo fold REAL: gênese carrega origin*, assumeHost na seq 6 valida R-18a, host vira o sucessor',
      ok:
        todosAplicados &&
        provaOk &&
        provaNaoENova &&
        novo.community.hostKey.equals(p0.publicKey) &&
        novo.community.originCommunityId === facts.communityIdHex &&
        novo.community.originFinalSeq === origin.g.world.state.interpretedSeq,
    });
    metrics['S3'] = {
      registros: plan.records.length,
      todosAplicados,
      provaVerificaContraOrigem: provaOk,
      provaNaoVerificaContraNovo: provaNaoENova,
      origemDeclaradaNaGenese: novo.community.originCommunityId === facts.communityIdHex,
      hostNovoESucessor: novo.community.hostKey.equals(p0.publicKey),
    };

    const nomes = <T extends { name: string; deletedAt?: number }>(m: Map<string, T>) =>
      [...m.values()].filter((x) => x.deletedAt === undefined).map((x) => x.name).sort();
    const estruturaOk =
      JSON.stringify(nomes(novo.roles)) === JSON.stringify(nomes(origin.g.world.state.roles)) &&
      JSON.stringify(nomes(novo.categories)) === JSON.stringify(nomes(origin.g.world.state.categories)) &&
      JSON.stringify(nomes(novo.channels)) === JSON.stringify(nomes(origin.g.world.state.channels));
    steps.push({
      id: 'S4',
      desc: 'estrutura (cargos/categorias/canais) preservada; mensagens/convites/relays não migram (L-15); ACHADO-G12-01 medido',
      ok: estruturaOk && novo.messages.size === 0 && novo.invites.size === 0 && novo.relays.size === 0 && novo.members.size === 1,
    });
    metrics['S4'] = {
      cargosOrigem: nomes(origin.g.world.state.roles),
      canaisOrigem: nomes(origin.g.world.state.channels),
      estruturaPreservada: estruturaOk,
      mensagensMigradas: novo.messages.size,
      membrosNaContinuacao: novo.members.size,
      achadoG12_01: 'membership segue autoria do op: o lote estendido não reconstrói terceiros (§27) — convergência por reentrada via convites',
    };
  }

  // ── S5 — arbitragem L-16 + disputed + réplica sem origem ────────────────────────────
  {
    const origin = buildOrigin(t0, profile);
    const p0 = origin.successors[0]!;
    const p2 = origin.successors[2]!;
    const facts = {
      communityIdHex: origin.g.world.state.communityId,
      successorKeysHex: origin.successors.map((s) => s.publicKey.toString('hex')),
      lastHostTs: origin.g.world.state.lastHostTs,
    };
    const agora = facts.lastHostTs + ttl + 1;
    const mkClaim = (author: { publicKey: Buffer }, id: string) => ({
      communityIdHex: id,
      originCommunityIdHex: facts.communityIdHex,
      originFinalSeq: origin.g.world.state.interpretedSeq,
      assumedByHex: author.publicKey.toString('hex'),
    });
    const r0 = core.evaluateLayerB({ claim: mkClaim(p0, 'aa'.repeat(32)), origin: facts, ttlMs: ttl, now: agora });
    const r2 = core.evaluateLayerB({ claim: mkClaim(p2, 'bb'.repeat(32)), origin: facts, ttlMs: ttl, now: agora });
    const escolha = core.chooseContinuation([
      { claim: mkClaim(p2, 'bb'.repeat(32)), priorityIndex: r2.ok ? r2.priorityIndex : 99 },
      { claim: mkClaim(p0, 'aa'.repeat(32)), priorityIndex: r0.ok ? r0.priorityIndex : 99 },
    ]);
    const disputada = core.dispositionFor({
      claim: mkClaim(core.keypairFromSeed('fora-da-lista'), 'cc'.repeat(32)),
      origin: facts,
      ttlMs: ttl,
      now: agora,
    });
    const semOrigem = core.dispositionFor({ claim: mkClaim(p2, 'bb'.repeat(32)), origin: null, ttlMs: ttl, now: agora });

    const ok =
      r0.ok &&
      r2.ok &&
      escolha !== null &&
      escolha.chosen.claim.assumedByHex === p0.publicKey.toString('hex') &&
      escolha.orphans.length === 1 &&
      disputada.migrate === false &&
      disputada.disputed === true &&
      semOrigem.migrate === true;
    steps.push({
      id: 'S5',
      desc: 'L-16 — duas continuações válidas: réplicas seguem a de maior prioridade; claim fora da lista vira disputed; quem não tem a origem segue a camada a',
      ok,
    });
    metrics['S5'] = {
      prioridades: [r0, r2],
      escolhida: escolha?.chosen.claim.assumedByHex.slice(0, 8) ?? null,
      orfas: escolha?.orphans.length ?? null,
      claimEstrangeiro: disputada,
      replicaSemOrigemSegueCamadaA: semOrigem,
    };
  }

  // ── S6 — assunção não escreve no core antigo; host que volta não desfaz nada ────────
  {
    const origin = buildOrigin(t0, profile);
    const lenAntes = origin.g.world.seq;
    const p0 = origin.successors[0]!;
    const oldCore = deriveOldCoreKeys(origin.communitySeed);
    const plan = core.planContinuation({
      originState: origin.g.world.state,
      originCoreSecretKey: oldCore.secretKey,
      successorIdentity: p0,
      newCoreSeed: Buffer.alloc(32, 0xAB),
      newBlobsSeed: Buffer.alloc(32, 0xCD),
      hostTs: origin.g.world.state.lastHostTs + ttl + 10,
    });
    void plan;
    const lenDepois = origin.g.world.seq;
    steps.push({
      id: 'S6',
      desc: 'assunção não escreve no core antigo — host que volta depois encontra o log intacto, sem mecanismo de desfazer',
      ok: lenAntes === lenDepois,
    });
    metrics['S6'] = { ultimoSeqAntes: lenAntes - 1, ultimoSeqDepois: lenDepois - 1, coreAntigoIntacto: lenAntes === lenDepois };
  }

  return { steps, metrics, ok: steps.every((s) => s.ok) };
}

function chavesDerivam(derivadas: { publicKey: Buffer }, esperadas: { publicKey: Buffer }): boolean {
  return derivadas.publicKey.equals(esperadas.publicKey);
}

function hexDe(label: string): string {
  return core.keypairFromSeed(label).publicKey.toString('hex');
}
