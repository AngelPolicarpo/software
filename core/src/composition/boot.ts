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

import fs from 'node:fs';
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
import { InviteManager } from '../l2/invites/index.ts';
import { SearchService } from '../l2/search/index.ts';
import { SuccessionService } from '../l2/succession/index.ts';
import {
  VoiceHostSessions,
  type RevokedTarget,
  type RosterSnapshot,
} from '../l2/voiceCoordinator/index.ts';
import { ShareHostSessions, type ShareSessionEvent } from '../l2/shareStar/index.ts';
import type { Diagnostics } from '../l2/diagnostics/index.ts';
import { BlobManager } from '../l2/blobs/index.ts';
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
import type { CommunityTransport } from './transport.ts';
import { RpcClient } from '../l3/rpcClient/index.ts';
import { RpcServer, type RpcTransportPort } from '../l3/rpcServer/index.ts';
import { peerSignalRelay } from '../l3/rpcServer/media.ts';
import { AdmissionService, type AdmissionServiceDeps } from './admission.ts';
import {
  aeadOpenPacked,
  aeadSealPacked,
  createCommunity,
  inviteCreate,
  inviteRevoke,
  memberBlobsKeyPairFor,
  type BootIdentityLike,
  type CreateCommunityInput,
  type InviteCreateArgs,
} from './community.ts';
import { startJobs, type JobRunner } from './jobs.ts';
import {
  memberSetNickname,
  memberSetRoles,
  modBan,
  modKick,
  modRemoveTimeout,
  modRevokeBan,
  modTimeout,
  roleCreate,
  roleDelete,
  roleMove,
  roleUpdate,
} from './moderation.ts';
import { queryReadPorts } from './queries.ts';
import {
  categoryCreate,
  categoryDelete,
  categoryRename,
  channelCreate,
  channelDelete,
  channelMove,
  channelUpdate,
  communityUpdate,
} from './structure.ts';
import {
  SUBMISSION_LIMITS,
  admissionSubmitPort,
  blobAttachmentPort,
  blobCorePorts,
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
  queryInvitesPort,
  rpcHostSubmitPort,
  rpcSubmitPort,
  viewAttachmentResolver,
  voiceStateOf,
  wireHostMediaRpc,
  wireHostRpc,
  type HelloInfo,
} from './ports.ts';

/** Identidade local de §5.5 — `null` no estado `awaiting-identity` de §3.3. */
export type BootIdentity = { readonly publicKey: Buffer; readonly secretKey: Buffer };

