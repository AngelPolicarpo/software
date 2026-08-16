/**
 * Cliente — a parte de §19.3 passo 2 que o gate precisa: consome `authorSeq`, monta a
 * `Op` (COM `communityId`), assina, calcula o `opId`.
 *
 * `authorSeq` (§7.5): contador monotonico ESTRITAMENTE CRESCENTE por
 * `(author, communityId)`. A regra e estritamente crescente, NAO densa — uma op recusada
 * antes do append QUEIMA o numero.
 *
 * Fora do escopo do POC-01: outbox durável, reconciliacao, backoff (isso e G4/POC-07).
 */
import { OP_VERSION } from '../protocol/constants.ts';
import {
  encodeOp,
  encodePayload,
  opIdOf,
  opSigningHash,
  type Envelope,
  type Payload,
} from '../codec/opCodec.ts';
import { keyPair, sign, type KeyPair } from '../crypto/index.ts';

export class Client {
  readonly name: string;
  readonly keys: KeyPair;
  readonly publicKeyHex: string;
  readonly communityKey: Buffer;
  /** proximo `authorSeq` a consumir */
  nextAuthorSeq = 1;

  constructor(name: string, communityKey: Buffer, keys: KeyPair = keyPair()) {
    this.name = name;
    this.keys = keys;
    this.publicKeyHex = keys.publicKey.toString('hex');
    this.communityKey = communityKey;
  }

  /** Monta e assina um envelope. Consome um `authorSeq`. */
  build(kind: number, payload: Payload, ts: number, opts?: { authorSeq?: number; communityKey?: Buffer }): Envelope {
    const authorSeq = opts?.authorSeq ?? this.nextAuthorSeq++;
    return this.buildRaw(kind, payload, ts, authorSeq, opts?.communityKey ?? this.communityKey);
  }

  /** Variante sem consumo de contador — usada pelo adversario e pelos testes de replay. */
  buildRaw(kind: number, payload: Payload, ts: number, authorSeq: number, communityKey: Buffer): Envelope {
    const opBytes = encodeOp({
      v: OP_VERSION,
      communityId: communityKey,
      kind,
      author: this.keys.publicKey,
      authorSeq,
      ts,
      payload: encodePayload(kind, payload),
    });
    const sig = sign(opSigningHash(opBytes), this.keys.secretKey);
    return { op: opBytes, sig };
  }

  /** Envelope com bytes de `op` arbitrarios (assinatura valida sobre lixo). */
  buildRawBytes(opBytes: Buffer): Envelope {
    return { op: opBytes, sig: sign(opSigningHash(opBytes), this.keys.secretKey) };
  }

  opId(env: Envelope): string {
    return opIdOf(env);
  }
}
