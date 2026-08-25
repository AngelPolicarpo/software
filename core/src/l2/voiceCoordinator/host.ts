// `voiceCoordinator` host-side — sessões de voz, tickets e revogação (§17.4, §RPC, A22).
//
// Contratos atendidos aqui:
//   `voiceJoin`   → `{sessionId, roster[], iceServers[], tickets[], turnCredential}`
//                   com validação de §17.4 passo 1 (`voice_speak`, canal de voz,
//                   comunidade não ended, membro ativo não banido nem em timeout);
//   `voiceLeave`  → `{}` com `voice.revoked{targetKey, sessionId}` aos participantes;
//   `voiceState`  → `{muted?, deafened?, cameraOn?, speaking?}` com `E_CAMERA_LIMIT`;
//   `voiceTicket` → `{ticketId, ticket, expiresAt}`, cadência `MEDIA_TICKET_TTL_MS/3`
//                   (§26.2), `E_TICKET_DENIED` quando o par não está na sessão;
//   `VoiceRoster` → fan-out a participantes a cada mudança (§17.6).
//
// §4: este módulo não declara `fold` — o estado estrutural entra pela porta estreita
// `VoiceStatePort`, que o `DecisionState` real satisfaz por estrutura, e os valores de
// contrato que moram no `fold` (`CHANNEL_TYPE` via predicado, `MEDIA_TICKET_TTL_MS`,
// `MAX_VOICE_PARTICIPANTS`, `MAX_CAMERAS`) e os segredos de assinatura chegam injetados
// pela composição. A derivação de revogação é função pura sobre essa porta
// (`sweepAgainst`): ban/kick/saída derrubam pelo estado do membro; `mod.timeout` pelo
// `timeoutUntil`; `channel.delete` e o fim da comunidade encerram a sessão inteira.

import crypto from 'node:crypto';

import { issueSessionTicket, type MediaTicket } from './tickets.ts';
import { issueTurnCredential, type TurnCredential } from '../communityHost/stunTurn.ts';
import { permissionFromNumber, type Permission } from '../../l1/permissions/index.ts';

export const VOICE_SPEAK: Permission = 'voice_speak';

/**
 * Varredura de permissão efetiva de um membro sobre o recorte da porta (§9.1). Exportada
 * para o `shareStar`, que reutiliza a mesma decisão para `voice_share_screen` sem importar
 * `permissions` — §4 não o declara nas dependências daquele módulo.
 */
export function memberHasPermission(state: VoiceStatePort, memberKeyHex: KeyHex, permission: Permission): boolean {
  const member = state.members.get(memberKeyHex);
  if (member === undefined) return false;
  for (const roleId of member.roleIds) {
    const role = state.roles.get(roleId);
    if (role === undefined || role.deletedAt !== undefined) continue;
    for (const n of role.permissions) {
      if (permissionFromNumber(n) === permission) return true;
    }
  }
  return false;
}

type Id = string;
type KeyHex = string;

/**
 * Recorte do `DecisionState` que a voz lê — porta declarada por este módulo (§4). O
 * `DecisionState` de L1 satisfaz-na por estrutura; nada além disto é lido.
 */
export interface VoiceStatePort {
  readonly community: { readonly exists: boolean; readonly endedAt?: number };
  readonly channels: ReadonlyMap<Id, { readonly type: number; readonly deletedAt?: number }>;
  readonly members: ReadonlyMap<
    KeyHex,
    {
      readonly state: 'active' | 'left' | 'banned';
      readonly timeoutUntil?: number;
      readonly roleIds: Iterable<string>;
    }
  >;
  /** Permissões como números de §9.1 — a conversão para `Permission` é feita aqui. */
  readonly roles: ReadonlyMap<Id, { readonly permissions: Iterable<number>; readonly deletedAt?: number }>;
}

/** Forma de `iceServers` entregue em `voiceJoin` — endereços vêm da porta injetada. */
export interface IceServer {
  readonly urls: string;
  readonly username?: string;
  readonly credential?: string;
}

export type VoiceParticipantState = {
  readonly muted: boolean;
  readonly deafened: boolean;
  /** Campo do contrato `VoiceRoster`/`voiceState`; quem muda é o `shareStar` (fase 8). */
  readonly sharing: boolean;
  readonly cameraOn: boolean;
  readonly speaking: boolean;
};

export type RosterEntry = VoiceParticipantState & { readonly keyHex: KeyHex };

export type RosterSnapshot = {
  readonly sessionId: string;
  readonly channelId: Id;
  readonly participants: readonly RosterEntry[];
};

export type RevokedTarget = {
  readonly sessionId: string;
  readonly channelId: Id;
  readonly targetKeyHex: KeyHex;
};

