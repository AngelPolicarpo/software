// `directMessages` — L2 (§4, §31). Ver `service.ts` para o desenho e a fronteira.

export {
  DIA_MS,
  DM_REMOVED_RETENTION_DAYS_DEFAULT,
  P2P_DM_MAX_CONVERSATIONS,
  P2P_DM_PENDING_MAX,
  P2P_DM_PENDING_MAX_RECORDS,
  P2P_DM_STORAGE_WARN_BYTES,
} from './limites.ts';

export {
  DirectMessages,
  DM_CONTACT_POLICY_KEY,
  type DirectMessagesOptions,
  type DmContactPolicy,
  type DmConversationRow,
  type DmConversationState,
  type DmCorePort,
  type DmCriptoPort,
  type DmErrorCode,
  type DmEvent,
  type DmFalha,
  type DmProjetorLike,
  type DmProjetorPort,
  type DmRecomposicao,
  type DmSyncState,
} from './service.ts';
