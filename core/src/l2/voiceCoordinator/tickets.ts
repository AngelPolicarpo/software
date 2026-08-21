// `voiceCoordinator` — L2. Roster de voz, tickets de sessão e revogação (§17.4, A22).
//
// §4: "Roster de voz, **tickets de sessão**, revogação (§17.4) | communityHost/Client,
// permissions | Ver mídia". O núcleo nunca vê mídia: o ticket autoriza SINALIZAÇÃO
// (SDP/ICE) e DTLS entre dois pares; a mídia é WebRTC ponta a ponta no renderer.
//
// O ticket é Ed25519(hostKey, BLAKE2b('media-ticket/1' ‖ sessionId ‖ channelId ‖ peerA ‖
// peerB ‖ expiresAt)) com `MEDIA_TICKET_TTL_MS` (§27.1) — constante aplicada aqui, mas que
// mora no `fold` (§27.1) e chega por injeção: §4 não declara `fold` nas dependências deste
// módulo. Erros na fronteira usam só o catálogo de §20.2 (`E_TICKET_INVALID`).
//
// Revogação (§17.4): `mod.ban`, `mod.kick`, `mod.timeout`, `channel.delete` e `voice.leave`
// fazem o host emitir `voice.revoked{targetKey, sessionId}`; ao receber, cada cliente é
// **obrigado** a fechar imediatamente as conexões com aquela chave e a parar de renovar.
// No pior caso (evento suprimido), a sessão morre por expiração do ticket em ≤ TTL.

import sodium from 'sodium-native';

// ─── Ticket de mídia — codec (A22, §17.4) ───────────────────────────────────────────────

export interface MediaTicketInput {
  readonly sessionId: string;
  readonly channelId: string;
  /** Chave Ed25519 de um par (32 B). */
  readonly peerA: Buffer;
  /** Chave Ed25519 do outro par (32 B). */
  readonly peerB: Buffer;
  readonly expiresAt: number;
}

export interface MediaTicket extends MediaTicketInput {
  /** Ed25519 de 64 B sobre BLAKE2b-256 da mensagem. */
  readonly sig: Buffer;
}

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

/**
 * Mensagem assinada. Codificações não fixadas pelo texto normativo, declaradas aqui:
 * strings em UTF-8 sem prefixo de comprimento (campos separados pelo domínio BLAKE2b),
 * `expiresAt` como uint64 big-endian de 8 B.
 */
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

/** Ordem canônica do par: os dois lados constroem e verificam a mesma mensagem. */
export function orderedPair(localPeer: Buffer, remotePeer: Buffer): { peerA: Buffer; peerB: Buffer } {
  return localPeer.compare(remotePeer) <= 0
    ? { peerA: localPeer, peerB: remotePeer }
    : { peerA: remotePeer, peerB: localPeer };
}

export function issueMediaTicket(hostSecretKey: Buffer, input: MediaTicketInput): MediaTicket {
  const sig = Buffer.alloc(sodium.crypto_sign_BYTES);
  sodium.crypto_sign_detached(sig, mediaTicketMessage(input), hostSecretKey);
  return { ...input, sig };
}

export type VerifyMediaTicketResult = { readonly ok: true } | { readonly ok: false; readonly code: 'E_TICKET_INVALID' };

/**
 * Verificação completa (lado cliente, §17.4 passo 3): escopo de sessão/canal, par
 * (qualquer ordem), assinatura e validade temporal contra o relógio injetado.
 */
