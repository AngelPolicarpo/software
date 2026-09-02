// Cabo de teste da conversa direta — §31. Constrói os dois cores de uma conversa com chaves
// determinísticas, para que todo teste (e o fuzzer) parta do mesmo material.
//
// Não é código de produto: aqui se **escreve** o registro que o produto só lê. A derivação
// segue §31.2 e §31.3 literalmente; onde ela divergir do produto, é bug do teste.

import sodium from 'sodium-native';

import {
  DM_KINDS,
  DM_VERSION,
  dmContentKey,
  dmConversationKey,
  dmCorePossessionHash,
  dmPairOrder,
  encodeDmEnvelope,
  encodeDmOp,
  encodeDmPayload,
  dmOpSigningHash,
  sealDmPayload,
  type DmKindName,
  type DmPayloadOf,
} from '../../src/l1/dmCodec/index.ts';
import type { DmContext } from '../../src/l1/dmFold/index.ts';
import { emptyDmState, type DmOrigin, type DmState } from '../../src/l1/dmFold/index.ts';

export type Keypair = { publicKey: Buffer; secretKey: Buffer };

export function dmKeypair(label: string): Keypair {
  const seed = Buffer.alloc(32);
  Buffer.from(label, 'utf8').copy(seed);
  const publicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES);
  const secretKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES);
  sodium.crypto_sign_seed_keypair(publicKey, secretKey, seed);
  return { publicKey, secretKey };
}

export const DM_T0 = 1_755_000_000_000;

function sign(secretKey: Buffer, digest: Buffer): Buffer {
  const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, digest, secretKey);
  return sig;
}

/** Uma das duas metades da conversa: identidade, core de DM e core de blobs. */
export type DmSide = {
  readonly origin: DmOrigin;
  readonly identity: Keypair;
  readonly core: Keypair;
  readonly blobs: Keypair;
};

export type DmWorld = {
  readonly conversationKey: Buffer;
  readonly conversationId: string;
  readonly contentKey: Buffer;
  readonly lo: DmSide;
  readonly hi: DmSide;
  readonly ctx: DmContext;
  state(): DmState;
  side(o: DmOrigin): DmSide;
};

/**
 * §31.3 — `dmContentKey` **de verdade**, desde §103.
 *
 * Até B57 este cabo derivava a chave de um rótulo falso (`'dm-content/1' ‖ conversationKey`),
 * com um comentário dizendo que no produto ela sai de X25519. A derivação real —
 * `BLAKE2b('dm-content/1' ‖ X25519(sk_próprio, pk_do_par) ‖ conversationId)` — passou a
 * existir em `dmCodec.dmContentKey`, e manter o rótulo falso deixaria os testes de `dmFold`
 * cifrando com material que o produto nunca produz. A troca muda os bytes de **todo** registro
 * de teste; nenhuma asserção depende deles, porque nenhuma testa ciphertext — testam desfecho.
 *
 * O ganho não é cosmético: com a derivação real, um teste pode dar a chave **do outro lado**
 * ao `dmFold` e ver a AEAD fechar, que é a propriedade de simetria de §31.3 regra 3. Com o
 * rótulo falso os dois lados batiam por construção, e isso é tautologia.
 */
function contentKeyOf(a: Keypair, b: Keypair, conversationKey: Buffer): Buffer {
  const k = dmContentKey(a.secretKey, b.publicKey, conversationKey);
  if (k === null) throw new Error('dmContentKey falhou');
  return k;
}

