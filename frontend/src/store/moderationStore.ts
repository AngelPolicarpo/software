import { useMemo } from "react";
import { create } from "zustand";
// O log de moderação passa a vir de `query.auditLog` (§15.6) — que exige `view_audit_log`
// e responde `E_PERMISSION_DENIED` a quem não tem. Ausência aqui é "não carregado ou sem
// permissão", nunca "nada aconteceu".
import type { ModerationAction } from "../domain/types";

/**
 * Moderação por-comunidade (§10, 3.3 · fluxo D12).
 *
 * Escopo deliberadamente local: cargos e permissões desta comunidade, nunca
 * reputação global — `CLAUDE.md:49` marca "moderação em escala sem
 * autoridade central" como problema em aberto, não como recurso resolvido.
 *
 * Como no `messageStore`, o log de §2 vive na fixture e o que acontece na
 * sessão mora aqui: recarregar devolve o app ao estado documentado.
 */

export interface BanRecord {
  communityId: string;
  identityId: string;
  /** Identificador exibido — em P2P não há nome real garantido (§10, 3.3). */
  label: string;
  byId: string;
  at: string;
  reason?: string;
}

export interface TimeoutRecord {
  communityId: string;
  identityId: string;
  label: string;
  byId: string;
  at: string;
  /** Epoch em ms — a lista mostra a contagem regressiva (§10, 3.3). */
  until: number;
  reason?: string;
}

/** Durações oferecidas ao aplicar timeout. */
export const TIMEOUT_OPTIONS = [
  { value: "5", label: "5 minutos" },
  { value: "60", label: "1 hora" },
  { value: "1440", label: "24 horas" },
];

interface ModerationState {
  /** Log vindo de `query.auditLog` (§15.6) — exige `view_audit_log`. */
  remoteLog: ModerationAction[];
  aplicarRemoto: (patch: { remoteLog?: ModerationAction[] }) => void;
  /** Bans criados nesta sessão; os de §2 vêm do log de fixture. */
  bans: BanRecord[];
  /** Bans de fixture revogados nesta sessão, por id de alvo. */
  revokedBanIds: string[];
  timeouts: TimeoutRecord[];
  entries: ModerationAction[];

  ban: (input: Omit<BanRecord, "at">) => void;
  /** `label` vem de quem revoga: o ban pode ser da fixture de §2, não da sessão. */
  revokeBan: (
    communityId: string,
    identityId: string,
    byId: string,
    label?: string,
  ) => void;
  kick: (input: Omit<BanRecord, "at">) => void;
  applyTimeout: (input: Omit<TimeoutRecord, "at">) => void;
  removeTimeout: (communityId: string, identityId: string) => void;
  /** Registra no log o que outras telas já fazem (deletar mensagem, cargo). */
  log: (
    entry: Omit<ModerationAction, "id" | "timestamp"> &
      Partial<Pick<ModerationAction, "timestamp">>,
  ) => void;
  reset: () => void;
}

function actionId(): string {
  return `mod-${crypto.randomUUID().slice(0, 8)}`;
}

