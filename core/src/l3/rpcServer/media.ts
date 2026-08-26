// Lado host dos métodos de mídia de §16.2 — L3, transporte e tradução de erro (§4).
//
// Uma instância de `RpcServer` é **uma conexão**. É a conexão que autentica o par, e por
// isso `peerKeyHex` é fechado no registro e nunca lido do corpo do pedido: um membro não
// pode se declarar outro. Nada aqui decide — quem decide é `voiceCoordinator`/`shareStar`
// (§17.4/§17.5), e o que sobe é `{code}` do catálogo de §20.2 (§3.4).
//
// A tabela de §16.2 é fechada: `RpcServer.register` recusa método fora dela.
//
// **Codec duplicado, com teste de paridade.** O cliente (`ipcRenderer/media.ts`) tem a mesma
// forma de fio. §4 não declara importação lateral entre módulos de L3 e a barreira quebra o
// build — é a mesma razão pela qual `rpcServer` e `rpcClient` duplicam a tabela de protocolo
// (§29.1). O teste impede as duas cópias de divergirem.

import type { ShareHostSessions, ShareQuality } from '../../l2/shareStar/index.ts';
import { isShareQuality } from '../../l2/shareStar/index.ts';
import type { IceServer, MediaTicket, RosterEntry, VoiceHostSessions, VoiceStatePort } from '../../l2/voiceCoordinator/index.ts';
import type { TurnCredential } from '../../l2/communityHost/stunTurn.ts';
import type { RpcServer } from './index.ts';

type WireTicket = {
  sessionId: string;
  channelId: string;
  peerA: string;
  peerB: string;
  expiresAt: number;
  sig: string;
};

type VoiceJoinWire = {
  sessionId: string;
  channelId: string;
  roster: readonly RosterEntry[];
  iceServers: readonly IceServer[];
  tickets: readonly MediaTicket[];
  turnCredential: TurnCredential;
};

/** Forma canônica do fio (cópia servidora; a paridade com o cliente é testada). */
export const mediaWireServer = {
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
  encodeVoiceJoin(r: VoiceJoinWire): Record<string, unknown> {
    return {
      sessionId: r.sessionId,
      channelId: r.channelId,
      roster: r.roster,
      iceServers: r.iceServers,
      tickets: r.tickets.map((t) => mediaWireServer.encodeTicket(t)),
      turnCredential: r.turnCredential,
    };
  },
};

/**
 * Entrega de sinalização ao par de destino (§16.2 `voiceSignal`, §17.4).
 *
 * O host **encaminha**: antes do ICE fechar não existe canal direto entre os dois membros, e
 * §17.4 passo 3 exige que quem recebe veja um ticket válido para o par. Quem tem conexão com
 * os dois é o host, que já é par da comunidade (§17.2). Esta porta é a saída para a conexão
 * do destinatário — o `rpcServer` não a implementa porque quem conhece as conexões vivas é
 * quem monta o grafo (§4).
 */
export interface SignalDeliveryPort {
  deliver(a: {
    readonly sessionId: string;
    readonly fromPeerKey: string;
    readonly toPeerKey: string;
    readonly ticketId: string;
    readonly sdp?: string;
    readonly ice?: string;
  }): { readonly ok: true } | { readonly ok: false; readonly code: string };
}

export type HostMediaDeps = {
  /** Chave pública hex do par **desta conexão**. Nunca vem do corpo do pedido. */
  readonly peerKeyHex: string;
  /** Recorte estrutural do DS corrente da comunidade servida por esta conexão. */
  stateFor(): VoiceStatePort | null;
  readonly voice: VoiceHostSessions;
  readonly share: ShareHostSessions;
  /**
   * §16.2 `shareReport` (emenda de 2026-08-25) — destino das amostras que o apresentador
   * mediu. Ausente, o método responde `{}` e a amostra morre aqui: relatar saúde nunca
   * pode derrubar a sessão de quem está apresentando.
   */
  readonly shareHealth?: { ingest(sample: { sessionId: string; viewerKeyHex: string; rttMs: number; lossPct: number }): void };
  /** Ausente = esta composição ainda não encaminha sinalização (§16.2 `voiceSignal`). */
  readonly signal?: SignalDeliveryPort;
};

