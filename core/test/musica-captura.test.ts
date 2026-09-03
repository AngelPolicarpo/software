// §17.5 (emenda de 2026-08-28) — o Modo Música na fronteira: `music.start` cunha token
// LOCAL nos dois modos, e `capture.authorize{kind:'music'}` o resolve contra a sessão de
// VOZ. O que se prova aqui: o gate é local (permissão + sessão), o token morre com a
// sessão, e o caminho de tela de §17.5 continua intacto.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { localMediaDispatcher } from '../src/l3/ipcRenderer/media.ts';
import { remoteMediaDispatcher, type MediaDispatcher } from '../src/l3/ipcRenderer/media.ts';
import type { VoiceStatePort } from '../src/l2/voiceCoordinator/index.ts';

const EU = 'aa'.repeat(32);

/** Estado com a permissão `voice_share_screen` (11) para EU, ou sem. */
function estado(comPermissao: boolean): VoiceStatePort {
  return {
    community: { exists: true },
    channels: new Map([['ch-voz', { type: 1, speechMode: 0 }]]),
    members: new Map([[EU, { state: 'active', roleIds: ['r-1'] }]]),
    roles: new Map([['r-1', { permissions: comPermissao ? [9, 11] : [9] }]]),
  };
}

/** O dispatcher real com a sessão corrente controlável — no produto ela é o roster vivo. */
function dispatcherLocal(comPermissao: boolean): { d: MediaDispatcher; setSessao(s: string | null): void } {
  let sessao: string | null = null;
  const d = localMediaDispatcher({
    voiceStateFor: (cid: string) => (cid === 'com-1' ? estado(comPermissao) : null),
    selfKeyHex: () => EU,
    currentSessionId: () => sessao,
    host: {} as never,
    share: {} as never,
    fila: {
      entrar: () => ({ ok: true as const }),
      sair: () => undefined,
      moderar: () => ({ ok: true as const }),
      estadoDe: () => ({ aberta: true, itens: [], turno: null }),
    },    captureTokenTtlMs: 60_000,
    // O teste não passa pelo voiceJoin: a comunidade em chamada vem injetada.
    communityInCall: () => (sessao === null ? null : 'com-1'),
  });
  return { d, setSessao: (s) => (sessao = s) };
}

describe('music.start — o gate é LOCAL (§17.5 emenda de 2026-08-28)', () => {
  it('sem sessão de voz é E_SESSION_GONE — música não existe fora da chamada', async () => {
    const { d } = dispatcherLocal(true);
    const r = await d.musicStart();
    assert.deepEqual(r, { ok: false, code: 'E_SESSION_GONE' });
  });

  it('sem voice_share_screen é E_PERMISSION_DENIED — decidido aqui, sem host', async () => {
    const { d, setSessao } = dispatcherLocal(false);
    setSessao('s-1');
    const r = await d.musicStart();
    assert.deepEqual(r, { ok: false, code: 'E_PERMISSION_DENIED' });
  });

  it('com sessão e permissão cunha token; o authorize de música resolve contra a SESSÃO DE VOZ', async () => {
    const { d, setSessao } = dispatcherLocal(true);
    setSessao('s-1');
    const r = await d.musicStart();
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.sessionId, 's-1');
    assert.ok(r.captureToken.token.length > 0);
    const decisao = d.authorizeCapture({ sessionId: 's-1', kind: 'music' });
    assert.deepEqual(decisao, { allowed: true, audio: true });
  });

  it('o token de música morre com a sessão de voz que o gerou', async () => {
    const { d, setSessao } = dispatcherLocal(true);
    setSessao('s-1');
    const r = await d.musicStart();
    assert.ok(r.ok);
    // A chamada acabou: currentSessionId() volta null, e o main é recusado na hora —
    // sem limpeza manual, porque a vida do token É a vida da sessão.
    setSessao(null);
    assert.deepEqual(d.authorizeCapture({ sessionId: 's-1', kind: 'music' }), { allowed: false, reason: 'mismatch', audio: false });
  });

  it('o caminho de TELA (§17.5) continua resolvendo pelo sessionId de share, não pelo de música', async () => {
    const { d, setSessao } = dispatcherLocal(true);
    setSessao('s-1');
    await d.musicStart();
    // Sem share.captureToken: o authorize de tela recusa mesmo com música ativa — os dois
    // tokens vivem em portas separadas.
    assert.deepEqual(d.authorizeCapture({ sessionId: 's-1' }), { allowed: false, reason: 'mismatch', audio: false });
  });
});

