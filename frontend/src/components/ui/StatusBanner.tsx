import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Banner de status (§6) — full-width no topo da área de conteúdo, cores da
 * família `conn-*`. Não é modal e não bloqueia o que já carregou: em P2P o
 * estado da conexão é informação de primeira classe (§1, princípio 2), não
 * um erro que interrompe a leitura.
 */
export type StatusBannerTone = "offline" | "reconnecting" | "degraded" | "failed";

const TONE: Record<StatusBannerTone, { dot: string; text: string; pulse: boolean }> = {
  offline: { dot: "bg-conn-offline", text: "text-text-secondary", pulse: false },
  // Transitório e ativo: leva movimento, senão parece "offline" (§5.4).
  reconnecting: {
    dot: "bg-conn-reconnecting",
    text: "text-text-secondary",
    pulse: true,
  },
  degraded: { dot: "bg-conn-degraded", text: "text-text-secondary", pulse: false },
  failed: { dot: "bg-conn-failed", text: "text-text-primary", pulse: false },
};

export interface StatusBannerProps {
  tone: StatusBannerTone;
  children: ReactNode;
}

export function StatusBanner({ tone, children }: StatusBannerProps) {
  const style = TONE[tone];

  return (
    <div
      role="status"
      className={cn(
        "flex shrink-0 items-center gap-2 border-b border-border-subtle",
        "bg-surface-sidebar px-4 py-2 text-meta",
        style.text,
      )}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          style.dot,
          style.pulse && "animate-conn-pulse",
        )}
        aria-hidden="true"
      />
      {children}
    </div>
  );
}
