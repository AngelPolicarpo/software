/**
 * Primitivos do registry — backend-v2.md §7.2.1.
 *
 * Formato de fio IDENTICO ao de `compact-encoding` (provado byte a byte em
 * scripts/run-unit.ts, conformance suite). A implementacao e propria por uma razao
 * normativa: o decodificador do `fold` NAO PODE LANCAR (§8.5). `compact-encoding` lanca
 * em buffer truncado; aqui truncamento vira `reader.failed = true`, que o estagio 2 de
 * §8.2 mapeia para `IGNORED` / `E_MALFORMED`.
 *
 * | Tipo do registry | Encoding                                              |
 * |------------------|-------------------------------------------------------|
 * | u8/u16/u32/u64   | uint8/16/32/64, little-endian (largura fixa)          |
 * | key              | fixed32                                                |
 * | sig              | fixed64                                                |
 * | str / id / rank  | string (uint prefixado, UTF-8)                        |
 * | bool             | uint8 0/1                                              |
 * | opt<T>           | uint8 presente(1)/ausente(0) seguido de T quando presente |
 * | arr<T>           | uint de contagem seguido de T repetido                 |
 * | bytes            | buffer (uint prefixado)                                |
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Buffer de descarte devolvido por leitura fora de limite.
 *
 * ACHADO DO PROPRIO FUZZER (ver REPORT.md, ACHADO-01): a primeira versao devolvia
 * `Buffer.alloc(n)` com o `n` PEDIDO. Um prefixo de tamanho hostil (`uint` = 2^32-1)
 * fazia o `fold` alocar 4 GiB antes de concluir que a entrada e malformada — nao viola
 * a totalidade de §8.5, mas e negacao de servico trivial contra qualquer replica, e a
 * spec nao tem estagio de teto de bytes antes do decode (ver HOLE-04). Nenhuma leitura
 * fora de limite aloca coisa nenhuma agora.
 */
const SCRATCH = Buffer.alloc(64);

export class Writer {
  private chunks: Buffer[] = [];
  private len = 0;

  private push(b: Buffer): void {
    this.chunks.push(b);
    this.len += b.length;
  }

  u8(n: number): this {
    const b = Buffer.allocUnsafe(1);
    b.writeUInt8(n & 0xff, 0);
    return this.push(b), this;
  }

  u16(n: number): this {
    const b = Buffer.allocUnsafe(2);
    b.writeUInt16LE(n & 0xffff, 0);
    return this.push(b), this;
  }

  u32(n: number): this {
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32LE(n >>> 0, 0);
    return this.push(b), this;
  }

  u64(n: number | bigint): this {
    const b = Buffer.allocUnsafe(8);
    b.writeBigUInt64LE(BigInt(n), 0);
    return this.push(b), this;
  }

  /** `uint` de comprimento variavel de compact-encoding (prefixo de str/arr/bytes). */
  uint(n: number): this {
    if (n < 0xfd) return this.u8(n);
    if (n <= 0xffff) return this.u8(0xfd).u16(n);
    if (n <= 0xffffffff) return this.u8(0xfe).u32(n);
    return this.u8(0xff).u64(n);
  }

  fixed(b: Uint8Array, n: number): this {
    const buf = Buffer.alloc(n);
    Buffer.from(b.buffer, b.byteOffset, Math.min(b.length, n)).copy(buf);
    return this.push(buf), this;
  }

  key(b: Uint8Array): this {
    return this.fixed(b, 32);
  }

  sig(b: Uint8Array): this {
    return this.fixed(b, 64);
  }

  bytes(b: Uint8Array): this {
    this.uint(b.length);
    return this.push(Buffer.from(b.buffer, b.byteOffset, b.length)), this;
  }

  str(s: string): this {
    return this.bytes(Buffer.from(s, 'utf8'));
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }

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
    return Buffer.concat(this.chunks, this.len);
  }
}

/**
 * Leitor total: nenhuma leitura lanca. Toda leitura fora de limite liga `failed` e
 * devolve um valor neutro; o chamador consulta `failed` no fim.
 */
export class Reader {
  readonly buf: Buffer;
  offset: number;
  failed: boolean;

  constructor(buf: Uint8Array, offset = 0) {
    this.buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.length);
    this.offset = offset;
    this.failed = false;
  }

  private need(n: number): boolean {
    if (this.failed) return false;
    if (n < 0 || this.offset + n > this.buf.length) {
      this.failed = true;
      return false;
    }
    return true;
  }

  u8(): number {
    if (!this.need(1)) return 0;
    return this.buf.readUInt8(this.offset++);
  }

  u16(): number {
    if (!this.need(2)) return 0;
    const v = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }

  u32(): number {
    if (!this.need(4)) return 0;
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  /**
   * u64 -> Number. Valores acima de `Number.MAX_SAFE_INTEGER` marcam `failed`
   * (ASSUMPTION-08 no REPORT.md): sao carimbos de tempo/tamanhos fisicamente
   * impossiveis, e a alternativa — aritmetica BigInt em todo o `fold` — nao muda
   * nenhum desfecho porque todo limite de §8.6/§27.1 esta muito abaixo de 2^53.
   */
  u64(): number {
    if (!this.need(8)) return 0;
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
    if (!this.need(n)) return SCRATCH.subarray(0, Math.min(Math.max(n, 0), SCRATCH.length));
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
    // Teto barato ANTES de qualquer alocacao: o prefixo nunca pode prometer mais bytes
    // do que restam no buffer (§7.2 regra 2 e leitor tolerante no FIM, nao no meio).
    if (n > this.remaining) {
      this.failed = true;
      return SCRATCH.subarray(0, 0);
    }
    return this.fixed(n);
  }

  /** UTF-8 estrito: sequencia invalida marca `failed` (determinismo do `opId`). */
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

  /** §7.2.1: `bool` e `uint8` 0/1. Qualquer outro valor e malformado (ASSUMPTION-10). */
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
   * `arr<T>`. A contagem e checada contra os bytes restantes antes de alocar, para que
   * um `uint` hostil (ex.: 2^32-1) nao vire alocacao gigante — o `fold` precisa ser
   * total E barato para entrada hostil (§8.2, nota sobre estagios 1-7).
   */
  arr<T>(read: (r: Reader) => T, minBytesPerItem = 1): T[] {
    const n = this.uint();
    if (this.failed) return [];
    if (n > Number.MAX_SAFE_INTEGER || n * minBytesPerItem > this.buf.length - this.offset) {
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

  get remaining(): number {
    return this.buf.length - this.offset;
  }
}
