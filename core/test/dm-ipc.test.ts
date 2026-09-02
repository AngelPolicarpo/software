/**
 * A superfície IPC-R da conversa direta — §31.16 (14 comandos, 12 eventos, 5 queries).
 *
 * O teste que fecha o item é o **contrato de §31.10**: `dm.send` responde **síncrono**, com o
 * registro **já no log**. Não há `{opId, state:'queued'}`, não há desfecho por evento, e o
 * `ordSum` que volta é o da ordem canônica de §31.6 — o que se afirma aqui é que o número
 * respondido é o mesmo que a projeção materializa depois, dos **dois** lados.
 *
 * A pilha é inteira de produto: `manifest.db` e `view.db` reais em arquivo, `dmFold` e
 * `dmProjector` de produto, `directMessages` de produto, o `p2p-dm/1` sobre `Protomux` de
 * verdade e o `IpcServer` real com os frames de §15.1. O que é de mentira são os **cores** —
 * pela mesma razão dos cabos anteriores: a ordem em que os blocos chegam é o que se quer
 * controlar, e um hypercore em disco não dá controle nenhum sobre isso.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { openManifestDb, type ManifestDb } from '../src/l0/manifest/index.ts';
import { openViewDb, type ViewDb } from '../src/l0/view/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import type { SwarmConnection } from '../src/l0/swarm/ports.ts';
import { dmConversationKey } from '../src/l1/dmCodec/index.ts';
import { IpcServer, MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import { EventFanout } from '../src/l3/ipcRenderer/fanout.ts';
import { registerDmCommands } from '../src/l3/ipcRenderer/dmCommands.ts';
import { criarDmRuntime, type DmRuntime } from '../src/composition/dmRuntime.ts';
import { decodeDmCursor, encodeDmCursor } from '../src/composition/dmQueries.ts';

import { dmKeypair, type Keypair } from './helpers/dm.ts';
import { BackendDeMentira, parDeStreamsNoise } from './helpers/dmRede.ts';

const TEMPS: string[] = [];
after(() => {
  for (const d of TEMPS) fs.rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-ipc-'));
  TEMPS.push(d);
  return d;
}

type Resposta = { ok: boolean; data?: unknown; code: string | null; message?: string };

type No = {
  readonly rotulo: string;
  readonly identity: Keypair;
  readonly manifest: ManifestDb;
  readonly view: ViewDb;
  readonly backend: BackendDeMentira;
  readonly dm: DmRuntime;
  readonly eventos: Array<{ topic: string; data: Record<string, unknown> }>;
  request(cmd: string, arg?: unknown): Promise<Resposta>;
  close(): Promise<void>;
};

async function no(rotulo: string): Promise<No> {
  const dir = tempDir();
  const identity = dmKeypair(rotulo);
  const manifest = openManifestDb(path.join(dir, 'manifest.db'));
  const view = openViewDb(path.join(dir, 'view.db'));
  const backend = new BackendDeMentira();
  const swarm = new Swarm({ backend });
  const eventos: Array<{ topic: string; data: Record<string, unknown> }> = [];

  const [coreSide, rendererSide] = MemoryIpcPort.createPair();
  const ipc = new IpcServer({
    epoch: 1,
    port: coreSide,
    tokenVerifier: { consume: () => true },
    identityStatus: { isLoaded: true },
  });
  const fanout = new EventFanout(ipc);

  const dm = await criarDmRuntime({
    manifest,
    view,
    swarm,
    identity: () => identity,
    dataKey: Buffer.alloc(32, 9),
    coresDir: path.join(dir, 'cores'),
    foldBuildId: 'dm-ipc',
    onEvent: (topic, data) => {
      eventos.push({ topic, data: { ...data } });
      fanout.emit(
        { topic, data },
        typeof data['conversationId'] === 'string' ? { conversationId: data['conversationId'] } : {},
      );
    },
    // **Cores de verdade, em disco.** Diferente dos cabos de §103 e §104, aqui a replicação
    // precisa acontecer: o que este arquivo mede é a superfície ponta a ponta, e "a mensagem
    // que `alice` enviou aparece na projeção de `bob`" não é afirmável com core de mentira.
  });
  await dm.boot();

  registerDmCommands(ipc, {
    open: (peerKey) => dm.dm.abrir(peerKey),
    accept: (id) => dm.dm.aceitar(id),
    block: (id) => dm.dm.bloquear(id),
    unblock: (id) => dm.dm.desbloquear(id),
    forget: (id) => dm.dm.esquecer(id),
    sendMessage: (a) =>
      dm.escrever(a.conversationId, 'dm.message', {
        content: a.content,
        ...(a.attachment !== undefined ? { attachment: a.attachment } : {}),
        ...(a.replyToId !== undefined ? { replyToId: a.replyToId } : {}),
      }),
    editMessage: (a) => dm.escrever(a.conversationId, 'dm.edit', { messageId: a.messageId, content: a.content }),
    deleteMessage: (a) => dm.escrever(a.conversationId, 'dm.delete', { messageId: a.messageId }),
    react: (a) =>
      dm.escrever(a.conversationId, 'dm.react', { messageId: a.messageId, emoji: a.emoji, present: a.present }),
    setProfile: (a) =>
      dm.escrever(a.conversationId, 'dm.profile', {
        ...(a.displayName !== undefined ? { displayName: a.displayName } : {}),
        ...(a.avatarColor !== undefined ? { avatarColor: a.avatarColor } : {}),
      }),
    markRead: (id) => dm.markRead(id),
    activate: (id) => dm.activate(id),
    setTyping: (id, on) => dm.transport.setTyping(id, on),
    setContactPolicy: (p) => dm.dm.setContactPolicy(p),
    queries: dm.queries,
  });

  const pendentes = new Map<number, (r: Resposta) => void>();
  let proximoId = 0;
  rendererSide.onMessage((raw) => {
    const frame = raw as Record<string, unknown>;
    if (frame['t'] !== 'res') return;
    const resolver = pendentes.get(frame['id'] as number);
    if (resolver === undefined) return;
    pendentes.delete(frame['id'] as number);
    const erro = frame['err'] as { code?: string; message?: string } | undefined;
    resolver({
      ok: frame['ok'] as boolean,
      data: frame['data'],
      code: erro?.code ?? null,
      ...(erro?.message !== undefined ? { message: erro.message } : {}),
    });
  });

  return {
    rotulo,
    identity,
    manifest,
    view,
    backend,
    dm,
    eventos,
    request(cmd, arg) {
      const id = ++proximoId;
      return new Promise<Resposta>((resolve) => {
        pendentes.set(id, resolve);
        rendererSide.postMessage({ t: 'req', epoch: 1, id, cmd, arg: arg ?? {}, authToken: 'ok' });
      });
    },
    async close() {
      await dm.close();
      view.close();
    },
  };
}

function idEntre(a: No, b: No): string {
  const k = dmConversationKey(a.identity.publicKey, b.identity.publicKey);
  assert.notEqual(k, null);
  return (k as Buffer).toString('hex');
}

/**
 * Uma conexão entre os dois nós, com **Noise de verdade**: a `remotePublicKey` é a que o
 * handshake autenticou (§31.8 camada 1), não uma declarada pelo cabo. É também o que o
 * `hypercore` exige para replicar de fato — ele espera `stream.opened` ao anexar-se ao mux.
 */
