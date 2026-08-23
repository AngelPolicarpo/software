// Ponte de submissão assinada de ops (§29.2 item 1, §19.3) — o caminho de produto
// "intenção → op codificada → assinatura → envelope → outbox/RPC".
//
// Dois caminhos de §11.1, sobre o mesmo construtor:
//   A  (enfileirável): reserva `authorSeq`, sela o envelope, enfileira na outbox e devolve
//      `{opId, state:'queued'}` na hora; o desfecho chega por evento (§19.3 passos 3–8).
//   ⏱ (síncrono): sela e submete direto pela porta do host (`submitOp`, §16.2), devolvendo
//      `{seq}` ou `{code}`. Recusa antes do append queima o número (§7.5) — é a regra.
//
// §4: `communityClient` depende de `swarm`, `corestore`, `projector` e `outbox`. O codec
// canônico (`opCodec`), os ids determinísticos (`idgen`) e o material de assinatura
// (par Ed25519 da identidade) NÃO são dependências declaradas — chegam injetados pelas
// portas abaixo (padrão relay: seed/chave por parâmetro; constantes por injeção).
// A validação advisória local (§8.7 ponto 1) lê um recorte estrutural do `DecisionState`
// pelo `projector` e produz só os erros síncronos da coluna de §15.4. Ela não duplica o
// pipeline do `fold`: o que o `fold` decide continua sendo decidido por ele — na admissão
// do host (vínculo) e em toda réplica (norma). Divergir daqui é esperado e inofensivo.

import type { Outbox } from '../outbox/index.ts';

/** Escopo de monotonicidade de `authorSeq` (§7.1) — forma estrutural de `opCodec.SequenceScope`. */
export type OpScope = { readonly kind: 'community' } | { readonly kind: 'channel'; readonly channelId: string };

/** Chave estável do escopo no manifesto e no `fold` (`sequenceScopeKey`). */
export function opScopeKey(scope: OpScope): string {
  return scope.kind === 'community' ? 'community' : `channel:${scope.channelId}`;
}

/** Par Ed25519 do autor local — material de identidade injetado, nunca derivado aqui (§5.5). */
export interface SigningKeyPair {
  readonly publicKey: Buffer;
  readonly secretKey: Buffer;
}

/**
 * Porta do codec assinado — implementada pela composição sobre `opCodec` + `idgen` + sodium.
 * É o construtor compartilhado de §7.1/§7.3: `Op` → encode canônico → digest de domínio
 * `'op/1'` → Ed25519 detached → `Envelope` → `opId = BLAKE2b('opid/1' ‖ envelope)`.
 * Nenhum método lança: entrada que não casa o layout vira `null`.
 */
export interface SignedOpCodecPort {
  /** Número fechado do catálogo de §7.4 para o nome do `kind`; `null` se fora do catálogo. */
  kindNumber(kindName: string): number | null;
  /** Encode canônico do payload pela linha de §7.4; `null` quando não casa o layout. */
  encodePayload(kindName: string, payload: Readonly<Record<string, unknown>>): Buffer | null;
  /** Sela a op: envelope assinado com `secretKey` e `opId` determinístico. */
  sealOp(input: {
    readonly opVersion: number;
    readonly communityId: Buffer;
    readonly kindNumber: number;
    readonly author: Buffer;
    readonly secretKey: Buffer;
    readonly sequenceScope: OpScope;
    readonly authorSeq: number;
    readonly ts: number;
    readonly payload: Buffer;
  }): { readonly envelope: Buffer; readonly opId: string };
}

/**
 * Porta de submissão síncrona ao host — o `submitOp` de §16.2 sobre o `rpcClient` existente.
 * `null` significa transporte indisponível (queda/timeout/orçamento) e vira
 * `E_HOST_UNAVAILABLE` aqui, o mesmo código que o transporte usa.
 */
export type HostSubmitPort = (
  envelope: Buffer,
) => Promise<{ readonly ok: true; readonly seq: number } | { readonly ok: false; readonly code: string } | null>;

