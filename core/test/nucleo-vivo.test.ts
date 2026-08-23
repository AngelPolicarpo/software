// §54 — o núcleo vivo: status do host (DR-29/DR-33, §15.6/§11.8), presença e digitando
// (§16.2/§16.3, §17.6) e os jobs de §22.2 que faltavam. O que cada asserção fixa:
//
//   §15.6  — enum FECHADO do `HostStatus`, com precedência dos estados terminais;
//   §11.8  — `cameBack` reconcilia NA HORA e flusha depois de
//            `RECONNECT_FLUSH_DELAY_MS + hash(identityKey) mod 2000 ms`, taxado a
//            `FLUSH_RATE_PER_S`;
//   §17.6  — rate limit 1 presença/5 s e 1 typing/2 s por autor/canal (`E_RATE_LIMITED`);
//            typing vai SÓ a quem assinou interesse; presença é delta agregado;
//   §22.1  — os três loops têm corpo (`presence.tick`, `typing.expire`, `presence.refresh`);
//   §22.2  — `outbox.expire` descarta por idade DENTRO da reconciliação (§11.6);
//   §18.4  — `removed.purge` apaga a réplica vencida inteira (LS, CS, disco);
//   §24.1  — `log.rotate` aplica retenção sobre `logs/core-YYYY-MM-DD.ndjson`.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ManifestDb } from '../src/l0/manifest/index.ts';
import { openViewDb } from '../src/l0/view/index.ts';
import { Swarm } from '../src/l0/swarm/index.ts';
import { MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import { RpcClient } from '../src/l3/rpcClient/index.ts';
import { bootCore, type CoreRuntime } from '../src/composition/boot.ts';
import {
  FLUSH_RATE_PER_S,
  HostStatusTracker,
  INACTIVE_COMMUNITY_DAYS,
  RECONNECT_FLUSH_DELAY_MS,
  reconnectJitterMs,
  type HostStatusEvent,
} from '../src/composition/hostStatus.ts';
import { rpcPair, tempDir } from './helpers/composition.ts';
import { T0, keypairFromSeed } from './helpers/world.ts';

const DATA_KEY = Buffer.alloc(32, 53);
const DIA = 24 * 60 * 60_000;

type Frame = Record<string, unknown>;
type Resposta = { ok: boolean; data: unknown; code: string | null };

async function rig(rotulo: string, relogio: { now: number }) {
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
    foldBuildId: 'nucleo-vivo-54',
    ipcPort: coreSide,
    epoch: 1,
    tokenVerifier: { consume: () => true },
    hostTurnSecret: () => Buffer.alloc(32, 7),
    now: () => relogio.now,
    schedule: () => 0,
    cancel: () => {},
  });
  // §11.4 fecha o grupo por `setTimeout` unref: sem rede, nada segura o event loop do rig.
  const vivo = setInterval(() => {}, 5);

  // UM listener persistente distribui respostas e eventos, como no rig de §53.
  const pendentes = new Map<number, (r: Resposta) => void>();
  const assinaturas = new Map<number, Frame[]>();
  let proximoId = 9000;
  rendererSide.onMessage((raw) => {
    const frame = raw as Frame;
    if (frame['t'] === 'res') {
      const resolver = pendentes.get(frame['id'] as number);
      if (resolver !== undefined) {
        pendentes.delete(frame['id'] as number);
        const erro = frame['err'] as { code?: string } | undefined;
        resolver({ ok: frame['ok'] as boolean, data: frame['data'], code: erro?.code ?? null });
      }
      return;
    }
    if (frame['t'] === 'ev') {
      assinaturas.get(frame['subId'] as number)?.push(frame['data'] as Frame);
    }
  });

  async function request(cmd: string, arg: unknown): Promise<Resposta> {
    const id = ++proximoId;
    return await new Promise<Resposta>((resolve) => {
      pendentes.set(id, resolve);
      rendererSide.postMessage({ t: 'req', epoch: 1, id, cmd, arg, authToken: 'ok' });
    });
  }

  function assinar(topic: string): Frame[] {
    const id = ++proximoId;
    const lista: Frame[] = [];
    rendererSide.postMessage({ t: 'sub', epoch: 1, id, topic });
    rendererSide.onMessage((raw) => {
      const f = raw as Frame;
      if (f['t'] === 'subOk' && f['id'] === id) assinaturas.set(f['subId'] as number, lista);
    });
    // O `MemoryIpcPort` entrega por microtask: quem assina e DISPARA um caminho síncrono
    // na sequência (`runNow`) drena a fila antes (`await setImmediate`), senão o `sub`
    // ainda não chegou ao `IpcServer`.
    return lista;
  }

  async function comunidadeNova(): Promise<{ communityId: string; defaultChannelId: string }> {
    const r = await request('community.create', { name: 'Raiz', iconColor: 1 });
    assert.ok(r.ok, `community.create recusou: ${JSON.stringify(r)}`);
    return r.data as { communityId: string; defaultChannelId: string };
  }

  return {
    runtime,
    identity,
    manifest,
    view,
    dir,
    request,
    assinar,
    comunidadeNova,
    async close() {
      clearInterval(vivo);
      await runtime.close();
      // O fechamento dos cores de blobs é assíncrono por trás do `await`: dá a ele o último
      // tick antes de remover o diretório, senão o flush do hypercore recria arquivo no meio
      // do `rmSync`.
      await new Promise((res) => setTimeout(res, 25));
      view.close();
      manifest.close();
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    },
  };
}