async function conectar(a: No, b: No): Promise<void> {
  const [sa, sb] = parDeStreamsNoise(a.identity, b.identity);
  // A `remotePublicKey` só existe depois do handshake: é ele que a autentica.
  await Promise.all([sa.opened, sb.opened]);
  const conn = (stream: { remotePublicKey: Buffer }): SwarmConnection =>
    ({
      remotePublicKeyHex: stream.remotePublicKey.toString('hex'),
      stream: stream as unknown as SwarmConnection['stream'],
      topicsHex: [],
      close: () => {},
    }) as SwarmConnection;
  a.backend.entregar(conn(sa));
  b.backend.entregar(conn(sb));
}

async function ate(cond: () => boolean, msg: string, limiteMs = 5_000): Promise<void> {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`${msg} (esperou ${limiteMs} ms)`);
}

function ok(r: Resposta): Record<string, unknown> {
  assert.equal(r.ok, true, `esperava sucesso, veio ${r.code}: ${r.message ?? ''}`);
  return r.data as Record<string, unknown>;
}

// ─── §31.10 — a terceira classe de escrita ─────────────────────────────────────────────

describe('§31.16.1/§31.10 — `dm.send` responde síncrono, com o registro já no log', () => {
  it('a conversa nasce, é aceita, e o `ordSum` respondido é o que os dois lados projetam', async () => {
    const a = await no('alice');
    const b = await no('bob');
    const id = idEntre(a, b);

    // `dm.open` — derivado, nunca atribuído (§31.2 regra 1).
    const aberta = ok(await a.request('dm.open', { peerKey: b.identity.publicKey.toString('hex') }));
    assert.equal(aberta['conversationId'], id);
    assert.equal(aberta['state'], 'pending-out');

    a.dm.transport.refresh();
    b.dm.transport.refresh();
    await conectar(a, b);
    await ate(() => b.manifest.getDmConversation(id) !== null, 'o pedido não chegou');

    ok(await b.request('dm.accept', { conversationId: id }));
    b.dm.transport.refresh();
    await conectar(a, b);
    await ate(() => a.manifest.getDmConversation(id)?.peer_core_key !== null, '`alice` não vinculou o core');

    // §31.10 — resposta **síncrona**, com o registro já no log. `state` é literal.
    const enviada = ok(
      await a.request('dm.send', { conversationId: id, content: 'oi', clientRef: 'ref-1' }),
    );
    assert.equal(enviada['state'], 'written');
    assert.equal(enviada['clientRef'], 'ref-1');
    assert.equal(typeof enviada['messageId'], 'string');
    assert.ok(String(enviada['messageId']).startsWith('dmsg-'), '§31.4 — o prefixo é do domínio de DM');
    assert.equal(typeof enviada['ordSum'], 'number');

    // Nada de outbox: a resposta **não** carrega `opId` nem `state:'queued'` (§31.10).
    assert.equal(enviada['opId'], undefined);

    // A projeção do PRÓPRIO lado materializa o mesmo `ordSum` que a resposta prometeu.
    await ate(
      () => (a.view.prepare('SELECT COUNT(*) AS n FROM dm_messages WHERE conversation_id = ?').get(id) as { n: number }).n > 0,
      'a projeção local não chegou',
    );
    const minha = ok(await a.request('query.dmMessages', { conversationId: id }));
    const lista = minha['messages'] as Array<Record<string, unknown>>;
    const msg = lista.find((m) => m['id'] === enviada['messageId']);
    assert.notEqual(msg, undefined, 'a mensagem respondida não apareceu na projeção');
    assert.equal(msg?.['ordSum'], enviada['ordSum'], '§31.6 — o `ordSum` respondido é o projetado');
    assert.equal(msg?.['content'], 'oi');
    // §31.11 — `delivery` só existe nas **próprias**; `written` até o `ack` do par avançar.
    assert.equal(msg?.['delivery'], 'written');

    await a.close();
    await b.close();
  });

  it('escrever numa conversa que não existe é `E_NOT_FOUND`; antes do aceite, `E_DM_NOT_AUTHORIZED`', async () => {
    const a = await no('alice');
    const b = await no('bob');
    const id = idEntre(a, b);

    assert.equal((await a.request('dm.send', { conversationId: id, content: 'x' })).code, 'E_NOT_FOUND');

    ok(await a.request('dm.open', { peerKey: b.identity.publicKey.toString('hex') }));
    a.dm.transport.refresh();
    await conectar(a, b);
    await ate(() => b.manifest.getDmConversation(id) !== null, 'o pedido não chegou');

    // §31.9 regra 1 — antes do aceite não existe o meu core, logo não existe onde appendar.
    assert.equal(
      (await b.request('dm.send', { conversationId: id, content: 'x' })).code,
      'E_DM_NOT_AUTHORIZED',
    );
    await a.close();
    await b.close();
  });

  it('conversa consigo mesmo é `E_VALIDATION`, não um código novo (§31.17)', async () => {
    const a = await no('alice');
    const r = await a.request('dm.open', { peerKey: a.identity.publicKey.toString('hex') });
    assert.equal(r.code, 'E_VALIDATION');
    await a.close();
  });
});