function json(v: unknown): Uint8Array {
  return new Uint8Array(Buffer.from(JSON.stringify(v), 'utf8'));
}

function body(raw: Uint8Array): Record<string, unknown> {
  const text = Buffer.from(raw).toString('utf8');
  if (text.length === 0) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(a: Record<string, unknown>, key: string): string {
  const v = a[key];
  return typeof v === 'string' ? v : '';
}

/** Registra em `server` os métodos de mídia de §16.2 que este host serve. */
export function registerHostMediaMethods(server: RpcServer, deps: HostMediaDeps): void {
  server.register('voiceJoin', (raw) => {
    const state = deps.stateFor();
    if (state === null) return { code: 'E_NOT_FOUND' };
    const r = deps.voice.join({ state, channelId: str(body(raw), 'channelId'), memberKeyHex: deps.peerKeyHex });
    return r.ok ? json(mediaWireServer.encodeVoiceJoin(r)) : { code: r.code };
  });

  server.register('voiceLeave', (raw) => {
    const r = deps.voice.leave({ sessionId: str(body(raw), 'sessionId'), memberKeyHex: deps.peerKeyHex });
    return r.ok ? json({}) : { code: r.code };
  });

  server.register('voiceState', (raw) => {
    const session = deps.voice.currentSessionOf(deps.peerKeyHex);
    if (session === null) return { code: 'E_SESSION_GONE' };
    const a = body(raw);
    const patch: Record<string, boolean> = {};
    for (const key of ['muted', 'deafened', 'cameraOn', 'speaking']) {
      if (typeof a[key] === 'boolean') patch[key] = a[key];
    }
    const r = deps.voice.setSelf({ sessionId: session.sessionId, memberKeyHex: deps.peerKeyHex, patch });
    return r.ok ? json({}) : { code: r.code };
  });

  server.register('voiceTicket', (raw) => {
    const state = deps.stateFor();
    if (state === null) return { code: 'E_TICKET_DENIED' };
    const a = body(raw);
    const r = deps.voice.renewTicket({
      state,
      sessionId: str(a, 'sessionId'),
      memberKeyHex: deps.peerKeyHex,
      peerKeyHex: str(a, 'peerKey'),
    });
    return r.ok
      ? json({ ticketId: r.ticketId, ticket: mediaWireServer.encodeTicket(r.ticket), expiresAt: r.expiresAt })
      : { code: r.code };
  });

  server.register('voiceMute', (raw) => {
    const state = deps.stateFor();
    if (state === null) return { code: 'E_NOT_FOUND' };
    const a = body(raw);
    if (typeof a['muted'] !== 'boolean') return { code: 'E_VALIDATION' };
    const r = deps.voice.muteParticipant({
      state,
      sessionId: str(a, 'sessionId'),
      actorKeyHex: deps.peerKeyHex,
      targetKeyHex: str(a, 'targetKey'),
      muted: a['muted'],
    });
    return r.ok ? json({}) : { code: r.code };
  });

  server.register('voiceSignal', (raw) => {
    // §17.4 — o host encaminha; ele não lê SDP nem decide nada sobre a mídia. Sem porta de
    // entrega composta, a sinalização não chegou: `E_PEER_UNREACHABLE` é o que §15.4 nomeia.
    if (deps.signal === undefined) return { code: 'E_PEER_UNREACHABLE' };
    const session = deps.voice.currentSessionOf(deps.peerKeyHex);
    if (session === null) return { code: 'E_SESSION_GONE' };
    const a = body(raw);
    const sdp = a['sdp'];
    const ice = a['ice'];
    const r = deps.signal.deliver({
      sessionId: session.sessionId,
      fromPeerKey: deps.peerKeyHex,
      toPeerKey: str(a, 'toPeerKey'),
      ticketId: str(a, 'ticketId'),
      ...(typeof sdp === 'string' ? { sdp } : {}),
      ...(typeof ice === 'string' ? { ice } : {}),
    });
    return r.ok ? json({}) : { code: r.code };
  });

  server.register('shareStart', (raw) => {
    const state = deps.stateFor();
    if (state === null) return { code: 'E_NOT_FOUND' };
    const a = body(raw);
    const quality: unknown = a['quality'];
    const r = deps.share.start({
      state,
      channelId: str(a, 'channelId'),
      presenterKeyHex: deps.peerKeyHex,
      ...(isShareQuality(quality) ? { quality: quality as ShareQuality } : {}),
    });
    // §16.2 declara `{sessionId}`: o `captureToken` de §15.4 é cunhado no núcleo do
    // apresentador e não trafega (§17.4 emendado).
    return r.ok ? json({ sessionId: r.sessionId }) : { code: r.code };
  });

  server.register('shareJoin', (raw) => {
    const r = deps.share.join({ sessionId: str(body(raw), 'sessionId'), memberKeyHex: deps.peerKeyHex });
    return r.ok ? json({ ticketId: r.ticketId, presenterKey: r.presenterKeyHex }) : { code: r.code };
  });

  server.register('shareLeave', (raw) => {
    const r = deps.share.leave({ sessionId: str(body(raw), 'sessionId'), memberKeyHex: deps.peerKeyHex });
    return r.ok ? json({}) : { code: r.code };
  });

  /**
   * §16.2 `shareReport` — **emenda de 2026-08-25**. A perna de subida do laço de saúde de
   * §17.5: quem mede é o `RTCStatsReport` do apresentador, quem consolida é o host (que é
   * quem guarda o perfil pedido por cada espectador), e o veredito volta por `share.health`
   * (§16.3). Sem ela `share.health` nunca tinha número para carregar.
   *
   * `peerKeyHex` é da CONEXÃO (§16.3 regra 4): só o apresentador daquela sessão relata, e é
   * por isso que a checagem não lê chave nenhuma do corpo.
   */
  server.register('shareReport', (raw) => {
    const a = body(raw);
    const sessionId = str(a, 'sessionId');
    const sessao = deps.share.snapshotOf(sessionId);
    if (sessao === null) return { code: 'E_SESSION_GONE' };
    if (sessao.presenterKeyHex !== deps.peerKeyHex) return { code: 'E_PERMISSION_DENIED' };
    const samples = Array.isArray(a['samples']) ? a['samples'] : [];
    for (const bruta of samples) {
      if (typeof bruta !== 'object' || bruta === null) continue;
      const { viewerKey, rttMs, lossPct } = bruta as Record<string, unknown>;
      if (typeof viewerKey !== 'string' || typeof rttMs !== 'number' || typeof lossPct !== 'number') continue;
      deps.shareHealth?.ingest({ sessionId, viewerKeyHex: viewerKey, rttMs, lossPct });
    }
    return json({});
  });

  server.register('shareQuality', (raw) => {
    const a = body(raw);
    const quality: unknown = a['quality'];
    if (!isShareQuality(quality)) return { code: 'E_VALIDATION' };
    const r = deps.share.setQuality({
      sessionId: str(a, 'sessionId'),
      memberKeyHex: deps.peerKeyHex,
      quality: quality as ShareQuality,
    });
    return r.ok ? json({ applied: r.applied }) : { code: r.code };
  });
}


/**
 * `SignalDeliveryPort` real: encaminha para a conexão do destinatário por §16.3.
 *
 * O registro de conexões vivas é de quem monta o grafo (§4) — aqui entra como uma busca por
 * chave. Sem conexão para o destino, a sinalização **não chegou**, e é isso que
 * `E_PEER_UNREACHABLE` significa em §20.2: não há promessa de entrega diferida.
 */
export function peerSignalRelay(lookup: (peerKeyHex: string) => Pick<RpcServer, 'notify'> | null): SignalDeliveryPort {
  return {
    deliver(a) {
      const destino = lookup(a.toPeerKey);
      if (destino === null) return { ok: false, code: 'E_PEER_UNREACHABLE' };
      // §16.3 regra 4 — a origem é a da conexão de quem enviou, decidida no handler.
      const entregue = destino.notify(
        'voice.signal',
        json({
          peerKey: a.fromPeerKey,
          ticketId: a.ticketId,
          ...(a.sdp !== undefined ? { sdp: a.sdp } : {}),
          ...(a.ice !== undefined ? { ice: a.ice } : {}),
        }),
      );
      return entregue ? { ok: true } : { ok: false, code: 'E_PEER_UNREACHABLE' };
    },
  };
}