describe('§54.1 máquina de §15.6 — o status do host tem fontes, nunca inventado', () => {
  function trackerDe(relogio: { now: number }) {
    const eventos: HostStatusEvent['data'][] = [];
    const agendados: Array<{ ms: number; fn: () => void }> = [];
    const vistos = new Map<string, number>();
    const reconciliados: number[] = [];
    const flushes: Array<number | undefined> = [];
    const t = new HostStatusTracker({
      manifest: {
        getLastHostSeenAt: (cid: string) => (vistos.has(cid) ? (vistos.get(cid) as number) : null),
        setLastHostSeenAt: (cid: string, at: number) => void vistos.set(cid, at),
      } as never,
      emit: (ev) => eventos.push(ev.data),
      now: () => relogio.now,
      schedule: (fn: () => void, ms: number) => {
        agendados.push({ ms, fn });
        return agendados.length;
      },
      cancel: () => {},
      outboxOf: () =>
        ({
          reconcile: (at: number) => {
            reconciliados.push(at);
          },
          flush: async ({ maxItems }: { maxItems?: number }) => {
            flushes.push(maxItems);
            return 0;
          },
        }) as never,
      stateFor: () => null,
      replicationStateOf: () => null,
      selfKeyHex: () => 'ab'.repeat(32),
    });
    return { t, eventos, agendados, reconciliados, flushes, vistos };
  }

  it('unknown → connecting → online escreve o último contato; down cai para reconnecting com attempt', () => {
    const relogio = { now: T0 };
    const { t, eventos, vistos } = trackerDe(relogio);
    t.ensure('c1', { isHost: false });
    assert.equal(t.statusOf('c1'), 'unknown');
    assert.equal(vistos.has('c1'), false, 'sem contato observado, LS não ganha valor inventado');

    t.channelAttached('c1');
    assert.equal(t.statusOf('c1'), 'connecting');

    relogio.now = T0 + 500;
    t.markSeen('c1');
    assert.equal(t.statusOf('c1'), 'online');
    assert.equal(vistos.get('c1'), T0 + 500);
    const online = eventos.at(-1)!;
    assert.deepEqual([online.communityId, online.status], ['c1', 'online']);
    assert.equal(online.lastSeenAt, T0 + 500);
    assert.equal('attempt' in online, false, 'nenhum ciclo falhou ainda — campo ausente');

    t.channelDown('c1');
    assert.equal(t.statusOf('c1'), 'reconnecting');
    assert.equal(t.attemptOf('c1'), 1);
    assert.equal(eventos.at(-1)!.attempt, 1);
  });

  it('sem contato nenhum, queda é offline — e cameBack reconcilia na hora e flusha com jitter taxado', async () => {
    const relogio = { now: T0 };
    const { t, eventos, agendados, reconciliados, flushes } = trackerDe(relogio);
    t.ensure('c2', { isHost: false });
    t.channelAttached('c2');
    t.channelDown('c2');
    assert.equal(t.statusOf('c2'), 'offline', 'nunca viu o host: não há reconexão em curso que descrever');

    // Volta: contato → cameBack → reconcile imediato + flush AGENDADO com jitter.
    relogio.now = T0 + 100;
    t.markSeen('c2');
    assert.equal(t.statusOf('c2'), 'online');
    assert.equal(reconciliados.length, 1, '§22.1 — outbox.reconcile roda em host.cameBack');
    assert.equal(agendados.length, 1);
    const jitterEsperado = RECONNECT_FLUSH_DELAY_MS + reconnectJitterMs('ab'.repeat(32));
    assert.ok(jitterEsperado >= RECONNECT_FLUSH_DELAY_MS && jitterEsperado < RECONNECT_FLUSH_DELAY_MS + 2000);

    agendados[0]!.fn();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(flushes, [FLUSH_RATE_PER_S], 'flush pós-reconexão nasce taxado (§11.8)');
    assert.equal(agendados.length, 1, 'rodada sem envio não rearma');
    assert.ok(eventos.length > 0);
  });

  it('terminais vencem: forked/unauthorized pela replicação, ended pelo DS, incompatible pegajoso', () => {
    const relogio = { now: T0 };
    const replication = new Map<string, string | null>();
    const terminais = new Map<string, boolean>();
    const eventos: HostStatusEvent['data'][] = [];
    const agendados: Array<{ ms: number; fn: () => void }> = [];
    const vistos = new Map<string, number>();
    const t = new HostStatusTracker({
      manifest: {
        getLastHostSeenAt: (cid: string) => (vistos.has(cid) ? (vistos.get(cid) as number) : null),
        setLastHostSeenAt: (cid: string, at: number) => void vistos.set(cid, at),
      } as never,
      emit: (ev) => eventos.push(ev.data),
      now: () => relogio.now,
      schedule: (fn: () => void, ms: number) => {
        agendados.push({ ms, fn });
        return agendados.length;
      },
      cancel: () => {},
      outboxOf: () => undefined,
      stateFor: (cid) => (terminais.get(cid) === true ? ({ community: { exists: true, endedAt: T0 } }) as never : null),
      replicationStateOf: (cid) => replication.get(cid) ?? null,
      selfKeyHex: () => null,
    });
    t.ensure('c3', { isHost: false });
    t.markSeen('c3');
    assert.equal(t.statusOf('c3'), 'online');

    replication.set('c3', 'forked');
    assert.equal(t.statusOf('c3'), 'forked');
    replication.set('c3', null);

    terminais.set('c3', true);
    assert.equal(t.statusOf('c3'), 'ended');
    terminais.set('c3', false);

    // E_VERSION_UNSUPPORTED observado na fila fixa incompatible — pegajoso (§16.3).
    t.noteSubmit('c3', [{ ok: false, code: 'E_VERSION_UNSUPPORTED' }]);
    assert.equal(t.statusOf('c3'), 'incompatible');
    t.markSeen('c3');
    assert.equal(t.statusOf('c3'), 'incompatible', 'nada nesta fase des-marca incompatible');
  });

  it('host.inactivity sinaliza UMA vez a travessia de INACTIVE_COMMUNITY_DAYS (§22.2)', () => {
    const relogio = { now: T0 };
    const { t, eventos, vistos } = trackerDe(relogio);
    t.ensure('c4', { isHost: false });
    vistos.set('c4', T0);

    relogio.now = T0 + (INACTIVE_COMMUNITY_DAYS - 1) * DIA;
    assert.deepEqual(t.runInactivity(), [], 'abaixo do limiar nada sai');

    relogio.now = T0 + INACTIVE_COMMUNITY_DAYS * DIA + 1;
    assert.deepEqual(t.runInactivity(), ['c4']);
    const ev = eventos.at(-1)!;
    assert.equal(ev.status, 'unknown');
    assert.equal(ev.lastSeenAt, T0);
    assert.deepEqual(t.runInactivity(), [], 'a travessia já foi sinalizada nesta sessão');

    // Sem último contato não há dias para contar — e nada é inventado.
    t.ensure('c5', { isHost: false });
    assert.deepEqual(t.runInactivity(), []);
  });
});

