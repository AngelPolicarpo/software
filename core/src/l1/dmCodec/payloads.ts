// Registry de payload por `kind` de DM — §31.5, sobre os primitivos de §31.4/§7.2.1.
//
// O codec é **dirigido pela tabela**: `DM_PAYLOAD_LAYOUT` guarda o layout na forma textual
// da spec, e tanto os tipos quanto o encode/decode saem dele. Não há uma segunda transcrição
// a manter sincronizada — mudar a linha muda o tipo, e código que dependia do campo antigo
// para de compilar.
//
// §4: `dmCodec` **não pode validar semântica**. Aqui só se decide se os bytes casam o
// layout. Se a mensagem alvo existe, se o autor pode editá-la, se o `u8` está na faixa de
// §31.7.5 — tudo isso é o `dmFold`.

import { DM_PAYLOAD_LAYOUT, type DmKindName } from './kinds.ts';
import { Reader, Writer } from './wire.ts';

// ─── Tipos compostos de §7.2.1 e §31.5 ────────────────────────────────────────────────

/** §7.2.1: `key blobsCoreKey · u64 byteOffset · u64 blockOffset · u64 blockLength · u64 byteLength`. */
export type DmBlobRef = {
  blobsCoreKey: Buffer;
  byteOffset: number;
  blockOffset: number;
  blockLength: number;
  byteLength: number;
};

/** §31.5: "`attachment` completo: `blobref · str name · u64 sizeBytes · u8 kind · key hash`". */
export type DmAttachment = {
  blob: DmBlobRef;
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
  /** §7.2.1: `id` é `str` no fio; o tipo distinto é documentação. §31.4 não tem `rank`. */
  id: string;
  bool: boolean;
  bytes: Buffer;
  blobref: DmBlobRef;
  attachment: DmAttachment;
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

/** O payload de um `kind`, derivado da linha de §31.5. */
export type DmPayloadOf<K extends DmKindName> = Flatten<FieldsOf<(typeof DM_PAYLOAD_LAYOUT)[K]>>;

// ─── Do layout textual para o codec ────────────────────────────────────────────────────

type Spec =
  | { t: 'prim'; name: keyof Prim }
  | { t: 'opt'; inner: Spec }
  | { t: 'arr'; inner: Spec };

const PRIMS = new Set<string>([
  'u8', 'u16', 'u32', 'u64', 'key', 'sig', 'str', 'id', 'bool', 'bytes',
  'blobref', 'attachment',
]);

function parseType(s: string): Spec {
  if (s.startsWith('opt<') && s.endsWith('>')) return { t: 'opt', inner: parseType(s.slice(4, -1)) };
  if (s.startsWith('arr<') && s.endsWith('>')) return { t: 'arr', inner: parseType(s.slice(4, -1)) };
  if (!PRIMS.has(s)) throw new Error(`tipo desconhecido em §31.5: ${s}`);
  return { t: 'prim', name: s as keyof Prim };
}

export type Field = { name: string; spec: Spec; type: string };

/** Quebra `'id channelId · str content'` nos campos, na ordem declarada. */
export function parseDmLayout(layout: string): Field[] {
  if (layout === '') return [];
  return layout.split(' · ').map((f) => {
    const i = f.indexOf(' ');
    if (i < 0) throw new Error(`campo sem nome em §31.5: ${f}`);
    const type = f.slice(0, i);
    return { name: f.slice(i + 1), spec: parseType(type), type };
  });
}

/** Layouts já quebrados, uma vez, no carregamento do módulo. */
export const DM_PAYLOAD_FIELDS: Record<DmKindName, Field[]> = Object.fromEntries(
  Object.entries(DM_PAYLOAD_LAYOUT).map(([k, v]) => [k, parseDmLayout(v)]),
) as Record<DmKindName, Field[]>;

function writeDmBlobRef(w: Writer, v: DmBlobRef): void {
  w.key(v.blobsCoreKey).u64(v.byteOffset).u64(v.blockOffset).u64(v.blockLength).u64(v.byteLength);
}

function readDmBlobRef(r: Reader): DmBlobRef {
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
    case 'id': w.str(v as string); return;
    case 'bool': w.bool(v as boolean); return;
    case 'bytes': w.bytes(v as Uint8Array); return;
    case 'blobref': writeDmBlobRef(w, v as DmBlobRef); return;
    case 'attachment': {
      const a = v as DmAttachment;
      writeDmBlobRef(w, a.blob);
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
    case 'id': return r.str();
    case 'bool': return r.bool();
    case 'bytes': return r.bytes();
    case 'blobref': return readDmBlobRef(r);
    case 'attachment': {
      const blob = readDmBlobRef(r);
      return { blob, name: r.str(), sizeBytes: r.u64(), kind: r.u8(), hash: r.key() };
    }
  }
}

/** Serializa o payload na ordem de §31.5. Forma canônica: opcional ausente escreve só o byte 0. */
export function encodeDmPayload<K extends DmKindName>(kind: K, v: DmPayloadOf<K>): Buffer {
  const w = new Writer();
  const rec = v as Record<string, unknown>;
  for (const f of DM_PAYLOAD_FIELDS[kind]) writeValue(w, f.spec, rec[f.name]);
  return w.toBuffer();
}

/**
 * Decodifica o payload de um `kind` conhecido. Devolve `null` quando os bytes não casam o
 * layout — o estágio 9 de §31.7.3 mapeia isso para `IGNORED` / `E_MALFORMED`. Bytes sobrando
 * no fim são ignorados (§31.4/§7.2 regra 2, leitor tolerante). **Nunca lança** (§31.7.1).
 */
export function decodeDmPayload<K extends DmKindName>(kind: K, buf: Uint8Array): DmPayloadOf<K> | null {
  const r = new Reader(buf);
  const out: Record<string, unknown> = {};
  for (const f of DM_PAYLOAD_FIELDS[kind]) {
    const v = readValue(r, f.spec);
    if (r.failed) return null;
    // Opcional ausente não vira chave: `{}` e `{x: undefined}` não podem divergir no fold.
    if (v !== undefined) out[f.name] = v;
  }
  return r.failed ? null : (out as DmPayloadOf<K>);
}
