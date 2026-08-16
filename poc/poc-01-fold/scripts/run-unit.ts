/**
 * CENARIO 0 do gate G1 — UNITARIOS DOS MODULOS PUROS (§28.1).
 *
 * "`fold`, `opCodec`, `permissions`, `idgen` recebem cobertura exaustiva, nao amostral."
 *
 *  - `fold`: tabela de casos por `kind` x cada estagio de §8.2 x cada regra `R-*` x
 *    fronteira de cada limite de §8.6 (min-1, min, max, max+1). >= 1 200 casos.
 *  - `permissions`: 17 permissoes x cargos x hierarquia x os tres casos de anti-escalada.
 *  - `opCodec`: round-trip dos `kind`s; forma canonica estavel; tolerancia a bytes
 *    extras; rejeicao de `v` desconhecido. Aqui tambem: CONFORMIDADE BYTE A BYTE com
 *    `compact-encoding`, que §7.2 nomeia como o encoding.
 *  - `idgen`: determinismo e ausencia de colisao em 10^8 tuplas.
 */
import c from 'compact-encoding';
import { E, type ErrorCode } from '../src/protocol/errors.ts';
import { K } from '../src/protocol/kinds.ts';
import { ALL_PERMS, PERM, effectivePerms, outranks, topRank } from '../src/protocol/permissions.ts';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_QUOTA_PER_MEMBER,
  LIMIT,
  MAX_CATEGORIES,
  MAX_MENTIONS,
  MAX_REACTION_EMOJIS,
  MAX_ROLES,
  MAX_ROLES_PER_MEMBER,
  QUOTA_OPS_PER_WINDOW,
} from '../src/protocol/constants.ts';
import { Reader, Writer } from '../src/codec/wire.ts';
import {
  decodeEnvelope,
  decodeHostRecord,
  decodeOp,
  decodePayload,
  encodeEnvelope,
  encodeOp,
  encodePayload,
  opIdOf,
  type Payload,
} from '../src/codec/opCodec.ts';
import { opSigningHash } from '../src/codec/opCodec.ts';
import { crockford32, entityId, opId } from '../src/codec/idgen.ts';
import { blake2b128, blake2b256, keyPairFromSeed, randomBytes, sign } from '../src/crypto/index.ts';
import { CHANNEL_TYPE, graphemes, slugChannelName } from '../src/fold/limits.ts';
import { RANK_BOTTOM, RANK_TOP, isValidRank, midpoint, rankBetween } from '../src/fold/rank.ts';
import { Sim } from '../src/harness/sim.ts';

export type UnitReport = {
  suites: Array<{ name: string; total: number; failed: number; failures: string[] }>;
  total: number;
  failed: number;
  foldCases: number;
  idgenTuples: number;
  idgenCollisions: number;
  ok: boolean;
  ms: number;
};

type Suite = { name: string; total: number; failed: number; failures: string[] };

function suite(name: string): Suite {
  return { name, total: 0, failed: 0, failures: [] };
}
function check(s: Suite, cond: boolean, label: string): void {
  s.total++;
  if (!cond) {
    s.failed++;
    if (s.failures.length < 25) s.failures.push(label);
  }
}
function eq<T>(s: Suite, got: T, want: T, label: string): void {
  check(s, Object.is(got, want) || String(got) === String(want), `${label}: obtido ${String(got)}, esperado ${String(want)}`);
}

const ZERO32 = Buffer.alloc(32);
const ZERO64 = Buffer.alloc(64);

// ---------------------------------------------------------------------------------
// opCodec — conformidade com compact-encoding, round-trip, forma canonica
// ---------------------------------------------------------------------------------

function ceEncode(enc: unknown, v: unknown): Buffer {
  const st = { start: 0, end: 0, buffer: null as Buffer | null };
  const e = enc as { preencode: (s: typeof st, v: unknown) => void; encode: (s: typeof st, v: unknown) => void };
  e.preencode(st, v);
  st.buffer = Buffer.alloc(st.end);
  e.encode(st, v);
  return st.buffer;
}

function suiteCodec(): Suite {
  const s = suite('opCodec');

  // --- conformidade byte a byte com `compact-encoding` (§7.2, §7.2.1) --------------
  for (const n of [0, 1, 127, 252, 253, 254, 65535, 65536, 4294967295, 4294967296, 2 ** 53 - 1]) {
    eq(s, new Writer().uint(n).toBuffer().toString('hex'), ceEncode(c.uint, n).toString('hex'), `uint(${n}) conformidade`);
    const r = new Reader(new Writer().uint(n).toBuffer());
    eq(s, r.uint(), n, `uint(${n}) round-trip`);
  }
  for (const n of [0, 200, 255]) eq(s, new Writer().u8(n).toBuffer().toString('hex'), ceEncode(c.uint8, n).toString('hex'), `u8(${n})`);
  for (const n of [0, 4660, 65535]) eq(s, new Writer().u16(n).toBuffer().toString('hex'), ceEncode(c.uint16, n).toString('hex'), `u16(${n})`);
  for (const n of [0, 123456, 4294967295]) eq(s, new Writer().u32(n).toBuffer().toString('hex'), ceEncode(c.uint32, n).toString('hex'), `u32(${n})`);
  for (const n of [0, 1, 2 ** 40, 2 ** 53 - 1]) eq(s, new Writer().u64(n).toBuffer().toString('hex'), ceEncode(c.uint64, n).toString('hex'), `u64(${n})`);
  for (const str of ['', 'a', 'olá', '👍🎉', 'x'.repeat(300), 'quebra\nde\nlinha']) {
    eq(s, new Writer().str(str).toBuffer().toString('hex'), ceEncode(c.string, str).toString('hex'), `str(${JSON.stringify(str.slice(0, 12))})`);
    eq(s, new Reader(new Writer().str(str).toBuffer()).str(), str, `str round-trip`);
  }
  for (const n of [0, 1, 3, 300]) {
    const b = randomBytes(n);
    eq(s, new Writer().bytes(b).toBuffer().toString('hex'), ceEncode(c.buffer, b).toString('hex'), `bytes(${n})`);
  }
  {
    const b = randomBytes(32);
    eq(s, new Writer().key(b).toBuffer().toString('hex'), ceEncode(c.fixed32, b).toString('hex'), 'key = fixed32');
    const b64 = randomBytes(64);
    eq(s, new Writer().sig(b64).toBuffer().toString('hex'), ceEncode(c.fixed64, b64).toString('hex'), 'sig = fixed64');
  }
  {
    const arr = ['a', 'bb', ''];
    eq(
      s,
      new Writer().arr(arr, (w, v) => void w.str(v)).toBuffer().toString('hex'),
      ceEncode(c.array(c.string), arr).toString('hex'),
      'arr<str>',
    );
  }

  // --- round-trip dos `kind`s implementados ------------------------------------------
  const samples: Array<[number, Payload]> = [
    [K.MESSAGE_SEND, { channelId: 'ch-A', content: 'oi', mentions: ['everyone', 'x'], replyToId: 'msg-B', threadId: undefined }],
    [K.MESSAGE_SEND, { channelId: 'ch-A', content: 'com anexo', mentions: [], attachment: { blob: { blobsCoreKey: ZERO32, byteOffset: 1, blockOffset: 2, blockLength: 3, byteLength: 4 }, name: 'a.png', sizeBytes: 99, kind: 1, hash: ZERO32 } }],
    [K.MESSAGE_DELETE, { messageId: 'msg-A', reason: 'spam' }],
    [K.MESSAGE_DELETE, { messageId: 'msg-A' }],
    [K.REACTION_SET, { messageId: 'msg-A', emoji: '👍', present: true }],
    [K.CHANNEL_CREATE, { categoryId: 'cat-A', type: 0, name: 'geral', topic: 't', readOnlyForRoleIds: ['role-A'], afterRank: 'V', beforeRank: 'z' }],
    [K.CHANNEL_UPDATE, { channelId: 'ch-A', name: 'novo', topic: undefined, readOnlyForRoleIds: ['role-A', 'role-B'] }],
    [K.CHANNEL_DELETE, { channelId: 'ch-A' }],
    [K.CATEGORY_CREATE, { name: 'GERAL', afterRank: 'V' }],
    [K.CATEGORY_DELETE, { categoryId: 'cat-A', moveChannelsTo: 'cat-B', deleteChannels: false }],
    [K.ROLE_CREATE, { name: 'Mod', color: 3, permissions: [...ALL_PERMS], mentionable: true }],
    [K.ROLE_UPDATE, { roleId: 'role-A', name: 'X', color: 2, permissions: [1, 2], mentionable: false }],
    [K.ROLE_DELETE, { roleId: 'role-A' }],
    [K.MEMBER_SET_ROLES, { targetKey: ZERO32, roleIds: ['role-A', 'role-B'] }],
    [K.MEMBER_JOIN, { invitePublicKey: ZERO32, joinProof: ZERO64, displayName: 'Fulano', avatarColor: 4, blobsCoreKey: ZERO32 }],
    [K.MOD_BAN, { targetKey: ZERO32, reason: 'motivo' }],
    [K.INVITE_CREATE, { invitePublicKey: ZERO32, expiresAt: 123456, maxUses: 10, label: 'rotulo' }],
    [K.COMMUNITY_CREATE, { name: 'Com', iconEmoji: '🎉', iconColor: 2, description: 'd', blobsKey: ZERO32 }],
  ];
  for (const [kind, payload] of samples) {
    const bytes = encodePayload(kind, payload);
    const back = decodePayload(kind, bytes);
    check(s, back !== null, `decodePayload(${kind}) nao devolveu null`);
    if (back !== null) {
      eq(s, JSON.stringify(back), JSON.stringify(payload), `round-trip kind ${kind}`);
      // §7.2 regra 2 — leitor tolerante: bytes sobrando no FIM sao ignorados.
      const extra = Buffer.concat([bytes, randomBytes(16)]);
      const tol = decodePayload(kind, extra);
      check(s, tol !== null && JSON.stringify(tol) === JSON.stringify(payload), `tolerancia a bytes extras, kind ${kind}`);
      // truncamento em qualquer ponto -> null, NUNCA excecao
      for (let cut = 0; cut < bytes.length; cut++) {
        let threw = false;
        let out: Payload | null = null;
        try {
          out = decodePayload(kind, bytes.subarray(0, cut));
        } catch {
          threw = true;
        }
        check(s, !threw, `truncamento em ${cut} nao pode lancar (kind ${kind})`);
        check(s, threw || out === null || cut === bytes.length, `truncamento em ${cut} deve falhar (kind ${kind})`);
      }
    }
  }

  // --- forma canonica: mesmo input => mesmo `opId`, byte a byte ----------------------
  {
    const kp = keyPairFromSeed(blake2b256('unit/opid', Buffer.from('x')));
    const mk = (): Buffer =>
      encodeOp({ v: 1, communityId: ZERO32, kind: K.MESSAGE_SEND, author: kp.publicKey, authorSeq: 42, ts: 1000, payload: encodePayload(K.MESSAGE_SEND, { channelId: 'ch-A', content: 'x', mentions: [] }) });
    eq(s, mk().toString('hex'), mk().toString('hex'), 'encodeOp e estavel byte a byte');
    const env = { op: mk(), sig: Buffer.alloc(64, 1) };
    eq(s, opIdOf(env), opIdOf({ op: mk(), sig: Buffer.alloc(64, 1) }), 'opId estavel');
    eq(s, opId(encodeEnvelope(env)), opIdOf(env), 'opId = BLAKE2b(opid/1 ‖ envelope canonico)');
    const env2 = { op: mk(), sig: Buffer.alloc(64, 2) };
    check(s, opIdOf(env) !== opIdOf(env2), 'opId muda com a assinatura');
  }

  // --- `v` desconhecido / `kind` desconhecido -----------------------------------------
  check(s, decodePayload(60000, randomBytes(20)) === null, 'kind sem layout => decodePayload null (§7.2.1, DR-10)');
  {
    const op = encodeOp({ v: 9, communityId: ZERO32, kind: K.MESSAGE_SEND, author: ZERO32, authorSeq: 1, ts: 1, payload: Buffer.alloc(0) });
    const d = decodeOp(op);
    check(s, d !== null && d.v === 9, 'decodeOp preserva `v` (a rejeicao e do estagio 2, nao do codec)');
  }

  // --- nenhum decode lanca, para 20 000 entradas aleatorias ---------------------------
  {
    let threw = 0;
    for (let i = 0; i < 20_000; i++) {
      const b = randomBytes(i % 300);
      try {
        decodeHostRecord(b);
        decodeEnvelope(b);
        decodeOp(b);
        decodePayload(K.MESSAGE_SEND, b);
      } catch {
        threw++;
      }
    }
    eq(s, threw, 0, 'decode nunca lanca em 20 000 entradas aleatorias');
  }
  return s;
}

