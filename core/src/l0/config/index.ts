// `config` — L0, configuração operacional de §27.2.
//
// §4: não depende de nenhum módulo, congelada no boot.
// §1.5 e §4: nunca expõe valores ao fold.

export const DEFAULT_CONFIG = {
  p2pBuildChannel: 'prod' as 'prod' | 'dev',
  ipcSubWindow: 256,
  ipcStaleMs: 3000,
  hostClockAlarmMs: 300_000,
  drainBudgetMs: 5000,
  hostInactivityMs: 30 * 24 * 60 * 60 * 1000,
  swarmMaxConnections: 128,
  hostMaxPeers: 256,
  bgRotationMs: 60_000,
  replicationWatchMs: 5_000,
  replicationStallMs: 20_000,
  helloIntervalMs: 30_000,
  presenceTickMs: 2_000,
  blobCacheMaxBytes: 20 * 1024 * 1024 * 1024,
  stagingTicketTtlMs: 15 * 60 * 1000,
  stagingOrphanMs: 24 * 60 * 60 * 1000,
  // Controles TURN do host e cotas de relay voluntário (§17.3/§17.7) — defaults de §27.2
  turnRateKbps: 512,
  turnAllocTtlMs: 600_000,
  turnAllocPerMember: 2,
  turnSessionMaxBytes: 2 * 1024 * 1024 * 1024,
  relayMaxBytesPerDay: 5 * 1024 * 1024 * 1024,
  relayMaxAllocs: 4,
};

export type AppConfig = {
  readonly p2pBuildChannel: 'prod' | 'dev';
  readonly ipcSubWindow: number;
  readonly ipcStaleMs: number;
  readonly hostClockAlarmMs: number;
  readonly drainBudgetMs: number;
  readonly hostInactivityMs: number;
  readonly swarmMaxConnections: number;
  readonly hostMaxPeers: number;
  readonly bgRotationMs: number;
  readonly replicationWatchMs: number;
  readonly replicationStallMs: number;
  readonly helloIntervalMs: number;
  readonly presenceTickMs: number;
  readonly blobCacheMaxBytes: number;
  readonly stagingTicketTtlMs: number;
  readonly stagingOrphanMs: number;
  readonly turnRateKbps: number;
  readonly turnAllocTtlMs: number;
  readonly turnAllocPerMember: number;
  readonly turnSessionMaxBytes: number;
  readonly relayMaxBytesPerDay: number;
  readonly relayMaxAllocs: number;
  readonly p2pDataDir?: string;
};

