// `config` — L0, configuração operacional de §27.2.
//
// §4: não depende de nenhum módulo, congelada no boot.
// §1.5 e §4: nunca expõe valores ao fold.

export const DEFAULT_CONFIG = {
  p2pBuildChannel: 'prod' as 'prod' | 'dev',
  /**
   * §17.2 emendado em 2026-08-25 (decisão do operador): **ligado por padrão**.
   *
   * A linha original era "default vazio", e a razão dela continua verdadeira — este servidor
   * vê o IP de quem entra em chamada. O que mudou é o peso do outro lado: a L-11 medida em
   * §80 mostrou que, sem endereço público, chamada entre provedores diferentes simplesmente
   * não acontece, e um produto de voz que só funciona na mesma rede não é um produto de voz.
   *
   * O do host continua vindo PRIMEIRO (`composition/media.ts`): quando ele resolve, este
   * nem é consultado. E desligar continua possível — `P2P_STUN_SERVERS=""`.
   */
  stunServers: ['stun:stun.l.google.com:19302'] as readonly string[],
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
  /** §18.4 passo 2 / §27.2 `P2P_REMOVED_RETENTION_DAYS` — quanto a réplica removida fica. */
  removedRetentionDays: 7,
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
  readonly removedRetentionDays: number;
  readonly turnRateKbps: number;
  readonly turnAllocTtlMs: number;
  readonly turnAllocPerMember: number;
  readonly turnSessionMaxBytes: number;
  readonly relayMaxBytesPerDay: number;
  readonly relayMaxAllocs: number;
  readonly p2pDataDir?: string;
  /**
   * §17.2 — STUN de terceiros: "configurável, **default vazio**, com aviso".
   *
   * É a ÚNICA exceção ao princípio de §25.4 ("nenhum servidor, TURN de terceiro, unfurl,
   * CDN, analytics ou crash reporter"), e ela é nominal: STUN sim, TURN de terceiro não —
   * §17.3 diz "não há TURN de terceiro e não haverá". A diferença importa: um STUN só
   * responde "qual é o seu endereço público"; um TURN carregaria a mídia.
   *
   * Existe por causa da **L-11**: quando quem hospeda está atrás de NAT restrito, o STUN
   * dele não é alcançável de fora e nenhum dos dois lados descobre endereço público — o ICE
   * junta só candidato de rede local e a chamada não fecha entre provedores diferentes
   * (medido em §80). Um STUN na internet aberta quebra esse círculo.
   *
   * Vazio = ninguém é contatado. Quem liga aceita que aquele servidor veja o IP de quem
   * entra em chamada, e a tela precisa dizer isso (§17.2: "com aviso").
   */
  readonly stunServers: readonly string[];
};

/** `stun:host:porta` ou `stuns:host:porta` — qualquer outra coisa é descartada, não corrigida. */
function lerStunServers(bruto: string | undefined): readonly string[] {
  if (bruto === undefined) return [];
  return bruto
    .split(',')
    .map((x) => x.trim())
    .filter((x) => /^stuns?:[^\s]+$/i.test(x));
}

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
  const removedRetentionDays =
    (process.env['P2P_REMOVED_RETENTION_DAYS'] !== undefined
      ? Number(process.env['P2P_REMOVED_RETENTION_DAYS'])
      : undefined) ?? overrides.removedRetentionDays ?? DEFAULT_CONFIG.removedRetentionDays;
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
    // `P2P_STUN_SERVERS=""` é opt-out EXPLÍCITO e precisa vencer o default. Por isso a
    // checagem é `!== undefined` e não pelo tamanho da lista: "definida e vazia" e "não
    // definida" são intenções diferentes, e confundi-las tornaria o padrão indesligável.
    stunServers:
      process.env['P2P_STUN_SERVERS'] !== undefined
        ? lerStunServers(process.env['P2P_STUN_SERVERS'])
        : (overrides.stunServers ?? DEFAULT_CONFIG.stunServers),
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
    removedRetentionDays: Number.isFinite(removedRetentionDays) ? removedRetentionDays : DEFAULT_CONFIG.removedRetentionDays,
    turnRateKbps: turnRateKbps,
    turnAllocTtlMs: turnAllocTtlMs,
    turnAllocPerMember: turnAllocPerMember,
    turnSessionMaxBytes: turnSessionMaxBytes,
    relayMaxBytesPerDay: relayMaxBytesPerDay,
    relayMaxAllocs: relayMaxAllocs,
  }) as Readonly<AppConfig>;
}