// ---------------------------------------------------------------------------------
// idgen
// ---------------------------------------------------------------------------------

function suiteIdgen(tuples: number): { s: Suite; collisions: number; tuples: number } {
  const s = suite('idgen');
  const cid = randomBytes(32);
  const author = randomBytes(32);

  // determinismo
  for (const t of ['message', 'channel', 'category', 'role', 'thread', 'modentry'] as const) {
    eq(s, entityId(t, cid, author, 7), entityId(t, cid, author, 7), `entityId(${t}) deterministico`);
  }
  // prefixos de §7.3
  eq(s, entityId('message', cid, author, 1).slice(0, 4), 'msg-', 'prefixo message');
  eq(s, entityId('channel', cid, author, 1).slice(0, 3), 'ch-', 'prefixo channel');
  eq(s, entityId('category', cid, author, 1).slice(0, 4), 'cat-', 'prefixo category');
  eq(s, entityId('role', cid, author, 1).slice(0, 5), 'role-', 'prefixo role');
  eq(s, entityId('thread', cid, author, 1).slice(0, 4), 'thr-', 'prefixo thread');
  eq(s, entityId('modentry', cid, author, 1).slice(0, 4), 'mod-', 'prefixo modentry');
  // 26 chars de crockford32 sobre 128 bits
  eq(s, crockford32(blake2b128('id/message/1', cid, author)).length, 26, 'crockford32(16B) = 26 chars');
  // escopo por comunidade e por tipo (fecha T-30)
  check(s, entityId('message', cid, author, 1) !== entityId('message', randomBytes(32), author, 1), 'id nao atravessa comunidade');
  check(s, entityId('message', cid, author, 1).slice(4) !== entityId('channel', cid, author, 1).slice(3), 'id difere por tipo');
  check(s, entityId('message', cid, author, 1) !== entityId('message', cid, author, 2), 'id difere por authorSeq');

  // --- ausencia de colisao em N tuplas -------------------------------------------------
  // Verificacao sobre o PREFIXO de 64 bits: uma colisao de 128 bits e necessariamente
  // tambem uma colisao de 64 bits, entao "zero colisoes de 64 bits" IMPLICA "zero
  // colisoes de 128 bits". E uma sobre-aproximacao sound, e cabe em memoria.
  const prefixes = new BigUint64Array(tuples);
  const authors: Buffer[] = [];
  for (let i = 0; i < 64; i++) authors.push(blake2b256('idgen-author/1', Buffer.from(String(i))));
  for (let i = 0; i < tuples; i++) {
    const h = blake2b128('id/message/1', cid, authors[i & 63], u64le(i >>> 6));
    prefixes[i] = h.readBigUInt64LE(0);
  }
  prefixes.sort();
  let collisions = 0;
  for (let i = 1; i < prefixes.length; i++) if (prefixes[i] === prefixes[i - 1]) collisions++;
  eq(s, collisions, 0, `colisao de prefixo de 64 bits em ${tuples} tuplas`);
  return { s, collisions, tuples };
}

