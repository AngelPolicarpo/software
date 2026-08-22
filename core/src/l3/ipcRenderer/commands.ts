// Registro dos comandos IPC-R das superfícies de diagnóstico, busca, relay e mídia
// (§15.3 classes, §15.4 tabela de comandos, §15.6 `query.search`).
//
// §4: `ipcRenderer` é o roteamento e a autorização de comando — nenhuma regra de domínio
// aqui: cada handler traduz a forma de §15.4 para uma chamada de L2 e devolve `{code}` do
// catálogo §20.2 quando o módulo recusa. O que este roteador NÃO faz é decidir nada.
//
// Modo host vs modo membro: as superfícies de voz/tela são decisões do host (§17.4/§17.5).
// Quando esta instalação hospeda, a composição injeta o dispatcher local (sobre
// `VoiceHostSessions`/`ShareHostSessions`); quando não hospeda, o dispatcher remoto (via
// `rpcClient`) entra pela mesma interface — a forma da fronteira não muda.

import type { Diagnostics } from '../../l2/diagnostics/index.ts';
import type { RelayConsentPort, RelayVolunteer } from '../../l2/relay/index.ts';
import type { SearchPartialReason, SearchService } from '../../l2/search/index.ts';
import type { ShareHostSessions } from '../../l2/shareStar/index.ts';
import type { VoiceHostSessions, VoiceStatePort } from '../../l2/voiceCoordinator/index.ts';
import type { IpcServer } from './index.ts';

