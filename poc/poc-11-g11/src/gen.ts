// Gerador determinístico de casos de fuzzing (POC-11 / §13.6, §8.6).
// PRNG com semente fixa: o gate é reproduzível com a mesma semente.

export type Fmt = 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'zip' | 'pe';

export interface FuzzCase {
  cat: string;
  name: string;
  magic: Fmt;
}

const INLINE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;
const OTHER_EXTS = ['pdf', 'txt', 'mp4', 'mp3', 'zip', 'bin', 'docx', 'html', 'svg', 'tar.gz'] as const;
export const EXECUTABLE_EXTS = [
  'exe', 'bat', 'cmd', 'com', 'scr', 'ps1', 'sh', 'msi', 'dll', 'app', 'pkg', 'dmg', 'deb', 'rpm', 'jar', 'vbs', 'js', 'wsf', 'lnk',
] as const;
const RESERVED = ['CON', 'PRN', 'AUX', 'NUL', ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)] as const;

function magicFor(fmt: Fmt): Buffer {
  switch (fmt) {
    case 'png':
      return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0x00, 0x00, 0x00, 0x0d]), Buffer.from('IHDR', 'ascii'), Buffer.alloc(13), Buffer.from([0xde, 0xad, 0xbe, 0xef])]);
    case 'jpeg':
      return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'ascii'), Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]), Buffer.from([0xff, 0xd9])]);
    case 'gif':
      return Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.from([0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00]), Buffer.alloc(8)]);
    case 'webp':
      return Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.from('WEBPVP8 ', 'ascii'), Buffer.alloc(10)]);
    case 'pdf':
      return Buffer.concat([Buffer.from('%PDF-1.7\n%', 'ascii'), Buffer.alloc(6)]);
    case 'zip':
      return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(12)]);
    case 'pe':
      return Buffer.concat([Buffer.from('MZ', 'ascii'), Buffer.alloc(14), Buffer.from([0x40, 0x00]), Buffer.from('PE\0\0', 'ascii')]);
  }
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Muta um header válido: truncamento, byte flip, length estourado, junk duplicado ou cauda aleatória. */
function mutate(header: Buffer, rnd: () => number): Buffer {
  const kind = Math.floor(rnd() * 5);
  const buf = Buffer.from(header);
  switch (kind) {
    case 0:
      return buf.subarray(0, Math.max(1, Math.floor(rnd() * buf.length))); // truncado
    case 1: {
      const pos = Math.floor(rnd() * buf.length);
      buf[pos] = (buf[pos] ?? 0) ^ (1 << Math.floor(rnd() * 8));
      return buf;
    }
    case 2: {
      const pos = Math.floor(rnd() * Math.max(1, buf.length - 4));
      buf.writeUInt32LE(0xffffffff, pos); // campo de tamanho estourado
      return buf;
    }
    case 3:
      return Buffer.concat([buf, buf.subarray(0, Math.floor(rnd() * buf.length)), Buffer.alloc(Math.floor(rnd() * 32), 0x41)]); // duplicado/junk
    default:
      return Buffer.concat([buf, Buffer.alloc(Math.floor(rnd() * 64), Math.floor(rnd() * 256))]); // cauda aleatória
  }
}

const UNICODE_JUNK = ['émoji😀', '中文', '\u200bzwsp', '\u202ertl', 'café', '\uFEFF', 'ß', '​'];

export class CaseGenerator {
  readonly #rnd: () => number;
  constructor(seed: number) {
    this.#rnd = mulberry32(seed);
  }

