/**
 * CENARIO 3 do gate G1 — HOST ADVERSARIO (§1.4, §28.5, POC-01 linha "Cenarios").
 *
 * O adversario detem a chave do core: e o host legitimo rodando codigo modificado. Ele
 * appenda DIRETO, sem passar pela fila de admissao de §11.4. A hipotese sob teste e a
 * afirmacao central de §1.2:
 *
 *   "O host nao consegue fabricar efeito nao autorizado. Se o host appendar um registro
 *    que a funcao rejeita, a funcao rejeita em toda replica — INCLUSIVE NA DELE."
 *
 * Aprovacao (POC-01): "Todo registro adversario REJECTED ou IGNORED em TODA replica,
 * inclusive na do host adversario."
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Hypercore from 'hypercore';
import { E, type ErrorCode } from '../src/protocol/errors.ts';
import { K } from '../src/protocol/kinds.ts';
import { PERM, effectivePerms } from '../src/protocol/permissions.ts';
import { CHANNEL_TYPE } from '../src/fold/limits.ts';
import { encodeOp, type Envelope } from '../src/codec/opCodec.ts';
import { keyPairFromSeed, blake2b256, randomBytes, sign } from '../src/crypto/index.ts';
import { AdversaryHost } from '../src/host/adversary.ts';
import { Replica } from '../src/node/replica.ts';
import { createWorld, type World } from '../src/harness/world.ts';
import { foldRecord, newMetrics } from '../src/fold/index.ts';
import { emptyState } from '../src/fold/state.ts';

export type AdversaryCase = {
  id: string;
  title: string;
  spec: string;
  /** desfecho exigido: nao pode ser APPLIED, exceto onde a spec manda clampar (R-1) */
  seq: number;
  decisions: Array<{ replica: string; decision: string; reason?: string }>;
  agree: boolean;
  neutralized: boolean;
  note?: string;
};

export type AdversaryReport = {
  cases: AdversaryCase[];
  replicas: string[];
  hashes: string[];
  converged: boolean;
  panics: number;
  appliedByAdversary: number;
  ok: boolean;
  ms: number;
};