/**
 * Recorte estrutural do `DecisionState` (§8.1) que a ponte lê — o DS real satisfaz-na por
 * estrutura, como `VoiceStatePort`. Só isto é lido; nada aqui decide semântica.
 */
export interface WriteStatePort {
  readonly community: {
    readonly exists: boolean;
    /** Host corrente — a fronteira lê daqui para recusar a saída do host (§11.1). */
    readonly hostKey: Buffer;
    readonly endedAt?: number;
  };
  readonly channels: ReadonlyMap<
    string,
    { readonly type: number; readonly deletedAt?: number; readonly readOnlyForRoleIds?: ReadonlySet<string> }
  >;
  readonly members: ReadonlyMap<
    string,
    {
      readonly state: 'active' | 'left' | 'banned';
      readonly timeoutUntil?: number;
      readonly roleIds: Iterable<string>;
      /** Janela de cota R-14/R-15 — mesma forma de `fold.RingCounter`; ambos os orçamentos compartilham a janela. */
      readonly opBudget?: {
        readonly entries: readonly { readonly seq: number; readonly bytes: number }[];
        readonly ops: number;
        readonly bytes: number;
      };
    }
  >;
  readonly roles: ReadonlyMap<string, { readonly permissions: Iterable<number>; readonly deletedAt?: number }>;
  readonly messages: ReadonlyMap<
    string,
    {
      readonly channelId: string;
      /** Autor do registro — a coluna "própria" de §15.4 lê daqui. */
      readonly authorKey: string;
      readonly deletedAt?: number;
      /** Presente quando esta mensagem **é a raiz** de uma thread (R-24 lê daqui). */
      readonly threadId?: string;
      /** R-23 — emojis distintos já presentes. */
      readonly reactionEmojis?: ReadonlySet<string>;
    }
  >;
  readonly interpretedSeq: number;
}

/** Tetos de §8.6 e de R-14/R-15 usados pela validação advisória — constantes injetadas. */
export interface SubmissionLimits {
  /** `Message.content` — code points e bytes UTF-8 após `trim` no fim (§8.6). */
  readonly contentMaxCodePoints: number;
  readonly contentMaxBytes: number;
  /** `Message.mentions` — itens (§8.6). */
  readonly mentionsMaxItems: number;
  /** Cota R-14/R-15: janela sobre `seq` e os dois tetos. */
  readonly quotaWindowSeqs: number;
  readonly quotaOpsPerWindow: number;
  readonly quotaBytesPerWindow: number;
  /** R-23 — emojis distintos por mensagem. */
  readonly reactionMaxEmojis: number;
}

/** Violação advisória — códigos somente do catálogo de §20.2 (o núcleo nunca formata texto). */
export interface AdvisoryViolation {
  readonly code: string;
  readonly field?: string;
}

export type SubmissionInput = {
  readonly kindName: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly clientRef?: string;
};

export type QueuedSubmissionResult =
  | { readonly ok: true; readonly opId: string; readonly state: 'queued' }
  | { readonly ok: false; readonly code: string; readonly field?: string };

export type SyncSubmissionResult =
  /**
   * `authorSeq` sai junto porque §7.3 deriva o id de toda entidade criada de
   * `communityId ‖ sequenceScope ‖ authorKey ‖ authorSeq`: sem ele, quem chamou não sabe
   * nomear o canal/categoria que acabou de criar sem esperar a projeção.
   */
  | { readonly ok: true; readonly seq: number; readonly authorSeq: number; readonly opId: string }
  | { readonly ok: false; readonly code: string; readonly field?: string };

/** Kinds do domínio de mensagem enfileiráveis (§11.1) — fechado; entra injetado. */
export const MESSAGE_QUEUEABLE_KINDS: ReadonlySet<string> = new Set([
  'message.send',
  'message.edit',
  'message.delete',
  'message.pin',
  'reaction.set',
  'thread.create',
]);

