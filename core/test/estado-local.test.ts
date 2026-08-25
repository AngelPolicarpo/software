// §53 — o estado local do leitor: não-lidas de §6.15, preferências locais de §15.4 e as
// consultas que faltavam (fila, rail, preferências, hostStatus, selfModeration, deep link).
//
// Caminho de produto para tudo que nasce por comando: a comunidade vem de
// `community.create`, as mensagens entram pela outbox com flush/reconciliação explícitos,
// e o recálculo de não-lidas acontece no MESMO passo do lote projetado (gancho
// `notifyProjected`) — quando a espera do projector termina, o LS já foi escrito.
//
// Uma exceção declarada: para exercitar as cláusulas "autor não é a identidade local" e
// "não hiddenByBan" sem um segundo nó na rede, o teste REESCREVE autor/flags de linhas já
// projetadas na `view.db` e provoca o próximo lote. A regra sob teste é a LEITURA (a query
// de definição de §6.15), não quem produziu a linha — o produtor é o projector, coberto
// pelas suítes dele.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { openViewDb } from '../src/l0/view/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import { MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import { bootCore, type CoreRuntime } from '../src/composition/boot.ts';
import { tempDir } from './helpers/composition.ts';
import { keypairFromSeed } from './helpers/world.ts';

const DATA_KEY = Buffer.alloc(32, 53);

type Resposta = { ok: boolean; data: unknown; code: string | null; field: string | null };
type Frame = Record<string, unknown>;

