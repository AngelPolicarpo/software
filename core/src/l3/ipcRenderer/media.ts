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
// **`captureToken` é capacidade local** (emenda de §17.4, 2026-08-22): quem o cunha é o
// núcleo do apresentador, no instante em que o host autoriza a sessão, e quem o verifica é
// esse mesmo núcleo — `capture.authorize` (§15.7) leva só `{sessionId}`. Por isso ele não
// trafega: a resposta de `shareStart` em §16.2 é `{sessionId}`, e o token nasce deste lado
// nos dois modos. Sem autorização do host não há sessão; sem sessão não há token.

import crypto from 'node:crypto';

import type {
  AuthorizeCaptureResult,
  CaptureToken,
  ShareHostSessions,
  ShareQuality,
} from '../../l2/shareStar/index.ts';
import type { TurnCredential } from '../../l2/communityHost/stunTurn.ts';
import { orderedPair, verifyMediaTicket } from '../../l2/voiceCoordinator/index.ts';
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
  /** §15.4 — capacidade local de captura (§17.4 emendado); nunca vem do host pela rede. */
  readonly captureToken: CaptureToken;
};

export type ShareJoinOk = { readonly ok: true; readonly ticketId: string; readonly presenterKey: string };
export type VoiceTicketsOk = { readonly ok: true; readonly sessionId: string; readonly tickets: readonly MediaTicket[] };

export type SessionSecurity = {
  readonly sessionId: string;
  readonly channelId: string;
  readonly tickets: readonly MediaTicket[];
};
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
  /**
   * §15.4 `voice.signal` — o host encaminha (§16.2 `voiceSignal`, emenda de 2026-08-22). O
   * núcleo não lê SDP: a mídia é DTLS-SRTP ponta a ponta (§17.2).
   */
  voiceSignal(a: { peerKey: string; ticketId: string; sdp?: string; ice?: string }): Promise<MediaAck>;
  /**
   * §17.4 emendado — renovação dos tickets da sessão corrente, na cadência
   * `MEDIA_TICKET_TTL_MS/3`. **Não** é comando de §15.4: quem tem prazo é a sessão, e quem
   * cuida dele é o núcleo. Quem dispara a cadência é o `VoiceTicketRenewer`.
   */
  renewTickets(): Promise<VoiceTicketsOk | MediaFail>;
  /**
   * §17.4 passo 3 — o material que autoriza sinalização de um par nesta sessão: o ticket que
   * o host emitiu para o par (eu, ele). `null` fora de chamada. É o que o gate de entrada de
   * sinalização consulta antes de deixar qualquer SDP chegar ao renderer.
   */
  sessionSecurity(): SessionSecurity | null;
  /**
   * §16.3 `voice.roster` — o roster mudou no host. Em modo membro é a **única** forma de
   * saber que um par novo entrou: sem isso, a renovação de §17.4 nunca emitiria ticket para
   * ele e a sinalização entre os dois ficaria eternamente sem autorização. Em modo host o
   * roster vivo é local e isto é no-op.
   */
  observeRoster(participants: readonly string[]): void;
  shareStart(a: { communityId: string; channelId: string; quality?: ShareQuality }): Promise<ShareStartOk | MediaFail>;
  shareStop(a: { sessionId: string }): Promise<MediaAck>;
  shareSetQuality(a: { sessionId: string; quality: ShareQuality }): Promise<SetQualityOkResult | MediaFail>;
  shareJoin(a: { sessionId: string }): Promise<ShareJoinOk | MediaFail>;
  /**
   * §15.7 `capture.authorize` — o main pergunta pelo `sessionId` e a resposta sai do estado
   * **local**, nunca de uma ida ao host (§17.4 emendado, `T-41`).
   */
  authorizeCapture(a: { sessionId: string }): AuthorizeCaptureResult;
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
  /**
   * Entrega da sinalização ao par de destino. Em modo host quem encaminha é esta instalação
   * — ela é o host —, e a saída para a conexão do destinatário é do transporte (§4).
   */
  deliverSignal?(a: {
    sessionId: string;
    fromPeerKey: string;
    toPeerKey: string;
    ticketId: string;
    sdp?: string;
    ice?: string;
  }): { ok: true } | { ok: false; code: string };
};

