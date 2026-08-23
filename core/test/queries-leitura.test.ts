// §50 — as consultas de leitura de §15.6 sobre a `view.db`, no caminho de produto inteiro:
// nada de linha plantada. A comunidade nasce por `community.create`, as mensagens entram
// pela outbox e pelo host local, o `projector` materializa, e só então as queries respondem.
//
// O que cada asserção fixa:
//   §15.6   — a forma do `MessageDto` e dos derivados (reações, anexo, thread, links);
//   §23.2   — ordenação: mensagem em `seq` crescente, fixadas/arquivos/links decrescente;
//   §23.3   — cursor `(seq,id)` bidirecional, com lote e `hasMore`;
//   §15.6.1 — cursor opaco: forma inválida é `E_BAD_CURSOR`, nunca resultado errado.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { openViewDb, type ViewDb } from '../src/l0/view/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import { MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import { bootCore, type CoreRuntime } from '../src/composition/boot.ts';
import { MAX_LINKS_PER_MESSAGE, extractLinks } from '../src/l1/fold/index.ts';
import { decodeCursor, encodeCursor } from '../src/composition/queries.ts';
import { tempDir } from './helpers/composition.ts';
import { T0, keypairFromSeed } from './helpers/world.ts';

const DATA_KEY = Buffer.alloc(32, 50);

type Resposta = { ok: boolean; data: unknown; code: string | null };

async function rig(rotulo: string, opts: { pickFile?: (communityId: string) => { path: string; sizeBytes: number } | null } = {}) {
  const dir = tempDir(rotulo);
  const manifest = new ManifestDb(path.join(dir, 'manifest.db'));
  const view = openViewDb(path.join(dir, 'view.db'));
  const [coreSide, rendererSide] = MemoryIpcPort.createPair();
  const identity = keypairFromSeed(`${rotulo}-eu`);
  const runtime: CoreRuntime = await bootCore({
    dataDir: dir,
    manifest,
    view,
    swarm: new Swarm(),
    dataKey: DATA_KEY,
    identity: () => identity,
    identityProfile: () => ({ displayName: 'Dona Raiz', avatarColor: 3 }),
    foldBuildId: 'queries-50',
    ipcPort: coreSide,
    epoch: 1,
    tokenVerifier: { consume: () => true },
    hostTurnSecret: () => Buffer.alloc(32, 7),
    ...(opts.pickFile !== undefined ? { pickFile: opts.pickFile } : {}),
    now: () => T0 + 1_000,
    schedule: () => 0,
    cancel: () => {},
  });
  // §11.4 agrupa por `setTimeout` **unref**: sem rede, nada segura o event loop do rig.
  const vivo = setInterval(() => {}, 5);

  async function request(cmd: string, arg: unknown): Promise<Resposta> {
    const id = 9000 + Math.floor(Math.random() * 1000);
    const resposta = new Promise<Resposta>((resolve) => {
      rendererSide.onMessage((frame) => {
        if (frame.t === 'res' && frame.id === id) resolve({ ok: frame.ok, data: frame.data, code: frame.err?.code ?? null });
      });
    });
    rendererSide.postMessage({ t: 'req', epoch: 1, id, cmd, arg, authToken: 'ok' });
    return await resposta;
  }

  return {
    runtime,
    identity,
    view,
    request,
    /**
     * Enfileira → `flush` explícito → espera o `projector` alcançar (§10.5) → `reconcile`.
     *
     * Os três passos manuais são o preço de um rig sem relógio: `schedule` é no-op, então
     * nem o flush de 1 s nem a reconciliação de 30 s (§22.1) acontecem sozinhos. E sem a
     * reconciliação a op fica `awaiting-confirmation`, que **bloqueia o canal** na fila
     * (§11.3): a segunda mensagem nunca sairia.
     */
    async enviar(communityId: string, cmd: string, arg: Record<string, unknown>): Promise<Resposta> {
      const r = await request(cmd, { communityId, ...arg });
      assert.ok(r.ok, `${cmd} recusou: ${JSON.stringify(r)}`);
      const c = runtime.get(communityId)!;
      await c.outbox!.flush();
      const alvo = c.core.length - 1;
      const limite = Date.now() + 20_000; // folga para a suíte inteira em paralelo
      while (c.projector.interpretedSeq < alvo && Date.now() < limite) await new Promise((res) => setTimeout(res, 5));
      assert.ok(c.projector.interpretedSeq >= alvo, `o projector parou em ${c.projector.interpretedSeq}, esperava ${alvo}`);
      c.outbox!.reconcile();
      return r;
    },
    async close() {
      clearInterval(vivo);
      await runtime.close();
      view.close();
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    },
  };
}

