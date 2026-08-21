// Tickets de mídia (A22, §17.4) e controles TURN do host (§17.3) — camada de decisão.
// Codificações não fixadas pelo texto normativo estão declaradas aqui e no artefato:
// expiresAt como uint64 big-endian de 8 bytes; HMAC-SHA256 sobre o digest BLAKE2b-256.

import crypto from 'node:crypto';

import sodium from 'sodium-native';

export const MEDIA_TICKET_TTL_MS_DEFAULT = 5 * 60 * 1000; // §17.4
export const TURN_ALLOC_TTL_MS_DEFAULT = 10 * 60 * 1000; // §17.3 TURN_ALLOC_TTL_MS
export const TURN_ALLOC_PER_MEMBER = 2; // §17.3
export const VOICE_REVOKED_CLOSE_MS = 5_000; // critério POC-08: ban encerra sessão ≤ 5 s

function blake256(domain: string, ...parts: Buffer[]): Buffer {
  const out = Buffer.allocUnsafe(32);
  sodium.crypto_generichash_batch(out, [Buffer.from(domain, 'utf8'), ...parts]);
  return out;
}

function be64(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(Math.trunc(n)));
  return b;
}

// ─── Ticket de mídia — Ed25519(hostKey, BLAKE2b('media-ticket/1' ‖ …)) ───────

export interface MediaTicketInput {
  readonly sessionId: string;
  readonly channelId: string;
  readonly peerA: Buffer; // 32 B
  readonly peerB: Buffer; // 32 B
  readonly expiresAt: number;
}

export function mediaTicketMessage(t: MediaTicketInput): Buffer {
  return blake256(
    'media-ticket/1',
    Buffer.from(t.sessionId, 'utf8'),
    Buffer.from(t.channelId, 'utf8'),
    t.peerA,
    t.peerB,
    be64(t.expiresAt),
  );
}

export function signMediaTicket(hostSecretKey: Buffer, t: MediaTicketInput): Buffer {
  const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, mediaTicketMessage(t), hostSecretKey);
  return sig;
}

export type TicketReject =
  | 'E_TICKET_INVALID'
  | 'E_TICKET_EXPIRED'
  | 'E_TICKET_WRONG_SESSION'
  | 'E_TICKET_WRONG_PAIR';

export interface IssuedTicket extends MediaTicketInput {
  readonly sig: Buffer;
}

export function issueTicket(hostSecretKey: Buffer, t: MediaTicketInput): IssuedTicket {
  return { ...t, sig: signMediaTicket(hostSecretKey, t) };
}

/** Verificação completa: assinatura sobre (sessionId, channelId, par, expiresAt) + validade temporal. */
export function verifyTicket(
  hostPublicKey: Buffer,
  ticket: IssuedTicket,
  expected: { sessionId: string; channelId: string; localPeer: Buffer; remotePeer: Buffer },
  now: number,
): { ok: true } | { ok: false; code: TicketReject } {
  const msgOk =
    ticket.sessionId === expected.sessionId && ticket.channelId === expected.channelId;
  if (!msgOk) return { ok: false, code: 'E_TICKET_WRONG_SESSION' };
  const pairMatches =
    (ticket.peerA.equals(expected.localPeer) && ticket.peerB.equals(expected.remotePeer)) ||
    (ticket.peerA.equals(expected.remotePeer) && ticket.peerB.equals(expected.localPeer));
  if (!pairMatches) return { ok: false, code: 'E_TICKET_WRONG_PAIR' };
  const msg = mediaTicketMessage(ticket);
  if (!sodium.crypto_sign_verify_detached(sigBuffer(ticket.sig), msg, hostPublicKey)) {
    return { ok: false, code: 'E_TICKET_INVALID' };
  }
  if (now >= ticket.expiresAt) return { ok: false, code: 'E_TICKET_EXPIRED' };
  return { ok: true };
}

function sigBuffer(sig: Buffer): Buffer {
  if (sig.length !== 64) throw Object.assign(new Error('assinatura com tamanho inválido'), { code: 'E_TICKET_INVALID' });
  return sig;
}

// ─── Credencial TURN de curta duração (§17.3) ────────────────────────────────

export interface TurnCredential {
  readonly username: string; // `<sessionId>:<expiresAt>`
  readonly password: string; // hex(HMAC via libsodium crypto_auth sobre BLAKE2b('turn-cred/1' ‖ …))
}

function turnAuthKey(secret: Buffer): Buffer {
  // libsodium crypto_auth exige chave de crypto_auth_KEYBYTES; segredos de outro
  // tamanho são normalizados por BLAKE2b-256 com domínio próprio
  if (secret.length === sodium.crypto_auth_KEYBYTES) return secret;
  return blake256('turn-cred-key/1', secret);
}

