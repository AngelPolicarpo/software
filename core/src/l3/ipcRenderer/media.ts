// Superfície de voz e tela de §15.4, nos dois modos — L3, forma da fronteira (§4).
//
// As decisões de voz e tela são **do host** (§17.4/§17.5). Quando esta instalação hospeda a
// comunidade, elas são tomadas aqui, sobre `VoiceHostSessions`/`ShareHostSessions` e o
// `DecisionState` local. Quando não hospeda, a mesma pergunta viaja por RPC (§16.2) e quem
// decide é o host — a forma dos comandos de §15.4 não muda, e o roteador não sabe em qual
// modo está: é o `MediaDispatcher` que troca.
//
// O que **muda** entre os dois modos, e por isso mora aqui:
//
//   - **Quem sabe a sessão corrente.** Em modo host, o roster vivo é local e a sessão sai de
//     `currentSessionOf`. Em modo membro não há roster local: a sessão é o que o host
//     devolveu no `voiceJoin`, guardada client-side (o "estado de sessão de mídia (LS)" de
//     §29.2) e derrubada no `voiceLeave`, na queda do host e no `E_SESSION_GONE`.
//   - **A codificação de fio.** O corpo de §16.2 é JSON; os tickets de §17.4 carregam
//     `Buffer` (`peerA`, `peerB`, `sig`). O codec abaixo é a forma canônica dessa travessia —
//     o handler do host usa o mesmo, e nenhum dos dois lados inventa campo.
//
// **Lacunas de §16.2 registradas, não contornadas** (`docs/sequenciamento-pos-fase-0.md`
// §39): `voice.muteParticipant` e `share.setQuality` são comandos de §15.4 **sem método** na
// tabela de §16.2, que `rpcServer` trata como fechada. Em modo membro eles não têm por onde
// passar, e a recusa é `E_UNKNOWN_COMMAND` — a mesma que o roteador já dá para superfície
// não composta nesta instalação. Inventar método de RPC seria mudar superfície normativa.

import type { CaptureToken, ShareHostSessions, ShareQuality } from '../../l2/shareStar/index.ts';
import type { TurnCredential } from '../../l2/communityHost/stunTurn.ts';
import type {
  IceServer,
  MediaTicket,
  RosterEntry,
  SetSelfPatch,
  VoiceHostSessions,
  VoiceStatePort,
} from '../../l2/voiceCoordinator/index.ts';

export type MediaFail = { readonly ok: false; readonly code: string };
export type MediaAck = { readonly ok: true } | MediaFail;

export type VoiceJoinOk = {
  readonly ok: true;
  readonly sessionId: string;
  readonly channelId: string;
  readonly roster: readonly RosterEntry[];
  readonly iceServers: readonly IceServer[];
  readonly tickets: readonly MediaTicket[];
  readonly turnCredential: TurnCredential;
};

export type ShareStartOk = {
  readonly ok: true;
  readonly sessionId: string;
  /**
   * §15.4 declara `{sessionId, captureToken}`; §16.2 declara a resposta de `shareStart` como
   * `{sessionId}`, sem o token. Em modo membro o campo só existe se o host o mandar — o
   * cliente não o fabrica. Lacuna registrada em §39.
   */
  readonly captureToken?: CaptureToken;
};

export type ShareJoinOk = { readonly ok: true; readonly ticketId: string; readonly presenterKey: string };
export type SetQualityOkResult = { readonly ok: true; readonly applied: boolean };

/**
 * A superfície que o roteador de §15.4 consome. Assíncrona nos dois modos: em modo membro
 * cada chamada é um round-trip de §16.2, e a forma da fronteira não pode depender disso.
 */
export interface MediaDispatcher {
  readonly mode: 'host' | 'member';
  /** Sessão de voz corrente desta instalação — `null` fora de chamada. */
  currentSessionId(): string | null;
  voiceJoin(a: { communityId: string; channelId: string }): Promise<VoiceJoinOk | MediaFail>;
  voiceLeave(): Promise<MediaAck>;
  voiceSetSelf(patch: SetSelfPatch): Promise<MediaAck>;
  voiceMuteParticipant(a: { communityId: string; identityKey: string; muted: boolean }): Promise<MediaAck>;
  shareStart(a: { communityId: string; channelId: string; quality?: ShareQuality }): Promise<ShareStartOk | MediaFail>;
  shareStop(a: { sessionId: string }): Promise<MediaAck>;
  shareSetQuality(a: { sessionId: string; quality: ShareQuality }): Promise<SetQualityOkResult | MediaFail>;
  shareJoin(a: { sessionId: string }): Promise<ShareJoinOk | MediaFail>;
}

// ─── Modo host (§17.4/§17.5 decididos aqui) ───────────────────────────────────────────

export type LocalMediaDeps = {
  /** Recorte estrutural do DS corrente — `null` quando a comunidade não está aberta aqui. */
  voiceStateFor(communityId: string): VoiceStatePort | null;
  /** Chave pública hex da identidade local — `null` sem identidade carregada. */
  selfKeyHex(): string | null;
  /** Sessão corrente do membro no roster vivo ("voz é uma só", §15.4 `voice.leave`). */
  currentSessionId(): string | null;
  host: VoiceHostSessions;
  share: ShareHostSessions;
};

