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
import type { InvitePreview } from '../../l2/invites/index.ts';
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

/**
 * Referência a um blob no fio do IPC-R. `Buffer` não atravessa JSON (§15.1): as chaves e o
 * hash viajam em hex, e o `blobId` é o quádruplo de §7.2.1.
 */
export type BlobRefWire = {
  readonly blobsCoreKey: string;
  readonly blobId: { readonly byteOffset: number; readonly blockOffset: number; readonly blockLength: number; readonly byteLength: number };
};

/** O que `blob.stage` devolve (§15.4) e o que vira `attachment` na op (§7.4.1). */
export type StagedAttachment = BlobRefWire & {
  readonly name: string;
  readonly sizeBytes: number;
  readonly kind: number;
  readonly hash: string;
};

/**
 * Anexos e download (§15.4 "Arquivos e diagnóstico", §13).
 *
 * O caminho de arquivo **nunca** cruza o IPC-R (T-16/DR-37): o renderer pede um ticket, o
 * main abre o diálogo e o núcleo recebe o `staging.ticket` (§15.7). Da mesma forma, nada que
 * descreva o blob volta do renderer: `message.send` manda só o `ticketId`, e quem monta o
 * `attachment` é o núcleo, a partir do que ele mesmo escreveu (§13.7 regra 1).
 */
export interface AttachmentSurfaceDeps {
  /** `file.pickForAttachment` — o main abre o diálogo e devolve o ticket (§15.7). */
  pick(communityId: string): Promise<{ readonly ticketId: string; readonly name: string; readonly sizeBytes: number; readonly kind: number }>;
  /** `blob.stage{ticketId}` — lê, faz hash e escreve no core de blobs do próprio membro. */
  stage(ticketId: string): Promise<StagedAttachment>;
  /** §13.7 regra 1 — o que este núcleo staged para o ticket, ou `null`. */
  staged(ticketId: string): StagedAttachment | null;
  /** `blob.download` — dispara e devolve o estado corrente; o progresso vai por evento. */
  download(a: BlobRefWire & { readonly communityId: string }): { readonly state: string };
  cancel(a: BlobRefWire): void;
  /** Tipo do blob baixado — decide a classe de §15.3 (`archive` é main-confirmed). */
  kindOf(a: BlobRefWire): number | null;
  /** `blob.reveal` — só depois da allowlist de §13.6; quem age é o main (`shell.open`). */
  reveal(a: BlobRefWire & { readonly mode: 'open' | 'folder' }): { readonly ok: true } | { readonly ok: false; readonly code: string };
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
   * nomeado — enquanto o kind `member.leave` enfileira para os demais (L-22). A criação
   * (§19.1) é a orquestração de §5.3: semente → manifest FULL → gênese em um append.
   * A orquestração é da composição/boot; aqui só a fronteira.
   */
  community?: {
    leave(communityId: string):
      | { readonly ok: true; readonly opId: string; readonly droppedQueued: number }
      | { readonly ok: false; readonly code: string };
    create?(input: {
      readonly name: string;
      readonly iconEmoji?: string;
      readonly iconColor?: number;
      readonly description?: string;
    }): Promise<{ ok: true; communityId: string; defaultChannelId: string } | { ok: false; code: string; field?: string }>;
  };
  /**
   * Convites (§15.4 "Convites", §12). Emissão/revogação são ops ⏱ pela porta do host;
   * resolve/redeem falam o protocolo pré-membro `p2p-admission/1` (§16.1) com o host da
   * comunidade. O `code` só existe na resposta de quem cria — nunca no log nem em evento.
   */
  invites?: {
    create(args: {
      readonly communityId: string;
      readonly expiresInDays?: number;
      readonly maxUses?: number;
      readonly label?: string;
    }): Promise<
      | { ok: true; invitePublicKey: string; code: string; expiresAt?: number; maxUses?: number; seq: number }
      | { ok: false; code: string; field?: string }
    >;
    revoke(args: { readonly communityId: string; readonly invitePublicKey: string }): Promise<{ ok: true; seq: number } | { ok: false; code: string }>;
    resolve(args: { readonly codeOrLink: string }): Promise<{ ok: true; preview: InvitePreview } | { ok: false; code: string }>;
    redeem(args: {
      readonly codeOrLink: string;
      readonly displayName?: string;
      readonly avatarColor?: number;
    }): Promise<{ ok: true; communityId: string; defaultChannelId: string; seq: number } | { ok: false; code: string }>;
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
  /** §15.4 "Arquivos e diagnóstico" — anexos e download (§13). */
  attachments?: AttachmentSurfaceDeps;
  /**
   * `host.exitImpact` (§15.4, §18.7). O núcleo é quem sabe: comunidades hospedadas aqui,
   * quantos estão online, quantos em chamada e o que ainda não replicou. A composição junta
   * as fontes; `host.notifyBeforeExit` foi removido (U-06) e nada aqui avisa ninguém.
   */
  exitImpact?: () => Promise<readonly Record<string, unknown>[]> | readonly Record<string, unknown>[];
};

type Arg = Record<string, unknown>;

/** §13.6 — número do `kind` `archive`; a classe de §15.3 depende dele em `blob.reveal`. */
const BLOB_KIND_ARCHIVE = 4;

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
    const anexo = arg['attachment'];
    if (anexo !== undefined) {
      // §13.7 regra 1 — a barreira. O renderer manda o `ticketId` e **nada mais**: quem
      // descreve o blob é o núcleo, a partir do que ele mesmo escreveu. Um `attachment`
      // montado pelo renderer poderia apontar a mensagem para qualquer blob do mundo.
      const attachments = deps.attachments;
      if (attachments === undefined) refuse('E_UNKNOWN_COMMAND');
      const ticketId = str((anexo ?? {}) as Arg, 'ticketId');
      const staged = attachments.staged(ticketId);
      // "só é enfileirada depois que o `blob.stage` completou": sem o staging, recusa.
      if (staged === null) refuse('E_BLOB_NOT_STAGED');
      // Coluna Perm. de §7.4: `send_messages` **+ `attach_files`** quando há anexo.
      const state = deps.messages?.writeStateFor(str(arg, 'communityId'));
      const selfKeyHex = deps.messages?.selfKeyHex();
      if (state != null && selfKeyHex != null && !memberHasPermission(state, selfKeyHex, 'attach_files')) {
        refuse('E_PERMISSION_DENIED');
      }
      // O `blob` do fio é o BlobRef COMPLETO de §7.2.1 — chave e quádruplo. Sem a chave,
      // o encode da ponte nem aconteceria: quem sabe de que core o blob é é este núcleo.
      payload['attachment'] = {
        blob: {
          blobsCoreKey: Buffer.from(staged.blobsCoreKey, 'hex'),
          byteOffset: staged.blobId.byteOffset,
          blockOffset: staged.blobId.blockOffset,
          blockLength: staged.blobId.blockLength,
          byteLength: staged.blobId.byteLength,
        },
        name: staged.name,
        sizeBytes: staged.sizeBytes,
        kind: staged.kind,
        hash: Buffer.from(staged.hash, 'hex'),
      };
    }
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