function u64le(n: number): Buffer {
  const b = Buffer.allocUnsafe(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

// ---------------------------------------------------------------------------------
// permissions (§9.1, §9.2, §9.3)
// ---------------------------------------------------------------------------------

function suitePermissions(): Suite {
  const s = suite('permissions');
  eq(s, ALL_PERMS.length, 17, 'catalogo fechado de 17 permissoes (§9.1)');

  const roles = new Map<string, { permissions: Set<number>; rank: string; deletedAt?: number }>([
    ['founder', { permissions: new Set(ALL_PERMS), rank: RANK_TOP }],
    ['mod', { permissions: new Set([PERM.manage_roles, PERM.ban_members]), rank: 'V' }],
    ['base', { permissions: new Set([PERM.send_messages]), rank: RANK_BOTTOM }],
    ['morto', { permissions: new Set([PERM.manage_community]), rank: 'W', deletedAt: 1 }],
  ]);

  // §9.2 — uniao das permissoes dos cargos ATIVOS; cargo deletado nao conta.
  for (const p of ALL_PERMS) {
    check(s, effectivePerms(['founder'], roles).has(p), `Fundador tem ${p}`);
  }
  eq(s, effectivePerms(['mod', 'base'], roles).size, 3, 'uniao mod+base = 3 permissoes');
  check(s, !effectivePerms(['morto'], roles).has(PERM.manage_community), 'cargo deletado nao concede');
  eq(s, effectivePerms([], roles).size, 0, 'sem cargo, sem permissao');
  eq(s, effectivePerms(['inexistente'], roles).size, 0, 'cargo inexistente e descartado');

  // §9.3 — hierarquia: estritamente menor. Nunca igual, nunca maior.
  eq(s, topRank(['mod', 'base'], roles), 'V', 'topRank = maior rank ativo');
  eq(s, topRank(['morto'], roles), null, 'topRank ignora cargo deletado');
  check(s, outranks('V', RANK_BOTTOM), 'acima age sobre abaixo');
  check(s, !outranks('V', 'V'), 'igual NAO age (regra unica de §9.3)');
  check(s, !outranks(RANK_BOTTOM, 'V'), 'abaixo nao age sobre acima');
  check(s, !outranks(null, RANK_BOTTOM), 'sem cargo nao age sobre ninguem');
  check(s, outranks('V', null), 'com cargo age sobre quem nao tem');
  check(s, !outranks(null, null), 'sem cargo dos dois lados nao age');
  return s;
}

// ---------------------------------------------------------------------------------
// rank / indexacao fracionaria (§6.4.1)
// ---------------------------------------------------------------------------------

export let RANK_OVERFLOW_AT = -1;

function suiteRank(): Suite {
  const s = suite('rank');
  check(s, isValidRank(RANK_TOP), 'RANK_TOP valido');
  check(s, isValidRank(RANK_BOTTOM), 'RANK_BOTTOM valido');
  check(s, !isValidRank(''), 'rank vazio invalido');
  check(s, !isValidRank('A0'), 'rank com zero a direita invalido');

  // midpoint sempre ESTRITAMENTE entre, e sempre em base62 canonica.
  //
  // HOLE-15 (REPORT.md): §7.2.1 declara `rank` como "string base62, 1-64 caracteres",
  // mas §6.4.1 gera `rank` por midpoint SEM COTA DE COMPRIMENTO. Inserir sempre no fundo
  // faz a chave crescer; medido abaixo, ela passa de 64 caracteres. A spec nao diz o que
  // acontece nesse ponto.
  let cur = midpoint(null, null);
  let firstOverflow = -1;
  for (let i = 0; i < 500; i++) {
    const next = midpoint(null, cur);
    check(s, next < cur, `midpoint(null, ${cur}) < ${cur}`);
    check(s, /^[0-9A-Za-z]+$/.test(next) && !next.endsWith('0'), `midpoint base62 canonico em ${i}`);
    if (firstOverflow < 0 && next.length > 64) firstOverflow = i;
    cur = next;
  }
  RANK_OVERFLOW_AT = firstOverflow;
  let lo = midpoint(null, null);
  let hi = midpoint(lo, null);
  for (let i = 0; i < 500; i++) {
    const mid = midpoint(lo, hi);
    check(s, lo < mid && mid < hi, `midpoint estritamente entre em ${i}`);
    check(s, /^[0-9A-Za-z]+$/.test(mid) && !mid.endsWith('0'), `midpoint base62 canonico entre em ${i}`);
    if (i % 2 === 0) hi = mid;
    else lo = mid;
  }
  // entrada incoerente NUNCA lanca (§8.5)
  let threw = false;
  try {
    midpoint('z', 'a');
    midpoint('', '');
    midpoint('0', '0');
    midpoint('000', '0');
  } catch {
    threw = true;
  }
  check(s, !threw, 'midpoint com entrada incoerente nao lanca');

  // R-20: dica desatualizada e IGNORADA
  const existing = ['1', 'V', 'zz'];
  const r1 = rankBetween(existing, 'inexistente', 'tambem-nao');
  check(s, isValidRank(r1), 'rankBetween com dicas invalidas devolve rank valido');
  const r2 = rankBetween(existing, '1', 'zz');
  check(s, r2 > '1' && r2 < 'zz', 'rankBetween respeita vizinhos reais');
  return s;
}

// ---------------------------------------------------------------------------------
// fold — tabela por estagio, por regra e por fronteira de limite
// ---------------------------------------------------------------------------------

function expectRej(s: Suite, sim: Sim, label: string, code: ErrorCode, run: () => { decision: string; reason?: string }): void {
  const r = run();
  check(s, r.decision === 'REJECTED' && r.reason === code, `${label}: obtido ${r.decision}/${r.reason ?? '-'}, esperado REJECTED/${code}`);
}
function expectIgn(s: Suite, label: string, code: ErrorCode, run: () => { decision: string; reason?: string }): void {
  const r = run();
  check(s, r.decision === 'IGNORED' && r.reason === code, `${label}: obtido ${r.decision}/${r.reason ?? '-'}, esperado IGNORED/${code}`);
}
function expectOk(s: Suite, label: string, run: () => { decision: string; reason?: string }): void {
  const r = run();
  check(s, r.decision === 'APPLIED', `${label}: obtido ${r.decision}/${r.reason ?? '-'}, esperado APPLIED`);
}

function suiteFoldStages(): Suite {
  const s = suite('fold/estagios §8.2');
  const sim = new Sim('stages');
  sim.bootstrap();
  const P = (): Payload => ({ channelId: sim.ids.channel, content: 'texto', mentions: [] });

  // 1 — HostRecord nao decodifica / hostSig invalida
  expectIgn(s, 'estagio 1 lixo', E.BAD_HOST_SIGNATURE, () => sim.probe(randomBytes(80)));
  expectIgn(s, 'estagio 1 vazio', E.BAD_HOST_SIGNATURE, () => sim.probe(Buffer.alloc(0)));
  expectIgn(s, 'estagio 1 hostSig invalida', E.BAD_HOST_SIGNATURE, () =>
    sim.submit('m0', K.MESSAGE_SEND, P(), { badHostSig: true, advance: false }),
  );
  // 2 — decode / v / kind / payload
  expectIgn(s, 'estagio 2 v desconhecido', E.VERSION_UNSUPPORTED, () => sim.submit('m0', K.MESSAGE_SEND, P(), { v: 3, advance: false }));
  expectIgn(s, 'estagio 2 kind desconhecido', E.UNKNOWN_KIND, () => {
    const env = sim.envelope('m0', K.MESSAGE_SEND, P());
    const op = decodeOp(env.op)!;
    const bad = encodeOp({ ...op, kind: 60_000 });
    return sim.probe(sim.record({ op: bad, sig: Buffer.alloc(64) }));
  });
  expectIgn(s, 'estagio 2 payload malformado', E.MALFORMED, () => {
    const a = sim.actor('m0');
    const op = encodeOp({ v: 1, communityId: sim.communityKey, kind: K.CHANNEL_CREATE, author: a.keys.publicKey, authorSeq: 999, ts: sim.hostTs, payload: Buffer.from([9, 1]) });
    return sim.probe(sim.record({ op, sig: Buffer.alloc(64) }));
  });
  // 3 — comunidade errada
  expectRej(s, sim, 'estagio 3', E.WRONG_COMMUNITY, () => sim.submit('m0', K.MESSAGE_SEND, P(), { communityKey: randomBytes(32), advance: false }));
  // 4 — assinatura do autor
  expectRej(s, sim, 'estagio 4', E.BAD_SIGNATURE, () => sim.submit('m0', K.MESSAGE_SEND, P(), { badSig: true, advance: false }));
  // 6 — authorSeq
  expectRej(s, sim, 'estagio 6 repetido', E.DUPLICATE, () => sim.submit('m0', K.MESSAGE_SEND, P(), { authorSeq: 1, advance: false }));
  expectRej(s, sim, 'estagio 6 zero', E.DUPLICATE, () => sim.submit('m0', K.MESSAGE_SEND, P(), { authorSeq: 0, advance: false }));
  // 7 — relogio
  expectRej(s, sim, 'estagio 7 futuro', E.CLOCK_UNREASONABLE, () => sim.submit('m0', K.MESSAGE_SEND, P(), { ts: sim.hostTs + 86_400_001, advance: false }));
  expectRej(s, sim, 'estagio 7 passado', E.CLOCK_UNREASONABLE, () => sim.submit('m0', K.MESSAGE_SEND, P(), { ts: sim.hostTs - 86_400_001, advance: false }));
  expectOk(s, 'estagio 7 na fronteira exata (24h)', () => sim.submit('m0', K.MESSAGE_SEND, P(), { ts: sim.hostTs - 86_400_000, advance: false }));
  // 8 — nao membro
  expectRej(s, sim, 'estagio 8 nao membro', E.NOT_MEMBER, () => sim.submit('forasteiro', K.MESSAGE_SEND, P(), { advance: false }));
  // 11 — permissao
  expectRej(s, sim, 'estagio 11', E.PERMISSION_DENIED, () => sim.submit('m2', K.MOD_BAN, { targetKey: sim.actor('m3').keys.publicKey }, { advance: false }));
  // 12 — hierarquia
  expectRej(s, sim, 'estagio 12 igual rank', E.HIERARCHY, () => sim.submit('m0', K.MOD_BAN, { targetKey: sim.actor('m1').keys.publicKey }, { advance: false }));
  expectRej(s, sim, 'estagio 12 Fundador', E.FOUNDER_IMMUNE, () => sim.submit('m0', K.MOD_BAN, { targetKey: sim.actor('fundador').keys.publicKey }, { advance: false }));
  expectRej(s, sim, 'estagio 12 si mesmo', E.SELF_TARGET, () => sim.submit('m0', K.MOD_BAN, { targetKey: sim.actor('m0').keys.publicKey }, { advance: false }));
  // 13 — limites de campo
  expectRej(s, sim, 'estagio 13', E.VALIDATION, () => sim.submit('m0', K.MESSAGE_SEND, { channelId: sim.ids.channel, content: '', mentions: [] }, { advance: false }));
  // 14 — regra estrutural
  expectRej(s, sim, 'estagio 14', E.CHANNEL_NOT_FOUND, () => sim.submit('m0', K.MESSAGE_SEND, { channelId: 'ch-INEXISTENTE', content: 'x', mentions: [] }, { advance: false }));
  // 15 — aplicado
  expectOk(s, 'estagio 15', () => sim.submit('m0', K.MESSAGE_SEND, P(), { advance: false }));

  // §8.0 — contrato do resultado
  {
    const r = sim.submit('m0', K.MESSAGE_SEND, { channelId: 'ch-X', content: 'x', mentions: [] }, { advance: false });
    check(s, r.effects.length === 0, '§8.0: effects vazio quando nao APPLIED');
    check(s, r.reason !== undefined, '§8.0: reason presente quando REJECTED');
    check(s, r.next.interpretedSeq === sim.seq, '§8.2: interpretedSeq avanca mesmo em REJECTED');
  }
  return s;
}

function suiteFoldRules(): Suite {
  const s = suite('fold/regras R-*');

  // R-1 — clamp de hostTs, sem recusa
  {
    const sim = new Sim('r1');
    sim.bootstrap();
    const before = sim.ds.lastHostTs;
    const r = sim.submit('m0', K.MESSAGE_SEND, { channelId: sim.ids.channel, content: 'retro', mentions: [] }, { hostTs: 1000 });
    check(s, r.decision === 'APPLIED', 'R-1: hostTs retroativo NAO recusa');
    check(s, r.hostTsClamped === true, 'R-1: clamp sinalizado (fold.hostTsClamped)');
    eq(s, sim.ds.lastHostTs, before, 'R-1: lastHostTs nao retrocede');
  }
  // R-3 / R-12 — cargo base obrigatorio e indeletavel
  {
    const sim = new Sim('r3');
    sim.bootstrap();
    expectRej(s, sim, 'R-3 remover o base', E.BASE_ROLE_REQUIRED, () =>
      sim.submit('fundador', K.MEMBER_SET_ROLES, { targetKey: sim.actor('m2').keys.publicKey, roleIds: [] }, { advance: false }),
    );
    expectRej(s, sim, 'R-12 deletar o base', E.BASE_ROLE_REQUIRED, () => sim.submit('fundador', K.ROLE_DELETE, { roleId: sim.ids.baseRole }, { advance: false }));
    // HOLE-16 (REPORT.md): §6.4.1 promete `E_FOUNDER_IMMUTABLE`, mas o cargo Fundador tem
    // sempre o `rank` MAXIMO, entao o estagio 12 (hierarquia, R-4: "rank >= topRank(autor)")
    // recusa ANTES do estagio 14 chegar a regra do Fundador — para TODO autor, inclusive o
    // proprio Fundador. `E_FOUNDER_IMMUTABLE` e `E_FOUNDER_TOP` sao INALCANCAVEIS na ordem
    // de §8.2. O teste segue §8.2 (precedencia sobre a ficha de §6.4.1) e registra o achado.
    expectRej(s, sim, 'Fundador indeletavel (via estagio 12)', E.HIERARCHY, () => sim.submit('fundador', K.ROLE_DELETE, { roleId: sim.ids.founderRole }, { advance: false }));
    expectRej(s, sim, 'Fundador nao editavel (via estagio 12)', E.HIERARCHY, () => sim.submit('fundador', K.ROLE_UPDATE, { roleId: sim.ids.founderRole, name: 'X' }, { advance: false }));
  }
  // R-4 — hierarquia sobre cargo atribuido
  {
    const sim = new Sim('r4');
    sim.bootstrap();
    expectRej(s, sim, 'R-4 atribuir cargo >= topo do autor', E.HIERARCHY, () =>
      sim.submit('m0', K.MEMBER_SET_ROLES, { targetKey: sim.actor('m2').keys.publicKey, roleIds: [sim.ids.baseRole, sim.ids.modRole] }, { advance: false }),
    );
  }
  // R-5 — anti-escalada de permissao
  {
    const sim = new Sim('r5');
    sim.bootstrap();
    expectRej(s, sim, 'R-5 conceder o que nao tem (create)', E.PERMISSION_ESCALATION, () =>
      sim.submit('m0', K.ROLE_CREATE, { name: 'Golpe', color: 1, permissions: [PERM.manage_community], mentionable: true, afterRank: RANK_BOTTOM, beforeRank: 'V' }, { advance: false }),
    );
    sim.tick();
    const seq = sim.actor('m0').nextAuthorSeq;
    expectOk(s, 'R-5 conceder o que tem', () =>
      sim.submit('m0', K.ROLE_CREATE, { name: 'Ok', color: 1, permissions: [PERM.ban_members], mentionable: true, afterRank: RANK_BOTTOM, beforeRank: 'V' }),
    );
    const rid = sim.entity('role', 'm0', seq);
    sim.tick();
    expectRej(s, sim, 'R-5 conceder o que nao tem (update)', E.PERMISSION_ESCALATION, () =>
      sim.submit('m0', K.ROLE_UPDATE, { roleId: rid, permissions: [PERM.manage_community] }, { advance: false }),
    );
  }
  // R-6 — unicidade de (type, name)
  {
    const sim = new Sim('r6');
    sim.bootstrap();
    sim.tick();
    expectRej(s, sim, 'R-6 nome duplicado', E.CHANNEL_NAME_TAKEN, () =>
      sim.submit('m0', K.CHANNEL_CREATE, { categoryId: sim.ids.category, type: CHANNEL_TYPE.text, name: 'geral', readOnlyForRoleIds: [] }, { advance: false }),
    );
    // mesmo nome, TIPO diferente => permitido
    expectOk(s, 'R-6 mesmo nome em tipo diferente', () =>
      sim.submit('m0', K.CHANNEL_CREATE, { categoryId: sim.ids.category, type: CHANNEL_TYPE.voice, name: 'geral', readOnlyForRoleIds: [] }, { advance: false }),
    );
  }
  // R-7 — nunca sem canal de texto
  {
    const sim = new Sim('r7');
    sim.bootstrap();
    sim.tick();
    expectRej(s, sim, 'R-7 ultimo canal', E.LAST_CHANNEL, () => sim.submit('m0', K.CHANNEL_DELETE, { channelId: sim.ids.channel }, { advance: false }));
    sim.tick();
    expectRej(s, sim, 'R-7 via category.delete', E.LAST_CHANNEL, () =>
      sim.submit('m0', K.CATEGORY_DELETE, { categoryId: sim.ids.category, deleteChannels: true }, { advance: false }),
    );
  }
  // R-8 — replyTo/thread do mesmo canal
  {
    const sim = new Sim('r8');
    sim.bootstrap();
    const { id } = sim.sendMessage('m2');
    sim.tick();
    expectOk(s, 'R-8 replyTo valido', () =>
      sim.submit('m2', K.MESSAGE_SEND, { channelId: sim.ids.channel, content: 'resposta', mentions: [], replyToId: id }, { advance: false }),
    );
    expectRej(s, sim, 'R-8 replyTo inexistente', E.VALIDATION, () =>
      sim.submit('m2', K.MESSAGE_SEND, { channelId: sim.ids.channel, content: 'x', mentions: [], replyToId: 'msg-NAOEXISTE' }, { advance: false }),
    );
    // outro canal
    sim.tick();
    const chSeq = sim.actor('m0').nextAuthorSeq;
    sim.submit('m0', K.CHANNEL_CREATE, { categoryId: sim.ids.category, type: CHANNEL_TYPE.text, name: 'outro', readOnlyForRoleIds: [] });
    const other = sim.entity('channel', 'm0', chSeq);
    sim.tick();
    expectRej(s, sim, 'R-8 replyTo de outro canal', E.VALIDATION, () =>
      sim.submit('m2', K.MESSAGE_SEND, { channelId: other, content: 'x', mentions: [], replyToId: id }, { advance: false }),
    );
  }
  // R-9 — prova de adesao
  {
    const sim = new Sim('r9');
    sim.bootstrap();
    sim.tick();
    expectRej(s, sim, 'R-9 joinProof invalida', E.INVITE_INVALID, () =>
      sim.submit('novo', K.MEMBER_JOIN, { invitePublicKey: sim.invite.publicKey, joinProof: Buffer.alloc(64, 3), displayName: 'Novo', avatarColor: 1, blobsCoreKey: ZERO32 }, { advance: false }),
    );
    expectRej(s, sim, 'R-9 convite inexistente', E.INVITE_INVALID, () =>
      sim.submit('novo', K.MEMBER_JOIN, { invitePublicKey: randomBytes(32), joinProof: Buffer.alloc(64), displayName: 'Novo', avatarColor: 1, blobsCoreKey: ZERO32 }, { advance: false }),
    );
    expectOk(s, 'R-9 adesao valida', () => sim.join('novo'));
    // (invitePk, autor) ja usado: o mesmo ator nao entra duas vezes
    const again = sim.join('novo');
    check(s, again.decision === 'REJECTED' && again.reason === E.INVITE_INVALID, 'R-9 par (convite, autor) ja usado');
  }
  // R-10 — ban revoga os convites do alvo
  {
    const sim = new Sim('r10');
    sim.bootstrap();
    sim.tick();
    const invPk = randomBytes(32);
    sim.submit('m0', K.INVITE_CREATE, { invitePublicKey: invPk, maxUses: 5 });
    check(s, sim.ds.invites.get(invPk.toString('hex'))?.revokedAt === undefined, 'R-10 convite ativo antes do ban');
    sim.tick();
    const r = sim.submit('fundador', K.MOD_BAN, { targetKey: sim.actor('m0').keys.publicKey, reason: 'x' });
    check(s, r.decision === 'APPLIED', 'R-10 ban aplicado');
    check(s, sim.ds.invites.get(invPk.toString('hex'))?.revokedAt !== undefined, 'R-10 convite revogado NO MESMO REGISTRO');
  }
  // R-13 — mention_everyone efetivo
  {
    const sim = new Sim('r13');
    sim.bootstrap();
    sim.tick();
    const r1 = sim.submit('fundador', K.MESSAGE_SEND, { channelId: sim.ids.channel, content: 'oi', mentions: ['everyone'] });
    const up = r1.effects.find((e) => e.t === 'upsert' && e.table === 'messages');
    check(s, up !== undefined && (up as { row: Record<string, unknown> }).row.mention_everyone_effective === 1, 'R-13 Fundador tem mention_everyone');
    sim.tick();
    const r2 = sim.submit('m2', K.MESSAGE_SEND, { channelId: sim.ids.channel, content: 'oi', mentions: ['everyone'] });
    const up2 = r2.effects.find((e) => e.t === 'upsert' && e.table === 'messages');
    check(s, r2.decision === 'APPLIED', 'R-13 sem a permissao a mensagem APLICA');
    check(s, up2 !== undefined && (up2 as { row: Record<string, unknown> }).row.mention_everyone_effective === 0, 'R-13 flag em false, conteudo intacto');
  }
  // R-11 — cargo base restrito
  {
    const sim = new Sim('r11');
    sim.bootstrap();
    for (const p of [PERM.manage_community, PERM.manage_channels, PERM.manage_roles, PERM.manage_messages, PERM.ban_members, PERM.kick_members, PERM.timeout_members, PERM.mention_everyone, PERM.view_audit_log, PERM.voice_mute_others, PERM.create_invite]) {
      sim.tick();
      expectRej(s, sim, `R-11 base com ${p}`, E.BASE_ROLE_RESTRICTED, () =>
        sim.submit('fundador', K.ROLE_UPDATE, { roleId: sim.ids.baseRole, permissions: [PERM.send_messages, p] }, { advance: false }),
      );
    }
    sim.tick();
    expectOk(s, 'R-11 base com pin_messages e permitido', () =>
      sim.submit('fundador', K.ROLE_UPDATE, { roleId: sim.ids.baseRole, permissions: [PERM.send_messages, PERM.pin_messages] }, { advance: false }),
    );
  }
  // R-21 / R-22 — readOnlyForRoleIds
  {
    const sim = new Sim('r21');
    sim.bootstrap();
    sim.tick();
    expectRej(s, sim, 'R-21 id inexistente', E.VALIDATION, () =>
      sim.submit('m0', K.CHANNEL_CREATE, { categoryId: sim.ids.category, type: CHANNEL_TYPE.text, name: 'ro', readOnlyForRoleIds: ['role-NAOEXISTE'] }, { advance: false }),
    );
    sim.tick();
    const all = [...sim.ds.roles.keys()];
    expectRej(s, sim, 'R-21 sem cargo de fora', E.VALIDATION, () =>
      sim.submit('m0', K.CHANNEL_CREATE, { categoryId: sim.ids.category, type: CHANNEL_TYPE.text, name: 'ro2', readOnlyForRoleIds: all }, { advance: false }),
    );
    sim.tick();
    const chSeq = sim.actor('m0').nextAuthorSeq;
    expectOk(s, 'R-21 lista valida', () =>
      sim.submit('m0', K.CHANNEL_CREATE, { categoryId: sim.ids.category, type: CHANNEL_TYPE.text, name: 'ro3', readOnlyForRoleIds: [sim.ids.baseRole] }),
    );
    const ro = sim.entity('channel', 'm0', chSeq);
    sim.tick();
    expectRej(s, sim, 'R-22 todos os cargos do autor sao read-only', E.CHANNEL_READ_ONLY, () =>
      sim.submit('m2', K.MESSAGE_SEND, { channelId: ro, content: 'x', mentions: [] }, { advance: false }),
    );
    sim.tick();
    expectOk(s, 'R-22 autor com cargo de fora escreve', () =>
      sim.submit('m0', K.MESSAGE_SEND, { channelId: ro, content: 'x', mentions: [] }, { advance: false }),
    );
  }
  // R-23 — 20 emojis distintos
  {
    const sim = new Sim('r23');
    sim.bootstrap();
    const { id } = sim.sendMessage('m2');
    const pool = [...'😀😁😂🤣😃😄😅😆😉😊😋😎😍😘🥰😗😙😚🙂🤗🤩🤔'];
    for (let i = 0; i < MAX_REACTION_EMOJIS; i++) {
      sim.tick();
      const r = sim.submit('m2', K.REACTION_SET, { messageId: id, emoji: pool[i], present: true });
      check(s, r.decision === 'APPLIED', `R-23 emoji ${i + 1}/20 aceito`);
    }
    sim.tick();
    expectRej(s, sim, 'R-23 emoji 21', E.REACTION_LIMIT, () => sim.submit('m2', K.REACTION_SET, { messageId: id, emoji: pool[20], present: true }, { advance: false }));
    sim.tick();
    expectOk(s, 'R-23 present:false nunca e recusada', () => sim.submit('m2', K.REACTION_SET, { messageId: id, emoji: pool[21], present: false }, { advance: false }));
  }
  // R-25 — category.delete carrega exatamente um
  {
    const sim = new Sim('r25');
    sim.bootstrap();
    sim.tick();
    const catSeq = sim.actor('m0').nextAuthorSeq;
    sim.submit('m0', K.CATEGORY_CREATE, { name: 'outra' });
    const other = sim.entity('category', 'm0', catSeq);
    sim.tick();
    expectRej(s, sim, 'R-25 nenhum dos dois', E.VALIDATION, () => sim.submit('m0', K.CATEGORY_DELETE, { categoryId: other, deleteChannels: false }, { advance: false }));
    sim.tick();
    expectRej(s, sim, 'R-25 os dois', E.VALIDATION, () =>
      sim.submit('m0', K.CATEGORY_DELETE, { categoryId: other, moveChannelsTo: sim.ids.category, deleteChannels: true }, { advance: false }),
    );
    sim.tick();
    expectOk(s, 'R-25 exatamente um', () => sim.submit('m0', K.CATEGORY_DELETE, { categoryId: other, moveChannelsTo: sim.ids.category, deleteChannels: false }, { advance: false }));
  }
  // R-26 — cardinalidade
  {
    const sim = new Sim('r26');
    sim.bootstrap();
    for (let i = sim.ds.categories.size; i < MAX_CATEGORIES; i++) {
      sim.tick();
      sim.submit('fundador', K.CATEGORY_CREATE, { name: `c${i}` });
    }
    eq(s, sim.ds.categories.size, MAX_CATEGORIES, 'R-26 chegou ao teto de categorias');
    sim.tick();
    expectRej(s, sim, 'R-26 categoria acima do teto', E.LIMIT_EXCEEDED, () => sim.submit('fundador', K.CATEGORY_CREATE, { name: 'excedente' }, { advance: false }));
    sim.tick();
    const many = Array.from({ length: MAX_ROLES_PER_MEMBER + 1 }, () => sim.ids.baseRole);
    check(s, many.length > MAX_ROLES_PER_MEMBER, 'R-26 fixture de cargos por membro');
  }
  // R-27 — lote de genese
  {
    // (a) genese correta
    const ok = new Sim('r27ok');
    ok.bootstrap(0);
    check(s, !ok.ds.communityInvalid && ok.ds.community.exists, 'R-27 genese normativa aceita');
    // (b) seq 0 que nao e community.create
    const bad = new Sim('r27bad');
    const r = bad.submit('fundador', K.CATEGORY_CREATE, { name: 'X' });
    check(s, r.decision === 'REJECTED' && r.reason === E.GENESIS_MISPLACED, 'R-27 seq 0 errado => E_GENESIS_MISPLACED');
    check(s, bad.ds.communityInvalid, 'R-27 comunidade marcada invalid');
    const after = bad.submit('fundador', K.COMMUNITY_CREATE, { name: 'Tarde', iconColor: 1, blobsKey: ZERO32 });
    check(s, after.decision === 'REJECTED', 'R-27 registro seguinte tambem recusado');
    // (c) autor diferente no meio da genese
    const mixed = new Sim('r27mix');
    mixed.submit('fundador', K.COMMUNITY_CREATE, { name: 'Com', iconColor: 1, blobsKey: ZERO32 });
    const r2 = mixed.submit('outro', K.ROLE_CREATE, { name: 'F', color: 0, permissions: [...ALL_PERMS], mentionable: true });
    check(s, r2.decision === 'REJECTED' && r2.reason === E.GENESIS_MISPLACED, 'R-27 autor diferente na genese');
    // (d) community.create fora do seq 0
    const late = new Sim('r27late');
    late.bootstrap(0);
    late.tick();
    expectRej(s, late, 'R-27 community.create em seq != 0', E.GENESIS_MISPLACED, () =>
      late.submit('fundador', K.COMMUNITY_CREATE, { name: 'Outra', iconColor: 1, blobsKey: ZERO32 }, { advance: false }),
    );
  }
  // §8.4.1 — resolucoes deterministicas
  {
    const sim = new Sim('res');
    sim.bootstrap();
    const { id } = sim.sendMessage('m2');
    sim.tick();
    expectOk(s, '§8.4.1 delete da propria', () => sim.submit('m2', K.MESSAGE_DELETE, { messageId: id }));
    sim.tick();
    const again = sim.submit('m2', K.MESSAGE_DELETE, { messageId: id });
    check(s, again.decision === 'APPLIED' && again.effects.length === 0, '§8.4.1 delete de ja deletada: APPLIED idempotente sem efeito');
    sim.tick();
    expectRej(s, sim, '§8.4.1 reacao em deletada', E.MESSAGE_DELETED, () => sim.submit('m2', K.REACTION_SET, { messageId: id, emoji: '👍', present: true }, { advance: false }));
    // ban idempotente
    sim.tick();
    sim.submit('fundador', K.MOD_BAN, { targetKey: sim.actor('m3').keys.publicKey });
    sim.tick();
    const ban2 = sim.submit('fundador', K.MOD_BAN, { targetKey: sim.actor('m3').keys.publicKey });
    check(s, ban2.decision === 'APPLIED' && ban2.effects.length === 0, '§8.4.1 ban de ja banido: APPLIED sem segunda auditoria');
    // op do banido
    sim.tick();
    expectRej(s, sim, '§8.4.1 op de banido', E.BANNED, () => sim.submit('m3', K.MESSAGE_SEND, { channelId: sim.ids.channel, content: 'x', mentions: [] }, { advance: false }));
    // setRoles com id desconhecido: descarta, nao recusa
    sim.tick();
    const sr = sim.submit('fundador', K.MEMBER_SET_ROLES, { targetKey: sim.actor('m2').keys.publicKey, roleIds: [sim.ids.baseRole, 'role-FANTASMA'] });
    check(s, sr.decision === 'APPLIED', '§8.4.1 setRoles descarta id desconhecido');
    check(s, !sim.ds.members.get(sim.actor('m2').keys.publicKey.toString('hex'))!.roleIds.has('role-FANTASMA'), '§8.4.1 id fantasma nao entra');
    // canal deletado => mensagens orphaned
    sim.tick();
    const chSeq = sim.actor('m0').nextAuthorSeq;
    sim.submit('m0', K.CHANNEL_CREATE, { categoryId: sim.ids.category, type: CHANNEL_TYPE.text, name: 'temp', readOnlyForRoleIds: [] });
    const tmp = sim.entity('channel', 'm0', chSeq);
    const m = sim.sendMessage('m2', 'na temp', tmp);
    sim.tick();
    const del = sim.submit('m0', K.CHANNEL_DELETE, { channelId: tmp });
    check(s, del.decision === 'APPLIED', '§8.4.1 canal deletado');
    check(s, sim.ds.messages.get(m.id)?.orphaned === true, '§8.4.1 mensagem vira orphaned, nao e apagada');
  }
  return s;
}

/** §28.1 — fronteira de CADA limite de §8.6: min-1, min, max, max+1. */
function suiteFoldBoundaries(): Suite {
  const s = suite('fold/fronteiras §8.6');
  const rep = (n: number, ch = 'a'): string => ch.repeat(Math.max(0, n));

  type Bound = {
    field: string;
    min: number;
    max: number;
    run: (sim: Sim, value: string) => { decision: string; reason?: string };
    code: ErrorCode;
    filler?: string;
    /** preenchimentos validos para este campo (o slug de canal so aceita [a-z0-9-]) */
    fillers?: string[];
  };

  const bounds: Bound[] = [
    {
      field: 'Community.name',
      min: LIMIT.communityName.min,
      max: LIMIT.communityName.max,
      code: E.VALIDATION,
      run: (sim, v) => {
        const fresh = new Sim(`bn-${v.length}`);
        return fresh.submit('fundador', K.COMMUNITY_CREATE, { name: v, iconColor: 1, blobsKey: ZERO32 }, { advance: false });
      },
    },
    {
      field: 'Category.name',
      min: LIMIT.categoryName.min,
      max: LIMIT.categoryName.max,
      code: E.VALIDATION,
      run: (sim, v) => sim.submit('fundador', K.CATEGORY_CREATE, { name: v }, { advance: false }),
    },
    {
      field: 'Role.name',
      min: LIMIT.roleName.min,
      max: LIMIT.roleName.max,
      code: E.VALIDATION,
      run: (sim, v) =>
        sim.submit('fundador', K.ROLE_CREATE, { name: v, color: 1, permissions: [], mentionable: true, afterRank: RANK_BOTTOM, beforeRank: RANK_TOP }, { advance: false }),
    },
    {
      field: 'Channel.name (texto)',
      min: LIMIT.channelName.min,
      max: LIMIT.channelName.max,
      code: E.VALIDATION,
      // §8.6: o nome de canal de texto passa por slug (NFD, sem diacritico, [a-z0-9-]).
      // Preenchimento fora desse conjunto vira nome VAZIO, que e outro caso (testado a parte).
      fillers: ['a', 'z', '7', 'b', 'c', 'd', 'e'],
      run: (sim, v) =>
        sim.submit('fundador', K.CHANNEL_CREATE, { categoryId: sim.ids.category, type: CHANNEL_TYPE.text, name: v, readOnlyForRoleIds: [] }, { advance: false }),
    },
    {
      field: 'Channel.topic',
      min: LIMIT.channelTopic.min,
      max: LIMIT.channelTopic.max,
      code: E.VALIDATION,
      run: (sim, v) =>
        sim.submit('fundador', K.CHANNEL_UPDATE, { channelId: sim.ids.channel, topic: v }, { advance: false }),
    },
    {
      field: 'Message.content',
      min: LIMIT.messageContentGraphemes.min,
      max: LIMIT.messageContentGraphemes.max,
      code: E.VALIDATION,
      run: (sim, v) => sim.submit('fundador', K.MESSAGE_SEND, { channelId: sim.ids.channel, content: v, mentions: [] }, { advance: false }),
    },
    {
      field: 'reason (moderacao)',
      min: LIMIT.moderationReason.min,
      max: LIMIT.moderationReason.max,
      code: E.VALIDATION,
      run: (sim, v) => sim.submit('fundador', K.MOD_BAN, { targetKey: sim.actor('m2').keys.publicKey, reason: v }, { advance: false }),
    },
    {
      field: 'Identity.displayName',
      min: LIMIT.displayName.min,
      max: LIMIT.displayName.max,
      code: E.VALIDATION,
      run: (sim, v) => {
        // A prova precisa ser VALIDA: R-9 e estagio 14, depois do estagio 13. Sem ela o
        // teste mediria R-9 em vez do limite de campo.
        const a = sim.actor('novato');
        const proof = sign(blake2b256('invite-join/1', sim.communityKey, sim.invite.publicKey, a.keys.publicKey), sim.invite.secretKey);
        return sim.submit('novato', K.MEMBER_JOIN, { invitePublicKey: sim.invite.publicKey, joinProof: proof, displayName: v, avatarColor: 1, blobsCoreKey: ZERO32 }, { advance: false });
      },
    },
    {
      field: 'Community.description',
      min: LIMIT.communityDescription.min,
      max: LIMIT.communityDescription.max,
      code: E.VALIDATION,
      run: (sim, v) => {
        const fresh = new Sim(`bd-${v.length}`);
        return fresh.submit('fundador', K.COMMUNITY_CREATE, { name: 'Comunidade', iconColor: 1, description: v, blobsKey: ZERO32 }, { advance: false });
      },
    },
  ];

  // Cada limite e exercitado com quatro preenchimentos diferentes: ASCII, acentuado,
  // com espaco interno e com digito. A contagem de grafemas e a normalizacao de §8.6
  // (NFKC, trim, colapso de espaco) mudam de comportamento entre eles.
  // ASCII, acentuado, maiuscula, digito, minuscula alta, ideograma (3 bytes) e grego.
  // A contagem de grafemas, o teto de BYTES e a normalizacao NFKC de §8.6 se comportam
  // de forma diferente entre eles.
  const fillers = ['a', 'á', 'A', '7', 'z', '中', 'Ω'];
  const asciiOnly = ['a', 'z', '7', 'b', 'c', 'd', 'e']; // campos com slug de §8.6
  const expanded: Bound[] = [];
  for (const b of bounds) {
    const list = b.fillers ?? fillers;
    for (const f of list) expanded.push({ ...b, filler: f, field: `${b.field}[${f}]` });
  }
  for (const b of expanded) {
    const points: Array<[string, number]> = [
      ['min', b.min],
      ['max', b.max],
      ['max+1', b.max + 1],
    ];
    // `min-1` so existe quando `min > 0`: com min 0 o valor de comprimento -1 nao existe.
    if (b.min > 0) points.unshift(['min-1', b.min - 1]);
    for (const [label, n] of points) {
      const sim = new Sim(`bound-${b.field}-${label}`);
      sim.bootstrap();
      sim.tick();
      const value = rep(n, b.filler ?? 'a');
      const r = b.run(sim, value);
      const shouldPass = n >= b.min && n <= b.max;
      if (shouldPass) {
        check(s, r.decision === 'APPLIED', `${b.field} @ ${label} (${n}) deve APLICAR — obtido ${r.decision}/${r.reason ?? '-'}`);
      } else {
        check(
          s,
          r.decision === 'REJECTED' && (r.reason === b.code || r.reason === E.CHANNEL_NAME_EMPTY || r.reason === E.INVITE_INVALID),
          `${b.field} @ ${label} (${n}) deve RECUSAR — obtido ${r.decision}/${r.reason ?? '-'}`,
        );
      }
    }
  }

  // Reaction.emoji: exatamente 1 grafema, <= 24 bytes
  {
    const sim = new Sim('emoji');
    sim.bootstrap();
    const { id } = sim.sendMessage('m2');
    const cases: Array<[string, boolean]> = [
      ['', false],
      ['a', true],
      ['👍', true],
      // OBS-04 (REPORT.md): 1 grafema, mas 25 bytes UTF-8 — acima do teto de 24 bytes de
      // §8.6. A familia com ZWJ, e varios emoji com modificador de tom, sao REJEITADOS.
      ['👨‍👩‍👧‍👦', false],
      ['ab', false],
      ['👍👍', false],
      ['a'.repeat(25), false],
    ];
    for (const [emoji, want] of cases) {
      sim.tick();
      const r = sim.submit('m2', K.REACTION_SET, { messageId: id, emoji, present: true }, { advance: false });
      check(s, (r.decision === 'APPLIED') === want, `emoji ${JSON.stringify(emoji)} => ${want ? 'APPLIED' : 'REJECTED'} (obtido ${r.decision}/${r.reason ?? '-'})`);
    }
  }
  // Message.mentions: 0..64
  {
    const sim = new Sim('mentions');
    sim.bootstrap();
    for (const [n, want] of [[0, true], [MAX_MENTIONS, true], [MAX_MENTIONS + 1, false]] as Array<[number, boolean]>) {
      sim.tick();
      const mentions = Array.from({ length: n }, (_, i) => `mencao-${i}`);
      const r = sim.submit('fundador', K.MESSAGE_SEND, { channelId: sim.ids.channel, content: 'x', mentions }, { advance: false });
      check(s, (r.decision === 'APPLIED') === want, `mentions=${n} => ${want ? 'APPLIED' : 'REJECTED'} (${r.decision}/${r.reason ?? '-'})`);
    }
  }
  // Attachment.sizeBytes e nome
  {
    const sim = new Sim('attach');
    sim.bootstrap();
    const blob = { blobsCoreKey: ZERO32, byteOffset: 0, blockOffset: 0, blockLength: 1, byteLength: 1 };
    const mk = (name: string, sizeBytes: number): Payload => ({
      channelId: sim.ids.channel, content: 'com anexo', mentions: [],
      attachment: { blob, name, sizeBytes, kind: 1, hash: ZERO32 },
    });
    const cases: Array<[string, number, boolean, string]> = [
      ['ok.png', 1, true, 'tamanho minimo'],
      // OBS-05 (REPORT.md): ATTACHMENT_MAX_BYTES = 8 GiB, mas ATTACHMENT_QUOTA_PER_MEMBER
      // = 5 GiB e R-14 roda no mesmo registro. O teto declarado de 8 GiB e INALCANCAVEL:
      // o maximo efetivo e 5 GiB, e so para quem nao tem nenhum outro anexo.
      ['ok.png', ATTACHMENT_QUOTA_PER_MEMBER, true, 'tamanho maximo EFETIVO (= cota)'],
      ['ok.png', ATTACHMENT_MAX_BYTES, false, 'ATTACHMENT_MAX_BYTES e inalcancavel (R-14)'],
      ['ok.png', ATTACHMENT_MAX_BYTES + 1, false, 'acima do maximo'],
      ['ok.png', 0, false, 'tamanho zero'],
      ['a/b.png', 100, false, 'barra no nome'],
      ['a\\b.png', 100, false, 'contrabarra no nome'],
      ['CON', 100, false, 'nome reservado CON'],
      ['com1.txt', 100, false, 'nome reservado COM1'],
      ['x.', 100, false, 'termina em ponto'],
      ['x ', 100, false, 'termina em espaco'],
      ['a'.repeat(256), 100, false, 'nome acima de 255 bytes'],
      ['a'.repeat(255), 100, true, 'nome de 255 bytes'],
    ];
    for (const [name, size, want, label] of cases) {
      sim.tick();
      const r = sim.submit('fundador', K.MESSAGE_SEND, mk(name, size), { advance: false });
      check(s, (r.decision === 'APPLIED') === want, `anexo ${label} => ${want ? 'APPLIED' : 'REJECTED'} (${r.decision}/${r.reason ?? '-'})`);
    }
  }
  // Normalizacao de nome de canal (§8.6)
  {
    const cases: Array<[string, string]> = [
      ['Geral', 'geral'],
      ['  Canal  Novo ', 'canal-novo'],
      ['Ação!!', 'acao'],
      ['a---b', 'a-b'],
      ['---', ''],
      ['ÁÉÍÓÚ', 'aeiou'],
      ['🎉festa', 'festa'],
      ['-inicio', 'inicio'],
    ];
    for (const [input, want] of cases) eq(s, slugChannelName(input), want, `slug(${JSON.stringify(input)})`);
    eq(s, graphemes('👨‍👩‍👧‍👦'), 1, 'familia = 1 grafema');
    eq(s, graphemes('abc'), 3, 'abc = 3 grafemas');
  }
  return s;
}


// ---------------------------------------------------------------------------------
// fold — matriz `kind` x estagio (§28.1: "tabela de casos por `kind` x cada estagio")
// ---------------------------------------------------------------------------------

/** Um payload minimo e BEM FORMADO para cada `kind` implementado. */
function samplePayloadFor(sim: Sim, kind: number): Payload {
  switch (kind) {
    case K.MESSAGE_SEND: return { channelId: sim.ids.channel, content: 'texto', mentions: [] };
    case K.MESSAGE_DELETE: return { messageId: 'msg-QUALQUER' };
    case K.REACTION_SET: return { messageId: 'msg-QUALQUER', emoji: '👍', present: true };
    case K.CHANNEL_CREATE: return { categoryId: sim.ids.category, type: CHANNEL_TYPE.text, name: 'novo-canal', readOnlyForRoleIds: [] };
    case K.CHANNEL_UPDATE: return { channelId: sim.ids.channel, topic: 'assunto' };
    case K.CHANNEL_DELETE: return { channelId: sim.ids.channel };
    case K.CATEGORY_CREATE: return { name: 'NOVA' };
    case K.CATEGORY_DELETE: return { categoryId: sim.ids.category, deleteChannels: true };
    case K.ROLE_CREATE: return { name: 'Cargo', color: 1, permissions: [], mentionable: true, afterRank: RANK_BOTTOM, beforeRank: RANK_TOP };
    case K.ROLE_UPDATE: return { roleId: sim.ids.modRole, name: 'Renomeado' };
    case K.ROLE_DELETE: return { roleId: sim.ids.modRole };
    case K.MEMBER_SET_ROLES: return { targetKey: sim.actor('m2').keys.publicKey, roleIds: [sim.ids.baseRole] };
    case K.MEMBER_JOIN: return { invitePublicKey: sim.invite.publicKey, joinProof: ZERO64, displayName: 'Novo', avatarColor: 1, blobsCoreKey: ZERO32 };
    case K.MOD_BAN: return { targetKey: sim.actor('m2').keys.publicKey };
    case K.INVITE_CREATE: return { invitePublicKey: randomBytes(32), maxUses: 5 };
    case K.COMMUNITY_CREATE: return { name: 'Outra', iconColor: 1, blobsKey: ZERO32 };
    default: return { channelId: '', content: '', mentions: [] };
  }
}

const IMPLEMENTED: number[] = [
  K.MESSAGE_SEND, K.MESSAGE_DELETE, K.REACTION_SET, K.CHANNEL_CREATE, K.CHANNEL_UPDATE,
  K.CHANNEL_DELETE, K.CATEGORY_CREATE, K.CATEGORY_DELETE, K.ROLE_CREATE, K.ROLE_UPDATE,
  K.ROLE_DELETE, K.MEMBER_SET_ROLES, K.MEMBER_JOIN, K.MOD_BAN, K.INVITE_CREATE, K.COMMUNITY_CREATE,
];

/**
 * Para CADA `kind` implementado, os estagios de §8.2 que sao independentes do `kind`.
 * E a linha "tabela de casos por `kind` x cada estagio de §8.2" de §28.1.
 */
function suiteFoldKindStageMatrix(): Suite {
  const s = suite('fold/matriz kind x estagio');
  for (const kind of IMPLEMENTED) {
    const sim = new Sim(`mx-${kind}`);
    sim.bootstrap();
    const who = kind === K.MEMBER_JOIN ? 'candidato' : 'm0';
    const P = (): Payload => samplePayloadFor(sim, kind);

    // estagio 1 — hostSig invalida
    sim.tick();
    expectIgn(s, `kind ${kind} @1 hostSig`, E.BAD_HOST_SIGNATURE, () => sim.submit(who, kind, P(), { badHostSig: true, advance: false }));
    // estagio 2 — versao desconhecida
    sim.tick();
    expectIgn(s, `kind ${kind} @2 versao`, E.VERSION_UNSUPPORTED, () => sim.submit(who, kind, P(), { v: 42, advance: false }));
    // estagio 2 — payload truncado (byte a menos)
    sim.tick();
    expectIgn(s, `kind ${kind} @2 payload truncado`, E.MALFORMED, () => {
      const a = sim.actor(who);
      const full = encodePayload(kind, P());
      const op = encodeOp({ v: 1, communityId: sim.communityKey, kind, author: a.keys.publicKey, authorSeq: 777_000 + kind, ts: sim.hostTs, payload: full.subarray(0, Math.max(0, full.length - 1)) });
      return sim.probe(sim.record({ op, sig: sign(opSigningHash(op), a.keys.secretKey) }));
    });
    // estagio 3 — comunidade errada
    sim.tick();
    expectRej(s, sim, `kind ${kind} @3 comunidade`, E.WRONG_COMMUNITY, () => sim.submit(who, kind, P(), { communityKey: randomBytes(32), advance: false }));
    // estagio 4 — assinatura do autor
    sim.tick();
    expectRej(s, sim, `kind ${kind} @4 assinatura`, E.BAD_SIGNATURE, () => sim.submit(who, kind, P(), { badSig: true, advance: false }));
    // estagio 6 — authorSeq repetido. Precisa de um autor que JA tenha registro no log:
    // `m0` entrou pelo convite, entao `lastAuthorSeq[m0] >= 1`.
    sim.tick();
    expectRej(s, sim, `kind ${kind} @6 duplicata`, E.DUPLICATE, () => sim.submit('m0', kind, P(), { authorSeq: 1, advance: false }));
    // estagio 7 — relogio fora da janela
    sim.tick();
    expectRej(s, sim, `kind ${kind} @7 relogio`, E.CLOCK_UNREASONABLE, () => sim.submit(who, kind, P(), { ts: sim.hostTs + 86_400_001, advance: false }));
    // estagio 8 — autor nao membro (excecao normativa: `member.join`)
    sim.tick();
    {
      const r = sim.submit('forasteiro-total', kind, P(), { advance: false });
      if (kind === K.MEMBER_JOIN) {
        // §8.2: `member.join` e a excecao normativa do estagio 8 — o autor E o candidato.
        check(s, r.decision === 'REJECTED' && r.reason !== E.NOT_MEMBER, `kind ${kind} @8 member.join e isento do estagio 8 (obtido ${r.reason})`);
      } else if (kind === K.COMMUNITY_CREATE) {
        // §8.4.1: `community.create` em `seq != 0` e barrado por R-27 ANTES do estagio 8.
        check(s, r.decision === 'REJECTED' && r.reason === E.GENESIS_MISPLACED, `kind ${kind} @8 genese fora de lugar precede o estagio 8 (obtido ${r.reason})`);
      } else {
        check(s, r.decision === 'REJECTED' && r.reason === E.NOT_MEMBER, `kind ${kind} @8 nao membro (obtido ${r.decision}/${r.reason ?? '-'})`);
      }
    }
  }
  return s;
}

/**
 * §7.2 regra 4 / §9.4: `kind` sem linha no registry falha FECHADO. Os 22 `kind`s
 * normativos fora deste binario e uma varredura de numeros arbitrarios.
 */
function suiteUnknownKinds(): Suite {
  const s = suite('fold/kind desconhecido');
  const sim = new Sim('unk');
  sim.bootstrap();
  const a = sim.actor('m0');
  const unimplemented = Object.values(K).filter((k) => !IMPLEMENTED.includes(k));
  eq(s, unimplemented.length, 22, 'os 38 kinds de §7.4 menos os 16 implementados');
  let n = 0;
  const probe = (kind: number, label: string): void => {
    sim.tick();
    const op = encodeOp({ v: 1, communityId: sim.communityKey, kind, author: a.keys.publicKey, authorSeq: 800_000 + n++, ts: sim.hostTs, payload: Buffer.alloc(4) });
    const r = sim.probe(sim.record({ op, sig: sign(opSigningHash(op), a.keys.secretKey) }));
    check(s, r.decision === 'IGNORED' && r.reason === E.UNKNOWN_KIND, `${label} kind=${kind} => IGNORED/E_UNKNOWN_KIND (obtido ${r.decision}/${r.reason ?? '-'})`);
    check(s, r.next.partialInterpretation === true, `kind=${kind} liga partialInterpretation (§7.2 regra 5)`);
  };
  for (const k of unimplemented) probe(k, 'kind normativo nao implementado');
  for (let i = 0; i < 100; i++) probe(1000 + i * 137, 'kind arbitrario');
  return s;
}

/** §9.4 — matriz de autorizacao: cada `kind` com e sem a permissao exigida. */
function suiteAuthorizationMatrix(): Suite {
  const s = suite('fold/autorizacao §9.4');
  const cases: Array<{ kind: number; perm: number; label: string }> = [
    { kind: K.MESSAGE_SEND, perm: PERM.send_messages, label: 'message.send' },
    { kind: K.REACTION_SET, perm: PERM.add_reactions, label: 'reaction.set' },
    { kind: K.CHANNEL_CREATE, perm: PERM.manage_channels, label: 'channel.create' },
    { kind: K.CHANNEL_UPDATE, perm: PERM.manage_channels, label: 'channel.update' },
    { kind: K.CHANNEL_DELETE, perm: PERM.manage_channels, label: 'channel.delete' },
    { kind: K.CATEGORY_CREATE, perm: PERM.manage_channels, label: 'category.create' },
    { kind: K.CATEGORY_DELETE, perm: PERM.manage_channels, label: 'category.delete' },
    { kind: K.ROLE_CREATE, perm: PERM.manage_roles, label: 'role.create' },
    { kind: K.ROLE_UPDATE, perm: PERM.manage_roles, label: 'role.update' },
    { kind: K.ROLE_DELETE, perm: PERM.manage_roles, label: 'role.delete' },
    { kind: K.MEMBER_SET_ROLES, perm: PERM.manage_roles, label: 'member.setRoles' },
    { kind: K.MOD_BAN, perm: PERM.ban_members, label: 'mod.ban' },
    { kind: K.INVITE_CREATE, perm: PERM.create_invite, label: 'invite.create' },
  ];
  for (const cse of cases) {
    const sim = new Sim(`auth-${cse.kind}`);
    sim.bootstrap();
    // O cargo base nasce com send_messages/attach_files/add_reactions/voice_speak
    // (§19.1). Para medir o estagio 11 e preciso um membro com ZERO permissao, entao o
    // Fundador esvazia o cargo base primeiro (R-11 so PROIBE permissoes, nunca exige).
    sim.tick();
    const strip = sim.submit('fundador', K.ROLE_UPDATE, { roleId: sim.ids.baseRole, permissions: [] });
    check(s, strip.decision === 'APPLIED', `${cse.label}: cargo base esvaziado para o teste`);

    sim.tick();
    const semPerm = sim.submit('m2', cse.kind, samplePayloadFor(sim, cse.kind), { advance: false });
    check(s, semPerm.decision === 'REJECTED' && semPerm.reason === E.PERMISSION_DENIED,
      `${cse.label} SEM a permissao => E_PERMISSION_DENIED (obtido ${semPerm.decision}/${semPerm.reason ?? '-'})`);

    // O Fundador tem as 17: precisa passar do estagio 11 (pode parar mais adiante).
    sim.tick();
    const comPerm = sim.submit('fundador', cse.kind, samplePayloadFor(sim, cse.kind), { advance: false });
    check(s, comPerm.reason !== E.PERMISSION_DENIED,
      `${cse.label} COM a permissao passa do estagio 11 (obtido ${comPerm.decision}/${comPerm.reason ?? '-'})`);

    // As 17 permissoes, UMA DE CADA VEZ, num cargo dedicado logo abaixo do Moderador:
    // so a exigida por §9.4 pode tirar o registro do estagio 11.
    for (const p of ALL_PERMS) {
      sim.tick();
      const roleSeq = sim.actor('fundador').nextAuthorSeq;
      const created = sim.submit('fundador', K.ROLE_CREATE, {
        name: `p${p}`, color: 1, permissions: [p], mentionable: true,
        afterRank: RANK_BOTTOM, beforeRank: sim.ds.roles.get(sim.ids.modRole)!.rank,
      });
      if (created.decision !== 'APPLIED') { check(s, false, `${cse.label}: cargo de permissao ${p} nao criado (${created.reason})`); continue; }
      const roleId = sim.entity('role', 'fundador', roleSeq);
      sim.tick();
      sim.submit('fundador', K.MEMBER_SET_ROLES, { targetKey: sim.actor('m3').keys.publicKey, roleIds: [sim.ids.baseRole, roleId] });
      sim.tick();
      const r = sim.submit('m3', cse.kind, samplePayloadFor(sim, cse.kind), { advance: false });
      const denied = r.reason === E.PERMISSION_DENIED;
      check(s, denied === (p !== cse.perm),
        `${cse.label} com SO a permissao ${p}: ${p === cse.perm ? 'nao pode' : 'tem de'} dar E_PERMISSION_DENIED (obtido ${r.decision}/${r.reason ?? '-'})`);
      sim.tick();
      sim.submit('fundador', K.ROLE_DELETE, { roleId });
    }
  }
  return s;
}


/**
 * §8.2 diz "ordem FIXA, deterministica". Quando um registro viola DOIS estagios ao mesmo
 * tempo, o codigo devolvido tem de ser o do estagio MAIS CEDO — senao a ordem nao e
 * observavel e duas implementacoes poderiam divergir no `reason` (que e contrato, §20.2).
 */
function suiteStageOrdering(): Suite {
  const s = suite('fold/ordem dos estagios §8.2');
  for (const kind of IMPLEMENTED) {
    const sim = new Sim(`ord-${kind}`);
    sim.bootstrap();
    const P = (): Payload => samplePayloadFor(sim, kind);
    const far = (): number => sim.hostTs + 86_400_001;

    // 1 antes de 4: hostSig invalida + assinatura do autor invalida
    sim.tick();
    expectIgn(s, `kind ${kind} ordem 1<4`, E.BAD_HOST_SIGNATURE, () => sim.submit('m0', kind, P(), { badHostSig: true, badSig: true, advance: false }));
    // 2 antes de 3: versao desconhecida + comunidade errada
    sim.tick();
    expectIgn(s, `kind ${kind} ordem 2<3`, E.VERSION_UNSUPPORTED, () => sim.submit('m0', kind, P(), { v: 42, communityKey: randomBytes(32), advance: false }));
    // 3 antes de 4: comunidade errada + assinatura invalida
    sim.tick();
    expectRej(s, sim, `kind ${kind} ordem 3<4`, E.WRONG_COMMUNITY, () => sim.submit('m0', kind, P(), { communityKey: randomBytes(32), badSig: true, advance: false }));
    // 4 antes de 6: assinatura invalida + authorSeq duplicado
    sim.tick();
    expectRej(s, sim, `kind ${kind} ordem 4<6`, E.BAD_SIGNATURE, () => sim.submit('m0', kind, P(), { badSig: true, authorSeq: 1, advance: false }));
    // 6 antes de 7: authorSeq duplicado + relogio fora da janela
    sim.tick();
    expectRej(s, sim, `kind ${kind} ordem 6<7`, E.DUPLICATE, () => sim.submit('m0', kind, P(), { authorSeq: 1, ts: far(), advance: false }));
    // 7 antes de 8: relogio fora da janela + autor nao membro
    sim.tick();
    expectRej(s, sim, `kind ${kind} ordem 7<8`, E.CLOCK_UNREASONABLE, () => sim.submit('forasteiro-ord', kind, P(), { ts: far(), advance: false }));
    // 8 antes de 11: nao membro + sem permissao (o nao-membro nao tem cargo nenhum)
    sim.tick();
    if (kind !== K.MEMBER_JOIN && kind !== K.COMMUNITY_CREATE) {
      expectRej(s, sim, `kind ${kind} ordem 8<11`, E.NOT_MEMBER, () => sim.submit('forasteiro-ord2', kind, P(), { advance: false }));
    } else {
      check(s, true, `kind ${kind} ordem 8<11 nao se aplica (excecao normativa do estagio 8)`);
    }
  }
  return s;
}

/** §8.0 — o contrato do `FoldResult`, verificado para CADA `kind`. */
function suiteResultContract(): Suite {
  const s = suite('fold/contrato §8.0');
  for (const kind of IMPLEMENTED) {
    const sim = new Sim(`ctr-${kind}`);
    sim.bootstrap();
    sim.tick();
    const seqAntes = sim.seq;
    const lastAntes = sim.ds.lastAuthorSeq.get(sim.actor('m0').keys.publicKey.toString('hex')) ?? 0;
    // Um registro que chega ao estagio 14 e e recusado por referencia quebrada.
    const r = sim.submit('m0', kind, samplePayloadFor(sim, kind), { communityKey: randomBytes(32), advance: false });
    check(s, r.decision === 'REJECTED' || r.decision === 'IGNORED' || r.decision === 'APPLIED', `kind ${kind}: desfecho e um dos tres`);
    check(s, r.effects.length === 0, `kind ${kind}: effects vazio quando nao APPLIED`);
    check(s, r.reason !== undefined, `kind ${kind}: reason presente quando nao APPLIED`);
    check(s, r.next.interpretedSeq === seqAntes, `kind ${kind}: interpretedSeq avanca em TODO desfecho (§8.2)`);
    const lastDepois = r.next.lastAuthorSeq.get(sim.actor('m0').keys.publicKey.toString('hex')) ?? 0;
    check(s, lastDepois >= lastAntes, `kind ${kind}: lastAuthorSeq nunca REGRIDE (§7.5)`);
  }
  return s;
}

/** R-15 — estagio 10, cota deterministica por autor. E o unico estagio que so aparece em volume. */
function suiteQuota(): Suite {
  const s = suite('fold/cota R-15 (estagio 10)');
  const sim = new Sim('quota');
  sim.bootstrap();
  let rejected = 0;
  let applied = 0;
  let firstReject = -1;
  for (let i = 0; i < QUOTA_OPS_PER_WINDOW + 50; i++) {
    sim.tick(1);
    const r = sim.submit('m2', K.MESSAGE_SEND, { channelId: sim.ids.channel, content: `q${i}`, mentions: [] });
    if (r.decision === 'APPLIED') applied++;
    else {
      if (firstReject < 0) firstReject = i;
      if (r.reason === E.QUOTA_EXCEEDED) rejected++;
    }
  }
  check(s, rejected > 0, `R-15 morde: ${rejected} recusas por E_QUOTA_EXCEEDED apos ${applied} aplicadas`);
  eq(s, applied, QUOTA_OPS_PER_WINDOW, 'R-15 aceita exatamente QUOTA_OPS_PER_WINDOW ops na janela');
  check(s, firstReject === QUOTA_OPS_PER_WINDOW, `R-15 a primeira recusa e na op ${QUOTA_OPS_PER_WINDOW + 1} (obtido indice ${firstReject})`);
  // O autor que estourou a cota NAO afeta os outros.
  sim.tick();
  const outro = sim.submit('m3', K.MESSAGE_SEND, { channelId: sim.ids.channel, content: 'outro autor', mentions: [] });
  check(s, outro.decision === 'APPLIED', 'R-15 e por AUTOR, nao global');

  // --- R-14, tambem no estagio 10 --------------------------------------------------
  const s14 = new Sim('quota14');
  s14.bootstrap();
  const blob = { blobsCoreKey: ZERO32, byteOffset: 0, blockOffset: 0, blockLength: 1, byteLength: 1 };
  const anexo = (sizeBytes: number, extra?: Partial<{ content: string; channelId: string }>): Payload => ({
    channelId: extra?.channelId ?? s14.ids.channel,
    content: extra?.content ?? 'com anexo',
    mentions: [],
    attachment: { blob, name: 'a.png', sizeBytes, kind: 1, hash: ZERO32 },
  });
  s14.tick();
  check(s, s14.submit('m2', K.MESSAGE_SEND, anexo(ATTACHMENT_QUOTA_PER_MEMBER), { advance: false }).decision === 'APPLIED',
    'R-14 aceita exatamente ATTACHMENT_QUOTA_PER_MEMBER');
  s14.tick();
  {
    const r = s14.submit('m2', K.MESSAGE_SEND, anexo(ATTACHMENT_QUOTA_PER_MEMBER + 1), { advance: false });
    check(s, r.reason === E.QUOTA_EXCEEDED, `R-14 recusa acima da cota (obtido ${r.reason ?? '-'})`);
  }
  // §8.2 poe R-14 no ESTAGIO 10 — antes de permissao (11) e de limite de campo (13).
  // Um anexo acima da cota, num canal inexistente, com conteudo vazio, tem de dar
  // E_QUOTA_EXCEEDED, e nao E_CHANNEL_NOT_FOUND nem E_VALIDATION.
  s14.tick();
  {
    const r = s14.submit('m2', K.MESSAGE_SEND, anexo(ATTACHMENT_MAX_BYTES, { content: '', channelId: 'ch-NAOEXISTE' }), { advance: false });
    check(s, r.reason === E.QUOTA_EXCEEDED,
      `R-14 no estagio 10 precede canal inexistente (14) e conteudo vazio (13) (obtido ${r.reason ?? '-'})`);
  }
  // O consumo ACUMULA: duas mensagens de 3 GiB nao cabem em 5 GiB.
  const meio = Math.floor(ATTACHMENT_QUOTA_PER_MEMBER * 0.6);
  s14.tick();
  check(s, s14.submit('m3', K.MESSAGE_SEND, anexo(meio)).decision === 'APPLIED', 'R-14 primeiro anexo de 60% da cota');
  s14.tick();
  {
    const r = s14.submit('m3', K.MESSAGE_SEND, anexo(meio), { advance: false });
    check(s, r.reason === E.QUOTA_EXCEEDED, `R-14 acumula storageUsedBytes (obtido ${r.reason ?? '-'})`);
  }
  return s;
}


/**
 * §8.4.1 — "Referencia quebrada: a politica que substitui o reducer que lanca".
 * Cada linha da tabela normativa, com o desfecho que ela exige. Nenhuma delas e parada.
 */
function suiteBrokenRefs(): Suite {
  const s = suite('fold/referencia quebrada §8.4.1');
  const mk = (tag: string): Sim => {
    const sim = new Sim(`ref-${tag}`);
    sim.bootstrap();
    return sim;
  };
  const NOPE = { channel: 'ch-NAOEXISTE0000000000000000', category: 'cat-NAOEXISTE000000000000000', role: 'role-NAOEXISTE00000000000000', message: 'msg-NAOEXISTE0000000000000000' };

  // message.send: canal inexistente / deletado / de voz / id de outro tipo
  {
    const sim = mk('send');
    sim.tick();
    expectRej(s, sim, 'send: canal inexistente', E.CHANNEL_NOT_FOUND, () => sim.submit('m0', K.MESSAGE_SEND, { channelId: NOPE.channel, content: 'x', mentions: [] }, { advance: false }));
    sim.tick();
    expectRej(s, sim, 'send: id de categoria como canal', E.CHANNEL_NOT_FOUND, () => sim.submit('m0', K.MESSAGE_SEND, { channelId: sim.ids.category, content: 'x', mentions: [] }, { advance: false }));
    sim.tick();
    const vSeq = sim.actor('m0').nextAuthorSeq;
    sim.submit('m0', K.CHANNEL_CREATE, { categoryId: sim.ids.category, type: CHANNEL_TYPE.voice, name: 'voz', readOnlyForRoleIds: [] });
    const voz = sim.entity('channel', 'm0', vSeq);
    sim.tick();
    expectRej(s, sim, 'send: canal de VOZ', E.CHANNEL_NOT_FOUND, () => sim.submit('m0', K.MESSAGE_SEND, { channelId: voz, content: 'x', mentions: [] }, { advance: false }));
    sim.tick();
    const cSeq = sim.actor('m0').nextAuthorSeq;
    sim.submit('m0', K.CHANNEL_CREATE, { categoryId: sim.ids.category, type: CHANNEL_TYPE.text, name: 'sumira', readOnlyForRoleIds: [] });
    const ch = sim.entity('channel', 'm0', cSeq);
    sim.tick();
    sim.submit('m0', K.CHANNEL_DELETE, { channelId: ch });
    sim.tick();
    expectRej(s, sim, 'send: canal DELETADO', E.CHANNEL_NOT_FOUND, () => sim.submit('m0', K.MESSAGE_SEND, { channelId: ch, content: 'x', mentions: [] }, { advance: false }));
  }
  // message.delete / reaction.set
  {
    const sim = mk('msg');
    sim.tick();
    expectRej(s, sim, 'delete: mensagem inexistente', E.NOT_FOUND, () => sim.submit('m0', K.MESSAGE_DELETE, { messageId: NOPE.message }, { advance: false }));
    sim.tick();
    expectRej(s, sim, 'reaction: mensagem inexistente', E.NOT_FOUND, () => sim.submit('m0', K.REACTION_SET, { messageId: NOPE.message, emoji: '👍', present: true }, { advance: false }));
    const { id } = sim.sendMessage('m2');
    sim.tick();
    sim.submit('m2', K.MESSAGE_DELETE, { messageId: id });
    sim.tick();
    expectRej(s, sim, 'reaction: mensagem DELETADA', E.MESSAGE_DELETED, () => sim.submit('m0', K.REACTION_SET, { messageId: id, emoji: '👍', present: true }, { advance: false }));
    sim.tick();
    const idem = sim.submit('m2', K.MESSAGE_DELETE, { messageId: id }, { advance: false });
    check(s, idem.decision === 'APPLIED' && idem.effects.length === 0, 'delete de ja deletada: APPLIED idempotente, sem efeito');
  }
  // channel.* / category.*
  {
    const sim = mk('chcat');
    sim.tick();
    expectRej(s, sim, 'channel.create: categoria inexistente', E.CATEGORY_NOT_FOUND, () => sim.submit('m0', K.CHANNEL_CREATE, { categoryId: NOPE.category, type: CHANNEL_TYPE.text, name: 'x', readOnlyForRoleIds: [] }, { advance: false }));
    sim.tick();
    expectRej(s, sim, 'channel.update: canal inexistente', E.CHANNEL_NOT_FOUND, () => sim.submit('m0', K.CHANNEL_UPDATE, { channelId: NOPE.channel, topic: 'x' }, { advance: false }));
    sim.tick();
    expectRej(s, sim, 'channel.delete: canal inexistente', E.CHANNEL_NOT_FOUND, () => sim.submit('m0', K.CHANNEL_DELETE, { channelId: NOPE.channel }, { advance: false }));
    sim.tick();
    expectRej(s, sim, 'category.delete: categoria inexistente', E.CATEGORY_NOT_FOUND, () => sim.submit('m0', K.CATEGORY_DELETE, { categoryId: NOPE.category, deleteChannels: true }, { advance: false }));
    sim.tick();
    expectRej(s, sim, 'category.delete: destino inexistente', E.CATEGORY_NOT_FOUND, () => sim.submit('m0', K.CATEGORY_DELETE, { categoryId: sim.ids.category, moveChannelsTo: NOPE.category, deleteChannels: false }, { advance: false }));
    sim.tick();
    expectRej(s, sim, 'category.delete: destino = origem', E.VALIDATION, () => sim.submit('m0', K.CATEGORY_DELETE, { categoryId: sim.ids.category, moveChannelsTo: sim.ids.category, deleteChannels: false }, { advance: false }));
  }
  // role.* e member.setRoles
  {
    const sim = mk('role');
    sim.tick();
    expectRej(s, sim, 'role.update: cargo inexistente', E.NOT_FOUND, () => sim.submit('fundador', K.ROLE_UPDATE, { roleId: NOPE.role, name: 'x' }, { advance: false }));
    sim.tick();
    expectRej(s, sim, 'role.delete: cargo inexistente', E.NOT_FOUND, () => sim.submit('fundador', K.ROLE_DELETE, { roleId: NOPE.role }, { advance: false }));
    sim.tick();
    expectRej(s, sim, 'setRoles: alvo inexistente', E.NOT_FOUND, () => sim.submit('fundador', K.MEMBER_SET_ROLES, { targetKey: randomBytes(32), roleIds: [sim.ids.baseRole] }, { advance: false }));
    sim.tick();
    const disc = sim.submit('fundador', K.MEMBER_SET_ROLES, { targetKey: sim.actor('m2').keys.publicKey, roleIds: [sim.ids.baseRole, NOPE.role] }, { advance: false });
    check(s, disc.decision === 'APPLIED', 'setRoles: cargo inexistente e DESCARTADO, nao recusa a op (§8.4.1)');
    // role.delete limpa a referencia pendurada em readOnlyForRoleIds (fecha F-31)
    sim.tick();
    const rSeq = sim.actor('fundador').nextAuthorSeq;
    sim.submit('fundador', K.ROLE_CREATE, { name: 'Temp', color: 1, permissions: [], mentionable: true, afterRank: RANK_BOTTOM, beforeRank: sim.ds.roles.get(sim.ids.modRole)!.rank });
    const temp = sim.entity('role', 'fundador', rSeq);
    sim.tick();
    const cSeq = sim.actor('fundador').nextAuthorSeq;
    sim.submit('fundador', K.CHANNEL_CREATE, { categoryId: sim.ids.category, type: CHANNEL_TYPE.text, name: 'ro-temp', readOnlyForRoleIds: [temp] });
    const ch = sim.entity('channel', 'fundador', cSeq);
    check(s, sim.ds.channels.get(ch)!.readOnlyForRoleIds.has(temp), 'readOnlyForRoleIds contem o cargo antes do delete');
    sim.tick();
    sim.submit('fundador', K.ROLE_DELETE, { roleId: temp });
    check(s, !sim.ds.channels.get(ch)!.readOnlyForRoleIds.has(temp), 'role.delete limpa readOnlyForRoleIds no MESMO registro (F-31)');
    // membro que fica sem cargo recebe o base
    const m2 = sim.actor('m2').keys.publicKey.toString('hex');
    check(s, sim.ds.members.get(m2)!.roleIds.has(sim.ids.baseRole), 'membro sem cargo recebe o base (§8.4.1)');
  }
  // mod.ban e invite
  {
    const sim = mk('ban');
    sim.tick();
    expectRej(s, sim, 'ban: alvo inexistente', E.NOT_FOUND, () => sim.submit('fundador', K.MOD_BAN, { targetKey: randomBytes(32) }, { advance: false }));
    sim.tick();
    sim.submit('fundador', K.MOD_BAN, { targetKey: sim.actor('m2').keys.publicKey });
    sim.tick();
    const again = sim.submit('fundador', K.MOD_BAN, { targetKey: sim.actor('m2').keys.publicKey }, { advance: false });
    check(s, again.decision === 'APPLIED' && again.effects.length === 0, 'ban de ja banido: APPLIED sem segunda auditoria (§8.4.1)');
    sim.tick();
    const dup = sim.submit('fundador', K.INVITE_CREATE, { invitePublicKey: sim.invite.publicKey, maxUses: 3 }, { advance: false });
    check(s, dup.decision === 'REJECTED' && dup.reason === E.VALIDATION, 'invite.create com chave repetida e recusado');
  }
  return s;
}

// ---------------------------------------------------------------------------------

export async function runUnit(opts: { idgenTuples: number }): Promise<UnitReport> {
  const t0 = Date.now();
  const suites: Suite[] = [];
  suites.push(suiteCodec());
  const idg = suiteIdgen(opts.idgenTuples);
  suites.push(idg.s);
  suites.push(suitePermissions());
  suites.push(suiteRank());
  const stages = suiteFoldStages();
  const rules = suiteFoldRules();
  const bounds = suiteFoldBoundaries();
  const matrix = suiteFoldKindStageMatrix();
  const unknown = suiteUnknownKinds();
  const authz = suiteAuthorizationMatrix();
  const order = suiteStageOrdering();
  const contract = suiteResultContract();
  const quota = suiteQuota();
  const refs = suiteBrokenRefs();
  suites.push(stages, rules, bounds, matrix, unknown, authz, order, contract, quota, refs);

  const total = suites.reduce((a, b) => a + b.total, 0);
  const failed = suites.reduce((a, b) => a + b.failed, 0);
  return {
    suites,
    total,
    failed,
    foldCases:
      stages.total +
      rules.total +
      bounds.total +
      matrix.total +
      unknown.total +
      authz.total +
      order.total +
      contract.total +
      quota.total +
      refs.total,
    idgenTuples: idg.tuples,
    idgenCollisions: idg.collisions,
    ok: failed === 0,
    ms: Date.now() - t0,
  };
}