async function rig(rotulo: string) {
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
    foldBuildId: 'estado-local-53',
    ipcPort: coreSide,
    epoch: 1,
    tokenVerifier: { consume: () => true },
    hostTurnSecret: () => Buffer.alloc(32, 7),
    projectionWaitMs: 20_000,
    now: () => Date.now(),
    schedule: () => 0,
    cancel: () => {},
  });
  // §11.4 fecha o grupo por `setTimeout` unref: sem isto o processo sai antes da hora.
  const vivo = setInterval(() => {}, 5);

  // UM listener persistente distribui respostas e eventos — assinaturas vivem ao lado dos
  // requests em vez de competir com eles.
  const pendentes = new Map<number, (r: Resposta) => void>();
  const assinaturas = new Map<number, Array<Frame>>();
  let proximoId = 1;
  rendererSide.onMessage((raw) => {
    const frame = raw as Frame;
    if (frame['t'] === 'res') {
      const resolver = pendentes.get(frame['id'] as number);
      if (resolver !== undefined) {
        pendentes.delete(frame['id'] as number);
        const erro = frame['err'] as { code?: string; field?: string } | undefined;
        resolver({ ok: frame['ok'] as boolean, data: frame['data'], code: erro?.code ?? null, field: erro?.field ?? null });
      }
      return;
    }
    if (frame['t'] === 'ev') {
      const lista = assinaturas.get(frame['subId'] as number);
      if (lista !== undefined) lista.push(frame);
    }
  });

  function request(cmd: string, arg: unknown): Promise<Resposta> {
    const id = proximoId++;
    return new Promise<Resposta>((resolve) => {
      pendentes.set(id, resolve);
      rendererSide.postMessage({ t: 'req', epoch: 1, id, cmd, arg, authToken: 'ok' });
    });
  }

  function assinar(topic: string): Array<Frame> {
    const id = proximoId++;
    const lista: Array<Frame> = [];
    rendererSide.postMessage({ t: 'sub', epoch: 1, id, topic });
    rendererSide.onMessage((raw) => {
      const frame = raw as Frame;
      if (frame['t'] === 'subOk' && frame['id'] === id) assinaturas.set(frame['subId'] as number, lista);
    });
    return lista;
  }

  /** Espera o projector alcançar o fim do log (§10.5); o recálculo do LS é síncrono nele. */
  async function espera(communityId?: string): Promise<void> {
    if (communityId === undefined) return;
    const c = runtime.get(communityId);
    if (c === undefined) return;
    const alvo = c.core.length - 1;
    const limite = Date.now() + 20_000;
    while (c.projector.interpretedSeq < alvo && Date.now() < limite) await new Promise((res) => setTimeout(res, 5));
    assert.ok(c.projector.interpretedSeq >= alvo, `o projector parou em ${c.projector.interpretedSeq}, esperava ${alvo}`);
  }

  /** Enfileira → flush → projeção → reconciliação (os três passos manuais do rig). */
  async function enviar(communityId: string, cmd: string, arg: Record<string, unknown>): Promise<Record<string, unknown>> {
    const r = await request(cmd, { communityId, ...arg });
    assert.ok(r.ok, `${cmd} recusou: ${JSON.stringify(r)}`);
    const c = runtime.get(communityId)!;
    await c.outbox!.flush();
    await espera(communityId);
    c.outbox!.reconcile();
    return r.data as Record<string, unknown>;
  }

  return {
    runtime,
    identity,
    view,
    manifest,
    request,
    assinar,
    enviar,
    espera,
    async comunidadeNova() {
      const r = await request('community.create', { name: 'Raiz', iconColor: 1 });
      assert.ok(r.ok, `community.create recusou: ${JSON.stringify(r)}`);
      await espera((r.data as { communityId: string }).communityId);
      return r.data as unknown as { communityId: string; defaultChannelId: string };
    },
    async estrutura(communityId: string) {
      const r = await request('query.structure', { communityId });
      assert.ok(r.ok, `query.structure recusou: ${JSON.stringify(r)}`);
      return r.data as unknown as {
        categories: Array<{ id: string; collapsed: boolean; channels: Array<{ id: string; name: string; muted: boolean; unread: { count: number; mentions: number }; firstUnreadSeq?: number }> }>;
      };
    },
    ultimaMensagem(communityId: string, channelId: string): { id: string; seq: number } {
      const row = view.prepare('SELECT id, seq FROM messages WHERE community_id = ? AND channel_id = ? ORDER BY seq DESC LIMIT 1').get(communityId, channelId) as
        | { id: string; seq: number }
        | undefined;
      assert.ok(row !== undefined, 'nenhuma mensagem projetada no canal');
      return row;
    },
    /** Reescreve autor/flags de uma linha JÁ projetada — simula "outra pessoa escreveu". */
    disfarcado(messageId: string, patch: { authorKey?: string; mentions?: unknown; everyoneEfetivo?: boolean; hidden?: boolean }): void {
      const campos: string[] = [];
      const valores: unknown[] = [];
      if (patch.authorKey !== undefined) {
        campos.push('author_key = ?');
        valores.push(Buffer.from(patch.authorKey, 'hex'));
      }
      if (patch.mentions !== undefined) {
        campos.push('mentions = ?');
        valores.push(JSON.stringify(patch.mentions));
      }
      if (patch.everyoneEfetivo !== undefined) {
        campos.push('mention_everyone_effective = ?');
        valores.push(patch.everyoneEfetivo ? 1 : 0);
      }
      if (patch.hidden !== undefined) {
        campos.push('hidden_by_ban = ?');
        valores.push(patch.hidden ? 1 : 0);
      }
      valores.push(messageId);
      view.prepare(`UPDATE messages SET ${campos.join(', ')} WHERE id = ?`).run(...valores);
    },
    async close() {
      clearInterval(vivo);
      await runtime.close();
      view.close();
      manifest.close();
      for (let tentativa = 0; ; tentativa++) {
        try {
          fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
          break;
        } catch (e) {
          if (tentativa >= 2 || (e as { code?: string }).code !== 'ENOTEMPTY') throw e;
          await new Promise((res) => setTimeout(res, 50));
        }
      }
    },
  };
}

function chaveEstranha(seed: number): string {
  return Buffer.from(Array.from({ length: 32 }, (_, i) => (seed * 37 + i * 11) % 256)).toString('hex');
}