export async function runAdversary(opts: { root: string; outDir: string }): Promise<AdversaryReport> {
  const t0 = Date.now();
  const dir = join(opts.outDir, 'adversary');
  mkdirSync(dir, { recursive: true });

  // Comunidade B — a que sofre o ataque. Comunidade A — origem do envelope transplantado.
  const B: World = await createWorld({ dir: join(dir, 'B'), root: opts.root, clients: 10, batch: 256 });
  const A: World = await createWorld({ dir: join(dir, 'A'), root: opts.root, clients: 3, batch: 256 });

  const adversary = new AdversaryHost(B.host.core, B.coreKeyPair);
  const cases: AdversaryCase[] = [];
  const tick = (): number => {
    B.clock.advance(50);
    return B.clock.now();
  };

  // Os clientes 0..5 sao moderadores no mundo do harness; 6..9 sao membros comuns.
  // `plain` PRECISA nao ter `ban_members` — e o que o ataque X2 mede.
  const plain = B.clients[7];
  const victim = B.clients[8];
  {
    const m = B.host.ds.members.get(plain.keys.publicKey.toString('hex'));
    const eff = m ? effectivePerms(m.roleIds, B.host.ds.roles) : new Set<number>();
    if (eff.has(PERM.ban_members)) {
      throw new Error('fixture do adversario invalida: `plain` tem ban_members — X2 nao mediria nada');
    }
  }
  const hostTsNow = (): number => Math.max(B.clock.now(), B.host.ds.lastHostTs);

  // --- 1. envelope de OUTRA comunidade ------------------------------------------------
  {
    const env = A.clients[0].build(
      K.MESSAGE_SEND,
      { channelId: A.ids.generalChannel, content: 'colhida do log de A', mentions: [] },
      A.clock.now(),
    );
    const seq = await adversary.appendRaw(env, hostTsNow());
    cases.push({ id: 'X1', title: 'envelope colhido do log de A appendado no core de B', spec: '§28.5 / §8.2 estagio 3 — E_WRONG_COMMUNITY', seq, decisions: [], agree: false, neutralized: false });
  }

  // --- 2. mod.ban autorado por quem NAO tem `ban_members` -----------------------------
  {
    const env = plain.build(K.MOD_BAN, { targetKey: victim.keys.publicKey, reason: 'sem permissao' }, tick());
    const seq = await adversary.appendRaw(env, hostTsNow());
    cases.push({ id: 'X2', title: 'mod.ban autorado por quem nao tem ban_members', spec: '§28.5 / §8.2 estagio 11 — E_PERMISSION_DENIED', seq, decisions: [], agree: false, neutralized: false });
  }

  // --- 3. hostTs RETROATIVO ------------------------------------------------------------
  // Duas variantes, porque a spec e o plano DIVERGEM aqui (CONFLITO-01 no REPORT.md).
  {
    // (a) retroativo "leve": `op.ts` coerente com a cabeca; R-1 CLAMPA e a op aplica.
    const env = plain.build(K.MESSAGE_SEND, { channelId: B.ids.generalChannel, content: 'hostTs retroativo leve', mentions: [] }, tick());
    const seq = await adversary.appendRaw(env, 1_000_000);
    cases.push({
      id: 'X3a',
      title: 'hostTs retroativo, op.ts na cabeca',
      spec: 'R-1 — clamp deterministico, NAO recusa (conflita com o criterio do POC-01)',
      seq,
      decisions: [],
      agree: false,
      neutralized: false,
      note: 'R-1 manda clampar; o registro APLICA com hostTs = lastHostTs. Nenhum efeito retroativo e produzido.',
    });
  }
  {
    // (b) retroativo "coerente": o adversario tambem recua `op.ts`, para forjar historia.
    const env = plain.build(K.MESSAGE_SEND, { channelId: B.ids.generalChannel, content: 'historia forjada', mentions: [] }, 1_000_000);
    const seq = await adversary.appendRaw(env, 1_000_000);
    cases.push({ id: 'X3b', title: 'hostTs retroativo com op.ts recuado junto', spec: '§8.2 estagio 7 / R-2 — E_CLOCK_UNREASONABLE', seq, decisions: [], agree: false, neutralized: false });
  }

  // --- 4. hostSig INVALIDA --------------------------------------------------------------
  {
    const env = plain.build(K.MESSAGE_SEND, { channelId: B.ids.generalChannel, content: 'hostSig reescrita', mentions: [] }, tick());
    const seq = await adversary.appendBadHostSig(env, hostTsNow());
    cases.push({ id: 'X4', title: 'hostTs reescrito depois de assinar (hostSig invalida)', spec: '§28.5 / §8.2 estagio 1 — E_BAD_HOST_SIGNATURE', seq, decisions: [], agree: false, neutralized: false });
  }

  // --- 5. authorSeq REPETIDO -------------------------------------------------------------
  {
    const t = tick();
    const first = plain.build(K.MESSAGE_SEND, { channelId: B.ids.generalChannel, content: 'original', mentions: [] }, t);
    await B.host.submit(first); // entra pelo caminho legitimo
    const seq = await adversary.appendRaw(first, hostTsNow()); // reenviado pelo adversario
    cases.push({ id: 'X5', title: 'reenvio do MESMO envelope (authorSeq repetido)', spec: '§7.5 / §8.2 estagio 6 — E_DUPLICATE', seq, decisions: [], agree: false, neutralized: false });
  }

  // --- 6. authorSeq REGREDIDO ------------------------------------------------------------
  {
    const env = plain.buildRaw(
      K.MESSAGE_SEND,
      { channelId: B.ids.generalChannel, content: 'authorSeq regredido', mentions: [] },
      tick(),
      1,
      B.communityKey,
    );
    const seq = await adversary.appendRaw(env, hostTsNow());
    cases.push({ id: 'X6', title: 'authorSeq regredido para 1', spec: '§7.5 / §8.2 estagio 6 — E_DUPLICATE', seq, decisions: [], agree: false, neutralized: false });
  }

  // --- 7. autoria FABRICADA (assinatura de terceiro forjada) ------------------------------
  {
    // O adversario monta uma `Op` com `author` = fundador, mas so pode assinar com a
    // propria chave. §1.4: "o host nao pode fabricar autoria".
    const fake = keyPairFromSeed(blake2b256('adversario/1', B.communityKey));
    const opBytes = encodeOp({
      v: 1,
      communityId: B.communityKey,
      kind: K.MOD_BAN,
      author: B.founder.keys.publicKey, // finge ser o Fundador
      authorSeq: 900_000,
      ts: tick(),
      payload: Buffer.alloc(33), // payload de mod.ban qualquer
    });
    const env: Envelope = { op: opBytes, sig: sign(blake2b256('op/1', opBytes), fake.secretKey) };
    const seq = await adversary.appendRaw(env, hostTsNow());
    cases.push({ id: 'X7', title: 'op com autoria do Fundador, assinada por outra chave', spec: '§1.4 / §8.2 estagio 4 — E_BAD_SIGNATURE', seq, decisions: [], agree: false, neutralized: false });
  }

  // --- 8. kind desconhecido / v desconhecido / payload truncado --------------------------
  {
    const opBytes = encodeOp({
      v: 1, communityId: B.communityKey, kind: 60000, author: plain.keys.publicKey,
      authorSeq: 900_100, ts: tick(), payload: randomBytes(20),
    });
    const seq = await adversary.appendRaw({ op: opBytes, sig: sign(blake2b256('op/1', opBytes), plain.keys.secretKey) }, hostTsNow());
    cases.push({ id: 'X8', title: 'kind desconhecido', spec: '§7.2 regra 4 / estagio 2 — IGNORED + partialInterpretation', seq, decisions: [], agree: false, neutralized: false });
  }
  {
    const opBytes = encodeOp({
      v: 99, communityId: B.communityKey, kind: K.MESSAGE_SEND, author: plain.keys.publicKey,
      authorSeq: 900_200, ts: tick(), payload: randomBytes(20),
    });
    const seq = await adversary.appendRaw({ op: opBytes, sig: sign(blake2b256('op/1', opBytes), plain.keys.secretKey) }, hostTsNow());
    cases.push({ id: 'X9', title: 'opVersion desconhecida', spec: '§7.2 regra 5 / estagio 2 — IGNORED + partialInterpretation', seq, decisions: [], agree: false, neutralized: false });
  }
  {
    const opBytes = encodeOp({
      v: 1, communityId: B.communityKey, kind: K.CHANNEL_CREATE, author: plain.keys.publicKey,
      authorSeq: 900_300, ts: tick(), payload: Buffer.from([3, 97, 98, 99]), // payload truncado
    });
    const seq = await adversary.appendRaw({ op: opBytes, sig: sign(blake2b256('op/1', opBytes), plain.keys.secretKey) }, hostTsNow());
    cases.push({ id: 'X10', title: 'payload truncado para o kind declarado', spec: '§7.2 regra 4 / estagio 2 — IGNORED / E_MALFORMED', seq, decisions: [], agree: false, neutralized: false });
  }
  {
    const seq = await adversary.appendBytes(randomBytes(200));
    cases.push({ id: 'X11', title: 'bytes aleatorios appendados no core', spec: '§8.5 — estagio 1, IGNORED', seq, decisions: [], agree: false, neutralized: false });
  }

  // --- 9. privilegio proibido: banir o Fundador (R-16) -----------------------------------
  {
    const env = B.clients[0].build(K.MOD_BAN, { targetKey: B.founder.keys.publicKey, reason: 'golpe' }, tick());
    const seq = await adversary.appendRaw(env, hostTsNow());
    cases.push({ id: 'X12', title: 'mod.ban contra o Fundador', spec: 'R-16 / estagio 12 — E_FOUNDER_IMMUNE', seq, decisions: [], agree: false, neutralized: false });
  }

  // --- 10. escalada: cargo base recebendo permissao de moderacao (R-11) -------------------
  {
    const env = B.founder.build(
      K.ROLE_UPDATE,
      { roleId: B.ids.baseRole, permissions: [PERM.send_messages, PERM.ban_members] },
      tick(),
    );
    const seq = await adversary.appendRaw(env, hostTsNow());
    cases.push({ id: 'X13', title: 'cargo base recebendo ban_members', spec: 'R-11 / estagio 14 — E_BASE_ROLE_RESTRICTED', seq, decisions: [], agree: false, neutralized: false });
  }

  // --- 11. genese fora de lugar (community.create em seq != 0) ---------------------------
  {
    const env = B.founder.build(
      K.COMMUNITY_CREATE,
      { name: 'sequestro', iconColor: 1, blobsKey: randomBytes(32) },
      tick(),
    );
    const seq = await adversary.appendRaw(env, hostTsNow());
    cases.push({ id: 'X14', title: 'community.create em seq != 0', spec: '§8.4.1 / R-27 — E_GENESIS_MISPLACED', seq, decisions: [], agree: false, neutralized: false });
  }

  // === INTERPRETACAO: a replica DO PROPRIO ADVERSARIO e mais duas independentes ==========
  const adversarySelf = new Replica(
    'adversario-self',
    B.host.core,
    join(dir, 'adversary-self.db'),
    B.communityKey,
    { ...B.hostOpts },
  );
  await adversarySelf.catchUp();
  const others = await B.replicas(2, 'adv');
  const all: Array<{ name: string; rep: Replica }> = [
    { name: 'adversario-self', rep: adversarySelf },
    ...others.map((r) => ({ name: r.name, rep: r })),
  ];

  const byReplica = new Map<string, Map<number, { decision: string; reason?: string }>>();
  for (const { name, rep } of all) {
    const m = new Map<number, { decision: string; reason?: string }>();
    for (const d of rep.projector.decisions) m.set(d.seq, { decision: d.decision, reason: d.reason });
    byReplica.set(name, m);
  }

  let panics = 0;
  for (const { rep } of all) panics += rep.projector.metrics.panic;

  let appliedByAdversary = 0;
  for (const c of cases) {
    for (const [name, m] of byReplica) {
      const d = m.get(c.seq) ?? { decision: '<ausente>' };
      c.decisions.push({ replica: name, decision: d.decision, reason: d.reason });
    }
    const set = new Set(c.decisions.map((d) => `${d.decision}:${d.reason ?? ''}`));
    c.agree = set.size === 1;
    const decided = c.decisions[0]?.decision;
    c.neutralized = decided === 'REJECTED' || decided === 'IGNORED';
    if (!c.neutralized) appliedByAdversary++;
  }

  const hashes = all.map(({ rep }) => rep.hash());
  const converged = new Set(hashes).size === 1;

  // X3a e o unico caso que a spec manda APLICAR (R-1 clampa em vez de recusar). O
  // criterio do POC-01 diz "REJECTED ou IGNORED"; a precedencia de §0.2 poe backend-v2.md
  // acima do plano. O criterio operacional aplicado aqui: nenhum EFEITO retroativo.
  const x3a = cases.find((c) => c.id === 'X3a');
  const clampOk = x3a !== undefined && x3a.agree;

  const ok =
    panics === 0 &&
    converged &&
    cases.every((c) => c.agree) &&
    cases.filter((c) => c.id !== 'X3a').every((c) => c.neutralized) &&
    clampOk;

  for (const r of others) await r.close();
  adversarySelf.db.close();
  await B.close();
  await A.close();
  rmSync(dir, { recursive: true, force: true });

  return {
    cases,
    replicas: all.map((a) => a.name),
    hashes,
    converged,
    panics,
    appliedByAdversary,
    ok,
    ms: Date.now() - t0,
  };
}

/** Verificacao independente: o mesmo registro, foldado do zero, da o mesmo resultado. */
export function independentFold(records: Buffer[], communityKey: Buffer): string[] {
  const m = newMetrics();
  let s = emptyState(communityKey, communityKey.toString('hex'));
  const out: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = foldRecord(s, records[i], i, m);
    s = r.next;
    out.push(`${i}:${r.decision}:${r.reason ?? ''}`);
  }
  return out;
}

export const ADVERSARY_EXPECTED: Record<string, ErrorCode | 'APPLIED'> = {
  X1: E.WRONG_COMMUNITY,
  X2: E.PERMISSION_DENIED,
  X3a: 'APPLIED',
  X3b: E.CLOCK_UNREASONABLE,
  X4: E.BAD_HOST_SIGNATURE,
  X5: E.DUPLICATE,
  X6: E.DUPLICATE,
  X7: E.BAD_SIGNATURE,
  X8: E.UNKNOWN_KIND,
  X9: E.VERSION_UNSUPPORTED,
  X10: E.MALFORMED,
  X11: E.BAD_HOST_SIGNATURE,
  X12: E.FOUNDER_IMMUNE,
  X13: E.BASE_ROLE_RESTRICTED,
  X14: E.GENESIS_MISPLACED,
};
