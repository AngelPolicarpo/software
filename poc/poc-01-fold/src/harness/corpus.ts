/**
 * Corpus de referencia do fuzzer e do teste de determinismo (§28.4).
 *
 * §28.4 pede "um core de referencia com >= 5 000 registros cobrindo os 38 `kind`s E
 * >= 200 registros deliberadamente invalidos". Aqui: >= 5 000 registros cobrindo os 16
 * `kind`s implementados (o escopo do POC-01) mais os registros invalidos, incluindo
 * `kind`s dos outros 22 — que sao normativamente `IGNORED`/`E_UNKNOWN_KIND` para este
 * binario e por isso pertencem ao corpus invalido.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { K } from '../protocol/kinds.ts';
import { PERM } from '../protocol/permissions.ts';
import { CHANNEL_TYPE } from '../fold/limits.ts';
import { RANK_BOTTOM } from '../fold/rank.ts';
import { entityId } from '../codec/idgen.ts';
import { blake2b256, keyPairFromSeed, randomBytes, sign } from '../crypto/index.ts';
import { encodeOp, encodePayload } from '../codec/opCodec.ts';
import { AdversaryHost } from '../host/adversary.ts';
import { createWorld, type World } from './world.ts';

export type Corpus = {
  /** todos os `HostRecord` do core, em ordem de `seq` */
  records: Buffer[];
  communityKey: Buffer;
  /** quantos registros foram APPLIED pelo host (o resto foi recusado antes do append) */
  applied: number;
  world: World;
  /** material que o fuzzer precisa para REASSINAR como o host adversario de §28.5 */
  fuzzKeys: {
    communityKey: Buffer;
    coreSecretKey: Buffer;
    authors: Array<{ publicKey: Buffer; secretKey: Buffer }>;
    ids: { channels: string[]; categories: string[]; roles: string[]; messages: string[] };
    baseHostTs: number;
  };
};

const EMOJIS = ['👍', '🎉', '🔥', '😀', '🚀', '💡', '✅', '❤️', '🐛', '📌'];

/**
 * Gera um log de referencia com atividade realista dos 16 `kind`s. Deterministico dado
 * o mesmo `target` (as chaves sao aleatorias, mas a SEQUENCIA de ops nao).
 */