/** Linha de `manifest.communities` (§10.2) recortada no que o boot lê. */
export type CommunityRow = {
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
  /** Perfil local (`displayName`/`avatarColor`) para o `member.join` da gênese e do resgate. */
  identityProfile?(): { readonly displayName: string; readonly avatarColor: number } | null;
  /** §24.3 — depende de sonda de NAT/STUN, que é transporte; chega pronto. */
  readonly diagnostics?: Diagnostics;
  /**
   * O diálogo do main que origina todo caminho de anexo (§13.3, §15.7). Sem ele,
   * `file.pickForAttachment` responde `E_CANCELLED` — o produto liga quando o shell
   * Electron existir; o núcleo nunca aceita caminho de renderer.
   */
  pickFile?(communityId: string): { readonly path: string; readonly sizeBytes: number } | null;
  /** `shell.open` do main (§15.7) — destino dos `blob.reveal` aprovados pela allowlist. */
  onReveal?(a: { readonly path: string; readonly mode: 'open' | 'folder' }): void;
  /** Demais superfícies de §15.4 que o boot não constrói (relay). */
  readonly extraCommands?: Pick<CoreCommandDeps, 'relay' | 'relayConsent' | 'partialReason'>;
  readonly now?: () => number;
  /** Injetáveis só para teste determinístico; em produto são os do `globalThis`. */
  readonly schedule?: (fn: () => void, ms: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
  /** §17.5 — validade do `captureToken` local (§17.4 emendado). */
  readonly captureTokenTtlMs?: number;
  /**
   * Quanto uma op ⏱ de estrutura espera a projeção local antes de responder sem os campos
   * derivados (`rank`, contagens de `category.delete`). O padrão de produto é curto — a
   * resposta não pode ficar presa à replicação de quem não hospeda; o teste alonga para
   * não depender da carga da máquina.
   */
  readonly projectionWaitMs?: number;
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
  /**
   * A superfície de convites desta comunidade hospedada (§12): emite challenge, valida
   * preview/resgate e concilia os anúncios na DHT a cada lote projetado.
   */
  readonly invites: InviteManager;
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
  /** Anexos de §13 — um manager por instalação, com os cores de blobs locais por comunidade. */
  readonly blobs: BlobManager;
  /**
   * Os jobs periódicos de §22.2 com dono em código (`invite.topicSweep`, `blob.gc`).
   * Anexado depois da construção porque dois deles dependem de serviços que nascem sobre o
   * runtime — `stop()` entra no `close`, que é o escopo de §22.5.
   */
  jobs: JobRunner | null = null;
  readonly #deps: BootDeps;
  readonly #open: Map<string, OpenCommunity>;
  readonly #dispatchers: Map<string, MediaDispatcher>;
  readonly #router: MediaRouter;
  readonly #now: () => number;
  readonly #onProjected = new Set<(communityId: string) => void>();
  readonly #onOpen = new Set<(communityId: string) => void>();
  #transport: CommunityTransport | null = null;
  readonly #onTransport = new Set<(transport: CommunityTransport) => void>();

  constructor(a: {
    deps: BootDeps;
    ipc: IpcServer;
    fanout: EventFanout;
    client: CommunityClient;
    succession: SuccessionService;
    search: SearchService;
    blobs: BlobManager;
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
    this.blobs = a.blobs;
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

  /**
   * Uma comunidade nova entrou no runtime (`register`). O transporte assina para entrar no
   * tópico dela na hora — sem isso, uma comunidade que nasce depois do boot nunca seria
   * anunciada nem procurada.
   */
  onOpen(cb: (communityId: string) => void): () => void {
    this.#onOpen.add(cb);
    return () => this.#onOpen.delete(cb);
  }

  /**
   * O transporte real chega **depois** do boot (`startCommunityTransport` é de quem sobe o
   * processo). As superfícies que precisam dele — hoje, `invite.resolve`/`invite.redeem` —
   * esperam por este anexo; sem transporte, a admissão pela rede é impossível e responde
   * `E_HOST_UNAVAILABLE`.
   */
  attachTransport(transport: CommunityTransport): void {
    this.#transport = transport;
    for (const cb of this.#onTransport) cb(transport);
  }

  /** Transporte já anexado, ou o primeiro que anexar. Resolve `null` se fechar sem rede. */
  whenTransport(): Promise<CommunityTransport | null> {
    const atual = this.#transport;
    if (atual !== null) return Promise.resolve(atual);
    return new Promise((resolve) => {
      const desregistro = this.onTransport((t) => {
        desregistro();
        resolve(t);
      });
    });
  }

  onTransport(cb: (transport: CommunityTransport) => void): () => void {
    this.#onTransport.add(cb);
    return () => this.#onTransport.delete(cb);
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
    // §22.5 — nenhum job sobrevive ao fechamento do escopo dele.
    this.jobs?.stop();
    this.jobs = null;
    await this.blobs.close();
    this.client.close();
  }

  /** @internal — usado pelo `bootCore` e por quem abre comunidade depois do boot. */
  register(c: OpenCommunity): void {
    this.#open.set(c.communityId, c);
    this.#dispatchers.set(c.communityId, c.dispatcher);
    for (const cb of this.#onOpen) cb(c.communityId);
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

  /**
   * Abre uma comunidade pela linha de `manifest.communities` (§3.3 fases `open` +
   * `host-mode`) e devolve-a **sem registrá-la** — o chamador decide (`register`).
   *
   * Era um closure dentro do `bootCore`; virou método porque uma comunidade que nasce
   * depois do boot — por `community.create`, por `invite.redeem`, e também a continuação
   * de §18.8 quando descoberta — precisa deste mesmo caminho sem reiniciar o processo.
   */
  async openCommunity(row: CommunityRow): Promise<OpenCommunity> {
    const deps = this.#deps;
    const now = this.#now;
    const communityId = row.community_id;
    const isHost = row.is_host === 1;
    const coresDir = path.join(deps.dataDir, 'cores');
    const captureTokenTtlMs = deps.captureTokenTtlMs ?? MEDIA_TICKET_TTL_MS;
    const identidade = deps.identity();
    const selfKeyHex = (): string | null => identidade?.publicKey.toString('hex') ?? null;
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
        this.fanout.fromProjector(events);
        // §14.3(3) — no MESMO passo do lote: quem projetou o ban fecha o canal do banido.
        this.notifyProjected(communityId);
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

    // §13.1/§19.1 passo 3 — o core de blobs LOCAL desta comunidade é **derivado** da
    // identidade (`ns/memberblobs/1' ‖ identitySeed ‖ communityId`); a linha
    // `member_blobs_core` (§10.2) guarda a mesma semente cifrada pela Data Key como atalho
    // e verificação cruzada. Derivar é o que torna o core recuperável só com o backup de
    // §5.5, que nunca carregou esta semente. Quem tem o core anuncia o tópico de §14.1 e o
    // replica nos muxes vivos; falha aqui não derruba a comunidade — anexo é subsistema
    // dela, não o log.
    const linhaBlobs = deps.manifest.getMemberBlobsCore(communityId);
    const sementeGravada =
      linhaBlobs === null ? null : aeadOpenPacked(Buffer.from(linhaBlobs.secretSeedEnc), deps.dataKey);
    const sementeBlobs =
      identidade !== null
        ? memberBlobsKeyPairFor(identidade, communityId).seed
        : sementeGravada !== null && sementeGravada.length === 32
          ? sementeGravada
          : null;
    // A chave a bater é a que o log publicou em `member.join`/`member.setBlobsCore` — dado
    // de réplica, não local. A linha do manifest é a cópia usada enquanto o log desta
    // instalação ainda não tem a entrada do próprio (comunidade recém-criada no mesmo tick).
    const chaveDeBlobsPublicada = ((): Buffer | null => {
      const eu = selfKeyHex();
      const doLog = eu === null ? undefined : projector.ds.members.get(eu)?.blobsCoreKey;
      if (doLog !== undefined) return Buffer.from(doLog);
      return linhaBlobs === null || linhaBlobs.coreKey.length !== 32 ? null : Buffer.from(linhaBlobs.coreKey);
    })();
    if (sementeBlobs !== null) {
      try {
        const writer = await blobCorePorts(coresDir).openWriter(sementeBlobs);
        // A chave derivada TEM que ser a que o log publicou; divergência é corrupção local
        // (ou dado de instalação anterior à derivação) — não escrever em core algum com ela.
        if (chaveDeBlobsPublicada !== null && writer.key.equals(chaveDeBlobsPublicada)) {
          this.blobs.attachLocalCore(communityId, writer);
          // Reescreve o atalho quando ele faltava ou estava ilegível: a linha é derivada da
          // identidade, então recriá-la é reparo local — é este caminho que devolve os
          // anexos a quem restaurou a identidade sem o `manifest.db` (§5.5).
          if (linhaBlobs === null || sementeGravada === null) {
            deps.manifest.setMemberBlobsCore({
              communityId,
              coreKey: writer.key,
              secretSeedEnc: aeadSealPacked(sementeBlobs, deps.dataKey),
            });
          }
          paradas.push(() => {
            void this.blobs.detachLocalCore(communityId);
          });
        } else {
          await writer.close().catch(() => {});
        }
      } catch {
        // Sem core de blobs local, `blob.stage` recusa (`E_NO_BLOBS_KEY`) e o resto segue.
      }
    }

    const observacao = {
      observedOp: (id: string) => projector.observedOp(id),
      watermark: (item: { readonly sequence_scope: string }) => {
        const eu = identidade;
        return eu === null ? -1 : projector.authorWatermark(eu.publicKey, item.sequence_scope);
      },
      interpretedSeq: () => projector.interpretedSeq,
      resolveTarget: envelopeTargetResolver(),
    };

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
        this.fanout.emit({ topic, data: { communityId, ...data } }, { communityId });
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
          this.#router.observeSession(communityId, ev.sessionId);
        },
      });
      // §12 — a superfície de convites é do hospedeiro: challenge, preview, resgate e a
      // conciliação dos anúncios na DHT (§12.2 passo 3), reavaliada a cada lote projetado.
      const invites = new InviteManager({
        communityId,
        swarm: deps.swarm,
        manifest: deps.manifest,
        hostAdmission: admission,
        getDecisionState: () => projector.ds,
        hostPublicKey: identidade?.publicKey ?? Buffer.alloc(32),
        clock: { now },
        preMemberBudget: deps.swarm.budget.preMemberBudget,
      });
      host = { admission, voice, share, connections, invites };
      dispatcher = localMediaDispatcher({
        voiceStateFor: (cid) => (cid === communityId ? voiceStateOf(projector.ds) : null),
        selfKeyHex,
        currentSessionId: () => voice.currentSessionOf(selfKeyHex() ?? '')?.sessionId ?? null,
        host: voice,
        share,
        deliverSignal: peerSignalRelay((toPeerKeyHex) => connections.get(toPeerKeyHex) ?? null).deliver,
      });
      // §11.2 — fila durável também em modo host: quem escreve na própria comunidade
      // consome `authorSeq` da mesma fonte durável (`local_author_seq`) e tem a mesma
      // reconciliação de boot. A submissão é local — a fila de admissão de §11.4 está
      // neste processo, então não há round-trip nenhum.
      outbox = new Outbox({
        manifest: deps.manifest,
        communityId,
        submit: admissionSubmitPort(admission),
        observation: observacao,
        onOutcome: this.fanout.fromOutbox(communityId),
        now,
      });
      outbox.recoverOnBoot();
      this.client.addCommunity({ communityId, core, projector, outbox, isHosted: true, hostSubmit: localHostSubmitPort(admission) });
      // §12.2 passo 3 — entra/sai dos tópicos de convite conforme o DS projetado: convite
      // criado por qualquer membro chega pelo log e é anunciado daqui; revogado/expirado/
      // esgotado deixa de ser anunciado no lote que o registrou.
      paradas.push(
        this.onProjected((cid) => {
          if (cid === communityId) invites.syncAnnouncements(now());
        }),
      );
    } else {
      // ── Modo membro: a decisão continua no host, e o canal de §16.1 a carrega ────────
      rpc = new RpcClient({ protocol: 'community', transport: null, role: 'member' });
      outbox = new Outbox({
        manifest: deps.manifest,
        communityId,
        submit: rpcSubmitPort(rpc),
        observation: observacao,
        // §38.2 — o desfecho de cada item entra no mesmo fan-out, com a comunidade por rota.
        onOutcome: this.fanout.fromOutbox(communityId),
        now,
      });
      // §3.3 `reconcile` / §11.6: `sending` sem desfecho volta a `queued` no boot, sem
      // consumir tentativa. É o primeiro dos três gatilhos da reconciliação.
      outbox.recoverOnBoot();
      dispatcher = remoteMediaDispatcher(rpc, { captureTokenTtlMs, now });
      this.client.addCommunity({ communityId, core, projector, outbox, hostSubmit: rpcHostSubmitPort(rpc) });
    }

    this.#dispatchers.set(communityId, dispatcher);

    // §17.4 emendado + §16.3: a cadência de renovação e a entrada das notificações. Em modo
    // host não há `notifications` — quem hospeda produz os eventos, não os recebe.
    const runtimeMidia = startMediaRuntime({
      dispatcher,
      communityId,
      emit: (events) => {
        for (const ev of events) {
          this.#router.observeSession(communityId, ev.data['sessionId']);
          this.fanout.emit(ev, { communityId });
        }
      },
      ...(rpc !== null ? { notifications: rpc } : {}),
      ...(identidade !== null ? { selfPublicKey: identidade.publicKey } : {}),
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

  // ── Anexos (§13): o manager sobre o layout de §10.1, com os eventos de §15.5 no fan-out ──
  // Um manager por instalação; os cores de blobs locais entram por comunidade no
  // `openCommunity`, nascidos do `member_blobs_core.secret_seed_enc`.
  const blobs = new BlobManager({
    manifest: deps.manifest,
    swarm: deps.swarm,
    dataDir: deps.dataDir,
    clock: now,
    openReader: blobCorePorts(coresDir).openReader,
    // R-14 antecipada no `blob.stage` (§15.4): o número é o do DS — `storageUsedBytes` do
    // próprio membro —, o mesmo que o `fold` usará no `message.send`. Sem membro ativo
    // (ainda não projetado, comunidade alheia) não há cota a antecipar: `null`.
    storageUsedOf: (cid) => {
      const eu = selfKeyHex();
      const ds = abertas.get(cid)?.projector.ds;
      const membro = eu === null || ds === undefined ? undefined : ds.members.get(eu);
      return membro?.storageUsedBytes ?? null;
    },
    // §13.4 passo 4 — `hostAvailable` é o `hostKey` corrente do log entre os pares que
    // anunciam ter a faixa; muda por `community.assumeHost` (§18.8), então lê-se do DS.
    hostKeyOf: (cid) => abertas.get(cid)?.projector.ds.community.hostKey ?? null,
    onEvent: (ev) => {
      // A rota viaja ao lado do evento (§15.1 regra 2); o payload é o da tabela de §15.5.
      fanout.emit({ topic: ev.topic, data: ev.data }, ev.communityId !== undefined ? { communityId: ev.communityId } : undefined);
    },
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
  const runtime = new CoreRuntime({ deps, ipc, fanout, client, search, succession, blobs, router, dispatchers, open: abertas });

  // ── §3.3 `open`: `manifest.communities` é a enumeração autoritativa de participação ──
  const todasAsLinhas = deps.manifest.listCommunities() as CommunityRow[];
  // §5.3 passo 2 — a linha órfã: semente gravada, core nunca criado (o processo morreu no
  // meio de `community.create`). "A linha órfã é limpa no boot". O critério é o armazenamento
  // do core não existir — e só há caminho de produto quando o boot abre cores de disco;
  // com `openCore` injetado (teste) o diretório não é o que prova existência.
  if (deps.openCore === undefined) {
    for (const row of todasAsLinhas) {
      if (row.is_host !== 1) continue;
      if (!fs.existsSync(path.join(deps.dataDir, 'cores', row.community_id))) {
        deps.manifest.deleteCommunity(row.community_id);
      }
    }
  }
  const rows = todasAsLinhas.filter((r) => r.left_at === null);
  for (const row of rows) {
    // "Core ilegível → `degraded` só naquela comunidade; as outras seguem" (§3.3).
    try {
      runtime.register(await runtime.openCommunity(row));
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

  // ── Admissão: nascer, convidar, resolver e resgatar (§12, §15.4, §19.1) ─────────────
  // O serviço sobe junto com o boot; o transporte real anexa-se depois (`attachTransport`)
  // e é o gancho `onTransport` que liga as duas metades do `p2p-admission/1`.
  const selfKeyComposto = (): BootIdentityLike | null => {
    const id = identityOf();
    if (id === null) return null;
    const perfil = deps.identityProfile?.() ?? null;
    return {
      publicKey: id.publicKey,
      secretKey: id.secretKey,
      ...(perfil !== null ? { displayName: perfil.displayName, avatarColor: perfil.avatarColor } : {}),
    };
  };
  const depsAdmissao = {
    runtime,
    swarm: deps.swarm,
    manifest: deps.manifest,
    dataKey: deps.dataKey,
    coresDir,
    selfKey: selfKeyComposto,
    profile: () => deps.identityProfile?.() ?? null,
    now,
  } satisfies AdmissionServiceDeps;
  // As ops de estrutura usam a mesma raiz de dependências da admissão, mais o prazo de
  // espera da projeção (§15.4 responde `rank`, e quem calcula `rank` é o `fold`).
  const depsEstrutura = {
    ...depsAdmissao,
    ...(deps.projectionWaitMs !== undefined ? { projectionWaitMs: deps.projectionWaitMs } : {}),
  };
  const admissao = new AdmissionService(depsAdmissao);

  // ── Jobs de §22.2 com dono em código ───────────────────────────────────────────────
  //
  // `invite.topicSweep`: convite **expira** sem registro no log, então a reconciliação por
  // lote projetado não basta — sem este job, uma comunidade parada anuncia convite vencido.
  // `blob.gc`: LRU do cache de §13.8 (blobs enviados por mim com mensagem viva são
  // protegidos, §13.7 regra 2) e fechamento dos leitores esparsos que perderam referência.
  runtime.jobs = startJobs({
    schedule: deps.schedule ?? ((fn, ms) => setTimeout(fn, ms)),
    cancel: deps.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    jobs: {
      'invite.topicSweep': () => admissao.sweepInviteTopics(),
      'blob.gc': async () => {
        // Protegido = anexo meu com mensagem viva. A `view.db` é a fonte: a linha existe
        // enquanto a mensagem existir e não estiver tombstonada (§13.7 regra 2).
        blobs.gcCache({ isProtected: (row) => anexoProprioVivo(deps.view, identityOf(), row) });
        await blobs.gcReaders();
      },
    },
  });

  registerCoreCommands(ipc, {
    ...(deps.diagnostics !== undefined ? { diagnostics: deps.diagnostics } : {}),
    search,
    succession,
    media: { dispatcher: router },
    // §13 — anexos compostos aqui: o core local de cada comunidade, o resolver da
    // `view.db` e o diálogo do main injetado. O caminho de arquivo nunca cruza o IPC-R.
    attachments: blobAttachmentPort({
      blobs,
      blobsCoreKeyOf: (cid) => blobs.localCoreKey(cid),
      pickFile: deps.pickFile ?? (() => null),
      resolveAttachment: viewAttachmentResolver(deps.view),
      ...(deps.onReveal !== undefined ? { onReveal: deps.onReveal } : {}),
    }),
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
      create: async (input: CreateCommunityInput) => await createCommunity({ ...depsAdmissao, coresDir }, input),
    },
    invites: {
      create: async (args: InviteCreateArgs) => {
        const r = await inviteCreate(depsAdmissao, args);
        if (!r.ok) return r;
        // O fio do IPC-R leva hex; o `code` só existe NESTA resposta (§15.4).
        return {
          ok: true,
          invitePublicKey: r.invitePublicKeyHex,
          code: r.code,
          seq: r.seq,
          ...(r.expiresAt !== undefined ? { expiresAt: r.expiresAt } : {}),
          ...(r.maxUses !== undefined ? { maxUses: r.maxUses } : {}),
        };
      },
      revoke: async (args) => await inviteRevoke(depsAdmissao, { communityId: args.communityId, invitePublicKeyHex: args.invitePublicKey }),
      resolve: async ({ codeOrLink }) => await admissao.resolve({ codeOrLink }),
      redeem: async ({ codeOrLink, displayName, avatarColor }) =>
        await admissao.redeem({
          codeOrLink,
          ...(displayName !== undefined ? { displayName } : {}),
          ...(avatarColor !== undefined ? { avatarColor } : {}),
        }),
    },
    // §15.4 estrutura — as sete ops ⏱ de canal/categoria/comunidade sobre a mesma ponte de
    // submissão dos convites; a permissão é conferida no DS e revalidada pelo `fold`.
    structure: {
      channelCreate: async (a) => await channelCreate(depsEstrutura, a),
      channelUpdate: async (a) => await channelUpdate(depsEstrutura, a),
      channelMove: async (a) => await channelMove(depsEstrutura, a),
      channelDelete: async (a) => await channelDelete(depsEstrutura, a),
      categoryCreate: async (a) => await categoryCreate(depsEstrutura, a),
      categoryRename: async (a) => await categoryRename(depsEstrutura, a),
      categoryDelete: async (a) => await categoryDelete(depsEstrutura, a),
      communityUpdate: async (a) => await communityUpdate(depsEstrutura, a),
    },
    // §15.4 cargos/membros/moderação — as onze ops ⏱ sobre a mesma ponte de submissão;
    // permissão conferida no DS e revalidada pelo `fold`, hierarquia nunca duplicada aqui.
    moderation: {
      roleCreate: async (a) => await roleCreate(depsEstrutura, a),
      roleUpdate: async (a) => await roleUpdate(depsEstrutura, a),
      roleMove: async (a) => await roleMove(depsEstrutura, a),
      roleDelete: async (a) => await roleDelete(depsEstrutura, a),
      memberSetRoles: async (a) => await memberSetRoles(depsEstrutura, a),
      memberSetNickname: async (a) => await memberSetNickname(depsEstrutura, a),
      modKick: async (a) => await modKick(depsEstrutura, a),
      modBan: async (a) => await modBan(depsEstrutura, a),
      modRevokeBan: async (a) => await modRevokeBan(depsEstrutura, a),
      modTimeout: async (a) => await modTimeout(depsEstrutura, a),
      modRemoveTimeout: async (a) => await modRemoveTimeout(depsEstrutura, a),
    },
    invitesQuery: queryInvitesPort({ stateFor, manifest: deps.manifest }),
    // §15.6 leitura — a `view.db` responde; o DS nomeia quem aparece; o manifest põe por
    // cima o que é local (lido, mudo, recolhido) e o estado do cache de anexos.
    reads: queryReadPorts({
      view: deps.view,
      manifest: deps.manifest,
      stateFor,
      selfKeyHex,
      replicationOf: (cid) => client.getState(cid) ?? { state: 'catching-up', lag: 0 },
      blobs,
    }),
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
 * §13.7 regra 2 / §22.4 — o blob está **protegido** do LRU quando é anexo enviado por esta
 * identidade e a mensagem que o carrega continua viva (existe e não foi tombstonada). A
 * fonte é a `view.db`: a linha de `attachments` some com a reprojeção do log, e o
 * `deleted_at` da mensagem é o tombstone de §8.
 *
 * A chave do cache é o `blobIdHex` — os 16 primeiros bytes do hash (§13.2) —, então o
 * casamento é por prefixo de `hash`, na mesma linha em que o `blobs_core_key` bate. Sem
 * identidade local, nada é protegido: não há "meu" anexo sem "mim".
 */
function anexoProprioVivo(view: ViewDb, identity: BootIdentity | null, row: { blobsCoreKeyHex: string; blobIdHex: string }): boolean {
  if (identity === null) return false;
  if (!/^[0-9a-f]{64}$/i.test(row.blobsCoreKeyHex) || !/^[0-9a-f]{32}$/i.test(row.blobIdHex)) return false;
  const encontrado = view
    .prepare(
      'SELECT 1 FROM attachments a JOIN messages m ON m.community_id = a.community_id AND m.id = a.message_id ' +
        'WHERE a.blobs_core_key = ? AND a.owner_key = ? AND m.deleted_at IS NULL AND lower(hex(a.hash)) LIKE ? LIMIT 1',
    )
    .get(Buffer.from(row.blobsCoreKeyHex, 'hex'), identity.publicKey, `${row.blobIdHex.toLowerCase()}%`);
  return encontrado !== undefined;
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
