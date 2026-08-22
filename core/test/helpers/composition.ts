// Cabo de composição da fase de integração — quem "monta o grafo" de §4 ("quem monta o
// grafo injeta a implementação no boot") nesta fase é o teste; em produto, o boot do
// utilityProcess. NÃO é código de produto: mora em `test/` porque só existe para exercitar
// as juntas entre os módulos reais — RPC (§16), IPC-R (§15.4), portas de L2 e sondas.
//
// Padrão das fases anteriores: decisões dos módulos reais, transporte simulado.

import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sodium from 'sodium-native';

import {
  KINDS,
  PAYLOAD_LAYOUT,
  decodeEnvelope,
  decodeHostRecord,
  decodeOp,
  decodePayload,
  encodeEnvelope,
  encodeHostRecord,
  encodeOp,
  encodePayload,
  hostRecordSigningHash,
  opSigningHash,
  type KindName,
  type PayloadOf,
} from '../../src/l1/opCodec/index.ts';
import { MAX_REACTION_EMOJIS, QUOTA_BYTES_PER_WINDOW, QUOTA_OPS_PER_WINDOW, QUOTA_WINDOW_SEQS } from '../../src/l1/fold/constants.ts';
import { entityId, opId } from '../../src/l1/idgen/index.ts';
import type { DecisionState } from '../../src/l1/fold/index.ts';
import { PERMISSION_BY_NUMBER } from '../../src/l1/permissions/index.ts';
import { createCore, type CoreHandle, type WritableCoreHandle } from '../../src/l0/corestore/index.ts';
import type { ManifestDb } from '../../src/l0/manifest/index.ts';
import { computeHandle } from '../../src/l0/identity/index.ts';
import { HostAdmission } from '../../src/l2/communityHost/index.ts';
import type {
  CommunityClient,
  ReplicationInfo,
  SignedOpCodecPort,
  SubmissionLimits,
  HostSubmitPort,
} from '../../src/l2/communityClient/index.ts';
import { MEMBER_LEAVE_KIND } from '../../src/l2/communityClient/index.ts';
import { Outbox } from '../../src/l2/outbox/index.ts';
import type { Projector } from '../../src/l1/projector/index.ts';
import {
  dispositionFor,
  type CreateContinuationCorePort,
  type LayerBRefusal,
  type OriginFacts,
  type SubmitSyncPort,
} from '../../src/l2/succession/index.ts';
import {
  MediaServer,
  BINDING_SUCCESS,
  decode,
  encodeBindingRequest,
  randomTxId,
  type MediaAddr,
  type MediaSocketPort,
} from '../../src/l2/communityHost/stunTurn.ts';
import type { DiagnosticsMetricsPort, MetricsSnapshot, NatType } from '../../src/l2/diagnostics/index.ts';
import type { RelayConsentPort } from '../../src/l2/relay/index.ts';
import type { SubmitPort, SubmitResult } from '../../src/l2/outbox/index.ts';
import type { Swarm } from '../../src/l0/swarm/index.ts';
import type { VoiceHostSessions, VoiceStatePort } from '../../src/l2/voiceCoordinator/index.ts';
import type { ShareHostSessions } from '../../src/l2/shareStar/index.ts';
import { registerHostMediaMethods, type SignalDeliveryPort } from '../../src/l3/rpcServer/media.ts';
import { kindFromFilename, type BlobManager, type StageResult } from '../../src/l2/blobs/index.ts';
import type { AttachmentSurfaceDeps, StagedAttachment } from '../../src/l3/ipcRenderer/commands.ts';
import { RpcClient } from '../../src/l3/rpcClient/index.ts';
import { RpcServer, type RpcTransportPort } from '../../src/l3/rpcServer/index.ts';
import { sign } from './world.ts';

// ─── Transporte RPC em memória (§16.1 — protomux-rpc chega na integração L3 real) ──────

export class MemoryRpcChannel implements RpcTransportPort {
  #other: MemoryRpcChannel | null = null;
  #frameListeners = new Set<(frame: Uint8Array) => void>();
  #downListeners = new Set<() => void>();

  static createPair(): [MemoryRpcChannel, MemoryRpcChannel] {
    const a = new MemoryRpcChannel();
    const b = new MemoryRpcChannel();
    a.#other = b;
    b.#other = a;
    return [a, b];
  }

  send(frame: Uint8Array): void {
    const copy = Buffer.from(frame);
    const peer = this.#other as MemoryRpcChannel | null;
    queueMicrotask(() => {
      if (peer === null) return;
      for (const listener of peer.frameListeners()) listener(copy);
    });
  }

  /** Exposto só para o par — encapsulamento de `#frameListeners` entre instâncias. */
  private frameListeners(): Set<(frame: Uint8Array) => void> {
    return this.#frameListeners;
  }

  onFrame(cb: (frame: Uint8Array) => void): void {
    this.#frameListeners.add(cb);
  }

  onDown(cb: () => void): void {
    this.#downListeners.add(cb);
  }

