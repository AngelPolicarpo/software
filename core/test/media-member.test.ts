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
import { remoteMediaDispatcher } from '../src/l3/ipcRenderer/media.ts';
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
    // 9 = voice_speak, 11 = voice_share_screen (§9.1)
    roles: new Map([['r', { permissions: [9, 11] }]]),
  };
}

type Rig = {
  ipc: IpcClient;
  voice: VoiceHostSessions;
  share: ShareHostSessions;
  hostSide: { drop(): void };
  memberSide: { drop(): void };
};

async function rig(): Promise<Rig> {
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
  wireHostMediaRpc(rpcServer, {
    peerKeyHex: MEMBRO_HEX,
    stateFor: () => voiceStateOf(state as unknown as DecisionState),
    voice,
    share,
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
  registerCoreCommands(server, {
    // Só a superfície de mídia importa aqui; diagnóstico e busca não são exercitados.
    diagnostics: undefined as unknown as Diagnostics,
    search: undefined as unknown as SearchService,
    media: { dispatcher: remoteMediaDispatcher(rpcClient) },
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
    const dispatcher = remoteMediaDispatcher({
      call: async (method) => {
        chamadas.push(method);
        return proxima;
      },
    });

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
      })) as { sessionId: string; captureToken?: unknown };
      assert.match(started.sessionId, /.+/);
      // §16.2 devolve só `{sessionId}`: em modo membro o token de §15.4 não vem (§39).
      assert.equal(started.captureToken, undefined);

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

  it('as duas superfícies sem método em §16.2 recusam em vez de fingir', async () => {
    const r = await rig();
    try {
      await r.ipc.request('voice.join', { communityId: 'c', channelId: CANAL });
      // §16.2 não tem método para nenhuma das duas: a recusa é a mesma de superfície não
      // composta nesta instalação, e a lacuna está registrada em §39 — nada é inventado.
      assert.equal(
        await code(r.ipc.request('voice.muteParticipant', { communityId: 'c', identityKey: APRESENTADOR_HEX, muted: true })),
        'E_UNKNOWN_COMMAND',
      );
      assert.equal(
        await code(r.ipc.request('share.setQuality', { sessionId: 'qualquer', quality: 'low' })),
        'E_UNKNOWN_COMMAND',
      );
      // A forma do argumento continua sendo validada antes: perfil inválido é E_VALIDATION.
      assert.equal(
        await code(r.ipc.request('share.setQuality', { sessionId: 'qualquer', quality: 'ultra' })),
        'E_VALIDATION',
      );
    } finally {
      r.hostSide.drop();
    }
  });
});