export function issueTurnCredential(
  hostTurnSecret: Buffer,
  sessionId: string,
  peerKey: Buffer,
  expiresAt: number,
): TurnCredential {
  const digest = blake256('turn-cred/1', Buffer.from(sessionId, 'utf8'), peerKey, be64(expiresAt));
  const mac = Buffer.alloc(sodium.crypto_auth_BYTES);
  sodium.crypto_auth(mac, digest, turnAuthKey(hostTurnSecret));
  return { username: `${sessionId}:${expiresAt}`, password: mac.toString('hex') };
}

export type TurnCredReject = 'E_TURN_CREDENTIAL_INVALID' | 'E_TURN_CREDENTIAL_EXPIRED';

export function verifyTurnCredential(
  hostTurnSecret: Buffer,
  cred: TurnCredential,
  peerKey: Buffer,
  now: number,
): { ok: true; sessionId: string } | { ok: false; code: TurnCredReject } {
  const sep = cred.username.lastIndexOf(':');
  if (sep < 0) return { ok: false, code: 'E_TURN_CREDENTIAL_INVALID' };
  const sessionId = cred.username.slice(0, sep);
  const expiresAt = Number.parseInt(cred.username.slice(sep + 1), 10);
  if (!Number.isFinite(expiresAt)) return { ok: false, code: 'E_TURN_CREDENTIAL_INVALID' };
  if (now >= expiresAt) return { ok: false, code: 'E_TURN_CREDENTIAL_EXPIRED' };
  const digest = blake256('turn-cred/1', Buffer.from(sessionId, 'utf8'), peerKey, be64(expiresAt));
  let tag: Buffer;
  try {
    tag = Buffer.from(cred.password, 'hex');
  } catch {
    return { ok: false, code: 'E_TURN_CREDENTIAL_INVALID' };
  }
  if (tag.length !== sodium.crypto_auth_BYTES) return { ok: false, code: 'E_TURN_CREDENTIAL_INVALID' };
  if (!sodium.crypto_auth_verify(tag, digest, turnAuthKey(hostTurnSecret))) {
    return { ok: false, code: 'E_TURN_CREDENTIAL_INVALID' };
  }
  return { ok: true, sessionId };
}

// ─── Controles TURN do host: alocação, refresh, permissão, tela recusada ─────

export type AllocKind = 'voice' | 'screen';
export type AllocResult =
  | { ok: true; allocId: string; expiresAt: number }
  | { ok: false; code: 'E_TURN_SCREEN_REFUSED' | 'E_ALLOC_LIMIT' | 'E_ALLOC_GONE' };

interface Alloc {
  allocId: string;
  kind: AllocKind;
  expiresAt: number;
}

export class TurnHostControls {
  readonly #allocs = new Map<string, Map<string, Alloc>>(); // memberKeyHex → allocs
  readonly #ttlMs: number;
  readonly #maxPerMember: number;

  constructor(opts: { ttlMs?: number; maxPerMember?: number } = {}) {
    this.#ttlMs = opts.ttlMs ?? TURN_ALLOC_TTL_MS_DEFAULT;
    this.#maxPerMember = opts.maxPerMember ?? TURN_ALLOC_PER_MEMBER;
  }

  allocate(memberKeyHex: string, kind: AllocKind, now: number): AllocResult {
    // §17.3: tela via TURN é recusada no v1
    if (kind === 'screen') return { ok: false, code: 'E_TURN_SCREEN_REFUSED' };
    let set = this.#allocs.get(memberKeyHex);
    if (set === undefined) {
      set = new Map();
      this.#allocs.set(memberKeyHex, set);
    }
    for (const [id, a] of set) if (a.expiresAt <= now) set.delete(id);
    if (set.size >= this.#maxPerMember) return { ok: false, code: 'E_ALLOC_LIMIT' };
    const allocId = crypto.randomBytes(16).toString('hex');
    const expiresAt = now + this.#ttlMs;
    set.set(allocId, { allocId, kind, expiresAt });
    return { ok: true, allocId, expiresAt };
  }

  refresh(memberKeyHex: string, allocId: string, now: number): AllocResult {
    const a = this.#allocs.get(memberKeyHex)?.get(allocId);
    if (a === undefined || a.expiresAt <= now) return { ok: false, code: 'E_ALLOC_GONE' };
    a.expiresAt = now + this.#ttlMs; // renovável enquanto a sessão viver
    return { ok: true, allocId, expiresAt: a.expiresAt };
  }

  /** Permissões só para endereços de pares presentes no roster da sessão (§17.3). */
  permission(addr: string, rosterAddresses: ReadonlySet<string>): { ok: true } | { ok: false; code: 'E_NOT_IN_ROSTER' } {
    return rosterAddresses.has(addr) ? { ok: true } : { ok: false, code: 'E_NOT_IN_ROSTER' };
  }

  sweep(now: number): number {
    let n = 0;
    for (const [member, set] of this.#allocs) {
      for (const [id, a] of set) {
        if (a.expiresAt <= now) {
          set.delete(id);
          n++;
        }
      }
      if (set.size === 0) this.#allocs.delete(member);
    }
    return n;
  }

  activeCount(memberKeyHex: string): number {
    return this.#allocs.get(memberKeyHex)?.size ?? 0;
  }
}
