// O boot do `utilityProcess` — a raiz de composição de §4 e as fases `open` … `host-mode`
// de §3.3.
//
// Todas as peças que ele liga já existem e são testadas em separado. O que não existia era
// o **lugar** onde elas se conhecem: `Projector.onEvent` e `Outbox.onOutcome` desaguando no
// mesmo `EventFanout` (§38.2); a escolha entre `localMediaDispatcher` e
// `remoteMediaDispatcher` por comunidade (§42.3, §43.3); o `startMediaRuntime` com relógio
// de verdade (§17.4 emendado); o mapa conexão↔membro que `peerSignalRelay` consulta
// (§43.3); e as portas de sucessão, saída e consulta (§35.2, §37.2).
//
// Nada aqui decide domínio. Toda decisão continua no `fold` (L1) ou no serviço de L2 que a
// tabela de §4 nomeia; este arquivo escolhe implementações e as injeta.
//
// **O transporte chega injetado.** O boot nunca abre socket: ele recebe `RpcTransportPort`
// por conexão e devolve o cabo. É essa costura que a fase seguinte (protomux-rpc sobre
// Hyperswarm) preenche sem tocar em nada abaixo.

import path from 'node:path';

import {
  CHANNEL_TYPE,
  HOST_INACTIVITY_MS,
  MAX_CAMERAS,
  MAX_VOICE_PARTICIPANTS,
  MEDIA_TICKET_TTL_MS,
  SHARE_MAX_VIEWERS,
  type DecisionState,
} from '../l1/fold/index.ts';
import { OP_VERSION } from '../l1/opCodec/index.ts';
import { Projector } from '../l1/projector/index.ts';
import type { ViewDb } from '../l0/view/index.ts';
import type { ManifestDb } from '../l0/manifest/index.ts';
import {
  deriveCommunityKeyPairs,
  openCore,
  openWritableCore,
  type CoreHandle,
  type WritableCoreHandle,
} from '../l0/corestore/index.ts';
import type { Swarm } from '../l0/swarm/index.ts';
import { HostAdmission } from '../l2/communityHost/index.ts';
import { CommunityClient, type HostSubmitPort } from '../l2/communityClient/index.ts';
import { Outbox } from '../l2/outbox/index.ts';
import { SearchService } from '../l2/search/index.ts';
import { SuccessionService } from '../l2/succession/index.ts';
import {
  VoiceHostSessions,
  type RevokedTarget,
  type RosterSnapshot,
} from '../l2/voiceCoordinator/index.ts';
import { ShareHostSessions, type ShareSessionEvent } from '../l2/shareStar/index.ts';
import type { Diagnostics } from '../l2/diagnostics/index.ts';
import { EventFanout } from '../l3/ipcRenderer/fanout.ts';
import { IpcServer, type IpcPort } from '../l3/ipcRenderer/index.ts';
import { registerCoreCommands, type CoreCommandDeps } from '../l3/ipcRenderer/commands.ts';
import {
  localMediaDispatcher,
  remoteMediaDispatcher,
  startMediaRuntime,
  type MediaAck,
  type MediaDispatcher,
  type SessionSecurity,
  type ShareStartOk,
  type VoiceJoinOk,
  type VoiceTicketsOk,
  type MediaFail,
  type ShareJoinOk,
  type SetQualityOkResult,
} from '../l3/ipcRenderer/media.ts';
import { RpcClient } from '../l3/rpcClient/index.ts';
import { RpcServer, type RpcTransportPort } from '../l3/rpcServer/index.ts';
import { peerSignalRelay } from '../l3/rpcServer/media.ts';
import {
  SUBMISSION_LIMITS,
  bridgeSubmitSyncPort,
  communityLeavePort,
  corestoreContinuationCorePort,
  envelopeTargetResolver,
  hostExitImpactPort,
  hostRecordSigner,
  logEscrowPort,
  manifestCommunitySeedPort,
  migrateRail,
  opCodecSignPort,
  queryCommunityPort,
  rpcHostSubmitPort,
  rpcSubmitPort,
  voiceStateOf,
  wireHostMediaRpc,
  wireHostRpc,
  type HelloInfo,
} from './ports.ts';

/** Identidade local de §5.5 — `null` no estado `awaiting-identity` de §3.3. */
export type BootIdentity = { readonly publicKey: Buffer; readonly secretKey: Buffer };