export const useModerationStore = create<ModerationState>()((set, get) => ({
      remoteLog: [],
      aplicarRemoto: (patch) => set(patch),
  bans: [],
  revokedBanIds: [],
  timeouts: [],
  entries: [],

  log: (entry) =>
    set((state) => ({
      entries: [
        {
          id: actionId(),
          timestamp: entry.timestamp ?? new Date().toISOString(),
          ...entry,
        } as ModerationAction,
        ...state.entries,
      ],
    })),

  ban: (input) => {
    const at = new Date().toISOString();
    set((state) => ({
      bans: [...state.bans, { ...input, at }],
      revokedBanIds: state.revokedBanIds.filter((id) => id !== input.identityId),
    }));
    get().log({
      communityId: input.communityId,
      type: "ban",
      targetId: input.identityId,
      targetLabel: input.label,
      authorId: input.byId,
      reason: input.reason,
      timestamp: at,
    });
  },

  revokeBan: (communityId, identityId, byId, label) => {
    const record = get().bans.find(
      (ban) => ban.communityId === communityId && ban.identityId === identityId,
    );
    set((state) => ({
      bans: state.bans.filter(
        (ban) =>
          !(ban.communityId === communityId && ban.identityId === identityId),
      ),
      revokedBanIds: [...state.revokedBanIds, identityId],
    }));
    get().log({
      communityId,
      type: "revokeBan",
      targetId: identityId,
      targetLabel: label ?? record?.label ?? identityId,
      authorId: byId,
    });
  },

  kick: (input) => {
    get().log({
      communityId: input.communityId,
      type: "kick",
      targetId: input.identityId,
      targetLabel: input.label,
      authorId: input.byId,
      reason: input.reason,
    });
  },

  applyTimeout: (input) => {
    const at = new Date().toISOString();
    set((state) => ({
      timeouts: [
        ...state.timeouts.filter(
          (t) =>
            !(
              t.communityId === input.communityId &&
              t.identityId === input.identityId
            ),
        ),
        { ...input, at },
      ],
    }));
    get().log({
      communityId: input.communityId,
      type: "timeout",
      targetId: input.identityId,
      targetLabel: input.label,
      authorId: input.byId,
      reason: input.reason,
      timestamp: at,
    });
  },

  removeTimeout: (communityId, identityId) =>
    set((state) => ({
      timeouts: state.timeouts.filter(
        (t) => !(t.communityId === communityId && t.identityId === identityId),
      ),
    })),

  reset: () => set({ bans: [], revokedBanIds: [], timeouts: [], entries: [] }),
}));

/* ─── Seletores ──────────────────────────────────────────────────── */

/**
 * Log de auditoria da comunidade, do mais recente para o mais antigo — as
 * duas entradas de §2 mais o que esta sessão registrou.
 *
 * Composição em `useMemo` sobre entradas estáveis, não dentro do seletor:
 * concatenar arrays devolve referência nova a cada chamada e o Zustand v5
 * entraria em loop (a mesma armadilha da Parte 4).
 */
export function useAuditLog(communityId: string): ModerationAction[] {
  const entries = useModerationStore((state) => state.entries);
  const remoto = useModerationStore((state) => state.remoteLog);
  return useMemo(
    () =>
      [...entries, ...remoto]
        .filter((entry) => entry.communityId === communityId)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [entries, remoto, communityId],
  );
}

/** Banidos: os que o log de §2 registra, mais os desta sessão, menos os revogados. */
export function useBans(communityId: string): BanRecord[] {
  const bans = useModerationStore((state) => state.bans);
  const revoked = useModerationStore((state) => state.revokedBanIds);
  const remoto = useModerationStore((state) => state.remoteLog);

  return useMemo(() => {
    const fromFixture: BanRecord[] = remoto.filter(
      (entry) => entry.type === "ban" && entry.communityId === communityId,
    ).map((entry) => ({
      communityId: entry.communityId,
      identityId: entry.targetId,
      label: entry.targetLabel,
      byId: entry.authorId,
      at: entry.timestamp,
      reason: entry.reason,
    }));

    return [...fromFixture, ...bans.filter((b) => b.communityId === communityId)]
      .filter((ban) => !revoked.includes(ban.identityId))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [bans, revoked, remoto, communityId]);
}

export function useTimeouts(communityId: string): TimeoutRecord[] {
  const timeouts = useModerationStore((state) => state.timeouts);
  return useMemo(
    () => timeouts.filter((t) => t.communityId === communityId),
    [timeouts, communityId],
  );
}

/** Alguém banido não aparece mais na comunidade (§11, D12 passo 3). */
export function useIsBanned(communityId: string, identityId: string): boolean {
  return useModerationStore((state) =>
    state.bans.some(
      (ban) => ban.communityId === communityId && ban.identityId === identityId,
    ),
  );
}
