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
};

export type AppConfig = {
  readonly p2pBuildChannel: 'prod' | 'dev';
  readonly ipcSubWindow: number;
  readonly ipcStaleMs: number;
  readonly hostClockAlarmMs: number;
  readonly drainBudgetMs: number;
  readonly hostInactivityMs: number;
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
  }) as Readonly<AppConfig>;
}
