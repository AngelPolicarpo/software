/**
 * Host ADVERSARIO — POC-01, linha "Construir": um segundo binario de host capaz de
 * appendar registros arbitrarios SEM PASSAR PELA ADMISSAO. E o teste de §1.4 e §28.5:
 *
 *   "O host nao consegue fabricar efeito nao autorizado. Se o host appendar um registro
 *    que a funcao rejeita, a funcao rejeita em toda replica — INCLUSIVE NA DELE. O
 *    ataque vira ruido contado no `seq`." (§1.2)
 *
 * O adversario detem a chave do core (e o host legitimo rodando codigo modificado), logo
 * suas `hostSig` sao VALIDAS. E exatamente por isso que o teste importa: o que o protege
 * nao e a assinatura do host, e o `fold`.
 */
import Hypercore from 'hypercore';
import { encodeEnvelope, encodeHostRecord, hostRecSigningHash, type Envelope } from '../codec/opCodec.ts';
import { sign } from '../crypto/index.ts';

export class AdversaryHost {
  readonly core: Hypercore;
  readonly keyPair: { publicKey: Buffer; secretKey: Buffer };

  constructor(core: Hypercore, keyPair: { publicKey: Buffer; secretKey: Buffer }) {
    this.core = core;
    this.keyPair = keyPair;
  }

  /** Appenda um envelope com `hostSig` valida, sem qualquer validacao previa. */
  async appendRaw(envelope: Envelope, hostTs: number, flags = 0): Promise<number> {
    const envBytes = encodeEnvelope(envelope);
    const hostSig = sign(hostRecSigningHash(envBytes, hostTs, flags), this.keyPair.secretKey);
    const rec = encodeHostRecord({ envelope: envBytes, hostTs, flags, hostSig });
    const seq = this.core.length;
    await this.core.append(rec);
    await flushCore(this.core);
    return seq;
  }

  /** Appenda com `hostSig` DELIBERADAMENTE INVALIDA (§28.5, `hostTs` reescrito). */
  async appendBadHostSig(envelope: Envelope, hostTs: number, flags = 0): Promise<number> {
    const envBytes = encodeEnvelope(envelope);
    // Assina sobre um `hostTs` diferente do que vai no registro: e o que acontece quando
    // um host tenta reescrever o carimbo depois de assinar.
    const hostSig = sign(hostRecSigningHash(envBytes, hostTs + 1, flags), this.keyPair.secretKey);
    const rec = encodeHostRecord({ envelope: envBytes, hostTs, flags, hostSig });
    const seq = this.core.length;
    await this.core.append(rec);
    await flushCore(this.core);
    return seq;
  }

  /** Appenda bytes arbitrarios (nem sequer um `HostRecord`). */
  async appendBytes(bytes: Uint8Array): Promise<number> {
    const seq = this.core.length;
    await this.core.append(Buffer.from(bytes));
    await flushCore(this.core);
    return seq;
  }
}

/**
 * OBS-02 (REPORT.md) — A BARREIRA DE DURABILIDADE DE §10.7 NAO EXISTE COM ESSE NOME.
 *
 * §10.7 escreve: "`await core.append(...)` **e** `await core.flush()` antes de responder
 * | §11.4. `REQUIRES POC` — G4 confirma a primitiva exata do Hypercore 11."
 *
 * Medido em `hypercore@11.35.1`:
 *   - `Hypercore.prototype.flush` NAO EXISTE;
 *   - `core.state.flush()` existe mas e o flush de uma transacao de sessao/atom, e lanca
 *     `TypeError: Cannot read properties of null (reading 'flush')` quando nao ha
 *     transacao aberta — nao e barreira de durabilidade de append;
 *   - `await core.append(...)` sozinho ja sobrevive a `close()` + reabertura (verificado).
 *
 * O harness usa `append` como ponto de commit. G4 continua dono da questao: `append`
 * sobreviver a um `close()` limpo NAO prova que sobrevive a `SIGKILL` (§28.3).
 */
export async function flushCore(_core: unknown): Promise<void> {
  // no-op deliberado — ver acima.
}
