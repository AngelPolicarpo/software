// Registry de payload por `kind` — §7.4, sobre os primitivos de §7.2.1.
//
// O codec é **dirigido pela tabela**: `PAYLOAD_LAYOUT` guarda o layout na forma textual da
// spec, e tanto os tipos quanto o encode/decode saem dele. Não há uma segunda transcrição a
// manter sincronizada — mudar a linha muda o tipo, e código que dependia do campo antigo
// para de compilar.
//
// §4: `opCodec` **não pode validar semântica**. Aqui só se decide se os bytes casam o
// layout. Se o `channelId` existe, se o autor pode escrever nele, se o `u8` está na faixa
// de §9.1 — tudo isso é o `fold`.

import { PAYLOAD_LAYOUT, type KindName } from './kinds.ts';
import { Reader, Writer } from './wire.ts';

// ─── Tipos compostos de §7.2.1 e §7.4.1 ────────────────────────────────────────────────

/** §7.2.1: `key blobsCoreKey · u64 byteOffset · u64 blockOffset · u64 blockLength · u64 byteLength`. */
export type BlobRef = {
  blobsCoreKey: Buffer;
  byteOffset: number;
  blockOffset: number;
  blockLength: number;
  byteLength: number;
};

/** §7.4.1: "`attachment` completo: `blobref · str name · u64 sizeBytes · u8 kind · key hash`". */
export type Attachment = {
  blob: BlobRef;
  name: string;
  sizeBytes: number;
  kind: number;
  hash: Buffer;
};

// ─── Do layout textual para o tipo TypeScript ──────────────────────────────────────────

type Prim = {
  u8: number;
  u16: number;
  u32: number;
  u64: number;
  key: Buffer;
  sig: Buffer;
  str: string;
  /** §7.2.1: `id` e `rank` são `str` no fio; o tipo distinto é documentação. */
  id: string;
  rank: string;
  bool: boolean;
  bytes: Buffer;
  blobref: BlobRef;
  attachment: Attachment;
};

type TypeOf<S extends string> = S extends `opt<${infer I}>`
  ? TypeOf<I>
  : S extends `arr<${infer I}>`
    ? TypeOf<I>[]
    : S extends keyof Prim
      ? Prim[S]
      : never;

type OneField<F extends string> = F extends `${infer T} ${infer N}`
  ? T extends `opt<${string}>`
    ? { [K in N]?: TypeOf<T> }
    : { [K in N]: TypeOf<T> }
  : // eslint-disable-next-line @typescript-eslint/ban-types
    {};

type FieldsOf<S extends string> = S extends ''
  ? Record<never, never>
  : S extends `${infer F} · ${infer Rest}`
    ? OneField<F> & FieldsOf<Rest>
    : OneField<S>;

type Flatten<T> = { [K in keyof T]: T[K] } & unknown;

/** O payload de um `kind`, derivado da linha de §7.4. */
export type PayloadOf<K extends KindName> = Flatten<FieldsOf<(typeof PAYLOAD_LAYOUT)[K]>>;

// ─── Do layout textual para o codec ────────────────────────────────────────────────────

type Spec =
  | { t: 'prim'; name: keyof Prim }
  | { t: 'opt'; inner: Spec }
  | { t: 'arr'; inner: Spec };

const PRIMS = new Set<string>([
  'u8', 'u16', 'u32', 'u64', 'key', 'sig', 'str', 'id', 'rank', 'bool', 'bytes',
  'blobref', 'attachment',
]);

function parseType(s: string): Spec {
  if (s.startsWith('opt<') && s.endsWith('>')) return { t: 'opt', inner: parseType(s.slice(4, -1)) };
  if (s.startsWith('arr<') && s.endsWith('>')) return { t: 'arr', inner: parseType(s.slice(4, -1)) };
  if (!PRIMS.has(s)) throw new Error(`tipo desconhecido em §7.4: ${s}`);
  return { t: 'prim', name: s as keyof Prim };
}

export type Field = { name: string; spec: Spec; type: string };

/** Quebra `'id channelId · str content'` nos campos, na ordem declarada. */
export function parseLayout(layout: string): Field[] {
  if (layout === '') return [];
  return layout.split(' · ').map((f) => {
    const i = f.indexOf(' ');
    if (i < 0) throw new Error(`campo sem nome em §7.4: ${f}`);
    const type = f.slice(0, i);
    return { name: f.slice(i + 1), spec: parseType(type), type };
  });
}