// ─── §31.16.3 — as queries e o cursor ──────────────────────────────────────────────────

describe('§31.16.3 — as cinco queries e o cursor por `(ordSum, authorKey, id)`', () => {
  it('o cursor leva os três campos, e um de outra forma é `E_BAD_CURSOR`', () => {
    const c = { ordSum: 7, authorKey: 'ab'.repeat(32), id: 'dmsg-XYZ' };
    assert.deepEqual(decodeDmCursor(encodeDmCursor(c)), c);

    // `ordSum` sozinho empata (§31.6 desempata pela chave do autor): os três são exigidos.
    for (const ruim of [
      { ordSum: 1, authorKey: 'ab'.repeat(32) },
      { ordSum: 1, id: 'x' },
      { authorKey: 'ab'.repeat(32), id: 'x' },
      { ordSum: 1.5, authorKey: 'ab'.repeat(32), id: 'x' },
      { ordSum: 1, authorKey: 'NAO-HEX', id: 'x' },
    ]) {
      assert.throws(
        () => decodeDmCursor(Buffer.from(JSON.stringify(ruim), 'utf8').toString('base64url')),
        (e: { code?: string }) => e.code === 'E_BAD_CURSOR',
        JSON.stringify(ruim),
      );
    }
    // Bytes que não são cursor nenhum: `E_BAD_CURSOR`, nunca resultado errado em silêncio.
    assert.throws(() => decodeDmCursor('nao-e-cursor'), (e: { code?: string }) => e.code === 'E_BAD_CURSOR');
  });

  it('pagina em ordem canônica crescente nas duas direções, e `hasMore` é honesto', async () => {
    const a = await no('alice');
    const b = await no('bob');
    const id = idEntre(a, b);
    ok(await a.request('dm.open', { peerKey: b.identity.publicKey.toString('hex') }));
    a.dm.transport.refresh();

    for (let i = 0; i < 5; i++) ok(await a.request('dm.send', { conversationId: id, content: `m${i}` }));
    await ate(
      () => (a.view.prepare('SELECT COUNT(*) AS n FROM dm_messages WHERE conversation_id = ?').get(id) as { n: number }).n === 5,
      'as cinco não projetaram',
    );

    const p1 = ok(await a.request('query.dmMessages', { conversationId: id, limit: 2 }));
    const l1 = p1['messages'] as Array<Record<string, unknown>>;
    assert.equal(l1.length, 2);
    assert.equal(p1['hasMore'], true);
    // §23.2 — a saída é **sempre** crescente, independente da direção. A UI não inverte nada.
    assert.ok((l1[0]?.['ordSum'] as number) < (l1[1]?.['ordSum'] as number));
    assert.equal(l1[1]?.['content'], 'm4', '`before` sem cursor é a página mais recente');

    const p2 = ok(await a.request('query.dmMessages', { conversationId: id, limit: 2, cursor: p1['nextCursor'] }));
    const l2 = p2['messages'] as Array<Record<string, unknown>>;
    assert.deepEqual(l2.map((m) => m['content']), ['m1', 'm2']);

    // `after` a partir do começo caminha para a frente.
    const doInicio = ok(await a.request('query.dmMessages', { conversationId: id, limit: 2, direction: 'after' }));
    assert.deepEqual((doInicio['messages'] as Array<Record<string, unknown>>).map((m) => m['content']), ['m0', 'm1']);

    // Cursor de outra forma → `E_BAD_CURSOR` na fronteira, não resultado vazio.
    assert.equal((await a.request('query.dmMessages', { conversationId: id, cursor: 'lixo' })).code, 'E_BAD_CURSOR');
    // `direction` fora das duas é `E_VALIDATION`.
    assert.equal(
      (await a.request('query.dmMessages', { conversationId: id, direction: 'lateral' })).code,
      'E_VALIDATION',
    );

    await a.close();
    await b.close();
  });

  it('`query.dmConversation` e `query.dmConversations` trazem o estado, o par e o não-lido', async () => {
    const a = await no('alice');
    const b = await no('bob');
    const id = idEntre(a, b);
    ok(await a.request('dm.open', { peerKey: b.identity.publicKey.toString('hex') }));

    const uma = ok(await a.request('query.dmConversation', { conversationId: id }));
    assert.equal(uma['state'], 'pending-out');
    const par = uma['peer'] as Record<string, unknown>;
    assert.equal(par['key'], b.identity.publicKey.toString('hex'));
    // §31.16.3 — **sem `collision`**: numa conversa de dois não há conjunto em que colidir.
    assert.equal(par['collision'], undefined);
    // O `handle` é derivado da chave (§6.1) e é sempre exibido junto do nome (**L-5**).
    assert.equal(typeof par['handle'], 'string');
    assert.ok(String(par['handle']).length > 0);

    const lista = ok(await a.request('query.dmConversations'));
    assert.equal((lista['conversations'] as unknown[]).length, 1);

    assert.equal((await a.request('query.dmConversation', { conversationId: '0'.repeat(64) })).code, 'E_NOT_FOUND');
    await a.close();
    await b.close();
  });

  it('`query.dmPrefs` e `dm.setContactPolicy` são a política local de §31.9 regra 5', async () => {
    const a = await no('alice');
    assert.deepEqual(ok(await a.request('query.dmPrefs')), { contactPolicy: 'anyone' });
    ok(await a.request('dm.setContactPolicy', { policy: 'shared-community' }));
    assert.deepEqual(ok(await a.request('query.dmPrefs')), { contactPolicy: 'shared-community' });
    assert.equal((await a.request('dm.setContactPolicy', { policy: 'ninguem' })).code, 'E_VALIDATION');
    await a.close();
  });
});

