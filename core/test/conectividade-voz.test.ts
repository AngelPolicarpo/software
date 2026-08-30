// Conectividade de voz — os defeitos que a investigação de 2026-08-30 fechou, provados um a
// um no nível de unidade. O que é REAL aqui: `RpcClient`, `HostStatusTracker`,
// `IpcServer`/`IpcClient` sobre par de portas em memória, os dois dispatchers de mídia e o
// `VoiceTicketRenewer`. SIMULADO: só o cabo (transporte de mentira e portas em memória).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HostStatusTracker, type HostStatusEvent } from '../src/composition/hostStatus.ts';
import { IpcClient, IpcServer, MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import {
  VoiceTicketRenewer,
  remoteMediaDispatcher,
  type RpcCallPort,
} from '../src/l3/ipcRenderer/media.ts';
import { RpcClient, type RpcTransportPort } from '../src/l3/rpcClient/index.ts';

// ─── Cabo de mentira — o suficiente para o RpcClient acreditar ─────────────────────────

function caboFalso(opts: { responde?: boolean } = {}) {
  const downs: Array<() => void> = [];
  const enviados: string[] = [];
  let frameCb: ((raw: Uint8Array) => void) | null = null;
  const cabo: RpcTransportPort = {
    send: (raw) => {
      const quadro = Buffer.from(raw).toString('utf8');
      enviados.push(quadro);
      if (opts.responde === true && frameCb !== null) {
        const pedido = JSON.parse(quadro) as { i: number };
        frameCb(
          Buffer.from(
            JSON.stringify({ i: pedido.i, ok: true, b: Buffer.from('{}').toString('base64') }),
            'utf8',
          ),
        );
      }
    },
    onFrame: (cb) => {
      frameCb = cb;
    },
    onDown: (cb) => downs.push(cb),
  };
  return { cabo, cair: () => downs.forEach((cb) => cb()), enviados };
}

describe('RpcClient — o cabo morto deixa de ser destino (§16.1)', () => {
  it('pedido feito DEPOIS da queda falha já com E_HOST_UNAVAILABLE, sem esperar o teto', async () => {
    const { cabo, cair } = caboFalso();
    const cliente = new RpcClient({ protocol: 'community', transport: cabo, role: 'member' });
    cair();

    const r = await cliente.call('hello', new Uint8Array());
    assert.deepEqual(r, { ok: false, code: 'E_HOST_UNAVAILABLE' });
  });

  it('a reanexação retoma o serviço — o cliente não fica morto para sempre', async () => {
    const { cabo, cair } = caboFalso();
    const cliente = new RpcClient({ protocol: 'community', transport: cabo, role: 'member' });
    cair();

    const novo = caboFalso({ responde: true });
    cliente.reattach(novo.cabo);
    const r = await cliente.call('hello', new Uint8Array());
    assert.equal(r.ok, true);
    assert.equal(novo.enviados.length, 1, 'o pedido saiu pelo cabo NOVO');
  });
});

// ─── HostStatusTracker — hello falho é falha de contato (§19.4) ────────────────────────

function trackerDe(vistos: Map<string, number>) {
  const eventos: HostStatusEvent['data'][] = [];
  const t = new HostStatusTracker({
    manifest: {
      getLastHostSeenAt: (cid: string) => (vistos.has(cid) ? (vistos.get(cid) as number) : null),
      setLastHostSeenAt: (cid: string, at: number) => void vistos.set(cid, at),
    } as never,
    emit: (ev) => eventos.push(ev.data),
    now: () => 1_700_000_000_000,
    schedule: () => 0,
    cancel: () => {},
    outboxOf: () => undefined,
    stateFor: () => null,
    replicationStateOf: () => null,
    selfKeyHex: () => 'ab'.repeat(32),
  });
  return { t, eventos };
}

describe('HostStatusTracker — conexão meio aberta não fica em `connecting` para sempre', () => {
  it('duas falhas de hello sem contato nenhum viram `offline` (§19.4)', () => {
    const vistos = new Map<string, number>();
    const { t, eventos } = trackerDe(vistos);
    t.ensure('c1', { isHost: false });
    t.channelAttached('c1');
    assert.equal(t.statusOf('c1'), 'connecting');

    t.noteHelloFailure('c1');
    assert.equal(t.statusOf('c1'), 'connecting', 'uma falha ainda é tolerada');
    t.noteHelloFailure('c1');
    assert.equal(t.statusOf('c1'), 'offline');
    assert.equal(eventos.at(-1)!.status, 'offline');
  });

  it('com contato anterior, o veredito é `reconnecting`, não `offline`', () => {
    const vistos = new Map<string, number>([['c1', 1]]);
    const { t } = trackerDe(vistos);
    t.ensure('c1', { isHost: false });
    t.channelAttached('c1');
    t.noteHelloFailure('c1');
    t.noteHelloFailure('c1');
    assert.equal(t.statusOf('c1'), 'reconnecting');
  });

  it('o contato observado encerra a conta de falhas e devolve o `online`', () => {
    const vistos = new Map<string, number>([['c1', 1]]);
    const { t, eventos } = trackerDe(vistos);
    t.ensure('c1', { isHost: false });
    t.channelAttached('c1');
    t.noteHelloFailure('c1');
    t.noteHelloFailure('c1');
    assert.equal(t.statusOf('c1'), 'reconnecting');
    // §15.5 — o `attempt` que a UI mostra é o número de falhas consecutivas.
    assert.equal(eventos.at(-1)!.attempt, 2);
    t.markSeen('c1');
    assert.equal(t.statusOf('c1'), 'online');
  });
});

// ─── Dispatcher membro + renovador — a credencial TURN agora se renova (§17.3) ─────────

/** Porta RPC de mentira que responde por método — a forma que `remoteMediaDispatcher` consome. */
function portaEscrita(handlers: Record<string, (arg: Record<string, unknown>) => unknown>): RpcCallPort {
  return {
    call: async (method, body) => {
      const h = handlers[method];
      if (h === undefined) return { ok: false as const, code: 'E_UNKNOWN_COMMAND' };
      const arg = JSON.parse(Buffer.from(body).toString('utf8')) as Record<string, unknown>;
      return {
        ok: true as const,
        body: new Uint8Array(Buffer.from(JSON.stringify(h(arg)), 'utf8')),
      };
    },
  };
}

const EU = 'aa'.repeat(32);
const PAR = 'bb'.repeat(32);
const TICKET = {
  sessionId: 's1',
  channelId: 'ch',
  peerA: EU,
  peerB: PAR,
  expiresAt: 9_000,
  sig: '00'.repeat(64),
};

describe('refreshSession — o `voiceJoin` idempotente devolve material fresco (§21.2, §17.3)', () => {
  async function dispatcherComChamada(iceServers: ReadonlyArray<{ urls: string }>) {
    let joins = 0;
    const dispatcher = remoteMediaDispatcher(
      portaEscrita({
        voiceJoin: () => {
          joins++;
          return {
            sessionId: 's1',
            channelId: 'ch',
            roster: [{ keyHex: EU }, { keyHex: PAR }],
            iceServers,
            tickets: [TICKET],
          };
        },
        voiceTicket: () => ({ ticketId: 't1', ticket: TICKET, expiresAt: 9_000 }),
      }),
      { captureTokenTtlMs: 60_000, selfKeyHex: () => EU },
    );
    await dispatcher.voiceJoin({ communityId: 'c1', channelId: 'ch' });
    return { dispatcher, joins: () => joins };
  }

  it('devolve a MESMA sessão com a lista iceServers renovada', async () => {
    const renovada = [{ urls: 'turn:1.2.3.4:1?transport=udp' }];
    const { dispatcher } = await dispatcherComChamada(renovada);
    const r = await dispatcher.refreshSession();
    assert.equal(r.ok, true);
    assert.deepEqual((r as { sessionId: string }).sessionId, 's1');
    assert.deepEqual((r as { iceServers: unknown }).iceServers, renovada);
  });

  it('fora de chamada é E_SESSION_GONE — sem sessão não há o que refrescar', async () => {
    const dispatcher = remoteMediaDispatcher(portaEscrita({}), { captureTokenTtlMs: 60_000 });
    const r = await dispatcher.refreshSession();
    assert.deepEqual(r, { ok: false, code: 'E_SESSION_GONE' });
  });

  it('o renovador entrega a credencial junto dos tickets no `voice.tickets`', async () => {
    const renovada = [{ urls: 'turn:1.2.3.4:1?transport=udp' }];
    const { dispatcher } = await dispatcherComChamada(renovada);
    const eventos: Array<Record<string, unknown>> = [];
    const renovador = new VoiceTicketRenewer({
      dispatcher,
      communityId: () => 'c1',
      emit: (ev) => eventos.push(ev.data),
      periodMs: 1_000,
      schedule: () => 0,
      cancel: () => {},
    });
    await renovador.tick();
    const ev = eventos.at(-1)!;
    assert.equal(ev['sessionId'], 's1');
    assert.ok(Array.isArray(ev['tickets']) && (ev['tickets'] as unknown[]).length === 1);
    assert.deepEqual(ev['iceServers'], renovada, 'a credencial TURN renovada viaja com os tickets');
  });
});

// ─── IPC-R — o unsub fala o subId do SERVIDOR (§15.1) ──────────────────────────────────

describe('IPC-R — unsubscribe com subId do servidor, não o local', () => {
  it('depois de um respawn de epoch, desinscrever apaga a entrada CERTA', async () => {
    const [coreSide, rendererSide] = MemoryIpcPort.createPair();
    // Núcleo original…
    let server = new IpcServer({
      epoch: 1,
      port: coreSide,
      tokenVerifier: { consume: () => false },
      identityStatus: { isLoaded: true },
    });
    const ipc = new IpcClient();
    ipc.attach(rendererSide);
    const primeira = ipc.waitForHello(1_000);
    server.sendHello('m', 1);
    await primeira;

    const recebidas: unknown[] = [];
    ipc.subscribe('voz', (d) => recebidas.push(d));
    await new Promise((r) => setTimeout(r, 0));

    // …reinicia: epoch novo no MESMO cabo, contadores do servidor do zero. O cliente
    // mantém os seus — é daqui que os dois mundos divergem.
    server = new IpcServer({
      epoch: 2,
      port: coreSide,
      tokenVerifier: { consume: () => false },
      identityStatus: { isLoaded: true },
    });
    const segunda = ipc.waitForHello(1_000);
    server.sendHello('m', 2);
    await segunda;
    // (o servidor antigo descarta tudo que chega com epoch 2, inclusive esta resposta)

    const localId = ipc.subscribe('voz', (d) => recebidas.push(d));
    await new Promise((r) => setTimeout(r, 0));
    server.emit('voz', { n: 1 });
    await new Promise((r) => setTimeout(r, 0));
    // A assinatura antiga pertencia ao servidor de epoch 1, que está inerte — só a nova
    // (localId 2, subId do servidor 1) recebe.
    assert.equal(recebidas.length, 1, 'a assinatura nova está viva');

    ipc.unsubscribe(localId);
    await new Promise((r) => setTimeout(r, 0));
    server.emit('voz', { n: 2 });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(
      recebidas.length,
      1,
      'a desinscrita não recebe mais — antes, o unsub com o localId apagava a entrada errada',
    );
  });

  it('unsub pedido antes do `subOk` sai quando o subId existir', async () => {
    const [coreSide, rendererSide] = MemoryIpcPort.createPair();
    const server = new IpcServer({
      epoch: 1,
      port: coreSide,
      tokenVerifier: { consume: () => false },
      identityStatus: { isLoaded: true },
    });
    const ipc = new IpcClient();
    ipc.attach(rendererSide);
    const hello = ipc.waitForHello(1_000);
    server.sendHello('m', 1);
    await hello;

    const recebidas: unknown[] = [];
    const localId = ipc.subscribe('voz', (d) => recebidas.push(d));
    // Sem esperar o `subOk` circular: o unsub entra na fila do pendente.
    ipc.unsubscribe(localId);
    await new Promise((r) => setTimeout(r, 0));
    server.emit('voz', { n: 1 });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(recebidas.length, 0, 'desinscrita não recebe nada');
  });
});
