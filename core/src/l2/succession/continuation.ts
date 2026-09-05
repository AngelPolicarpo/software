// `succession` — construção da comunidade de continuação (§18.8, A23).
//
// A assunção **não** appenda no core antigo (dois escritores = fork). O sucessor:
//   1. decifra o `communitySeed` do escrow e deriva as chaves do core ANTIGO — a posse
//      da chave de escrita antiga é a autorização (`'assume/1'`, R-18a);
//   2. cria uma comunidade NOVA com seed NOVO, cuja gênese carrega
//      `originCommunityId`/`originFinalSeq` (§7.4.5) e um `blobsKey` novo;
//   3. appenda `community.assumeHost` como seq 6 (R-27) com a prova;
//   4. reconstrói o estado estrutural da origem num lote estendido — cargos, categorias,
//      canais, membros e bans — por ops que o próprio sucessor, agora host, assina.
//
// **O ROSTER NÃO MIGRA (ACHADO-G12-01, decidido em 2026-08-22 — §18.8.1, L-23):**
// `member.join` cria a membresia do **próprio autor** do op — a prova de convite vincula o
// communityId NOVO, que o sucessor não pode forjar para terceiros, e ninguém mais pode
// assinar por eles (§12.4, F-06). Logo, "membros reconstruídos no lote estendido" saiu do
// §18.8 passo 6: este builder migra a ESTRUTURA (cargos, categorias, canais) e a
// convergência de membros acontece por **reentrada assistida** — o sucessor publica
// convites, cada pessoa entra assinando o próprio join e ele reatribui os cargos.
//
// Os **bans** migram, e é o que impede a reentrada de lavar moderação: cada alvo banido na
// origem vira um `mod.ban` do lote, aceito pelo `fold` da continuação por R-28 (ban sobre
// quem ainda não é membro lá). Sem isso, o convite de reentrada de L-23 devolveria o banido
// pela porta da frente.
//
// Mensagens, convites e relays **não migram** (L-15). Os ids de entidade da continuação
// são previstos com o mesmo `entityId` de §7.3 — determinístico por
// `(kind, coreKey, autor, authorSeq)` — para o lote referenciar cargos/categorias novos.
// A ordem é exata: o id previsto de um create usa o `authorSeq` que aquele create VAI
// consumir (`authorSeq + 1` antes do `build`, sem consumir).

import sodium from 'sodium-native';

import {
  encodeEnvelope,
  encodeHostRecord,
  encodeOp,
  encodePayload,
  hostRecordSigningHash,
  opSigningHash,
  OP_VERSION,
  type KindName,
  type PayloadOf,
} from '../../l1/opCodec/index.ts';
import { deriveCommunityKeyPairs } from '../../l0/corestore/index.ts';
import { KINDS } from '../../l1/opCodec/kinds.ts';
import { entityId } from '../../l1/idgen/index.ts';
import { ALL_PERMISSIONS, permissionNumber } from '../../l1/permissions/index.ts';
import type { DecisionState } from '../../l1/fold/index.ts';

const ZERO32 = Buffer.alloc(32);
const ZERO64 = Buffer.alloc(64);

function blake2b256(domain: string, ...parts: Uint8Array[]): Buffer {
  const out = Buffer.allocUnsafe(32);
  sodium.crypto_generichash_batch(out, [Buffer.from(domain, 'utf8'), ...parts]);
  return out;
}

function u64le(n: number): Buffer {
  const b = Buffer.allocUnsafe(8);
  b.writeBigUInt64LE(BigInt(Math.trunc(n)));
  return b;
}

function signDetached(message: Uint8Array, secretKey: Buffer): Buffer {
  const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, message, secretKey);
  return sig;
}

export interface ContinuationInput {
  /** Estado final da origem — o `DecisionState` corrente do log antigo. */
  readonly originState: DecisionState;
  /** Chave secreta do core ANTIGO, derivada da semente decifrada do escrow (posse). */
  readonly originCoreSecretKey: Buffer;
  /** Identidade do sucessor — autor da gênese e novo host. */
  readonly successorIdentity: { readonly publicKey: Buffer; readonly secretKey: Buffer };
  /**
   * Semente NOVA do core de continuação (§18.8 passo 2). Default: aleatória. Fixe em
   * teste/harness para planos reproduzíveis. O par do log e o `blobsKey` saem dela pelos
   * namespaces de §5.3 — é o que torna a continuação recuperável pela mesma semente que o
   * escrow de uma sucessão futura vai selar.
   */
  readonly newCoreSeed?: Buffer;
  /**
   * §13.1 — o core de blobs LOCAL do sucessor nesta comunidade nova, que é DERIVADO da
   * identidade dele e do `communityId` novo. Chega injetado porque a derivação mora no
   * módulo de blobs, que não é dependência declarada de `succession` (§4).
   */
  readonly successorBlobsCoreKey: Buffer;
  readonly hostTs?: number;
}

