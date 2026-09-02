import { cn } from "../../lib/cn";
import { Toggle } from "../../components/ui/Toggle";
import { SettingsSection } from "./SettingsLayout";
import { DmContactPolicySection } from "../dm/DmContactPolicySection";
import { useJoinedCommunities } from "../../store/communityStore";
import {
  NOTIFICATION_LABEL,
  useSettingsStore,
  type NotificationLevel,
} from "../../store/settingsStore";

const LEVELS: NotificationLevel[] = ["all", "mentions", "none"];

/** §10, 3.1 — o interruptor geral e o nível por comunidade. */
export function AccountNotificationsTab() {
  const settings = useSettingsStore();
  const communities = useJoinedCommunities();

  return (
    <>
      {/*
        §31.9 regra 5 — a política de contato da conversa direta (U-33). Fica em 3.1
        porque é preferência da instalação e não tem comunidade a que pertencer; a
        notificação por conversa é a outra metade de **B63(b)**, que continua aberta.
      */}
      <DmContactPolicySection />

      <SettingsSection title="Geral">
        <Toggle
          checked={settings.notificationsEnabled}
          onChange={settings.setNotificationsEnabled}
          label="Notificações"
          description="Desligar aqui silencia todas as comunidades."
        />
      </SettingsSection>

      <SettingsSection
        title="Por comunidade"
        description="Notificação nativa do sistema fica fora desta versão."
      >
        {communities.map((community) => {
          const level =
            settings.notificationByCommunity[community.id] ?? "all";
          return (
            <div
              key={community.id}
              className="flex items-center justify-between gap-3"
            >
              <span className="min-w-0 truncate text-body text-text-primary">
                {community.name}
              </span>
              <div className="flex shrink-0 gap-1">
                {LEVELS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={level === option}
                    disabled={!settings.notificationsEnabled}
                    onClick={() =>
                      settings.setCommunityNotification(community.id, option)
                    }
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-meta",
                      "transition-colors duration-(--duration-fast) ease-out",
                      level === option
                        ? "border-accent-default bg-accent-muted-bg text-accent-default"
                        : "border-border-default text-text-secondary hover:text-text-primary",
                      !settings.notificationsEnabled &&
                        "cursor-not-allowed opacity-50",
                    )}
                  >
                    {NOTIFICATION_LABEL[option]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </SettingsSection>
    </>
  );
}