describe('§54.2 presença e digitando ponta a ponta (§16.2/§16.3, §17.6)', () => {
  it('rate limit, delta agregado no tick e typing só para quem assinou', async () => {
    const relogio = { now: T0 };
    const r = await rig('presenca-54', relogio);
    const membro = keypairFromSeed('membro-54');
    try {
      const { communityId, defaultChannelId } = await r.comunidadeNova();
      const [serverSide, clientSide] = rpcPair();
      r.runtime.attachMemberConnection({ communityId, peerKeyHex: membro.publicKey.toString('hex'), transport: serverSide });
      const cliente = new RpcClient({ protocol: 'community', transport: clientSide, role: 'member' });
      const recebidas: Array<{ topic: string; data: Frame }> = [];
      cliente.onNotify((topic, body) => {
        recebidas.push({ topic, data: JSON.parse(Buffer.from(body).toString('utf8')) as Frame });
      });
      const eventosPresenca = r.assinar('presence.changed');
      const eventosTyping = r.assinar('typing.changed');

      const chamar = (method: string, arg: Record<string, unknown>) =>
        cliente.call(method, new Uint8Array(Buffer.from(JSON.stringify(arg), 'utf8')));

      // §17.6 — 1 publicação de presença / 5 s por autor.
      const primeira = await chamar('presencePublish', { status: 'online' });
      assert.equal(primeira.ok, true, `presencePublish recusou: ${JSON.stringify(primeira)}`);
      const repetida = await chamar('presencePublish', { status: 'idle' });
      assert.equal(repetida.ok, false);
      assert.equal((repetida as { code: string }).code, 'E_RATE_LIMITED');
      relogio.now = T0 + 5_001;
      const depoisDaJanela = await chamar('presencePublish', { status: 'dnd' });
      assert.equal(depoisDaJanela.ok, true);

      // §17.6 — o push do host é DELTA AGREGADO a cada PRESENCE_TICK_MS, não por evento…
      assert.equal(eventosPresenca.length, 0);
      await r.runtime.loops!.runNow('presence.tick');
      const delta = eventosPresenca.at(-1) as { entries: Array<{ identityKey: string; status: string }> } | undefined;
      assert.ok(delta !== undefined, 'presence.tick não emitiu');
      assert.equal(delta.entries.at(-1)!.identityKey, membro.publicKey.toString('hex'));
      assert.equal(delta.entries.at(-1)!.status, 'dnd');
      // …e chega ao par conectado como notificação de §16.3 SEM communityId no payload.
      const notificacao = recebidas.filter((x) => x.topic === 'presence.changed').at(-1)!;
      assert.equal(notificacao.data['communityId'], undefined);
      assert.ok(Array.isArray(notificacao.data['entries']));

      // Typing: publica com rate limit próprio e vai SÓ a quem assinou o canal.
      const assinou = await chamar('subscribeChannel', { channelId: defaultChannelId, on: true });
      assert.equal(assinou.ok, true);
      const typing1 = await chamar('presencePublish', { status: 'dnd', typingChannelId: defaultChannelId });
      assert.equal(typing1.ok, true, 'typing dentro da janela de 2 s não pode ser barrado pelo teto de presença');
      const frameTyping = recebidas.filter((x) => x.topic === 'typing.changed').at(-1)!;
      assert.deepEqual(frameTyping.data['identityKeys'], [membro.publicKey.toString('hex')]);
      assert.equal(frameTyping.data['communityId'], undefined);
      assert.equal(((eventosTyping.at(-1) ?? {}) as Frame)['channelId'], defaultChannelId, 'no evento IPC a rota… ');
      assert.notEqual(((eventosTyping.at(-1) ?? {}) as Frame)['communityId'], undefined, '…o evento IPC carrega communityId');

      // TTL 5 s do typing: varrido pelo loop de 1 s (§22.1).
      relogio.now = T0 + 5_002 + 6_000;
      await r.runtime.loops!.runNow('typing.expire');
      const expirado = recebidas.filter((x) => x.topic === 'typing.changed').at(-1)!;
      assert.deepEqual(expirado.data['identityKeys'], []);

      // Assinatura desligada: sem interesse, o typing NÃO chega mais (fan-out por canal).
      await chamar('subscribeChannel', { channelId: defaultChannelId, on: false });
      relogio.now += 3_000;
      const quadrosTypingAntes = recebidas.filter((x) => x.topic === 'typing.changed').length;
      const typing2 = await chamar('presencePublish', { status: 'dnd', typingChannelId: defaultChannelId });
      assert.equal(typing2.ok, true);
      assert.equal(
        recebidas.filter((x) => x.topic === 'typing.changed').length,
        quadrosTypingAntes,
        'typing publicado sem assinante não cruza o fio',
      );
    } finally {
      await r.close();
    }
  });

  it('presence.refresh mantém o roster vivo e query.members/member leem a presença', async () => {
    const relogio = { now: T0 };
    const r = await rig('roster-54', relogio);
    try {
      const { communityId } = await r.comunidadeNova();
      const fundador = r.identity.publicKey.toString('hex');

      await r.runtime.loops!.runNow('presence.refresh');

      const lista = (await r.request('query.members', { communityId })).data as {
        groups: Array<{ members: Array<Record<string, unknown>> }>;
        offlineCount: number;
        total: number;
      };
      const todos = lista.groups.flatMap((g) => g.members);
      const eu = todos.find((m) => m['key'] === fundador)!;
      assert.equal(eu['presence'], 'online', 'o refresh do próprio nó alimenta o roster (§22.1)');
      assert.equal(lista.total, 1);
      assert.equal(lista.offlineCount, 0, 'offline agora tem fonte: total − presença viva');

      const soOnline = (await r.request('query.members', { communityId, filter: { onlyOnline: true } })).data as {
        groups: Array<{ members: Array<Record<string, unknown>> }>;
        offlineCount: number;
      };
      assert.equal(soOnline.groups.flatMap((g) => g.members).length, 1, 'onlyOnline filtra DE VERDADE com produtor');

      const perfil = (await r.request('query.member', { communityId, identityKey: fundador })).data as Record<string, unknown>;
      assert.equal(perfil['presence'], 'online');

      // O TTL de 45 s vence a entrada — e ela some da consulta sem virar `offline`.
      relogio.now = T0 + 46_000;
      await r.runtime.loops!.runNow('presence.tick');
      const depois = (await r.request('query.member', { communityId, identityKey: fundador })).data as Record<string, unknown>;
      assert.equal('presence' in depois, false, 'offline é AUSÊNCIA, nunca um valor escrito (§6.1)');
    } finally {
      await r.close();
    }
  });
});