  /** Queda da conexão — só o lado que cai avisa; o par fica mudo até reattach. */
  drop(): void {
    for (const cb of this.#downListeners) cb();
  }
}

/** Par de canais com queda unilateral para testes de reconexão. */
export function rpcPair(): [MemoryRpcChannel, MemoryRpcChannel] {
  return MemoryRpcChannel.createPair();
}

// ─── Host sobre RPC (§16.2: hello, submitOp, submitOps) ─────────────────────────────────

export type HelloInfo = {
  readonly hostVersion: string;
  readonly opVersion: number;
  readonly coreLength: number;
  readonly memberCount: number;
  readonly capabilities: readonly string[];
};

/**
 * Registra os métodos de §16.2 suportados pelo `communityHost` atual sobre um `RpcServer`.
 * `submitOps` segue §11.9: um resultado por envelope, na ordem, sem parar no primeiro erro.
 */
export function wireHostRpc(
  server: RpcServer,
  opts: { admission: Pick<HostAdmission, 'submit'>; hello: HelloInfo },
): void {
  server.register('hello', () =>
    Buffer.from(
      JSON.stringify({
        hostVersion: opts.hello.hostVersion,
        opVersion: opts.hello.opVersion,
        coreLength: opts.hello.coreLength,
        memberCount: opts.hello.memberCount,
        capabilities: opts.hello.capabilities,
      }),
      'utf8',
    ),
  );

  server.register('submitOp', async (body) => {
    const arg = JSON.parse(Buffer.from(body).toString('utf8')) as { envelope: string };
    const result = await opts.admission.submit(new Uint8Array(Buffer.from(arg.envelope, 'base64')));
    if (!result.ok) return { code: result.code };
    return Buffer.from(JSON.stringify({ seq: result.seq, hostTs: result.hostTs }), 'utf8');
  });

  server.register('submitOps', async (body) => {
    const arg = JSON.parse(Buffer.from(body).toString('utf8')) as { envelopes: string[] };
    const out: Array<Record<string, unknown>> = [];
    let infraFailure = false;
    for (const [index, envB64] of arg.envelopes.entries()) {
      if (infraFailure) {
        out.push({ index, ok: false, code: 'E_NOT_ATTEMPTED' });
        continue;
      }
      const result = await opts.admission.submit(new Uint8Array(Buffer.from(envB64, 'base64')));
      if (result.ok) {
        out.push({ index, ok: true, seq: result.seq, hostTs: result.hostTs });
      } else {
        out.push({ index, ok: false, code: result.code });
        // §11.9: só infraestrutura interrompe o lote
        if (result.code === 'E_STORAGE_FULL' || result.code === 'E_BUSY') infraFailure = true;
      }
    }
    return Buffer.from(JSON.stringify(out), 'utf8');
  });
}

/**
 * Lado host dos métodos de mídia de §16.2 — agora **produto**, em `rpcServer/media.ts`.
 * Este atalho mantém a forma que os rigs já usavam.
 */
export function wireHostMediaRpc(
  server: RpcServer,
  opts: {
    readonly peerKeyHex: string;
    readonly stateFor: () => VoiceStatePort | null;
    readonly voice: VoiceHostSessions;
    readonly share: ShareHostSessions;
    readonly signal?: SignalDeliveryPort;
  },
): void {
  registerHostMediaMethods(server, {
    peerKeyHex: opts.peerKeyHex,
    stateFor: opts.stateFor,
    voice: opts.voice,
    share: opts.share,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
}

/** Adaptador da porta de submissão da outbox sobre o `rpcClient` (§4, §11.6). */
export function rpcSubmitPort(client: RpcClient): SubmitPort {
  return async (envelopes) => {
    const body = Buffer.from(
      JSON.stringify({ envelopes: envelopes.map((e) => Buffer.from(e).toString('base64')) }),
      'utf8',
    );
    const result = await client.call('submitOps', new Uint8Array(body));
    if (!result.ok) return null; // indisponível → backoff/circuit breaker da outbox (§11.8)
    const parsed = JSON.parse(Buffer.from(result.body).toString('utf8')) as Array<
      | { index: number; ok: true; seq: number; hostTs: number }
      | { index: number; ok: false; code: string }
      | { index: number; ok: false; code: 'E_NOT_ATTEMPTED' }
    >;
    return parsed.map((item) =>
      item.ok
        ? ({ ok: true, seq: item.seq, hostTs: item.hostTs } satisfies SubmitResult)
        : ({ ok: false, code: item.code } satisfies SubmitResult),
    );
  };
}

// ─── Ponte de submissão assinada (§19.3, §29.2 item 1): portas reais da composição ──────

/**
 * Tetos de §8.6/R-14 usados pela validação advisória da ponte — constantes de protocolo
 * injetadas, a mesma fonte do `fold` (§27.1). A ponte não importa L1; quem compõe sim.
 */
export const SUBMISSION_LIMITS: SubmissionLimits = {
  contentMaxCodePoints: 4000,
  contentMaxBytes: 16_384,
  mentionsMaxItems: 64,
  quotaWindowSeqs: QUOTA_WINDOW_SEQS,
  quotaOpsPerWindow: QUOTA_OPS_PER_WINDOW,
  quotaBytesPerWindow: QUOTA_BYTES_PER_WINDOW,
  reactionMaxEmojis: MAX_REACTION_EMOJIS,
};

/**
 * Porta do codec assinado sobre os módulos reais de L1 (`opCodec` + `idgen`): é o
 * construtor compartilhado de §7.1/§7.3 que §4 não deixa `communityClient` importar.
 * Em produto, o boot do utilityProcess injeta esta mesma forma.
 */
export function opCodecSignPort(): SignedOpCodecPort {
  return {
    kindNumber(kindName: string): number | null {
      return kindName in KINDS ? KINDS[kindName as KindName] : null;
    },
    encodePayload(kindName: string, payload: Readonly<Record<string, unknown>>): Buffer | null {
      if (!(kindName in PAYLOAD_LAYOUT)) return null;
      try {
        return encodePayload(kindName as KindName, payload as PayloadOf<KindName>);
      } catch {
        return null;
      }
    },
    sealOp(input): { envelope: Buffer; opId: string } {
      const op = encodeOp({
        v: input.opVersion,
        communityId: input.communityId,
        kind: input.kindNumber,
        author: input.author,
        sequenceScope: input.sequenceScope,
        authorSeq: input.authorSeq,
        ts: input.ts,
        payload: input.payload,
      });
      // Ed25519 detached sobre BLAKE2b('op/1' ‖ op), como world.makeRecord — decisão, não código.
      const sig = sign(opSigningHash(op), input.secretKey);
      const envelope = encodeEnvelope({ op, sig });
      return { envelope, opId: opId(envelope) };
    },
  };
}

/**
 * Porta do caminho ⏱ (§11.1) sobre o método `submitOp` de §16.2 no `rpcClient` existente.
 * Erro de transporte já chega como `{code}` do catálogo; resposta sem `{seq}` é anomalia
 * e vira indisponibilidade.
 */
export function rpcHostSubmitPort(client: RpcClient): HostSubmitPort {
  return async (envelope) => {
    const body = Buffer.from(
      JSON.stringify({ envelope: Buffer.from(envelope).toString('base64') }),
      'utf8',
    );
    const result = await client.call('submitOp', new Uint8Array(body));
    if (!result.ok) return { ok: false, code: result.code };
    const parsed = JSON.parse(Buffer.from(result.body).toString('utf8')) as { seq?: unknown };
    if (typeof parsed.seq !== 'number') return null;
    return { ok: true, seq: parsed.seq };
  };
}

/**
 * Resolve o alvo do envelope para o payload de `message.accepted` de §15.5: decodifica
 * `Envelope → Op` e dá o id da mensagem afetada — criada (`entityId` de §7.3 no send) ou
 * alvo do payload nos demais kinds do domínio. É a implementação da porta `resolveTarget`
 * da outbox — o boot injeta esta mesma forma. Kinds sem mensagem afetada devolvem `null`.
 */
export function envelopeTargetResolver(): (row: { readonly envelope: Buffer }) => {
  readonly messageId: string;
  readonly channelId: string | null;
} | null {
  const nomePorNumero = new Map<number, string>(
    Object.entries(KINDS).map(([nome, numero]) => [numero as number, nome] as const),
  );
  return (row) => {
    const envelope = decodeEnvelope(row.envelope);
    const op = envelope === null ? null : decodeOp(envelope.op);
    if (op === null) return null;
    const channelId = op.sequenceScope.kind === 'channel' ? op.sequenceScope.channelId : null;
    const nome = nomePorNumero.get(op.kind);
    if (nome === 'message.send') {
      const scopeKey = channelId === null ? 'community' : `channel:${channelId}`;
      return { messageId: entityId('message', op.communityId, op.author, op.authorSeq, scopeKey), channelId };
    }
    if (
      nome === 'message.edit' ||
      nome === 'message.delete' ||
      nome === 'message.pin' ||
      nome === 'reaction.set' ||
      nome === 'thread.create'
    ) {
      const p = decodePayload(nome, op.payload);
      if (p === null) return null;
      const messageId =
        nome === 'thread.create' ? (p as { rootMessageId: string }).rootMessageId : (p as { messageId: string }).messageId;
      return typeof messageId === 'string' ? { messageId, channelId } : null;
    }
    return null;
  };
}

// ─── Anexos e download (§13, §15.4 "Arquivos e diagnóstico") ────────────────────────────

/**
 * Porta de anexos sobre o `BlobManager` real. Duas injeções, e as duas são fronteiras que
 * §4 não deixa `blobs` cruzar sozinho:
 *
 *   - `pickFile` é o diálogo do main (`file.pick`/`staging.ticket`, §15.7). O caminho nasce
 *     e morre entre main e núcleo: nunca aparece na superfície IPC-R (`T-16`, `DR-37`).
 *   - `resolveAttachment` é a leitura de `attachments` na `view.db`. `blob.download` recebe
 *     de §15.4 só `{blobsCoreKey, blobId}`, e `name`/`sizeBytes`/`hash` — que o download
 *     precisa para abortar por tamanho e verificar o conteúdo (§13.4 passos 5–6) — são fato
 *     da mensagem projetada, não coisa que o renderer possa afirmar.
 */
export function blobAttachmentPort(opts: {
  readonly blobs: BlobManager;
  readonly blobsCoreKey: Buffer;
  pickFile(communityId: string): { readonly path: string; readonly sizeBytes: number } | null;
  resolveAttachment(a: { readonly blobsCoreKeyHex: string; readonly blobId: BlobIdWire }):
    | { readonly name: string; readonly sizeBytes: number; readonly hashHex: string }
    | null;
  /** Onde o main abriria o arquivo/pasta (`shell.open`, §15.7) — registrado para o teste. */
  onReveal?(a: { readonly path: string; readonly mode: 'open' | 'folder' }): void;
}): AttachmentSurfaceDeps {
  const wire = (r: StageResult): StagedAttachment => ({
    blobsCoreKey: r.blobsCoreKey.toString('hex'),
    blobId: r.blobId,
    name: r.name,
    sizeBytes: r.sizeBytes,
    kind: r.kind,
    hash: r.hash.toString('hex'),
  });

  /** A chave do cache local é derivada do hash — resolver o anexo é o único caminho. */
  function resolvido(ref: { blobsCoreKey: string; blobId: BlobIdWire }) {
    const row = opts.resolveAttachment({ blobsCoreKeyHex: ref.blobsCoreKey, blobId: ref.blobId });
    if (row === null) return null;
    return { ...row, blobIdHex: row.hashHex.slice(0, 32) };
  }

  return {
    async pick(communityId) {
      const escolhido = opts.pickFile(communityId);
      if (escolhido === null) throw Object.assign(new Error('cancelado'), { code: 'E_CANCELLED' });
      const ticket = opts.blobs.createTicketForMain(communityId, escolhido.path, escolhido.sizeBytes);
      return { ticketId: ticket.ticketId, name: ticket.name, sizeBytes: ticket.sizeBytes, kind: ticket.kind };
    },

    async stage(ticketId) {
      return wire(await opts.blobs.stage(ticketId, { blobsCoreKey: opts.blobsCoreKey }));
    },

    staged(ticketId) {
      const r = opts.blobs.stagedResult(ticketId);
      return r === null ? null : wire(r);
    },

    download(a) {
      const alvo = resolvido(a);
      if (alvo === null) throw Object.assign(new Error('anexo desconhecido'), { code: 'E_NOT_FOUND' });
      // §13.4 devolve `{state}` na hora: o download corre e o progresso vai por evento.
      void opts.blobs
        .download({
          blobsCoreKey: Buffer.from(a.blobsCoreKey, 'hex'),
          blobIdHex: alvo.blobIdHex,
          declaredSize: alvo.sizeBytes,
          hash: Buffer.from(alvo.hashHex, 'hex'),
          name: alvo.name,
        })
        .catch(() => {
          /* o desfecho vai por `blob.completed`/`attachment.corrupt` (§15.5), não por aqui */
        });
      return { state: opts.blobs.getDownloadState(a.blobsCoreKey, alvo.blobIdHex) ?? 'queued' };
    },

    cancel(a) {
      const alvo = resolvido(a);
      if (alvo !== null) opts.blobs.cancelDownload(a.blobsCoreKey, alvo.blobIdHex);
    },

    kindOf(a) {
      const alvo = resolvido(a);
      if (alvo === null) return null;
      const row = opts.blobs.cache.get(a.blobsCoreKey, alvo.blobIdHex);
      return row?.path == null ? kindFromFilename(alvo.name) : kindFromFilename(row.path);
    },

    reveal(a) {
      const alvo = resolvido(a);
      if (alvo === null) return { ok: false, code: 'E_NOT_DOWNLOADED' };
      const permitido = opts.blobs.canReveal(a.blobsCoreKey, alvo.blobIdHex);
      if (!permitido.allowed) return { ok: false, code: permitido.reason ?? 'E_NOT_DOWNLOADED' };
      const row = opts.blobs.cache.get(a.blobsCoreKey, alvo.blobIdHex);
      if (row?.path == null) return { ok: false, code: 'E_NOT_DOWNLOADED' };
      opts.onReveal?.({ path: row.path, mode: a.mode });
      return { ok: true };
    },
  };
}

type BlobIdWire = {
  readonly byteOffset: number;
  readonly blockOffset: number;
  readonly blockLength: number;
  readonly byteLength: number;
};

/**
 * `host.exitImpact` (§15.4, §18.7). O núcleo junta o que já sabe por comunidade: quem está
 * hospedado aqui, quantos online, quantos em chamada e quanto falta replicar. Nenhuma fonte
 * nova — cada número vem de um subsistema que já existe.
 */
export function hostExitImpactPort(opts: {
  readonly communities: readonly { readonly communityId: string; readonly name: string }[];
  onlineCount(communityId: string): number;
  inCallCount(communityId: string): number;
  pendingReplication(communityId: string): number;
}): () => readonly Record<string, unknown>[] {
  return () =>
    opts.communities.map((c) => ({
      communityId: c.communityId,
      name: c.name,
      onlineCount: opts.onlineCount(c.communityId),
      inCallCount: opts.inCallCount(c.communityId),
      pendingReplication: opts.pendingReplication(c.communityId),
    }));
}

// ─── Portas do diagnostics (§24.3, §15.4 diag.*) ────────────────────────────────────────

export function swarmNatProbe(natType: NatType): { probe(): Promise<NatType> } {
  return { probe: async () => natType };
}

/**
 * Probe STUN real sobre UDP de loopback: Binding Request RFC 5389 codificado pelo codec do
 * núcleo (`stunTurn`), respondido por um `MediaServer` ligado à mesma socket. É a junta de
 * §17.3 exercitada de verdade, sem HyperDHT.
 */
export class UdpStunProbe {
  readonly #socket: dgram.Socket;
  readonly #addr: MediaAddr;

  private constructor(socket: dgram.Socket, addr: MediaAddr) {
    this.#socket = socket;
    this.#addr = addr;
  }

  /** Sobe socket + MediaServer respondedor e devolve a porta de probe do cliente. */
  static async createPair(): Promise<{ probe: UdpStunProbe; responderClose(): Promise<void> }> {
    const responder = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => responder.bind(0, '127.0.0.1', resolve));
    const responderAddr = responder.address() as { address: string; port: number };

    const mediaSocket: MediaSocketPort = {
      send(datagram, addr) {
        responder.send(Buffer.from(datagram), addr.port, addr.host);
      },
    };
    const media = new MediaServer({
      realm: 'integracao',
      hostTurnSecret: Buffer.alloc(32, 7),
      socket: mediaSocket,
      openRelayPort: async () => {
        throw new Error('sem relay neste teste');
      },
      sessionPeerKeys: () => new Set(),
      rosterAddresses: () => new Set(),
    });
    responder.on('message', (msg, rinfo) => {
      media.handleDatagram(new Uint8Array(msg), { host: rinfo.address, port: rinfo.port });
    });

    const client = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => client.bind(0, '127.0.0.1', resolve));

    return {
      probe: new UdpStunProbe(client, { host: responderAddr.address, port: responderAddr.port }),
      responderClose: () => {
        responder.close();
        return new Promise((resolve) => client.close(resolve));
      },
    };
  }

  /** Binding com prazo próprio — resolve true quando XOR-MAPPED-ADDRESS volta. */
  probe(timeoutMs = 2_000): Promise<boolean> {
    return new Promise((resolve) => {
      const txId = randomTxId();
      const req = encodeBindingRequest(txId);
      const onMsg = (msg: Buffer): void => {
        const dec = decode(new Uint8Array(msg));
        if (dec === null || dec.type !== BINDING_SUCCESS || !dec.txId.equals(txId)) return;
        clearTimeout(timer);
        this.#socket.off('message', onMsg);
        resolve(dec.xorMapped !== undefined);
      };
      const timer = setTimeout(() => {
        this.#socket.off('message', onMsg);
        resolve(false);
      }, timeoutMs);
      this.#socket.on('message', onMsg);
      this.#socket.send(req, this.#addr.port, this.#addr.host);
    });
  }
}

/** Snapshot agregado das métricas de §24.3 espalhadas pelos detentores de estado. */
export function aggregateMetricsPort(opts: {
  swarm: Swarm;
  natType: NatType;
  counters?: () => Record<string, number>;
}): DiagnosticsMetricsPort & { setNat(n: NatType): void } {
  let nat = opts.natType;
  return {
    setNat(n: NatType) {
      nat = n;
    },
    snapshot(): MetricsSnapshot {
      const stats = opts.swarm.getStats();
      return {
        gauges: {
          'swarm.peers': stats.peerCount,
          'swarm.natType': nat === 'open' ? 0 : nat === 'moderate' ? 1 : 2,
        },
        counters: opts.counters?.() ?? {},
        histograms: {},
      };
    },
  };
}

// ─── Porta de consentimento do relay sobre manifest.db (§6.15) ─────────────────────────

export function manifestRelayConsentPort(manifest: import('../../src/l0/manifest/index.ts').ManifestDb): RelayConsentPort {
  return {
    get(communityId) {
      return manifest.getRelayConsent(communityId);
    },
    set(communityId, decision, opts) {
      manifest.setRelayConsent(communityId, decision, Date.now());
      if (!opts.remember) manifest.forgetRelayConsent(communityId);
    },
    forget(communityId) {
      manifest.forgetRelayConsent(communityId);
    },
  };
}

// ─── Recorte do DecisionState para voz/tela (porta de §17.4) ────────────────────────────

/**
 * Adaptador estrutural `DecisionState → VoiceStatePort`. O DS de §8.1 satisfaz a porta por
 * forma — `permissions` já é `Set<number>` de §9.1 e os campos de membro/canal batem; este
 * adaptador só recorta o que a mídia lê.
 */
export function voiceStateOf(state: DecisionState): VoiceStatePort {
  return {
    community: state.community,
    channels: state.channels,
    members: new Map(
      [...state.members.entries()].map(([keyHex, member]) => [
        keyHex,
        {
          state: member.state,
          ...(member.timeoutUntil !== undefined ? { timeoutUntil: member.timeoutUntil } : {}),
          roleIds: member.roleIds,
        },
      ]),
    ),
    roles: new Map(
      [...state.roles.entries()].map(([id, role]) => [
        id,
        {
          permissions: role.permissions,
          ...(role.deletedAt !== undefined ? { deletedAt: role.deletedAt } : {}),
        },
      ]),
    ),
  };
}

/** Diretório temporário rotulado (mesma convenção dos outros cabos). */
export function tempDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `core-integracao-${label}-`));
}

