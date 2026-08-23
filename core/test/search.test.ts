// Testes do `search` — pipeline de texto de §23.1 (normalização, tokenização, MATCH DR-39)
// e a consulta FTS5 sobre o Estado de Conteúdo com os filtros, exclusões, escopo e tetos
// normativos de §23.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { openViewDb, type ViewDb } from '../src/l0/view/index.ts';
import {
  SEARCH_DEFAULT_LIMIT_PER_GROUP,
  SEARCH_MAX_LIMIT_PER_GROUP,
  SearchService,
  buildFtsMatch,
  normalizeText,
  tokenize,
} from '../src/l2/search/index.ts';

// ─── Pipeline de texto puro (§23.1) ─────────────────────────────────────────────────────

describe('search/text — §23.1', () => {
  it('normalizeText: NFD → remove diacrítico → minúsculo (a mesma função do frontend)', () => {
    assert.equal(normalizeText('Revisão'), 'revisao');
    assert.equal(normalizeText('CONFIGURAÇÃO'), 'configuracao');
    assert.equal(normalizeText('ação é'), 'acao e');
  });

  it('tokenize: split por não-alfanumérico; tokens de 1 caractere são descartados', () => {
    assert.deepEqual(tokenize('revisão'), ['revisao']);
    assert.deepEqual(tokenize('Eu revisei o PR #42!'), ['eu', 'revisei', 'pr', '42']);
    // "a", "e" e "o" caem — têm 1 caractere
    assert.deepEqual(tokenize('a e i o revisão'), ['revisao']);
    assert.deepEqual(tokenize('   '), []);
    assert.deepEqual(tokenize('!!! ...'), []);
  });

  it('buildFtsMatch (DR-39): operadores viram literais; só o último token ganha prefixo', () => {
    assert.equal(buildFtsMatch(['revisao']), '"revisao"*');
    assert.equal(buildFtsMatch(['mensagem', 'antiga']), '"mensagem" "antiga"*');
    // AND/OR/NOT/NEAR/* /^/: nunca são operadores — cada token é citado
    assert.equal(buildFtsMatch(['near', 'or', 'not']), '"near" "or" "not"*');
    assert.equal(buildFtsMatch(['42']), '"42"*');
    // aspas interna escapada por duplicação (defensivo: tokenize já separa aspas)
    assert.equal(buildFtsMatch(['a"b']), '"a""b"*');
    assert.equal(buildFtsMatch([]), null);
  });
});

// ─── Serviço sobre view.db ──────────────────────────────────────────────────────────────

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

type MessageFixture = {
  id: string;
  seq: number;
  channelId?: string;
  authorKey?: Buffer;
  content: string | null;
  hostTs: number;
  pinned?: boolean;
  deletedAt?: number | null;
  hiddenByBan?: boolean;
  orphaned?: boolean;
};

const ALICE = Buffer.alloc(32, 1);
const BOB = Buffer.alloc(32, 2);

