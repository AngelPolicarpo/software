/**
 * `projector` — testes funcionais contra §10.5, §10.6, §10.7, §8.4, §21.1.
 *
 * O projector é o único escritor de `view.db` (§21.1) e o único ponto onde `Effect` vira
 * SQL. Estes testes cobrem esse contrato com hypercore real e `view.db` real em arquivo —
 * nunca mock —, porque é exatamente a fronteira que §28.4 protege com hash de dump.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dumpHash, META_OP_VERSION, VIEW_SCHEMA_VERSION, type ViewDb } from '../src/l0/view/index.ts';
import type { CoreHandle } from '../src/l0/corestore/index.ts';
import { foldRecord as realFold } from '../src/l1/fold/index.ts';
import { KINDS, OP_VERSION } from '../src/l1/opCodec/index.ts';
import { Projector, deserializeDs, serializeDs } from '../src/l1/projector/index.ts';
import { genesis, joinMember, keypairFromSeed, makeRecord, type Genesis } from './helpers/world.ts';
import { BUILD_A, BUILD_B, makeProjector, setup } from './helpers/projector.ts';

function count(view: ViewDb, sql: string, ...p: unknown[]): number {
  return (view.prepare(sql).get(...p) as { n: number }).n;
}

function miniLog(): { log: Uint8Array[]; g: Genesis } {
  const g = genesis();
  const membro = joinMember(g, 'ana');
  for (let i = 0; i < 12; i++) {
    g.world.submit({
      kind: 'message.send',
      author: membro,
      hostTs: 1_755_000_000_000 + 200 + i,
      payload: { channelId: g.channelId, content: `olá ${i}`, mentions: [] },
    });
  }
  // Cópia: o mundo continua sendo usado por alguns testes depois de a foto ser tirada.
  return { log: [...g.world.log], g };
}

const buildId = BUILD_A;

describe('projector — projeção (§10.5)', () => {
  it('projeta o log inteiro: CS materializado e DS na cabeça', async () => {
    const { log, g } = miniLog();
    const h = await setup(log);
    try {
      const p = makeProjector(h, { foldBuildId: buildId });
      await p.boot();
      assert.equal(p.ds.interpretedSeq, log.length - 1);
      assert.equal(count(h.view, 'SELECT COUNT(*) AS n FROM communities WHERE community_id=?', h.communityId), 1);
      assert.equal(count(h.view, 'SELECT COUNT(*) AS n FROM messages WHERE community_id=?', h.communityId), 12);
      assert.equal(count(h.view, 'SELECT COUNT(*) AS n FROM observed_ops WHERE community_id=?', h.communityId), log.length);
      assert.equal(count(h.view, 'SELECT COUNT(DISTINCT op_id) AS n FROM observed_ops WHERE community_id=?', h.communityId), log.length);
      const observed = h.view.prepare('SELECT op_id, seq FROM observed_ops WHERE community_id=? ORDER BY seq LIMIT 1').get(h.communityId) as { op_id: string; seq: number };
      assert.deepEqual(p.observedOp(observed.op_id), { seq: observed.seq });
      assert.equal(count(h.view, 'SELECT COUNT(*) AS n FROM members WHERE community_id=?', h.communityId), 2);
      assert.equal(count(h.view, 'SELECT COUNT(*) AS n FROM roles WHERE community_id=?', h.communityId), 2);
      const comun = h.view.prepare('SELECT name, member_count FROM communities WHERE community_id=?').get(h.communityId) as {
        name: string;
        member_count: number;
      };
      assert.equal(comun.name, 'Comunidade');
      assert.equal(comun.member_count, 2); // recount memberCount
      // §10.3: a gênese não emite auditoria (R-27(d))
      assert.equal(count(h.view, 'SELECT COUNT(*) AS n FROM moderation_log WHERE community_id=?', h.communityId), 0);
      // mensagem materializada com as colunas derivadas
      const msg = h.view.prepare('SELECT seq, author_ts, host_ts, mention_everyone_effective FROM messages WHERE community_id=? ORDER BY seq LIMIT 1').get(h.communityId) as Record<string, number>;
      assert.equal(msg.seq, 8); // gênese (6) + invite + join (2)
    } finally {
      await h.close();
    }
  });

  it('uma transação por lote; notify depois do commit (§10.5 passo 5, §10.7)', async () => {
    const { log } = miniLog();
    const h = await setup(log);
    try {
      const seen: Array<{ topic: string; data: Record<string, unknown>; committed: boolean }> = [];
      const p = makeProjector(h, {
        foldBuildId: buildId,
        batch: 3,
        onEvent: (events) => {
          for (const e of events) {
            // Dentro do onEvent o commit já aconteceu: para mensagens, o próprio lote do
            // evento tem de estar materializado; para o resto, o marcador de interpretação
            // (gravado na mesma transação) tem de existir e ser não decrescente.
            const committed =
              e.topic === 'messages.appended'
                ? count(h.view, 'SELECT COUNT(*) AS n FROM messages WHERE community_id=? AND seq <= ?', h.communityId, e.data.toSeq as number) > 0
                : h.view.interpretedSeqMarker(h.communityId) !== null;
            seen.push({ topic: e.topic, data: e.data, committed });
          }
        },
      });
      await p.boot();
      assert.ok(seen.length > 0, 'notify emitido');
      for (const s of seen) {
        assert.equal(s.committed, true, `evento ${s.topic} antes do commit`);
        assert.equal(s.data.communityId, h.communityId, 'communityId presente no evento (§15.5)');
      }
      const appended = seen.filter((s) => s.topic === 'messages.appended');
      // §15.5: o evento é do **lote projetado**, não do registro — um por canal por lote, com
      // `fromSeq`/`toSeq`. Com 12 mensagens (seq 8..19) e lote 3, são 5 lotes com mensagem.
      assert.equal(appended.length, 5);
      assert.equal(appended[0]?.data.fromSeq, 8);
      assert.equal(appended.at(-1)?.data.toSeq, 19);
      // As faixas são contíguas e não se sobrepõem: nenhuma mensagem fica sem sinal.
      let esperado = 8;
      for (const a of appended) {
        assert.equal(a.data.fromSeq, esperado);
        assert.ok((a.data.toSeq as number) >= (a.data.fromSeq as number));
        esperado = (a.data.toSeq as number) + 1;
      }
      const batches = seen.filter((s) => s.topic === 'community.changed' || s.topic === 'messages.appended');
      assert.ok(batches.length >= 4); // 18 registros / lote 3 = 6 lotes
    } finally {
      await h.close();
    }
  });

  it('rejeitados vão para rejected_records, podados acima do teto (§10.3)', async () => {
    const { log, g } = miniLog();
    const appliedBeforeRejects = log.length;
    const alien = keypairFromSeed('alien-x');
    for (let i = 0; i < 5; i++) {
      // Autor não membro ⇒ REJECTED no estágio 8, com `reason` tipado.
      log.push(
        makeRecord(g.world.core, {
          kind: 'message.send',
          author: alien,
          authorSeq: i + 1,
          hostTs: 1_755_000_000_000 + 500 + i,
          payload: { channelId: g.channelId, content: `invasão ${i}`, mentions: [] },
        }),
      );
    }
    const h = await setup(log);
    try {
      const p = makeProjector(h, { foldBuildId: buildId, rejectedLogMax: 3 });
      await p.boot();
      const rows = h.view.prepare('SELECT seq, reason, kind, author_key FROM rejected_records WHERE community_id=? ORDER BY seq').all(h.communityId) as Array<{ seq: number; reason: string; kind: number | null; author_key: Buffer | null }>;
      assert.equal(rows.length, 3); // podado: só os 3 mais novos
      assert.ok(rows.every((r) => r.reason.length > 0));
      assert.equal(rows.at(-1)?.seq, log.length - 1);
      // §8.0/§10.3 — o registro atravessou o estágio 2, então `kind` e `author_key` têm fonte.
      assert.ok(rows.every((r) => r.kind === KINDS['message.send']));
      assert.ok(rows.every((r) => r.author_key !== null && alien.publicKey.equals(r.author_key)));
      assert.equal(count(h.view, 'SELECT COUNT(*) AS n FROM observed_ops WHERE community_id=?', h.communityId), appliedBeforeRejects);
    } finally {
      await h.close();
    }
  });

  it('recusa do estágio 0 é a única sem kind/author_key — §8.0, §10.3', async () => {
    const { log } = miniLog();
    // Bytes crus acima de MAX_ENVELOPE_BYTES_ATTACHMENT: o estágio 0 recusa **antes** de
    // qualquer decode, então não existe `kind` nem autor para gravar, e ninguém pode inventá-los.
    log.push(new Uint8Array(70_000).fill(7));
    const h = await setup(log);
    try {
      const p = makeProjector(h, { foldBuildId: buildId });
      await p.boot();
      const row = h.view.prepare('SELECT reason, kind, author_key FROM rejected_records WHERE community_id=? AND seq=?').get(h.communityId, log.length - 1) as { reason: string; kind: number | null; author_key: Buffer | null };
      assert.equal(row.reason, 'E_PAYLOAD_TOO_LARGE');
      assert.equal(row.kind, null);
      assert.equal(row.author_key, null);
    } finally {
      await h.close();
    }
  });

  it('meta.op_version é escrita pelo projector, no boot e na reprojeção (§10.3.1)', async () => {
    const { log } = miniLog();
    const h = await setup(log);
    try {
      assert.equal(h.view.metaGet(META_OP_VERSION), null, 'ninguém além do projector escreve');
      const p = makeProjector(h, { foldBuildId: buildId });
      await p.boot();
      assert.equal(h.view.metaGet(META_OP_VERSION), String(OP_VERSION));
      // O `wipe` da reprojeção derruba `meta` inteira; a versão de protocolo volta com ela.
      await p.reproject();
      assert.equal(h.view.metaGet(META_OP_VERSION), String(OP_VERSION));
      assert.equal(h.view.metaGet('view_schema_version'), VIEW_SCHEMA_VERSION);
    } finally {
      await h.close();
    }
  });
});

describe('projector — snapshot (§10.6)', () => {
  it('a cadência grava o snapshot e o boot continua dele (§28.4 teste 3)', async () => {
    const { log } = miniLog();
    const h = await setup(log);
    try {
      const p1 = makeProjector(h, { foldBuildId: buildId, snapshotInterval: 4 });
      await p1.boot();
      const row = h.view.prepare('SELECT interpreted_seq, fold_build_id FROM ds_snapshot WHERE community_id=?').get(h.communityId) as { interpreted_seq: number; fold_build_id: string };
      assert.equal(row.fold_build_id, buildId);
      assert.ok(row.interpreted_seq >= 0);
      // Boot de um projector novo sobre a mesma view: continua do snapshot, sem reprojeção.
      const p2 = makeProjector(h, { foldBuildId: buildId, snapshotInterval: 4 });
      await p2.boot();
      assert.equal(p2.ds.interpretedSeq, log.length - 1);
      assert.ok(h.view.interpretedSeqMarker(h.communityId) !== null);
    } finally {
      await h.close();
    }
  });

  it('foldBuildId diferente descarta o snapshot e reprojeta do zero (§10.6)', async () => {
    const { log } = miniLog();
    const h = await setup(log);
    try {
      const p1 = makeProjector(h, { foldBuildId: BUILD_A, snapshotInterval: 2 });
      await p1.boot();
      const hashA = dumpHash(h.view, h.communityId).hash;
      // Boot com outro binário: o snapshot do fold A não pode ser herdado.
      const p2 = makeProjector(h, { foldBuildId: BUILD_B, snapshotInterval: 2 });
      await p2.boot();
      const hashB = dumpHash(h.view, h.communityId).hash;
      assert.equal(hashB, hashA); // o log é o mesmo — só a origem do estado mudou
      const row = h.view.prepare('SELECT fold_build_id FROM ds_snapshot WHERE community_id=?').get(h.communityId) as { fold_build_id: string };
      assert.equal(row.fold_build_id, BUILD_B);
    } finally {
      await h.close();
    }
  });

  it('snapshot ausente ⇒ recomeça do seq 0 (§10.3), e o resultado é idêntico', async () => {
    const { log } = miniLog();
    const h = await setup(log);
    try {
      const p1 = makeProjector(h, { foldBuildId: buildId, snapshotInterval: 1_000_000 }); // nunca
      await p1.boot();
      const hash1 = dumpHash(h.view, h.communityId).hash;
      const p2 = makeProjector(h, { foldBuildId: buildId, snapshotInterval: 1_000_000 });
      await p2.boot(); // sem snapshot ⇒ reprojeção total
      assert.equal(dumpHash(h.view, h.communityId).hash, hash1);
    } finally {
      await h.close();
    }
  });
});

describe('projector — efeitos (§8.4) e a rede de segurança (§8.5)', () => {
  it('ban esconde e tira da FTS; revokeBan reexibe **e** reindexa (§8.4, H-20)', async () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    for (let i = 0; i < 4; i++) {
      g.world.submit({ kind: 'message.send', author: ana, hostTs: 1_755_000_000_000 + 300 + i, payload: { channelId: g.channelId, content: `mensagem ${i}`, mentions: [] } });
    }
    const alvoSeq = g.world.seq;
    g.world.submit({ kind: 'mod.ban', author: g.founder, hostTs: 1_755_000_000_000 + 400, payload: { targetKey: ana.publicKey, reason: 'teste' } });
    g.world.submit({ kind: 'mod.revokeBan', author: g.founder, hostTs: 1_755_000_000_000 + 401, payload: { targetKey: ana.publicKey } });
    const h = await setup(g.world.log);
    try {
      const p = makeProjector(h, { foldBuildId: buildId });
      await p.boot();
      // ban: todas as mensagens de ana ocultas; revoke: reexibidas.
      const hidden = h.view.prepare('SELECT COUNT(*) AS n FROM messages WHERE community_id=? AND hidden_by_ban=1').get(h.communityId) as { n: number };
      assert.equal(hidden.n, 0);
      const banned = h.view.prepare('SELECT COUNT(*) AS n FROM bans WHERE community_id=? AND revoked_at IS NOT NULL').get(h.communityId) as { n: number };
      assert.equal(banned.n, 1);
      // §8.4 `ftsIndexScope`: o revoke devolve as quatro mensagens à busca. Era exatamente
      // isto que faltava — §18.2 promete reversibilidade, e sem a forma inversa as mensagens
      // voltavam às listagens e ficavam fora da busca para sempre.
      const fts = h.view.prepare('SELECT COUNT(*) AS n FROM messages_fts').get() as { n: number };
      assert.equal(fts.n, 4);
      const achadas = h.view
        .prepare("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'mensagem'")
        .get() as { n: number };
      assert.equal(achadas.n, 4, 'as mensagens do banido perdoado precisam voltar à busca');
      // a auditoria registrou ban e revokeBan
      const audit = h.view.prepare('SELECT type FROM moderation_log WHERE community_id=? ORDER BY seq').all(h.communityId) as Array<{ type: string }>;
      assert.deepEqual(audit.map((a) => a.type), ['ban', 'revokeBan']);
      assert.ok(alvoSeq > 0);
    } finally {
      await h.close();
    }
  });

  it('R-28 — ban preventivo materializa a linha em `banned` sem mexer no `member_count`', async () => {
    const g = genesis();
    joinMember(g, 'ana');
    const forasteiro = keypairFromSeed('forasteiro-proj');
    g.world.submit({
      kind: 'mod.ban',
      author: g.founder,
      hostTs: 1_755_000_000_000 + 400,
      payload: { targetKey: forasteiro.publicKey, reason: 'preventivo' },
    });
    const h = await setup(g.world.log);
    try {
      const p = makeProjector(h, { foldBuildId: buildId });
      await p.boot();

      const linha = h.view
        .prepare('SELECT display_name, banned, left_at, blobs_core_key FROM members WHERE community_id=? AND identity_key=?')
        .get(h.communityId, forasteiro.publicKey) as { display_name: string; banned: number; left_at: number | null; blobs_core_key: Buffer | null };
      assert.equal(linha.banned, 1);
      assert.equal(linha.left_at, null);
      assert.equal(linha.blobs_core_key, null, 'quem nunca entrou não publicou core de blobs');
      assert.equal(linha.display_name, forasteiro.publicKey.toString('hex').slice(0, 8));

      assert.equal(count(h.view, `SELECT COUNT(*) AS n FROM bans WHERE community_id='${h.communityId}' AND revoked_at IS NULL`), 1);
      // §8.4: a população de `memberCount` é `left_at IS NULL AND banned = 0` — fundador e ana.
      const c = h.view.prepare('SELECT member_count AS n FROM communities WHERE community_id=?').get(h.communityId) as { n: number };
      assert.equal(c.n, 2);

      // A marca `preBan` precisa sobreviver ao snapshot: é ela que impede o `member.join`
      // posterior de herdar o `joinedAt` do ban (R-28).
      const volta = deserializeDs(serializeDs(p.ds));
      assert.equal(volta.members.get(forasteiro.publicKey.toString('hex'))?.preBan, true);
      assert.equal(serializeDs(volta).toString('hex'), serializeDs(p.ds).toString('hex'));

      assert.deepEqual(h.view.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
    } finally {
      await h.close();
    }
  });

  it('a reindexação do revoke não ressuscita mensagem deletada nem órfã (§8.4)', async () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const seq = g.world.next(ana);
      g.world.submit({ kind: 'message.send', author: ana, authorSeq: seq, hostTs: 1_755_000_000_000 + 300 + i, payload: { channelId: g.channelId, content: `viva ${i}`, mentions: [] } });
      ids.push(g.world.id('message', ana, seq));
    }
    // Uma das três é apagada **antes** do ban: o tombstone zera `content` (§10.3, DR-17), e
    // reindexar por escopo não pode trazê-la de volta — o predicado é o complemento das três
    // remoções, não "tudo do autor".
    g.world.submit({ kind: 'message.delete', author: ana, hostTs: 1_755_000_000_000 + 350, payload: { messageId: ids[0] as string } });
    g.world.submit({ kind: 'mod.ban', author: g.founder, hostTs: 1_755_000_000_000 + 400, payload: { targetKey: ana.publicKey } });
    g.world.submit({ kind: 'mod.revokeBan', author: g.founder, hostTs: 1_755_000_000_000 + 401, payload: { targetKey: ana.publicKey } });
    const h = await setup(g.world.log);
    try {
      const p = makeProjector(h, { foldBuildId: buildId });
      await p.boot();
      assert.equal(count(h.view, 'SELECT COUNT(*) AS n FROM messages_fts'), 2, 'a deletada voltou à busca');
      assert.deepEqual(h.view.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
    } finally {
      await h.close();
    }
  });

  it('ban e revoke repetidos não duplicam linha na FTS — guarda de pertença nos dois sentidos', async () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    for (let i = 0; i < 3; i++) {
      g.world.submit({ kind: 'message.send', author: ana, hostTs: 1_755_000_000_000 + 300 + i, payload: { channelId: g.channelId, content: `eco ${i}`, mentions: [] } });
    }
    let ts = 1_755_000_000_000 + 400;
    for (let ciclo = 0; ciclo < 3; ciclo++) {
      g.world.submit({ kind: 'mod.ban', author: g.founder, hostTs: ts++, payload: { targetKey: ana.publicKey } });
      g.world.submit({ kind: 'mod.revokeBan', author: g.founder, hostTs: ts++, payload: { targetKey: ana.publicKey } });
    }
    const h = await setup(g.world.log);
    try {
      const p = makeProjector(h, { foldBuildId: buildId });
      await p.boot();
      // Três mensagens, três ciclos: sem a guarda, a FTS teria 9 linhas para 3 rowids.
      assert.equal(count(h.view, 'SELECT COUNT(*) AS n FROM messages_fts'), 3);
      assert.deepEqual(h.view.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
    } finally {
      await h.close();
    }
  });

  it('channel.delete orfana as mensagens e não as apaga (§8.4.1)', async () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    const w = g.world;
    const seqCat = w.next(g.founder);
    const cat2 = w.id('category', g.founder, seqCat);
    w.submit({ kind: 'category.create', author: g.founder, authorSeq: seqCat, hostTs: 1_755_000_000_000 + 299, payload: { name: 'ÁREA' } } as never);
    const seqCh = w.next(g.founder);
    const ch2 = w.id('channel', g.founder, seqCh);
    w.submit({ kind: 'channel.create', author: g.founder, authorSeq: seqCh, hostTs: 1_755_000_000_000 + 300, payload: { categoryId: cat2, type: 0, name: 'outro', readOnlyForRoleIds: [] } } as never);
    w.submit({ kind: 'message.send', author: ana, hostTs: 1_755_000_000_000 + 301, payload: { channelId: g.channelId, content: 'vai ser órfã', mentions: [] } });
    w.submit({ kind: 'channel.delete', author: g.founder, hostTs: 1_755_000_000_000 + 302, payload: { channelId: g.channelId } });
    const h = await setup(g.world.log);
    try {
      const p = makeProjector(h, { foldBuildId: buildId });
      await p.boot();
      const orphaned = h.view.prepare('SELECT COUNT(*) AS n FROM messages WHERE community_id=? AND orphaned=1').get(h.communityId) as { n: number };
      assert.equal(orphaned.n, 1);
      const total = h.view.prepare('SELECT COUNT(*) AS n FROM messages WHERE community_id=?').get(h.communityId) as { n: number };
      assert.equal(total.n, 1); // não apagada
      const ch = h.view.prepare('SELECT deleted_at FROM channels WHERE community_id=?').get(h.communityId) as { deleted_at: number };
      assert.ok(ch.deleted_at !== null);
      assert.ok(ch2 !== undefined);
    } finally {
      await h.close();
    }
  });

  it('ban repetido não corrompe a FTS contentless-delete', async () => {
    const g = genesis();
    const ana = joinMember(g, 'ana');
    for (let i = 0; i < 3; i++) {
      g.world.submit({ kind: 'message.send', author: ana, hostTs: 1_755_000_000_000 + 300 + i, payload: { channelId: g.channelId, content: `alvo ${i}`, mentions: [] } });
    }
    g.world.submit({ kind: 'mod.ban', author: g.founder, hostTs: 1_755_000_000_000 + 400, payload: { targetKey: ana.publicKey } });
    g.world.submit({ kind: 'mod.revokeBan', author: g.founder, hostTs: 1_755_000_000_000 + 401, payload: { targetKey: ana.publicKey } });
    g.world.submit({ kind: 'mod.ban', author: g.founder, hostTs: 1_755_000_000_000 + 402, payload: { targetKey: ana.publicKey } });
    g.world.submit({ kind: 'mod.revokeBan', author: g.founder, hostTs: 1_755_000_000_000 + 403, payload: { targetKey: ana.publicKey } });
    g.world.submit({ kind: 'mod.ban', author: g.founder, hostTs: 1_755_000_000_000 + 404, payload: { targetKey: ana.publicKey } });
    const h = await setup(g.world.log);
    try {
      const p = makeProjector(h, { foldBuildId: buildId });
      await p.boot();
      const integridade = h.view.pragma('integrity_check');
      assert.deepEqual(integridade, [{ integrity_check: 'ok' }]);
      const fts = h.view.prepare('SELECT COUNT(*) AS n FROM messages_fts').get() as { n: number };
      assert.equal(fts.n, 0); // ocultas e fora do índice
    } finally {
      await h.close();
    }
  });

  it('§8.5: um fold que lança é tratado como IGNORED, registra o pânico e reprojeta no boot seguinte', async () => {
    const { log } = miniLog();
    const h = await setup(log);
    try {
      const panics: Array<{ seq: number; kind: number | null }> = [];
      const seqDoPanic = 7;
      const foldQueLança: typeof realFold = (prev, raw, seq) => {
        if (seq === seqDoPanic) throw new Error('bug simulado');
        return realFold(prev, raw, seq);
      };
      const p1 = makeProjector(h, {
        foldBuildId: buildId,
        fold: foldQueLança,
        onPanic: (seq, kind) => panics.push({ seq, kind }),
      });
      await p1.boot();
      assert.equal(panics.length, 1);
      assert.equal(panics[0]?.seq, seqDoPanic);
      // O `fold` injetado lançou **para fora**: não houve `FoldResult`, logo não há `kind`.
      assert.equal(panics[0]?.kind, null);
      assert.equal(p1.metrics.panic, 1);
      assert.equal(p1.ds.interpretedSeq, log.length - 1); // continua (§8.5)
      assert.ok(h.view.foldPanicSeq(h.communityId) !== null, 'marcador persistido');

      // Boot seguinte: reprojeção total dispara pelo marcador, e o pânico some com o fold real.
      const p2 = makeProjector(h, { foldBuildId: buildId });
      await p2.boot();
      assert.equal(h.view.foldPanicSeq(h.communityId), null, 'marcador limpo pelo wipe');
      assert.equal(p2.ds.interpretedSeq, log.length - 1);
    } finally {
      await h.close();
    }
  });

  it('§8.5: quando o próprio fold captura, `fold.panic` sai com o `kind` (H-26)', async () => {
    const { log } = miniLog();
    const h = await setup(log);
    try {
      const panics: Array<{ seq: number; kind: number | null }> = [];
      const seqDoPanic = 9;
      // O `fold` real captura por dentro e devolve `IGNORED` com o `kind` do probe (§8.0). O
      // `next` volta a ser o do estado íntegro: quem corrompe o `DS` aqui é o teste, e o
      // objetivo é a métrica, não envenenar os registros seguintes.
      const foldQueCorrompeODs: typeof realFold = (prev, raw, seq, metrics) => {
        if (seq !== seqDoPanic) return realFold(prev, raw, seq, metrics);
        const podre = realFold({ ...prev, members: null } as unknown as typeof prev, raw, seq, metrics);
        return { ...podre, next: { ...prev, interpretedSeq: seq } };
      };
      const p = makeProjector(h, {
        foldBuildId: buildId,
        fold: foldQueCorrompeODs,
        onPanic: (seq, kind) => panics.push({ seq, kind }),
      });
      await p.boot();
      assert.equal(panics.length, 1);
      assert.equal(panics[0]?.seq, seqDoPanic);
      assert.equal(panics[0]?.kind, KINDS['message.send']);
    } finally {
      await h.close();
    }
  });

  it('um efeito inválido faz o lote inteiro rolar para trás — nada parcial (§10.5 passo 4)', async () => {
    const { log } = miniLog();
    const h = await setup(log);
    try {
      const foldComEfeitoRuim: typeof realFold = (prev, raw, seq) => {
        const res = realFold(prev, raw, seq);
        if (seq === 9) {
          return {
            ...res,
            effects: [...res.effects, { t: 'upsert', table: 'tabela_que_nao_existe', key: ['x'], row: { x: 1 } }] as typeof res.effects,
          };
        }
        return res;
      };
      const p = makeProjector(h, { foldBuildId: buildId, fold: foldComEfeitoRuim });
      await assert.rejects(p.boot());
      // O estado não avançou além do último lote commitado e a view não tem o lote parcial.
      assert.ok(p.ds.interpretedSeq < log.length - 1);
      assert.equal(count(h.view, 'SELECT COUNT(*) AS n FROM messages WHERE community_id=?', h.communityId), 0);
    } finally {
      await h.close();
    }
  });

  it('não reentrante (§21.3): catchUp concorrente não aplica efeito duas vezes', async () => {
    const { log } = miniLog();
    const h = await setup(log);
    try {
      const p = makeProjector(h, { foldBuildId: buildId, batch: 2 });
      await Promise.all([p.catchUp(), p.catchUp(), p.catchUp()]);
      const hash1 = dumpHash(h.view, h.communityId).hash;
      const q = makeProjector(h, { foldBuildId: buildId, batch: 2 });
      await q.boot();
      assert.equal(dumpHash(h.view, h.communityId).hash, hash1);
    } finally {
      await h.close();
    }
  });

  it('reage a `append` (§10.5 passo 6): registros que chegam depois do catchUp são projetados', async () => {
    const { log, g } = miniLog();
    const ana = joinMember(g, 'ana');
    const extra = [
      makeRecord(g.world.core, {
        kind: 'message.send',
        author: ana,
        authorSeq: g.world.next(ana),
        hostTs: 1_755_000_000_000 + 900,
        payload: { channelId: g.channelId, content: 'após o boot 1', mentions: [] },
      }),
      makeRecord(g.world.core, {
        kind: 'message.send',
        author: ana,
        authorSeq: g.world.next(ana),
        hostTs: 1_755_000_000_000 + 901,
        payload: { channelId: g.channelId, content: 'após o boot 2', mentions: [] },
      }),
    ];
    const h = await setup(log);
    try {
      // O cabo de core é a fronteira com o corestore; o teste troca a implementação por um
      // core em memória que cresce com `append`. O hypercore real está em todos os outros
      // testes — aqui o que se exercita é a reação do projector, que é o contrato do §10.5.
      const core = fakeCore(h.communityId, [...log]);
      const p = new Projector(h.view, core, { foldBuildId: buildId, batch: 4 });
      await p.boot();
      assert.equal(p.ds.interpretedSeq, log.length - 1);
      p.start();
      core.push(extra);
      await new Promise((r) => setTimeout(r, 20)); // o append dispara catchUp em background
      assert.equal(p.ds.interpretedSeq, log.length + 1, 'consumiu os appends');
      assert.equal(
        count(h.view, 'SELECT COUNT(*) AS n FROM messages WHERE community_id=? AND content LIKE ?', h.communityId, 'após o boot %'),
        2,
      );
      p.stop();
    } finally {
      await h.close();
    }
  });

  it('buraco de replicação: bloco ausente para e espera o append, sem reaplicar nem girar', async () => {
    const { log } = miniLog();
    const h = await setup(log);
    try {
      // Os três últimos blocos ainda não chegaram (replicação em curso, §10.5 passo 6).
      const gapAt = log.length - 3;
      const core = gappedCore(h.communityId, log, gapAt);
      const p = new Projector(h.view, core, { foldBuildId: buildId, batch: 4 });
      await p.boot();
      // O lote que toca o buraco é descartado inteiro: nada parcial (§10.5 passo 4), e o
      // estado para no fim do último lote **commitado**.
      assert.ok(p.ds.interpretedSeq < gapAt - 1, 'parou antes do buraco');
      assert.equal((p.ds.interpretedSeq + 1) % 4, 0, 'fronteira de lote commitado');
      const msgsAntes = count(h.view, 'SELECT COUNT(*) AS n FROM messages WHERE community_id=?', h.communityId);
      const parado = p.ds.interpretedSeq;
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(p.ds.interpretedSeq, parado, 'não girou no buraco');
      assert.equal(count(h.view, 'SELECT COUNT(*) AS n FROM messages WHERE community_id=?', h.communityId), msgsAntes);
      p.start();
      core.fill();
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(p.ds.interpretedSeq, log.length - 1, 'o append destravou o catchUp');
      p.stop();
    } finally {
      await h.close();
    }
  });
});

function fakeCore(communityId: string, blocks: Uint8Array[]): CoreHandle & { push(recs: readonly Uint8Array[]): void } {
  const listeners = new Set<() => void>();
  return {
    key: Buffer.from(communityId, 'hex'),
    get length() {
      return blocks.length;
    },
    async get(seq: number) {
      return blocks[seq] ?? null;
    },
    onAppend(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close() {},
    push(recs) {
      for (const r of recs) blocks.push(r);
      for (const l of listeners) l();
    },
  };
}

/** Core com um buraco: os blocos de `gapAt` em diante ficam `null` até `fill()`. */
function gappedCore(communityId: string, all: Uint8Array[], gapAt: number): CoreHandle & { fill(): void } {
  const blocks: Array<Uint8Array | null> = all.map((r, i) => (i < gapAt ? r : null));
  const listeners = new Set<() => void>();
  return {
    key: Buffer.from(communityId, 'hex'),
    get length() {
      return blocks.length;
    },
    async get(seq: number) {
      return blocks[seq] ?? null;
    },
    onAppend(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close() {},
    fill() {
      for (let i = gapAt; i < blocks.length; i++) blocks[i] = all[i] as Uint8Array;
      for (const l of listeners) l();
    },
  };
}
