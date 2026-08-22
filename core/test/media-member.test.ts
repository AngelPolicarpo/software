/**
 * Voz e tela em **modo membro** (§15.4, §16.2, §17.4/§17.5): a mesma superfície IPC-R, com
 * a decisão do outro lado do RPC.
 *
 * O que é REAL aqui: `IpcServer`/`IpcClient`, o roteador de §15.4, `RpcClient`/`RpcServer`
 * com a tabela fechada de §16.2, `VoiceHostSessions`/`ShareHostSessions` do lado host e os
 * tickets Ed25519 de §17.4 — verificados depois da travessia do fio, que é onde um codec
 * errado apareceria. SIMULADO: só a socket (par de canais em memória).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DecisionState } from '../src/l1/fold/index.ts';
import { MAX_CAMERAS, MAX_VOICE_PARTICIPANTS, MEDIA_TICKET_TTL_MS, SHARE_MAX_VIEWERS } from '../src/l1/fold/constants.ts';
import { ShareHostSessions } from '../src/l2/shareStar/index.ts';
import { VoiceHostSessions, orderedPair, verifyMediaTicket } from '../src/l2/voiceCoordinator/index.ts';
import { IpcClient, IpcServer, MemoryIpcPort } from '../src/l3/ipcRenderer/index.ts';
import { registerCoreCommands } from '../src/l3/ipcRenderer/commands.ts';
import { VoiceTicketRenewer, mediaWire, remoteMediaDispatcher } from '../src/l3/ipcRenderer/media.ts';
import { mediaWireServer, type SignalDeliveryPort } from '../src/l3/rpcServer/media.ts';
import { RpcClient } from '../src/l3/rpcClient/index.ts';
import { RpcServer } from '../src/l3/rpcServer/index.ts';
import type { Diagnostics } from '../src/l2/diagnostics/index.ts';
import type { SearchService } from '../src/l2/search/index.ts';
import { keypairFromSeed } from './helpers/world.ts';
import { rpcPair, voiceStateOf, wireHostMediaRpc } from './helpers/composition.ts';

const HOSTKEY = keypairFromSeed('host-membro');
const APRESENTADOR = keypairFromSeed('apresentador');
const MEMBRO = keypairFromSeed('membro-remoto');
const APRESENTADOR_HEX = APRESENTADOR.publicKey.toString('hex');
const MEMBRO_HEX = MEMBRO.publicKey.toString('hex');
const CANAL = 'ch-voz';

/** Recorte estrutural do host: um canal de voz e dois membros com `voice_speak`. */
function fixture() {
  return {
    community: { exists: true },
    channels: new Map([
      [CANAL, { type: 1 }],
      ['ch-texto', { type: 0 }],
    ]),
    members: new Map([
      [APRESENTADOR_HEX, { state: 'active' as const, roleIds: ['r'] }],
      [MEMBRO_HEX, { state: 'active' as const, roleIds: ['r'] }],
    ]),
    // 9 = voice_speak, 10 = voice_mute_others, 11 = voice_share_screen (§9.1)
    roles: new Map([['r', { permissions: [9, 10, 11] }]]),
  };
}

type Rig = {
  ipc: IpcClient;
  voice: VoiceHostSessions;
  share: ShareHostSessions;
  hostSide: { drop(): void };
  memberSide: { drop(): void };
  /** §15.7 `capture.authorize` — o main pergunta ao núcleo local, não ao host. */
  captura(a: { sessionId: string }): { allowed: boolean; reason?: string };
  dispatcher: ReturnType<typeof remoteMediaDispatcher>;
  /** O que o host encaminhou (§16.2 `voiceSignal`). */
  sinais: Array<Record<string, unknown>>;
};