interface Participant {
  muted: boolean;
  deafened: boolean;
  cameraOn: boolean;
  speaking: boolean;
}

interface Session {
  readonly sessionId: string;
  readonly channelId: Id;
  readonly createdAt: number;
  readonly participants: Map<KeyHex, Participant>;
}

export type JoinOk = {
  readonly ok: true;
  readonly sessionId: string;
  readonly channelId: Id;
  readonly roster: readonly RosterEntry[];
  readonly iceServers: readonly IceServer[];
  readonly tickets: readonly MediaTicket[];
  readonly turnCredential: TurnCredential;
};

export type VoiceErrorCode =
  | 'E_COMMUNITY_ENDED'
  | 'E_NOT_FOUND'
  | 'E_CHANNEL_NOT_FOUND'
  | 'E_CHANNEL_NOT_VOICE'
  | 'E_NOT_MEMBER'
  | 'E_BANNED'
  | 'E_TIMED_OUT'
  | 'E_PERMISSION_DENIED'
  | 'E_VOICE_FULL'
  | 'E_CAMERA_LIMIT'
  | 'E_SESSION_GONE'
  | 'E_TICKET_DENIED';

export type JoinErr = { readonly ok: false; readonly code: VoiceErrorCode };

export type SetSelfPatch = {
  readonly muted?: boolean;
  readonly deafened?: boolean;
  readonly cameraOn?: boolean;
  readonly speaking?: boolean;
};

export interface VoiceHostOptions {
  /** Chave privada do host para emitir tickets (L0 `identity`, injetada no boot). */
  hostSecretKey: Buffer;
  /** Segredo das credenciais TURN de curta duração (§17.3). */
  hostTurnSecret: Buffer;
  clock?: { now(): number };
  /** Composição injeta `MEDIA_TICKET_TTL_MS` (§27.1) — vale para ticket e credencial. */
  ttlMs: number;
  /** Composição injeta `MAX_VOICE_PARTICIPANTS` (§27.1). */
  maxParticipants: number;
  /** Composição injeta `MAX_CAMERAS` (§27.1). */
  maxCameras: number;
  /**
   * Prediço sobre o tipo numérico de canal de §6.6: a constante `CHANNEL_TYPE.voice`
   * mora no `fold` (§27.1), que este módulo não importa — a composição injeta o teste.
   */
  isVoiceChannelType: (type: number) => boolean;
  /** Porta: endereço público do host via `hyperdht` (§17.3); default vazio. */
  iceServers?: () => readonly IceServer[];
  sessionIdFactory?: () => string;
  onRevoked?: (targets: readonly RevokedTarget[]) => void;
  onRosterChanged?: (snapshot: RosterSnapshot) => void;
}

function participantEntry(keyHex: string, p: Participant): RosterEntry {
  return {
    keyHex,
    muted: p.muted,
    deafened: p.deafened,
    sharing: false,
    cameraOn: p.cameraOn,
    speaking: p.speaking,
  };
}

/**
 * Sessões de voz vivas do host. Estado **efêmero** (nunca persiste): morre com o
 * processo do host, que é exatamente quando toda voz morre (`VOZ-09`). A autoridade
 * estrutural é sempre o `DecisionState` corrente, passado como argumento.
 */
export class VoiceHostSessions {
  readonly #hostSecretKey: Buffer;
  readonly #turnSecret: Buffer;
  readonly #clock: { now(): number };
  readonly #ttlMs: number;
  readonly #maxParticipants: number;
  readonly #maxCameras: number;
  readonly #isVoiceChannelType: (type: number) => boolean;
  readonly #iceServers: () => readonly IceServer[];
  readonly #sessionIdFactory: () => string;
  readonly #onRevoked: (targets: readonly RevokedTarget[]) => void;
  readonly #onRosterChanged: (snapshot: RosterSnapshot) => void;
  readonly #sessions = new Map<Id, Session>(); // channelId → session