  server.register('community.create', 'standard', async (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const create = deps.community?.create;
    if (create === undefined) refuse('E_UNKNOWN_COMMAND');
    // Forma de §15.4: `{name, iconEmoji?, iconColor, description?}`. A validação dos tetos
    // de §8.6 é da orquestração (composição); aqui só a forma do argumento.
    if (typeof arg['name'] !== 'string') refuse('E_VALIDATION');
    const iconEmoji = arg['iconEmoji'];
    if (iconEmoji !== undefined && typeof iconEmoji !== 'string') refuse('E_VALIDATION');
    const iconColor = arg['iconColor'];
    if (iconColor !== undefined && typeof iconColor !== 'number') refuse('E_VALIDATION');
    const description = arg['description'];
    if (description !== undefined && typeof description !== 'string') refuse('E_VALIDATION');
    const r = await create({
      name: arg['name'] as string,
      ...(typeof iconEmoji === 'string' ? { iconEmoji } : {}),
      ...(typeof iconColor === 'number' ? { iconColor } : {}),
      ...(typeof description === 'string' ? { description } : {}),
    });
    if (!r.ok) throw Object.assign(new Error(r.code), { code: r.code, ...(r.field !== undefined ? { field: r.field } : {}) });
    return { communityId: r.communityId, defaultChannelId: r.defaultChannelId };
  });

  // ── Convites (§15.4 "Convites", §12) ────────────────────────────────────────────────

  function convites(): NonNullable<CoreCommandDeps['invites']> {
    if (deps.invites === undefined) refuse('E_UNKNOWN_COMMAND');
    return deps.invites;
  }

  server.register('invite.create', 'standard', async (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const expiresInDays = arg['expiresInDays'];
    const maxUses = arg['maxUses'];
    const label = arg['label'];
    const r = await convites().create({
      communityId: str(arg, 'communityId'),
      ...(typeof expiresInDays === 'number' ? { expiresInDays } : {}),
      ...(typeof maxUses === 'number' ? { maxUses } : {}),
      ...(typeof label === 'string' ? { label } : {}),
    });
    if (!r.ok) throw Object.assign(new Error(r.code), { code: r.code, ...(r.field !== undefined ? { field: r.field } : {}) });
    return {
      invitePublicKey: r.invitePublicKey,
      code: r.code,
      seq: r.seq,
      ...(r.expiresAt !== undefined ? { expiresAt: r.expiresAt } : {}),
      ...(r.maxUses !== undefined ? { maxUses: r.maxUses } : {}),
    };
  });

  server.register('invite.revoke', 'standard', async (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const r = await convites().revoke({ communityId: str(arg, 'communityId'), invitePublicKey: str(arg, 'invitePublicKey') });
    if (!r.ok) refuse(r.code);
    return { seq: r.seq };
  });

