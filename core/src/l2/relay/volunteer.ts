// `relay` — voluntariado TURN (§17.7, A21, L-11/L-14).
//
// O voluntário serve **um TURN restrito**: encaminha DTLS-SRTP que não decifra; vê volume
// e temporização, nunca conteúdo (L-14 — texto de consentimento). Este módulo decide:
// consentimento persistido antes de ligar (`E_CONSENT_REQUIRED`), chave derivada da
// identidade, prova de posse verificada pelo fold (R-19), TTL renovável e cota. O socket
// TURN em si é o `MediaServer` da fase 7 sob estes controles, com a socket real entrando
// pela composição na integração.
//
// §4: dependências `swarm`/`config` — os valores de config (§27.2) e a semente de
// identidade (L0) chegam injetados; a submissão dos ops `relay.volunteer`/
// `relay.withdraw` (kinds 60/61, R-19) sai pela porta `RelaySubmitPort`, que a
// composição liga ao outbox/communityHost. O consentimento persistido
// (`local_relay_consent`, §6.15) entra pela porta `RelayConsentPort`.

import { deriveRelayKeyPair, signPossession } from './keys.ts';
import { RelayQuota, type QuotaRefusal } from './quota.ts';

type KeyHex = string;

// ─── Portas declaradas por este módulo ──────────────────────────────────────────────────

export type RelayConsentDecision = 'accepted' | 'declined';

export interface RelayConsentRecord {
  readonly decision: RelayConsentDecision;
  readonly at: number;
}

/** Persistência do consentimento (`local_relay_consent`, §6.15) — implementada por L0/view. */
export interface RelayConsentPort {
  get(communityId: string): RelayConsentRecord | null;
  set(communityId: string, decision: RelayConsentDecision, opts: { remember: boolean }): void;
  forget(communityId: string): void;
}

export type RelayOpSubmission =
  | {
      readonly kind: 'relay.volunteer';
      readonly communityId: string;
      /** Chave pública derivada (32 B) — a que o fold guarda em R-19. */
      readonly relayPublicKey: Buffer;
      /** `expiresAt ≤ hostTs + RELAY_TTL_MS` (R-19); aqui sempre `now + ttlMs`. */
      readonly expiresAt: number;
      /** Ed25519(identitySk, BLAKE2b('relay-possession/1' ‖ relayPublicKey)). */
      readonly possession: Buffer;
    }
  | { readonly kind: 'relay.withdraw'; readonly communityId: string };

/** Submissão do op ao log da comunidade — ligada ao outbox pela composição. */
export interface RelaySubmitPort {
  /** Devolve o seq local atribuído ao envio (o mesmo devolvido no RPC). */
  submit(submission: RelayOpSubmission): number;
}

// ─── Eventos (§RPC eventos, §17.7) ──────────────────────────────────────────────────────

export interface RelayConsentRequested {
  readonly communityId: string;
  /** `missing`: nunca perguntado · `declined`: recusado antes — a UI pergunta de novo. */
  readonly reason: 'missing' | 'declined';
}

export interface RelayStateChanged {
  readonly communityId: string;
  readonly enabled: boolean;
  readonly expiresAt: number | null;
  readonly bytesRelayed: number;
}

// ─── Estado e classe ────────────────────────────────────────────────────────────────────

type VolunteerStatus = 'active' | 'expired' | 'suspended';

interface Runtime {
  readonly publicKey: Buffer;
  readonly secretKey: Buffer;
  expiresAt: number;
  status: VolunteerStatus;
  quota: RelayQuota;
  lastSeq: number;
}

export type EnableOk = {
  readonly ok: true;
  readonly relayPublicKey: Buffer;
  readonly seq: number;
  readonly expiresAt: number;
};

/**
 * Voluntariado de relay por comunidade. Uma instância serve todas as comunidades
 * participadas: cada uma tem chave derivada própria, cota própria e ciclo próprio.
 * Estado efêmero; a autoridade do log é o `DecisionState` (relays, R-19).
 */
