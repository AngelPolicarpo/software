/**
 * Corpus determinístico para os testes de §28.4 — o "core de referência".
 *
 * §28.4 exige: ≥ 5 000 registros cobrindo os **38 `kind`s** **e** ≥ 200 registros
 * deliberadamente inválidos. Tudo determinístico: seeds fixas, nada de aleatoriedade nem de
 * relógio de parede — o mesmo gerador produz os mesmos bytes em toda máquina.
 *
 * Não é código de produto: mora em `test/` porque só existe para sustentar §28.4.
 */

import { KINDS, type KindName, type PayloadOf } from '../../src/l1/opCodec/index.ts';
import {
  genesis,
  joinMember,
  joinProof,
  keypairFromSeed,
  makeRecord,
  sign,
  T0,
  ZERO64,
  type Genesis,
  type Keypair,
  type RecordOptions,
} from './world.ts';

export type Corpus = {
  /** Os bytes dos registros, na ordem do log. */
  readonly log: Uint8Array[];
  readonly size: number;
  /** `kind`s distintos cobertos, pelo número de §7.4. */
  readonly kindsCovered: ReadonlySet<number>;
  readonly invalidCount: number;
  readonly applied: number;
};

export class CorpusBuilder {
  readonly g: Genesis;
  readonly w: Genesis['world'];
  readonly kindsCovered = new Set<number>();
  invalidCount = 0;
  #t = T0;

  constructor() {
    this.g = genesis();
    this.w = this.g.world;
    // A gênese de R-27 já cobre os seis primeiros registros do log.
    for (const k of ['community.create', 'role.create', 'member.join', 'category.create', 'channel.create'] as const) {
      this.kindsCovered.add(KINDS[k]);
    }
  }

  /** `hostTs` monotônico do corpus (R-1), avançando a cada registro. */
  ts(): number {
    return ++this.#t;
  }

  submit<K extends KindName>(kind: K, author: Keypair, payload: PayloadOf<K>): void {
    this.kindsCovered.add(KINDS[kind]);
    this.w.submit({ kind, author, hostTs: this.ts(), payload } as never);
  }

  /**
   * Submete com `authorSeq` **explícito** — o `id` de entidade (§7.3) deriva de
   * `(author, authorSeq)`, então quem precisa referenciar a entidade depois tem de submeter
   * com o mesmo `authorSeq` com que o id foi calculado.
   */
  submitSeq<K extends KindName>(kind: K, author: Keypair, seq: number, payload: PayloadOf<K>): void {
    this.kindsCovered.add(KINDS[kind]);
    this.w.submit({ kind, author, authorSeq: seq, hostTs: this.ts(), payload } as never);
  }

  /** Registro deliberadamente inválido — bem formado na superfície, recusado pelo `fold`. */
  invalid<K extends KindName>(o: Omit<RecordOptions<K>, 'authorSeq'> & { authorSeq?: number }): void {
    this.kindsCovered.add(KINDS[o.kind]);
    this.invalidCount++;
    this.w.submit({ ...o, hostTs: o.hostTs ?? this.ts() } as never);
  }

  /** Registro cru de `makeRecord`, com o `authorSeq` gerido pelo mundo. */
  pushRaw(o: Omit<RecordOptions<KindName>, 'authorSeq'> & { authorSeq?: number }): void {
    this.invalidCount++;
    const authorSeq = o.authorSeq ?? this.w.next(o.author);
    this.w.push(makeRecord(this.w.core, { ...o, authorSeq, hostTs: o.hostTs ?? this.ts() } as never));
  }

  done(): Corpus {
    let applied = 0;
    for (const r of this.w.results) if (r.decision === 'APPLIED') applied++;
    return {
      log: [...this.w.log],
      size: this.w.log.length,
      kindsCovered: new Set(this.kindsCovered),
      invalidCount: this.invalidCount,
      applied,
    };
  }
}

