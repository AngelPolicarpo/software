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
import { memberHasPermission } from '../../l2/voiceCoordinator/host.ts';
import type {
  SubmissionInput,
  QueuedSubmissionResult,
  WriteStatePort,
} from '../../l2/communityClient/index.ts';
import type { SearchPartialReason, SearchService } from '../../l2/search/index.ts';
import type { SuccessionService } from '../../l2/succession/index.ts';
import { isShareQuality } from '../../l2/shareStar/index.ts';
import type { MediaDispatcher } from './media.ts';
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
 * Superfície de voz/tela desta instalação. A forma da fronteira é uma só; quem troca é o
 * dispatcher: `localMediaDispatcher` quando esta instalação hospeda (§17.4/§17.5 decididos
 * aqui) e `remoteMediaDispatcher` quando não hospeda (os mesmos comandos, por §16.2).
 */
export interface MediaSurfaceDeps {
  dispatcher: MediaDispatcher;
}

/**
 * Superfície de mensagens (§15.4 "Mensagens" — todas **A**, §11.1). A decisão de domínio é
 * da ponte de submissão em `communityClient`; aqui só a forma da fronteira, a coluna Perm.
 * lida sobre o recorte do DS (permissões nomeadas; "própria \| manage_messages" no delete)
 * e o mapeamento do resultado. O desfecho real chega pelos eventos de §15.5, emitidos pela
 * outbox e ligados ao fan-out pelo boot.
 */
export interface MessageSurfaceDeps {
  /** Recorte estrutural do DS corrente — null quando a comunidade não está aberta aqui. */
  writeStateFor(communityId: string): WriteStatePort | null;
  /** Chave pública hex da identidade local — null sem identidade carregada. */
  selfKeyHex(): string | null;
  /** Caminho A da ponte: sela, enfileira na outbox e responde `{opId, state}` na hora. */
  submitQueued(communityId: string, input: SubmissionInput): QueuedSubmissionResult;
  /** `message.retry{opId}` — reenfileira o MESMO envelope (§11.3, fecha DS-16). */
  retryQueued(opId: string):
    | { readonly ok: true; readonly state: 'queued' }
    | { readonly ok: false; readonly code: string };
  /** `message.cancelQueued{opId}` — descarte com motivo nomeado (§11.7). */
  cancelQueued(opId: string): { readonly ok: true } | { readonly ok: false; readonly code: string };
}