export class RelayVolunteer {
  readonly #identitySeed: Buffer;
  readonly #identitySecretKey: Buffer;
  readonly #consent: RelayConsentPort;
  readonly #submit: RelaySubmitPort;
  readonly #clock: { now(): number };
  readonly #ttlMs: number;
  readonly #maxBytesPerDay: number;
  readonly #maxAllocs: number;
  readonly #onConsentRequested: (event: RelayConsentRequested) => void;
  readonly #onStateChanged: (event: RelayStateChanged) => void;
  readonly #runtimes = new Map<string, Runtime>(); // communityId → runtime

  constructor(opts: {
    identitySeed: Buffer;
    identitySecretKey: Buffer;
    consent: RelayConsentPort;
    submit: RelaySubmitPort;
    clock?: { now(): number };
    /** Composição injeta `RELAY_TTL_MS` (§27.1). */
    ttlMs: number;
    /** Composição injeta os defaults de §27.2 resolvidos na config L0. */
    maxBytesPerDay: number;
    maxAllocs: number;
    onConsentRequested?: (event: RelayConsentRequested) => void;
    onStateChanged?: (event: RelayStateChanged) => void;
  }) {
    this.#identitySeed = opts.identitySeed;
    this.#identitySecretKey = opts.identitySecretKey;
    this.#consent = opts.consent;
    this.#submit = opts.submit;
    this.#clock = opts.clock ?? { now: () => Date.now() };
    this.#ttlMs = opts.ttlMs;
    this.#maxBytesPerDay = opts.maxBytesPerDay;
    this.#maxAllocs = opts.maxAllocs;
    this.#onConsentRequested =
      opts.onConsentRequested ??
      (() => {});
    this.#onStateChanged = opts.onStateChanged ?? (() => {});
  }

  /** Consentimento aceito e persistido é pré-condição de ligar (§17.7). */
  enable(args: { communityId: string }): EnableOk | { ok: false; code: 'E_CONSENT_REQUIRED' } {
    const now = this.#clock.now();
    const record = this.#consent.get(args.communityId);
    if (record === undefined || record === null || record.decision !== 'accepted') {
      this.#onConsentRequested({ communityId: args.communityId, reason: record === null || record === undefined ? 'missing' : 'declined' });
      return { ok: false, code: 'E_CONSENT_REQUIRED' };
    }

    const keys = deriveRelayKeyPair(this.#identitySeed, args.communityId);
    const expiresAt = now + this.#ttlMs;
    const possession = signPossession(this.#identitySecretKey, keys.publicKey);
    const seq = this.#submit.submit({
      kind: 'relay.volunteer',
      communityId: args.communityId,
      relayPublicKey: keys.publicKey,
      expiresAt,
      possession,
    });

    const previous = this.#runtimes.get(args.communityId);
    const quota = previous?.quota ?? new RelayQuota({ maxBytesPerDay: this.#maxBytesPerDay, maxAllocs: this.#maxAllocs });
    // renovar limpa suspensão por bytes? Não: a cota é do recurso local, independe do TTL.
    this.#runtimes.set(args.communityId, {
      publicKey: keys.publicKey,
      secretKey: keys.secretKey,
      expiresAt,
      status: quota.suspended === null ? 'active' : 'suspended',
      quota,
      lastSeq: seq,
    });
    this.#emitState(args.communityId);
    return { ok: true, relayPublicKey: keys.publicKey, seq, expiresAt };
  }

  /**
   * `relay.disable`: submete `relay.withdraw` (kind 61) e para de servir. Sem
   * voluntariado ativo é no-op nomeado — o RPC não cataloga erro para disable.
   */
  disable(args: { communityId: string }): { ok: true; seq: number | null } {
    const runtime = this.#runtimes.get(args.communityId);
    if (runtime === undefined) return { ok: true, seq: null };
    const seq = this.#submit.submit({ kind: 'relay.withdraw', communityId: args.communityId });
    this.#runtimes.delete(args.communityId);
    this.#emitState(args.communityId);
    return { ok: true, seq };
  }