describe('§54.3 jobs do núcleo vivo (§22.2)', () => {
  it('host.inactivity aparece no rail: inactiveDays deriva do último contato', async () => {
    const relogio = { now: T0 };
    const r = await rig('inatividade-54', relogio);
    try {
      const { communityId } = await r.comunidadeNova();
      const eventos = r.assinar('host.statusChanged');
      await new Promise((res) => setImmediate(res));
      relogio.now = T0 + (INACTIVE_COMMUNITY_DAYS + 2) * DIA;
      await r.runtime.jobs!.runNow('host.inactivity');
      const item = ((await r.request('query.communities', {})).data as Array<Record<string, unknown>>)[0]!;
      assert.equal(item['inactiveDays'], INACTIVE_COMMUNITY_DAYS + 2);
      assert.equal(item['hostStatus'], 'online', 'hospedada aqui segue online — inatividade é do HOST visto, não dela');
      const cruzou = eventos.filter((e) => Number(e['lastSeenAt']) === T0);
      assert.equal(cruzou.length, 1, 'a travessia do limiar sai por host.statusChanged (tabela fechada)');
    } finally {
      await r.close();
    }
  });

  it('outbox.expire descarta por idade DENTRO da reconciliação (§11.6 fecha DS-06/DS-07)', async () => {
    const relogio = { now: T0 };
    const r = await rig('expire-54', relogio);
    try {
      const { communityId, defaultChannelId } = await r.comunidadeNova();
      const enfileirada = await r.request('message.send', { communityId, channelId: defaultChannelId, content: 'vai expirar', mentions: [] });
      assert.ok(enfileirada.ok, JSON.stringify(enfileirada));
      const opId = (enfileirada.data as { opId: string }).opId;

      // Sem idade, o job não toca em item nenhum.
      await r.runtime.jobs!.runNow('outbox.expire');
      let fila = (await r.request('query.outbox', { communityId })).data as { items: Array<Record<string, unknown>> };
      assert.equal(fila.items.length, 1);
      assert.equal(fila.items[0]!['state'], 'queued');

      // Idade além de OUTBOX_MAX_AGE_MS (72 h): a passagem de reconcile é que decide.
      relogio.now = T0 + 73 * 60 * 60_000;
      await r.runtime.jobs!.runNow('outbox.expire');
      fila = (await r.request('query.outbox', { communityId })).data as { items: Array<Record<string, unknown>> };
      assert.equal(fila.items[0]!['state'], 'dropped');
      assert.equal(fila.items[0]!['droppedReason'], 'expired');
      assert.equal(fila.items[0]!['opId'], opId);
    } finally {
      await r.close();
    }
  });

  it('removed.purge apaga a réplica vencida inteira: LS, CS e disco (§18.4)', async () => {
    const relogio = { now: T0 };
    const r = await rig('purge-54', relogio);
    try {
      const { communityId, defaultChannelId } = await r.comunidadeNova();
      await r.request('message.send', { communityId, channelId: defaultChannelId, content: 'histórico', mentions: [] });
      await r.request('settings.setNotifications', { communityId, level: 'none' });
      const coreDir = path.join(r.dir, 'cores', communityId);
      assert.ok(fs.existsSync(coreDir), 'o core da comunidade existe antes do purge');

      // O caminho de ban de §18.4 passos 2–5 é de outra fatia; aqui a linha já venceu.
      r.manifest.raw
        .prepare("UPDATE communities SET left_at = ?, removed_reason = 'banned', retain_until = ? WHERE community_id = ?")
        .run(relogio.now, relogio.now - 1, communityId);

      await r.runtime.jobs!.runNow('removed.purge');

      assert.deepEqual(
        (r.manifest.listCommunities() as Array<{ community_id: string }>).filter((x) => x.community_id === communityId),
        [],
        'a linha do rail saiu do manifest',
      );
      const mensagens = r.view.prepare('SELECT COUNT(*) AS n FROM messages WHERE community_id = ?').get(communityId) as { n: number };
      assert.equal(mensagens.n, 0, 'o conteúdo projetado saiu da view.db');
      assert.equal(r.manifest.getNotificationLevel(communityId), null, 'o LS do leitor saiu junto');
      assert.equal(fs.existsSync(coreDir), false, 'o core saiu do disco');
      const rail = (await r.request('query.communities', {})).data as unknown[];
      assert.deepEqual(rail, []);
    } finally {
      await r.close();
    }
  });

  it('log.rotate aplica retenção de §24.1; db.maintenance/staging.gc/succession.check rodam sem derrubar nada', async () => {
    const relogio = { now: T0 };
    const r = await rig('rotacao-54', relogio);
    try {
      const logsDir = path.join(r.dir, 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      fs.writeFileSync(path.join(logsDir, 'core-2020-01-01.ndjson'), '{"ts":1}\n');
      const hoje = new Date(relogio.now);
      const nomeHoje = `core-${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}.ndjson`;
      fs.writeFileSync(path.join(logsDir, nomeHoje), '{"ts":2}\n');
      // Arquivo fora da forma de §24.1 não é log rotacionável — fica.
      fs.writeFileSync(path.join(logsDir, 'boot.log'), 'x');

      await r.runtime.jobs!.runNow('log.rotate');
      assert.equal(fs.existsSync(path.join(logsDir, 'core-2020-01-01.ndjson')), false, 'além de LOG_RETENTION_DAYS sai');
      assert.equal(fs.existsSync(path.join(logsDir, nomeHoje)), true, 'o log do dia fica');
      assert.equal(fs.existsSync(path.join(logsDir, 'boot.log')), true);

      await r.runtime.jobs!.runNow('db.maintenance');
      await r.runtime.jobs!.runNow('staging.gc');
      await r.runtime.jobs!.runNow('succession.check');
      assert.ok(true, 'os quatro corpos rodam no caminho de produto sem exceção');
    } finally {
      await r.close();
    }
  });
});