export function verifyMediaTicket(
  hostPublicKey: Buffer,
  ticket: MediaTicket,
  expected: { sessionId: string; channelId: string; localPeer: Buffer; remotePeer: Buffer },
  now: number,
): VerifyMediaTicketResult {
  if (
    ticket.sessionId !== expected.sessionId ||
    ticket.channelId !== expected.channelId ||
    ticket.sig.length !== sodium.crypto_sign_BYTES ||
    ticket.peerA.length !== 32 ||
    ticket.peerB.length !== 32 ||
    expected.localPeer.length !== 32 ||
    expected.remotePeer.length !== 32 ||
    !Number.isInteger(ticket.expiresAt)
  ) {
    return { ok: false, code: 'E_TICKET_INVALID' };
  }
  const pairMatches =
    (ticket.peerA.equals(expected.localPeer) && ticket.peerB.equals(expected.remotePeer)) ||
    (ticket.peerA.equals(expected.remotePeer) && ticket.peerB.equals(expected.localPeer));
  if (!pairMatches) return { ok: false, code: 'E_TICKET_INVALID' };
  if (!sodium.crypto_sign_verify_detached(ticket.sig, mediaTicketMessage(ticket), hostPublicKey)) {
    return { ok: false, code: 'E_TICKET_INVALID' };
  }
  if (now >= ticket.expiresAt) return { ok: false, code: 'E_TICKET_INVALID' };
  return { ok: true };
}

/** Ticket de um participante para um par do roster (§17.4 passo 2, um por par). */
export function issueSessionTicket(
  hostSecretKey: Buffer,
  args: { sessionId: string; channelId: string; selfKey: Buffer; otherKey: Buffer; now: number; ttlMs: number },
): MediaTicket {
  const pair = orderedPair(args.selfKey, args.otherKey);
  return issueMediaTicket(hostSecretKey, {
    sessionId: args.sessionId,
    channelId: args.channelId,
    ...pair,
    expiresAt: args.now + args.ttlMs,
  });
}

// ─── Aplicação client-side dos tickets e da revogação ───────────────────────────────────

export type CloseOrder = {
  readonly sessionId: string;
  readonly remotePeerHex: string;
};

interface StoredTicket {
  readonly channelId: string;
  expiresAt: number;
}

export type AcceptSignalingResult = { readonly ok: true } | { readonly ok: false; readonly code: 'E_TICKET_INVALID' };

/**
 * Estado do cliente sobre quem pode sinalizar/iniciar DTLS (§17.4 passos 3–4):
 * só pares com ticket válido para `(sessionId, esteParDeChaves)`. `revoke` aplica o
 * fechamento obrigatório de `voice.revoked` e recusa a sessão enquanto a marcação
 * viver — no pior caso (evento suprimido e sem nova informação de roster), por
 * `MEDIA_TICKET_TTL_MS`, que é o próprio teto de sobrevivência do ticket (§17.4).
 */
export class VoiceTicketManager {
  readonly #clock: { now(): number };
  readonly #hostPublicKey: Buffer;
  readonly #localPeer: Buffer;
  readonly #revocationTtlMs: number;
  readonly #tickets = new Map<string, Map<string, StoredTicket>>(); // sessionId → remotePeerHex → ticket
  readonly #revoked = new Map<string, number>(); // `${sessionId}:${remotePeerHex}` → revokedAt

  constructor(opts: {
    hostPublicKey: Buffer;
    localPeer: Buffer;
    clock?: { now(): number };
    /** Composição injeta `MEDIA_TICKET_TTL_MS` (§27.1). */
    revocationTtlMs: number;
  }) {
    this.#hostPublicKey = opts.hostPublicKey;
    this.#localPeer = opts.localPeer;
    this.#clock = opts.clock ?? { now: () => Date.now() };
    this.#revocationTtlMs = opts.revocationTtlMs;
  }

