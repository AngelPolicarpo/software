// Catálogo de `kind` da conversa direta e layout de payload — §31.5. Transcrito à mão da
// tabela, com o layout guardado **na forma textual da spec** para que o teste de paridade
// possa comparar campo a campo com `docs/backend-v2.md`.
//
// §31.4: `kind` é um `uint16` de enum fechado — **nunca uma string no fio**.
// §31.5: "Total: 6 `kind`s. O número é normativo e **fechado para `DM_VERSION = 1`**."
//
// **Este catálogo não é o de §7.4 e não interage com ele.** §31.0 diz "Catálogo de 38
// `kind`s e `opVersion = 2`: **NÃO REUTILIZADO e NÃO TOCADO** — a DM tem registro e versão
// próprios". Os números 1..6 daqui e os 1..6 de lá são espaços disjuntos, separados pelo
// campo `v` do envelope e pelo core em que o registro vive.

/** Os 6 `kind`s de §31.5, com o número normativo. */
export const DM_KINDS = {
  'dm.hello': 1,
  'dm.profile': 2,
  'dm.message': 3,
  'dm.edit': 4,
  'dm.delete': 5,
  'dm.react': 6,
} as const;

export type DmKindName = keyof typeof DM_KINDS;
export type DmKindNumber = (typeof DM_KINDS)[DmKindName];

export const DM_KIND_NAMES = Object.keys(DM_KINDS) as readonly DmKindName[];

/**
 * `Própria` de §31.5 — o `kind` só atua sobre registro do próprio autor. É a coluna que
 * RD-7 aplica; `dm.profile` é "própria" por construção (só descreve quem escreve).
 */
export const DM_OWN_ONLY: ReadonlySet<DmKindName> = new Set<DmKindName>([
  'dm.profile',
  'dm.edit',
  'dm.delete',
]);

/**
 * O layout de payload de §31.5, textual e na ordem declarada.
 *
 * Duas substituições em relação ao texto, ambas explicitadas pela própria tabela:
 * `opt<blobref+meta> attachment` é o tipo composto `attachment` (*"`attachment` completo:
 * `blobref · str name · u64 sizeBytes · u8 kind · key hash`"*), e `blobref` é o de §7.2.1.
 */
export const DM_PAYLOAD_LAYOUT = {
  'dm.hello': 'key peerKey · sig coreProof · str displayName · u8 avatarColor',
  'dm.profile': 'opt<str> displayName · opt<u8> avatarColor',
  'dm.message': 'str content · opt<attachment> attachment · opt<id> replyToId',
  'dm.edit': 'id messageId · str content',
  'dm.delete': 'id messageId',
  'dm.react': 'id messageId · str emoji · bool present',
} as const satisfies Record<DmKindName, string>;

const BY_NUMBER = new Map<number, DmKindName>(DM_KIND_NAMES.map((n) => [DM_KINDS[n], n]));

export function dmKindName(n: number): DmKindName | null {
  return BY_NUMBER.get(n) ?? null;
}

export function dmKindNumber(name: DmKindName): DmKindNumber {
  return DM_KINDS[name];
}

/** §31.5: `kind` sem linha na tabela é `E_UNKNOWN_KIND` na escrita e `IGNORED` na leitura. */
export function isKnownDmKind(n: number): boolean {
  return BY_NUMBER.has(n);
}