  server.register('invite.resolve', 'open', async (rawArg) => {
    // Classe open (§15.3): a consulta não muda estado e o código é a própria capacidade.
    const arg = (rawArg ?? {}) as Arg;
    const r = await convites().resolve({ codeOrLink: str(arg, 'codeOrLink') });
    if (!r.ok) refuse(r.code);
    return r.preview;
  });

  server.register('invite.redeem', 'standard', async (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const displayName = arg['displayName'];
    const avatarColor = arg['avatarColor'];
    const r = await convites().redeem({
      codeOrLink: str(arg, 'codeOrLink'),
      ...(typeof displayName === 'string' ? { displayName } : {}),
      ...(typeof avatarColor === 'number' ? { avatarColor } : {}),
    });
    if (!r.ok) refuse(r.code);
    return { communityId: r.communityId, defaultChannelId: r.defaultChannelId, seq: r.seq };
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

  // ── Arquivos (§15.4 "Arquivos e diagnóstico", §13) ───────────────────────────────

  function anexos(): AttachmentSurfaceDeps {
    if (deps.attachments === undefined) refuse('E_UNKNOWN_COMMAND');
    return deps.attachments;
  }

  /** `{blobsCoreKey, blobId}` do fio — hex e o quádruplo de §7.2.1, validados aqui. */
  function blobRef(arg: Arg): BlobRefWire {
    const blobsCoreKey = str(arg, 'blobsCoreKey');
    if (!/^[0-9a-f]{64}$/i.test(blobsCoreKey)) refuse('E_VALIDATION');
    const raw = (arg['blobId'] ?? {}) as Record<string, unknown>;
    const campos = ['byteOffset', 'blockOffset', 'blockLength', 'byteLength'] as const;
    const blobId = {} as Record<(typeof campos)[number], number>;
    for (const campo of campos) {
      const v = raw[campo];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) refuse('E_VALIDATION');
      blobId[campo] = v;
    }
    return { blobsCoreKey, blobId };
  }

  server.register('file.pickForAttachment', 'standard', async (rawArg) => {
    // O diálogo é do main e o caminho nunca volta pelo IPC-R (§15.7, T-16): daqui sai só o
    // ticket, que é o que `blob.stage` consome.
    return await anexos().pick(str((rawArg ?? {}) as Arg, 'communityId'));
  });

  server.register('blob.stage', 'standard', async (rawArg) => {
    return await anexos().stage(str((rawArg ?? {}) as Arg, 'ticketId'));
  });

  server.register('blob.download', 'standard', (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    // §13.4 devolve `{state}` na hora; o progresso vai por `blob.progress` a cada 500 ms.
    return anexos().download({ ...blobRef(arg), communityId: str(arg, 'communityId') });
  });

  server.register('blob.cancel', 'standard', (rawArg) => {
    anexos().cancel(blobRef((rawArg ?? {}) as Arg));
    return {};
  });

  server.register('blob.reveal', 'standard', (rawArg, ctx) => {
    const arg = (rawArg ?? {}) as Arg;
    const mode = arg['mode'];
    if (mode !== 'open' && mode !== 'folder') refuse('E_VALIDATION');
    const ref = blobRef(arg);
    // §15.3 — a classe deste comando depende do dado: revelar um `archive` é
    // main-confirmed, o resto é standard. O tipo só se conhece olhando o blob.
    if (anexos().kindOf(ref) === BLOB_KIND_ARCHIVE) server.requireConfirmation('blob.reveal', ctx.authToken);
    const r = anexos().reveal({ ...ref, mode });
    if (!r.ok) refuse(r.code);
    return {};
  });

  server.register('host.exitImpact', 'standard', async () => {
    if (deps.exitImpact === undefined) refuse('E_UNKNOWN_COMMAND');
    // §18.7 / U-06: isto **informa**, não avisa ninguém e não bloqueia a saída.
    return await deps.exitImpact();
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

  server.register('voice.signal', 'standard', async (rawArg) => {
    const arg = (rawArg ?? {}) as Arg;
    const sdp = arg['sdp'];
    const ice = arg['ice'];
    // O núcleo não lê SDP: encaminha (§16.2 `voiceSignal`) e a mídia segue DTLS-SRTP ponta
    // a ponta (§17.2). O ticket é o que autoriza o par do outro lado (§17.4 passo 3).
    okOrThrow(
      await midia().voiceSignal({
        peerKey: str(arg, 'peerKey'),
        ticketId: str(arg, 'ticketId'),
        ...(typeof sdp === 'string' ? { sdp } : {}),
        ...(typeof ice === 'string' ? { ice } : {}),
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
    // §15.4 — `{sessionId, captureToken}`; o token é a capacidade local de §17.4 emendado.
    return { sessionId: result.sessionId, captureToken: result.captureToken };
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
