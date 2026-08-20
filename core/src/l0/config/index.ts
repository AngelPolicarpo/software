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
  }) as Readonly<AppConfig>;
}