  private pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.#rnd() * arr.length)]!;
  }

  /** Conteúdo malformado para gravação em disco (amostragem de filesystem). */
  contentFor(c: FuzzCase): Buffer {
    return mutate(magicFor(c.magic), this.#rnd);
  }

  next(): FuzzCase {
    const r = this.#rnd();
    // distribuição fixa por categoria
    if (r < 0.25) return this.malformedInline();
    if (r < 0.40) return this.swappedExt();
    if (r < 0.50) return this.traversal();
    if (r < 0.60) return this.reserved();
    if (r < 0.65) return this.trailingDotSpace();
    if (r < 0.75) return this.executableBlocklist();
    if (r < 0.80) return this.controlCharsUnicode();
    if (r < 0.85) return this.oversizeNames();
    if (r < 0.87) return this.emptyAndDots();
    return this.randomNoise();
  }

  private extName(ext: string): string {
    const stem = `arq-${Math.floor(this.#rnd() * 1e9).toString(36)}`;
    const cased = this.#rnd() < 0.3 ? ext.toUpperCase() : ext;
    return `${stem}.${cased}`;
  }

  private malformedInline(): FuzzCase {
    const fmt = this.pick<Fmt>(['png', 'jpeg', 'gif', 'webp']);
    const ownExt = fmt === 'jpeg' ? this.pick(['jpg', 'jpeg']) : fmt;
    // 80% extensão do próprio formato; 20% trocada (conteúdo X nomeado Y)
    const ext = this.#rnd() < 0.8 ? ownExt : this.pick([...INLINE_EXTS, ...OTHER_EXTS]);
    return { cat: 'malformedInline', name: this.extName(ext), magic: fmt };
  }

  private swappedExt(): FuzzCase {
    const fmt = this.pick<Fmt>(['png', 'jpeg', 'gif', 'webp', 'pdf', 'zip', 'pe']);
    const ext = this.pick([...INLINE_EXTS, ...OTHER_EXTS, ...EXECUTABLE_EXTS]);
    return { cat: 'swappedExt', name: this.extName(ext), magic: fmt };
  }

  private traversal(): FuzzCase {
    const templates = [
      `../evil${this.pick(['.png', '.exe', '.txt'])}`,
      '..\\..\\win.png',
      '/etc/passwd.png',
      'C:\\Windows\\evil.exe',
      '\\\\srv\\share\\img.png',
      'sub/dir/foto.png',
      '....//....//x.png',
      'foo/../bar.png',
      'x/./y.png',
      'dir\\sub\\v.webp',
      `..%2F..%2Fpayload${this.pick(['.png', '.js'])}`, // % literal — não é separador; nome válido por §8.6
      'nul\\con.png',
    ];
    return { cat: 'traversal', name: this.pick(templates), magic: this.pick<Fmt>(['png', 'pe']) };
  }

  private reserved(): FuzzCase {
    const base = this.pick(RESERVED);
    const suffix = this.pick(['', '.txt', '.png', '.exe', '.tar.gz']);
    const cased = this.#rnd() < 0.5 ? base.toLowerCase() : base;
    return { cat: 'reserved', name: `${cased}${suffix}`, magic: this.pick<Fmt>(['png', 'pe']) };
  }

  private trailingDotSpace(): FuzzCase {
    const stem = `foto-${Math.floor(this.#rnd() * 1e6)}`;
    const tail = this.pick(['.', ' ', '..', '...', '. .', '.\u00a0', '.\t']);
    return { cat: 'trailingDotSpace', name: `${stem}.png${tail}`, magic: 'png' };
  }

  private executableBlocklist(): FuzzCase {
    const ext = this.pick(EXECUTABLE_EXTS);
    const name = this.#rnd() < 0.25 ? `foto.png.${ext}` : this.extName(ext); // extensão dupla também é executável
    return { cat: 'executableBlocklist', name, magic: 'pe' };
  }

  private controlCharsUnicode(): FuzzCase {
    const kind = Math.floor(this.#rnd() * 4);
    const stem = `ctl-${Math.floor(this.#rnd() * 1e6)}`;
    let name: string;
    if (kind === 0) name = `${stem}\u0000.png`; // NUL embutido
    else if (kind === 1) name = `${stem}\u0007\u001b.png`; // controle C0
    else if (kind === 2) name = `${this.pick(UNICODE_JUNK)}.png`; // unicode legítimo — válido
    else name = `${stem}\u007f.png`; // DEL
    return { cat: 'controlCharsUnicode', name, magic: 'png' };
  }

  private oversizeNames(): FuzzCase {
    const kind = Math.floor(this.#rnd() * 3);
    if (kind === 0) return { cat: 'oversizeNames', name: `${'a'.repeat(251)}.png`, magic: 'png' }; // 255 bytes — fronteira válida
    if (kind === 1) return { cat: 'oversizeNames', name: `${'a'.repeat(252)}.png`, magic: 'png' }; // 256 bytes — inválido
    return { cat: 'oversizeNames', name: `${'x'.repeat(1024)}${this.pick(['.png', '.exe', ''])}`, magic: 'png' };
  }

  private emptyAndDots(): FuzzCase {
    return { cat: 'emptyAndDots', name: this.pick(['', '.', '..', '...', '.png']), magic: 'png' };
  }

  private randomNoise(): FuzzCase {
    const len = 1 + Math.floor(this.#rnd() * 40);
    let s = '';
    for (let i = 0; i < len; i++) {
      const r = this.#rnd();
      if (r < 0.55) s += String.fromCharCode(0x21 + Math.floor(this.#rnd() * 0x5e));
      else if (r < 0.65) s += this.pick(['/', '\\', '.', ':', '*', '?', '"', '<', '>', '|']);
      else if (r < 0.75) s += String.fromCharCode(Math.floor(this.#rnd() * 0x20));
      else s += this.pick(UNICODE_JUNK);
    }
    if (this.#rnd() < 0.7) s += `.${this.pick([...INLINE_EXTS, ...OTHER_EXTS, ...EXECUTABLE_EXTS])}`;
    return { cat: 'randomNoise', name: s, magic: this.pick<Fmt>(['png', 'jpeg', 'webp', 'pe']) };
  }
}