describe('§53 não-lidas de §6.15 — recálculo no lote projetado, marca e eventos', { timeout: 120_000 }, () => {
  it('conta mensagem alheia não lida, menciona identidade/everyone efetivo, exclui ocultas e emite unread.changed', async () => {
    const r = await rig('naolidas-base');
    try {
      const { communityId, defaultChannelId } = await r.comunidadeNova();
      const eu = r.identity.publicKey.toString('hex');
      const eventos = r.assinar('unread.changed');

      // Três mensagens da própria fundadora: autor local é excluído — nada fica por ler.
      for (let i = 1; i <= 3; i++) {
        await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: `minha ${i}`, mentions: [] });
      }
      let estado = r.manifest.getReadState(communityId, defaultChannelId);
      assert.equal(estado.unreadCount, 0, 'autor local não entra na contagem');

      // A primeira vira "de outra pessoa" me mencionando; a segunda menciona everyone
      // EFETIVO; a terceira fica oculta por ban. O próximo lote reconta as três.
      const linhas = (r.view.prepare('SELECT id, seq FROM messages WHERE community_id = ? AND channel_id = ? ORDER BY seq ASC').all(communityId, defaultChannelId)) as Array<{ id: string; seq: number }>;
      assert.equal(linhas.length, 3);
      r.disfarcado(linhas[0]!.id, { authorKey: chaveEstranha(5), mentions: [eu] });
      r.disfarcado(linhas[1]!.id, { authorKey: chaveEstranha(6), mentions: ['everyone'], everyoneEfetivo: true });
      r.disfarcado(linhas[2]!.id, { authorKey: chaveEstranha(7), hidden: true });
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'provoca o lote', mentions: [] });

      estado = r.manifest.getReadState(communityId, defaultChannelId);
      assert.deepEqual(
        { unreadCount: estado.unreadCount, pendingMentions: estado.pendingMentions, firstUnreadSeq: estado.firstUnreadSeq },
        { unreadCount: 2, pendingMentions: 2, firstUnreadSeq: linhas[0]!.seq },
        '§6.15: oculta sai; menção por identidade e por everyone-efetivo entram',
      );

      // `query.structure` reflete o que o LS tem, com o primeiro `seq` por ler.
      const canal = (await r.estrutura(communityId)).categories[0]!.channels.find((c) => c.id === defaultChannelId)!;
      assert.deepEqual(canal.unread, { count: 2, mentions: 2 });
      assert.equal(canal.firstUnreadSeq, linhas[0]!.seq);

      // §15.5 — o evento carrega os campos exatos da tabela de §6.15.
      const dados = eventos.map((f) => f['data'] as Record<string, unknown>).filter((d) => d['channelId'] === defaultChannelId);
      assert.ok(dados.length > 0, 'unread.changed foi emitido');
      const ultimo = dados[dados.length - 1]!;
      assert.deepEqual({ ...ultimo, communityId: undefined }, { ...ultimo, communityId: undefined });
      assert.equal(ultimo['channelId'], defaultChannelId);
      assert.equal(ultimo['unreadCount'], 2);
      assert.equal(ultimo['pendingMentions'], 2);
    } finally {
      await r.close();
    }
  });

  it('channel.markRead avança o watermark para a cabeça e responde zero literal (RT-03)', async () => {
    const r = await rig('naolidas-mark');
    try {
      const { communityId, defaultChannelId } = await r.comunidadeNova();
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'uma', mentions: [] });
      const primeira = r.ultimaMensagem(communityId, defaultChannelId);
      r.disfarcado(primeira.id, { authorKey: chaveEstranha(9) });
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'duas', mentions: [] });
      assert.equal(r.manifest.getReadState(communityId, defaultChannelId).unreadCount, 1);

      const resposta = (await r.request('channel.markRead', { communityId, channelId: defaultChannelId })).data as Record<string, unknown>;
      assert.deepEqual(resposta, { unreadCount: 0, pendingMentions: 0 });
      const depois = r.manifest.getReadState(communityId, defaultChannelId);
      assert.equal(depois.unreadCount, 0);
      assert.ok(depois.lastReadSeq >= primeira.seq, 'o watermark alcançou a cabeça do canal');
      assert.equal((await r.estrutura(communityId)).categories[0]!.channels[0]!.unread.count, 0);

      // Nova atividade alheia volta a contar a partir do watermark: entra só o novo.
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'três', mentions: [] });
      r.disfarcado(r.ultimaMensagem(communityId, defaultChannelId).id, { authorKey: chaveEstranha(10), mentions: [] });
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'quatro', mentions: [] });
      assert.equal(r.manifest.getReadState(communityId, defaultChannelId).unreadCount, 1, 'sem contagem dupla: só o novo entrou');
    } finally {
      await r.close();
    }
  });

  it('thread.markRead zera o contador da thread (DR-48) sem mexer no canal', async () => {
    const r = await rig('naolidas-thread');
    try {
      const { communityId, defaultChannelId } = await r.comunidadeNova();
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'raiz', mentions: [] });
      const raiz = r.ultimaMensagem(communityId, defaultChannelId).id;
      await r.enviar(communityId, 'thread.create', { rootMessageId: raiz });
      const threadId = [...r.runtime.get(communityId)!.projector.ds.rootOfThread.keys()][0]!;
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'resposta', mentions: [], threadId });
      const resposta = r.ultimaMensagem(communityId, defaultChannelId);
      r.disfarcado(resposta.id, { authorKey: chaveEstranha(11) });
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'outra', mentions: [] });

      assert.ok(r.manifest.getThreadReadState(communityId, threadId).unreadCount >= 1, 'a resposta alheia conta na thread');
      const feito = (await r.request('thread.markRead', { communityId, threadId })).data as Record<string, unknown>;
      assert.deepEqual(feito, { unreadCount: 0 });
      assert.equal(r.manifest.getThreadReadState(communityId, threadId).unreadCount, 0);
    } finally {
      await r.close();
    }
  });

  it('query.thread.unread lista só as threads com contador vivo e zera após a leitura (§9 2.2)', async () => {
    const r = await rig('naolidas-chip');
    try {
      const { communityId, defaultChannelId } = await r.comunidadeNova();
      // Duas threads: uma com resposta ALHEIA (conta) e uma com resposta minha (não conta).
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'raiz um', mentions: [] });
      const raizUm = r.ultimaMensagem(communityId, defaultChannelId).id;
      await r.enviar(communityId, 'thread.create', { rootMessageId: raizUm });
      const threadUm = [...r.runtime.get(communityId)!.projector.ds.rootOfThread.keys()][0]!;

      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'raiz dois', mentions: [] });
      const raizDois = r.ultimaMensagem(communityId, defaultChannelId).id;
      await r.enviar(communityId, 'thread.create', { rootMessageId: raizDois });
      const threadsAteAgora = [...r.runtime.get(communityId)!.projector.ds.rootOfThread.keys()];
      const threadDois = threadsAteAgora.find((t) => t !== threadUm)!;

      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'resposta alheia', mentions: [], threadId: threadUm });
      const respostaAlheia = r.ultimaMensagem(communityId, defaultChannelId);
      r.disfarcado(respostaAlheia.id, { authorKey: chaveEstranha(31) });
      await r.espera(communityId);

      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'resposta minha', mentions: [], threadId: threadDois });
      await r.espera(communityId);

      const lido = (await r.request('query.thread.unread', { communityId, channelId: defaultChannelId })).data as {
        items: Array<{ threadId: string; rootMessageId: string; channelId: string; unreadCount: number }>;
        hasMore: boolean;
      };
      assert.deepEqual(
        lido.items.map((i) => [i.threadId, i.unreadCount]),
        [[threadUm, 1]],
        'só a resposta ALHEIA gera badge; a minha própria não',
      );
      assert.equal(lido.items[0]!.rootMessageId, raizUm);
      assert.equal(lido.items[0]!.channelId, defaultChannelId);
      assert.equal(lido.hasMore, false);

      // Sem channelId: a comunidade inteira responde o mesmo item.
      const global = (await r.request('query.thread.unread', { communityId })).data as typeof lido;
      assert.deepEqual(global.items.map((i) => i.threadId), [threadUm]);

      // A leitura zera: o badge sai da listagem na consulta seguinte.
      await r.request('thread.markRead', { communityId, threadId: threadUm });
      const depois = (await r.request('query.thread.unread', { communityId, channelId: defaultChannelId })).data as typeof lido;
      assert.deepEqual(depois.items, []);
    } finally {
      await r.close();
    }
  });
});