  constructor(opts: VoiceHostOptions) {
    this.#hostSecretKey = opts.hostSecretKey;
    this.#turnSecret = opts.hostTurnSecret;
    this.#clock = opts.clock ?? { now: () => Date.now() };
    this.#ttlMs = opts.ttlMs;
    this.#maxParticipants = opts.maxParticipants;
    this.#maxCameras = opts.maxCameras;
    this.#isVoiceChannelType = opts.isVoiceChannelType;
    this.#iceServers = opts.iceServers ?? (() => []);
    this.#sessionIdFactory = opts.sessionIdFactory ?? (() => crypto.randomBytes(16).toString('hex'));
    this.#onRevoked = opts.onRevoked ?? (() => {});
    this.#onRosterChanged = opts.onRosterChanged ?? (() => {});
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  sessionOf(channelId: Id): { sessionId: string; participants: readonly RosterEntry[] } | null {
    const s = this.#sessions.get(channelId);
    if (s === undefined) return null;
    return { sessionId: s.sessionId, participants: this.#rosterOf(s) };
  }

  /** Chaves dos participantes — porta para o `MediaServer` (`sessionPeerKeys`, §17.3). */
  participantKeys(sessionId: string): ReadonlySet<KeyHex> {
    for (const s of this.#sessions.values()) {
      if (s.sessionId !== sessionId) continue;
      return new Set(s.participants.keys());
    }
    return new Set();
  }

  /**
   * Sessão corrente do membro ("voz é uma só") — a composição lê para o estado LS do
   * renderer e para `voice.leave`/`voice.setSelf`, que chegam sem `sessionId` (§15.4).
   */
  currentSessionOf(memberKeyHex: KeyHex): { readonly sessionId: string; readonly channelId: Id } | null {
    const s = this.#sessionOfMember(memberKeyHex);
    return s === undefined ? null : { sessionId: s.sessionId, channelId: s.channelId };
  }

  /**
   * `voiceJoin`. Idempotente para quem já está na sessão: devolve a mesma sessão com
   * material fresco — é também o caminho de renovação da `turnCredential`, cujo
   * `expiresAt` viaja dentro do `username` (§17.3).
   */
  join(args: { state: VoiceStatePort; channelId: Id; memberKeyHex: KeyHex }): JoinOk | JoinErr {
    const now = this.#clock.now();
    const state = args.state;

    // §17.4 passo 1 — comunidade não ended
    if (!state.community.exists) return { ok: false, code: 'E_NOT_FOUND' };
    if (state.community.endedAt !== undefined) return { ok: false, code: 'E_COMMUNITY_ENDED' };

    // canal de voz existente
    const channel = state.channels.get(args.channelId);
    if (channel === undefined || channel.deletedAt !== undefined) return { ok: false, code: 'E_CHANNEL_NOT_FOUND' };
    if (!this.#isVoiceChannelType(channel.type)) return { ok: false, code: 'E_CHANNEL_NOT_VOICE' };

    // membro ativo, não banido nem em timeout
    const eligibility = this.#memberEligible(state, args.memberKeyHex, now);
    if (!eligibility.ok) return eligibility;

    // permissão `voice_speak` (§9.1)
    if (!this.#hasVoiceSpeak(state, args.memberKeyHex)) return { ok: false, code: 'E_PERMISSION_DENIED' };

    // sessão do canal: existe? cabe?
    let session = this.#sessions.get(args.channelId);
    if (session !== undefined && session.participants.has(args.memberKeyHex)) {
      return this.#joinResult(session, args.memberKeyHex);
    }
    if (session === undefined) {
      session = {
        sessionId: this.#sessionIdFactory(),
        channelId: args.channelId,
        createdAt: now,
        participants: new Map(),
      };
    } else if (session.participants.size >= this.#maxParticipants) {
      return { ok: false, code: 'E_VOICE_FULL' };
    }

    // entrar numa chamada enquanto está noutra é sair da anterior (voz é uma só)
    const previous = this.#sessionOfMember(args.memberKeyHex);
    if (previous !== undefined && previous.sessionId !== session.sessionId) {
      this.leave({ sessionId: previous.sessionId, memberKeyHex: args.memberKeyHex });
    }

    const isNew = !this.#sessions.has(args.channelId);
    session.participants.set(args.memberKeyHex, { muted: false, deafened: false, cameraOn: false, speaking: false });
    if (isNew) this.#sessions.set(args.channelId, session);

    this.#emitRoster(session);
    return this.#joinResult(session, args.memberKeyHex);
  }

  /** `voiceLeave`: remove e emite `voice.revoked{targetKey}` (§17.4). */
  leave(args: { sessionId: string; memberKeyHex: KeyHex }): { ok: true } | { ok: false; code: 'E_SESSION_GONE' } {
    const session = this.#bySessionId(args.sessionId);
    if (session === undefined || !session.participants.has(args.memberKeyHex)) {
      return { ok: false, code: 'E_SESSION_GONE' };
    }
    session.participants.delete(args.memberKeyHex);
    this.#emitRevocation(session, args.memberKeyHex);
    // §17.6 — quem FICOU precisa da lista nova. Sem isto o roster só se corrigia no próximo
    // join, e a ocupação do canal (§15.5 `voice.occupancyChanged`) nunca voltava a zero.
    this.#emitRoster(session);
    this.#dropIfEmpty(session);
    return { ok: true };
  }

  /** `voiceState{muted?, deafened?, cameraOn?, speaking?}` — só o próprio estado. */
  setSelf(args: { sessionId: string; memberKeyHex: KeyHex; patch: SetSelfPatch }): { ok: true } | { ok: false; code: VoiceErrorCode } {
    const session = this.#bySessionId(args.sessionId);
    const p = session?.participants.get(args.memberKeyHex);
    if (session === undefined || p === undefined) return { ok: false, code: 'E_SESSION_GONE' };
    if (args.patch.cameraOn === true && !p.cameraOn) {
      let cameras = 0;
      for (const q of session.participants.values()) if (q.cameraOn) cameras++;
      if (cameras >= this.#maxCameras) return { ok: false, code: 'E_CAMERA_LIMIT' };
    }
    if (args.patch.muted !== undefined) p.muted = args.patch.muted;
    if (args.patch.deafened !== undefined) p.deafened = args.patch.deafened;
    if (args.patch.cameraOn !== undefined) p.cameraOn = args.patch.cameraOn;
    if (args.patch.speaking !== undefined) p.speaking = args.patch.speaking;
    this.#emitRoster(session);
    return { ok: true };
  }

  /**
   * `voiceMuteParticipant` (§15.4): mutar **outro** participante é decisão do host com
   * `voice_mute_others` (§9.1) — o alvo não autoriza o próprio silenciamento. Estado
   * efêmero do roster; vai embora com a sessão (§6.16).
   */
  muteParticipant(args: {
    state: VoiceStatePort;
    sessionId: string;
    actorKeyHex: KeyHex;
    targetKeyHex: KeyHex;
    muted: boolean;
  }): { ok: true } | { ok: false; code: 'E_SESSION_GONE' | 'E_PERMISSION_DENIED' } {
    if (!memberHasPermission(args.state, args.actorKeyHex, 'voice_mute_others')) {
      return { ok: false, code: 'E_PERMISSION_DENIED' };
    }
    const session = this.#bySessionId(args.sessionId);
    const target = session?.participants.get(args.targetKeyHex);
    if (session === undefined || target === undefined) return { ok: false, code: 'E_SESSION_GONE' };
    target.muted = args.muted;
    this.#emitRoster(session);
    return { ok: true };
  }

  /**
   * `voiceTicket{sessionId, peerKey}` — renovação par-a-par na cadência
   * `MEDIA_TICKET_TTL_MS/3` (§26.2). Recusa com `E_TICKET_DENIED` se a sessão acabou,
   * se algum dos dois não participa ou se alguém deixou de ser elegível no log.
   */
  renewTicket(args: {
    state: VoiceStatePort;
    sessionId: string;
    memberKeyHex: KeyHex;
    peerKeyHex: KeyHex;
  }): { ok: true; ticketId: string; ticket: MediaTicket; expiresAt: number } | { ok: false; code: 'E_TICKET_DENIED' } {
    const now = this.#clock.now();
    const session = this.#bySessionId(args.sessionId);
    if (
      session === undefined ||
      !session.participants.has(args.memberKeyHex) ||
      !session.participants.has(args.peerKeyHex) ||
      args.memberKeyHex === args.peerKeyHex ||
      !this.#memberEligible(args.state, args.memberKeyHex, now).ok ||
      !this.#memberEligible(args.state, args.peerKeyHex, now).ok
    ) {
      return { ok: false, code: 'E_TICKET_DENIED' };
    }
    const selfKey = Buffer.from(args.memberKeyHex, 'hex');
    const otherKey = Buffer.from(args.peerKeyHex, 'hex');
    if (selfKey.length !== 32 || otherKey.length !== 32) return { ok: false, code: 'E_TICKET_DENIED' };
    const expiresAt = now + this.#ttlMs;
    return {
      ok: true,
      ticketId: crypto.randomBytes(12).toString('hex'),
      ticket: issueSessionTicket(this.#hostSecretKey, {
        sessionId: args.sessionId,
        channelId: session.channelId,
        selfKey,
        otherKey,
        now,
        ttlMs: this.#ttlMs,
      }),
      expiresAt,
    };
  }

  /**
   * Deriva as revogações do momento a partir do estado corrente — o host chama após
   * cada admissão projetada. Devolve os alvos emitidos (teste e métrica); o fan-out a
   * destinatários concretos é da composição.
   *
   * Permissão removida no meio da sessão **não** derruba: §17.4 define enforcement por
   * remoção de roster + revogação de ticket, e quem revalida `voice_speak` é a entrada.
   */
  sweepAgainst(state: VoiceStatePort): readonly RevokedTarget[] {
    const now = this.#clock.now();
    const emitted: RevokedTarget[] = [];

    if (!state.community.exists || state.community.endedAt !== undefined) {
      for (const session of [...this.#sessions.values()]) this.#endSession(session, emitted);
      return emitted;
    }

    for (const session of [...this.#sessions.values()]) {
      const channel = state.channels.get(session.channelId);
      if (channel === undefined || channel.deletedAt !== undefined) {
        this.#endSession(session, emitted);
        continue;
      }
      for (const keyHex of [...session.participants.keys()]) {
        if (!this.#memberEligible(state, keyHex, now).ok) {
          session.participants.delete(keyHex);
          emitted.push(...this.#revokeAndNotify(session, keyHex));
        }
      }
      this.#dropIfEmpty(session);
    }
    return emitted;
  }

  #endSession(session: Session, emitted: RevokedTarget[]): void {
    for (const keyHex of [...session.participants.keys()]) {
      session.participants.delete(keyHex);
      emitted.push(...this.#revokeAndNotify(session, keyHex));
    }
    // Sessão encerrada é ocupação zero, e isso é observável de fora da chamada.
    this.#emitRoster(session);
    this.#dropIfEmpty(session);
  }

  /** Material de `voiceJoin` para um participante já presente (renovação idempotente). */
  #joinResult(session: Session, memberKeyHex: KeyHex): JoinOk {
    const now = this.#clock.now();
    const roster = this.#rosterOf(session);
    const selfKey = Buffer.from(memberKeyHex, 'hex');
    const tickets = roster
      .filter((e) => e.keyHex !== memberKeyHex)
      .map((e) =>
        issueSessionTicket(this.#hostSecretKey, {
          sessionId: session.sessionId,
          channelId: session.channelId,
          selfKey,
          otherKey: Buffer.from(e.keyHex, 'hex'),
          now,
          ttlMs: this.#ttlMs,
        }),
      );
    return {
      ok: true,
      sessionId: session.sessionId,
      channelId: session.channelId,
      roster,
      iceServers: this.#iceServers(),
      tickets,
      turnCredential: issueTurnCredential(this.#turnSecret, session.sessionId, selfKey, now + this.#ttlMs),
    };
  }

  #rosterOf(session: Session): RosterEntry[] {
    return [...session.participants.entries()]
      .map(([keyHex, p]) => participantEntry(keyHex, p))
      .sort((a, b) => a.keyHex.localeCompare(b.keyHex));
  }

  #bySessionId(sessionId: string): Session | undefined {
    for (const s of this.#sessions.values()) if (s.sessionId === sessionId) return s;
    return undefined;
  }

  #sessionOfMember(memberKeyHex: KeyHex): Session | undefined {
    for (const s of this.#sessions.values()) if (s.participants.has(memberKeyHex)) return s;
    return undefined;
  }

  #memberEligible(
    state: VoiceStatePort,
    memberKeyHex: KeyHex,
    now: number,
  ): { ok: true } | { ok: false; code: VoiceErrorCode } {
    const member = state.members.get(memberKeyHex);
    if (member === undefined) return { ok: false, code: 'E_NOT_MEMBER' };
    if (member.state === 'banned') return { ok: false, code: 'E_BANNED' };
    if (member.state === 'left') return { ok: false, code: 'E_NOT_MEMBER' };
    if (member.timeoutUntil !== undefined && member.timeoutUntil > now) return { ok: false, code: 'E_TIMED_OUT' };
    return { ok: true };
  }

  #hasVoiceSpeak(state: VoiceStatePort, memberKeyHex: KeyHex): boolean {
    return memberHasPermission(state, memberKeyHex, VOICE_SPEAK);
  }

  #emitRoster(session: Session): void {
    this.#onRosterChanged({
      sessionId: session.sessionId,
      channelId: session.channelId,
      participants: this.#rosterOf(session),
    });
  }

  #emitRevocation(session: Session, targetKeyHex: KeyHex): void {
    this.#onRevoked([{ sessionId: session.sessionId, channelId: session.channelId, targetKeyHex }]);
  }

  #revokeAndNotify(session: Session, targetKeyHex: KeyHex): readonly RevokedTarget[] {
    const target: RevokedTarget = { sessionId: session.sessionId, channelId: session.channelId, targetKeyHex };
    this.#onRevoked([target]);
    return [target];
  }

  #dropIfEmpty(session: Session): void {
    if (session.participants.size === 0 && this.#sessions.get(session.channelId) === session) {
      this.#sessions.delete(session.channelId);
    }
  }
}
