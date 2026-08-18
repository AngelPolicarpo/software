// Catálogo de `kind` e layout de payload — §7.4. Gerado à mão a partir da tabela, com o
// layout guardado **na forma textual da spec** para que o teste de paridade possa comparar
// campo a campo com `docs/backend-v2.md`.
//
// §7.2: `kind` é um `uint16` de enum fechado — **nunca uma string no fio**.
// §7.4: "Total: 38 kinds. O número é normativo e fechado para opVersion = 2."
// §7.2.1, regra que fecha DR-10: nenhum `kind` pode ser implementado sem sua linha de
// payload aqui. Um `kind` sem layout é `E_UNKNOWN_KIND` na escrita e `IGNORED` na leitura.

/** Os 38 `kind`s de §7.4, com o número normativo. */
export const KINDS = {
  // §7.4.1 Mensagem — domínio enfileirável
  'message.send': 1,
  'message.edit': 2,
  'message.delete': 3,
  'message.pin': 4,
  'reaction.set': 5,
  'thread.create': 6,

  // §7.4.2 Estrutura — síncrona
  'channel.create': 10,
  'channel.update': 11,
  'channel.move': 12,
  'channel.delete': 13,
  'category.create': 14,
  'category.rename': 15,
  'category.delete': 16,

  // §7.4.3 Cargos e membros — síncrona
  'role.create': 20,
  'role.update': 21,
  'role.move': 22,
  'role.delete': 23,
  'member.setRoles': 24,
  'member.join': 25,
  'member.leave': 26,
  'member.setNickname': 27,
  'member.setBlobsCore': 28,
  'identity.update': 29,

  // §7.4.4 Moderação — síncrona
  'mod.kick': 30,
  'mod.ban': 31,
  'mod.revokeBan': 32,
  'mod.timeout': 33,
  'mod.removeTimeout': 34,

  // §7.4.5 Comunidade, convite, rede — síncrona
  'community.create': 40,
  'community.update': 41,
  'community.end': 42,
  'community.setSuccessors': 43,
  'community.escrow': 44,
  'community.assumeHost': 45,
  'invite.create': 50,
  'invite.revoke': 51,
  'relay.volunteer': 60,
  'relay.withdraw': 61,
} as const;

export type KindName = keyof typeof KINDS;
export type KindNumber = (typeof KINDS)[KindName];

export const KIND_NAMES = Object.keys(KINDS) as readonly KindName[];

/**
 * O layout de payload de §7.4, textual e na ordem declarada.
 *
 * Uma substituição em relação ao texto: §7.4.1 escreve `opt<blobref+meta> attachment` e
 * define a estrutura completa logo abaixo da tabela — *"`attachment` completo: `blobref ·
 * str name · u64 sizeBytes · u8 kind · key hash`"*. Aqui isso vira o tipo composto
 * `attachment`, declarado em `payloads.ts`. `blobref` idem, de §7.2.1.
 */
export const PAYLOAD_LAYOUT = {
  'message.send':
    'id channelId · str content · arr<str> mentions · opt<attachment> attachment · opt<id> replyToId · opt<id> threadId',
  'message.edit': 'id messageId · str content',
  'message.delete': 'id messageId · opt<str> reason',
  'message.pin': 'id messageId · bool pinned',
  'reaction.set': 'id messageId · str emoji · bool present',
  'thread.create': 'id rootMessageId',

  'channel.create':
    'id categoryId · u8 type · str name · opt<str> topic · arr<id> readOnlyForRoleIds · opt<rank> afterRank · opt<rank> beforeRank',
  'channel.update':
    'id channelId · opt<str> name · opt<str> topic · opt<arr<id>> readOnlyForRoleIds',
  'channel.move': 'id channelId · id categoryId · opt<rank> afterRank · opt<rank> beforeRank',
  'channel.delete': 'id channelId',
  'category.create': 'str name · opt<rank> afterRank · opt<rank> beforeRank',
  'category.rename': 'id categoryId · str name',
  'category.delete': 'id categoryId · opt<id> moveChannelsTo · bool deleteChannels',

  'role.create':
    'str name · u8 color · arr<u8> permissions · bool mentionable · opt<rank> afterRank · opt<rank> beforeRank',
  'role.update':
    'id roleId · opt<str> name · opt<u8> color · opt<arr<u8>> permissions · opt<bool> mentionable',
  'role.move': 'id roleId · opt<rank> afterRank · opt<rank> beforeRank',
  'role.delete': 'id roleId',
  'member.setRoles': 'key targetKey · arr<id> roleIds',
  'member.join':
    'key invitePublicKey · sig joinProof · str displayName · u8 avatarColor · key blobsCoreKey',
  'member.leave': '',
  'member.setNickname': 'opt<str> nickname',
  'member.setBlobsCore': 'key blobsCoreKey',
  'identity.update': 'opt<str> displayName · opt<u8> avatarColor',

  'mod.kick': 'key targetKey · opt<str> reason',
  'mod.ban': 'key targetKey · opt<str> reason',
  'mod.revokeBan': 'key targetKey',
  'mod.timeout': 'key targetKey · u64 until · opt<str> reason',
  'mod.removeTimeout': 'key targetKey',

  'community.create':
    'str name · opt<str> iconEmoji · u8 iconColor · opt<str> description · key blobsKey · opt<str> originCommunityId · opt<u64> originFinalSeq',
  'community.update':
    'opt<str> name · opt<str> iconEmoji · opt<u8> iconColor · opt<str> description',
  'community.end': 'opt<str> reason',
  'community.setSuccessors': 'arr<key> successorKeys',
  'community.escrow': 'key targetKey · bytes wrappedSeed',
  'community.assumeHost': 'key newHostKey · u64 observedHostTs · sig proof',
  'invite.create':
    'key invitePublicKey · opt<u64> expiresAt · opt<u32> maxUses · opt<str> label',
  'invite.revoke': 'key invitePublicKey',
  'relay.volunteer': 'key relayPublicKey · u64 expiresAt · sig possession',
  'relay.withdraw': '',
} as const satisfies Record<KindName, string>;

const BY_NUMBER = new Map<number, KindName>(KIND_NAMES.map((n) => [KINDS[n], n]));

export function kindName(n: number): KindName | null {
  return BY_NUMBER.get(n) ?? null;
}

export function kindNumber(name: KindName): KindNumber {
  return KINDS[name];
}

/** §7.2 regra 4: `kind` desconhecido é `IGNORED`, nunca parada da projeção. */
export function isKnownKind(n: number): boolean {
  return BY_NUMBER.has(n);
}
