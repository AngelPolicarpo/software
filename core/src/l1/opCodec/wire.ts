// Primitivos do registry — §7.2.1. Formato de fio idêntico ao de `compact-encoding`.
//
// A implementação é própria por uma razão normativa: **o decodificador do `fold` não pode
// lançar** (§8.5). `compact-encoding` lança em buffer truncado; aqui truncamento liga
// `failed`, que o estágio 2 de §8.2 mapeia para `IGNORED` / `E_MALFORMED`. Uma exceção
// vinda do decode seria parada permanente e auto-reproduzível — a classe de bug que a
// totalidade de §8.5 existe para eliminar.
//
// | Tipo do registry | Encoding                                                     |
// |------------------|--------------------------------------------------------------|
// | u8/u16/u32/u64   | uint8/16/32/64, little-endian, largura fixa                  |
// | key              | fixed32                                                       |
// | sig              | fixed64                                                       |
// | str / id / rank  | string (uint prefixado, UTF-8)                               |
// | bool             | uint8 0/1                                                     |
// | opt<T>           | uint8 presente(1)/ausente(0), seguido de T quando presente    |
// | arr<T>           | uint de contagem, seguido de T repetido                       |
// | bytes            | buffer (uint prefixado)                                       |

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Buffer de descarte devolvido por leitura fora de limite. **Nenhuma leitura inválida
 * aloca.**
 *
 * O fuzzer de G1 achou o inverso disto na primeira versão do harness: devolver
 * `Buffer.alloc(n)` com o `n` *pedido* fazia um prefixo hostil (`uint` = 2³²−1) alocar 4 GiB
 * antes de concluir que a entrada é malformada. Não viola a totalidade de §8.5, mas é
 * negação de serviço trivial contra qualquer réplica, e §8.2 não tem estágio de teto de
 * bytes antes do decode.
 */
const SCRATCH = Buffer.alloc(64);

export class Writer {
  #chunks: Buffer[] = [];
  #len = 0;

  #push(b: Buffer): this {
    this.#chunks.push(b);
    this.#len += b.length;
    return this;
  }

  u8(n: number): this {
    const b = Buffer.allocUnsafe(1);
    b.writeUInt8(n & 0xff);
    return this.#push(b);
  }

  u16(n: number): this {
    const b = Buffer.allocUnsafe(2);
    b.writeUInt16LE(n & 0xffff);
    return this.#push(b);
  }

  u32(n: number): this {
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32LE(n >>> 0);
    return this.#push(b);
  }

  u64(n: number | bigint): this {
    const b = Buffer.allocUnsafe(8);
    b.writeBigUInt64LE(BigInt(n));
    return this.#push(b);
  }

  /** `uint` de largura variável de `compact-encoding` — o prefixo de `str`/`arr`/`bytes`. */
  uint(n: number): this {
    if (n < 0xfd) return this.u8(n);
    if (n <= 0xffff) return this.u8(0xfd).u16(n);
    if (n <= 0xffffffff) return this.u8(0xfe).u32(n);
    return this.u8(0xff).u64(n);
  }

  fixed(b: Uint8Array, n: number): this {
    const buf = Buffer.alloc(n);
    Buffer.from(b.buffer, b.byteOffset, Math.min(b.length, n)).copy(buf);
    return this.#push(buf);
  }

  key(b: Uint8Array): this {
    return this.fixed(b, 32);
  }

  sig(b: Uint8Array): this {
    return this.fixed(b, 64);
  }

  bytes(b: Uint8Array): this {
    this.uint(b.length);
    return this.#push(Buffer.from(b.buffer, b.byteOffset, b.length));
  }

  str(s: string): this {
    return this.bytes(Buffer.from(s, 'utf8'));
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }

  /** §7.2.1: campo opcional ausente escreve só o byte de presença — forma canônica (§7.2). */
  opt<T>(v: T | undefined | null, write: (w: Writer, v: T) => void): this {
    if (v === undefined || v === null) return this.u8(0);
    this.u8(1);
    write(this, v);
    return this;
  }

  arr<T>(items: readonly T[], write: (w: Writer, v: T) => void): this {
    this.uint(items.length);
    for (const it of items) write(this, it);
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.#chunks, this.#len);
  }
}