export async function buildCorpus(
  dir: string,
  root: string,
  target: number,
  invalidRecords = 0,
): Promise<Corpus> {
  mkdirSync(dir, { recursive: true });
  const w = await createWorld({ dir, root, clients: 10, batch: 256 });
  const eid = (t: 'role' | 'category' | 'channel' | 'message', c: { keys: { publicKey: Buffer } }, seq: number): string =>
    entityId(t, w.communityKey, c.keys.publicKey, seq);

  const channels: string[] = [w.ids.generalChannel];
  const categories: string[] = [w.ids.generalCategory];
  const messages: string[] = [];
  const roles: string[] = [];
  const tick = (): number => {
    w.clock.advance(11);
    return w.clock.now();
  };

  let round = 0;
  while (w.host.core.length < target) {
    round++;
    const mod = w.clients[round % 2];
    const plain = w.clients[2 + (round % 8)];

    // category.create / channel.create
    if (round % 17 === 0 && categories.length < 40) {
      const s = w.founder.nextAuthorSeq;
      if ((await w.host.submit(w.founder.build(K.CATEGORY_CREATE, { name: `cat-${round}` }, tick()))).ok) {
        categories.push(eid('category', w.founder, s));
      }
    }
    if (round % 7 === 0 && channels.length < 400) {
      const s = mod.nextAuthorSeq;
      const r = await w.host.submit(
        mod.build(
          K.CHANNEL_CREATE,
          {
            categoryId: categories[round % categories.length],
            type: round % 3 === 0 ? CHANNEL_TYPE.voice : CHANNEL_TYPE.text,
            name: `ch-${round}`,
            topic: round % 3 === 0 ? undefined : `topico ${round}`,
            readOnlyForRoleIds: [],
          },
          tick(),
        ),
      );
      if (r.ok) channels.push(eid('channel', mod, s));
    }
    // channel.update
    if (round % 13 === 0 && channels.length > 1) {
      await w.host.submit(
        mod.build(K.CHANNEL_UPDATE, { channelId: channels[round % channels.length], topic: `t-${round}` }, tick()),
      );
    }
    // role.create / role.update / role.delete
    if (round % 23 === 0 && roles.length < 60) {
      const s = w.founder.nextAuthorSeq;
      const r = await w.host.submit(
        w.founder.build(
          K.ROLE_CREATE,
          {
            name: `cargo-${round}`,
            color: round % 7,
            permissions: [PERM.send_messages, PERM.add_reactions],
            mentionable: true,
            afterRank: RANK_BOTTOM,
            beforeRank: w.host.ds.roles.get(w.ids.modRole)!.rank,
          },
          tick(),
        ),
      );
      if (r.ok) roles.push(eid('role', w.founder, s));
    }
    if (round % 29 === 0 && roles.length > 0) {
      await w.host.submit(
        w.founder.build(K.ROLE_UPDATE, { roleId: roles[round % roles.length], name: `cargo-r${round}` }, tick()),
      );
    }
    if (round % 61 === 0 && roles.length > 3) {
      const id = roles.shift()!;
      await w.host.submit(w.founder.build(K.ROLE_DELETE, { roleId: id }, tick()));
    }
    // member.setRoles
    if (round % 19 === 0 && roles.length > 0) {
      await w.host.submit(
        w.founder.build(
          K.MEMBER_SET_ROLES,
          { targetKey: plain.keys.publicKey, roleIds: [w.ids.baseRole, roles[round % roles.length]] },
          tick(),
        ),
      );
    }
    // message.send (o grosso do log)
    for (let j = 0; j < 4; j++) {
      const author = j === 0 ? mod : w.clients[(round + j) % 10];
      const s = author.nextAuthorSeq;
      const textChannels = channels.filter((c) => w.host.ds.channels.get(c)?.type === CHANNEL_TYPE.text);
      const ch = textChannels[(round + j) % textChannels.length];
      const r = await w.host.submit(
        author.build(
          K.MESSAGE_SEND,
          {
            channelId: ch,
            content: `mensagem ${round}.${j} — conteudo de referencia`,
            mentions: j === 1 ? ['everyone'] : [],
            replyToId: j === 3 && messages.length > 0 ? undefined : undefined,
          },
          tick(),
        ),
      );
      if (r.ok) messages.push(eid('message', author, s));
    }
    // reaction.set
    if (messages.length > 0) {
      const target = messages[(round * 3) % messages.length];
      const reactor = w.clients[round % 10];
      await w.host.submit(
        reactor.build(K.REACTION_SET, { messageId: target, emoji: EMOJIS[round % EMOJIS.length], present: true }, tick()),
      );
      if (round % 5 === 0) {
        await w.host.submit(
          reactor.build(
            K.REACTION_SET,
            { messageId: target, emoji: EMOJIS[round % EMOJIS.length], present: false },
            tick(),
          ),
        );
      }
    }
    // message.delete
    if (round % 11 === 0 && messages.length > 5) {
      const id = messages.shift()!;
      await w.host.submit(w.founder.build(K.MESSAGE_DELETE, { messageId: id, reason: 'limpeza' }, tick()));
    }
    // channel.delete / category.delete
    if (round % 37 === 0 && channels.length > 3) {
      const id = channels.pop()!;
      await w.host.submit(mod.build(K.CHANNEL_DELETE, { channelId: id }, tick()));
    }
    if (round % 89 === 0 && categories.length > 2) {
      const id = categories.pop()!;
      await w.host.submit(
        mod.build(K.CATEGORY_DELETE, { categoryId: id, moveChannelsTo: categories[0], deleteChannels: false }, tick()),
      );
    }
    // invite.create + member.join (novos membros)
    if (round % 41 === 0) {
      await w.admit(`extra-${round}`);
    }
    // mod.ban
    if (round % 97 === 0) {
      const victim = await w.admit(`banido-${round}`);
      await w.host.submit(
        w.clients[0].build(K.MOD_BAN, { targetKey: victim.keys.publicKey, reason: 'corpus' }, tick()),
      );
    }
  }

  // §28.4 exige ">= 200 registros deliberadamente invalidos" no core de referencia.
  // Eles so podem entrar pelo caminho do ADVERSARIO: a admissao de §11.4 os recusaria
  // antes do append, que e exatamente a propriedade que o gate confirma.
  if (invalidRecords > 0) {
    const adv = new AdversaryHost(w.host.core, w.coreKeyPair);
    // 0..5 sao moderadores; 7 e membro comum, o que faz o caso "mod.ban sem permissao"
    // ser de fato uma recusa por permissao.
    const plain = w.clients[7];
    for (let i = 0; i < invalidRecords; i++) {
      const hostTs = Math.max(w.clock.now(), w.host.ds.lastHostTs);
      w.clock.advance(3);
      switch (i % 8) {
        case 0: // kind desconhecido
        case 1: {
          const opBytes = encodeOp({
            v: 1, communityId: w.communityKey, kind: 50_000 + i, author: plain.keys.publicKey,
            authorSeq: 5_000_000 + i, ts: hostTs, payload: Buffer.alloc(8),
          });
          await adv.appendRaw({ op: opBytes, sig: sign(blake2b256('op/1', opBytes), plain.keys.secretKey) }, hostTs);
          break;
        }
        case 2: { // versao desconhecida
          const opBytes = encodeOp({
            v: 7, communityId: w.communityKey, kind: K.MESSAGE_SEND, author: plain.keys.publicKey,
            authorSeq: 5_000_000 + i, ts: hostTs, payload: Buffer.alloc(8),
          });
          await adv.appendRaw({ op: opBytes, sig: sign(blake2b256('op/1', opBytes), plain.keys.secretKey) }, hostTs);
          break;
        }
        case 3: { // comunidade errada
          const opBytes = encodeOp({
            v: 1, communityId: blake2b256('outra/1', Buffer.from([i])), kind: K.MESSAGE_SEND,
            author: plain.keys.publicKey, authorSeq: 5_000_000 + i, ts: hostTs,
            payload: encodePayload(K.MESSAGE_SEND, { channelId: w.ids.generalChannel, content: 'x', mentions: [] }),
          });
          await adv.appendRaw({ op: opBytes, sig: sign(blake2b256('op/1', opBytes), plain.keys.secretKey) }, hostTs);
          break;
        }
        case 4: // hostSig invalida
          await adv.appendBadHostSig(
            plain.buildRaw(K.MESSAGE_SEND, { channelId: w.ids.generalChannel, content: `bad ${i}`, mentions: [] }, hostTs, 5_000_000 + i, w.communityKey),
            hostTs,
          );
          break;
        case 5: // bytes aleatorios
          await adv.appendBytes(randomBytes(50 + (i % 100)));
          break;
        case 6: // sem permissao (mod.ban por membro comum)
          await adv.appendRaw(
            plain.buildRaw(K.MOD_BAN, { targetKey: w.clients[8].keys.publicKey }, hostTs, 5_000_000 + i, w.communityKey),
            hostTs,
          );
          break;
        default: { // payload truncado
          const opBytes = encodeOp({
            v: 1, communityId: w.communityKey, kind: K.CHANNEL_CREATE, author: plain.keys.publicKey,
            authorSeq: 5_000_000 + i, ts: hostTs, payload: Buffer.from([2, 65, 66]),
          });
          await adv.appendRaw({ op: opBytes, sig: sign(blake2b256('op/1', opBytes), plain.keys.secretKey) }, hostTs);
        }
      }
    }
    // O host precisa reinterpretar o log: o adversario nao passou pela admissao.
    await w.host.reprojectAll();
  }

  w.host.resumeProjector();
  const records: Buffer[] = [];
  for (let seq = 0; seq < w.host.core.length; seq++) {
    const b = await w.host.core.get(seq, { wait: false });
    if (b) records.push(Buffer.from(b));
  }
  // Pool de autores do fuzzer: fundador, moderadores, membros comuns e — por ultimo, o
  // que a estrategia `signed-nonmember` usa — uma identidade que NUNCA entrou.
  const outsider = keyPairFromSeed(blake2b256('fuzz-outsider/1', w.communityKey));
  const authors = [
    { publicKey: w.founder.keys.publicKey, secretKey: w.founder.keys.secretKey },
    ...w.clients.map((c) => ({ publicKey: c.keys.publicKey, secretKey: c.keys.secretKey })),
    { publicKey: outsider.publicKey, secretKey: outsider.secretKey },
  ];

  return {
    records,
    communityKey: w.communityKey,
    applied: w.host.stats.appended,
    world: w,
    fuzzKeys: {
      communityKey: w.communityKey,
      coreSecretKey: w.coreKeyPair.secretKey,
      authors,
      ids: {
        channels: [...w.host.ds.channels.keys()],
        categories: [...w.host.ds.categories.keys()],
        roles: [...w.host.ds.roles.keys()],
        messages: [...w.host.ds.messages.keys()].slice(0, 200),
      },
      baseHostTs: w.host.ds.lastHostTs,
    },
  };
}

export async function corpusRecordsOnly(dir: string, root: string, target: number): Promise<{
  records: Buffer[];
  communityKey: Buffer;
}> {
  const c = await buildCorpus(join(dir, 'corpus'), root, target);
  const out = { records: c.records, communityKey: c.communityKey };
  await c.world.close();
  return out;
}