/** O id da última mensagem projetada no canal — `message.send` responde `opId`, não id. */
function ultimaMensagem(r: { view: ViewDb }, communityId: string, channelId: string): string {
  const row = r.view
    .prepare('SELECT id FROM messages WHERE community_id = ? AND channel_id = ? ORDER BY seq DESC LIMIT 1')
    .get(communityId, channelId) as { id: string } | undefined;
  assert.ok(row !== undefined, 'nenhuma mensagem projetada no canal');
  return row.id;
}

describe('§50 extração de links (§15.6.1, DR-38) — regra do `fold`', () => {
  it('só `http`/`https`, na ordem, sem repetir, no máximo 8', () => {
    const oito = Array.from({ length: 10 }, (_, i) => `https://e${i}.org/x`).join(' ');
    assert.equal(extractLinks(oito).length, MAX_LINKS_PER_MESSAGE);
    assert.deepEqual(
      extractLinks('veja https://b.org/2 e antes https://a.org/1').map((l) => l.url),
      ['https://b.org/2', 'https://a.org/1'],
      'a ordem é a de aparição, não alfabética',
    );
    assert.equal(extractLinks('https://a.org/1 https://a.org/1').length, 1, 'a mesma URL não entra duas vezes');
    assert.deepEqual(extractLinks('ftp://a.org/x mailto:x@a.org javascript:alert(1)'), [], 'esquema fora da allowlist não é link');
    assert.deepEqual(extractLinks(null), []);
    assert.deepEqual(extractLinks(''), []);
  });

  it('`host` é o hostname, sem porta, sem credenciais e em minúsculas', () => {
    assert.equal(extractLinks('https://Exemplo.ORG/a')[0]!.host, 'exemplo.org');
    assert.equal(extractLinks('https://exemplo.org:8443/a')[0]!.host, 'exemplo.org');
    assert.equal(extractLinks('https://user:senha@exemplo.org/a')[0]!.host, 'exemplo.org');
    // Entrada que a `URL` recusa não vira link — silêncio, nunca exceção (§8.5).
    assert.deepEqual(extractLinks('https://'), []);
  });
});