/** Dispatcher de quem hospeda: as decisões de §17.4/§17.5 são tomadas nesta máquina. */
export function localMediaDispatcher(deps: LocalMediaDeps): MediaDispatcher {
  // §15.7 leva só `{sessionId}`: o token que o núcleo cunhou fica aqui, e é contra ele que
  // `authorizeCapture` resolve. Quem decide de fato é `ShareHostSessions` (validade e vida
  // da sessão); este campo é só a metade que a mensagem de §15.7 não carrega.
  let capture: CaptureToken | null = null;
  // "Voz é uma só" (§15.4 `voice.leave`): há no máximo uma comunidade em chamada, e é dela
  // que sai o recorte do DS para a renovação — `voice.leave`/`setSelf` não levam communityId.
  let comunidadeEmChamada: string | null = null;
  let seguranca: SessionSecurity | null = null;
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
      const r = deps.host.join({ state: st, channelId, memberKeyHex: key });
      if (r.ok) {
        comunidadeEmChamada = communityId;
        seguranca = { sessionId: r.sessionId, channelId: r.channelId, tickets: r.tickets };
      }
      return r;
    },

    async voiceLeave() {
      const key = deps.selfKeyHex();
      const sessionId = deps.currentSessionId();
      // Sem sessão ativa é no-op nomeado (§15.4: `voice.leave` não tem argumento).
      if (key === null || sessionId === null) return { ok: true };
      comunidadeEmChamada = null;
      seguranca = null;
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
      if (!r.ok) return r;
      capture = r.captureToken;
      return { ok: true, sessionId: r.sessionId, captureToken: r.captureToken };
    },

    async shareStop({ sessionId }) {
      const key = self();
      if (failed(key)) return key;
      if (capture?.sessionId === sessionId) capture = null;
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

    async voiceSignal(a) {
      const key = deps.selfKeyHex();
      const sessionId = deps.currentSessionId();
      if (key === null || sessionId === null) return { ok: false, code: 'E_SESSION_GONE' };
      // Sem porta de entrega composta, a sinalização não chegou — é o que §15.4 nomeia.
      if (deps.deliverSignal === undefined) return { ok: false, code: 'E_PEER_UNREACHABLE' };
      const r = deps.deliverSignal({
        sessionId,
        fromPeerKey: key,
        toPeerKey: a.peerKey,
        ticketId: a.ticketId,
        ...(a.sdp !== undefined ? { sdp: a.sdp } : {}),
        ...(a.ice !== undefined ? { ice: a.ice } : {}),
      });
      return r.ok ? { ok: true } : r;
    },

    async renewTickets() {
      const key = deps.selfKeyHex();
      const sessionId = deps.currentSessionId();
      if (key === null || sessionId === null) return { ok: false, code: 'E_SESSION_GONE' };
      const st = comunidadeEmChamada === null ? null : deps.voiceStateFor(comunidadeEmChamada);
      const session = deps.host.currentSessionOf(key);
      if (session === null) return { ok: false, code: 'E_SESSION_GONE' };
      const roster = deps.host.sessionOf(session.channelId);
      if (st === null || roster === null) return { ok: false, code: 'E_TICKET_DENIED' };
      const tickets: MediaTicket[] = [];
      for (const p of roster.participants) {
        if (p.keyHex === key) continue;
        const r = deps.host.renewTicket({ state: st, sessionId, memberKeyHex: key, peerKeyHex: p.keyHex });
        // Um par que deixou de ser elegível some da renovação; o ticket dele expira sozinho
        // em `MEDIA_TICKET_TTL_MS` (§17.4), que é a rede de segurança da revogação.
        if (r.ok) tickets.push(r.ticket);
      }
      if (seguranca !== null) seguranca = { ...seguranca, tickets };
      return { ok: true, sessionId, tickets };
    },

    sessionSecurity: () => (deps.currentSessionId() === null ? null : seguranca),

    observeRoster: () => {
      // Modo host: o roster vivo é este. Não há o que observar de fora.
    },

    authorizeCapture({ sessionId }) {
      if (capture === null || capture.sessionId !== sessionId) return { allowed: false, reason: 'mismatch' };
      return deps.share.authorizeCapture({ sessionId, token: capture.token });
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
export function remoteMediaDispatcher(
  port: RpcCallPort,
  opts: {
    /** Vida do `captureToken` local — mesmo parâmetro que o host usa em `ShareHostSessions`. */
    readonly captureTokenTtlMs: number;
    readonly now?: () => number;
    /** Injetável só para teste determinístico; em produto é `randomBytes(32)`. */
    readonly mintToken?: () => string;
  },
): MediaDispatcher & {
  /** §17.4 — revogação recebida do host derruba a sessão local sem round-trip. */
  forgetSession(): void;
} {
  let sessionId: string | null = null;
  let capture: CaptureToken | null = null;
  /** Roster da última entrada — é dele que sai a lista de pares para renovar (§17.4). */
  let pares: readonly string[] = [];
  let seguranca: SessionSecurity | null = null;
  const now = opts.now ?? Date.now;
  const mint = opts.mintToken ?? (() => crypto.randomBytes(32).toString('hex'));

  async function call(method: string, arg: Record<string, unknown>): Promise<Record<string, unknown> | MediaFail> {
    const r = await port.call(method, encodeBody(arg));
    if (!r.ok) {
      // O host disse que a sessão acabou (ou sumiu): o estado local não pode sobreviver a isso.
      if (r.code === 'E_SESSION_GONE' || r.code === 'E_HOST_UNAVAILABLE') {
        sessionId = null;
        capture = null;
        seguranca = null;
      }
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
      capture = null;
      pares = [];
      seguranca = null;
    },

    async voiceJoin({ channelId }) {
      const r = await call('voiceJoin', { channelId });
      if (failed(r)) return r;
      const joined = mediaWire.decodeVoiceJoin(r);
      sessionId = joined.sessionId;
      pares = joined.roster.map((p) => p.keyHex);
      seguranca = { sessionId: joined.sessionId, channelId: joined.channelId, tickets: joined.tickets };
      return joined;
    },

    async voiceLeave() {
      if (sessionId === null) return { ok: true }; // mesmo no-op nomeado do modo host
      const r = await call('voiceLeave', { sessionId });
      sessionId = null;
      seguranca = null;
      return failed(r) ? r : { ok: true };
    },

    async voiceSetSelf(patch) {
      if (sessionId === null) return { ok: false, code: 'E_SESSION_GONE' };
      const r = await call('voiceState', { ...patch });
      return failed(r) ? r : { ok: true };
    },

    async voiceMuteParticipant({ identityKey, muted }) {
      // §16.2 `voiceMute` (emenda de 2026-08-22). O alvo é escopado à sessão corrente: sem
      // sessão não há roster onde silenciar, e o host recusaria pelo mesmo motivo.
      if (sessionId === null) return { ok: false, code: 'E_SESSION_GONE' };
      const r = await call('voiceMute', { sessionId, targetKey: identityKey, muted });
      return failed(r) ? r : { ok: true };
    },

    async voiceSignal(a) {
      if (sessionId === null) return { ok: false, code: 'E_SESSION_GONE' };
      const r = await call('voiceSignal', {
        sessionId,
        toPeerKey: a.peerKey,
        ticketId: a.ticketId,
        ...(a.sdp !== undefined ? { sdp: a.sdp } : {}),
        ...(a.ice !== undefined ? { ice: a.ice } : {}),
      });
      return failed(r) ? r : { ok: true };
    },

    async renewTickets() {
      if (sessionId === null) return { ok: false, code: 'E_SESSION_GONE' };
      const tickets: MediaTicket[] = [];
      for (const par of pares) {
        const r = await call('voiceTicket', { sessionId, peerKey: par });
        // `E_TICKET_DENIED` por par é normal e esperado: a própria entrada do roster, quem
        // saiu e quem perdeu elegibilidade não renovam, e esses tickets expiram sozinhos
        // em `MEDIA_TICKET_TTL_MS` — a rede de segurança da revogação de §17.4.
        if (!failed(r) && r['ticket'] !== undefined) {
          tickets.push(mediaWire.decodeTicket(r['ticket'] as Parameters<typeof mediaWire.decodeTicket>[0]));
        }
      }
      if (seguranca !== null) seguranca = { ...seguranca, tickets };
      return { ok: true, sessionId, tickets };
    },

    sessionSecurity: () => (sessionId === null ? null : seguranca),

    observeRoster(participants) {
      pares = [...participants];
    },

    async shareStart({ channelId, quality }) {
      const r = await call('shareStart', { channelId, ...(quality !== undefined ? { quality } : {}) });
      if (failed(r)) return r;
      const started = String(r['sessionId'] ?? '');
      // §17.4 emendado: o host autorizou a sessão; o token de captura nasce AQUI, porque é
      // aqui que `capture.authorize` (§15.7) será resolvido. Ele não trafega.
      capture = { token: mint(), sessionId: started, expiresAt: now() + opts.captureTokenTtlMs };
      return { ok: true, sessionId: started, captureToken: capture };
    },

    async shareStop(a) {
      // §16.2 não tem `shareStop`: quem encerra é o `shareLeave` do apresentador, que o
      // módulo host já roteia para `stop` ("apresentador saindo encerra tudo", §17.5).
      const r = await call('shareLeave', { sessionId: a.sessionId });
      if (capture?.sessionId === a.sessionId) capture = null;
      return failed(r) ? r : { ok: true };
    },

    async shareSetQuality(a) {
      // §16.2 `shareQuality` (emenda de 2026-08-22). O efeito mensurável é do apresentador,
      // que aprende o perfil pelo `quality` de `share.health` (§15.5, §17.5).
      const r = await call('shareQuality', { sessionId: a.sessionId, quality: a.quality });
      if (failed(r)) return r;
      return { ok: true, applied: r['applied'] === true };
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

    authorizeCapture(a) {
      // Resolvido só contra o estado local (§15.7, §17.4 emendado): nenhuma ida ao host —
      // a autorização dele já aconteceu, e é o que fez esta sessão existir.
      if (capture === null || capture.sessionId !== a.sessionId) return { allowed: false, reason: 'mismatch' };
      if (now() >= capture.expiresAt) return { allowed: false, reason: 'expired' };
      return { allowed: true };
    },
  };
}

// ─── Renovação de ticket (§17.4 emendado, cadência de §26.2) ──────────────────────────

/**
 * Quem cuida do prazo dos tickets é o núcleo, não o renderer: §15.4 não tem — e não deve
 * ter — comando de renovação, porque um renderer que esquecesse o temporizador perderia a
 * sessão em silêncio. Este é o dono da cadência.
 *
 * O relógio é injetado (`schedule`/`cancel`) porque temporizador dentro do roteador é
 * intestável; em produto o boot passa `setInterval`/`clearInterval`.
 *
 * Se o `voice.tickets` se perder, §15.1 regra 5 continua valendo: o caminho de reconsulta é
 * `voice.join` no mesmo canal, que devolve a sessão existente com material fresco.
 */
export class VoiceTicketRenewer {
  readonly #dispatcher: MediaDispatcher;
  readonly #communityId: () => string | null;
  readonly #emit: (ev: { readonly topic: 'voice.tickets'; readonly data: Record<string, unknown> }) => void;
  readonly #periodMs: number;
  readonly #schedule: (fn: () => void, ms: number) => unknown;
  readonly #cancel: (handle: unknown) => void;
  #handle: unknown = null;

  constructor(opts: {
    readonly dispatcher: MediaDispatcher;
    /** §15.5 exige `communityId` no evento; em modo membro há um dispatcher por comunidade. */
    readonly communityId: () => string | null;
    readonly emit: (ev: { readonly topic: 'voice.tickets'; readonly data: Record<string, unknown> }) => void;
    /** §26.2 — `MEDIA_TICKET_TTL_MS / 3`. */
    readonly periodMs: number;
    readonly schedule?: (fn: () => void, ms: number) => unknown;
    readonly cancel?: (handle: unknown) => void;
  }) {
    this.#dispatcher = opts.dispatcher;
    this.#communityId = opts.communityId;
    this.#emit = opts.emit;
    this.#periodMs = opts.periodMs;
    this.#schedule = opts.schedule ?? ((fn, ms) => setInterval(fn, ms));
    this.#cancel = opts.cancel ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  }

  start(): void {
    if (this.#handle === null) this.#handle = this.#schedule(() => void this.tick(), this.#periodMs);
  }

  stop(): void {
    if (this.#handle !== null) this.#cancel(this.#handle);
    this.#handle = null;
  }

  /** Um ciclo. Fora de chamada é no-op: não há sessão cujo prazo cuidar. */
  async tick(): Promise<void> {
    if (this.#dispatcher.currentSessionId() === null) return;
    const communityId = this.#communityId();
    if (communityId === null) return;
    const r = await this.#dispatcher.renewTickets();
    // Falha de renovação não é evento: o ticket velho continua valendo até expirar, e a
    // próxima volta tenta de novo. Anunciar "renovou" sem ticket seria mentir à UI.
    if (!r.ok || r.tickets.length === 0) return;
    this.#emit({
      topic: 'voice.tickets',
      data: {
        communityId,
        sessionId: r.sessionId,
        tickets: r.tickets.map((t) => mediaWire.encodeTicket(t)),
      },
    });
  }
}

// ─── Entrada de notificações do host (§16.3) e o runtime de mídia ─────────────────────

/**
 * Porta de recepção das notificações de §16.3. Estrutural pela mesma razão de `RpcCallPort`:
 * §4 não autoriza `ipcRenderer` a importar `rpcClient`.
 */
export interface RpcNotifyPort {
  onNotify(cb: (topic: string, body: Uint8Array) => void): () => void;
}

/**
 * §17.4 passo 3 — "o cliente SÓ aceita sinalização de um par que apresente ticket válido
 * para (sessionId, esteParDeChaves)". A verificação é **do núcleo**, não do renderer: o
 * núcleo já tem o ticket do par e a chave do host, e sinalização não autorizada não deve
 * chegar à camada que fala WebRTC. Falha fechada — sem material, nada passa.
 */
export function signalIsAuthorized(a: {
  readonly security: SessionSecurity | null;
  readonly hostPublicKey: Buffer;
  readonly selfPublicKey: Buffer;
  readonly peerKeyHex: string;
  readonly now: number;
}): boolean {
  if (a.security === null) return false;
  if (!/^[0-9a-f]{64}$/i.test(a.peerKeyHex)) return false;
  const remoto = Buffer.from(a.peerKeyHex, 'hex');
  if (remoto.equals(a.selfPublicKey)) return false; // ninguém sinaliza consigo mesmo
  const par = orderedPair(a.selfPublicKey, remoto);
  return a.security.tickets.some(
    (ticket) =>
      verifyMediaTicket(
        a.hostPublicKey,
        ticket,
        {
          sessionId: a.security!.sessionId,
          channelId: a.security!.channelId,
          localPeer: par.peerA,
          remotePeer: par.peerB,
        },
        a.now,
      ).ok,
  );
}

/**
 * O que o boot liga: a cadência de renovação de ticket (§17.4 emendado) e a entrada das
 * notificações do host (§16.3), ambas desaguando no fan-out de eventos de §15.5.
 *
 * Existe para que o boot do utilityProcess não precise reconstruir esta ordem em cada
 * comunidade — e para que ela seja testável sem processo, sem socket e sem relógio de
 * parede.
 */
export function startMediaRuntime(opts: {
  readonly dispatcher: MediaDispatcher;
  /** §15.5 exige `communityId` no evento; há um runtime por comunidade. */
  readonly communityId: string;
  /** Saída para o renderer — a mesma forma que o `EventFanout` de §38 consome. */
  readonly emit: (events: readonly { readonly topic: string; readonly data: Record<string, unknown> }[]) => void;
  /** Ausente em modo host: quem hospeda não recebe notificação de §16.3, ele as produz. */
  readonly notifications?: RpcNotifyPort;
  readonly hostPublicKey?: Buffer;
  readonly selfPublicKey?: Buffer;
  /** §26.2 — `MEDIA_TICKET_TTL_MS / 3`. */
  readonly ticketPeriodMs: number;
  readonly now?: () => number;
  readonly schedule?: (fn: () => void, ms: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}): { stop(): void } {
  const now = opts.now ?? Date.now;
  const renewer = new VoiceTicketRenewer({
    dispatcher: opts.dispatcher,
    communityId: () => opts.communityId,
    emit: (ev) => opts.emit([ev]),
    periodMs: opts.ticketPeriodMs,
    ...(opts.schedule !== undefined ? { schedule: opts.schedule } : {}),
    ...(opts.cancel !== undefined ? { cancel: opts.cancel } : {}),
  });
  renewer.start();

  const off =
    opts.notifications?.onNotify((topic, body) => {
      let data: Record<string, unknown>;
      try {
        const parsed = JSON.parse(Buffer.from(body).toString('utf8')) as unknown;
        data = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      } catch {
        return; // quadro estranho na condução nunca vira evento
      }

      if (topic === 'voice.signal') {
        // §16.3 regra 5 / §17.4 passo 3 — o gate fica aqui, antes do renderer.
        if (opts.hostPublicKey === undefined || opts.selfPublicKey === undefined) return;
        const autorizado = signalIsAuthorized({
          security: opts.dispatcher.sessionSecurity(),
          hostPublicKey: opts.hostPublicKey,
          selfPublicKey: opts.selfPublicKey,
          peerKeyHex: typeof data['peerKey'] === 'string' ? data['peerKey'] : '',
          now: now(),
        });
        if (!autorizado) return;
      }

      if (topic === 'voice.roster') {
        // Par novo na chamada: a renovação de §17.4 precisa saber para emitir ticket a ele.
        const participants = data['participants'];
        if (Array.isArray(participants)) {
          opts.dispatcher.observeRoster(
            participants
              .map((p) => (typeof p === 'object' && p !== null ? (p as { keyHex?: unknown }).keyHex : undefined))
              .filter((k): k is string => typeof k === 'string'),
          );
        }
      }

      if (topic === 'voice.revoked') {
        // §17.4 — revogação da própria sessão derruba o estado local sem round-trip.
        const alvo = data['targetKey'];
        const eu = opts.selfPublicKey?.toString('hex');
        if (typeof alvo === 'string' && eu !== undefined && alvo === eu) {
          (opts.dispatcher as { forgetSession?: () => void }).forgetSession?.();
        }
      }

      opts.emit([{ topic, data: { communityId: opts.communityId, ...data } }]);
    }) ?? (() => {});

  return {
    stop() {
      renewer.stop();
      off();
    },
  };
}