async function rig(opts: { readonly comRelay?: boolean } = {}): Promise<Rig> {
  let now = 1_700_000_000_000;
  const clock = { now: () => now };
  const state = fixture();

  const voice = new VoiceHostSessions({
    hostSecretKey: HOSTKEY.secretKey,
    hostTurnSecret: Buffer.alloc(32, 7),
    clock,
    ttlMs: MEDIA_TICKET_TTL_MS,
    maxParticipants: MAX_VOICE_PARTICIPANTS,
    maxCameras: MAX_CAMERAS,
    isVoiceChannelType: (type) => type === 1,
  });
  const share = new ShareHostSessions({
    hostSecretKey: HOSTKEY.secretKey,
    clock,
    ttlMs: MEDIA_TICKET_TTL_MS,
    captureTokenTtlMs: 60_000,
    maxViewers: SHARE_MAX_VIEWERS,
    isVoiceChannelType: (type) => type === 1,
    voiceParticipants: (channelId) => {
      const session = voice.sessionOf(channelId);
      return session === null ? null : new Set(session.participants.map((p) => p.keyHex));
    },
  });

  // Transporte de §16: o host de um lado, o membro do outro.
  const [hostSide, memberSide] = rpcPair();
  const rpcServer = new RpcServer({ protocol: 'community', transport: hostSide });
  const sinais: Array<Record<string, unknown>> = [];
  const signal: SignalDeliveryPort = {
    deliver: (a) => {
      sinais.push({ ...a });
      // Par fora do roster desta sessão é `E_PEER_UNREACHABLE` (§15.4).
      return voice.sessionOf(CANAL)?.participants.some((p) => p.keyHex === a.toPeerKey) === true
        ? { ok: true }
        : { ok: false, code: 'E_PEER_UNREACHABLE' };
    },
  };
  wireHostMediaRpc(rpcServer, {
    peerKeyHex: MEMBRO_HEX,
    stateFor: () => voiceStateOf(state as unknown as DecisionState),
    voice,
    share,
    ...(opts.comRelay === false ? {} : { signal }),
  });
  const rpcClient = new RpcClient({ protocol: 'community', transport: memberSide });

  // Fronteira IPC-R do membro, com o dispatcher REMOTO na mesma interface do modo host.
  const [coreSide, rendererSide] = MemoryIpcPort.createPair();
  const server = new IpcServer({
    epoch: 1,
    port: coreSide,
    tokenVerifier: { consume: () => false },
    identityStatus: { isLoaded: true },
  });
  const dispatcher = remoteMediaDispatcher(rpcClient, {
    captureTokenTtlMs: 60_000,
    now: clock.now,
    mintToken: () => 'token-local-de-teste',
  });
  registerCoreCommands(server, {
    // Só a superfície de mídia importa aqui; diagnóstico e busca não são exercitados.
    diagnostics: undefined as unknown as Diagnostics,
    search: undefined as unknown as SearchService,
    media: { dispatcher },
  });
  const ipc = new IpcClient();
  ipc.attach(rendererSide);
  const hello = ipc.waitForHello(1_000);
  server.sendHello('membro', 2);
  await hello;

  return {
    ipc,
    voice,
    share,
    hostSide,
    memberSide,
    captura: (a) => dispatcher.authorizeCapture(a),
    dispatcher,
    sinais,
  };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'sem-erro';
  } catch (err) {
    return (err as NodeJS.ErrnoException).code ?? 'sem-codigo';
  }
}