describe('music.start em modo membro — mesma decisão local, zero round-trip', () => {
  function dispatcherMembro(musicAllowed: () => boolean): MediaDispatcher {
    return remoteMediaDispatcher(
      {
        call: async () => ({
          ok: true,
          body: new TextEncoder().encode(
            JSON.stringify({
              sessionId: 's-1',
              channelId: 'ch-voz',
              roster: [],
              iceServers: [],
              tickets: [],
              turnCredential: { username: 'u', password: 'p' },
            }),
          ),
        }),
      },
      {
        captureTokenTtlMs: 60_000,
        selfKeyHex: () => EU,
        musicAllowed,
      },
    );
  }

  it('antes do voiceJoin não há sessão: E_SESSION_GONE, sem RPC nenhum', async () => {
    const d = dispatcherMembro(() => true);
    assert.deepEqual(await d.musicStart(), { ok: false, code: 'E_SESSION_GONE' });
  });

  it('o gate injetado lê a réplica local; negado é E_PERMISSION_DENIED sem ida ao host', async () => {
    const d = dispatcherMembro(() => false);
    const joined = await d.voiceJoin({ communityId: 'com-1', channelId: 'ch-voz' });
    assert.ok(joined.ok);
    assert.deepEqual(await d.musicStart(), { ok: false, code: 'E_PERMISSION_DENIED' });
  });

  it('permissão local satisfeita cunha o token e o authorize de música o aceita', async () => {
    const d = dispatcherMembro(() => true);
    const joined = await d.voiceJoin({ communityId: 'com-1', channelId: 'ch-voz' });
    assert.ok(joined.ok);
    const r = await d.musicStart();
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.sessionId, 's-1');
    assert.deepEqual(d.authorizeCapture({ sessionId: 's-1', kind: 'music' }), { allowed: true, audio: true });
  });
});

// §17.5 (emenda de 2026-09-03) — B39: o som da tela.
describe('capture.authorize{audio} — quem concede o som é o núcleo', () => {
  /** O mesmo dispatcher de membro acima, com o gate de permissão controlável. */
  function membro(permitido: boolean): MediaDispatcher {
    return remoteMediaDispatcher(
      {
        call: async () => ({
          ok: true,
          body: new TextEncoder().encode(
            JSON.stringify({
              sessionId: 's-1',
              channelId: 'ch-voz',
              roster: [],
              iceServers: [],
              tickets: [],
              turnCredential: { username: 'u', password: 'p' },
            }),
          ),
        }),
      },
      { captureTokenTtlMs: 60_000, selfKeyHex: () => EU, musicAllowed: () => permitido },
    );
  }

  async function comTelaDePe(permitido: boolean): Promise<{ d: MediaDispatcher; sessionId: string }> {
    const d = membro(permitido);
    const joined = await d.voiceJoin({ communityId: 'com-1', channelId: 'ch-voz' });
    assert.ok(joined.ok);
    const s = await d.shareStart({ communityId: 'com-1', channelId: 'ch-voz' });
    assert.ok(s.ok);
    if (!s.ok) throw new Error('share.start falhou');
    return { d, sessionId: s.sessionId };
  }

  it('não pedir som é não receber som — o opt-in é do pedido, não do núcleo', async () => {
    const { d, sessionId } = await comTelaDePe(true);
    assert.deepEqual(d.authorizeCapture({ sessionId }), { allowed: true, audio: false });
  });

  it('pedir som com a permissão da TELA basta: nenhum cargo novo', async () => {
    const { d, sessionId } = await comTelaDePe(true);
    assert.deepEqual(d.authorizeCapture({ sessionId, audio: true }), { allowed: true, audio: true });
  });

  it('som negado NÃO derruba a imagem: a captura sobe muda', async () => {
    /*
     * A separação é o ponto. §17.5 declara que a falha do som é subir muda — o mesmo
     * desfecho de uma plataforma sem áudio separável por janela. Recusar a captura inteira
     * puniria a imagem, que estava autorizada, e é o que aconteceria se `audio` fosse lido
     * como parte de `allowed`.
     */
    const { d, sessionId } = await comTelaDePe(false);
    assert.deepEqual(d.authorizeCapture({ sessionId, audio: true }), { allowed: true, audio: false });
  });

  it('sessão que não existe não concede nem imagem nem som', async () => {
    const { d } = await comTelaDePe(true);
    assert.deepEqual(d.authorizeCapture({ sessionId: 'outra', audio: true }), {
      allowed: false,
      reason: 'mismatch',
      audio: false,
    });
  });
});