export function resolveConfig(
  overrides: Partial<AppConfig> = {},
): Readonly<AppConfig> {
  const channel =
    (process.env['P2P_BUILD_CHANNEL'] as string | undefined) ??
    (overrides.p2pBuildChannel as string | undefined) ??
    DEFAULT_CONFIG.p2pBuildChannel;
  const p2pDataDir =
    (process.env['P2P_DATA_DIR'] as string | undefined) ??
    (overrides as { p2pDataDir?: string }).p2pDataDir;
  // §27.2 overrides via env P2P_* (operacional, não protocolo — §1.5)
  const blobCacheMaxBytes =
    (process.env['P2P_BLOB_CACHE_MAX_BYTES'] !== undefined
      ? Number(process.env['P2P_BLOB_CACHE_MAX_BYTES'])
      : undefined) ?? overrides.blobCacheMaxBytes ?? DEFAULT_CONFIG.blobCacheMaxBytes;
  const stagingTicketTtlMs =
    (process.env['P2P_STAGING_TICKET_TTL_MS'] !== undefined
      ? Number(process.env['P2P_STAGING_TICKET_TTL_MS'])
      : undefined) ?? overrides.stagingTicketTtlMs ?? DEFAULT_CONFIG.stagingTicketTtlMs;
  const stagingOrphanMs =
    (process.env['P2P_STAGING_ORPHAN_MS'] !== undefined
      ? Number(process.env['P2P_STAGING_ORPHAN_MS'])
      : undefined) ?? overrides.stagingOrphanMs ?? DEFAULT_CONFIG.stagingOrphanMs;
  const turnRateKbps =
    (process.env['P2P_TURN_RATE_KBPS'] !== undefined
      ? Number(process.env['P2P_TURN_RATE_KBPS'])
      : undefined) ?? overrides.turnRateKbps ?? DEFAULT_CONFIG.turnRateKbps;
  const turnAllocTtlMs =
    (process.env['P2P_TURN_ALLOC_TTL_MS'] !== undefined
      ? Number(process.env['P2P_TURN_ALLOC_TTL_MS'])
      : undefined) ?? overrides.turnAllocTtlMs ?? DEFAULT_CONFIG.turnAllocTtlMs;
  const turnAllocPerMember =
    (process.env['P2P_TURN_ALLOC_PER_MEMBER'] !== undefined
      ? Number(process.env['P2P_TURN_ALLOC_PER_MEMBER'])
      : undefined) ?? overrides.turnAllocPerMember ?? DEFAULT_CONFIG.turnAllocPerMember;
  const turnSessionMaxBytes =
    (process.env['P2P_TURN_SESSION_MAX_BYTES'] !== undefined
      ? Number(process.env['P2P_TURN_SESSION_MAX_BYTES'])
      : undefined) ?? overrides.turnSessionMaxBytes ?? DEFAULT_CONFIG.turnSessionMaxBytes;
  const relayMaxBytesPerDay =
    (process.env['P2P_RELAY_MAX_BYTES_PER_DAY'] !== undefined
      ? Number(process.env['P2P_RELAY_MAX_BYTES_PER_DAY'])
      : undefined) ?? overrides.relayMaxBytesPerDay ?? DEFAULT_CONFIG.relayMaxBytesPerDay;
  const relayMaxAllocs =
    (process.env['P2P_RELAY_MAX_ALLOCS'] !== undefined
      ? Number(process.env['P2P_RELAY_MAX_ALLOCS'])
      : undefined) ?? overrides.relayMaxAllocs ?? DEFAULT_CONFIG.relayMaxAllocs;
  return Object.freeze({
    ...(p2pDataDir !== undefined ? { p2pDataDir } : {}),
    p2pBuildChannel: channel === 'dev' ? 'dev' : 'prod',
    ipcSubWindow: overrides.ipcSubWindow ?? DEFAULT_CONFIG.ipcSubWindow,
    ipcStaleMs: overrides.ipcStaleMs ?? DEFAULT_CONFIG.ipcStaleMs,
    hostClockAlarmMs:
      overrides.hostClockAlarmMs ?? DEFAULT_CONFIG.hostClockAlarmMs,
    drainBudgetMs: overrides.drainBudgetMs ?? DEFAULT_CONFIG.drainBudgetMs,
    hostInactivityMs:
      overrides.hostInactivityMs ?? DEFAULT_CONFIG.hostInactivityMs,
    swarmMaxConnections:
      overrides.swarmMaxConnections ?? DEFAULT_CONFIG.swarmMaxConnections,
    hostMaxPeers: overrides.hostMaxPeers ?? DEFAULT_CONFIG.hostMaxPeers,
    bgRotationMs: overrides.bgRotationMs ?? DEFAULT_CONFIG.bgRotationMs,
    replicationWatchMs:
      overrides.replicationWatchMs ?? DEFAULT_CONFIG.replicationWatchMs,
    replicationStallMs:
      overrides.replicationStallMs ?? DEFAULT_CONFIG.replicationStallMs,
    helloIntervalMs:
      overrides.helloIntervalMs ?? DEFAULT_CONFIG.helloIntervalMs,
    presenceTickMs:
      overrides.presenceTickMs ?? DEFAULT_CONFIG.presenceTickMs,
    blobCacheMaxBytes: blobCacheMaxBytes,
    stagingTicketTtlMs: stagingTicketTtlMs,
    stagingOrphanMs: stagingOrphanMs,
    turnRateKbps: turnRateKbps,
    turnAllocTtlMs: turnAllocTtlMs,
    turnAllocPerMember: turnAllocPerMember,
    turnSessionMaxBytes: turnSessionMaxBytes,
    relayMaxBytesPerDay: relayMaxBytesPerDay,
    relayMaxAllocs: relayMaxAllocs,
  }) as Readonly<AppConfig>;
}