/**
 * Exceção única e declarada de §11.1 — a única op de **não-mensagem** que enfileira:
 * a saída é local imediata, mas o registro chega aos demais pelo log (L-22).
 */
export const MEMBER_LEAVE_KIND = 'member.leave';

const OP_FIXED_BYTES = 256; // teto do quadro fixo da Op+Envelope (chaves, sig, escopo, framing)

function codePointCount(s: string): number {
  return [...s].length;
}

/**
 * Validação advisória de §8.7 ponto 1 — os erros síncronos da coluna de §15.4. Roda ANTES de
 * consumir `authorSeq` (§19.3 passo 1): nada enfileirado quando recusa.
 *
 * Não é o `fold`: confere apenas o que a ponte mesma possui (tetos injetados, recorte do DS)
 * e pode divergir do host — o host revalida tudo contra a cabeça do log dentro de §11.4.
 */
export function advisoryCheck(input: {
  readonly state: WriteStatePort;
  readonly authorKeyHex: string;
  readonly kindName: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly scope: OpScope;
  readonly limits: SubmissionLimits;
  readonly candidateBytes: number;
}): AdvisoryViolation | null {
  const { state, authorKeyHex, payload, scope, limits } = input;

  // E_VALIDATION — tetos de campo presentes na fronteira (§8.6). Campos que a ponte conhece.
  if (payload['content'] !== undefined) {
    const raw = payload['content'];
    if (typeof raw !== 'string') return { code: 'E_VALIDATION', field: 'content' };
    const trimmed = raw.replace(/\s+$/u, '');
    if (trimmed.length === 0 || codePointCount(trimmed) > limits.contentMaxCodePoints) {
      return { code: 'E_VALIDATION', field: 'content' };
    }
    if (Buffer.byteLength(trimmed, 'utf8') > limits.contentMaxBytes) {
      return { code: 'E_VALIDATION', field: 'content' };
    }
  }
  if (payload['mentions'] !== undefined) {
    const mentions = payload['mentions'];
    if (!Array.isArray(mentions) || mentions.some((m) => typeof m !== 'string')) {
      return { code: 'E_VALIDATION', field: 'mentions' };
    }
    if (mentions.length > limits.mentionsMaxItems) return { code: 'E_VALIDATION', field: 'mentions' };
  }

  // Alvo nomeado dos kinds que editam/alvejam um registro existente (§7.1): os códigos
  // síncronos da coluna de §15.4 lidos do recorte. `message.delete` de mensagem já
  // deletada é APPLIED idempotente no fold, então não é bloqueada aqui.
  const targetId =
    typeof payload['messageId'] === 'string'
      ? payload['messageId']
      : typeof payload['rootMessageId'] === 'string'
        ? payload['rootMessageId']
        : undefined;
  if (targetId !== undefined) {
    const target = state.messages.get(targetId);
    if (target !== undefined) {
      if (target.deletedAt !== undefined && input.kindName !== 'message.delete') {
        return { code: 'E_MESSAGE_DELETED' };
      }
      if (input.kindName === 'message.edit' && target.authorKey !== authorKeyHex) {
        return { code: 'E_CANNOT_EDIT_OTHERS' };
      }
      // R-23 — só a reação que ACRÉSCIMA um emoji novo pode estourar o teto; reafirmar
      // o mesmo emoji não conta duas vezes.
      if (
        input.kindName === 'reaction.set' &&
        payload['present'] === true &&
        typeof payload['emoji'] === 'string' &&
        !target.reactionEmojis?.has(payload['emoji']) &&
        (target.reactionEmojis?.size ?? 0) >= limits.reactionMaxEmojis
      ) {
        return { code: 'E_REACTION_LIMIT' };
      }
      // R-24 — uma thread por mensagem raiz; a raiz carrega o `threadId` da sua thread.
      if (input.kindName === 'thread.create' && target.threadId !== undefined) {
        return { code: 'E_THREAD_EXISTS' };
      }
    }
  }

  // E_CHANNEL_READ_ONLY — R-22 sobre o recorte: o autor perde a escrita no canal quando
  // TODOS os seus cargos ativos estão em `readOnlyForRoleIds`.
  if (scope.kind === 'channel') {
    const channel = state.channels.get(scope.channelId);
    const ro = channel?.readOnlyForRoleIds;
    if (channel !== undefined && channel.deletedAt === undefined && ro !== undefined && ro.size > 0) {
      const member = state.members.get(authorKeyHex);
      if (member !== undefined && member.state === 'active') {
        let anyOutside = false;
        for (const roleId of member.roleIds) {
          const role = state.roles.get(roleId);
          if (role === undefined || role.deletedAt !== undefined) continue;
          if (!ro.has(roleId)) {
            anyOutside = true;
            break;
          }
        }
        if (!anyOutside) return { code: 'E_CHANNEL_READ_ONLY' };
      }
    }
  }

  // E_QUOTA_EXCEEDED — R-14/R-15: uma janela sobre `seq` com dois tetos (ops e bytes).
  // O registro corrente conta na própria verificação; bytes estimados pelo tamanho do payload.
  const member = state.members.get(authorKeyHex);
  const ring = member?.opBudget;
  if (ring !== undefined && member?.state === 'active') {
    const head = state.interpretedSeq + 1;
    const floor = head - limits.quotaWindowSeqs;
    let ops = 0;
    let bytes = 0;
    for (let i = ring.entries.length - 1; i >= 0; i--) {
      const entry = ring.entries[i];
      if (entry === undefined || entry.seq <= floor) break;
      ops += 1;
      bytes += entry.bytes;
    }
    if (ops + 1 > limits.quotaOpsPerWindow) return { code: 'E_QUOTA_EXCEEDED' };
    if (bytes + input.candidateBytes > limits.quotaBytesPerWindow) return { code: 'E_QUOTA_EXCEEDED' };
  }

  return null;
}

