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
  export function sodium_memzero(buf: Buffer): void;

  export const crypto_sign_PUBLICKEYBYTES: number;
  export const crypto_sign_SECRETKEYBYTES: number;
  export const crypto_sign_BYTES: number;
  export const crypto_sign_SEEDBYTES: number;
  export function crypto_sign_seed_keypair(pk: Buffer, sk: Buffer, seed: Uint8Array): void;
  export function crypto_sign_detached(sig: Buffer, message: Uint8Array, sk: Uint8Array): void;
  export function crypto_sign_verify_detached(
    sig: Uint8Array,
    message: Uint8Array,
    pk: Uint8Array,
  ): boolean;

  // ── Sealed box (§18.8 escrow de sucessão) — Ed25519 → X25519 + crypto_box_seal ──────
  export const crypto_box_PUBLICKEYBYTES: number;
  export const crypto_box_SECRETKEYBYTES: number;
  export const crypto_box_SEALBYTES: number;
  /** Converte a chave pública Ed25519 para X25519 — `crypto_box_seal(communitySeed, x25519(targetKey))`. */
  export function crypto_sign_ed25519_pk_to_curve25519(curvePk: Buffer, edPk: Uint8Array): number;
  /** Converte a chave secreta Ed25519 para X25519 — abre o próprio escrow. */
  export function crypto_sign_ed25519_sk_to_curve25519(curveSk: Buffer, edSk: Uint8Array): number;
  export function crypto_box_seal(out: Buffer, message: Uint8Array, curvePk: Uint8Array): number;
  /** Devolve `true` em sucesso; `false` com selo adulterado ou chave errada. */
  export function crypto_box_seal_open(out: Buffer, sealed: Uint8Array, curvePk: Uint8Array, curveSk: Uint8Array): boolean;


  export const crypto_aead_xchacha20poly1305_ietf_KEYBYTES: number;
  export const crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: number;
  export const crypto_aead_xchacha20poly1305_ietf_ABYTES: number;
  export function crypto_aead_xchacha20poly1305_ietf_encrypt(
    cipher: Buffer,
    message: Uint8Array,
    additionalData: Uint8Array | null,
    nsec: Uint8Array | null,
    nonce: Uint8Array,
    key: Uint8Array,
  ): void;
  export function crypto_aead_xchacha20poly1305_ietf_decrypt(
    message: Buffer,
    nsec: Uint8Array | null,
    cipher: Uint8Array,
    additionalData: Uint8Array | null,
    nonce: Uint8Array,
    key: Uint8Array,
  ): boolean;

  export const crypto_pwhash_SALTBYTES: number;
  export const crypto_pwhash_OPSLIMIT_MODERATE: number;
  export const crypto_pwhash_MEMLIMIT_MODERATE: number;
  export const crypto_pwhash_ALG_DEFAULT: number;
  export function crypto_pwhash(
    out: Buffer,
    passwd: Uint8Array,
    salt: Uint8Array,
    opsLimit: number,
    memLimit: number,
    alg: number,
  ): void;

  /** `crypto_auth` é HMAC-SHA-256 — usado na credencial TURN de curta duração (§17.3). */
  export const crypto_auth_BYTES: number;
  export const crypto_auth_KEYBYTES: number;
  export function crypto_auth(out: Buffer, message: Uint8Array, key: Uint8Array): void;
  export function crypto_auth_verify(tag: Uint8Array, message: Uint8Array, key: Uint8Array): boolean;
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