/** Linha de `manifest.communities` (§10.2) recortada no que o boot lê. */
type CommunityRow = {
  readonly community_id: string;
  readonly core_key: Buffer;
  readonly blobs_key: Buffer;
  readonly is_host: number;
  readonly left_at: number | null;
};

export type BootDeps = {
  /** `<userData>/p2p` de §10.1 — os cores ficam em `<dataDir>/cores/<keyHex>`. */
  readonly dataDir: string;
  readonly manifest: ManifestDb;
  readonly view: ViewDb;
  readonly swarm: Swarm;
  /** §5.4 — protege as sementes de comunidade no `manifest` (§5.3). */
  readonly dataKey: Buffer;
  identity(): BootIdentity | null;
  /** §10.6 — hash do binário do `fold`, calculado por quem compõe o boot. */
  readonly foldBuildId: string;
  /** Porta do IPC-R (§3.1): o `MessagePort` que o main cruzou até o renderer. */
  readonly ipcPort: IpcPort;
  /** §15.1 — incrementado a cada reinício do núcleo pelo main (§3.3, crash do núcleo). */
  readonly epoch: number;
  /** §15.3 — tokens de confirmação nativa; chegam pelo IPC-M. */
  readonly tokenVerifier: { consume(token: string, cmd: string): boolean };
  /** §17.3 — segredo do serviço TURN desta instalação, por comunidade hospedada. */
  hostTurnSecret(communityId: string): Buffer;
  /** §24.3 — depende de sonda de NAT/STUN, que é transporte; chega pronto. */
  readonly diagnostics?: Diagnostics;
  /** Demais superfícies de §15.4 que o boot não constrói (anexos, relay). */
  readonly extraCommands?: Pick<CoreCommandDeps, 'attachments' | 'relay' | 'relayConsent' | 'partialReason'>;
  readonly now?: () => number;
  /** Injetáveis só para teste determinístico; em produto são os do `globalThis`. */
  readonly schedule?: (fn: () => void, ms: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
  /** §17.5 — validade do `captureToken` local (§17.4 emendado). */
  readonly captureTokenTtlMs?: number;
  /** Abertura do core; sobrescrita em teste para não tocar disco. */
  openCore?(a: {
    readonly communityId: string;
    readonly coreKey: Buffer;
    readonly keyPair: { readonly publicKey: Buffer; readonly secretKey: Buffer } | null;
  }): Promise<CoreHandle>;
};

/** Uma comunidade aberta: as peças de §3.3 fase `open` mais o modo de mídia escolhido. */
export type OpenCommunity = {
  readonly communityId: string;
  readonly isHost: boolean;
  readonly core: CoreHandle;
  readonly projector: Projector;
  readonly outbox: Outbox | null;
  /** Canal de §16.1 com o host — ausente em modo host (esta instalação **é** o host). */
  readonly rpc: RpcClient | null;
  readonly dispatcher: MediaDispatcher;
  readonly host: HostSide | null;
  stop(): void;
};

/** O que só existe quando esta instalação hospeda a comunidade (§3.3 `host-mode`). */
export type HostSide = {
  readonly admission: HostAdmission;
  readonly voice: VoiceHostSessions;
  readonly share: ShareHostSessions;
  /** O mapa conexão↔membro que `peerSignalRelay` consulta (§43.3, §16.3 regra 4). */
  readonly connections: Map<string, RpcServer>;
};

/**
 * Roteador de mídia por comunidade (§42.3, §43.3). §15.4 dá ao roteador **um** dispatcher, e
 * §15.4 `voice.leave` declara que "voz é uma só": a instalação tem no máximo uma sessão de
 * voz. As duas coisas juntas dizem exatamente o que este objeto faz — `voiceJoin` fixa a
 * comunidade corrente, e todo comando sem `communityId` vai para o dispatcher fixado.
 *
 * `share.*` endereça por `sessionId`, que não nomeia comunidade: o mapa
 * `sessionId → comunidade` é alimentado pelo `shareStart` local e por todo evento de §16.3
 * que carrega `sessionId` — é assim que um espectador sabe para onde mandar `shareJoin` de
 * uma sessão que ele não abriu. Sem registro, cai na comunidade da chamada corrente, que é
 * a única em que §17.5 permite que exista tela.
 */
class MediaRouter implements MediaDispatcher {
  readonly mode = 'host' as const;
  readonly #byCommunity: Map<string, MediaDispatcher>;
  readonly #sessionCommunity = new Map<string, string>();
  #currentVoice: string | null = null;

  constructor(byCommunity: Map<string, MediaDispatcher>) {
    this.#byCommunity = byCommunity;
  }

  /** Registra o vínculo `sessionId → comunidade` visto num evento de §16.3/§15.5. */
  observeSession(communityId: string, sessionId: unknown): void {
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      this.#sessionCommunity.set(sessionId, communityId);
    }
  }

  forget(communityId: string): void {
    if (this.#currentVoice === communityId) this.#currentVoice = null;
    for (const [sid, cid] of [...this.#sessionCommunity]) {
      if (cid === communityId) this.#sessionCommunity.delete(sid);
    }
  }

  #of(communityId: string): MediaDispatcher | null {
    return this.#byCommunity.get(communityId) ?? null;
  }

  #current(): MediaDispatcher | null {
    return this.#currentVoice === null ? null : this.#of(this.#currentVoice);
  }

  #bySession(sessionId: string): MediaDispatcher | null {
    const cid = this.#sessionCommunity.get(sessionId);
    return cid === undefined ? this.#current() : this.#of(cid);
  }

  currentSessionId(): string | null {
    return this.#current()?.currentSessionId() ?? null;
  }

  async voiceJoin(a: { communityId: string; channelId: string }): Promise<VoiceJoinOk | MediaFail> {
    const d = this.#of(a.communityId);
    if (d === null) return { ok: false, code: 'E_NOT_FOUND' };
    const r = await d.voiceJoin(a);
    if (r.ok) {
      this.#currentVoice = a.communityId;
      this.observeSession(a.communityId, r.sessionId);
    }
    return r;
  }

  async voiceLeave(): Promise<MediaAck> {
    const d = this.#current();
    if (d === null) return { ok: false, code: 'E_NOT_IN_CALL' };
    const r = await d.voiceLeave();
    this.#currentVoice = null;
    return r;
  }

  async voiceSetSelf(patch: Parameters<MediaDispatcher['voiceSetSelf']>[0]): Promise<MediaAck> {
    return (await this.#current()?.voiceSetSelf(patch)) ?? { ok: false, code: 'E_NOT_IN_CALL' };
  }

  async voiceMuteParticipant(a: { communityId: string; identityKey: string; muted: boolean }): Promise<MediaAck> {
    return (await this.#of(a.communityId)?.voiceMuteParticipant(a)) ?? { ok: false, code: 'E_NOT_FOUND' };
  }

  async voiceSignal(a: { peerKey: string; ticketId: string; sdp?: string; ice?: string }): Promise<MediaAck> {
    return (await this.#current()?.voiceSignal(a)) ?? { ok: false, code: 'E_NOT_IN_CALL' };
  }

  async renewTickets(): Promise<VoiceTicketsOk | MediaFail> {
    return (await this.#current()?.renewTickets()) ?? { ok: false, code: 'E_NOT_IN_CALL' };
  }

  sessionSecurity(): SessionSecurity | null {
    return this.#current()?.sessionSecurity() ?? null;
  }

  observeRoster(participants: readonly string[]): void {
    this.#current()?.observeRoster(participants);
  }

  async shareStart(a: Parameters<MediaDispatcher['shareStart']>[0]): Promise<ShareStartOk | MediaFail> {
    const d = this.#of(a.communityId);
    if (d === null) return { ok: false, code: 'E_NOT_FOUND' };
    const r = await d.shareStart(a);
    if (r.ok) this.observeSession(a.communityId, r.sessionId);
    return r;
  }

  async shareStop(a: { sessionId: string }): Promise<MediaAck> {
    return (await this.#bySession(a.sessionId)?.shareStop(a)) ?? { ok: false, code: 'E_NOT_FOUND' };
  }

  async shareSetQuality(a: Parameters<MediaDispatcher['shareSetQuality']>[0]): Promise<SetQualityOkResult | MediaFail> {
    return (await this.#bySession(a.sessionId)?.shareSetQuality(a)) ?? { ok: false, code: 'E_NOT_FOUND' };
  }

  async shareJoin(a: { sessionId: string }): Promise<ShareJoinOk | MediaFail> {
    return (await this.#bySession(a.sessionId)?.shareJoin(a)) ?? { ok: false, code: 'E_NOT_FOUND' };
  }

  authorizeCapture(a: { sessionId: string }): ReturnType<MediaDispatcher['authorizeCapture']> {
    // Sem dispatcher para a sessão não há token local, e §17.4 emendado é falha fechada.
    return this.#bySession(a.sessionId)?.authorizeCapture(a) ?? { allowed: false, reason: 'gone' };
  }
}

/**
 * Porta `submitOp` de quem hospeda: não há round-trip nenhum: a fila de admissão de §11.4
 * está neste processo. Existe pela mesma razão que `rpcHostSubmitPort` — `communityClient`
 * não pode importar `communityHost` (§4), e quem conhece os dois é o boot.
 */
export function localHostSubmitPort(admission: Pick<HostAdmission, 'submit'>): HostSubmitPort {
  return async (envelope) => {
    const r = await admission.submit(envelope);
    return r.ok ? { ok: true, seq: r.seq } : { ok: false, code: r.code };
  };
}

/** O núcleo montado. É o que o `utilityProcess` guarda e o que o `draining` de §3.3 fecha. */
export class CoreRuntime {
  readonly ipc: IpcServer;
  readonly fanout: EventFanout;
  readonly client: CommunityClient;
  readonly succession: SuccessionService;
  readonly search: SearchService;
  readonly #deps: BootDeps;
  readonly #open: Map<string, OpenCommunity>;
  readonly #dispatchers: Map<string, MediaDispatcher>;
  readonly #router: MediaRouter;
  readonly #now: () => number;
  readonly #onProjected = new Set<(communityId: string) => void>();

  constructor(a: {
    deps: BootDeps;
    ipc: IpcServer;
    fanout: EventFanout;
    client: CommunityClient;
    succession: SuccessionService;
    search: SearchService;
    router: MediaRouter;
    dispatchers: Map<string, MediaDispatcher>;
    open: Map<string, OpenCommunity>;
  }) {
    this.#deps = a.deps;
    this.ipc = a.ipc;
    this.fanout = a.fanout;
    this.client = a.client;
    this.succession = a.succession;
    this.search = a.search;
    this.#router = a.router;
    this.#dispatchers = a.dispatchers;
    this.#open = a.open;
    this.#now = a.deps.now ?? Date.now;
  }

  /**
   * Um lote foi projetado nesta comunidade. Existe por causa de §14.3(3): o nó fecha os
   * canais já abertos para um par que acabou de ser banido, **no mesmo lote de projeção que
   * aplicou o ban**. Quem detém os canais é o transporte, e é ele que assina isto.
   */
  onProjected(cb: (communityId: string) => void): () => void {
    this.#onProjected.add(cb);
    return () => this.#onProjected.delete(cb);
  }

  /** @internal — chamado pelo `bootCore` no mesmo passo síncrono do fan-out do lote. */
  notifyProjected(communityId: string): void {
    for (const cb of this.#onProjected) cb(communityId);
  }

  communities(): readonly OpenCommunity[] {
    return [...this.#open.values()];
  }

  get(communityId: string): OpenCommunity | undefined {
    return this.#open.get(communityId);
  }

  /**
   * Modo membro: (re)liga o canal de §16.1 com o host. O `RpcClient` nasce sem transporte —
   * fila e circuit breaker de §11.8 já cobrem a janela sem conexão —, e é isto que a fase do
   * transporte real chama quando o Hyperswarm entrega a conexão.
   */
  attachHostChannel(a: { communityId: string; transport: RpcTransportPort }): void {
    const c = this.#open.get(a.communityId);
    if (c?.rpc == null) throw new Error(`sem canal de membro para ${a.communityId}`);
    c.rpc.reattach(a.transport);
  }

  /**
   * Modo host: uma conexão de membro autorizada (§14.3) vira um `RpcServer` com os métodos
   * de §16.2 e uma entrada no mapa conexão↔membro. É esse mapa que `peerSignalRelay`
   * consulta para achar a conexão do destinatário de `voice.signal` (§43.3).
   */
  attachMemberConnection(a: {
    communityId: string;
    peerKeyHex: string;
    transport: RpcTransportPort;
  }): { detach(): void } {
    const c = this.#open.get(a.communityId);
    if (c?.host == null) throw new Error(`${a.communityId} não é hospedada aqui`);
    const host = c.host;
    const server = new RpcServer({ protocol: 'community', transport: a.transport });
    const hello: HelloInfo = {
      hostVersion: this.#deps.foldBuildId,
      opVersion: OP_VERSION,
      coreLength: c.core.length,
      memberCount: c.projector.ds.members.size,
      capabilities: [],
    };
    wireHostRpc(server, { admission: host.admission, hello });
    wireHostMediaRpc(server, {
      peerKeyHex: a.peerKeyHex,
      stateFor: () => voiceStateOf(c.projector.ds),
      voice: host.voice,
      share: host.share,
      signal: peerSignalRelay((toPeerKeyHex) => host.connections.get(toPeerKeyHex) ?? null),
    });
    host.connections.set(a.peerKeyHex, server);
    return {
      detach: () => {
        if (host.connections.get(a.peerKeyHex) === server) host.connections.delete(a.peerKeyHex);
      },
    };
  }

  /**
   * §18.8 passo 5 — migração de rail com a arbitragem de L-16. A DESCOBERTA da continuação
   * é do transporte; aqui decide-se o que fazer com o core depois de descoberto.
   */
  migrateRail(a: { originCommunityId: string; continuation: { core: CoreHandle; projector: Projector }; ttlMs?: number }): ReturnType<typeof migrateRail> {
    const origem = this.#open.get(a.originCommunityId);
    if (origem === undefined) throw new Error(`origem ${a.originCommunityId} não está aberta aqui`);
    return migrateRail({
      client: this.client,
      originProjector: origem.projector,
      continuation: a.continuation,
      ttlMs: a.ttlMs ?? HOST_INACTIVITY_MS,
      now: this.#now,
    });
  }

  /** §3.3 `draining`/`stopped` — para os temporizadores e fecha os cores abertos aqui. */
  async close(): Promise<void> {
    for (const c of this.#open.values()) {
      c.stop();
      await c.core.close();
    }
    this.#open.clear();
    this.client.close();
  }

  /** @internal — usado pelo `bootCore` e por quem abre comunidade depois do boot. */
  register(c: OpenCommunity): void {
    this.#open.set(c.communityId, c);
    this.#dispatchers.set(c.communityId, c.dispatcher);
  }

  /** Saída local de §11.1 (exceção) — a comunidade deixa de estar aberta aqui. */
  forget(communityId: string): void {
    const c = this.#open.get(communityId);
    if (c === undefined) return;
    c.stop();
    this.#open.delete(communityId);
    this.#dispatchers.delete(communityId);
    this.#router.forget(communityId);
  }
}

/**
 * Monta o grafo de §4 e devolve o núcleo pronto: as fases `open`, `swarm`, `reconcile` e
 * `host-mode` de §3.3 sobre as comunidades de `manifest.communities` (§10.2), com o IPC-R
 * de §15 na frente.
 */
export async function bootCore(deps: BootDeps): Promise<CoreRuntime> {
  const now = deps.now ?? Date.now;
  const identityOf = (): BootIdentity | null => deps.identity();
  const selfKeyHex = (): string | null => identityOf()?.publicKey.toString('hex') ?? null;
  const coresDir = path.join(deps.dataDir, 'cores');
  const captureTokenTtlMs = deps.captureTokenTtlMs ?? MEDIA_TICKET_TTL_MS;

  const ipc = new IpcServer({
    epoch: deps.epoch,
    port: deps.ipcPort,
    tokenVerifier: deps.tokenVerifier,
    identityStatus: {
      get isLoaded(): boolean {
        return identityOf() !== null;
      },
    },
  });
  const fanout = new EventFanout(ipc);
  const search = new SearchService({ view: deps.view, clock: { now } });

  const dispatchers = new Map<string, MediaDispatcher>();
  const router = new MediaRouter(dispatchers);

  const identidade = identityOf();
  const client = new CommunityClient({
    swarm: deps.swarm,
    clock: { now },
    ...(identidade !== null
      ? {
          signing: {
            authorKey: identidade,
            codec: opCodecSignPort(),
            opVersion: OP_VERSION,
            limits: SUBMISSION_LIMITS,
          },
        }
      : {}),
  });

  // O mapa das comunidades abertas nasce antes do runtime porque a sucessão o consulta e o
  // runtime a expõe: um dos dois tem de existir primeiro, e é o dado, não o objeto.
  const abertas = new Map<string, OpenCommunity>();
  const stateFor = (cid: string): DecisionState | null => abertas.get(cid)?.projector.ds ?? null;
  const succession = new SuccessionService({
    stateFor,
    identity: identityOf,
    communitySeed: manifestCommunitySeedPort(deps.manifest, deps.dataKey),
    sealedSeedFor: async (cid) => {
      const eu = identityOf();
      const c = abertas.get(cid);
      if (eu === null || c === undefined) return null;
      return await logEscrowPort(c.core, eu.publicKey)(cid);
    },
    submitSync: bridgeSubmitSyncPort(client),
    createContinuationCore: corestoreContinuationCorePort(coresDir),
    now,
  });
  const runtime = new CoreRuntime({ deps, ipc, fanout, client, search, router, dispatchers, open: abertas, succession });

  // ── Abertura de uma comunidade (§3.3 `open` + `host-mode`) ──────────────────────────
  const abrir = async (row: CommunityRow): Promise<OpenCommunity> => {
    const communityId = row.community_id;
    const isHost = row.is_host === 1;
    const seedPort = manifestCommunitySeedPort(deps.manifest, deps.dataKey);
    const seed = isHost ? seedPort(communityId) : null;
    const keyPair = seed === null ? null : deriveCommunityKeyPairs(seed).log;

    const core =
      deps.openCore !== undefined
        ? await deps.openCore({ communityId, coreKey: row.core_key, keyPair })
        : keyPair !== null
          ? await openWritableCore(path.join(coresDir, communityId), keyPair)
          : await openCore(path.join(coresDir, communityId), row.core_key);

    // §38.2 — o `notify` do lote, depois do commit, entra no fan-out sem intermediário.
    const projector = new Projector(deps.view, core, {
      foldBuildId: deps.foldBuildId,
      now,
      onEvent: (events) => {
        fanout.fromProjector(events);
        // §14.3(3) — no MESMO passo do lote: quem projetou o ban fecha o canal do banido.
        runtime.notifyProjected(communityId);
      },
    });
    await projector.boot();
    // §10.5 passo 6 — só a partir daqui o projector reage a `append`. Sem esta linha o
    // núcleo interpreta o log do boot e depois fica surdo: é a ligação, não o módulo.
    projector.start();

    let outbox: Outbox | null = null;
    let rpc: RpcClient | null = null;
    let host: HostSide | null = null;
    let dispatcher: MediaDispatcher;
    const paradas: Array<() => void> = [];

    if (isHost && keyPair !== null && 'append' in core) {
      // ── Modo host: as decisões de §17.4/§17.5 são tomadas aqui ──────────────────────
      const admission = new HostAdmission({
        core: core as WritableCoreHandle,
        state: projector.ds,
        makeHostRecord: hostRecordSigner(keyPair.secretKey),
        now,
      });
      const connections = new Map<string, RpcServer>();
      const empurra = (topic: string, data: Record<string, unknown>, paraKeys: readonly string[] | null): void => {
        const body = new Uint8Array(Buffer.from(JSON.stringify(data), 'utf8'));
        for (const [keyHex, server] of connections) {
          if (paraKeys !== null && !paraKeys.includes(keyHex)) continue;
          // §16.3 regra 1: at-most-once. `notify` devolvendo `false` (teto de frame, regra
          // 3, ou conexão caída) não vira fila nem retentativa.
          server.notify(topic, body);
        }
        // O host também é destinatário: ele participa da chamada como qualquer membro.
        fanout.emit({ topic, data: { communityId, ...data } }, { communityId });
      };
      const voice = new VoiceHostSessions({
        hostSecretKey: identidade?.secretKey ?? Buffer.alloc(64),
        hostTurnSecret: deps.hostTurnSecret(communityId),
        clock: { now },
        ttlMs: MEDIA_TICKET_TTL_MS,
        maxParticipants: MAX_VOICE_PARTICIPANTS,
        maxCameras: MAX_CAMERAS,
        isVoiceChannelType: (type) => type === CHANNEL_TYPE.voice,
        onRosterChanged: (snapshot: RosterSnapshot) => {
          const alvos = snapshot.participants.map((p) => p.keyHex);
          empurra('voice.roster', { sessionId: snapshot.sessionId, channelId: snapshot.channelId, participants: snapshot.participants }, alvos);
        },
        onRevoked: (targets: readonly RevokedTarget[]) => {
          for (const t of targets) {
            empurra('voice.revoked', { targetKey: t.targetKeyHex, sessionId: t.sessionId }, [t.targetKeyHex]);
          }
        },
      });
      const share = new ShareHostSessions({
        hostSecretKey: identidade?.secretKey ?? Buffer.alloc(64),
        clock: { now },
        ttlMs: MEDIA_TICKET_TTL_MS,
        captureTokenTtlMs,
        maxViewers: SHARE_MAX_VIEWERS,
        isVoiceChannelType: (type) => type === CHANNEL_TYPE.voice,
        voiceParticipants: (channelId) => {
          const session = voice.sessionOf(channelId);
          return session === null ? null : new Set(session.participants.map((p) => p.keyHex));
        },
        onSessionEvent: (ev: ShareSessionEvent) => {
          const alvos = destinatariosDaTela(voice, ev);
          if (ev.kind === 'started') {
            empurra('share.started', { sessionId: ev.sessionId, presenterKey: ev.presenterKeyHex, channelId: ev.channelId }, alvos);
          } else if (ev.kind === 'viewersChanged') {
            empurra('share.viewersChanged', { sessionId: ev.sessionId, viewerCount: ev.viewerCount }, alvos);
          } else {
            empurra('share.stopped', { sessionId: ev.sessionId }, alvos);
          }
          router.observeSession(communityId, ev.sessionId);
        },
      });
      host = { admission, voice, share, connections };
      dispatcher = localMediaDispatcher({
        voiceStateFor: (cid) => (cid === communityId ? voiceStateOf(projector.ds) : null),
        selfKeyHex,
        currentSessionId: () => voice.currentSessionOf(selfKeyHex() ?? '')?.sessionId ?? null,
        host: voice,
        share,
        deliverSignal: peerSignalRelay((toPeerKeyHex) => connections.get(toPeerKeyHex) ?? null).deliver,
      });
      client.addCommunity({ communityId, core, projector, isHosted: true, hostSubmit: localHostSubmitPort(admission) });
    } else {
      // ── Modo membro: a decisão continua no host, e o canal de §16.1 a carrega ────────
      rpc = new RpcClient({ protocol: 'community', transport: null, role: 'member' });
      outbox = new Outbox({
        manifest: deps.manifest,
        communityId,
        submit: rpcSubmitPort(rpc),
        observation: {
          observedOp: (id) => projector.observedOp(id),
          watermark: (item) => {
            const eu = identityOf();
            return eu === null ? -1 : projector.authorWatermark(eu.publicKey, item.sequence_scope);
          },
          interpretedSeq: () => projector.interpretedSeq,
          resolveTarget: envelopeTargetResolver(),
        },
        // §38.2 — o desfecho de cada item entra no mesmo fan-out, com a comunidade por rota.
        onOutcome: fanout.fromOutbox(communityId),
        now,
      });
      // §3.3 `reconcile` / §11.6: `sending` sem desfecho volta a `queued` no boot, sem
      // consumir tentativa. É o primeiro dos três gatilhos da reconciliação.
      outbox.recoverOnBoot();
      dispatcher = remoteMediaDispatcher(rpc, { captureTokenTtlMs, now });
      client.addCommunity({ communityId, core, projector, outbox, hostSubmit: rpcHostSubmitPort(rpc) });
    }

    dispatchers.set(communityId, dispatcher);

    // §17.4 emendado + §16.3: a cadência de renovação e a entrada das notificações. Em modo
    // host não há `notifications` — quem hospeda produz os eventos, não os recebe.
    const eu = identityOf();
    const runtimeMidia = startMediaRuntime({
      dispatcher,
      communityId,
      emit: (events) => {
        for (const ev of events) {
          router.observeSession(communityId, ev.data['sessionId']);
          fanout.emit(ev, { communityId });
        }
      },
      ...(rpc !== null ? { notifications: rpc } : {}),
      ...(eu !== null ? { selfPublicKey: eu.publicKey } : {}),
      hostPublicKey: projector.ds.community.hostKey,
      ticketPeriodMs: Math.floor(MEDIA_TICKET_TTL_MS / 3),
      now,
      ...(deps.schedule !== undefined ? { schedule: deps.schedule } : {}),
      ...(deps.cancel !== undefined ? { cancel: deps.cancel } : {}),
    });
    paradas.push(() => runtimeMidia.stop());

    return {
      communityId,
      isHost,
      core,
      projector,
      outbox,
      rpc,
      dispatcher,
      host,
      stop() {
        for (const p of paradas) p();
        projector.stop();
      },
    };
  };

  // ── §3.3 `open`: `manifest.communities` é a enumeração autoritativa de participação ──
  const rows = (deps.manifest.listCommunities() as CommunityRow[]).filter((r) => r.left_at === null);
  for (const row of rows) {
    // "Core ilegível → `degraded` só naquela comunidade; as outras seguem" (§3.3).
    try {
      runtime.register(await abrir(row));
    } catch (err) {
      fanout.emit({
        topic: 'host.statusChanged',
        data: { communityId: row.community_id, status: 'degraded', reason: (err as { code?: string }).code ?? 'E_INTERNAL' },
      });
    }
  }

  // ── Portas de §35.2/§37.2 sobre o que ficou aberto ──────────────────────────────────
  const leave = communityLeavePort({
    client,
    manifest: deps.manifest,
    outboxOf: (cid) => runtime.get(cid)?.outbox ?? undefined,
    selfKeyHex,
  });

  registerCoreCommands(ipc, {
    ...(deps.diagnostics !== undefined ? { diagnostics: deps.diagnostics } : {}),
    search,
    succession,
    media: { dispatcher: router },
    messages: {
      writeStateFor: (cid) => client.writeStateFor(cid),
      selfKeyHex,
      submitQueued: (cid, input) => client.submitQueued(cid, input),
      retryQueued: (opId) => outboxDe(deps.manifest, runtime, opId).retry(opId),
      cancelQueued: (opId) => outboxDe(deps.manifest, runtime, opId).cancelQueued(opId),
    },
    community: {
      leave: (cid) => {
        const r = leave(cid);
        if (r.ok) runtime.forget(cid);
        return r;
      },
    },
    communityQuery: queryCommunityPort({
      stateFor,
      selfKeyHex,
      replicationOf: (cid) => client.getState(cid) ?? { state: 'catching-up', lag: 0 },
      pendingReentryOf: (cid) => succession.pendingReentry(cid),
    }),
    exitImpact: hostExitImpactPort({
      get communities() {
        return runtime
          .communities()
          .filter((c) => c.isHost)
          .map((c) => ({ communityId: c.communityId, name: c.projector.ds.community.name }));
      },
      onlineCount: (cid) => runtime.get(cid)?.host?.connections.size ?? 0,
      inCallCount: (cid) => runtime.get(cid)?.host?.voice.sessionCount ?? 0,
      pendingReplication: (cid) => {
        const c = runtime.get(cid);
        return c === undefined ? 0 : Math.max(c.core.length - 1 - c.projector.interpretedSeq, 0);
      },
    } as Parameters<typeof hostExitImpactPort>[0]),
    ...(deps.extraCommands ?? {}),
  } as CoreCommandDeps);

  return runtime;
}

/**
 * Fila em que um `opId` vive. §11.2 dá **uma outbox por comunidade** e §15.4 (`message.retry`,
 * `message.cancelQueued`) manda só o id: quem sabe a que comunidade ele pertence é a linha em
 * `local_outbox`, e é ela que decide o destino — nunca uma varredura que tocaria as demais.
 */
function outboxDe(manifest: ManifestDb, runtime: CoreRuntime, opId: string): Pick<Outbox, 'retry' | 'cancelQueued'> {
  const row = manifest.byOpId(opId);
  const outbox = row === undefined ? null : (runtime.get(row.community_id)?.outbox ?? null);
  if (outbox !== null) return outbox;
  return {
    retry: () => ({ ok: false, code: 'E_NOT_FOUND' }),
    cancelQueued: () => ({ ok: false, code: 'E_NOT_FOUND' }),
  };
}

/** §17.5 — `share.health` é só ao apresentador; os demais eventos vão aos da chamada. */
function destinatariosDaTela(voice: VoiceHostSessions, ev: ShareSessionEvent): readonly string[] | null {
  if (ev.kind !== 'started') return null;
  const session = voice.sessionOf(ev.channelId);
  return session === null ? [] : session.participants.map((p) => p.keyHex);
}
