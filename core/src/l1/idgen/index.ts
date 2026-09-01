// `idgen` — L1, derivação determinística de todo id de entidade (§7.3).
//
// §4: não depende de nenhum módulo, e **não pode usar aleatoriedade nem relógio**. Tudo
// aqui é função pura dos bytes que entram.
//
//   opId        = BLAKE2b-256('opid/1' ‖ envelopeCanônico)             → 32 B, hex
//   entityId(t) = PREFIXO + crockford32(BLAKE2b-128('id/' ‖ t ‖ '/2'
//                            ‖ communityId ‖ sequenceScope ‖ author ‖ authorSeq)) → prefixo + 26 chars
//
// Por que isso importa (§7.3): 128 bits tornam colisão dirigida inviável, o escopo por
// comunidade impede que um id atravesse fronteira, e derivar de `(author, sequenceScope,
// authorSeq)` — que é único por construção — garante que a mesma op produza o mesmo id em
// **toda** reprojeção.
// Nenhum id é gerado pelo host; era isso que quebrava a reprojeção determinística em v1.

import sodium from 'sodium-native';

/** §5.2: todo hash carrega prefixo de domínio. Reaproveitar prefixo é bug de segurança. */
function blake2b(outLen: 16 | 32, domain: string, ...parts: Uint8Array[]): Buffer {
  const out = Buffer.allocUnsafe(outLen);
  sodium.crypto_generichash_batch(out, [Buffer.from(domain, 'utf8'), ...parts]);
  return out;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Crockford Base32, sem hífen e sem dígito de verificação. 16 bytes → 26 caracteres
 * (128 bits / 5 = 25,6, arredondando para cima), que é o comprimento que §7.3 declara.
 *
 * O alfabeto omite `I`, `L`, `O` e `U` de propósito: os três primeiros para não confundir
 * com `1` e `0` quando alguém lê um id em voz alta ou copia de uma captura de tela.
 */
export function crockford32(bytes: Uint8Array): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(acc >>> bits) & 31];
    }
  }
  if (bits > 0) out += CROCKFORD[(acc << (5 - bits)) & 31];
  return out;
}

/** As seis entidades de §7.3. `t` entra no prefixo de domínio; `prefix`, no id. */
export const ENTITY = {
  message: { t: 'message', prefix: 'msg-' },
  channel: { t: 'channel', prefix: 'ch-' },
  category: { t: 'category', prefix: 'cat-' },
  role: { t: 'role', prefix: 'role-' },
  thread: { t: 'thread', prefix: 'thr-' },
  modentry: { t: 'modentry', prefix: 'mod-' },
} as const satisfies Record<string, { t: string; prefix: string }>;

export type EntityType = keyof typeof ENTITY;

export const ENTITY_TYPES = Object.keys(ENTITY) as readonly EntityType[];

/** Comprimento do corpo Crockford de todo `entityId`, sem o prefixo. */
export const ENTITY_ID_BODY_LEN = 26;

const KEY_LEN = 32;
const U64_MAX = (1n << 64n) - 1n;