describe('§53 preferências locais — escrita no LS sem host e sem fila (§15.4)', { timeout: 120_000 }, () => {
  it('mudo, recolhida, navegação dono único e configurações de dispositivo', async () => {
    const r = await rig('prefs-base');
    try {
      const { communityId, defaultChannelId } = await r.comunidadeNova();
      const categoriaId = (await r.estrutura(communityId)).categories[0]!.id;

      await r.request('channel.setMuted', { communityId, channelId: defaultChannelId, muted: true });
      assert.equal((await r.estrutura(communityId)).categories[0]!.channels[0]!.muted, true);

      await r.request('category.setCollapsed', { communityId, categoryId: categoriaId, collapsed: true });
      assert.equal((await r.estrutura(communityId)).categories[0]!.collapsed, true);
      await r.request('category.setCollapsed', { communityId, categoryId: categoriaId, collapsed: false });
      assert.equal((await r.estrutura(communityId)).categories[0]!.collapsed, false);

      // DR-32 — dono único: o comando declara o estado inteiro; ausente é slot vazio.
      await r.request('nav.setActive', { communityId, channelId: defaultChannelId });
      assert.deepEqual(r.manifest.getNavigation(), { activeCommunityId: communityId, activeChannelId: defaultChannelId });
      await r.request('nav.setActive', {});
      assert.deepEqual(r.manifest.getNavigation(), {});
      await r.request('nav.setActive', { channelId: defaultChannelId });
      assert.deepEqual(r.manifest.getNavigation(), { activeChannelId: defaultChannelId }, 'a comunidade foi limpa, o canal ficou');

      await r.request('settings.setDevice', { kind: 'microphone', deviceId: 'mic-1' });
      await r.request('settings.setDevice', { kind: 'output', deviceId: 'fone-7' });
      assert.equal((await r.request('settings.setDevice', { kind: 'teclado', deviceId: 'x' })).code, 'E_VALIDATION');

      await r.request('settings.setVolume', { kind: 'input', value: 42 });
      await r.request('settings.setVolume', { kind: 'output', value: 77 });
      assert.equal((await r.request('settings.setVolume', { kind: 'input', value: 101 })).code, 'E_VALIDATION');

      await r.request('settings.setParticipantVolume', { communityId, identityKey: chaveEstranha(21), volume: 30 });
      const identRuim = await r.request('settings.setParticipantVolume', { communityId, identityKey: 'zz', volume: 30 });
      assert.equal(identRuim.code, 'E_VALIDATION');

      await r.request('settings.setNotifications', { enabled: false });
      await r.request('settings.setNotifications', { communityId, level: 'mentions' });
      assert.equal((await r.request('settings.setNotifications', { level: 'gritos' })).code, 'E_VALIDATION');
      assert.equal((await r.request('settings.setNotifications', { level: 'all' })).code, 'E_VALIDATION', 'nível sem comunidade não tem destino');

      const prefs = (await r.request('query.preferences', {})).data as {
        device: Record<string, unknown>;
        notifications: { enabled: boolean; byCommunity: Array<{ communityId: string; level: string }> };
        channels: Array<{ channelId: string }>;
        relayConsent: unknown[];
        participantVolumes: Array<{ communityId: string; identityKey: string; volume: number }>;
      };
      assert.deepEqual(prefs.device['microphoneId'], 'mic-1');
      assert.deepEqual(prefs.device['outputId'], 'fone-7');
      assert.equal(prefs.device['inputVolume'], 42);
      assert.equal(prefs.device['outputVolume'], 77);
      assert.equal(prefs.notifications.enabled, false);
      assert.deepEqual(prefs.notifications.byCommunity, [{ communityId, level: 'mentions' }]);
      assert.deepEqual(prefs.channels.map((c) => c.channelId), [defaultChannelId]);
      assert.deepEqual(prefs.relayConsent, []);
      assert.equal(prefs.participantVolumes[0]!.volume, 30);
    } finally {
      await r.close();
    }
  });

  it('query.outbox redesenha a fila com preview do envelope (F-16) e esvazia depois do flush', async () => {
    const r = await rig('prefs-fila');
    try {
      const { communityId, defaultChannelId } = await r.comunidadeNova();
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'primeira já aceita', mentions: [] });

      // Três ops ENFILEIRADAS sem flush: é o estado que a UI encontra ao reabrir.
      const envio1 = await r.request('message.send', { communityId, channelId: defaultChannelId, content: 'fila um', mentions: [] });
      const envio2 = await r.request('message.send', { communityId, channelId: defaultChannelId, content: 'fila dois', mentions: [] });
      const raiz = r.ultimaMensagem(communityId, defaultChannelId).id;
      const reacao = await r.request('message.react', { communityId, messageId: raiz, emoji: '🎉', present: true });
      for (const pedido of [envio1, envio2, reacao]) assert.ok(pedido.ok, `enfileirar recusou: ${JSON.stringify(pedido)}`);

      const fila = (await r.request('query.outbox', { communityId })).data as {
        items: Array<{ opId: string; state: string; kindLabel?: string; channelName?: string; preview?: Record<string, unknown> }>;
        counts: { queued: number; sending: number; failed: number };
      };
      assert.equal(fila.counts.queued, 3);
      assert.equal(fila.counts.failed, 0);
      const conteudos = fila.items.filter((i) => i.preview?.['content'] !== undefined);
      assert.deepEqual(conteudos.map((i) => i.preview!['content']), ['fila um', 'fila dois'], 'o preview sai do envelope enfileirado');
      const reacaoItem = fila.items.find((i) => i.preview?.['emoji'] !== undefined)!;
      assert.equal(reacaoItem.preview!['emoji'], '🎉');
      assert.equal(reacaoItem.preview!['targetMessageId'], raiz);
      assert.ok(fila.items.every((i) => i.kindLabel !== undefined), 'todo item nomeia o kind');
      assert.ok(fila.items.filter((i) => i.kindLabel === 'Mensagem').length === 2 && fila.items.some((i) => i.kindLabel === 'Reação'));
      assert.ok(fila.items.every((i) => i.channelName !== undefined), 'o nome do canal vem da view.db');

      const c = r.runtime.get(communityId)!;
      await c.outbox!.flush();
      await r.espera(communityId);
      c.outbox!.reconcile();
      const vazia = (await r.request('query.outbox', { communityId })).data as { items: unknown[]; counts: { queued: number } };
      assert.deepEqual(vazia.items, []);
      assert.equal(vazia.counts.queued, 0);
    } finally {
      await r.close();
    }
  });
});