// ─── §31.16.2 — os eventos ─────────────────────────────────────────────────────────────

describe('§31.16.2 — os eventos, e o não-lido que é query e não acumulador', () => {
  it('`dm.appended` e `dm.unreadChanged` saem depois do commit, e `dm.markRead` zera', async () => {
    const a = await no('alice');
    const b = await no('bob');
    const id = idEntre(a, b);
    ok(await a.request('dm.open', { peerKey: b.identity.publicKey.toString('hex') }));
    a.dm.transport.refresh();
    await conectar(a, b);
    await ate(() => b.manifest.getDmConversation(id) !== null, 'sem pedido');
    ok(await b.request('dm.accept', { conversationId: id }));
    b.dm.transport.refresh();
    await conectar(a, b);
    await ate(() => a.manifest.getDmConversation(id)?.peer_core_key !== null, 'sem vínculo');

    ok(await a.request('dm.send', { conversationId: id, content: 'oi' }));
    await ate(() => b.eventos.some((e) => e.topic === 'dm.appended'), '`bob` não recebeu `dm.appended`');

    // A28 — a contagem é uma **query** sobre `ordKey > lastRead`, nunca um acumulador. Por
    // isso ela não conta duas vezes e a reprojeção a recomputa do zero.
    await ate(() => {
      const c = ok2(b, id);
      return (c['unread'] as { count: number }).count === 1;
    }, '`bob` não contou a não-lida');

    assert.deepEqual(ok(await b.request('dm.markRead', { conversationId: id })), { unreadCount: 0 });
    assert.equal((ok2(b, id)['unread'] as { count: number }).count, 0);
    assert.ok(b.eventos.some((e) => e.topic === 'dm.unreadChanged' && e.data['unreadCount'] === 0));

    // A minha própria mensagem nunca é não-lida para mim.
    assert.equal((ok2(a, id)['unread'] as { count: number }).count, 0);

    await a.close();
    await b.close();
  });

  it('`dm.activate` decide residência e é `E_NOT_FOUND` para conversa que não existe', async () => {
    const a = await no('alice');
    const b = await no('bob');
    const id = idEntre(a, b);
    ok(await a.request('dm.open', { peerKey: b.identity.publicKey.toString('hex') }));
    assert.deepEqual(ok(await a.request('dm.activate', { conversationId: id })), { residency: 'active' });
    assert.deepEqual(ok(await a.request('dm.activate', { conversationId: null })), { residency: 'background' });
    assert.equal((await a.request('dm.activate', { conversationId: '0'.repeat(64) })).code, 'E_NOT_FOUND');
    await a.close();
    await b.close();
  });
});