describe('§50 leitura de §15.6 — estrutura, mensagens e derivados', { timeout: 120_000 }, () => {
  it('cursor opaco: forma inválida é `E_BAD_CURSOR`, ida e volta preserva `(seq,id)`', () => {
    const c = encodeCursor({ seq: 42, id: 'msg-abc' });
    assert.deepEqual(decodeCursor(c), { seq: 42, id: 'msg-abc' });
    for (const ruim of ['', 'nao-base64!!', Buffer.from('{}', 'utf8').toString('base64url'), Buffer.from('{"seq":"x","id":"y"}').toString('base64url')]) {
      assert.throws(
        () => decodeCursor(ruim),
        (e: { code?: string }) => e.code === 'E_BAD_CURSOR',
        `cursor "${ruim}" não recusou`,
      );
    }
  });

  it('`query.structure` traz a gênese: categoria GERAL, canal #geral, nada mudo nem recolhido', async () => {
    const r = await rig('estrutura-50');
    try {
      const criada = await r.request('community.create', { name: 'Raiz', iconColor: 1 });
      const { communityId, defaultChannelId } = criada.data as { communityId: string; defaultChannelId: string };

      const estrutura = await r.request('query.structure', { communityId });
      assert.ok(estrutura.ok, `query.structure recusou: ${JSON.stringify(estrutura)}`);
      const { categories } = estrutura.data as {
        categories: Array<{ id: string; name: string; collapsed: boolean; channels: Array<Record<string, unknown>> }>;
      };
      assert.equal(categories.length, 1, 'a gênese tem uma categoria (§19.1)');
      assert.equal(categories[0]!.collapsed, false);
      assert.equal(categories[0]!.channels.length, 1);
      const canal = categories[0]!.channels[0]!;
      assert.equal(canal['id'], defaultChannelId, 'o canal da gênese é o `defaultChannelId`');
      assert.equal(canal['readOnly'], false, 'o fundador não tem cargo em `readOnlyForRoleIds`');
      assert.equal(canal['muted'], false);
      assert.deepEqual(canal['unread'], { count: 0, mentions: 0 }, 'sem produtor de leitura, o estado inicial é zero');

      const semComunidade = await r.request('query.structure', { communityId: 'f'.repeat(64) });
      assert.equal(semComunidade.code, 'E_NOT_FOUND');
    } finally {
      await r.close();
    }
  });

  it('`query.messages` pagina em `seq` crescente, com cursor bidirecional', async () => {
    const r = await rig('mensagens-50');
    try {
      const criada = await r.request('community.create', { name: 'Raiz', iconColor: 1 });
      const { communityId, defaultChannelId } = criada.data as { communityId: string; defaultChannelId: string };
      for (let i = 1; i <= 5; i++) {
        await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: `mensagem ${i}`, mentions: [] });
      }

      const primeira = (await r.request('query.messages', { communityId, channelId: defaultChannelId, limit: 2 })).data as {
        messages: Array<{ content: string; seq: number; author: { key: string; displayName: string } }>;
        nextCursor?: string;
        hasMore: boolean;
        replication: { state: string };
      };
      assert.equal(primeira.messages.length, 2);
      assert.equal(primeira.hasMore, true);
      // §23.2 — `seq` crescente DENTRO da página, mesmo pedindo para trás (o padrão é `before`).
      assert.ok(primeira.messages[0]!.seq < primeira.messages[1]!.seq);
      assert.deepEqual(
        primeira.messages.map((m) => m.content),
        ['mensagem 4', 'mensagem 5'],
        'a página sem cursor é a mais recente',
      );
      assert.equal(primeira.messages[0]!.author.displayName, 'Dona Raiz', 'o `UserRef` vem do roster do DS');
      assert.equal(primeira.messages[0]!.author.key, r.identity.publicKey.toString('hex'));
      assert.ok(typeof primeira.replication.state === 'string');

      const anterior = (await r.request('query.messages', { communityId, channelId: defaultChannelId, cursor: primeira.nextCursor, limit: 2 })).data as {
        messages: Array<{ content: string }>;
        hasMore: boolean;
      };
      assert.deepEqual(
        anterior.messages.map((m) => m.content),
        ['mensagem 2', 'mensagem 3'],
        'a página anterior continua de onde o cursor parou',
      );

      const adiante = (await r.request('query.messages', {
        communityId,
        channelId: defaultChannelId,
        cursor: encodeCursor({ seq: 0, id: '' + 'a' }),
        direction: 'after',
        limit: 3,
      })).data as { messages: Array<{ content: string }> };
      assert.deepEqual(
        adiante.messages.map((m) => m.content),
        ['mensagem 1', 'mensagem 2', 'mensagem 3'],
        'para frente, a partir do começo',
      );

      const ruim = await r.request('query.messages', { communityId, channelId: defaultChannelId, cursor: 'nao-e-cursor!!' });
      assert.equal(ruim.code, 'E_BAD_CURSOR');
    } finally {
      await r.close();
    }
  });

  it('`query.message` junta reação, fixação, citação e thread; `query.reactors` nomeia quem reagiu', async () => {
    const r = await rig('mensagem-50');
    try {
      const criada = await r.request('community.create', { name: 'Raiz', iconColor: 1 });
      const { communityId, defaultChannelId } = criada.data as { communityId: string; defaultChannelId: string };

      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'a raiz de tudo', mentions: [] });
      const raiz = ultimaMensagem(r, communityId, defaultChannelId);
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'respondendo', mentions: [], replyToId: raiz });
      const resposta = ultimaMensagem(r, communityId, defaultChannelId);
      await r.enviar(communityId, 'message.react', { messageId: raiz, emoji: '👍', present: true });
      await r.enviar(communityId, 'message.pin', { messageId: raiz, pinned: true });
      await r.enviar(communityId, 'thread.create', { rootMessageId: raiz });

      const alvo = (await r.request('query.message', { communityId, messageId: raiz })).data as {
        pinned: boolean;
        reactions: Array<{ emoji: string; count: number; mine: boolean }>;
        thread?: { threadId: string; replyCount: number };
        hasAttachment: boolean;
        deleted: boolean;
      };
      assert.equal(alvo.pinned, true);
      assert.deepEqual(alvo.reactions, [{ emoji: '👍', count: 1, mine: true }]);
      assert.ok(alvo.thread !== undefined, 'a thread criada sobre a raiz não apareceu');
      assert.equal(alvo.hasAttachment, false);
      assert.equal(alvo.deleted, false);

      const citacao = (await r.request('query.message', { communityId, messageId: resposta })).data as {
        replyTo?: { messageId: string; excerpt: string | null; deleted: boolean; author?: { key: string } };
      };
      assert.equal(citacao.replyTo?.messageId, raiz);
      assert.equal(citacao.replyTo?.excerpt, 'a raiz de tudo');
      assert.equal(citacao.replyTo?.deleted, false);

      const reatores = (await r.request('query.reactors', { communityId, messageId: raiz, emoji: '👍' })).data as {
        total: number;
        users: Array<{ key: string; displayName: string }>;
      };
      assert.equal(reatores.total, 1);
      assert.equal(reatores.users[0]!.key, r.identity.publicKey.toString('hex'));

      // §15.6.1 — a citação sobrevive à remoção do alvo: `excerpt` some, `deleted` sobe.
      await r.enviar(communityId, 'message.delete', { messageId: raiz });
      const depois = (await r.request('query.message', { communityId, messageId: resposta })).data as {
        replyTo?: { excerpt: string | null; deleted: boolean };
      };
      assert.equal(depois.replyTo?.deleted, true);
      assert.equal(depois.replyTo?.excerpt, null);
      const removida = (await r.request('query.message', { communityId, messageId: raiz })).data as {
        deleted: boolean;
        content: string | null;
        pinned: boolean;
        reactions: unknown[];
      };
      assert.equal(removida.deleted, true);
      assert.equal(removida.content, null, 'tombstonada é `content: null` (DR-17)');
      assert.equal(removida.pinned, false, 'apagar desafixa');
      assert.deepEqual(removida.reactions, [], 'apagar leva as reações junto (§6.9)');
    } finally {
      await r.close();
    }
  });

  it('`query.pinned`, `query.links` e `query.thread` respondem sobre o mesmo canal', async () => {
    const r = await rig('listas-50');
    try {
      const criada = await r.request('community.create', { name: 'Raiz', iconColor: 1 });
      const { communityId, defaultChannelId } = criada.data as { communityId: string; defaultChannelId: string };

      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'olha https://exemplo.org/a e https://outro.dev/b', mentions: [] });
      const comLinks = ultimaMensagem(r, communityId, defaultChannelId);
      await r.enviar(communityId, 'message.pin', { messageId: comLinks, pinned: true });
      await r.enviar(communityId, 'thread.create', { rootMessageId: comLinks });
      const threadId = [...r.runtime.get(communityId)!.projector.ds.rootOfThread.keys()][0]!;
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'na thread', mentions: [], threadId });

      const fixadas = (await r.request('query.pinned', { communityId, channelId: defaultChannelId })).data as { items: Array<{ id: string }>; hasMore: boolean };
      assert.deepEqual(fixadas.items.map((m) => m.id), [comLinks]);
      assert.equal(fixadas.hasMore, false);

      const links = (await r.request('query.links', { communityId, channelId: defaultChannelId })).data as {
        items: Array<{ url: string; host: string; messageId: string }>;
      };
      assert.equal(links.items.length, 2, 'o `fold` extrai os dois links (DR-38)');
      assert.deepEqual(new Set(links.items.map((l) => l.url)), new Set(['https://exemplo.org/a', 'https://outro.dev/b']));
      assert.equal(links.items[0]!.messageId, comLinks);

      const thread = (await r.request('query.thread', { communityId, threadId })).data as {
        root: { id: string };
        replies: Array<{ content: string }>;
        replyCount: number;
        participants: Array<{ key: string }>;
        unread: { count: number };
      };
      assert.equal(thread.root.id, comLinks);
      assert.deepEqual(thread.replies.map((m) => m.content), ['na thread']);
      assert.equal(thread.replyCount, 1);
      assert.equal(thread.participants.length, 1);
      assert.deepEqual(thread.unread, { count: 0 });

      const inexistente = await r.request('query.thread', { communityId, threadId: 'th-nao-existe' });
      assert.equal(inexistente.code, 'E_NOT_FOUND');
    } finally {
      await r.close();
    }
  });

  it('`query.files` traz o anexo com o estado do cache local (§10.1)', async () => {
    const dirFixture = tempDir('fixture-50');
    const arquivo = path.join(dirFixture, 'relatorio.pdf');
    const conteudo = Buffer.alloc(3000, 9);
    fs.writeFileSync(arquivo, conteudo);
    const r = await rig('arquivos-50', { pickFile: () => ({ path: arquivo, sizeBytes: conteudo.byteLength }) });
    try {
      const criada = await r.request('community.create', { name: 'Raiz', iconColor: 1 });
      const { communityId, defaultChannelId } = criada.data as { communityId: string; defaultChannelId: string };

      const ticket = (await r.request('file.pickForAttachment', { communityId })).data as { ticketId: string };
      const staged = (await r.request('blob.stage', { ticketId: ticket.ticketId })).data as { hash: string; sizeBytes: number };
      await r.enviar(communityId, 'message.send', {
        channelId: defaultChannelId,
        content: 'segue em anexo',
        mentions: [],
        attachment: { ticketId: ticket.ticketId },
      });

      const arquivos = (await r.request('query.files', { communityId, channelId: defaultChannelId })).data as {
        items: Array<{ messageId: string; at: number; author: { key: string }; attachment: Record<string, unknown> }>;
      };
      assert.equal(arquivos.items.length, 1);
      const anexo = arquivos.items[0]!.attachment;
      assert.equal(anexo['name'], 'relatorio.pdf');
      assert.equal(anexo['sizeBytes'], conteudo.byteLength);
      assert.equal(anexo['hash'], staged.hash);
      // O autor já tem os bytes: o `stage` registra o blob como `downloaded` no cache local.
      assert.equal(anexo['state'], 'downloaded');
      assert.equal(anexo['progress'], 1);
      assert.ok(typeof anexo['localPath'] === 'string');

      const mensagem = (await r.request('query.message', { communityId, messageId: arquivos.items[0]!.messageId })).data as {
        hasAttachment: boolean;
        attachment?: { name: string };
      };
      assert.equal(mensagem.hasAttachment, true);
      assert.equal(mensagem.attachment?.name, 'relatorio.pdf');
    } finally {
      await r.close();
      fs.rmSync(dirFixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  });
});