/**
 * Escopo por `kind` (§7.1): ops com canal próprio usam `channel(channelId)`; as demais do
 * domínio de mensagem derivam o canal do alvo (`messageId`/`rootMessageId`) no DS — mesmas
 * decisões do cabo de teste, agora no caminho de produto; tudo o resto usa `community`.
 * Alvo nomeado e não resolúvel no DS → `null` (nada é assinado nem consumido).
 */
/**
 * §7.5 — o escopo assinado da op. Quem manda é o **kind**, não a forma do payload: só os
 * seis kinds de mensagem são escopados por canal (`CHANNEL_SCOPED_KINDS`, do `fold`). Um
 * `channel.update`/`channel.move`/`channel.delete` também carrega `channelId` e é
 * **community**: escolher pelo campo fazia o `fold` recusar com `E_VALIDATION{sequenceScope}`
 * toda op de estrutura sobre canal — depois de assinada, no host.
 */
/**
 * §7.5 — os `kind`s escopados por **canal**. É a mesma lista que o `fold` verifica no estágio
 * 6 (`CHANNEL_SCOPED_KINDS`), repetida aqui porque §4 não dá `fold` a `communityClient`; a
 * igualdade entre as duas é asserida por teste, para que não possam divergir em silêncio.
 */
export const CHANNEL_SCOPED: ReadonlySet<string> = new Set(['message.send', 'message.edit', 'message.delete', 'message.pin', 'reaction.set', 'thread.create']);

export function resolveScope(
  kindName: string,
  payload: Readonly<Record<string, unknown>>,
  state: WriteStatePort | null,
): OpScope | null {
  if (!CHANNEL_SCOPED.has(kindName)) return { kind: 'community' };
  const channelId = payload['channelId'];
  if (typeof channelId === 'string' && channelId.length > 0) return { kind: 'channel', channelId };

  const targetId =
    typeof payload['messageId'] === 'string'
      ? payload['messageId']
      : typeof payload['rootMessageId'] === 'string'
        ? payload['rootMessageId']
        : undefined;
  if (targetId !== undefined) {
    const message = state?.messages.get(targetId);
    // Alvo que não existe no DS é escopo não resolúvel (§7.1). Alvo TOMBADO ainda
    // resolve para o canal dele: quem nomeia o desfecho é a advisória, com
    // E_MESSAGE_DELETED — exceto `message.delete`, que o fold aplica idempotente.
    if (message === undefined) return null;
    return { kind: 'channel', channelId: message.channelId };
  }
  return { kind: 'community' };
}