function rig(): { view: ViewDb; service: SearchService; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-search-'));
  const view = openViewDb(path.join(dir, 'view.db'));
  const service = new SearchService({ view, clock: { now: () => NOW } });

  view.prepare(
    "INSERT INTO channels (community_id, id, category_id, type, name, topic, rank, read_only_role_ids) VALUES ('c1', 'ch-geral', 'cat-a', 0, 'geral', NULL, 'a0', '[]')",
  ).run();
  view.prepare(
    "INSERT INTO channels (community_id, id, category_id, type, name, topic, rank, read_only_role_ids) VALUES ('c1', 'ch-projetos', 'cat-a', 0, 'projetos', NULL, 'a1', '[]')",
  ).run();
  view.prepare(
    "INSERT INTO channels (community_id, id, category_id, type, name, topic, rank, read_only_role_ids) VALUES ('c1', 'ch-config', 'cat-b', 0, 'Configuração', NULL, 'b0', '[]')",
  ).run();
  view.prepare(
    "INSERT INTO channels (community_id, id, category_id, type, name, topic, rank, read_only_role_ids) VALUES ('c1', 'ch-voz', 'cat-b', 1, 'voz-geral', NULL, 'b1', '[]')",
  ).run();

  const member = view.prepare(
    'INSERT INTO members (community_id, identity_key, display_name, avatar_color, nickname, joined_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  member.run('c1', ALICE, 'Alice', '#ff0000', null, 0);
  member.run('c1', BOB, 'Roberto', '#00ff00', 'Bobi', 0);
  member.run('c1', Buffer.alloc(32, 3), 'Carla', '#0000ff', null, 0); // fica
  view.prepare(
    'UPDATE members SET left_at = ? WHERE community_id = ? AND identity_key = ?',
  ).run(NOW, 'c1', Buffer.alloc(32, 3));
  member.run('c1', Buffer.alloc(32, 4), 'Davi', '#f0f000', 'Deds', 0);
  view.prepare(
    'UPDATE members SET banned = 1 WHERE community_id = ? AND identity_key = ?',
  ).run('c1', Buffer.alloc(32, 4));

  return { view, service, dir };
}

function insertMessage(view: ViewDb, m: MessageFixture): void {
  view.prepare(
    'INSERT INTO messages (community_id, id, seq, channel_id, author_key, content, author_ts, host_ts, clock_skewed, pinned, deleted_at, hidden_by_ban, orphaned)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
  ).run(
    'c1',
    m.id,
    m.seq,
    m.channelId ?? 'ch-geral',
    m.authorKey ?? ALICE,
    m.content,
    m.hostTs,
    m.hostTs,
    m.pinned === true ? 1 : 0,
    m.deletedAt ?? null,
    m.hiddenByBan === true ? 1 : 0,
    m.orphaned === true ? 1 : 0,
  );
  if (m.content !== null) {
    // Espelho do ftsIndex do projector (§10.3): rowid = messages.rowid, na mesma transação.
    view.prepare(
      'INSERT INTO messages_fts(rowid, content) SELECT rowid, ? FROM messages WHERE community_id = ? AND id = ?',
    ).run(m.content, 'c1', m.id);
  }
}

function ids(result: { messages: ReadonlyArray<{ id: string }> }): string[] {
  return result.messages.map((m) => m.id);
}

describe('search/service — consulta FTS5 sobre CS (§23)', () => {
  const ctx = rig();
  const { view, service } = ctx;

  // Corpus: "revisão" em vários estados; bulk para tetos de paginação.
  insertMessage(view, { id: 'm1', seq: 1, content: 'primeira revisão do documento', hostTs: NOW - 40 * DAY });
  insertMessage(view, { id: 'm2', seq: 2, channelId: 'ch-projetos', content: 'REVISÃO final aprovada', hostTs: NOW - 2 * DAY, authorKey: BOB, pinned: true });
  insertMessage(view, { id: 'm3', seq: 3, content: 'revisor aceito o texto', hostTs: NOW - 26 * HOUR, pinned: false });
  insertMessage(view, { id: 'm4', seq: 4, content: 'revisão apagada', hostTs: NOW - HOUR, deletedAt: NOW });
  insertMessage(view, { id: 'm5', seq: 5, content: 'revisão oculta por ban', hostTs: NOW - HOUR, hiddenByBan: true });
  insertMessage(view, { id: 'm6', seq: 6, content: 'revisão órfã', hostTs: NOW - HOUR, orphaned: true });
  insertMessage(view, { id: 'm7', seq: 7, channelId: 'ch-voz', content: 'conversa de voz sobre revisão', hostTs: NOW - HOUR });
  for (let i = 8; i <= 32; i++) {
    insertMessage(view, { id: `b${i}`, seq: i, content: `bulk revisão ${i}`, hostTs: NOW - HOUR });
  }

  // Filtros kind: m2 fixada; m3 com link e anexo.
  view.prepare(
    "INSERT INTO attachments (community_id, message_id, owner_key, blobs_core_key, blob_id, name, size_bytes, kind, hash) VALUES ('c1', 'm3', x'01', x'02', '{}', 'arquivo.txt', 10, 0, x'03')",
  ).run();
  view.prepare(
    "INSERT INTO message_links (community_id, message_id, idx, url, host, seq) VALUES ('c1', 'm3', 0, 'https://exemplo.dev/a', 'exemplo.dev', 3)",
  ).run();
  // Comunidade vizinha com o mesmo texto — isolamento por community_id.
  view.prepare(
    "INSERT INTO channels (community_id, id, category_id, type, name, topic, rank, read_only_role_ids) VALUES ('c2', 'ch-x', 'cat-x', 0, 'x', NULL, 'x0', '[]')",
  ).run();
  view.prepare(
    "INSERT INTO messages (community_id, id, seq, channel_id, author_key, content, author_ts, host_ts, clock_skewed, pinned, hidden_by_ban, orphaned) VALUES ('c2', 'z1', 1, 'ch-x', x'05', 'revisão alheia', 0, 0, 0, 0, 0, 0)",
  ).run();
  view.prepare(
    "INSERT INTO messages_fts(rowid, content) SELECT rowid, 'revisão alheia' FROM messages WHERE community_id = 'c2' AND id = 'z1'",
  ).run();

  it('busca por prefixo encontra por recência (seq DESC), com canal e snippet', () => {
    const r = service.search({ communityId: 'c1', query: 'revis' });
    const found = ids(r);
    // Exclusões de §23.1: deletada (m4), hidden_by_ban (m5), orphaned (m6) e canal de voz (m7)
    // nunca aparecem; comunidade alheia (z1) não vaza.
    assert.ok(!found.includes('m4') && !found.includes('m5') && !found.includes('m6') && !found.includes('m7'));
    assert.ok(!found.includes('z1'));
    assert.ok(found.length >= 3);
    const top = r.messages[0]!;
    assert.equal(top.seq, 32); // recência, não relevância (§23.2)
    assert.ok(r.messages.every((m, i) => i === 0 || r.messages[i - 1]!.seq >= m.seq));
    assert.equal(top.channelName, 'geral');
    assert.match(top.snippet, /bulk/);
    assert.equal(typeof top.authorKeyHex, 'string');
  });

  it('prefixo casa dentro de palavra com diacrítico indexado (unicode61 remove_diacritics 2)', () => {
    const r = service.search({ communityId: 'c1', query: 'aprovada' });
    assert.deepEqual(ids(r), ['m2']); // "REVISÃO final aprovada"
    // busca-enquanto-digita: "aprov" prefixa "aprovada"
    const prefix = service.search({ communityId: 'c1', query: 'aprov' });
    assert.deepEqual(ids(prefix), ['m2']);
  });

  it('DR-39: operadores digitados são literais, nunca sintaxe do FTS5', () => {
    // "NOT" existe literalmente em m9; como operador do FTS5 ele seria negação/erro de
    // sintaxe — citado por DR-39, é só um token.
    insertMessage(view, { id: 'm9', seq: 9, content: 'use NOT para negar', hostTs: NOW - HOUR });
    assert.deepEqual(ids(service.search({ communityId: 'c1', query: 'NOT' })), ['m9']);
    // ':' e '*' são separadores de tokenização, nunca campo/operador do FTS5
    const colon = service.search({ communityId: 'c1', query: 'negar:' });
    assert.deepEqual(ids(colon), ['m9']);
  });

  it('consulta vazia sem filtros devolve os três grupos vazios', () => {
    assert.deepEqual(service.search({ communityId: 'c1', query: '' }), {
      messages: [],
      channels: [],
      members: [],
      partial: false,
    });
    // Só tokens de 1 caractere → sem texto efetivo e sem filtro → vazio
    assert.deepEqual(service.search({ communityId: 'c1', query: 'a e i' }).messages, []);
  });

  it('filtros de autor/canal/data/kind aplicados às mensagens', () => {
    assert.deepEqual(
      ids(service.search({ communityId: 'c1', query: '', filters: { authorKey: BOB } })),
      ['m2'],
    );
    assert.deepEqual(
      ids(service.search({ communityId: 'c1', query: '', filters: { channelId: 'ch-projetos' } })),
      ['m2'],
    );
    assert.deepEqual(ids(service.search({ communityId: 'c1', query: '', filters: { kind: 'pinned' } })), [
      'm2',
    ]);
    assert.deepEqual(ids(service.search({ communityId: 'c1', query: '', filters: { kind: 'attachment' } })), [
      'm3',
    ]);
    assert.deepEqual(ids(service.search({ communityId: 'c1', query: '', filters: { kind: 'link' } })), ['m3']);
    // Texto + filtro combinados
    assert.deepEqual(
      ids(service.search({ communityId: 'c1', query: 'revisão', filters: { authorKey: BOB } })),
      ['m2'],
    );
  });

  it("date: today = início do dia local; 7d/30d = janela a partir de agora, sobre host_ts", () => {
    // m3 está há 26 h — fora de "today", dentro de "7d"; m1 está há 40 dias — fora de "30d".
    assert.deepEqual(ids(service.search({ communityId: 'c1', query: 'aceito', filters: { date: 'today' } })), []);
    assert.deepEqual(ids(service.search({ communityId: 'c1', query: 'aceito', filters: { date: '7d' } })), [
      'm3',
    ]);
    const week = service.search({ communityId: 'c1', query: '', filters: { date: '7d' }, limitPerGroup: 100 });
    assert.ok(week.messages.length > 0);
    assert.ok(week.messages.every((m) => m.hostTs >= NOW - 7 * DAY));
  });

  it('scopeChannelId restringe antes dos filtros', () => {
    assert.deepEqual(
      ids(service.search({ communityId: 'c1', query: 'revisão', scopeChannelId: 'ch-projetos' })),
      ['m2'],
    );
    // Escopo e filtro apontando para canais distintos → interseção vazia
    assert.deepEqual(
      ids(
        service.search({
          communityId: 'c1',
          query: '',
          scopeChannelId: 'ch-projetos',
          filters: { channelId: 'ch-geral' },
        }),
      ),
      [],
    );
  });

  it('tetos de §23.3: 20 por grupo por padrão, expansão acima de 20 até 100', () => {
    // 25 mensagens "bulk" casam "bulk revisão" — o default corta em 20.
    assert.equal(service.search({ communityId: 'c1', query: 'bulk revisão' }).messages.length, SEARCH_DEFAULT_LIMIT_PER_GROUP);
    // Expansão "ver todos": acima do default, dentro do teto de 100
    assert.equal(service.search({ communityId: 'c1', query: 'bulk', limitPerGroup: 25 }).messages.length, 25);
    assert.equal(service.search({ communityId: 'c1', query: 'bulk', limitPerGroup: 5 }).messages.length, 5);
    // Pedido acima do teto é limitado (LIMIT ? recebe o valor clampado)
    assert.ok(service.search({ communityId: 'c1', query: 'bulk', limitPerGroup: 500 }).messages.length <= SEARCH_MAX_LIMIT_PER_GROUP);
  });

  it('isolamento por comunidade em todas as consultas', () => {
    assert.deepEqual(service.search({ communityId: 'c2', query: 'revisão' }).messages.length, 1);
    assert.equal(service.search({ communityId: 'c2', query: '' }).channels.length, 0);
  });

  it('canais respondem só ao texto, sem diacrítico, e ignoram filtros', () => {
    const r = service.search({ communityId: 'c1', query: 'configuracao', filters: { kind: 'pinned' } });
    assert.deepEqual(
      r.channels.map((c) => c.name),
      ['Configuração'],
    );
    // Sem texto, canais/membros não aparecem mesmo com filtros
    const filterOnly = service.search({ communityId: 'c1', query: '', filters: { kind: 'pinned' } });
    assert.deepEqual(filterOnly.channels, []);
    assert.deepEqual(filterOnly.members, []);
  });

  it('membros respondem ao nickname ?? displayName; saído e banido ficam fora', () => {
    const bobi = service.search({ communityId: 'c1', query: 'bobi' });
    assert.deepEqual(
      bobi.members.map((m) => m.displayName),
      ['Roberto'],
    );
    // O rótulo é o que responde: quem tem nickname não casa pelo displayName (paridade com
    // a mesma função do frontend)
    assert.deepEqual(service.search({ communityId: 'c1', query: 'roberto' }).members, []);
    // "carla" saiu; "deds" está banido
    assert.deepEqual(service.search({ communityId: 'c1', query: 'carla' }).members, []);
    assert.deepEqual(service.search({ communityId: 'c1', query: 'deds' }).members, []);
    // Ordem alfabética determinística pelo rótulo exibido
    const all = service.search({ communityId: 'c1', query: 'alice' });
    assert.equal(all.members.length, 1);
  });

  it('partial/partialReason (RT-11): ecoado da composição, nunca inventado', () => {
    const plain = service.search({ communityId: 'c1', query: 'revis' });
    assert.equal(plain.partial, false);
    assert.equal(plain.partialReason, undefined);
    const partial = service.search({ communityId: 'c1', query: 'revis', partialReason: 'host-offline' });
    assert.equal(partial.partial, true);
    assert.equal(partial.partialReason, 'host-offline');
  });

  after(() => {
    view.close();
    fs.rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });
});
