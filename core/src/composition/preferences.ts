// Preferências locais de §15.4 ("sem host, sem fila") — a metade de **escrita** do LS
// (§6.15/§10.2). Raiz de composição: junta `manifest.db` com o recalcador de não-lidas e
// nada mais; nenhuma destas operações toca o log, então não há op, outbox nem host.
//
// Duas decisões registradas (ver §53):
//   - `nav.setActive` é dono único da navegação (DR-32): o argumento DECLARA o estado.
//     Campo ausente é slot vazio — a UI que quiser manter envia os dois campos;
//   - `settings.setNotifications` sem `communityId` é o flag global da instalação
//     (`local_device_pref.notificationsEnabled`, micro-emenda em §6.15); com
//     `communityId`, é o nível por comunidade (`all|mentions|none`).

import type { ManifestDb } from '../l0/manifest/index.ts';
import type { UnreadTracker } from './unread.ts';

export type PreferencesDeps = {
  readonly manifest: ManifestDb;
  /** Recalcador de §6.15 — `markRead` reconta na hora para responder zero literal. */
  readonly naoLidas: UnreadTracker;
};

/** Recusa nomeada → erro com `.code` que o IpcServer traduz (§20.1). */
function recusar(code: string, field?: string): never {
  throw Object.assign(new Error(code), { code, ...(field !== undefined ? { field } : {}) });
}

function inteiroNoIntervalo(v: unknown, min: number, max: number, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) recusar('E_VALIDATION', field);
  return v;
}

const NIVEL_NOTIFICACAO = new Set(['all', 'mentions', 'none']);
const TIPO_DISPOSITIVO = new Set(['microphone', 'camera', 'output']);

export function channelSetMuted(deps: PreferencesDeps, a: { channelId: string; muted: boolean }): Record<string, never> {
  deps.manifest.setChannelMuted(a.channelId, a.muted);
  return {};
}

export function channelMarkRead(deps: PreferencesDeps, a: { communityId: string; channelId: string }): { unreadCount: number; pendingMentions: number } {
  // RT-03 — a resposta declara os dois, com o valor que o recálculo imediato produziu.
  return deps.naoLidas.marcarCanalLido(a.communityId, a.channelId);
}

export function threadMarkRead(deps: PreferencesDeps, a: { communityId: string; threadId: string }): { unreadCount: number } {
  return deps.naoLidas.marcarThreadLida(a.communityId, a.threadId);
}

export function categorySetCollapsed(deps: PreferencesDeps, a: { communityId: string; categoryId: string; collapsed: boolean }): Record<string, never> {
  const atuais = new Set(deps.manifest.collapsedCategories(a.communityId));
  if (a.collapsed) atuais.add(a.categoryId);
  else atuais.delete(a.categoryId);
  deps.manifest.setCollapsedCategories(a.communityId, [...atuais].sort());
  return {};
}

export function navSetActive(deps: PreferencesDeps, a: { communityId?: string | null; channelId?: string | null }): Record<string, never> {
  // DR-32 — dono único: o comando declara o estado inteiro. Ausente = slot vazio.
  deps.manifest.setNavigationField('activeCommunityId', a.communityId ?? null);
  deps.manifest.setNavigationField('activeChannelId', a.channelId ?? null);
  return {};
}

export function settingsSetDevice(deps: PreferencesDeps, a: { kind: string; deviceId: string }): Record<string, never> {
  if (!TIPO_DISPOSITIVO.has(a.kind)) recusar('E_VALIDATION', 'kind');
  const chave = `${a.kind}Id`;
  deps.manifest.setDevicePref(chave, a.deviceId.length > 0 ? a.deviceId : null);
  return {};
}

export function settingsSetVolume(deps: PreferencesDeps, a: { kind: string; value: unknown }): Record<string, never> {
  if (a.kind !== 'input' && a.kind !== 'output') recusar('E_VALIDATION', 'kind');
  const valor = inteiroNoIntervalo(a.value, 0, 100, 'value');
  deps.manifest.setDevicePref(`${a.kind}Volume`, String(valor));
  return {};
}

export function settingsSetParticipantVolume(
  deps: PreferencesDeps,
  a: { communityId: string; identityKey: string; volume: unknown },
): Record<string, never> {
  if (!/^[0-9a-f]{64}$/i.test(a.identityKey)) recusar('E_VALIDATION', 'identityKey');
  const volume = inteiroNoIntervalo(a.volume, 0, 100, 'volume');
  deps.manifest.setParticipantVolume(a.communityId, Buffer.from(a.identityKey.toLowerCase(), 'hex'), volume);
  return {};
}

export function settingsSetNotifications(
  deps: PreferencesDeps,
  a: { enabled?: boolean; communityId?: string; level?: string },
): Record<string, never> {
  if (a.level !== undefined) {
    if (!NIVEL_NOTIFICACAO.has(a.level)) recusar('E_VALIDATION', 'level');
    if (a.communityId === undefined) recusar('E_VALIDATION', 'communityId');
    deps.manifest.setNotificationLevel(a.communityId, a.level);
    return {};
  }
  if (a.enabled !== undefined) {
    if (a.communityId !== undefined) recusar('E_VALIDATION', 'level');
    deps.manifest.setDevicePref('notificationsEnabled', a.enabled ? '1' : '0');
  }
  return {};
}