describe('modo membro — voz por §16.2 (§15.4, §17.4)', () => {
  it('`voice.join` atravessa o RPC e o ticket sobrevive ao fio, verificável', async () => {
    const r = await rig();
    try {
      // O apresentador já está na chamada, direto no host: é dele o par do ticket.
      assert.equal(
        r.voice.join({
          state: voiceStateOf(fixture() as unknown as DecisionState),
          channelId: CANAL,
          memberKeyHex: APRESENTADOR_HEX,
        }).ok,
        true,
      );

      const joined = (await r.ipc.request('voice.join', { communityId: 'c', channelId: CANAL })) as {
        sessionId: string;
        channelId: string;
        roster: Array<{ keyHex: string }>;
        tickets: Array<{ peerA: Buffer; peerB: Buffer; sig: Buffer; sessionId: string; channelId: string; expiresAt: number }>;
        turnCredential: { username: string; password: string };
      };

      assert.equal(joined.channelId, CANAL);
      assert.deepEqual(joined.roster.map((p) => p.keyHex).sort(), [APRESENTADOR_HEX, MEMBRO_HEX].sort());
      assert.equal(joined.tickets.length, 1);
      assert.match(joined.turnCredential.password, /^[0-9a-f]+$/);

      // O ticket é Ed25519 sobre BLAKE2b (§17.4). Se o codec de fio perdesse um byte de
      // `peerA`/`peerB`/`sig`, esta verificação falharia — é o teste do codec.
      const ticket = joined.tickets[0]!;
      const par = orderedPair(MEMBRO.publicKey, APRESENTADOR.publicKey);
      assert.deepEqual(
        verifyMediaTicket(
          HOSTKEY.publicKey,
          {
            ...ticket,
            peerA: Buffer.from(ticket.peerA),
            peerB: Buffer.from(ticket.peerB),
            sig: Buffer.from(ticket.sig),
          },
          {
            sessionId: joined.sessionId,
            channelId: CANAL,
            localPeer: par.peerA,
            remotePeer: par.peerB,
          },
          1_700_000_000_000,
        ),
        { ok: true },
      );
    } finally {
      r.hostSide.drop();
    }
  });

  it('a sessão corrente é estado client-side: nasce no join, morre no leave', async () => {
    const r = await rig();
    try {
      // §15.4: `voice.setSelf` não tem sessionId — sem sessão local não há o que ajustar.
      assert.equal(await code(r.ipc.request('voice.setSelf', { muted: true })), 'E_SESSION_GONE');

      await r.ipc.request('voice.join', { communityId: 'c', channelId: CANAL });
      assert.deepEqual(await r.ipc.request('voice.setSelf', { muted: true }), {});
      assert.equal(
        r.voice.sessionOf(CANAL)?.participants.find((p: { keyHex: string }) => p.keyHex === MEMBRO_HEX)?.muted,
        true,
      );

      // `voice.leave` sem argumento (§15.4) usa a sessão que o cliente guardou.
      assert.deepEqual(await r.ipc.request('voice.leave', {}), {});
      assert.equal(r.voice.currentSessionOf(MEMBRO_HEX), null);
      assert.equal(await code(r.ipc.request('voice.setSelf', { muted: false })), 'E_SESSION_GONE');

      // Sem sessão, sair de novo é o mesmo no-op nomeado do modo host.
      assert.deepEqual(await r.ipc.request('voice.leave', {}), {});
    } finally {
      r.hostSide.drop();
    }
  });

  it('`voice.muteParticipant` atravessa por `voiceMute` e é decidido pelo host', async () => {
    const r = await rig();
    try {
      assert.equal(
        r.voice.join({
          state: voiceStateOf(fixture() as unknown as DecisionState),
          channelId: CANAL,
          memberKeyHex: APRESENTADOR_HEX,
        }).ok,
        true,
      );
      // Sem sessão local não há roster onde silenciar — nem sai da máquina.
      assert.equal(
        await code(r.ipc.request('voice.muteParticipant', { communityId: 'c', identityKey: APRESENTADOR_HEX, muted: true })),
        'E_SESSION_GONE',
      );

      await r.ipc.request('voice.join', { communityId: 'c', channelId: CANAL });
      assert.deepEqual(
        await r.ipc.request('voice.muteParticipant', { communityId: 'c', identityKey: APRESENTADOR_HEX, muted: true }),
        {},
      );
      // L-12: o efeito é a marca no roster do host, que chega ao alvo por `voice.roster`.
      assert.equal(
        r.voice.sessionOf(CANAL)?.participants.find((p: { keyHex: string }) => p.keyHex === APRESENTADOR_HEX)?.muted,
        true,
      );

      // O alvo continua sendo resolvido pelo host, contra o roster dele.
      assert.equal(
        await code(r.ipc.request('voice.muteParticipant', { communityId: 'c', identityKey: 'ff'.repeat(32), muted: true })),
        'E_SESSION_GONE',
      );
    } finally {
      r.hostSide.drop();
    }
  });

  it('a recusa do host chega com o código do catálogo, sem tradução', async () => {
    const r = await rig();
    try {
      assert.equal(
        await code(r.ipc.request('voice.join', { communityId: 'c', channelId: 'ch-texto' })),
        'E_CHANNEL_NOT_VOICE',
      );
      assert.equal(await code(r.ipc.request('share.join', { sessionId: 'sess-inexistente' })), 'E_SESSION_GONE');
    } finally {
      r.hostSide.drop();
    }
  });

  it('recusa do host que mata a sessão apaga o estado client-side', async () => {
    // Porta de RPC controlada: aqui interessa a regra do dispatcher, não o transporte.
    const chamadas: string[] = [];
    let proxima: { ok: true; body: Uint8Array } | { ok: false; code: string } = {
      ok: true,
      body: new Uint8Array(Buffer.from(JSON.stringify({ sessionId: 'sess-1', channelId: CANAL }), 'utf8')),
    };
    const dispatcher = remoteMediaDispatcher(
      {
        call: async (method) => {
          chamadas.push(method);
          return proxima;
        },
      },
      { captureTokenTtlMs: 60_000 },
    );

    assert.equal((await dispatcher.voiceJoin({ communityId: 'c', channelId: CANAL })).ok, true);
    assert.equal(dispatcher.currentSessionId(), 'sess-1');

    // §16.1: a conexão caiu ou o prazo estourou — os dois viram `E_HOST_UNAVAILABLE`.
    proxima = { ok: false, code: 'E_HOST_UNAVAILABLE' };
    assert.deepEqual(await dispatcher.voiceSetSelf({ muted: true }), { ok: false, code: 'E_HOST_UNAVAILABLE' });
    assert.equal(dispatcher.currentSessionId(), null);

    // Sem sessão, a próxima chamada nem chega à rede.
    assert.deepEqual(await dispatcher.voiceSetSelf({ muted: true }), { ok: false, code: 'E_SESSION_GONE' });
    assert.deepEqual(chamadas, ['voiceJoin', 'voiceState']);

    // §17.4 — a revogação chega por evento, e derruba a sessão sem round-trip.
    proxima = { ok: true, body: new Uint8Array(Buffer.from(JSON.stringify({ sessionId: 'sess-2' }), 'utf8')) };
    await dispatcher.voiceJoin({ communityId: 'c', channelId: CANAL });
    assert.equal(dispatcher.currentSessionId(), 'sess-2');
    dispatcher.forgetSession();
    assert.equal(dispatcher.currentSessionId(), null);
  });
});