function u32le(n: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

/** Encoding delimitado do escopo, para o hash não permitir ambiguidade de concatenação. */
function scopeBytes(scope: string): Buffer {
  if (scope === 'community') return Buffer.from([0]);
  const channelId = scope.startsWith('channel:') ? scope.slice('channel:'.length) : scope;
  const bytes = Buffer.from(channelId, 'utf8');
  return Buffer.concat([Buffer.from([1]), u32le(bytes.length), bytes]);
}

/**
 * `authorSeq` é `uint64` e entra little-endian, o mesmo layout do campo na `Op` (§7.2.1).
 * Passar `number` acima de `Number.MAX_SAFE_INTEGER` seria perda silenciosa de precisão, e
 * um id derivado de `authorSeq` errado é um id errado para sempre — por isso é recusado.
 */
function u64le(n: bigint | number): Buffer {
  const v = typeof n === 'bigint' ? n : BigInt(n);
  if (typeof n === 'number' && !Number.isSafeInteger(n)) {
    throw new RangeError(`authorSeq ${n} não é inteiro seguro — passe bigint`);
  }
  if (v < 0n || v > U64_MAX) throw new RangeError(`authorSeq ${v} fora de uint64`);
  const b = Buffer.allocUnsafe(8);
  b.writeBigUInt64LE(v);
  return b;
}

function assertKey(name: string, k: Uint8Array): void {
  if (k.length !== KEY_LEN) {
    throw new RangeError(`${name} tem ${k.length} bytes, esperado ${KEY_LEN}`);
  }
}

/**
 * §7.3 — id determinístico de entidade.
 *
 * `communityKey` são os **32 bytes** da chave pública do core, não o texto hex de §6.2: o
 * material de hash é a chave. As checagens de comprimento pegam erro de programação, não
 * entrada hostil — quando o `fold` chama isto, o codec já validou a `Op`, então nenhum
 * registro do log alcança este caminho com tamanho errado (§8.2 estágio 2).
 */
export function entityId(
  t: EntityType,
  communityKey: Uint8Array,
  author: Uint8Array,
  authorSeq: bigint | number,
  sequenceScope = 'community',
): string {
  assertKey('communityKey', communityKey);
  assertKey('author', author);
  const h = blake2b(16, `id/${ENTITY[t].t}/2`, communityKey, scopeBytes(sequenceScope), author, u64le(authorSeq));
  return ENTITY[t].prefix + crockford32(h);
}

// ─── §31.4 — id determinístico da conversa direta ──────────────────────────────────────
//
//   dmEntityId(t) = PREFIXO + crockford32(BLAKE2b-128('id/dm-' ‖ t ‖ '/1'
//                               ‖ conversationId ‖ author ‖ authorSeq))
//
// Uma só entidade tem id: a mensagem. Reação, edição e deleção referenciam a mensagem e não
// têm identidade própria (§31.5). As propriedades de §7.3 valem iguais — 128 bits, escopado
// à conversa, derivado de um trio único por construção (RD-3), nunca gerado por ninguém que
// não seja o autor.
//
// **O prefixo de domínio é outro** (`id/dm-message/1`, não `id/message/2`) e não há
// `sequenceScope` no material: a conversa é o escopo. Um id de comunidade e um id de DM não
// colidem nem são confundíveis, que é a mesma propriedade de A07 aplicada a §7.3.

/** A única entidade com id próprio numa conversa direta (§31.4). */
export const DM_ENTITY = {
  message: { t: 'message', prefix: 'dmsg-' },
} as const satisfies Record<string, { t: string; prefix: string }>;

export type DmEntityType = keyof typeof DM_ENTITY;

export const DM_ENTITY_TYPES = Object.keys(DM_ENTITY) as readonly DmEntityType[];

/**
 * §31.4 — id determinístico de entidade de DM.
 *
 * `conversationKey` são os **32 bytes** de §31.2, não o texto hex: o material de hash é a
 * chave. As checagens de comprimento pegam erro de programação, não entrada hostil — quando
 * o `dmFold` chama isto, o codec já validou o `DmOp` (estágio 1 de §31.7.3).
 */
export function dmEntityId(
  t: DmEntityType,
  conversationKey: Uint8Array,
  author: Uint8Array,
  authorSeq: bigint | number,
): string {
  assertKey('conversationKey', conversationKey);
  assertKey('author', author);
  const h = blake2b(16, `id/dm-${DM_ENTITY[t].t}/1`, conversationKey, author, u64le(authorSeq));
  return DM_ENTITY[t].prefix + crockford32(h);
}

/** O tipo de entidade de DM a que um id pertence, ou `null` se o prefixo não for de §31.4. */
export function dmEntityTypeOf(id: string): DmEntityType | null {
  for (const t of DM_ENTITY_TYPES) {
    const { prefix } = DM_ENTITY[t];
    if (id.startsWith(prefix) && id.length === prefix.length + ENTITY_ID_BODY_LEN) {
      const body = id.slice(prefix.length);
      if ([...body].every((c) => CROCKFORD.includes(c))) return t;
    }
  }
  return null;
}

/** §7.3 — `opId` sobre o envelope na forma canônica de §7.2. 32 bytes em hex minúsculo. */
export function opId(canonicalEnvelope: Uint8Array): string {
  return blake2b(32, 'opid/1', canonicalEnvelope).toString('hex');
}

/** O tipo de entidade a que um id pertence, ou `null` se o prefixo não for de §7.3. */
export function entityTypeOf(id: string): EntityType | null {
  for (const t of ENTITY_TYPES) {
    const { prefix } = ENTITY[t];
    if (id.startsWith(prefix) && id.length === prefix.length + ENTITY_ID_BODY_LEN) {
      const body = id.slice(prefix.length);
      if ([...body].every((c) => CROCKFORD.includes(c))) return t;
    }
  }
  return null;
}
