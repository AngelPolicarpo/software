import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { SettingsSection } from "./SettingsLayout";
import { NAT_LABEL, useSettingsStore } from "../../store/settingsStore";

/**
 * §10, 3.1 — diagnóstico de rede. Somente leitura: é o que este dispositivo
 * consegue medir sobre a própria conexão, sem inventar número nenhum.
 */
export function AccountNetworkTab() {
  const settings = useSettingsStore();

  return (
    <SettingsSection
      title="Diagnóstico"
      description="Somente leitura — é o que este dispositivo consegue medir sobre a própria conexão."
    >
      {settings.diagnosticRunning ? (
        <>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <span
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                settings.natType === "cgnat"
                  ? "bg-conn-degraded"
                  : "bg-conn-ok",
              )}
              aria-hidden="true"
            />
            <p className="text-body text-text-primary">
              {NAT_LABEL[settings.natType]}
            </p>
          </div>
          <p className="text-body text-text-secondary">
            {settings.connectedPeers} peers conectados agora
          </p>
        </>
      )}

      <Button
        variant="secondary"
        size="sm"
        onClick={settings.runDiagnostic}
        loading={settings.diagnosticRunning}
        className="self-start"
      >
        Executar diagnóstico novamente
      </Button>
    </SettingsSection>
  );
}