/** Recusa nomeada → erro com `.code` que o IpcServer traduz na resposta (§20.1). */
function refuse(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function okOrThrow<T extends { readonly ok: boolean }>(result: T): Extract<T, { readonly ok: true }> {
  if (result.ok !== true) refuse((result as { code?: string }).code ?? 'E_INTERNAL');
  return result as Extract<T, { readonly ok: true }>;
}

/**
 * Superfície de voz/tela desta instalação. Em modo host é implementada sobre os módulos
 * host; em modo membro, sobre `rpcClient`. O estado estrutural (`VoiceStatePort`) e a
 * identidade local chegam da composição.
 */
export interface MediaSurfaceDeps {
  /** Estado estrutural corrente da comunidade — null quando ela não está aberta aqui. */
  voiceStateFor(communityId: string): VoiceStatePort | null;
  /** Chave pública hex da identidade local — null sem identidade carregada. */
  selfKeyHex(): string | null;
  /** Sessão corrente do renderer (LS) para `voice.leave`/`voice.setSelf` sem sessionId. */
  currentSessionId(): string | null;
  host: VoiceHostSessions;
  share: ShareHostSessions;
}

export type CoreCommandDeps = {
  diagnostics: Diagnostics;
  search: SearchService;
  /** Causa `partial` de RT-11 (§14.5) decidida fora — undefined = réplica íntegra. */
  partialReason?: () => SearchPartialReason | undefined;
  relay?: RelayVolunteer;
  relayConsent?: RelayConsentPort;
  media?: MediaSurfaceDeps;
};

type Arg = Record<string, unknown>;

function str(arg: Arg, key: string): string {
  const v = arg[key];
  if (typeof v !== 'string' || v.length === 0) refuse('E_VALIDATION');
  return v;
}

/**
 * Registra no `IpcServer` os comandos das superfícies integradas nesta fase:
 * diag.*, query.search, relay.* e voz/tela. As classes seguem §15.3 (`query.search` é
 * open; todo o resto aqui é standard).
 */
export function registerCoreCommands(server: IpcServer, deps: CoreCommandDeps): void {
  // ── Diagnóstico (§15.4 "Arquivos e diagnóstico") ─────────────────────────────────

  server.register('diag.run', 'standard', async () => await deps.diagnostics.run());

  server.register('diag.snapshot', 'standard', () => deps.diagnostics.snapshot());

  // ── Busca (§23, §15.6 query.search) ──────────────────────────────────────────────

  server.register('query.search', 'open', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const communityId = str(arg, 'communityId');
    const query = typeof arg['query'] === 'string' ? arg['query'] : '';
    const filtersRaw = (arg['filters'] ?? {}) as Arg;
    const authorKeyHex =
      typeof filtersRaw['authorKey'] === 'string'
        ? Buffer.from(filtersRaw['authorKey'] as string, 'hex')
        : undefined;
    const rawDate = filtersRaw['date'];
    const date =
      rawDate === 'today' || rawDate === '7d' || rawDate === '30d' ? (rawDate as 'today' | '7d' | '30d') : undefined;
    const kind =
      filtersRaw['kind'] === 'attachment' || filtersRaw['kind'] === 'pinned' || filtersRaw['kind'] === 'link'
        ? (filtersRaw['kind'] as 'attachment' | 'pinned' | 'link')
        : undefined;
    const filters = {
      ...(authorKeyHex !== undefined && authorKeyHex.length === 32 ? { authorKey: authorKeyHex } : {}),
      ...(typeof filtersRaw['channelId'] === 'string' ? { channelId: filtersRaw['channelId'] as string } : {}),
      ...(date !== undefined ? { date } : {}),
      ...(kind !== undefined ? { kind } : {}),
    };
    const partial = deps.partialReason?.();
    return deps.search.search({
      communityId,
      query,
      filters,
      ...(typeof arg['scopeChannelId'] === 'string' ? { scopeChannelId: arg['scopeChannelId'] as string } : {}),
      ...(typeof arg['limitPerGroup'] === 'number' ? { limitPerGroup: arg['limitPerGroup'] as number } : {}),
      ...(partial !== undefined ? { partialReason: partial } : {}),
    });
  });

  // ── Relay voluntário (§15.4 "Voz, tela e relay", §17.7) ──────────────────────────

  server.register('relay.enable', 'standard', (rawArg) => {
    if (deps.relay === undefined) refuse('E_UNKNOWN_COMMAND');
    const communityId = str((rawArg ?? {}) as Arg, 'communityId');
    const result = deps.relay.enable({ communityId });
    if (!result.ok) refuse(result.code);
    return { relayPublicKey: result.relayPublicKey, seq: result.seq, expiresAt: result.expiresAt };
  });

  server.register('relay.disable', 'standard', (rawArg) => {
    if (deps.relay === undefined) refuse('E_UNKNOWN_COMMAND');
    const communityId = str((rawArg ?? {}) as Arg, 'communityId');
    return deps.relay.disable({ communityId });
  });

  server.register('relay.respondConsent', 'standard', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    if (deps.relayConsent === undefined) refuse('E_UNKNOWN_COMMAND');
    if (typeof arg['accept'] !== 'boolean') refuse('E_VALIDATION');
    const communityId = str(arg, 'communityId');
    const remember = arg['remember'] !== false;
    deps.relayConsent.set(communityId, arg['accept'] ? 'accepted' : 'declined', { remember });
    if (!remember) deps.relayConsent.forget(communityId);
    return {};
  });

  // ── Voz (§15.4, §17.4) ───────────────────────────────────────────────────────────

  server.register('voice.join', 'standard', async (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const media = deps.media;
    if (media === undefined) refuse('E_UNKNOWN_COMMAND');
    const communityId = str(arg, 'communityId');
    const channelId = str(arg, 'channelId');
    const selfKeyHex = media.selfKeyHex() ?? refuse('E_NO_IDENTITY');
    const state = media.voiceStateFor(communityId) ?? refuse('E_HOST_UNAVAILABLE');
    return okOrThrow(media.host.join({ state, channelId, memberKeyHex: selfKeyHex }));
  });

  server.register('voice.leave', 'standard', () => {
    const media = deps.media;
    if (media === undefined) refuse('E_UNKNOWN_COMMAND');
    const sessionId = media.currentSessionId();
    const selfKeyHex = media.selfKeyHex();
    if (sessionId === null || selfKeyHex === null) return {}; // sem sessão ativa é no-op nomeado
    okOrThrow(media.host.leave({ sessionId, memberKeyHex: selfKeyHex }));
    return {};
  });

  server.register('voice.setSelf', 'standard', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const media = deps.media;
    if (media === undefined) refuse('E_UNKNOWN_COMMAND');
    const sessionId = media.currentSessionId();
    const selfKeyHex = media.selfKeyHex();
    if (sessionId === null || selfKeyHex === null) refuse('E_SESSION_GONE');
    const patch: { muted?: boolean; deafened?: boolean; cameraOn?: boolean; speaking?: boolean } = {};
    for (const key of ['muted', 'deafened', 'cameraOn', 'speaking'] as const) {
      if (typeof arg[key] === 'boolean') patch[key] = arg[key] as boolean;
    }
    okOrThrow(media.host.setSelf({ sessionId: sessionId!, memberKeyHex: selfKeyHex!, patch }));
    return {};
  });

  server.register('voice.muteParticipant', 'standard', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const media = deps.media;
    if (media === undefined) refuse('E_UNKNOWN_COMMAND');
    const communityId = str(arg, 'communityId');
    const identityKey = str(arg, 'identityKey');
    if (typeof arg['muted'] !== 'boolean') refuse('E_VALIDATION');
    const state = media.voiceStateFor(communityId) ?? refuse('E_HOST_UNAVAILABLE');
    const sessionId = media.currentSessionId();
    const selfKeyHex = media.selfKeyHex();
    if (sessionId === null || selfKeyHex === null) refuse('E_SESSION_GONE');
    okOrThrow(
      media.host.muteParticipant({
        state,
        sessionId,
        actorKeyHex: selfKeyHex,
        targetKeyHex: identityKey,
        muted: arg['muted'] as boolean,
      }),
    );
    return {};
  });

  // ── Tela (§15.4, §17.5) ──────────────────────────────────────────────────────────

  server.register('share.start', 'standard', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const media = deps.media;
    if (media === undefined) refuse('E_UNKNOWN_COMMAND');
    const communityId = str(arg, 'communityId');
    const channelId = str(arg, 'channelId');
    const selfKeyHex = media.selfKeyHex() ?? refuse('E_NO_IDENTITY');
    const state = media.voiceStateFor(communityId) ?? refuse('E_HOST_UNAVAILABLE');
    const quality = arg['quality'] === 'high' || arg['quality'] === 'balanced' || arg['quality'] === 'low' ? arg['quality'] : undefined;
    const result = okOrThrow(
      media.share.start({
        state,
        channelId,
        presenterKeyHex: selfKeyHex,
        ...(quality !== undefined ? { quality } : {}),
      }),
    );
    return { sessionId: result.sessionId, captureToken: result.captureToken };
  });

  server.register('share.stop', 'standard', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const media = deps.media;
    if (media === undefined) refuse('E_UNKNOWN_COMMAND');
    const selfKeyHex = media.selfKeyHex() ?? refuse('E_NO_IDENTITY');
    okOrThrow(media.share.stop({ sessionId: str(arg, 'sessionId'), memberKeyHex: selfKeyHex }));
    return {};
  });

  server.register('share.setQuality', 'standard', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const media = deps.media;
    if (media === undefined) refuse('E_UNKNOWN_COMMAND');
    const quality = arg['quality'];
    if (quality !== 'high' && quality !== 'balanced' && quality !== 'low') refuse('E_VALIDATION');
    const selfKeyHex = media.selfKeyHex() ?? refuse('E_NO_IDENTITY');
    const result = okOrThrow(
      media.share.setQuality({ sessionId: str(arg, 'sessionId'), memberKeyHex: selfKeyHex, quality }),
    );
    return { applied: result.applied };
  });

  server.register('share.join', 'standard', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const media = deps.media;
    if (media === undefined) refuse('E_UNKNOWN_COMMAND');
    const selfKeyHex = media.selfKeyHex() ?? refuse('E_NO_IDENTITY');
    const result = okOrThrow(media.share.join({ sessionId: str(arg, 'sessionId'), memberKeyHex: selfKeyHex }));
    return { ticketId: result.ticketId, presenterKey: result.presenterKeyHex };
  });
}
