/**
 * AS OITO CORRIDAS de backend-v2.md §21.1.
 *
 * §21.1 tem 13 linhas. Tres nao sao corridas entre ops ("duas instancias do app",
 * "projecao e leitura simultaneas", "dois escritores do mesmo core"), e duas das
 * restantes precisam de `kind`s fora do escopo deste harness (`invite.create` +
 * `member.join` concorrente para "dois candidatos no ultimo uso de um convite";
 * `role.move` para "role.move ‖ role.move"). Sobram EXATAMENTE OITO — as oito abaixo.
 * Ver AMBIG-01 no REPORT.md: a spec escreve "as oito linhas acima" sobre uma tabela de
 * treze linhas, e a identificacao das oito nao esta fechada em lugar nenhum.
 *
 * Contrato de cada corrida:
 *   - `setup`   prepara o fixture (projetor rodando; `view.db` em dia)
 *   - `opA`     a op que chega PRIMEIRO
 *   - `opB`     a op que chega DEPOIS
 *   - `expect`  o desfecho normativo de cada uma, com o CODIGO DE ERRO nomeado
 *   - `teardown` devolve a comunidade ao estado inicial, para a repeticao seguinte
 */
import { E, type ErrorCode } from '../protocol/errors.ts';
import { K } from '../protocol/kinds.ts';
import { PERM } from '../protocol/permissions.ts';
import { CHANNEL_TYPE } from '../fold/limits.ts';
import { RANK_BOTTOM } from '../fold/rank.ts';
import { entityId } from '../codec/idgen.ts';
import type { Envelope } from '../codec/opCodec.ts';
import type { Client } from '../client/client.ts';
import type { SubmitResult } from '../host/host.ts';
import type { World } from './world.ts';

export type Expect = {
  /** desfecho esperado de A */
  a: 'APPLIED' | ErrorCode;
  /** desfecho esperado de B */
  b: 'APPLIED' | ErrorCode;
  /** quantos registros o log deve ganhar (a perdedora NAO pode ser appendada) */
  appended: number;
};

export type RaceCase = {
  id: string;
  title: string;
  /** linha correspondente em §21.1 */
  spec: string;
  needsFreshVictim?: boolean;
  setup: (w: World, i: number) => Promise<unknown>;
  ops: (w: World, i: number, fixture: never) => Promise<{ a: Envelope; b: Envelope }>;
  expect: Expect;
  teardown?: (w: World, i: number, fixture: never) => Promise<void>;
};

const eid = (
  t: 'role' | 'category' | 'channel' | 'message',
  w: World,
  c: Client,
  authorSeq: number,
): string => entityId(t, w.communityKey, c.keys.publicKey, authorSeq);

/** Submete e exige sucesso (setup nunca pode falhar). */
async function must(w: World, env: Envelope, what: string): Promise<SubmitResult> {
  const r = await w.host.submit(env);
  if (!r.ok) throw new Error(`setup ${what} recusado: ${r.code}`);
  return r;
}

/**
 * Autor do setup/teardown da repeticao `i`, rodiziado entre os seis moderadores.
 *
 * Nao e cosmetico: R-15 impoe `QUOTA_OPS_PER_WINDOW` = 2 000 ops por autor numa janela de
 * 10 000 registros, e uma comunidade que roda centenas de repeticoes cabe inteira dentro
 * de UMA janela. Concentrar todo o setup num autor faz o proprio `fold` recusar o setup —
 * o que e o comportamento correto de R-15, e nao o que estas corridas querem medir.
 */
function setupAuthor(w: World, i: number): Client {
  return w.clients[i % 6];
}

const tick = (w: World): number => {
  w.clock.advance(7);
  return w.clock.now();
};

// ---------------------------------------------------------------------------------