/** Dispatcher de quem hospeda: as decisões de §17.4/§17.5 são tomadas nesta máquina. */
export function localMediaDispatcher(deps: LocalMediaDeps): MediaDispatcher {
  const self = (): string | MediaFail => deps.selfKeyHex() ?? { ok: false, code: 'E_NO_IDENTITY' };
  const state = (communityId: string): VoiceStatePort | MediaFail =>
    deps.voiceStateFor(communityId) ?? { ok: false, code: 'E_HOST_UNAVAILABLE' };
  const failed = (v: unknown): v is MediaFail => typeof v === 'object' && v !== null && 'ok' in v;

  return {
    mode: 'host',
    currentSessionId: () => deps.currentSessionId(),

    async voiceJoin({ communityId, channelId }) {
      const key = self();
      if (failed(key)) return key;
      const st = state(communityId);
      if (failed(st)) return st;
      return deps.host.join({ state: st, channelId, memberKeyHex: key });
    },

    async voiceLeave() {
      const key = deps.selfKeyHex();
      const sessionId = deps.currentSessionId();
      // Sem sessão ativa é no-op nomeado (§15.4: `voice.leave` não tem argumento).
      if (key === null || sessionId === null) return { ok: true };
      return deps.host.leave({ sessionId, memberKeyHex: key });
    },

    async voiceSetSelf(patch) {
      const key = deps.selfKeyHex();
      const sessionId = deps.currentSessionId();
      if (key === null || sessionId === null) return { ok: false, code: 'E_SESSION_GONE' };
      return deps.host.setSelf({ sessionId, memberKeyHex: key, patch });
    },

    async voiceMuteParticipant({ communityId, identityKey, muted }) {
      const key = deps.selfKeyHex();
      const sessionId = deps.currentSessionId();
      const st = state(communityId);
      if (failed(st)) return st;
      if (key === null || sessionId === null) return { ok: false, code: 'E_SESSION_GONE' };
      return deps.host.muteParticipant({
        state: st,
        sessionId,
        actorKeyHex: key,
        targetKeyHex: identityKey,
        muted,
      });
    },

    async shareStart({ communityId, channelId, quality }) {
      const key = self();
      if (failed(key)) return key;
      const st = state(communityId);
      if (failed(st)) return st;
      const r = deps.share.start({
        state: st,
        channelId,
        presenterKeyHex: key,
        ...(quality !== undefined ? { quality } : {}),
      });
      return r.ok ? { ok: true, sessionId: r.sessionId, captureToken: r.captureToken } : r;
    },

    async shareStop({ sessionId }) {
      const key = self();
      if (failed(key)) return key;
      return deps.share.stop({ sessionId, memberKeyHex: key });
    },

    async shareSetQuality({ sessionId, quality }) {
      const key = self();
      if (failed(key)) return key;
      const r = deps.share.setQuality({ sessionId, memberKeyHex: key, quality });
      return r.ok ? { ok: true, applied: r.applied } : r;
    },

    async shareJoin({ sessionId }) {
      const key = self();
      if (failed(key)) return key;
      const r = deps.share.join({ sessionId, memberKeyHex: key });
      return r.ok ? { ok: true, ticketId: r.ticketId, presenterKey: r.presenterKeyHex } : r;
    },
  };
}

// ─── Codec de fio de §16.2 (JSON; os tickets de §17.4 carregam Buffer) ────────────────

type WireTicket = {
  sessionId: string;
  channelId: string;
  peerA: string;
  peerB: string;
  expiresAt: number;
  sig: string;
};

/** Forma canônica do `voiceJoin` no fio. O host e o cliente usam esta, e só esta. */
export const mediaWire = {
  encodeTicket(t: MediaTicket): WireTicket {
    return {
      sessionId: t.sessionId,
      channelId: t.channelId,
      peerA: t.peerA.toString('hex'),
      peerB: t.peerB.toString('hex'),
      expiresAt: t.expiresAt,
      sig: t.sig.toString('hex'),
    };
  },
  decodeTicket(t: WireTicket): MediaTicket {
    return {
      sessionId: t.sessionId,
      channelId: t.channelId,
      peerA: Buffer.from(t.peerA, 'hex'),
      peerB: Buffer.from(t.peerB, 'hex'),
      expiresAt: t.expiresAt,
      sig: Buffer.from(t.sig, 'hex'),
    };
  },
  encodeVoiceJoin(r: Omit<VoiceJoinOk, 'ok'>): Record<string, unknown> {
    return {
      sessionId: r.sessionId,
      channelId: r.channelId,
      roster: r.roster,
      iceServers: r.iceServers,
      tickets: r.tickets.map((t) => mediaWire.encodeTicket(t)),
      turnCredential: r.turnCredential,
    };
  },
  decodeVoiceJoin(raw: Record<string, unknown>): VoiceJoinOk {
    return {
      ok: true,
      sessionId: String(raw['sessionId'] ?? ''),
      channelId: String(raw['channelId'] ?? ''),
      roster: (raw['roster'] as readonly RosterEntry[] | undefined) ?? [],
      iceServers: (raw['iceServers'] as readonly IceServer[] | undefined) ?? [],
      tickets: ((raw['tickets'] as readonly WireTicket[] | undefined) ?? []).map((t) =>
        mediaWire.decodeTicket(t),
      ),
      turnCredential: (raw['turnCredential'] as TurnCredential | undefined) ?? { username: '', password: '' },
    };
  },
};