export type CoreCommandDeps = {
  diagnostics: Diagnostics;
  search: SearchService;
  /** Causa `partial` de RT-11 (§14.5) decidida fora — undefined = réplica íntegra. */
  partialReason?: () => SearchPartialReason | undefined;
  relay?: RelayVolunteer;
  relayConsent?: RelayConsentPort;
  media?: MediaSurfaceDeps;
  messages?: MessageSurfaceDeps;
  /**
   * Ciclo de vida da comunidade local (§15.4 "Comunidade"). A saída é a exceção de §11.1:
   * efeito local imediato — `left_at`, saída do swarm, descarte da fila com motivo
   * nomeado — enquanto o kind `member.leave` enfileira para os demais (L-22). A
   * orquestração é da composição/boot; aqui só a fronteira.
   */
  community?: {
    leave(communityId: string):
      | { readonly ok: true; readonly opId: string; readonly droppedQueued: number }
      | { readonly ok: false; readonly code: string };
  };
  /**
   * `query.community` de §15.6, montada pela composição sobre o DS real, a replicação e a
   * sucessão (`pendingReentry`, U-18c). Campos sem fonte em código ainda ficam ausentes.
   * `null` é "nada local para esta comunidade" (§20.2).
   */
  communityQuery?: (communityId: string) => unknown;
  /**
   * Superfície de sucessão (§15.4 "Comunidade", §18.8). As decisões — R-17, camada b de
   * R-18, escrow, plano da continuação — são todas do serviço em L2; aqui só a forma da
   * fronteira e a classe de cada comando: `setSuccessors` é standard, `assumeHost` é
   * **main-confirmed** (§15.3), porque migra a comunidade inteira para um core novo.
   */
  succession?: SuccessionService;
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

  // ── Mensagens (§15.4 "Mensagens" — todas A por contrato, §11.1) ─────────────────────

  /**
   * Forma comum das seis superfícies enfileiráveis: recorte + identidade, a coluna Perm.
   * da tabela (permissão nomeada quando há), payload direto para a ponte e o resultado
   * `{opId, state}`. Erros síncronos restantes são da validação advisória da ponte (§8.7).
   */
  function enfileira(
    arg: Arg,
    kindName: SubmissionInput['kindName'],
    payload: Record<string, unknown>,
    perm?: Parameters<typeof memberHasPermission>[2],
  ): { opId: string; state: string } {
    const messages = deps.messages;
    if (messages === undefined) refuse('E_UNKNOWN_COMMAND');
    const communityId = str(arg, 'communityId');
    const state = messages.writeStateFor(communityId);
    if (state === null) refuse('E_NOT_FOUND');
    const selfKeyHex = messages.selfKeyHex();
    if (selfKeyHex === null) refuse('E_NO_IDENTITY');
    if (perm !== undefined && !memberHasPermission(state, selfKeyHex, perm)) refuse('E_PERMISSION_DENIED');
    const result = messages.submitQueued(communityId, {
      kindName,
      payload,
      ...(typeof arg['clientRef'] === 'string' ? { clientRef: arg['clientRef'] } : {}),
    });
    if (!result.ok) {
      throw Object.assign(new Error(result.code), {
        code: result.code,
        ...(result.field !== undefined ? { field: result.field } : {}),
      });
    }
    return { opId: result.opId, state: result.state };
  }

  server.register('message.send', 'standard', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    // Coluna Perm. de §15.4 — `send_messages` sobre o recorte do DS. O readOnly do canal
    // (R-22) é E_CHANNEL_READ_ONLY e é da ponte, não daqui.
    const payload: Record<string, unknown> = {
      channelId: str(arg, 'channelId'),
      content: str(arg, 'content'),
      mentions: Array.isArray(arg['mentions']) ? arg['mentions'].filter((m) => typeof m === 'string') : [],
    };
    if (arg['attachment'] !== undefined) payload['attachment'] = arg['attachment'];
    if (typeof arg['replyToId'] === 'string') payload['replyToId'] = arg['replyToId'];
    if (typeof arg['threadId'] === 'string') payload['threadId'] = arg['threadId'];
    return enfileira(arg, 'message.send', payload, 'send_messages');
  });

  server.register('message.edit', 'standard', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    return enfileira(arg, 'message.edit', { messageId: str(arg, 'messageId'), content: str(arg, 'content') });
  });

  server.register('message.delete', 'standard', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const communityId = str(arg, 'communityId');
    const messageId = str(arg, 'messageId');
    // Coluna Perm. "própria \| manage_messages": apagar o próprio registro é de todo
    // membro; o alheio exige a permissão nomeada. A hierarquia (E_HIERARCHY) é do fold.
    const state = deps.messages?.writeStateFor(communityId);
    const selfKeyHex = deps.messages?.selfKeyHex();
    if (state !== null && state !== undefined && selfKeyHex !== null && selfKeyHex !== undefined) {
      const msg = state.messages.get(messageId);
      if (msg === undefined || msg.authorKey !== selfKeyHex) {
        if (!memberHasPermission(state, selfKeyHex, 'manage_messages')) refuse('E_PERMISSION_DENIED');
      }
    }
    return enfileira(arg, 'message.delete', {
      messageId,
      ...(typeof arg['reason'] === 'string' ? { reason: arg['reason'] } : {}),
    });
  });

  server.register('message.pin', 'standard', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    if (typeof arg['pinned'] !== 'boolean') refuse('E_VALIDATION');
    return enfileira(
      arg,
      'message.pin',
      { messageId: str(arg, 'messageId'), pinned: arg['pinned'] as boolean },
      'pin_messages',
    );
  });

  server.register('message.react', 'standard', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    if (typeof arg['present'] !== 'boolean') refuse('E_VALIDATION');
    return enfileira(
      arg,
      'reaction.set',
      { messageId: str(arg, 'messageId'), emoji: str(arg, 'emoji'), present: arg['present'] as boolean },
      'add_reactions',
    );
  });

  server.register('thread.create', 'standard', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    return enfileira(arg, 'thread.create', { rootMessageId: str(arg, 'rootMessageId') }, 'send_messages');
  });

  server.register('message.retry', 'standard', (rawArg) => {
    const messages = deps.messages;
    if (messages === undefined) refuse('E_UNKNOWN_COMMAND');
    const opId = str((rawArg ?? {}) as Arg, 'opId');
    const r = messages.retryQueued(opId);
    if (!r.ok) refuse(r.code);
    return { state: r.state };
  });

  server.register('message.cancelQueued', 'standard', (rawArg) => {
    const messages = deps.messages;
    if (messages === undefined) refuse('E_UNKNOWN_COMMAND');
    const opId = str((rawArg ?? {}) as Arg, 'opId');
    const r = messages.cancelQueued(opId);
    if (!r.ok) refuse(r.code);
    return {};
  });

  // ── Ciclo de vida e consulta da comunidade (§15.4, §15.6) ───────────────────────────

  server.register('community.leave', 'standard', (rawArg) => {
    const community = deps.community;
    if (community === undefined) refuse('E_UNKNOWN_COMMAND');
    const r = community.leave(str((rawArg ?? {}) as Arg, 'communityId'));
    if (!r.ok) refuse(r.code);
    return { leftLocally: true, opId: r.opId, droppedQueued: r.droppedQueued };
  });

  server.register('query.community', 'standard', (rawArg) => {
    const communityQuery = deps.communityQuery;
    if (communityQuery === undefined) refuse('E_UNKNOWN_COMMAND');
    const view = communityQuery(str((rawArg ?? {}) as Arg, 'communityId'));
    if (view === null || view === undefined) refuse('E_NOT_FOUND');
    return view;
  });

  // ── Sucessão (§15.4 "Comunidade", §18.8) ─────────────────────────────────────────

  server.register('community.setSuccessors', 'standard', async (rawArg) => {
    const succession = deps.succession;
    if (succession === undefined) refuse('E_UNKNOWN_COMMAND');
    const arg = (rawArg ?? {}) as Arg;
    const communityId = str(arg, 'communityId');
    const raw = arg['successorKeys'];
    if (!Array.isArray(raw)) refuse('E_VALIDATION');
    const successorKeys: Buffer[] = [];
    for (const k of raw) {
      // A fronteira aceita hex do renderer (§15.2: JSON) e converte; forma errada é
      // `E_VALIDATION` aqui, antes de qualquer op.
      if (typeof k !== 'string' || !/^[0-9a-f]{64}$/i.test(k)) refuse('E_VALIDATION');
      successorKeys.push(Buffer.from(k, 'hex'));
    }
    const r = await succession.setSuccessors({ communityId, successorKeys });
    if (!r.ok) refuse(r.code);
    return { seq: r.seq };
  });

  server.register('community.assumeHost', 'main-confirmed', async (rawArg) => {
    const succession = deps.succession;
    if (succession === undefined) refuse('E_UNKNOWN_COMMAND');
    const communityId = str((rawArg ?? {}) as Arg, 'communityId');
    const r = await succession.assumeHost({ communityId });
    if (!r.ok) refuse(r.code);
    return { newCommunityId: r.newCommunityId, seq: r.seq };
  });

  // ── Voz (§15.4, §17.4) ───────────────────────────────────────────────────────────
  //
  // Nenhum destes handlers decide: a decisão é do host (§17.4/§17.5), tomada aqui quando
  // esta instalação hospeda e do outro lado de §16.2 quando não hospeda. O roteador só
  // valida a forma do argumento e traduz o `{code}` da recusa.

  function midia(): MediaDispatcher {
    if (deps.media === undefined) refuse('E_UNKNOWN_COMMAND');
    return deps.media.dispatcher;
  }

  server.register('voice.join', 'standard', async (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    return okOrThrow(
      await midia().voiceJoin({ communityId: str(arg, 'communityId'), channelId: str(arg, 'channelId') }),
    );
  });

  server.register('voice.leave', 'standard', async () => {
    okOrThrow(await midia().voiceLeave());
    return {};
  });

  server.register('voice.setSelf', 'standard', async (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const patch: { muted?: boolean; deafened?: boolean; cameraOn?: boolean; speaking?: boolean } = {};
    for (const key of ['muted', 'deafened', 'cameraOn', 'speaking'] as const) {
      if (typeof arg[key] === 'boolean') patch[key] = arg[key] as boolean;
    }
    okOrThrow(await midia().voiceSetSelf(patch));
    return {};
  });

  server.register('voice.muteParticipant', 'standard', async (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    if (typeof arg['muted'] !== 'boolean') refuse('E_VALIDATION');
    okOrThrow(
      await midia().voiceMuteParticipant({
        communityId: str(arg, 'communityId'),
        identityKey: str(arg, 'identityKey'),
        muted: arg['muted'] as boolean,
      }),
    );
    return {};
  });

  // ── Tela (§15.4, §17.5) ──────────────────────────────────────────────────────────

  server.register('share.start', 'standard', async (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const quality = arg['quality'];
    const result = okOrThrow(
      await midia().shareStart({
        communityId: str(arg, 'communityId'),
        channelId: str(arg, 'channelId'),
        ...(isShareQuality(quality) ? { quality } : {}),
      }),
    );
    return {
      sessionId: result.sessionId,
      // §16.2 não declara o token na resposta do host; ausente, o campo não é inventado.
      ...(result.captureToken !== undefined ? { captureToken: result.captureToken } : {}),
    };
  });

  server.register('share.stop', 'standard', async (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    okOrThrow(await midia().shareStop({ sessionId: str(arg, 'sessionId') }));
    return {};
  });

  server.register('share.setQuality', 'standard', async (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const quality = arg['quality'];
    if (!isShareQuality(quality)) refuse('E_VALIDATION');
    const result = okOrThrow(await midia().shareSetQuality({ sessionId: str(arg, 'sessionId'), quality }));
    return { applied: result.applied };
  });

  server.register('share.join', 'standard', async (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const result = okOrThrow(await midia().shareJoin({ sessionId: str(arg, 'sessionId') }));
    return { ticketId: result.ticketId, presenterKey: result.presenterKey };
  });
}