/** Layouts já quebrados, uma vez, no carregamento do módulo. */
export const PAYLOAD_FIELDS: Record<KindName, Field[]> = Object.fromEntries(
  Object.entries(PAYLOAD_LAYOUT).map(([k, v]) => [k, parseLayout(v)]),
) as Record<KindName, Field[]>;

function writeBlobRef(w: Writer, v: BlobRef): void {
  w.key(v.blobsCoreKey).u64(v.byteOffset).u64(v.blockOffset).u64(v.blockLength).u64(v.byteLength);
}

function readBlobRef(r: Reader): BlobRef {
  return {
    blobsCoreKey: r.key(),
    byteOffset: r.u64(),
    blockOffset: r.u64(),
    blockLength: r.u64(),
    byteLength: r.u64(),
  };
}

function writeValue(w: Writer, spec: Spec, v: unknown): void {
  if (spec.t === 'opt') {
    w.opt(v as unknown, (ww, x) => writeValue(ww, spec.inner, x));
    return;
  }
  if (spec.t === 'arr') {
    w.arr(v as unknown[], (ww, x) => writeValue(ww, spec.inner, x));
    return;
  }
  switch (spec.name) {
    case 'u8': w.u8(v as number); return;
    case 'u16': w.u16(v as number); return;
    case 'u32': w.u32(v as number); return;
    case 'u64': w.u64(v as number); return;
    case 'key': w.key(v as Uint8Array); return;
    case 'sig': w.sig(v as Uint8Array); return;
    case 'str':
    case 'id':
    case 'rank': w.str(v as string); return;
    case 'bool': w.bool(v as boolean); return;
    case 'bytes': w.bytes(v as Uint8Array); return;
    case 'blobref': writeBlobRef(w, v as BlobRef); return;
    case 'attachment': {
      const a = v as Attachment;
      writeBlobRef(w, a.blob);
      w.str(a.name).u64(a.sizeBytes).u8(a.kind).key(a.hash);
      return;
    }
  }
}

function readValue(r: Reader, spec: Spec): unknown {
  if (spec.t === 'opt') return r.opt((rr) => readValue(rr, spec.inner));
  if (spec.t === 'arr') return r.arr((rr) => readValue(rr, spec.inner));
  switch (spec.name) {
    case 'u8': return r.u8();
    case 'u16': return r.u16();
    case 'u32': return r.u32();
    case 'u64': return r.u64();
    case 'key': return r.key();
    case 'sig': return r.sig();
    case 'str':
    case 'id':
    case 'rank': return r.str();
    case 'bool': return r.bool();
    case 'bytes': return r.bytes();
    case 'blobref': return readBlobRef(r);
    case 'attachment': {
      const blob = readBlobRef(r);
      return { blob, name: r.str(), sizeBytes: r.u64(), kind: r.u8(), hash: r.key() };
    }
  }
}

/** Serializa o payload na ordem de §7.4. Forma canônica: opcional ausente escreve só o byte 0. */
export function encodePayload<K extends KindName>(kind: K, v: PayloadOf<K>): Buffer {
  const w = new Writer();
  const rec = v as Record<string, unknown>;
  for (const f of PAYLOAD_FIELDS[kind]) writeValue(w, f.spec, rec[f.name]);
  return w.toBuffer();
}

/**
 * Decodifica o payload de um `kind` conhecido. Devolve `null` quando os bytes não casam o
 * layout — o estágio 2 de §8.2 mapeia isso para `IGNORED` / `E_MALFORMED`. Bytes sobrando
 * no fim são ignorados (§7.2 regra 2, leitor tolerante). **Nunca lança** (§8.5).
 */
export function decodePayload<K extends KindName>(kind: K, buf: Uint8Array): PayloadOf<K> | null {
  const r = new Reader(buf);
  const out: Record<string, unknown> = {};
  for (const f of PAYLOAD_FIELDS[kind]) {
    const v = readValue(r, f.spec);
    if (r.failed) return null;
    // Opcional ausente não vira chave: `{}` e `{x: undefined}` não podem divergir no fold.
    if (v !== undefined) out[f.name] = v;
  }
  return r.failed ? null : (out as PayloadOf<K>);
}