describe('modo membro — tela por §16.2 (§15.4, §17.5)', () => {
  it('start, join e stop atravessam; o teto de espectadores continua sendo do host', async () => {
    const r = await rig();
    try {
      // O membro remoto entra na chamada e compartilha; o apresentador local assiste.
      await r.ipc.request('voice.join', { communityId: 'c', channelId: CANAL });
      assert.equal(
        r.voice.join({
          state: voiceStateOf(fixture() as unknown as DecisionState),
          channelId: CANAL,
          memberKeyHex: APRESENTADOR_HEX,
        }).ok,
        true,
      );

      const started = (await r.ipc.request('share.start', {
        communityId: 'c',
        channelId: CANAL,
        quality: 'high',
      })) as { sessionId: string; captureToken: { sessionId: string } };
      assert.match(started.sessionId, /.+/);
      // §15.4 devolve o token; §16.2 não o transportou (§17.4 emendado).
      assert.equal(started.captureToken.sessionId, started.sessionId);

      // Segunda sessão no mesmo canal é do host recusar (delta U-10).
      assert.equal(
        await code(r.ipc.request('share.start', { communityId: 'c', channelId: CANAL, quality: 'low' })),
        'E_ALREADY_SHARING',
      );

      const espectador = r.share.join({ sessionId: started.sessionId, memberKeyHex: APRESENTADOR_HEX });
      assert.equal(espectador.ok, true);

      // `share.stop` do apresentador vai por `shareLeave` (§17.5: sair encerra tudo).
      assert.deepEqual(await r.ipc.request('share.stop', { sessionId: started.sessionId }), {});
      assert.equal(
        await code(r.ipc.request('share.stop', { sessionId: started.sessionId })),
        'E_SESSION_GONE',
      );
    } finally {
      r.hostSide.drop();
    }
  });

  it('`share.setQuality` do espectador atravessa por `shareQuality` (§16.2 emendado)', async () => {
    const r = await rig();
    try {
      // O apresentador local abre a sessão; o membro remoto entra na chamada e assiste.
      const estado = voiceStateOf(fixture() as unknown as DecisionState);
      assert.equal(r.voice.join({ state: estado, channelId: CANAL, memberKeyHex: APRESENTADOR_HEX }).ok, true);
      await r.ipc.request('voice.join', { communityId: 'c', channelId: CANAL });
      const sessao = r.share.start({ state: estado, channelId: CANAL, presenterKeyHex: APRESENTADOR_HEX });
      assert.equal(sessao.ok, true);
      const sessionId = (sessao as { sessionId: string }).sessionId;
      assert.equal(r.share.join({ sessionId, memberKeyHex: MEMBRO_HEX }).ok, true);

      assert.deepEqual(await r.ipc.request('share.setQuality', { sessionId, quality: 'low' }), { applied: true });
      // O perfil ficou registrado no host — é dele que `share.health` tira o `quality` que
      // leva o pedido ao apresentador (§15.5, §17.5).
      assert.equal(r.share.viewerQuality(sessionId, MEMBRO_HEX), 'low');

      // Quem não assiste não muda qualidade: a decisão continua sendo do host.
      assert.equal(
        await code(r.ipc.request('share.setQuality', { sessionId: 'sess-inexistente', quality: 'low' })),
        'E_SESSION_GONE',
      );
      // A forma do argumento é validada antes de qualquer viagem.
      assert.equal(
        await code(r.ipc.request('share.setQuality', { sessionId, quality: 'ultra' })),
        'E_VALIDATION',
      );
    } finally {
      r.hostSide.drop();
    }
  });

  it('o `captureToken` é cunhado localmente e `capture.authorize` não vai ao host', async () => {
    const r = await rig();
    try {
      await r.ipc.request('voice.join', { communityId: 'c', channelId: CANAL });
      const started = (await r.ipc.request('share.start', { communityId: 'c', channelId: CANAL })) as {
        sessionId: string;
        captureToken: { token: string; sessionId: string; expiresAt: number };
      };
      // §15.4 devolve o token; §16.2 não o transportou — ele nasceu deste lado (§17.4).
      assert.equal(started.captureToken.token, 'token-local-de-teste');
      assert.equal(started.captureToken.sessionId, started.sessionId);
      assert.equal(r.captura({ sessionId: started.sessionId }).allowed, true);
      assert.deepEqual(r.captura({ sessionId: 'outra-sessao' }), { allowed: false, reason: 'mismatch' });

      // Sessão encerrada, capacidade encerrada: não há captura órfã.
      await r.ipc.request('share.stop', { sessionId: started.sessionId });
      assert.deepEqual(r.captura({ sessionId: started.sessionId }), { allowed: false, reason: 'mismatch' });
    } finally {
      r.hostSide.drop();
    }
  });
});

