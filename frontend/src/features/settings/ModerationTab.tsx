import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  Clock,
  ShieldOff,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { Tabs } from "../../components/ui/Tabs";
import { SettingsRow } from "./SettingsLayout";
import { formatRelativeTime } from "../../lib/format";
import { findMember } from "../../mocks/dataset";
import {
  useAuditLog,
  useBans,
  useModerationStore,
  useTimeouts,
} from "../../store/moderationStore";
import type {
  Community,
  ModerationAction,
  ModerationActionType,
} from "../../domain/types";

const ACTION_ICON: Record<ModerationActionType, LucideIcon> = {
  ban: Ban,
  kick: UserMinus,
  timeout: Clock,
  deleteMessage: Trash2,
  createRole: UserPlus,
  deleteRole: Trash2,
  revokeBan: ShieldOff,
};

/** Uma frase por tipo de ação — o log é lido, não decifrado (§10, 3.3). */
function describe(entry: ModerationAction, authorName: string): string {
  switch (entry.type) {
    case "ban":
      return `${authorName} baniu ${entry.targetLabel}`;
    case "kick":
      return `${authorName} expulsou ${entry.targetLabel}`;
    case "timeout":
      return `${authorName} aplicou timeout em ${entry.targetLabel}`;
    case "deleteMessage":
      return `${authorName} deletou uma mensagem de ${entry.targetLabel}`;
    case "createRole":
      return `${authorName} criou o cargo ${entry.targetLabel}`;
    case "deleteRole":
      return `${authorName} deletou o cargo ${entry.targetLabel}`;
    case "revokeBan":
      return `${authorName} revogou o banimento de ${entry.targetLabel}`;
  }
}

const TYPE_FILTERS: { value: ModerationActionType | "all"; label: string }[] = [
  { value: "all", label: "Todas as ações" },
  { value: "ban", label: "Banimentos" },
  { value: "kick", label: "Expulsões" },
  { value: "timeout", label: "Timeouts" },
  { value: "deleteMessage", label: "Mensagens deletadas" },
  { value: "createRole", label: "Cargos criados" },
];

/** §14 — feed, não tabela: "Carregar mais" em lotes de 25. */
const PAGE_SIZE = 25;

/** Contagem regressiva do timeout, recalculada a cada segundo. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function remaining(until: number, now: number): string {
  const seconds = Math.max(0, Math.round((until - now) / 1000));
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} h restantes`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min restantes`;
  return `${seconds} s restantes`;
}

export interface ModerationTabProps {
  community: Community;
  localMemberId: string;
}

/**
 * 3.3 Ferramentas de moderação — log de auditoria, banidos e timeouts.
 *
 * Escopo por-comunidade via cargos, nunca reputação global: `CLAUDE.md:49`
 * marca moderação em escala como problema em aberto, e a nota de honestidade
 * do topo da lista de banidos diz isso com todas as letras.
 */
export function ModerationTab({ community, localMemberId }: ModerationTabProps) {
  const [tab, setTab] = useState("log");
  const [typeFilter, setTypeFilter] = useState<ModerationActionType | "all">(
    "all",
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const entries = useAuditLog(community.id);
  const bans = useBans(community.id);
  const timeouts = useTimeouts(community.id);
  const revokeBan = useModerationStore((state) => state.revokeBan);
  const removeTimeout = useModerationStore((state) => state.removeTimeout);
  const now = useNow();

  const filtered = useMemo(
    () =>
      typeFilter === "all"
        ? entries
        : entries.filter((entry) => entry.type === typeFilter),
    [entries, typeFilter],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Tabs
        orientation="horizontal"
        activeId={tab}
        onSelect={setTab}
        items={[
          { id: "log", label: "Log de auditoria" },
          { id: "bans", label: `Banidos (${bans.length})` },
          { id: "timeouts", label: `Timeouts (${timeouts.length})` },
        ]}
      />

      {tab === "log" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="relative self-start">
            <Button
              variant="secondary"
              size="sm"
              aria-haspopup="menu"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((open) => !open)}
            >
              {TYPE_FILTERS.find((f) => f.value === typeFilter)?.label}
            </Button>
            <Menu
              open={filterOpen}
              onClose={() => setFilterOpen(false)}
              side="bottom"
              items={TYPE_FILTERS.map((filter) => ({
                id: filter.value,
                label: filter.label,
                onSelect: () => setTypeFilter(filter.value),
              }))}
            />
          </div>

          {filtered.length === 0 ? (
            <p className="text-body text-text-tertiary">
              Nenhuma ação de moderação registrada ainda.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtered.slice(0, visible).map((entry) => {
                const Icon = ACTION_ICON[entry.type];
                const author =
                  findMember(community.id, entry.authorId)?.displayName ??
                  "Alguém";
                return (
                  <li key={entry.id}>
                    <SettingsRow>
                      <span className="flex items-start gap-2">
                        <Icon
                          size={16}
                          strokeWidth={2}
                          aria-hidden="true"
                          className="mt-0.5 shrink-0 text-text-tertiary"
                        />
                        <span className="min-w-0">
                          <span className="block text-body text-text-primary">
                            {describe(entry, author)}
                          </span>
                          {entry.reason && (
                            <span className="block text-meta text-text-secondary">
                              motivo: {entry.reason}
                            </span>
                          )}
                          <span className="block text-meta text-text-tertiary">
                            {formatRelativeTime(entry.timestamp)}
                          </span>
                        </span>
                      </span>
                    </SettingsRow>
                  </li>
                );
              })}
            </ul>
          )}

          {filtered.length > visible && (
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => setVisible((count) => count + PAGE_SIZE)}
            >
              Carregar mais
            </Button>
          )}
        </div>
      )}

      {tab === "bans" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {/* Nota de honestidade fixa, nunca escondida num tooltip (§10). */}
          <p className="rounded-md border border-border-default bg-surface-primary p-3 text-meta text-text-secondary">
            Banir impede a entrada com esta identidade específica. Como não há
            autoridade central, a pessoa pode tecnicamente voltar com uma
            identidade nova através de outro convite.
          </p>

          {bans.length === 0 ? (
            <p className="text-body text-text-tertiary">
              Ninguém está banido de {community.name}.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {bans.map((ban) => (
                <li key={ban.identityId}>
                  <SettingsRow
                    action={
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          revokeBan(
                            community.id,
                            ban.identityId,
                            localMemberId,
                            ban.label,
                          )
                        }
                      >
                        Revogar banimento
                      </Button>
                    }
                  >
                    <span className="block truncate font-mono text-body text-text-primary">
                      {ban.label}
                    </span>
                    <span className="block text-meta text-text-tertiary">
                      {findMember(community.id, ban.byId)?.displayName ??
                        "Alguém"}{" "}
                      · {formatRelativeTime(ban.at)}
                      {ban.reason ? ` · motivo: ${ban.reason}` : ""}
                    </span>
                  </SettingsRow>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "timeouts" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {timeouts.length === 0 ? (
            <p className="text-body text-text-tertiary">
              Nenhum timeout ativo em {community.name} no momento.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {timeouts.map((timeout) => (
                <li key={timeout.identityId}>
                  <SettingsRow
                    action={
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          removeTimeout(community.id, timeout.identityId)
                        }
                      >
                        Remover timeout
                      </Button>
                    }
                  >
                    <span className="block truncate text-body text-text-primary">
                      {timeout.label}
                    </span>
                    <span className="block text-meta text-text-tertiary">
                      {remaining(timeout.until, now)}
                      {timeout.reason ? ` · motivo: ${timeout.reason}` : ""}
                    </span>
                  </SettingsRow>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