/**
 * Leitor total: **nenhuma leitura lança**. Fora de limite liga `failed` e devolve valor
 * neutro; quem chama consulta `failed` no fim.
 */
export class Reader {
  readonly buf: Buffer;
  offset: number;
  failed = false;

  constructor(buf: Uint8Array, offset = 0) {
    this.buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.length);
    this.offset = offset;
  }

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  #need(n: number): boolean {
    if (this.failed) return false;
    if (n < 0 || this.offset + n > this.buf.length) {
      this.failed = true;
      return false;
    }
    return true;
  }

  u8(): number {
    if (!this.#need(1)) return 0;
    return this.buf.readUInt8(this.offset++);
  }

  u16(): number {
    if (!this.#need(2)) return 0;
    const v = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }

  u32(): number {
    if (!this.#need(4)) return 0;
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  /**
   * `u64` → `number`. Acima de `Number.MAX_SAFE_INTEGER` liga `failed`: são carimbos e
   * tamanhos fisicamente impossíveis, e a alternativa — aritmética `BigInt` em todo o
   * `fold` — não muda desfecho nenhum, porque todo limite de §8.6 e §27.1 está muito
   * abaixo de 2⁵³.
   */
  u64(): number {
    if (!this.#need(8)) return 0;
    const v = this.buf.readBigUInt64LE(this.offset);
    this.offset += 8;
    if (v > MAX_SAFE) {
      this.failed = true;
      return 0;
    }
    return Number(v);
  }

  uint(): number {
    const t = this.u8();
    if (this.failed) return 0;
    if (t < 0xfd) return t;
    if (t === 0xfd) return this.u16();
    if (t === 0xfe) return this.u32();
    return this.u64();
  }

  fixed(n: number): Buffer {
    if (!this.#need(n)) return SCRATCH.subarray(0, Math.min(Math.max(n, 0), SCRATCH.length));
    const v = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }

  key(): Buffer {
    return this.fixed(32);
  }

  sig(): Buffer {
    return this.fixed(64);
  }

  bytes(): Buffer {
    const n = this.uint();
    if (this.failed) return SCRATCH.subarray(0, 0);
    // Teto barato ANTES de alocar: o prefixo nunca pode prometer mais bytes do que restam.
    // §7.2 regra 2 tolera sobra no FIM do payload, não prefixo mentiroso no meio.
    if (n > this.remaining) {
      this.failed = true;
      return SCRATCH.subarray(0, 0);
    }
    return this.fixed(n);
  }

  /** UTF-8 estrito: sequência inválida liga `failed`, senão o `opId` deixaria de ser determinístico. */
  str(): string {
    const b = this.bytes();
    if (this.failed) return '';
    const s = b.toString('utf8');
    if (!Buffer.from(s, 'utf8').equals(b)) {
      this.failed = true;
      return '';
    }
    return s;
  }

  /** §7.2.1: `bool` é `uint8` 0/1. Qualquer outro valor é malformado. */
  bool(): boolean {
    const v = this.u8();
    if (this.failed) return false;
    if (v > 1) {
      this.failed = true;
      return false;
    }
    return v === 1;
  }

  opt<T>(read: (r: Reader) => T): T | undefined {
    const p = this.u8();
    if (this.failed) return undefined;
    if (p === 0) return undefined;
    if (p !== 1) {
      this.failed = true;
      return undefined;
    }
    return read(this);
  }

  /**
   * `arr<T>`. A contagem é conferida contra os bytes restantes antes de alocar, para que um
   * `uint` hostil não vire alocação gigante: o `fold` precisa ser total **e barato** sob
   * entrada hostil.
   */
  arr<T>(read: (r: Reader) => T, minBytesPerItem = 1): T[] {
    const n = this.uint();
    if (this.failed) return [];
    if (n * minBytesPerItem > this.remaining) {
      this.failed = true;
      return [];
    }
    const out: T[] = [];
    for (let i = 0; i < n; i++) {
      const v = read(this);
      if (this.failed) return [];
      out.push(v);
    }
    return out;
  }
}