export function buildCorpus(): Corpus {
  const b = new CorpusBuilder();
  const g = b.g;
  const w = b.w;

  // ── Membros ───────────────────────────────────────────────────────────────────────────
  const members: Keypair[] = [];
  for (let i = 0; i < 10; i++) members.push(joinMember(g, `membro-${i}`));
  const pick = (i: number): Keypair => members[i % members.length] as Keypair;

  // ── Estrutura: categorias e canais ─────────────────────────────────────────────────────
  const seqCat2 = w.next(g.founder);
  const cat2 = w.id('category', g.founder, seqCat2);
  b.submitSeq('category.create', g.founder, seqCat2, { name: 'ÁREA 2' });
  const seqCat3 = w.next(g.founder);
  const cat3 = w.id('category', g.founder, seqCat3);
  b.submitSeq('category.create', g.founder, seqCat3, { name: 'ÁREA 3' });
  b.submit('category.rename', g.founder, { categoryId: cat2, name: 'ÁREA B' });
  const seqCh2 = w.next(g.founder);
  const ch2 = w.id('channel', g.founder, seqCh2);
  b.submitSeq('channel.create', g.founder, seqCh2, { categoryId: cat2, type: 0, name: 'segundo', readOnlyForRoleIds: [] });
  const seqChVoz = w.next(g.founder);
  const chVoz = w.id('channel', g.founder, seqChVoz);
  b.submitSeq('channel.create', g.founder, seqChVoz, { categoryId: cat2, type: 1, name: 'Voz da área', readOnlyForRoleIds: [] });
  b.submit('channel.move', g.founder, { channelId: chVoz, categoryId: cat3 });
  b.submit('channel.update', g.founder, { channelId: ch2, topic: 'Tópico novo' });
  const seqCh3 = w.next(g.founder);
  const ch3 = w.id('channel', g.founder, seqCh3);
  b.submitSeq('channel.create', g.founder, seqCh3, { categoryId: cat3, type: 0, name: 'terceiro', readOnlyForRoleIds: [] });
  b.submit('channel.delete', g.founder, { channelId: ch3 }); // mensagens que vierem depois ficam órfãs
  const seqCh4 = w.next(g.founder);
  b.submitSeq('channel.create', g.founder, seqCh4, { categoryId: cat3, type: 0, name: 'quarto', readOnlyForRoleIds: [] });
  b.submit('category.delete', g.founder, { categoryId: cat3, deleteChannels: true });

  // ── Cargos ─────────────────────────────────────────────────────────────────────────────
  const seqMod = w.next(g.founder);
  const modRole = w.id('role', g.founder, seqMod);
  b.submitSeq('role.create', g.founder, seqMod, { name: 'Moderador', color: 3, permissions: [7, 8, 9, 10, 11], mentionable: true });
  const seqEfe = w.next(g.founder);
  const efemero = w.id('role', g.founder, seqEfe);
  b.submitSeq('role.create', g.founder, seqEfe, { name: 'Efêmero', color: 4, permissions: [1], mentionable: false });
  b.submit('role.update', g.founder, { roleId: efemero, color: 5 });
  const founderRank = w.state.roles.get(g.founderRoleId)?.rank as string;
  b.submit('role.move', g.founder, { roleId: modRole, afterRank: founderRank });
  b.submit('member.setRoles', g.founder, { targetKey: pick(0).publicKey, roleIds: [g.baseRoleId, modRole] });
  b.submit('role.delete', g.founder, { roleId: efemero });

  // ── Comunidade e sucessão ──────────────────────────────────────────────────────────────
  b.submit('community.update', g.founder, { description: 'Descrição da comunidade' });
  b.submit('community.setSuccessors', g.founder, { successorKeys: [pick(0).publicKey, pick(1).publicKey] });
  b.submit('community.escrow', g.founder, { targetKey: pick(0).publicKey, wrappedSeed: Buffer.from('semente-envelopada') });
  // R-18(a): sem origem na gênese, a prova universal recusa — mas o `kind` fica coberto.
  b.submit('community.assumeHost', g.founder, { newHostKey: pick(0).publicKey, observedHostTs: T0, proof: ZERO64 });

  // ── Convites e identidade ──────────────────────────────────────────────────────────────
  const convite = keypairFromSeed('convite-corpus');
  b.submit('invite.create', g.founder, { invitePublicKey: convite.publicKey, maxUses: 3, label: 'convite do corpus' });
  const novo = keypairFromSeed('novato');
  b.submit('member.join', novo, {
    invitePublicKey: convite.publicKey,
    joinProof: joinProof(w.core.publicKey, convite, novo.publicKey),
    displayName: 'Novato',
    avatarColor: 2,
    blobsCoreKey: keypairFromSeed('mb-novato').publicKey,
  });
  members.push(novo);
  b.submit('member.setNickname', novo, { nickname: 'O novo' });
  b.submit('member.setBlobsCore', novo, { blobsCoreKey: keypairFromSeed('mb-novato-2').publicKey });
  b.submit('identity.update', pick(2), { displayName: 'Membro Dois', avatarColor: 7 });
  const convite2 = keypairFromSeed('convite-revogado');
  b.submit('invite.create', g.founder, { invitePublicKey: convite2.publicKey });
  b.submit('invite.revoke', g.founder, { invitePublicKey: convite2.publicKey });

  // ── Relay ──────────────────────────────────────────────────────────────────────────────
  const relayKp = keypairFromSeed('relay-corpus');
  const relayAutor = pick(1);
  b.submit('relay.volunteer', relayAutor, {
    relayPublicKey: relayKp.publicKey,
    expiresAt: T0 + 86_400_000,
    // R-19/A-05: posse é assinatura dos 32 bytes crus com a identidade do autor.
    possession: sign(relayKp.publicKey, relayAutor.secretKey),
  });
  b.submit('relay.withdraw', relayAutor, {});

  // ── Mensagens: o grosso do corpus ──────────────────────────────────────────────────────
  const pickMsg = (i: number): Keypair => members[i % members.length] as Keypair;

  // ── Threads (depois das primeiras mensagens: a raiz precisa existir) ───────────────────
  const enesima = (channelId: string, n: number): string => {
    let i = 0;
    for (const [id, m] of w.state.messages) {
      if (m.channelId === channelId && i++ === n) return id;
    }
    throw new Error('corpus sem mensagem');
  };
  const thrAutor = pick(4);
  for (let i = 0; i < 2; i++) {
    const autor = pickMsg(i);
    const seq = w.next(autor);
    b.submitSeq('message.send', autor, seq, { channelId: g.channelId, content: `semente ${i}`, mentions: [] });
  }
  const seqThr1 = w.next(thrAutor);
  const thr1 = w.id('thread', thrAutor, seqThr1, `channel:${g.channelId}`);
  b.submitSeq('thread.create', thrAutor, seqThr1, { rootMessageId: enesima(g.channelId, 0) });
  const seqThr2 = w.next(thrAutor);
  const thr2 = w.id('thread', thrAutor, seqThr2, `channel:${g.channelId}`);
  b.submitSeq('thread.create', thrAutor, seqThr2, { rootMessageId: enesima(g.channelId, 1) });

  for (let i = 0; i < 3_800; i++) {
    const autor = pickMsg(i);
    const canal: string = i % 2 === 0 ? g.channelId : ch2;
    const seq = w.next(autor);
    const msgId = w.id('message', autor, seq, `channel:${canal}`);
    const hostTs = b.ts();
    const payload: PayloadOf<'message.send'> = {
      channelId: canal,
      content: `Mensagem ${i} do corpus de determinismo`,
      mentions: i % 7 === 0 ? [g.founder.publicKey.toString('hex')] : [],
    };
    if (i % 37 === 0) payload.threadId = i % 2 === 0 ? thr1 : thr2;
    if (i % 53 === 0) {
      const blob = keypairFromSeed(`blob-${i % 97}`);
      payload.attachment = {
        blob: { blobsCoreKey: autor.publicKey, byteOffset: 0, blockOffset: 0, blockLength: 1, byteLength: 64 },
        name: `arquivo-${i}.bin`,
        sizeBytes: 64,
        kind: 1,
        hash: blob.publicKey,
      };
    }
    b.submitSeq('message.send', autor, seq, payload);
    if (i % 11 === 0) {
      b.submit('reaction.set', pickMsg(i + 3), {
        messageId: msgId,
        emoji: i % 2 === 0 ? '👍' : '🔥',
        present: true,
      });
    }
    if (i % 29 === 0) b.submit('message.pin', g.founder, { messageId: msgId, pinned: true });
    if (i % 43 === 0) b.submit('message.edit', autor, { messageId: msgId, content: `Mensagem ${i} editada` });
    if (i % 61 === 0) b.submit('message.delete', autor, { messageId: msgId });
  }

  // ── Moderação e saídas ─────────────────────────────────────────────────────────────────
  const alvo = pick(5);
  const mod = pick(0);
  b.submit('mod.timeout', mod, { targetKey: alvo.publicKey, until: T0 + 60_000, reason: 'corpus' });
  b.submit('mod.removeTimeout', mod, { targetKey: alvo.publicKey });
  b.submit('mod.ban', mod, { targetKey: alvo.publicKey, reason: 'corpus' });
  b.submit('mod.revokeBan', mod, { targetKey: alvo.publicKey });
  b.submit('mod.kick', mod, { targetKey: pick(6).publicKey, reason: 'corpus' });
  b.submit('member.leave', pick(7), {});
  b.submit('member.leave', pick(8), {});
  b.submit('community.end', g.founder, { reason: 'fim do corpus' });

  // ── Registros deliberadamente inválidos (≥ 200) ────────────────────────────────────────
  for (let i = 0; i < 120; i++) {
    const autor = pick(i);
    const now = T0 + 600_000 + i;
    // assinatura de autor falsa (estágio 4)
    b.invalid({ kind: 'message.send', author: autor, hostTs: now, corruptSig: true, payload: { channelId: g.channelId, content: 'assinatura falsa', mentions: [] } });
    // carimbo fora da janela de 24 h (R-2)
    b.invalid({ kind: 'message.send', author: autor, hostTs: now, ts: now - 100_000_000, payload: { channelId: g.channelId, content: 'fora da janela', mentions: [] } });
    // comunidade encerrada já (estágio 5)
    b.invalid({ kind: 'channel.create', author: autor, hostTs: now, payload: { categoryId: cat2, type: 0, name: `pos-end-${i}`, readOnlyForRoleIds: [] } });
    // autor não membro (estágio 8)
    const alien = keypairFromSeed(`alien-${i % 31}`);
    b.invalid({ kind: 'message.send', author: alien, hostTs: now, payload: { channelId: g.channelId, content: 'não é membro', mentions: [] } });
    // teto absoluto de bytes, antes de qualquer decode (estágio 0)
    b.pushRaw({ kind: 'message.send', author: autor, hostTs: now, padding: 70_000, payload: { channelId: g.channelId, content: 'registro enorme', mentions: [] } });
    // hostSig falsa (estágio 1)
    b.pushRaw({ kind: 'message.send', author: autor, hostTs: now, corruptHostSig: true, payload: { channelId: g.channelId, content: 'hostSig falsa', mentions: [] } });
    // kind desconhecido (estágio 2)
    b.pushRaw({ kind: 'message.send', author: autor, hostTs: now, kindNumber: 255, payload: { channelId: g.channelId, content: 'kind desconhecido', mentions: [] } });
    // autorSeq repetido (estágio 6)
    b.pushRaw({ kind: 'message.send', author: autor, authorSeq: 1, hostTs: now, payload: { channelId: g.channelId, content: 'duplicata', mentions: [] } });
  }

  return b.done();
}