  /**
   * Renovação: mesmo caminho do `enable` (consentimento persistido continua válido),
   * com material fresco — novo `expiresAt` e nova posse. O fold sobrescreve a entrada.
   */
  renew(args: { communityId: string }): EnableOk | { ok: false; code: 'E_CONSENT_REQUIRED' } {
    return this.enable(args);
  }

  /** Expirou → não listado (§17.7). Chamado pela composição em cadência. */
  sweep(now: number = this.#clock.now()): readonly string[] {
    const expired: string[] = [];
    for (const [communityId, runtime] of [...this.#runtimes]) {
      if (runtime.status !== 'expired' && now >= runtime.expiresAt) {
        runtime.status = 'expired';
        expired.push(communityId);
        this.#emitState(communityId);
      }
    }
    return expired;
  }

  // ─── Decisões do TURN restrito (a composição consulta ao servir) ────────────────────

  /** Admissão de um par no TURN do voluntário. */
  tryAllocate(communityId: string, peerKeyHex: KeyHex, now: number = this.#clock.now()): { ok: true } | { ok: false; reason: QuotaRefusal | 'not-active' } {
    const runtime = this.#runtimes.get(communityId);
    if (runtime === undefined || runtime.status === 'expired') return { ok: false, reason: 'not-active' };
    const decision = runtime.quota.tryAllocate(peerKeyHex, now);
    // a janela pode ter rolado desde a suspensão: a quota limpa a própria marca
    if (runtime.status === 'suspended' && runtime.quota.suspended === null) runtime.status = 'active';
    return decision;
  }

  releaseAllocation(communityId: string, peerKeyHex: KeyHex): void {
    this.#runtimes.get(communityId)?.quota.release(peerKeyHex);
  }

  /** Bytes retransmitidos no turno do voluntário; pode suspender (emite stateChanged). */
  recordRelayBytes(communityId: string, bytes: number, now: number = this.#clock.now()): void {
    const runtime = this.#runtimes.get(communityId);
    if (runtime === undefined || runtime.status === 'expired') return;
    const before = runtime.quota.suspended;
    runtime.quota.recordBytes(bytes, now);
    if (before === null && runtime.quota.suspended !== null && runtime.status === 'active') {
      runtime.status = 'suspended';
      this.#emitState(communityId);
    }
  }

  /** Snapshot para query/UI — `null` quando a comunidade não voluntaria. */
  status(communityId: string, now: number = this.#clock.now()):
    | {
        readonly status: VolunteerStatus;
        readonly relayPublicKeyHex: string;
        readonly expiresAt: number;
        readonly bytesInWindow: number;
        readonly activeAllocs: number;
        readonly suspendedReason: QuotaRefusal | null;
      }
    | null {
    const runtime = this.#runtimes.get(communityId);
    if (runtime === undefined) return null;
    return {
      status: runtime.status,
      relayPublicKeyHex: runtime.publicKey.toString('hex'),
      expiresAt: runtime.expiresAt,
      bytesInWindow: runtime.quota.bytesInWindow(now),
      activeAllocs: runtime.quota.activeAllocs,
      suspendedReason: runtime.quota.suspended,
    };
  }

  #runtimeServing(communityId: string): Runtime | undefined {
    const runtime = this.#runtimes.get(communityId);
    if (runtime === undefined) return undefined;
    return runtime.status === 'active' ? runtime : undefined;
  }

  #emitState(communityId: string): void {
    const runtime = this.#runtimes.get(communityId);
    this.#onStateChanged({
      communityId,
      enabled: runtime !== undefined && runtime.status !== 'expired',
      expiresAt: runtime?.expiresAt ?? null,
      bytesRelayed: runtime?.quota.bytesInWindow(this.#clock.now()) ?? 0,
    });
  }
}