describe('§53 rail, hostStatus, selfModeration e o deep link de §3.5 (RT-04)', { timeout: 120_000 }, () => {
  it('query.communities traz a comunidade na ordem de entrada, com agregado de não-lidas', async () => {
    const r = await rig('rail-base');
    try {
      const { communityId, defaultChannelId } = await r.comunidadeNova();
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'minha', mentions: [] });
      const alheia = r.ultimaMensagem(communityId, defaultChannelId);
      r.disfarcado(alheia.id, { authorKey: chaveEstranha(31) });
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'provoca', mentions: [] });

      const itens = (await r.request('query.communities', {})).data as Array<Record<string, unknown>>;
      assert.equal(itens.length, 1);
      const item = itens[0]!;
      assert.equal(item['id'], communityId);
      assert.equal(item['name'], 'Raiz');
      assert.equal(item['isHostedByMe'], true);
      assert.deepEqual(item['unread'], { count: 1, mentions: 0 }, 'o agregado do rail vem do LS de §6.15');
      assert.equal(item['notificationLevel'], 'all');
      assert.equal(item['partialInterpretation'], false);
      assert.ok(typeof (item['replication'] as { state: string }).state === 'string');
      // §54 — DR-29/DR-33 com produtor: quem HOSPEDA nasce `online` e o último contato é
      // escrito na hora; os dias de inatividade derivam dele (zero, aqui).
      assert.equal(item['hostStatus'], 'online', 'comunidade hospedada aqui: host visto agora');
      assert.equal(item['inactiveDays'], 0);

      await r.request('settings.setNotifications', { communityId, level: 'none' });
      const depois = (await r.request('query.communities', {})).data as Array<{ notificationLevel: string }>;
      assert.equal(depois[0]!.notificationLevel, 'none');
    } finally {
      await r.close();
    }
  });

  it('query.hostStatus traz status, último contato e inatividade; membro sem contato fica sem eles', async () => {
    const r = await rig('rail-host');
    try {
      const { communityId } = await r.comunidadeNova();
      const resposta = (await r.request('query.hostStatus', { communityId })).data as Record<string, unknown>;
      assert.ok(typeof (resposta['replication'] as { state: string }).state === 'string');
      // §54 — hospedada aqui: máquina de §15.6 nasce `online`, com o contato no LS.
      assert.equal(resposta['status'], 'online');
      assert.equal(typeof resposta['lastSeenAt'], 'number');
      assert.equal(resposta['inactiveDays'], 0);
    } finally {
      await r.close();
    }
  });

  it('query.selfModeration descreve quem não sofreu nada — e os campos derivados ficam ausentes', async () => {
    const r = await rig('rail-selfmod');
    try {
      const { communityId } = await r.comunidadeNova();
      const resposta = (await r.request('query.selfModeration', { communityId })).data as Record<string, unknown>;
      assert.deepEqual(resposta, { banned: false, kicked: false });
    } finally {
      await r.close();
    }
  });

  it('resolveMessageLink fecha RT-04: ok, malformed, not-member, not-synced e deleted', async () => {
    const r = await rig('rail-link');
    try {
      const { communityId, defaultChannelId } = await r.comunidadeNova();
      const enviado = await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'alvo do link', mentions: [] });
      const mensagem = r.ultimaMensagem(communityId, defaultChannelId);

      // MSGREF = base64url(communityId ‖ opId) — emenda datada em §3.5.
      const refOk = Buffer.concat([Buffer.from(communityId, 'hex'), Buffer.from(enviado['opId'] as string, 'hex')]).toString('base64url');
      assert.match(refOk, /^[A-Za-z0-9_-]{86}$/);
      const ok = (await r.request('query.resolveMessageLink', { ref: refOk })).data as Record<string, unknown>;
      assert.deepEqual(ok, { status: 'ok', communityId, channelId: defaultChannelId, messageId: mensagem.id, seq: mensagem.seq });

      assert.deepEqual((await r.request('query.resolveMessageLink', { ref: 'curto' })).data, { status: 'malformed' });
      const meiaComunidade = Buffer.alloc(32, 1).toString('hex');
      const refEstranho = Buffer.concat([Buffer.alloc(32, 1), Buffer.from(chaveEstranha(1), 'hex')]).toString('base64url');
      assert.deepEqual((await r.request('query.resolveMessageLink', { ref: refEstranho })).data, {
        status: 'not-member',
        communityId: meiaComunidade,
      }, 'a primeira metade do ref nomeia a comunidade');
      const opFantasma = Buffer.concat([Buffer.from(communityId, 'hex'), Buffer.from(chaveEstranha(2), 'hex')]).toString('base64url');
      assert.deepEqual((await r.request('query.resolveMessageLink', { ref: opFantasma })).data, {
        status: 'not-synced',
        communityId,
      }, 'op ainda não projetada aqui; channelId fica ausente (emenda §15.6)');

      await r.enviar(communityId, 'message.delete', { messageId: mensagem.id });
      assert.deepEqual((await r.request('query.resolveMessageLink', { ref: refOk })).data, { status: 'deleted' });
    } finally {
      await r.close();
    }
  });

  it('mudança nos cargos da identidade local reconta do zero (§6.15)', async () => {
    const r = await rig('cargos-invalidam');
    try {
      const { communityId, defaultChannelId } = await r.comunidadeNova();
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'base', mentions: [] });
      const alvo = r.ultimaMensagem(communityId, defaultChannelId);
      // Uma mensagem alheia mencionando um CARGO que eu ainda não tenho.
      const cargo = (await r.request('role.create', { communityId, name: 'Pingue', color: 2, permissions: [], mentionable: true })).data as { roleId: string };
      r.disfarcado(alvo.id, { authorKey: chaveEstranha(41), mentions: [cargo.roleId] });
      await r.enviar(communityId, 'message.send', { channelId: defaultChannelId, content: 'lote', mentions: [] });
      let estado = r.manifest.getReadState(communityId, defaultChannelId);
      assert.deepEqual({ unreadCount: estado.unreadCount, pendingMentions: estado.pendingMentions }, { unreadCount: 1, pendingMentions: 0 });

      // Ganhar o cargo é mudança nos cargos locais: a menção por cargo passa a contar.
      const gênese = ((await r.request('query.roles', { communityId })).data as { roles: Array<{ id: string; isFounder: boolean; isDefault: boolean }> }).roles;
      const fundadorId = gênese.find((x) => x.isFounder)!.id;
      const baseId = gênese.find((x) => x.isDefault)!.id;
      const setRoles = await r.request('member.setRoles', { communityId, targetKey: r.identity.publicKey.toString('hex'), roleIds: [fundadorId, baseId, cargo.roleId] });
      assert.ok(setRoles.ok, `member.setRoles recusou: ${JSON.stringify(setRoles)}`);

      estado = r.manifest.getReadState(communityId, defaultChannelId);
      assert.deepEqual(
        { unreadCount: estado.unreadCount, pendingMentions: estado.pendingMentions },
        { unreadCount: 1, pendingMentions: 1 },
        'pendingMentions depende dos cargos AGORA',
      );
    } finally {
      await r.close();
    }
  });
});