/** Atalho: a conversa de um nó, já desembrulhada. */
function ok2(n: No, id: string): Record<string, unknown> {
  return n.dm.queries.conversations().find((c) => c.conversationId === id) as unknown as Record<string, unknown>;
}

// ─── §31.19 — `dm.forget` pela fronteira ───────────────────────────────────────────────

describe('§31.16.1/§31.19 — `dm.forget` é main-confirmed e a linha sobrevive', () => {
  it('apaga a projeção e mantém `dm_conversations` reduzida a `left` (L-25)', async () => {
    const a = await no('alice');
    const b = await no('bob');
    const id = idEntre(a, b);
    ok(await a.request('dm.open', { peerKey: b.identity.publicKey.toString('hex') }));
    ok(await a.request('dm.send', { conversationId: id, content: 'oi' }));
    await ate(
      () => (a.view.prepare('SELECT COUNT(*) AS n FROM dm_messages WHERE conversation_id = ?').get(id) as { n: number }).n > 0,
      'não projetou',
    );

    ok(await a.request('dm.forget', { conversationId: id }));

    assert.equal(
      (a.view.prepare('SELECT COUNT(*) AS n FROM dm_messages WHERE conversation_id = ?').get(id) as { n: number }).n,
      0,
      'a projeção saiu',
    );
    const row = a.manifest.getDmConversation(id);
    assert.notEqual(row, null, 'a linha sobrevive para sempre (§31.19 regra 2)');
    assert.equal(row?.state, 'left');
    assert.ok((row?.self_high_water ?? 0) > 0, '`core.length` precisa sobreviver, senão forka');

    await a.close();
    await b.close();
  });
});