export function dmWorld(rotuloA = 'alice', rotuloB = 'bob'): DmWorld {
  const a = dmKeypair(rotuloA);
  const b = dmKeypair(rotuloB);
  const par = dmPairOrder(a.publicKey, b.publicKey);
  if (par === null) throw new Error('par inválido');
  const conversationKey = dmConversationKey(a.publicKey, b.publicKey);
  if (conversationKey === null) throw new Error('conversationKey inválido');

  const rotuloDe = (k: Buffer): string => (k.equals(a.publicKey) ? rotuloA : rotuloB);
  const lo: DmSide = {
    origin: 'lo',
    identity: par.lo.equals(a.publicKey) ? a : b,
    core: dmKeypair(`core-${rotuloDe(par.lo)}`),
    blobs: dmKeypair(`blobs-${rotuloDe(par.lo)}`),
  };
  const hi: DmSide = {
    origin: 'hi',
    identity: par.hi.equals(a.publicKey) ? a : b,
    core: dmKeypair(`core-${rotuloDe(par.hi)}`),
    blobs: dmKeypair(`blobs-${rotuloDe(par.hi)}`),
  };
  const contentKey = contentKeyOf(a, b, conversationKey);
  const conversationId = conversationKey.toString('hex');

  return {
    conversationKey,
    conversationId,
    contentKey,
    lo,
    hi,
    ctx: {
      conversationId,
      conversationKey,
      loKey: par.lo,
      hiKey: par.hi,
      contentKey,
      loCoreKey: lo.core.publicKey,
      hiCoreKey: hi.core.publicKey,
    },
    state: () => emptyDmState(conversationKey, par.lo, par.hi, conversationId),
    side: (o) => (o === 'lo' ? lo : hi),
  };
}

export type DmRecordOptions<K extends DmKindName> = {
  readonly kind: K;
  readonly payload: DmPayloadOf<K>;
  readonly authorSeq: number;
  readonly ack: number;
  readonly ts?: number;
  // Sabotagens, para os testes de estágio.
  readonly v?: number;
  readonly kindNumber?: number;
  readonly conversationKey?: Buffer;
  readonly author?: Buffer;
  readonly signWith?: Buffer;
  readonly contentKey?: Buffer;
  readonly corruptSig?: boolean;
};

/** Um registro pronto para o `dmFold`, assinado e cifrado como §31.4 manda. */
export function dmRecord<K extends DmKindName>(
  world: DmWorld,
  side: DmSide,
  o: DmRecordOptions<K>,
): Buffer {
  const header = {
    v: o.v ?? DM_VERSION,
    conversationId: o.conversationKey ?? world.conversationKey,
    kind: o.kindNumber ?? DM_KINDS[o.kind],
    author: o.author ?? side.identity.publicKey,
    authorSeq: o.authorSeq,
    ts: o.ts ?? DM_T0,
    ack: o.ack,
  };
  const plaintext = encodeDmPayload(o.kind, o.payload);
  const payload = sealDmPayload(o.contentKey ?? world.contentKey, header, plaintext);
  if (payload === null) throw new Error('sealDmPayload falhou');
  const opBytes = encodeDmOp({ ...header, payload });
  const sig = sign(o.signWith ?? side.identity.secretKey, dmOpSigningHash(opBytes));
  if (o.corruptSig === true) sig[0] = sig[0] === 0 ? 1 : 0;
  return encodeDmEnvelope({ op: opBytes, sig });
}

/** RD-1 — a gênese daquele lado: `dm.hello` no índice 0, `authorSeq = 1`, `ack = 0`. */
export function dmHello(
  world: DmWorld,
  side: DmSide,
  extra: Partial<DmRecordOptions<'dm.hello'>> & { displayName?: string } = {},
): Buffer {
  const outro = side.origin === 'lo' ? world.hi : world.lo;
  const proof = sign(
    side.identity.secretKey,
    dmCorePossessionHash(world.conversationKey, side.core.publicKey),
  );
  return dmRecord(world, side, {
    kind: 'dm.hello',
    authorSeq: 1,
    ack: 0,
    ...extra,
    payload: {
      peerKey: outro.identity.publicKey,
      coreProof: proof,
      displayName: extra.displayName ?? `nome-${side.origin}`,
      avatarColor: 1,
      ...(extra.payload ?? {}),
    },
  } as DmRecordOptions<'dm.hello'>);
}