/** Entrada da ponte por comunidade — o que a composição liga ao abrir a comunidade para escrita. */
export interface SubmissionBinding {
  /** Dono dos contadores de `authorSeq` e da fila durável (§11.2). */
  readonly outbox: Outbox;
}

/** Estado interno compartilhado pelos dois caminhos; devolve erro nomeado ou o envelope pronto. */
export function prepareSubmission(args: {
  readonly binding: SubmissionBinding;
  readonly signing: {
    readonly authorKey: SigningKeyPair;
    readonly codec: SignedOpCodecPort;
    readonly opVersion: number;
    readonly limits: SubmissionLimits;
  };
  readonly communityKey: Buffer;
  readonly state: WriteStatePort;
  readonly now: () => number;
  readonly queueableKinds: ReadonlySet<string>;
  readonly input: SubmissionInput;
  readonly sync: boolean;
}):
  | {
      readonly ok: true;
      readonly envelope: Buffer;
      readonly opId: string;
      readonly kindNumber: number;
      readonly scopeKey: string;
      readonly channelId: string | null;
      readonly authorSeq: number;
    }
  | { readonly ok: false; readonly code: string; readonly field?: string } {
  const { binding, signing, communityKey, state, now, queueableKinds, input, sync } = args;
  const { authorKey, codec, opVersion, limits } = signing;
  const authorKeyHex = authorKey.publicKey.toString('hex');

  // Catálogo fechado de §7.4 — `kind` fora dele é recusa na escrita (§7.2 DR-10).
  const kindNumber = codec.kindNumber(input.kindName);
  if (kindNumber === null) return { ok: false, code: 'E_UNKNOWN_KIND' };

  // Caminho certo para o domínio certo (§11.1): mensagem enfileira; estrutura/moderação/
  // comunidade/convite é síncrona. `member.leave` (exceção) não passa daqui nesta fase.
  if (sync === queueableKinds.has(input.kindName)) {
    return { ok: false, code: 'E_VALIDATION', field: 'kind' };
  }

  // Encode primeiro: sem payload canônico não há o que assinar, e o tamanho alimenta a cota.
  const encodedPayload = codec.encodePayload(input.kindName, input.payload);
  if (encodedPayload === null) return { ok: false, code: 'E_VALIDATION', field: 'payload' };

  const scope = resolveScope(input.kindName, input.payload, state);
  if (scope === null) return { ok: false, code: 'E_VALIDATION', field: 'sequenceScope' };

  const violation = advisoryCheck({
    state,
    authorKeyHex,
    kindName: input.kindName,
    payload: input.payload,
    scope,
    limits,
    candidateBytes: encodedPayload.length + OP_FIXED_BYTES,
  });
  if (violation !== null) return { ok: false, ...violation };

  // §19.3 passo 2 — consome `authorSeq` ANTES de montar/assinar a Op.
  const authorSeq = binding.outbox.nextAuthorSeq(opScopeKey(scope));
  const sealed = codec.sealOp({
    opVersion,
    communityId: communityKey,
    kindNumber,
    author: authorKey.publicKey,
    secretKey: authorKey.secretKey,
    sequenceScope: scope,
    authorSeq,
    ts: now(),
    payload: encodedPayload,
  });
  return {
    ok: true,
    envelope: sealed.envelope,
    opId: sealed.opId,
    kindNumber,
    scopeKey: opScopeKey(scope),
    channelId: scope.kind === 'channel' ? scope.channelId : null,
    authorSeq,
  };
}
