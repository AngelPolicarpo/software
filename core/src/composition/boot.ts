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
import { MANIFEST_SCHEMA_VERSION } from '../l0/manifest/index.ts';
import { VIEW_SCHEMA_VERSION } from '../l0/view/index.ts';
import { IDENTITY_UPDATE_KIND } from '../l2/communityClient/index.ts';
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
import { PRESENCE_TTL_MS, PRESENCE_TICK_MS, TYPING_TTL_MS, PresenceManager, type PresenceDelta, type PresenceStatus, type TypingDelta } from '../l2/presence/index.ts';
import { SearchService } from '../l2/search/index.ts';
import { SuccessionService } from '../l2/succession/index.ts';
import {
  VoiceHostSessions,
  type RevokedTarget,
  type RosterSnapshot,
} from '../l2/voiceCoordinator/index.ts';
import { ShareHostSessions, type ShareSessionEvent } from '../l2/shareStar/index.ts';
import { MediaHost } from './media.ts';
import { Diagnostics } from '../l2/diagnostics/index.ts';
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
import { HostStatusTracker, type HostStatusDeps } from './hostStatus.ts';
import { startJobs, startLoops, type JobRunner, type LoopRunner } from './jobs.ts';
import {
  aeadOpenPacked,
  aeadSealPacked,
  createCommunity,
  endCommunity,
  forgetCommunity,
  inviteCreate,
  inviteRevoke,
  memberBlobsKeyPairFor,
  type BootIdentityLike,
  type CreateCommunityInput,
  type InviteCreateArgs,
} from './community.ts';
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
import {
  categorySetCollapsed,
  channelMarkRead,
  channelSetMuted,
  navSetActive,
  settingsSetDevice,
  settingsSetNotifications,
  settingsSetParticipantVolume,
  settingsSetVolume,
  threadMarkRead,
  type PreferencesDeps,
} from './preferences.ts';
import { queryReadPorts } from './queries.ts';
import { UnreadTracker } from './unread.ts';
import type { IdentityManager } from '../l0/identity/index.ts';
import { FallbackKeystoreOracle } from '../l0/keystore/index.ts';
import {
  IdentityService,
  insecureFallbackKeystorePort,
  type IdentityKeystorePort,
  type LocalPresence,
  PRESENCE_VALUES,
} from './identity.ts';
import { executeWipe } from './wipe.ts';
import { NdjsonLogger, MetricsRegistry, serieId, type LoggerPort } from './logger.ts';
import { isAvatarColor, checkDisplayName } from '../l1/fold/index.ts';
import type { DiagnosticsMetricsPort, MetricsSnapshot } from '../l2/diagnostics/index.ts';
import {
  categoryCreate,
  categoryDelete,
  categoryRename,
  channelCreate,
  channelDelete,
  channelMove,
  channelUpdate,
  communityActivate,
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
  storeCommunitySeed,
  migrateRail,
  opCodecSignPort,
  queryCommunityPort,
  queryInvitesPort,
  rpcHostSubmitPort,
  rpcSubmitPort,
  viewAttachmentResolver,
  voiceStateOf,
  wireHostMediaRpc,
  wireHostPresenceRpc,
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
   * §15.4 "Identidade e app" — o `IdentityManager` desta instalação. Presente, os comandos
   * `identity.*` e a transição `awaiting-identity → ready` (§3.3) existem; ausente, o
   * núcleo continua servindo o resto com `identityStatus` passivo.
   */
  readonly identityManager?: IdentityManager;
  /** §3.2/A13 — o keystore via IPC-M; default é o fallback inseguro com aceite explícito. */
  readonly keystore?: IdentityKeystorePort;
  /** §5.5 export — o main grava o arquivo do backup; caminho nenhum volta daqui. */
  saveFile?(a: { readonly suggestedName: string; readonly data: Buffer }): Promise<{ ok: true } | { ok: false; code: string }>;
  /** §5.5 import — o main lê o arquivo escolhido pelo diálogo nativo. */
  readFile?(): Promise<Buffer | null>;
  /** §18.6 — depois do wipe o núcleo reinicia: quem sai é o processo (injetável em teste). */
  exit?(): void;
  /** §10.8 — o flock composto é do shell; o wipe é quem o libera por último. */
  readonly lock?: { release(): void };
  /**
   * §24.1 — o produtor NDJSON. Default: `<dataDir>/logs/core-YYYY-MM-DD.ndjson` com a
   * allowlist de §24.2. `null` desliga (rigs que não querem disco).
   */
  readonly logger?: LoggerPort | undefined;
  /** §15.3/§15.6 — canal de build; dev registra comandos `dev` e liga `debug` no log. */
  readonly buildChannel?: 'prod' | 'dev';
  /**
   * O diálogo do main que origina todo caminho de anexo (§13.3, §15.7). Sem ele,
   * `file.pickForAttachment` responde `E_CANCELLED` — o produto liga quando o shell
   * Electron existir; o núcleo nunca aceita caminho de renderer.
   */
  pickFile?(communityId: string): { readonly path: string; readonly sizeBytes: number } | Promise<{ readonly path: string; readonly sizeBytes: number } | null> | null;
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
  /**
   * Presença e digitando (§6.16, §17.6) desta comunidade. No host é também a fonte da
   * agregação que ele empurra; no membro, o destino das notificações de §16.3.
   */
  readonly presence: PresenceManager;
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
  /** Os loops permanentes de §22.1 com corpo em código (presença/digitando). Mesmo escopo. */
  loops: LoopRunner | null = null;
  /**
   * O acompanhamento da conexão com o host (DR-29/DR-33, §15.6 `HostStatus`). Anexado depois
   * da construção porque as portas dele fecham o runtime; o `openCommunity` registra cada
   * comunidade nele.
   */
  hostStatus: HostStatusTracker | null = null;
  /**
   * A fase de §3.3/§15.6 `CoreStatus.phase`. `opening` é o próprio boot; quem muda para
   * `ready` é o fim do boot (ou a identidade chegando), para `draining` é o
   * `core.shutdown`/`close`, e `stopped` fecha.
   */
  #phase: 'boot' | 'awaiting-identity' | 'opening' | 'ready' | 'draining' | 'stopped' = 'boot';
  /** §6.1 — a escolha de presença local por comunidade; default derivado da identidade. */
  readonly localPresence = new Map<string, LocalPresence>();
  /** §24.1 — anexado pelo `bootCore` depois da construção (`null` = desligado). */
  logger: LoggerPort | null = null;
  /** §24.3 — o registro central que os desfechos da fila também alimentam. */
  metricsSink: { inc(name: string, by?: number): void } | null = null;
  /**
   * §17.3 — o STUN/TURN desta instalação, um por processo porque a socket é uma só. Nasce
   * na primeira comunidade hospedada que encontrar socket; `null` sem rede (suíte unitária)
   * ou com o DHT ainda desligado.
   */
  #mediaHost: MediaHost | null = null;
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
   * §24.1 — a porta `onOutcome` das outbox com o produtor de log na frente: cada desfecho
   * vira linha (`scope:'outbox'`, msg é o desfecho) e o counter de §24.3 acompanha; o
   * fan-out segue intacto, na mesma ordem (DS-31).
   */
  outboxOutcomePort(communityId: string): ReturnType<EventFanout['fromOutbox']> {
    const base = this.fanout.fromOutbox(communityId);
    return (ev) => {
      const d = ev.data as Record<string, unknown>;
      this.logger?.info('outbox', ev.topic.replace('message.', ''), {
        communityId,
        ...(typeof d.opId === 'string' ? { opId: d.opId } : {}),
        ...(typeof d.code === 'string' ? { code: d.code } : {}),
        ...(typeof d.seq === 'number' ? { seq: d.seq } : {}),
      });
      if (ev.topic === 'message.dropped') this.metricsSink?.inc('outbox.dropped');
      base(ev);
    };
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
    // DR-29/DR-33 — o canal de §16.1 é a fonte do estado de conexão: anexo é `connecting`,
    // queda (avisada pelo MESMO transporte, que aceita vários ouvintes) vira
    // `reconnecting`/`offline` na máquina de §15.6.
    this.hostStatus?.channelAttached(a.communityId);
    a.transport.onDown(() => this.hostStatus?.channelDown(a.communityId));
    // §16.3 fluxo obrigatório — hello ANTES de qualquer outro método na conexão nova. A
    // queda anterior falhou os pendentes e esvaziou a fila, então este frame sai primeiro;
    // o loop de HELLO_INTERVAL_MS renova daí em diante.
    void this.#enviarHello(a.communityId).catch(() => {});
  }

  /**
   * §14.5/§16.3 — um `hello` para cada comunidade de MEMBRO com canal vivo: a resposta
   * alimenta `synced` (`markHello`), marca contato com o host (DR-29) e, com `opVersion`
   * incompatível, fecha o relacionamento como `incompatible` e derruba a fila
   * (`dropped/client-outdated`). É o corpo do loop `host.hello` de §22.1 (emendada).
   */
  renovarHelos(): void {
    for (const c of this.communities()) {
      if (!c.isHost) void this.#enviarHello(c.communityId).catch(() => {});
    }
  }

  async #enviarHello(communityId: string): Promise<void> {
    const c = this.#open.get(communityId);
    if (c === undefined || c.isHost || c.rpc === null) return;
    // Sem canal vivo não há tentativa real (§11.8): efêmero não enfileira no RpcClient.
    const estado = this.hostStatus?.statusOf(communityId) ?? 'unknown';
    if (estado !== 'online' && estado !== 'connecting') return;
    const corpo = new Uint8Array(
      Buffer.from(JSON.stringify({ clientVersion: this.#deps.foldBuildId, opVersion: OP_VERSION }), 'utf8'),
    );
    const r = await c.rpc.call('hello', corpo);
    if (!r.ok) return;
    let parsed: { opVersion?: unknown };
    try {
      parsed = JSON.parse(Buffer.from(r.body).toString('utf8')) as typeof parsed;
    } catch {
      return;
    }
    if (parsed.opVersion !== OP_VERSION) {
      // §16.3 — somente-leitura naquela comunidade: status `incompatible` e fila inteira
      // `dropped/client-outdated`. Itens em voo recebem o mesmo motivo pelo desfecho do host.
      this.hostStatus?.noteSubmit(communityId, [{ ok: false, code: 'E_VERSION_UNSUPPORTED' }]);
      c.outbox?.discardForVersion();
      return;
    }
    this.client.markHello(communityId, this.#now());
    // O host RESPONDEU: é contato observado, com todas as consequências de §11.8.
    this.hostStatus?.markSeen(communityId);
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
    wireHostPresenceRpc(server, { communityId: a.communityId, peerKeyHex: a.peerKeyHex, presence: c.presence });
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

  get phase(): 'boot' | 'awaiting-identity' | 'opening' | 'ready' | 'draining' | 'stopped' {
    return this.#phase;
  }

  /** @internal — a raiz de composição é quem conduz as fases de §3.3. */
  setPhase(p: 'boot' | 'awaiting-identity' | 'opening' | 'ready' | 'draining' | 'stopped'): void {
    this.#phase = p;
  }

  /** §6.1/§15.4 — `identity.setPresence` fixa o status que o refresh publica. */
  setLocalPresence(status: LocalPresence): void {
    for (const c of this.#open.keys()) this.localPresence.set(c, status);
  }

  /**
   * §15.4 `core.shutdown` / §18.7 — o draining com orçamento: flusha as filas, espera a
   * projeção alcançar a cabeça (ou o orçamento estourar, `DRAIN_BUDGET_MS` default 5 000)
   * e fecha. A barreira de §18.7 passo 2 por confirmação de PARES depende do transporte
   * medir quem confirmou `core.length`; enquanto isso não existe, o orçamento corre sobre
   * os sinais locais (fila vazia + réplica na cabeça) — pendência registrada, não silêncio.
   */
  async shutdown(a: { readonly budgetMs?: number }): Promise<{ drainedMs: number; pendingOps: number; replicatedTo: number }> {
    const now = this.#now;
    const inicio = now();
    this.setPhase('draining');
    const prazo = inicio + (a.budgetMs ?? 5_000);
    // Um giro de flush antes da espera: sem canal vivo o membro não tenta (§11.8) e a fila
    // permanece — o desfecho honesto é o contador de pendentes.
    for (const c of this.communities()) await c.outbox?.flush().catch(() => {});
    while (this.#now() < prazo) {
      let pendentes = 0;
      let atraso = false;
      for (const c of this.#open.values()) {
        pendentes += this.#deps.manifest.countActive(c.communityId);
        if (c.projector.interpretedSeq < c.core.length - 1) atraso = true;
      }
      if (pendentes === 0 && !atraso) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    let pendingOps = 0;
    let replicatedTo = Number.MAX_SAFE_INTEGER;
    for (const c of this.#open.values()) {
      pendingOps += this.#deps.manifest.countActive(c.communityId);
      replicatedTo = Math.min(replicatedTo, c.projector.interpretedSeq);
    }
    if (replicatedTo === Number.MAX_SAFE_INTEGER) replicatedTo = 0;
    const drainedMs = Math.max(0, now() - inicio);
    await this.close();
    this.setPhase('stopped');
    return { drainedMs, pendingOps, replicatedTo };
  }

  /** §3.3 `draining`/`stopped` — para os temporizadores e fecha os cores abertos aqui. */
  async close(): Promise<void> {
    if (this.#phase !== 'stopped' && this.#phase !== 'draining') this.setPhase('draining');
    // §17.3 — devolve a socket ao DHT antes de qualquer outra coisa: o classificador está no
    // caminho de TODO datagrama, e um núcleo em `draining` não deve continuar nele.
    this.#mediaHost?.close();
    this.#mediaHost = null;
    // §10.6 — snapshot no `draining`, antes de qualquer fechamento: é cache (perder custa
    // tempo de boot, nunca dado), mas custar tempo sem necessidade também é bug.
    for (const c of this.#open.values()) {
      try {
        c.projector.snapshot(this.#now());
      } catch {
        // Sem snapshot o boot reinterpreta do zero — comportamento correto, não falha.
      }
    }
    for (const c of this.#open.values()) {
      c.stop();
      await c.core.close();
    }
    this.#open.clear();
    // §22.5 — nenhum job sobrevive ao fechamento do escopo dele.
    this.jobs?.stop();
    this.jobs = null;
    this.loops?.stop();
    this.loops = null;
    this.hostStatus?.stop();
    await this.blobs.close();
    this.client.close();
    this.setPhase('stopped');
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
    this.hostStatus?.forget(communityId);
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

    // §6.16/§17.6 — presença e digitando desta comunidade. O push do host é injetado por
    // indireção porque `empurra` nasce só no ramo hospedeiro; no membro os deltas chegam
    // prontos por §16.3 e são INGERIDOS abaixo, não reemitidos (o runtime de mídia já
    // encaminha esses tópicos ao fan-out — duplicar seria evento repetido).
    let empurraPresenca: ((topic: string, data: Record<string, unknown>, alvos: readonly string[] | null) => void) | null = null;
    const presence = new PresenceManager({
      clock: { now },
      isHost: () => isHost,
      onPresenceChanged: (delta: PresenceDelta) => {
        empurraPresenca?.('presence.changed', { entries: delta.entries }, null);
      },
      onTypingChanged: (delta: TypingDelta) => {
        // §17.6 — typing NÃO é broadcast de comunidade: vai só a quem chamou
        // `subscribeChannel` naquele canal.
        const assinantes = presence.getTypingSubscribers(communityId, delta.channelId);
        empurraPresenca?.('typing.changed', { channelId: delta.channelId, identityKeys: delta.identityKeys }, assinantes);
      },
    });

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
      // §16.3/§17.6 — o push de presença/digitando usa a mesma disciplina do resto da mídia.
      empurraPresenca = empurra;
      const turnSecret = deps.hostTurnSecret(communityId);
      const voice = new VoiceHostSessions({
        hostSecretKey: identidade?.secretKey ?? Buffer.alloc(64),
        hostTurnSecret: turnSecret,
        // §17.3 — o STUN do host, na socket que o UDX já mantém aberta. Sem serviço de
        // mídia (suíte unitária, ou DHT ainda não ligado) a lista vai vazia, que é a
        // situação de L-11: só conexão direta.
        iceServers: () => this.#mediaHost?.iceServers() ?? [],
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
      // O serviço de mídia é do PROCESSO; a comunidade só se registra nele. Criar aqui, e
      // não no boot, é o que garante que ele exista quando há algo para servir: uma
      // instalação que não hospeda nada não abre porta nenhuma.
      if (this.#mediaHost === null) {
        const tap = this.#deps.swarm.backend?.mediaSocket?.() ?? null;
        if (tap !== null) this.#mediaHost = new MediaHost(tap, 'comunidade');
      }
      this.#mediaHost?.registrar({ communityId, voice, turnSecret });

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
        onOutcome: this.outboxOutcomePort(communityId),
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
      // §11.6/DS-31 — a observação da própria réplica não espera o job de 30 s: cada lote
      // projetado é um passo posterior ao seu evento (`messages.appended` já saiu no
      // `onEvent`), então reconciliar aqui emite `message.accepted` na ordem determinada
      // e a bolha otimista assenta no mesmo fôlego do append — inclusive no host local,
      // cujo append é instantâneo. Sem reenvio nenhum: reconcile só observa e remove.
      paradas.push(
        this.onProjected((cid) => {
          if (cid === communityId) outbox?.reconcile(now());
        }),
      );
    } else {
      // ── Modo membro: a decisão continua no host, e o canal de §16.1 a carrega ────────
      const canal = new RpcClient({ protocol: 'community', transport: null, role: 'member' });
      rpc = canal;
      // DR-29 — o resultado de cada passe de submissão é a fonte viva do contato com o
      // host: resposta marca `online`/`last_host_seen_at`, indisponibilidade cai para
      // `reconnecting` e `E_VERSION_UNSUPPORTED` fixa `incompatible` (§16.3).
      const submitObservado = async (envelopes: readonly Buffer[]) => {
        const r = await rpcSubmitPort(canal)(envelopes);
        this.hostStatus?.noteSubmit(communityId, r);
        return r;
      };
      outbox = new Outbox({
        manifest: deps.manifest,
        communityId,
        submit: submitObservado,
        observation: observacao,
        // §38.2 — o desfecho de cada item entra no mesmo fan-out, com a comunidade por rota.
        onOutcome: this.outboxOutcomePort(communityId),
        now,
      });
      // §3.3 `reconcile` / §11.6: `sending` sem desfecho volta a `queued` no boot, sem
      // consumir tentativa. É o primeiro dos três gatilhos da reconciliação.
      outbox.recoverOnBoot();
      // §11.6/DS-31 — membro: mesmo gatilho pós-lote do braço do host. A réplica local
      // projetou o próprio append de outro nó; se um item MEU estava no lote, o desfecho
      // sai aqui, sem esperar o job.
      paradas.push(
        this.onProjected((cid) => {
          if (cid === communityId) outbox?.reconcile(now());
        }),
      );
      dispatcher = remoteMediaDispatcher(canal, { captureTokenTtlMs, now });
      // §16.3 — presença/digitando empurrados pelo host são INGERIDOS no estado local que
      // as consultas leem. O encaminhamento ao renderer já acontece no runtime de mídia,
      // que recebe os mesmos quadros; aqui só o estado, sem evento duplicado.
      paradas.push(
        canal.onNotify((topic, body) => {
          if (topic !== 'presence.changed' && topic !== 'typing.changed') return;
          let data: Record<string, unknown>;
          try {
            const parsed = JSON.parse(Buffer.from(body).toString('utf8')) as unknown;
            data = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
          } catch {
            return; // §16.3 regra 2: quadro estranho nunca derruba a conexão
          }
          if (topic === 'presence.changed') {
            const entries = Array.isArray(data['entries']) ? data['entries'] : [];
            for (const e of entries) {
              if (typeof e !== 'object' || e === null) continue;
              const { identityKey, status } = e as Record<string, unknown>;
              if (typeof identityKey !== 'string' || typeof status !== 'string') continue;
              const lastSeenAt = typeof (e as Record<string, unknown>)['lastSeenAt'] === 'number' ? ((e as Record<string, unknown>)['lastSeenAt'] as number) : now();
              presence.ingestPresence({ communityId, identityKey, status: status as PresenceStatus, at: lastSeenAt });
            }
            return;
          }
          const channelId = data['channelId'];
          const keys = Array.isArray(data['identityKeys']) ? data['identityKeys'] : [];
          if (typeof channelId !== 'string') return;
          for (const k of keys) {
            if (typeof k !== 'string') continue;
            presence.ingestTyping({ communityId, identityKey: k, channelId, until: now() + TYPING_TTL_MS });
          }
        }),
      );
      this.client.addCommunity({ communityId, core, projector, outbox, hostSubmit: rpcHostSubmitPort(canal) });
    }

    this.#dispatchers.set(communityId, dispatcher);
    // DR-29/DR-33 — a comunidade entra no acompanhamento de conexão; modo hospedeiro nasce
    // `online` (o host sou eu), membro nasce `unknown` até o canal dizer algo.
    this.hostStatus?.ensure(communityId, { isHost });

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
      presence,
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

  // §24.1 — o produtor NDJSON nasce com o núcleo; `undefined` desliga (rigs). A rotação
  // diária é implícita no nome do arquivo; retenção/teto continuam no job `log.rotate`.
  const logger: LoggerPort =
    deps.logger !== undefined
      ? deps.logger
      : new NdjsonLogger({ dir: path.join(deps.dataDir, 'logs'), now, ...(deps.buildChannel !== undefined ? { buildChannel: deps.buildChannel } : {}) });
  // §24.3 — o registro central que o `metrics.flush` comete e o `diag.*` serve.
  const metricas = new MetricsRegistry();

  const ipc = new IpcServer({
    epoch: deps.epoch,
    port: deps.ipcPort,
    tokenVerifier: deps.tokenVerifier,
    ...(deps.buildChannel !== undefined ? { buildChannel: deps.buildChannel } : {}),
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
    // §14.5/§22.1 — as transições do watchdog (`community.replication`, `accessRevoked`,
    // `forked`) entram no mesmo fan-out, com a comunidade por rota. O log de §24.1 acompanha:
    // a transição é um dos produtores declarados desta fatia.
    onEvent: (ev) => {
      if (ev.topic === 'community.replication') {
        const { state, lag } = ev.data as { state: string; lag?: number };
        logger.info('replication', state, { communityId: String(ev.data.communityId), ...(typeof lag === 'number' ? { seq: lag } : {}) });
      }
      fanout.emit({ topic: ev.topic, data: ev.data }, { communityId: ev.data.communityId });
    },
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
  runtime.logger = logger;
  runtime.metricsSink = metricas;

  // ── §15.4 "Identidade e app" — o serviço existe quando o shell injeta o manager ──────
  const servicoIdentidade =
    deps.identityManager !== undefined
      ? new IdentityService({
          manager: deps.identityManager,
          manifest: deps.manifest,
          dataDir: deps.dataDir,
          keystore: deps.keystore ?? insecureFallbackKeystorePort(new FallbackKeystoreOracle()),
          dataKey: () => deps.dataKey,
          now,
          ...(deps.saveFile !== undefined ? { saveFile: deps.saveFile } : {}),
          ...(deps.readFile !== undefined ? { readFile: deps.readFile } : {}),
        })
      : null;

  /**
   * §3.3 — a identidade chegou num núcleo que esperava por ela: awaiting-identity → ready,
   * a ponte de escrita liga (§19.3) e o evento de §15.5 avisa. Mesmo passo para `create`
   * e para `import`.
   */
  let assinaturaLigada = identidade !== null;
  function identidadePronta(): void {
    if (!assinaturaLigada && identityOf() !== null) {
      client.setSigning({
        authorKey: identityOf()!,
        codec: opCodecSignPort(),
        opVersion: OP_VERSION,
        limits: SUBMISSION_LIMITS,
      });
      assinaturaLigada = true;
    }
    if (runtime.phase === 'awaiting-identity') {
      runtime.setPhase('ready');
      fanout.emit({ topic: 'core.ready', data: { phase: 'ready', epoch: deps.epoch } }, {});
    }
  }

  // ── DR-29/DR-33 — o acompanhamento da conexão com o host, sobre as portas do runtime ──
  // Cada transição publicada também é linha de log (§24.1): scope `host`, msg é o status.
  const hostStatusDeps: HostStatusDeps = {
    manifest: deps.manifest,
    emit: (ev, rota) => {
      logger.info('host', String((ev.data as Record<string, unknown>).status), { communityId: rota.communityId });
      fanout.emit(ev, rota);
    },
    now,
    schedule: deps.schedule ?? ((fn, ms) => setTimeout(fn, ms)),
    cancel: deps.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    outboxOf: (cid) => runtime.get(cid)?.outbox ?? undefined,
    stateFor,
    replicationStateOf: (cid) => client.getState(cid)?.state ?? null,
    selfKeyHex,
  };
  runtime.hostStatus = new HostStatusTracker(hostStatusDeps);

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

  // ── Não-lidas de §6.15 — o recálculo no lote projetado (emenda de 2026-08-22) ───────
  // O projector não escreve LS (o `Effect` de §8.4 é fechado sobre CS) e a contagem é por
  // instalação, então quem calcula é a raiz, disparada pelo MESMO passo do fan-out.
  const naoLidas = new UnreadTracker({
    manifest: deps.manifest,
    view: deps.view,
    comunidade: (cid) => runtime.get(cid)?.projector ?? null,
    selfKeyHex,
    emit: (ev, rota) => fanout.emit(ev, rota),
  });
  naoLidas.attach(runtime);
  const depsPreferencias: PreferencesDeps = { manifest: deps.manifest, naoLidas };

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
  // Os demais corpos têm a seção que os define: `outbox.expire` reconcilia antes de
  // descartar por idade (§11.6); `staging.gc` confere referência na `view.db` (§13.5);
  // `removed.purge` apaga a réplica vencida (§18.4); `db.maintenance` cuida dos PRAGMAs e
  // do WAL; `log.rotate` aplica retenção/teto de §24.1; `succession.check` avalia o grace
  // period de §18.8.
  const agendar = deps.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancelar = deps.cancel ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  runtime.jobs = startJobs({
    schedule: agendar,
    cancel: cancelar,
    jobs: {
      'invite.topicSweep': () => admissao.sweepInviteTopics(),
      'blob.gc': async () => {
        // Protegido = anexo meu com mensagem viva. A `view.db` é a fonte: a linha existe
        // enquanto a mensagem existir e não estiver tombstonada (§13.7 regra 2).
        blobs.gcCache({ isProtected: (row) => anexoProprioVivo(deps.view, identityOf(), row) });
        await blobs.gcReaders();
      },
      'outbox.expire': () => {
        for (const c of runtime.communities()) c.outbox?.reconcile(now());
      },
      'host.inactivity': () => {
        runtime.hostStatus?.runInactivity();
      },
      'staging.gc': () => {
        blobs.staging.gcOrphan({
          now: now(),
          hasReference: (row) => stagingReferenciado(deps.view, deps.manifest, blobs, row),
          clearBlobs: (row) => {
            if (row.communityId === null || row.blobRanges === null) return;
            void blobs
              .clearLocalRange(row.communityId, row.blobRanges.blockOffset, row.blobRanges.blockOffset + row.blobRanges.blockLength - 1)
              .catch(() => {});
          },
        });
      },
      'removed.purge': async () => {
        await purgeRemovidas({
          runtime,
          client,
          manifest: deps.manifest,
          view: deps.view,
          dataDir: deps.dataDir,
          now,
        });
      },
      'db.maintenance': () => {
        manutencaoDeBancos([deps.manifest, deps.view]);
      },
      'log.rotate': () => {
        rotacionarLogs(path.join(deps.dataDir, 'logs'), now());
      },
      'succession.check': () => {
        for (const c of runtime.communities()) succession.checkEligibility(c.communityId);
      },
    },
  });

  // ── Loops permanentes de §22.1 com corpo em código (presença/digitando) ────────────
  // A escolha de presença é da identidade (`identity.setPresence`, §15.4): o comando fixa
  // `runtime.localPresence` e o refresh publica. O default é o persistido no perfil — e,
  // sem escolha gravada, `online`, que o refresh mantém vivo contra o TTL de 45 s.
  const escolhida = deps.identityManager?.record?.presence;
  const defaultPresenca: LocalPresence =
    escolhida !== undefined && (PRESENCE_VALUES as readonly string[]).includes(escolhida)
      ? (escolhida as LocalPresence)
      : 'online';
  for (const c of abertas.keys()) runtime.localPresence.set(c, defaultPresenca);
  runtime.loops = startLoops({
    schedule: agendar,
    cancel: cancelar,
    loops: {
      // §22.1 outbox.flush — um giro por segundo em todo nó. Em modo membro só com canal
      // vivo: submeter sem conexão não é tentativa real de entrega (§11.8), queimaria
      // tentativa/backoff e inflaria a fila do RpcClient sem destino.
      'outbox.flush': async () => {
        for (const c of runtime.communities()) {
          if (c.outbox === null) continue;
          if (!c.isHost) {
            const estado = runtime.hostStatus?.statusOf(c.communityId) ?? 'unknown';
            if (estado !== 'online' && estado !== 'connecting') continue;
          }
          await c.outbox.flush().catch(() => {});
        }
      },
      // §22.1 outbox.reconcile — OUTBOX_RECONCILE_MS; o boot e o cameBack disparam fora da
      // cadência (§11.6).
      'outbox.reconcile': () => {
        const agora = now();
        for (const c of runtime.communities()) c.outbox?.reconcile(agora);
      },
      // §22.1 replication.watchdog — REPLICATION_WATCH_MS; as transições saem pelo
      // `CommunityClient.onEvent`, ligado ao fan-out acima.
      'replication.watchdog': () => {
        client.watchdogTick(now());
      },
      // §22.1 host.hello (emenda de 2026-08-23) — HELLO_INTERVAL_MS em todo nó membro;
      // a primeira conexão já recebe hello direto do `attachHostChannel` (§16.3).
      'host.hello': () => {
        runtime.renovarHelos();
      },
      // §17.6 — o host agrega presença em delta consolidado a cada PRESENCE_TICK_MS.
      'presence.tick': () => {
        for (const c of runtime.communities()) {
          if (!c.isHost) continue;
          c.presence.tick();
        }
      },
      // §17.6 — TTL 5 s do typing, varrido por segundo no host.
      'typing.expire': () => {
        for (const c of runtime.communities()) {
          if (!c.isHost) continue;
          c.presence.expireTyping();
        }
      },
      // §17.6/§22.1 — todo nó renova a própria presença antes do TTL.
      'presence.refresh': () => {
        const eu = selfKeyHex();
        if (eu === null) return;
        for (const c of runtime.communities()) {
          const status = runtime.localPresence.get(c.communityId) ?? defaultPresenca;
          if (status === 'invisible') continue;
          if (c.isHost) {
            c.presence.publishPresence({ communityId: c.communityId, identityKey: eu, status });
            continue;
          }
          // Membro: publica pelo canal de §16.2 só com canal vivo — efêmero não enfileira
          // no RpcClient sem conexão, senão a fila cresceria sem fim.
          const estado = runtime.hostStatus?.statusOf(c.communityId) ?? 'unknown';
          if (estado !== 'online' && estado !== 'connecting') continue;
          void c.rpc?.call('presencePublish', new Uint8Array(Buffer.from(JSON.stringify({ status }), 'utf8'))).catch(() => {});
        }
      },
      // §22.1/§24.3 — o flush comete no registro central o que os detentores de estado têm
      // AGORA: profundidade da fila por comunidade, estado de replicação e pares do swarm.
      // O destino é o registro consultável (`diag.snapshot`), não o NDJSON — o formato de
      // §24.1 é fechado e não tem campo para valor.
      'metrics.flush': () => {
        metricas.setGauge('swarm.peers', deps.swarm.getStats().peerCount);
        const estados: Record<string, number> = { synced: 0, 'catching-up': 1, stalled: 2, blocked: 3, unauthorized: 4, forked: 5 };
        for (const c of runtime.communities()) {
          const serie = serieId(c.communityId);
          metricas.setGauge(`outbox.depth.${serie}`, deps.manifest.countActive(c.communityId));
          const st = client.getState(c.communityId)?.state;
          if (st !== undefined) metricas.setGauge(`replication.state.${serie}`, estados[st] ?? -1);
        }
        logger.info('metrics', 'flush');
      },
    },
  });

  // ── §15.4 `diag.*` — sem shell injetando sondas, o default é conservador: sem sonda de
  // NAT/STUN a resposta assume o pior caso, e as métricas vêm do registro central.
  const diagnosticoEfetivo =
    deps.diagnostics ??
    new Diagnostics({
      swarm: deps.swarm,
      nat: { probe: () => Promise.reject(new Error('sem sonda NAT nesta instalação')) },
      stun: { probe: () => Promise.resolve(false) },
      relay: { available: () => false },
      metrics: {
        snapshot(): MetricsSnapshot {
          return metricas.snapshot();
        },
      } satisfies DiagnosticsMetricsPort,
      clock: { now },
    });

  /**
   * §18.6 — `identity.wipe` sobre recursos vivos. A resposta sai ANTES da saída do
   * processo; quem reinicia é o main (epoch+1, §15.2).
   */
  const wipeAgora = async (): Promise<{ ok: true } | { ok: false; code: string; stage?: string }> => {
    if (servicoIdentidade === null) return { ok: false, code: 'E_INTERNAL' };
    const r = await executeWipe({
      dataDir: deps.dataDir,
      swarm: deps.swarm,
      closeRuntime: async () => {
        await runtime.close();
      },
      view: deps.view,
      manifest: deps.manifest,
      wipeIdentity: () => servicoIdentidade.manager.wipe(),
      ...(deps.lock !== undefined ? { releaseLock: deps.lock.release } : {}),
    });
    if (!r.ok) return r;
    setTimeout(() => (deps.exit ?? (() => process.exit(0)))(), 25);
    return { ok: true };
  };

  registerCoreCommands(ipc, {
    diagnostics: diagnosticoEfetivo,
    // §15.4/§15.6 "Identidade e app" — o ciclo do núcleo: status, reprojeto, shutdown e a
    // máquina de wipe de §18.6 sobre os recursos que só esta raiz tem nas mãos.
    core: {
      status: () => ({
        phase: runtime.phase,
        epoch: deps.epoch,
        coreVersion: deps.foldBuildId,
        opVersion: OP_VERSION,
        manifestSchemaVersion: Number(MANIFEST_SCHEMA_VERSION),
        viewSchemaVersion: Number(VIEW_SCHEMA_VERSION),
        keystore: servicoIdentidade?.keystoreKind() ?? 'insecure-fallback',
        buildChannel: deps.buildChannel ?? 'prod',
      }),
      reproject: async (communityId?: string) => {
        if (runtime.phase !== 'ready') return { ok: false as const, code: 'E_BUSY' };
        const alvos =
          communityId === undefined ? runtime.communities() : [runtime.get(communityId)].filter((c) => c !== undefined);
        if (alvos.length === 0) return { ok: false as const, code: 'E_NOT_FOUND' };
        for (const c of alvos) await c.projector.reproject();
        return { ok: true as const };
      },
      shutdown: async (budgetMs?: number) => await runtime.shutdown({ ...(budgetMs !== undefined ? { budgetMs } : {}) }),
      wipe: wipeAgora,
    },
    identity:
      servicoIdentidade === null
        ? undefined
        : {
            self: () => {
              const rec = servicoIdentidade.manager.record;
              if (rec === null) return null;
              return {
                key: rec.publicKeyHex,
                displayName: rec.displayName,
                handle: rec.handle,
                avatarColor: rec.avatarColor,
                presence: rec.presence,
                createdAt: rec.createdAt,
              };
            },
            create: async (a) => {
              const r = await servicoIdentidade.create(a.displayName, a.avatarColor);
              if (r.ok) identidadePronta();
              return r;
            },
            update: async (a) => {
              if (a.displayName === undefined && a.avatarColor === undefined) {
                return { ok: false as const, code: 'E_VALIDATION', field: 'displayName' };
              }
              if (a.displayName !== undefined) {
                if (typeof a.displayName !== 'string') return { ok: false as const, code: 'E_VALIDATION', field: 'displayName' };
                const nome = checkDisplayName(a.displayName);
                if (!nome.ok) return { ok: false as const, code: 'E_VALIDATION', field: 'displayName' };
              }
              if (a.avatarColor !== undefined && (typeof a.avatarColor !== 'number' || !isAvatarColor(a.avatarColor))) {
                return { ok: false as const, code: 'E_VALIDATION', field: 'avatarColor' };
              }
              servicoIdentidade.manager.updateProfile(
                typeof a.displayName === 'string' ? a.displayName : undefined,
                typeof a.avatarColor === 'number' ? a.avatarColor : undefined,
              );
              // §15.4 — **A**, uma op POR comunidade participada. Falha síncrona em qualquer
              // delas recusa a chamada inteira; o que entrou antes continua na fila (a op é
              // idempotente no fold — reenviar não duplica efeito).
              const queued: Array<{ communityId: string; opId: string }> = [];
              const payload: Record<string, unknown> = {
                ...(typeof a.displayName === 'string' ? { displayName: a.displayName } : {}),
                ...(typeof a.avatarColor === 'number' ? { avatarColor: a.avatarColor } : {}),
              };
              for (const cid of abertas.keys()) {
                const r = client.submitQueued(cid, { kindName: IDENTITY_UPDATE_KIND, payload });
                if (!r.ok) return { ok: false as const, code: r.code, ...(r.field !== undefined ? { field: r.field } : {}) };
                queued.push({ communityId: cid, opId: r.opId });
              }
              return { ok: true as const, queued };
            },
            setPresence: (presence: unknown) => {
              const r = servicoIdentidade.setPresence(presence);
              if (r.ok) runtime.setLocalPresence(r.presence);
              return r;
            },
            export: (passphrase: unknown) => servicoIdentidade.export(passphrase),
            import: async (passphrase: unknown) => {
              const r = await servicoIdentidade.import(passphrase);
              if (!r.ok) return r;
              // §5.5 "recria o manifesto e reabre os cores": as linhas do backup voltam ao
              // manifest — hospedadas com a semente cifrada pela Data Key corrente — e cada
              // uma reabre pelo MESMO caminho do boot. Falha de reabertura degrada só aquela
              // comunidade (§3.3), não a restauração.
              identidadePronta();
              for (const row of r.rows) {
                const isHost = row.communitySeed !== undefined;
                if (isHost) {
                  storeCommunitySeed(
                    deps.manifest,
                    {
                      communityId: row.communityId,
                      coreKey: Buffer.from(row.coreKey, 'hex'),
                      blobsKey: Buffer.from(row.blobsKey, 'hex'),
                      communitySeed: Buffer.from(row.communitySeed as string, 'hex'),
                      isHost: true,
                      joinedAt: now(),
                    },
                    deps.dataKey,
                  );
                } else {
                  deps.manifest.upsertCommunity({
                    communityId: row.communityId,
                    coreKey: Buffer.from(row.coreKey, 'hex'),
                    blobsKey: Buffer.from(row.blobsKey, 'hex'),
                    isHost: false,
                    joinedAt: now(),
                  });
                }
                try {
                  runtime.register(
                    await runtime.openCommunity({
                      community_id: row.communityId,
                      core_key: Buffer.from(row.coreKey, 'hex'),
                      blobs_key: Buffer.from(row.blobsKey, 'hex'),
                      is_host: isHost ? 1 : 0,
                      left_at: null,
                    }),
                  );
                } catch {
                  fanout.emit({
                    topic: 'host.statusChanged',
                    data: { communityId: row.communityId, status: 'degraded', reason: 'E_INTERNAL' },
                  });
                }
              }
              identidadePronta();
              return { ok: true as const, publicKey: r.publicKey, handle: r.handle, communities: r.communities };
            },
            wipe: wipeAgora,
            // §3.2 L-2 — a tela dedicada que a limitação declarada exige (§15.4, emenda).
            acceptInsecureKeystore: () => servicoIdentidade.acceptInsecureKeystore(),
          },
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
      // §15.4 "Comunidade" — as três superfícies que faltavam: ativação (residência de
      // §8.1, escolha local), encerramento (⏱ main-confirmed, draining de §18.7) e
      // esquecimento (main-confirmed, réplica left/removed antes do retain_until).
      activate: (communityId: string | null) =>
        communityActivate({ ...depsEstrutura, manifest: deps.manifest }, communityId),
      end: async (a: { communityId: string; reason?: string }) => await endCommunity(depsAdmissao, a),
      forget: async (cid: string) =>
        await forgetCommunity(
          {
            manifest: deps.manifest,
            forget: (id) => {
              runtime.forget(id);
              client.removeCommunity(id);
            },
            purge: async () => {
              await purgeUmaComunidade({ manifest: deps.manifest, view: deps.view, dataDir: deps.dataDir }, cid);
            },
          },
          cid,
        ),
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
      now,
      replicationOf: (cid) => client.getState(cid) ?? { state: 'catching-up', lag: 0 },
      blobs,
      // DR-29/DR-33 — o estado de conexão observado e a presença efêmera (§17.6), ambos
      // produzidos nesta raiz; as consultas só recortam.
      hostConnection: (cid) => ({
        status: runtime.hostStatus?.statusOf(cid) ?? 'unknown',
        attempt: runtime.hostStatus?.attemptOf(cid) ?? 0,
      }),
      presenceStatuses: (cid) => {
        const c = runtime.get(cid);
        const mapa = new Map<string, string>();
        for (const e of c?.presence.getPresenceEntries(cid, now()) ?? []) mapa.set(e.identityKey, e.status);
        return mapa;
      },
      // §11.2/§15.6 — a fila é do manifest; sem recorte, todas as comunidades na ordem de
      // enfileiramento global (local_seq).
      outboxRows: (cid) =>
        cid === undefined
          ? (deps.manifest.listCommunities() as Array<{ community_id: string }>).flatMap((r) => deps.manifest.all(r.community_id))
          : deps.manifest.all(cid),
      comunidadesRows: () => deps.manifest.listCommunities() as Array<Record<string, unknown>>,
    }),
    // §15.4 preferências locais — escrita direta no LS (§6.15), sem host e sem fila;
    // markRead passa pelo recalcador para responder zero literal (RT-03).
    // §15.4 (emenda de 2026-08-23) — o gatilho local da assinatura de typing de §17.6: a UI
    // chama ao abrir canal; no host a assinatura é local, no membro espelha por §16.2.
    typing: {
      subscribe: ({ communityId, channelId, on }) => {
        const eu = selfKeyHex();
        if (eu === null) return { ok: false as const, code: 'E_NO_IDENTITY' };
        const c = runtime.get(communityId);
        if (c === undefined) return { ok: false as const, code: 'E_NOT_FOUND' };
        if (c.isHost) {
          c.presence.subscribeChannel({ communityId, subscriberKey: eu, channelId, on });
          return { ok: true as const };
        }
        // Membro: a assinatura mora no host e é efêmera — sem canal vivo não há frame
        // (§11.8), e quem reabre o canal re-assina quando a conexão voltar.
        void c.rpc
          ?.call('subscribeChannel', new Uint8Array(Buffer.from(JSON.stringify({ channelId, on }), 'utf8')))
          .catch(() => {});
        return { ok: true as const };
      },
    },
    preferences: {
      channelSetMuted: (a) => channelSetMuted(depsPreferencias, a),
      channelMarkRead: (a) => channelMarkRead(depsPreferencias, a),
      threadMarkRead: (a) => threadMarkRead(depsPreferencias, a),
      categorySetCollapsed: (a) => categorySetCollapsed(depsPreferencias, a),
      navSetActive: (a) => navSetActive(depsPreferencias, a),
      settingsSetDevice: (a) => settingsSetDevice(depsPreferencias, a),
      settingsSetVolume: (a) => settingsSetVolume(depsPreferencias, a),
      settingsSetParticipantVolume: (a) => settingsSetParticipantVolume(depsPreferencias, a),
      settingsSetNotifications: (a) => settingsSetNotifications(depsPreferencias, a),
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

  // §15.1 — `hello` é o PRIMEIRO quadro de todo canal, e é ele que fixa o `epoch` do lado
  // do renderer. Sai aqui, depois da última linha do roteador estar registrada e antes de
  // qualquer `ev`: um `req` que chegue logo em seguida já encontra o comando de pé.
  // `schemaVersion` é o da `view`, que é o esquema que as queries de §15.6 leem; o do
  // `manifest` é interno ao núcleo e continua visível em `core.status`.
  ipc.sendHello(deps.foldBuildId, OP_VERSION, Number(VIEW_SCHEMA_VERSION));

  // ── §3.3 — o boot termina em `ready` (com identidade) ou `awaiting-identity` (sem) ────
  runtime.setPhase(identidade !== null ? 'ready' : 'awaiting-identity');
  // §15.5 — reinício após crash é fato do epoch; pronto é fato da fase. O renderer que
  // assinar depois lê `core.status` — eventos não são replay.
  if (deps.epoch > 1) {
    fanout.emit({ topic: 'core.restarted', data: { epoch: deps.epoch, attempt: deps.epoch - 1 } }, {});
  }
  if (identidade !== null) {
    fanout.emit({ topic: 'core.ready', data: { phase: 'ready', epoch: deps.epoch } }, {});
  }
  logger.info('core', 'booted', { epoch: deps.epoch, code: runtime.phase });

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

/**
 * §13.5/§22.2 (`staging.gc`) — o staging `done` tem referência viva quando uma mensagem
 * projetada o carrega (linha em `attachments`) OU uma op ainda na fila pode vir a
 * carregá-lo: o envelope de um `message.send` pendente contém os bytes do core e do hash,
 * e procurá-los no blob bruto é conservador na direção certa (mantém em vez de apagar).
 * Staging sem comunidade/core conhecidos é mantido — sem fonte, nenhuma poda.
 */
function stagingReferenciado(view: ViewDb, manifest: ManifestDb, blobs: BlobManager, row: { readonly communityId: string | null; readonly hash: Buffer | null }): boolean {
  if (row.communityId === null || row.hash === null) return true;
  const coreKey = blobs.localCoreKey(row.communityId);
  if (coreKey === null) return true;
  const prefixo = `${row.hash.subarray(0, 16).toString('hex')}%`;
  const projetada = view
    .prepare('SELECT 1 FROM attachments WHERE community_id = ? AND blobs_core_key = ? AND lower(hex(hash)) LIKE ? LIMIT 1')
    .get(row.communityId, coreKey, prefixo);
  if (projetada !== undefined) return true;
  const naFila = manifest.raw
    .prepare('SELECT 1 FROM local_outbox WHERE community_id = ? AND state != \'dropped\' AND (instr(envelope, ?) > 0 OR instr(envelope, ?) > 0) LIMIT 1')
    .get(row.communityId, coreKey, row.hash);
  return naFila !== undefined;
}

/** §27.2 — `wal_checkpoint(TRUNCATE)` só acima de 64 MiB de WAL. */
const DB_WAL_TRUNCATE_BYTES = 64 * 1024 * 1024;

/**
 * §22.2 `db.maintenance` — `PRAGMA optimize` nos dois bancos e checkpoint do WAL acima do
 * teto. Falha de manutenção nunca derruba o núcleo (§22.5): o próximo ciclo tenta de novo.
 */
function manutencaoDeBancos(bancos: readonly (ManifestDb | ViewDb)[]): void {
  for (const banco of bancos) {
    try {
      banco.pragma('optimize');
      const wal = fs.statSync(`${banco.path}-wal`);
      if (wal.size > DB_WAL_TRUNCATE_BYTES) banco.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // Sem WAL ainda (ou arquivo já fechado): nada a podar neste ciclo.
    }
  }
}

/** §24.1/§27.2 — retenção e teto totais do log estruturado. */
export const LOG_RETENTION_DAYS = 7;
export const LOG_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const LOG_FILE_RE = /^core-\d{4}-\d{2}-\d{2}\.ndjson$/;

/**
 * §22.2 `log.rotate` / §24.1 — aplica retenção (`LOG_RETENTION_DAYS`) e teto total
 * (`LOG_MAX_TOTAL_BYTES`) sobre `logs/core-YYYY-MM-DD.ndjson`, sempre do mais velho para o
 * mais novo. Os PRODUTORES de log chegam com o shell; a rotação não espera por eles.
 */
function rotacionarLogs(dir: string, agora: number): void {
  let arquivos: string[];
  try {
    arquivos = fs.readdirSync(dir).filter((f) => LOG_FILE_RE.test(f)).sort();
  } catch {
    return; // diretório ainda não existe — nenhum log escrito até aqui
  }
  const limite = agora - LOG_RETENTION_DAYS * 24 * 60 * 60_000;
  let total = 0;
  const tamanhos = new Map<string, number>();
  for (const f of arquivos) {
    try {
      const tamanho = fs.statSync(path.join(dir, f)).size;
      tamanhos.set(f, tamanho);
      total += tamanho;
    } catch {}
  }
  for (const f of arquivos) {
    const tamanho = tamanhos.get(f) ?? 0;
    // `core-YYYY-MM-DD.ndjson` → meia-noite UTC daquele dia; nome fora da forma não expira.
    const y = Number(f.slice(5, 9));
    const m = Number(f.slice(10, 12));
    const d = Number(f.slice(13, 15));
    const expirado =
      Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) && Date.UTC(y, m - 1, d) < limite;
    if (!expirado && total <= LOG_MAX_TOTAL_BYTES) continue;
    try {
      fs.rmSync(path.join(dir, f));
      total -= tamanho;
    } catch {}
  }
}

/**
 * §18.4 passo 6 / §22.2 `removed.purge` — réplica com `retain_until` vencido sai inteira:
 * esquecida do runtime e do swarm, apagada do `manifest.db` (fila, LS, segredos) e da
 * `view.db` (CS + snapshot), e removida do disco (core do log e core de blobs local).
 * Comunidade aberta aqui é esquecida PRIMEIRO — job zumbi em banco purgado não existe.
 */
/**
 * A desmontagem de UMA réplica local (§18.4 passo 6): esquecida do runtime e do swarm,
 * apagada do `manifest.db` (fila, LS, segredos) e da `view.db` (CS + snapshot), e removida
 * do disco (core do log e core de blobs local). Compartilhada pelo job `removed.purge`
 * (cadência de §22.2) e por `community.forget` (§15.4, fora da cadência).
 */
async function purgeUmaComunidade(
  args: { manifest: ManifestDb; view: ViewDb; dataDir: string },
  communityId: string,
): Promise<void> {
  const canais = (args.view.prepare('SELECT id FROM channels WHERE community_id = ?').all(communityId) as Array<{ id: string }>).map((r) => r.id);
  const blobsDir = path.join(args.dataDir, 'cores', 'blobs', (args.manifest.getMemberBlobsCore(communityId)?.coreKey ?? Buffer.alloc(0)).toString('hex'));
  args.manifest.purgeCommunityData(communityId, canais);
  args.view.purgeCommunityData(communityId);
  await fs.promises.rm(path.join(args.dataDir, 'cores', communityId), { recursive: true, force: true }).catch(() => {});
  await fs.promises.rm(blobsDir, { recursive: true, force: true }).catch(() => {});
}

async function purgeRemovidas(args: {
  runtime: CoreRuntime;
  client: CommunityClient;
  manifest: ManifestDb;
  view: ViewDb;
  dataDir: string;
  now(): number;
}): Promise<number> {
  const agoraMs = args.now();
  let purgadas = 0;
  for (const row of args.manifest.listCommunities() as Array<{
    community_id: string;
    left_at: number | null;
    removed_reason: string | null;
    retain_until: number | null;
  }>) {
    // Só saída registrada (ban/kick/unauthorized/left) tem política de retenção; linha sem
    // `retain_until` não venceu — apagar seria inventar prazo.
    if (row.removed_reason === null || row.left_at === null || row.retain_until === null) continue;
    if (row.retain_until > agoraMs) continue;
    // Esquecida do runtime ANTES de purgar (§54.1) — job zumbi em banco purgado não existe.
    args.runtime.forget(row.community_id);
    args.client.removeCommunity(row.community_id);
    await purgeUmaComunidade({ manifest: args.manifest, view: args.view, dataDir: args.dataDir }, row.community_id);
    purgadas++;
  }
  return purgadas;
}