// ─── Modo membro (§16.2 sobre `rpcClient`) ────────────────────────────────────────────

/**
 * Porta de chamada RPC. Declarada estruturalmente: §4 não autoriza importação lateral entre
 * módulos de L3, e o `RpcClient` satisfaz esta forma sem que `ipcRenderer` o importe — quem
 * monta o grafo injeta a implementação (§4).
 */
export interface RpcCallPort {
  call(
    method: string,
    body: Uint8Array,
  ): Promise<{ readonly ok: true; readonly body: Uint8Array } | { readonly ok: false; readonly code: string }>;
}

function encodeBody(arg: Record<string, unknown>): Uint8Array {
  return new Uint8Array(Buffer.from(JSON.stringify(arg), 'utf8'));
}

function decodeBody(body: Uint8Array): Record<string, unknown> {
  const text = Buffer.from(body).toString('utf8');
  if (text.length === 0) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Dispatcher de quem **não** hospeda: cada superfície de §15.4 vira o método de §16.2 que a
 * tabela nomeia, e a decisão continua sendo do host. A sessão de voz corrente é o estado
 * client-side que §29.2 pedia: nasce no `voiceJoin`, morre no `voiceLeave` e em qualquer
 * `E_SESSION_GONE` — inclusive o que chega de um `voice.revoked` do host (§17.4).
 */
export function remoteMediaDispatcher(port: RpcCallPort): MediaDispatcher & {
  /** §17.4 — revogação recebida do host derruba a sessão local sem round-trip. */
  forgetSession(): void;
} {
  let sessionId: string | null = null;

  async function call(method: string, arg: Record<string, unknown>): Promise<Record<string, unknown> | MediaFail> {
    const r = await port.call(method, encodeBody(arg));
    if (!r.ok) {
      // O host disse que a sessão acabou (ou sumiu): o estado local não pode sobreviver a isso.
      if (r.code === 'E_SESSION_GONE' || r.code === 'E_HOST_UNAVAILABLE') sessionId = null;
      return { ok: false, code: r.code };
    }
    return decodeBody(r.body);
  }

  const failed = (v: Record<string, unknown> | MediaFail): v is MediaFail => v['ok'] === false;

  return {
    mode: 'member',
    currentSessionId: () => sessionId,
    forgetSession() {
      sessionId = null;
    },

    async voiceJoin({ channelId }) {
      const r = await call('voiceJoin', { channelId });
      if (failed(r)) return r;
      const joined = mediaWire.decodeVoiceJoin(r);
      sessionId = joined.sessionId;
      return joined;
    },

    async voiceLeave() {
      if (sessionId === null) return { ok: true }; // mesmo no-op nomeado do modo host
      const r = await call('voiceLeave', { sessionId });
      sessionId = null;
      return failed(r) ? r : { ok: true };
    },

    async voiceSetSelf(patch) {
      if (sessionId === null) return { ok: false, code: 'E_SESSION_GONE' };
      const r = await call('voiceState', { ...patch });
      return failed(r) ? r : { ok: true };
    },

    async voiceMuteParticipant() {
      // §16.2 não tem método para isto. Ver §39: lacuna registrada, não contornada.
      return { ok: false, code: 'E_UNKNOWN_COMMAND' };
    },

    async shareStart({ channelId, quality }) {
      const r = await call('shareStart', { channelId, ...(quality !== undefined ? { quality } : {}) });
      if (failed(r)) return r;
      const token = r['captureToken'] as CaptureToken | undefined;
      return {
        ok: true,
        sessionId: String(r['sessionId'] ?? ''),
        // §16.2 não declara o token na resposta; o cliente não o inventa (§39).
        ...(token !== undefined ? { captureToken: token } : {}),
      };
    },

    async shareStop(a) {
      // §16.2 não tem `shareStop`: quem encerra é o `shareLeave` do apresentador, que o
      // módulo host já roteia para `stop` ("apresentador saindo encerra tudo", §17.5).
      const r = await call('shareLeave', { sessionId: a.sessionId });
      return failed(r) ? r : { ok: true };
    },

    async shareSetQuality() {
      // §16.2 não tem método para isto. Ver §39: lacuna registrada, não contornada.
      return { ok: false, code: 'E_UNKNOWN_COMMAND' };
    },

    async shareJoin(a) {
      const r = await call('shareJoin', { sessionId: a.sessionId });
      if (failed(r)) return r;
      return {
        ok: true,
        ticketId: String(r['ticketId'] ?? ''),
        presenterKey: String(r['presenterKey'] ?? ''),
      };
    },
  };
}