export const RACES: RaceCase[] = [
  {
    id: 'C1',
    title: 'dois moderadores editam o mesmo cargo',
    spec: '§21.1 linha 1 — ordem de chegada na fila do host; maior `seq` vence, campo a campo',
    async setup(w, i) {
      const a = setupAuthor(w, i);
      const seq = a.nextAuthorSeq;
      await must(
        w,
        a.build(
          K.ROLE_CREATE,
          {
            name: `alvo-${i}`,
            color: 1,
            permissions: [PERM.send_messages],
            mentionable: true,
            afterRank: RANK_BOTTOM,
            beforeRank: w.host.ds.roles.get(w.ids.modRole)!.rank,
          },
          tick(w),
        ),
        'role.create',
      );
      return { roleId: eid('role', w, a, seq) };
    },
    async ops(w, i, f: never) {
      const { roleId } = f as unknown as { roleId: string };
      return {
        a: w.clients[0].build(K.ROLE_UPDATE, { roleId, name: `a-${i}`, color: 2 }, tick(w)),
        b: w.clients[1].build(K.ROLE_UPDATE, { roleId, name: `b-${i}`, color: 3 }, tick(w)),
      };
    },
    // Sem conflito: as duas aplicam, a de maior `seq` vence campo a campo.
    expect: { a: 'APPLIED', b: 'APPLIED', appended: 2 },
    async teardown(w, i, f: never) {
      const { roleId } = f as unknown as { roleId: string };
      await must(w, setupAuthor(w, i + 3).build(K.ROLE_DELETE, { roleId }, tick(w)), 'role.delete');
    },
  },

  {
    id: 'C2',
    title: 'channel.delete ‖ message.send no mesmo canal',
    spec: '§21.1 linha 3 — se o delete chegou antes, a mensagem e REJECTED com E_CHANNEL_NOT_FOUND ANTES do append',
    async setup(w, i) {
      const a = setupAuthor(w, i);
      const seq = a.nextAuthorSeq;
      await must(
        w,
        a.build(
          K.CHANNEL_CREATE,
          { categoryId: w.ids.generalCategory, type: CHANNEL_TYPE.text, name: `c2-${i}`, readOnlyForRoleIds: [] },
          tick(w),
        ),
        'channel.create',
      );
      return { channelId: eid('channel', w, a, seq) };
    },
    async ops(w, i, f: never) {
      const { channelId } = f as unknown as { channelId: string };
      return {
        a: w.clients[0].build(K.CHANNEL_DELETE, { channelId }, tick(w)),
        b: w.clients[2].build(K.MESSAGE_SEND, { channelId, content: `perdida ${i}`, mentions: [] }, tick(w)),
      };
    },
    expect: { a: 'APPLIED', b: E.CHANNEL_NOT_FOUND, appended: 1 },
  },

  {
    id: 'C3',
    title: 'channel.create(#x) ‖ channel.create(#x)',
    spec: '§21.1 linha 4 / R-6 — o primeiro fica, o segundo e REJECTED antes do append',
    async setup(w, i) {
      return { name: `c3-${i}` };
    },
    async ops(w, _i, f: never) {
      const { name } = f as unknown as { name: string };
      const seqA = w.clients[0].nextAuthorSeq;
      return {
        a: w.clients[0].build(
          K.CHANNEL_CREATE,
          { categoryId: w.ids.generalCategory, type: CHANNEL_TYPE.text, name, readOnlyForRoleIds: [] },
          tick(w),
        ),
        b: w.clients[1].build(
          K.CHANNEL_CREATE,
          { categoryId: w.ids.generalCategory, type: CHANNEL_TYPE.text, name, readOnlyForRoleIds: [] },
          tick(w),
        ),
        // o id do vencedor e deterministico: (author, authorSeq) do cliente 0
        ...({ winnerId: eid('channel', w, w.clients[0], seqA) } as object),
      } as { a: Envelope; b: Envelope };
    },
    expect: { a: 'APPLIED', b: E.CHANNEL_NAME_TAKEN, appended: 1 },
    async teardown(w, i) {
      // remove o canal vencedor pelo nome, para a repeticao seguinte reusar o slot
      const id = w.host.ds.channelNameIndex.get(`${CHANNEL_TYPE.text}:c3-${i}`);
      if (id) await must(w, setupAuthor(w, i + 2).build(K.CHANNEL_DELETE, { channelId: id }, tick(w)), 'channel.delete');
    },
  },

  {
    id: 'C4',
    title: 'role.delete ‖ member.setRoles citando-o',
    spec: '§21.1 linha 5 / §8.4.1 — o `setRoles` posterior DESCARTA o id desconhecido (APPLIED)',
    async setup(w, i) {
      const a = setupAuthor(w, i);
      const seq = a.nextAuthorSeq;
      await must(
        w,
        a.build(
          K.ROLE_CREATE,
          {
            name: `c4-${i}`,
            color: 1,
            permissions: [PERM.send_messages],
            mentionable: true,
            afterRank: RANK_BOTTOM,
            beforeRank: w.host.ds.roles.get(w.ids.modRole)!.rank,
          },
          tick(w),
        ),
        'role.create',
      );
      return { roleId: eid('role', w, a, seq) };
    },
    async ops(w, _i, f: never) {
      const { roleId } = f as unknown as { roleId: string };
      return {
        a: w.clients[0].build(K.ROLE_DELETE, { roleId }, tick(w)),
        b: w.clients[1].build(
          K.MEMBER_SET_ROLES,
          { targetKey: w.clients[6].keys.publicKey, roleIds: [w.ids.baseRole, roleId] },
          tick(w),
        ),
      };
    },
    expect: { a: 'APPLIED', b: 'APPLIED', appended: 2 },
    async teardown(w, i) {
      // devolve o cliente 6 (nao moderador) ao cargo base
      await must(
        w,
        setupAuthor(w, i + 4).build(K.MEMBER_SET_ROLES, { targetKey: w.clients[6].keys.publicKey, roleIds: [w.ids.baseRole] }, tick(w)),
        'member.setRoles reset',
      );
    },
  },

  {
    id: 'C5',
    title: 'category.delete ‖ channel.create naquela categoria',
    spec: '§21.1 linha 7 — o create posterior e REJECTED (E_CATEGORY_NOT_FOUND)',
    async setup(w, i) {
      const a = setupAuthor(w, i);
      const seq = a.nextAuthorSeq;
      await must(w, a.build(K.CATEGORY_CREATE, { name: `c5-${i}` }, tick(w)), 'category.create');
      return { categoryId: eid('category', w, a, seq) };
    },
    async ops(w, i, f: never) {
      const { categoryId } = f as unknown as { categoryId: string };
      return {
        a: w.clients[0].build(K.CATEGORY_DELETE, { categoryId, deleteChannels: true }, tick(w)),
        b: w.clients[1].build(
          K.CHANNEL_CREATE,
          { categoryId, type: CHANNEL_TYPE.text, name: `c5c-${i}`, readOnlyForRoleIds: [] },
          tick(w),
        ),
      };
    },
    expect: { a: 'APPLIED', b: E.CATEGORY_NOT_FOUND, appended: 1 },
  },

  {
    id: 'C6',
    title: 'message.delete ‖ reaction.set',
    spec: '§21.1 linha 8 / §8.4.1 — a reacao posterior e REJECTED (E_MESSAGE_DELETED)',
    async setup(w, i) {
      // O AUTOR da mensagem tambem rodizia: ele e quem apaga na op A.
      const a = w.clients[6 + (i % 4)];
      const seq = a.nextAuthorSeq;
      await must(
        w,
        a.build(K.MESSAGE_SEND, { channelId: w.ids.generalChannel, content: `c6 ${i}`, mentions: [] }, tick(w)),
        'message.send',
      );
      return { messageId: eid('message', w, a, seq), author: a };
    },
    async ops(w, i, f: never) {
      const { messageId, author } = f as unknown as { messageId: string; author: Client };
      return {
        a: author.build(K.MESSAGE_DELETE, { messageId }, tick(w)),
        b: w.clients[(i % 5)].build(K.REACTION_SET, { messageId, emoji: '👍', present: true }, tick(w)),
      };
    },
    expect: { a: 'APPLIED', b: E.MESSAGE_DELETED, appended: 1 },
  },

  {
    id: 'C7',
    title: 'channel.delete(ultimo) ‖ channel.delete(penultimo)',
    spec: '§21.1 linha 9 / R-7 — recusa o que deixaria a comunidade sem canal',
    async setup(w, i) {
      // Deixa a comunidade com EXATAMENTE dois canais de texto: #geral e o novo.
      const a = setupAuthor(w, i);
      const seq = a.nextAuthorSeq;
      await must(
        w,
        a.build(
          K.CHANNEL_CREATE,
          { categoryId: w.ids.generalCategory, type: CHANNEL_TYPE.text, name: `c7-${i}`, readOnlyForRoleIds: [] },
          tick(w),
        ),
        'channel.create',
      );
      return { extraId: eid('channel', w, a, seq) };
    },
    async ops(w, _i, f: never) {
      const { extraId } = f as unknown as { extraId: string };
      return {
        a: w.clients[0].build(K.CHANNEL_DELETE, { channelId: extraId }, tick(w)),
        b: w.clients[1].build(K.CHANNEL_DELETE, { channelId: w.ids.generalChannel }, tick(w)),
      };
    },
    expect: { a: 'APPLIED', b: E.LAST_CHANNEL, appended: 1 },
  },

  {
    id: 'C8',
    title: 'ban ‖ op do alvo',
    spec: '§21.1 linha 10 — a op que chega depois do ban e REJECTED com E_BANNED',
    needsFreshVictim: true,
    async setup(w, i) {
      const victim = await w.admit(`vitima-${i}`);
      return { victim };
    },
    async ops(w, i, f: never) {
      const { victim } = f as unknown as { victim: Client };
      return {
        a: setupAuthor(w, i).build(K.MOD_BAN, { targetKey: victim.keys.publicKey, reason: 'corrida' }, tick(w)),
        b: victim.build(
          K.MESSAGE_SEND,
          { channelId: w.ids.generalChannel, content: `pos-ban ${i}`, mentions: [] },
          tick(w),
        ),
      };
    },
    expect: { a: 'APPLIED', b: E.BANNED, appended: 1 },
  },
];