  #revocationLive(sessionId: string, hex: string, now: number): boolean {
    const at = this.#revoked.get(`${sessionId}:${hex}`);
    return at !== undefined && now - at < this.#revocationTtlMs;
  }

  /**
   * Passo 3 de §17.4: sinalização só de par que apresente ticket válido para esta sessão
   * e este par de chaves. Sem ticket → `E_TICKET_INVALID`, conexão recusada.
   */
  acceptSignaling(args: { sessionId: string; channelId: string; remotePeer: Buffer; ticket: MediaTicket }): AcceptSignalingResult {
    const now = this.#clock.now();
    const hex = args.remotePeer.toString('hex');
    if (this.#revocationLive(args.sessionId, hex, now)) return { ok: false, code: 'E_TICKET_INVALID' };
    const result = verifyMediaTicket(
      this.#hostPublicKey,
      args.ticket,
      {
        sessionId: args.sessionId,
        channelId: args.channelId,
        localPeer: this.#localPeer,
        remotePeer: args.remotePeer,
      },
      now,
    );
    if (!result.ok) return result;
    let bySession = this.#tickets.get(args.sessionId);
    if (bySession === undefined) {
      bySession = new Map();
      this.#tickets.set(args.sessionId, bySession);
    }
    bySession.set(hex, { channelId: args.channelId, expiresAt: args.ticket.expiresAt });
    return { ok: true };
  }

  /**
   * Renovação por `media.ticketRenew` (§26.2): mesma verificação do aceite, atualiza a
   * validade armazenada. Par revogado não renova.
   */
  renew(args: { sessionId: string; channelId: string; remotePeer: Buffer; ticket: MediaTicket }): AcceptSignalingResult {
    return this.acceptSignaling(args);
  }

  /**
   * Passo 4 de §17.4: DTLS só com par que passou pela verificação e ainda está válido.
   */
  canInitiateDtls(sessionId: string, remotePeer: Buffer): boolean {
    const hex = remotePeer.toString('hex');
    const entry = this.#tickets.get(sessionId)?.get(hex);
    if (entry === undefined) return false;
    if (this.#revocationLive(sessionId, hex, this.#clock.now())) return false;
    if (this.#clock.now() >= entry.expiresAt) return false;
    return true;
  }

  /**
   * `voice.revoked{targetKey, sessionId}` recebido: fechamento imediato obrigatório.
   * Devolve a lista de conexões a fechar agora; a sessão fica recusada enquanto a
   * marcação viver, e a renovação cessa (o pior caso sem evento é a expiração do
   * ticket, §17.4).
   */
  revoke(targetKey: Buffer, sessionId: string): CloseOrder[] {
    const hex = targetKey.toString('hex');
    const key = `${sessionId}:${hex}`;
    if (this.#revoked.has(key)) return [];
    this.#revoked.set(key, this.#clock.now());
    this.#tickets.get(sessionId)?.delete(hex);
    // Só há conexão aberta se o par tinha passado pela verificação; a ordem vale para
    // qualquer caso — fechar conexão inexistente é operação nula no cliente.
    return [{ sessionId, remotePeerHex: hex }];
  }

  /**
   * A revogação caduca com o ticket que ela invalida (`revocationTtlMs`), e o roster
   * autoritativo pode destravar antes: par que voltou a aparecer na sessão emite novo
   * ticket do host, que passa a ser aceito novamente.
   */
  clearRevocation(sessionId: string, remotePeer: Buffer): void {
    this.#revoked.delete(`${sessionId}:${remotePeer.toString('hex')}`);
  }

  /** Sessão inteira encerrada (ex.: `voice.leave` próprio ou fim da chamada). */
  dropSession(sessionId: string): void {
    this.#tickets.delete(sessionId);
    for (const key of [...this.#revoked.keys()]) if (key.startsWith(`${sessionId}:`)) this.#revoked.delete(key);
  }

  /** Limpeza de entradas expiradas; devolve quantas removeu. */
  sweep(now = this.#clock.now()): number {
    let n = 0;
    for (const [sessionId, bySession] of [...this.#tickets]) {
      for (const [hex, entry] of [...bySession]) {
        if (now >= entry.expiresAt) {
          bySession.delete(hex);
          n++;
        }
      }
      if (bySession.size === 0) this.#tickets.delete(sessionId);
    }
    return n;
  }

  ticketExpiry(sessionId: string, remotePeer: Buffer): number | null {
    return this.#tickets.get(sessionId)?.get(remotePeer.toString('hex'))?.expiresAt ?? null;
  }
}