export interface ContinuationPlan {
  readonly newCoreKeyPair: { readonly publicKey: Buffer; readonly secretKey: Buffer };
  readonly newBlobsKey: Buffer;
  /** Gênese (seq 0–5) + `assumeHost` (seq 6) + lote estendido, prontos para append. */
  readonly records: Buffer[];
  readonly originCommunityIdHex: string;
  readonly originFinalSeq: number;
  readonly proof: Buffer;
  /** Papel da gênese correspondente a cada papel vivo da origem (Fundador/Membro inclusive). */
  readonly roleIdByOld: ReadonlyMap<string, string>;
  readonly categoryIdByOld: ReadonlyMap<string, string>;
  readonly channelIdByOld: ReadonlyMap<string, string>;
  /** Chaves banidas na origem que o lote rebane na continuação (R-28), na ordem do lote. */
  readonly bannedTargets: readonly Buffer[];
}

/**
 * Monta o plano completo da continuação. Puro: não toca rede nem storage — os `records`
 * saem para o core novo pela composição (`createCore` + `append`).
 */
export function planContinuation(input: ContinuationInput): ContinuationPlan {
  const origin = input.originState;
  if (!origin.community.exists) throw new Error('origem não existe');
  if (origin.community.endedAt !== undefined) throw new Error('comunidade encerrada não tem sucessão');
  const originCommunityIdHex = origin.communityId;
  const originFinalSeq = Math.max(origin.interpretedSeq, 0);

  const newCoreSeed = input.newCoreSeed ?? (() => { const s = Buffer.alloc(sodium.crypto_sign_SEEDBYTES); sodium.randombytes_buf(s); return s; })();
  // §5.3 itens 3 e 5: o par do log e o de blobs saem da semente pelos namespaces
  // `ns/log/1` e `ns/blobs/1`, sempre — inclusive aqui. Derivar por conta própria fazia
  // uma comunidade que o boot não conseguia reabrir para escrita (ele deriva assim) e da
  // qual nenhuma sucessão futura podia sair (o `assumeHost` confere a chave derivada
  // contra o `communityId`).
  const pares = deriveCommunityKeyPairs(newCoreSeed);
  const newCoreKeyPair = pares.log;
  const newBlobsKey = pares.blobs.publicKey;

  const hostTs = input.hostTs ?? Date.now();
  const successor = input.successorIdentity;
  let authorSeq = 0;
  const records: Buffer[] = [];

  const build = <K extends KindName>(kind: K, payload: PayloadOf<K>): void => {
    const op = encodeOp({
      v: OP_VERSION,
      communityId: newCoreKeyPair.publicKey,
      kind: KINDS[kind],
      author: successor.publicKey,
      sequenceScope: { kind: 'community' },
      authorSeq: ++authorSeq,
      ts: hostTs,
      payload: encodePayload(kind, payload),
    });
    const envelope = encodeEnvelope({ op, sig: signDetached(opSigningHash(op), successor.secretKey) });
    const hostSig = signDetached(hostRecordSigningHash(envelope, hostTs, 0), newCoreKeyPair.secretKey);
    records.push(encodeHostRecord({ envelope, hostTs, flags: 0, hostSig }));
  };

  // ── Gênese (R-27) ────────────────────────────────────────────────────────────────────
  build('community.create', {
    name: origin.community.name,
    iconColor: origin.community.iconColor,
    blobsKey: newBlobsKey,
    originCommunityId: originCommunityIdHex,
    originFinalSeq,
  });
  build('role.create', {
    name: 'Fundador',
    color: 0,
    permissions: ALL_PERMISSIONS.map(permissionNumber),
    mentionable: true,
  });
  build('role.create', {
    name: 'Membro',
    color: 6,
    permissions: ['send_messages', 'attach_files', 'add_reactions', 'voice_speak'].map((p) =>
      permissionNumber(p as (typeof ALL_PERMISSIONS)[number]),
    ),
    mentionable: false,
  });
  // founder-form: provas zeradas, válido só em gênese (R-27)
  const sucessorNaOrigem = origin.members.get(successor.publicKey.toString('hex'));
  build('member.join', {
    invitePublicKey: ZERO32,
    joinProof: ZERO64,
    displayName: sucessorNaOrigem?.displayName ?? 'Fundador',
    avatarColor: sucessorNaOrigem?.avatarColor ?? 0,
    blobsCoreKey: input.successorBlobsCoreKey,
  });
  // os dois creates abaixo vão ocupar authorSeq 5 e 6 — os ids são previstos antes, e são
  // ESTES que o lote estendido reusa: recalculá-los mais adiante, com o `authorSeq` já
  // avançado pelo `assumeHost` e pelos cargos, produzia id de entidade que não existe.
  const catGeralId = entityId('category', newCoreKeyPair.publicKey, successor.publicKey, authorSeq + 1);
  const canalGeralId = entityId('channel', newCoreKeyPair.publicKey, successor.publicKey, authorSeq + 2);
  build('category.create', { name: 'GERAL' });
  build('channel.create', { categoryId: catGeralId, type: 0, name: 'geral', readOnlyForRoleIds: [] });

  // ── assumeHost — seq 6, logo após a gênese (§18.8 passo 3) ───────────────────────────
  const proof = signDetached(
    blake2b256('assume/1', newCoreKeyPair.publicKey, u64le(originFinalSeq)),
    input.originCoreSecretKey,
  );
  build('community.assumeHost', {
    newHostKey: successor.publicKey,
    observedHostTs: origin.lastHostTs,
    proof,
  });

  // ── Lote estendido (§18.8 passo 6) ───────────────────────────────────────────────────
  const roleIdByOld = new Map<string, string>();
  const categoryIdByOld = new Map<string, string>();
  const channelIdByOld = new Map<string, string>();

  // papéis vivos da origem: os padrões mapeiam para a gênese (authorSeq 2 e 3),
  // os customizados são recriados
  for (const [oldId, role] of origin.roles) {
    if (role.deletedAt !== undefined) continue;
    if (role.isFounder) roleIdByOld.set(oldId, entityId('role', newCoreKeyPair.publicKey, successor.publicKey, 2));
    else if (role.isDefault) roleIdByOld.set(oldId, entityId('role', newCoreKeyPair.publicKey, successor.publicKey, 3));
    else {
      const newId = entityId('role', newCoreKeyPair.publicKey, successor.publicKey, authorSeq + 1);
      build('role.create', {
        name: role.name,
        color: role.color,
        permissions: [...role.permissions],
        mentionable: role.mentionable,
      });
      roleIdByOld.set(oldId, newId);
    }
  }

  // categorias não têm regra de unicidade no `fold`, mas duplicar a GERAL da gênese é
  // ruído estrutural: nome já presente → mapeia para a equivalente nova.
  const categoryIdByName = new Map<string, string>();
  categoryIdByName.set('GERAL', catGeralId);

  for (const [oldId, category] of origin.categories) {
    if (category.deletedAt !== undefined) continue;
    const existente = categoryIdByName.get(category.name);
    if (existente !== undefined) {
      categoryIdByOld.set(oldId, existente);
      continue;
    }
    const newId = entityId('category', newCoreKeyPair.publicKey, successor.publicKey, authorSeq + 1);
    build('category.create', { name: category.name });
    categoryIdByOld.set(oldId, newId);
    categoryIdByName.set(category.name, newId);
  }

  // R-6: unicidade de `${type}:${name}` — canais da origem que colidem com os criados na
  // gênese (o `geral`) mapeiam para o equivalente novo em vez de serem recriados.
  const channelIdByKey = new Map<string, string>();
  channelIdByKey.set(`0:geral`, canalGeralId);

  for (const [oldId, channel] of origin.channels) {
    if (channel.deletedAt !== undefined) continue;
    const key = `${channel.type}:${channel.name}`;
    const existente = channelIdByKey.get(key);
    if (existente !== undefined) {
      channelIdByOld.set(oldId, existente);
      continue;
    }
    const newId = entityId('channel', newCoreKeyPair.publicKey, successor.publicKey, authorSeq + 1);
    const readOnly = [...channel.readOnlyForRoleIds]
      .map((rid) => roleIdByOld.get(rid))
      .filter((rid): rid is string => rid !== undefined);
    if (channel.topic === undefined) {
      build('channel.create', { categoryId: categoryIdByOld.get(channel.categoryId)!, type: channel.type, name: channel.name, readOnlyForRoleIds: readOnly });
    } else {
      build('channel.create', { categoryId: categoryIdByOld.get(channel.categoryId)!, type: channel.type, name: channel.name, topic: channel.topic, readOnlyForRoleIds: readOnly });
    }
    channelIdByOld.set(oldId, newId);
    channelIdByKey.set(key, newId);
  }

  // ── Bans (§18.8.1, R-28) ─────────────────────────────────────────────────────────────
  // O roster não migra, mas a moderação sim: sem estes `mod.ban` o convite de reentrada de
  // L-23 devolveria o banido. Na continuação o alvo ainda não é membro, e é R-28 que faz o
  // `fold` aceitar — a linha nasce em `banned`, fora do roster e do `memberCount`.
  //
  // A **razão** do ban não migra: §8.1 guarda `bannedAt`/`bannedBy` no `DecisionState`, e o
  // texto vive só na projeção (`bans.reason` de §10.3), que o sucessor não lê aqui. O ban
  // chega sem motivo declarado, e é isso que a auditoria da continuação registra.
  const successorHex = successor.publicKey.toString('hex');
  const bannedTargets: Buffer[] = [];
  for (const [hex, member] of origin.members) {
    if (member.state !== 'banned') continue;
    // R-16: o host corrente da continuação é o sucessor, e ninguém é alvo de `mod.*` sobre
    // si mesmo. Se ele constava banido na origem, o ban não o segue — quem decide se ele
    // podia assumir é a camada (b) de R-18, não este lote.
    if (hex === successorHex) continue;
    const targetKey = Buffer.from(hex, 'hex');
    build('mod.ban', { targetKey });
    bannedTargets.push(targetKey);
  }

  return {
    newCoreKeyPair,
    newBlobsKey,
    records,
    originCommunityIdHex,
    originFinalSeq,
    proof,
    roleIdByOld,
    categoryIdByOld,
    channelIdByOld,
    bannedTargets,
  };
}