// ─── Sinalização, renovação e paridade do codec ───────────────────────────────────────

describe('sinalização encaminhada pelo host (§16.2 `voiceSignal`, §17.4)', () => {
  it('o núcleo encaminha sem ler e o host resolve o destino', async () => {
    const r = await rig();
    try {
      assert.equal(
        r.voice.join({
          state: voiceStateOf(fixture() as unknown as DecisionState),
          channelId: CANAL,
          memberKeyHex: APRESENTADOR_HEX,
        }).ok,
        true,
      );
      // Fora de chamada não há sessão para sinalizar — nem sai da máquina.
      assert.equal(
        await code(r.ipc.request('voice.signal', { peerKey: APRESENTADOR_HEX, ticketId: 't1', sdp: 'v=0' })),
        'E_SESSION_GONE',
      );

      await r.ipc.request('voice.join', { communityId: 'c', channelId: CANAL });
      assert.deepEqual(
        await r.ipc.request('voice.signal', { peerKey: APRESENTADOR_HEX, ticketId: 't1', sdp: 'v=0\r\n' }),
        {},
      );
      assert.equal(r.sinais.length, 1);
      assert.equal(r.sinais[0]?.['toPeerKey'], APRESENTADOR_HEX);
      // A origem é a da conexão, não algo que o remetente possa declarar.
      assert.equal(r.sinais[0]?.['fromPeerKey'], MEMBRO_HEX);
      assert.equal(r.sinais[0]?.['sdp'], 'v=0\r\n');

      // Par que não está na chamada: §15.4 nomeia `E_PEER_UNREACHABLE`.
      assert.equal(
        await code(r.ipc.request('voice.signal', { peerKey: 'ff'.repeat(32), ticketId: 't1', ice: 'candidate:1' })),
        'E_PEER_UNREACHABLE',
      );
    } finally {
      r.hostSide.drop();
    }
  });

  it('host sem relay composto recusa em vez de fingir que entregou', async () => {
    const r = await rig({ comRelay: false });
    try {
      await r.ipc.request('voice.join', { communityId: 'c', channelId: CANAL });
      assert.equal(
        await code(r.ipc.request('voice.signal', { peerKey: APRESENTADOR_HEX, ticketId: 't1', sdp: 'v=0' })),
        'E_PEER_UNREACHABLE',
      );
    } finally {
      r.hostSide.drop();
    }
  });
});