// ─── Composição das portas de sucessão sobre módulos reais (§34.2 item 1, §18.8) ────────
//
// As quatro portas de `SuccessionDeps` compostas dos módulos de produto — a ponte de §30,
// o `corestore`, o log da origem e o `manifest` — no mesmo padrão das juntas da ponte de
// submissão acima (`opCodecSignPort`, `rpcHostSubmitPort`): nenhuma decisão de domínio
// aqui dentro; quem decide continua sendo o serviço (L2) e o `fold`. Quando o boot do
// utilityProcess existir, são estas formas que ele injeta.

// Cifra de repouso de §5.1/§5.4 (XChaCha20-Poly1305) com o particionamento do schema de
// §10.2: `community_seed_nonce` é a coluna separada do nonce e `_enc` é ciphertext‖tag.
// Os helpers de `identity` não são exportados; a forma é a mesma.

function aeadSealSeed(plain: Buffer, dataKey: Buffer): { enc: Buffer; nonce: Buffer } {
  const nonce = Buffer.alloc(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  sodium.randombytes_buf(nonce);
  const enc = Buffer.alloc(plain.length + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES);
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(enc, plain, null, null, nonce, dataKey);
  return { enc, nonce };
}

function aeadOpenSeed(enc: Buffer, nonce: Buffer, dataKey: Buffer): Buffer | null {
  if (enc.length < sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES) return null;
  const plain = Buffer.alloc(enc.length - sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES);
  try {
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(plain, null, enc, null, nonce, dataKey);
  } catch {
    return null;
  }
  return plain;
}

/** Grava a linha de comunidade hospedada de §5.3 com a semente cifrada pela Data Key. */
export function storeCommunitySeed(manifest: ManifestDb, row: {
  communityId: string;
  coreKey: Buffer;
  blobsKey: Buffer;
  communitySeed: Buffer;
  isHost: boolean;
  joinedAt: number;
  originCommunityId?: string | null;
}, dataKey: Buffer): void {
  const { enc, nonce } = aeadSealSeed(row.communitySeed, dataKey);
  manifest.upsertCommunity({
    communityId: row.communityId,
    coreKey: row.coreKey,
    blobsKey: row.blobsKey,
    communitySeedEnc: enc,
    communitySeedNonce: nonce,
    isHost: row.isHost,
    joinedAt: row.joinedAt,
    ...(row.originCommunityId !== undefined ? { originCommunityId: row.originCommunityId } : {}),
  });
}

/** Porta `communitySeed` de §5.3: lê o `manifest` e decifra com a Data Key; sem linha hospedada ou cifra inválida → `null`. */
export function manifestCommunitySeedPort(manifest: ManifestDb, dataKey: Buffer): (communityId: string) => Buffer | null {
  return (communityId) => {
    const row = manifest.getCommunity(communityId) as
      | { community_seed_enc?: Buffer | null; community_seed_nonce?: Buffer | null; is_host?: number }
      | null;
    if (
      row === null ||
      !row.is_host ||
      row.community_seed_enc === undefined ||
      row.community_seed_enc === null ||
      row.community_seed_nonce === undefined ||
      row.community_seed_nonce === null
    ) {
      return null;
    }
    const seed = aeadOpenSeed(Buffer.from(row.community_seed_enc), Buffer.from(row.community_seed_nonce), dataKey);
    return seed !== null && seed.length === 32 ? seed : null;
  };
}

/**
 * Porta `sealedSeedFor`: relê o log da origem pelo `CoreHandle` — o `DS` não guarda escrow
 * (§8.1) — decodificando HostRecord → Envelope → Op até achar o `community.escrow`
 * endereçado à identidade local; mais recente primeiro. Comunidade que não é este core,
 * bloco ilegível ou escrow ausente → `null`.
 */
export function logEscrowPort(core: CoreHandle, selfPublicKey: Buffer): (communityId: string) => Promise<Buffer | null> {
  return async (communityId) => {
    if (communityId !== core.key.toString('hex')) return null;
    for (let seq = core.length - 1; seq >= 0; seq--) {
      const block = await core.get(seq);
      if (block === null) continue;
      const hostRecord = decodeHostRecord(Buffer.from(block));
      const envelope = hostRecord === null ? null : decodeEnvelope(hostRecord.envelope);
      const op = envelope === null ? null : decodeOp(envelope.op);
      if (op === null || op.kind !== KINDS['community.escrow']) continue;
      const p = decodePayload('community.escrow', op.payload);
      if (p !== null && p.targetKey.equals(selfPublicKey)) return Buffer.from(p.wrappedSeed);
    }
    return null;
  };
}

/**
 * Porta `createContinuationCore` sobre o `corestore` real: cria o core com o par do plano
 * em `<rootDir>/<keyHex>` (§5.3 — aberto por chave explícita, nunca namespace aleatório),
 * appenda o lote inteiro numa chamada (§10.7.1) e entrega o cabo por `onCreated` — é lá que
 * a composição registra a comunidade nova (Projector, outbox, cliente).
 */
export function corestoreContinuationCorePort(
  rootDir: string,
  onCreated?: (core: WritableCoreHandle) => void | Promise<void>,
): CreateContinuationCorePort & { readonly created: WritableCoreHandle[]; close(): Promise<void> } {
  const created: WritableCoreHandle[] = [];
  const port = async ({ keyPair, records }: {
    readonly keyPair: { readonly publicKey: Buffer; readonly secretKey: Buffer };
    readonly records: readonly Buffer[];
  }): Promise<void> => {
    const core = await createCore(path.join(rootDir, keyPair.publicKey.toString('hex')), keyPair);
    await core.append(records.map((r) => Buffer.from(r)));
    created.push(core);
    await onCreated?.(core);
  };
  return Object.assign(port, {
    created,
    close: async () => {
      for (const core of created) await core.close();
    },
  });
}

/** Porta `submitSync` ligada à ponte de §30 — delegação direta ao `CommunityClient`. */
export function bridgeSubmitSyncPort(client: CommunityClient): SubmitSyncPort {
  return (communityId, input) => client.submitSync(communityId, input);
}

// ─── Ciclo de vida da comunidade e consulta; rail de sucessão (§11.1, §15.6, L-16/L-22) ─

/**
 * Orquestração de `community.leave` (§15.4, exceção única de §11.1). Efeito local
 * imediato — descarte da fila com motivo nomeado, `left_at`, saída do swarm — com o
 * kind `member.leave` enfileirado ANTES do descarte para os demais verem a saída (L-22).
 * O host não sai (`E_HOST_CANNOT_LEAVE`); o fold continua vinculante na admissão.
 */
export function communityLeavePort(opts: {
  client: CommunityClient;
  manifest: ManifestDb;
  outboxOf(communityId: string): Outbox | undefined;
  selfKeyHex(): string | null;
}): (communityId: string) =>
  | { readonly ok: true; readonly opId: string; readonly droppedQueued: number }
  | { readonly ok: false; readonly code: string } {
  return (communityId) => {
    const state = opts.client.writeStateFor(communityId);
    if (state === null) return { ok: false, code: 'E_NOT_FOUND' };
    const selfKeyHex = opts.selfKeyHex();
    if (selfKeyHex === null) return { ok: false, code: 'E_NO_IDENTITY' };
    if (state.community.hostKey.toString('hex') === selfKeyHex) {
      return { ok: false, code: 'E_HOST_CANNOT_LEAVE' };
    }
    const outbox = opts.outboxOf(communityId);
    if (outbox === undefined) return { ok: false, code: 'E_INTERNAL' };
    const enfileirada = opts.client.submitQueued(communityId, {
      kindName: MEMBER_LEAVE_KIND,
      payload: {},
    });
    if (!enfileirada.ok) return { ok: false, code: enfileirada.code };
    const droppedQueued = outbox.discardForLeave(enfileirada.opId);
    opts.manifest.markCommunityLeft(communityId, Date.now());
    opts.client.removeCommunity(communityId);
    return { ok: true, opId: enfileirada.opId, droppedQueued };
  };
}

/** `UserRef` de §15.6 com os campos que já têm fonte em código. */
export interface QueryUserRef {
  readonly key: string;
  readonly displayName: string;
  readonly handle: string;
  readonly avatarColor: string;
  readonly collision: boolean;
}

/**
 * Recorte entregue de `query.community` (§15.6): só os campos com fonte real hoje.
 * `memberCount`, `unread`, `notificationLevel`, `hostStatus`, `inactiveDays`,
 * `iconEmoji?` e `partialInterpretation` aguardam seus subsistemas e ficam AUSENTES —
 * registrados em `docs/sequenciamento-pos-fase-0.md`.
 */
export interface QueryCommunityView {
  readonly id: string;
  readonly name: string;
  readonly iconColor: number;
  readonly endedAt?: number;
  readonly originCommunityId?: string;
  readonly isHost: boolean;
  readonly hostRef: QueryUserRef;
  readonly successorKeys: readonly string[];
  readonly myRoleIds: readonly string[];
  readonly myPermissions: readonly string[];
  readonly myTopRank: string;
  readonly replication: { readonly state: string; readonly lag: number };
  readonly pendingReentry?: readonly QueryUserRef[];
}

/**
 * Monta `query.community` sobre o DS REAL (nomes, cargos, ranks — o recorte da ponte não
 * basta), a replicação e a sucessão. `pendingReentry` só existe quando a comunidade é
 * continuação E a origem está replicada aqui — exatamente a condição de §15.6/L-23.
 */
export function queryCommunityPort(opts: {
  stateFor(communityId: string): DecisionState | null;
  selfKeyHex(): string | null;
  replicationOf(communityId: string): ReplicationInfo;
  pendingReentryOf?(communityId: string): readonly Buffer[];
}): (communityId: string) => QueryCommunityView | null {
  const refDe = (keyHex: string, membro?: { displayName: string; avatarColor: number }): QueryUserRef => ({
    key: keyHex,
    displayName: membro?.displayName ?? keyHex.slice(0, 8),
    handle: computeHandle(Buffer.from(keyHex, 'hex')),
    avatarColor: String(membro?.avatarColor ?? 0),
    collision: false,
  });
  return (communityId) => {
    const ds = opts.stateFor(communityId);
    if (ds === null || !ds.community.exists) return null;
    const selfKeyHex = opts.selfKeyHex();
    if (selfKeyHex === null) return null;
    const eu = ds.members.get(selfKeyHex);
    if (eu === undefined || eu.state !== 'active') return null;

    const myRoleIds = [...eu.roleIds];
    const permissoes = new Set<number>();
    // §9.3 — o teto do membro é o maior rank entre os cargos ativos dele (mesma regra
    // de `topRank`; aqui é inline porque o recorte do DS não satisfaz `RoleLookup`).
    let teto: string | null = null;
    for (const roleId of myRoleIds) {
      const role = ds.roles.get(roleId);
      if (role === undefined || role.deletedAt !== undefined) continue;
      for (const p of role.permissions) permissoes.add(p);
      if (teto === null || role.rank > teto) teto = role.rank;
    }
    const hostHex = ds.community.hostKey.toString('hex');
    // pendingReentry só existe quando a comunidade é continuação E a origem está
    // replicada aqui — a condição literal de §15.6; os nomes vêm do roster da ORIGEM.
    const originId = ds.community.originCommunityId;
    let pendentes: QueryUserRef[] | undefined;
    if (originId !== undefined && opts.pendingReentryOf !== undefined) {
      const origem = opts.stateFor(originId);
      if (origem !== null && origem.community.exists) {
        pendentes = opts.pendingReentryOf(communityId).map((k) => {
          const hex = k.toString('hex');
          return refDe(hex, origem.members.get(hex));
        });
      }
    }

    const view: QueryCommunityView = {
      id: ds.communityId,
      name: ds.community.name,
      iconColor: ds.community.iconColor,
      ...(ds.community.endedAt !== undefined ? { endedAt: ds.community.endedAt } : {}),
      ...(originId !== undefined ? { originCommunityId: originId } : {}),
      isHost: hostHex === selfKeyHex,
      hostRef: refDe(hostHex, ds.members.get(hostHex)),
      successorKeys: ds.community.successorKeys.map((k) => k.toString('hex')),
      myRoleIds,
      myPermissions: [...permissoes].map((n) => PERMISSION_BY_NUMBER[n] ?? String(n)),
      myTopRank: teto ?? '',
      replication: opts.replicationOf(communityId),
      ...(pendentes !== undefined ? { pendingReentry: pendentes } : {}),
    };
    return view;
  };
}

/**
 * Migração de rail de §18.8 passo 5 com arbitragem de L-16: `dispositionFor` decide por
 * réplica — camada b quando a origem está aqui, camada a quando não está. Migrar é
 * acrescentar a continuação ao cliente como comunidade ativa; a origem permanece aberta
 * e legível em modo histórico (S6: se o host voltar, ela ainda interpreta cauda).
 * Recusado → `disputed` para quem detém estado de UI; nada é adicionado ao cliente.
 * A DESCOBERTA da continuação (quem dá o core novo à réplica) é do transporte — G12
 * empacotado; esta porta decide o que fazer com ele depois de descoberto.
 */
export function migrateRail(args: {
  client: CommunityClient;
  originProjector: Projector;
  continuation: { core: CoreHandle; projector: Projector };
  ttlMs: number;
  now(): number;
}): { migrated: true } | { migrated: false; disputed: true; reason: LayerBRefusal } {
  const contDs = args.continuation.projector.ds;
  const originId = contDs.community.originCommunityId;
  if (!contDs.community.exists || originId === undefined) {
    throw new Error('migração de rail exige uma continuação interpretada aqui');
  }
  const origemDs = args.originProjector.ds;
  const claim = {
    communityIdHex: args.continuation.core.key.toString('hex'),
    originCommunityIdHex: originId,
    originFinalSeq: contDs.community.originFinalSeq ?? 0,
    assumedByHex: contDs.community.hostKey.toString('hex'),
  };
  // Só quem TEM a origem replicada confere a camada b; origem de outro id aqui não conta.
  const facts: OriginFacts | null =
    origemDs.communityId === originId
      ? {
          communityIdHex: origemDs.communityId,
          successorKeysHex: origemDs.community.successorKeys.map((k) => k.toString('hex')),
          lastHostTs: origemDs.lastHostTs,
          ...(origemDs.community.endedAt !== undefined ? { endedAt: origemDs.community.endedAt } : {}),
        }
      : null;
  const d = dispositionFor({ claim, origin: facts, ttlMs: args.ttlMs, now: args.now() });
  if (!d.migrate) return { migrated: false, disputed: true, reason: d.reason };
  args.client.addCommunity({
    communityId: claim.communityIdHex,
    core: args.continuation.core,
    projector: args.continuation.projector,
  });
  return { migrated: true };
}
