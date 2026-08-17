// Tipagem estreita das dependências nativas que o núcleo usa. Declara só o que é chamado —
// um `any` global esconderia exatamente os erros de tamanho de buffer que a criptografia de
// §5.1 não perdoa.

declare module 'sodium-native' {
  /**
   * BLAKE2b sobre a concatenação de `parts`. O comprimento da saída é o de `out`:
   * 32 bytes para BLAKE2b-256, 16 para BLAKE2b-128 (§5.1). O parâmetro de comprimento faz
   * parte do bloco de parâmetros do BLAKE2b — truncar um digest de 64 bytes **não** produz
   * o mesmo valor.
   */
  export function crypto_generichash_batch(out: Buffer, parts: Uint8Array[]): void;
  export function crypto_generichash(out: Buffer, input: Uint8Array, key?: Uint8Array): void;

  export function randombytes_buf(out: Buffer): void;

  export const crypto_sign_PUBLICKEYBYTES: number;
  export const crypto_sign_SECRETKEYBYTES: number;
  export const crypto_sign_BYTES: number;
  export function crypto_sign_seed_keypair(pk: Buffer, sk: Buffer, seed: Uint8Array): void;
  export function crypto_sign_detached(sig: Buffer, message: Uint8Array, sk: Uint8Array): void;
  export function crypto_sign_verify_detached(
    sig: Uint8Array,
    message: Uint8Array,
    pk: Uint8Array,
  ): boolean;
}

declare module 'hypercore' {
  import { EventEmitter } from 'node:events';

  export type HypercoreKeyPair = { publicKey: Buffer; secretKey: Buffer };

  export type HypercoreOptions = {
    /** Chave pública do core. Sem ela, um novo core é criado. */
    key?: Buffer;
    /** Par de chaves do core. Em modo `compat`, `key` precisa casar com `publicKey`. */
    keyPair?: HypercoreKeyPair;
    /** Modo de assinatura clássico: `key` é a própria chave pública (não o hash do manifest). */
    compat?: boolean;
    createIfMissing?: boolean;
  };

  export default class Hypercore extends EventEmitter {
    constructor(storage: string, opts?: HypercoreOptions);
    constructor(storage: string, key?: Buffer | null, opts?: HypercoreOptions);

    /** Chave pública do core (hash do manifest, ou a própria chave em modo `compat`). */
    readonly key: Buffer | null;
    readonly length: number;
    readonly writable: boolean;
    readonly closed: boolean;

    ready(): Promise<void>;
    append(value: Uint8Array): Promise<number>;
    /**
     * Bloco `seq`. Com `{ wait: false }`, devolve `null` quando o bloco ainda não está
     * disponível (replicação em curso) — é o contrato de leitura do projector (§10.5).
     */
    get(seq: number, opts?: { wait?: boolean }): Promise<Buffer | null>;
    on(event: 'append', listener: () => void): this;
    off(event: 'append', listener: () => void): this;
    close(): Promise<void>;
  }
}