describe('renovação de ticket é do núcleo (§17.4 emendado, §26.2)', () => {
  it('o ciclo renova por par e empurra `voice.tickets` verificável', async () => {
    const r = await rig();
    try {
      assert.equal(
        r.voice.join({
          state: voiceStateOf(fixture() as unknown as DecisionState),
          channelId: CANAL,
          memberKeyHex: APRESENTADOR_HEX,
        }).ok,
        true,
      );

      const emitidos: Array<{ topic: string; data: Record<string, unknown> }> = [];
      const renewer = new VoiceTicketRenewer({
        dispatcher: r.dispatcher,
        communityId: () => 'com-a',
        emit: (ev) => emitidos.push(ev),
        periodMs: 60_000,
        schedule: () => null,
        cancel: () => {},
      });

      // Fora de chamada é no-op: não há prazo de que cuidar.
      await renewer.tick();
      assert.equal(emitidos.length, 0);

      const joined = (await r.ipc.request('voice.join', { communityId: 'c', channelId: CANAL })) as {
        sessionId: string;
      };
      await renewer.tick();
      assert.equal(emitidos.length, 1);
      assert.equal(emitidos[0]?.topic, 'voice.tickets');
      assert.equal(emitidos[0]?.data['communityId'], 'com-a');
      assert.equal(emitidos[0]?.data['sessionId'], joined.sessionId);

      // O próprio membro não renova consigo mesmo: sobra o par do apresentador.
      const tickets = emitidos[0]?.data['tickets'] as Array<Parameters<typeof mediaWire.decodeTicket>[0]>;
      assert.equal(tickets.length, 1);
      const par = orderedPair(MEMBRO.publicKey, APRESENTADOR.publicKey);
      assert.deepEqual(
        verifyMediaTicket(
          HOSTKEY.publicKey,
          mediaWire.decodeTicket(tickets[0]!),
          { sessionId: joined.sessionId, channelId: CANAL, localPeer: par.peerA, remotePeer: par.peerB },
          1_700_000_000_000,
        ),
        { ok: true },
      );

      // Depois de sair, o ciclo volta a ser no-op — nada de renovar sessão morta.
      await r.ipc.request('voice.leave', {});
      await renewer.tick();
      assert.equal(emitidos.length, 1);
    } finally {
      r.hostSide.drop();
    }
  });
});

describe('codec de fio — paridade entre as duas cópias de L3', () => {
  const ticket = {
    sessionId: 'sess-1',
    channelId: CANAL,
    peerA: Buffer.alloc(32, 1),
    peerB: Buffer.alloc(32, 2),
    expiresAt: 1_700_000_300_000,
    sig: Buffer.alloc(64, 3),
  };

  it('cliente e servidor codificam o ticket igual, byte a byte', () => {
    assert.deepEqual(mediaWire.encodeTicket(ticket), mediaWireServer.encodeTicket(ticket));
  });

  it('o que o servidor codifica, o cliente decodifica de volta ao original', () => {
    assert.deepEqual(mediaWire.decodeTicket(mediaWireServer.encodeTicket(ticket)), ticket);
    assert.deepEqual(mediaWireServer.decodeTicket(mediaWire.encodeTicket(ticket)), ticket);
  });

  it('`voiceJoin` sai igual dos dois lados', () => {
    const join = {
      sessionId: 'sess-1',
      channelId: CANAL,
      roster: [{ keyHex: MEMBRO_HEX, muted: false, deafened: false, sharing: false, cameraOn: false, speaking: false }],
      iceServers: [{ urls: 'stun:host:3478' }],
      tickets: [ticket],
      turnCredential: { username: 'sess-1:1700000300000', password: 'ab'.repeat(32) },
    };
    assert.deepEqual(mediaWire.encodeVoiceJoin(join), mediaWireServer.encodeVoiceJoin(join));
    assert.deepEqual(mediaWire.decodeVoiceJoin(mediaWireServer.encodeVoiceJoin(join)), { ok: true, ...join });
  });
});
