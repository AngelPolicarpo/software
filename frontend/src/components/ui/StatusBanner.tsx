import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Banner de status (§6) — full-width no topo da área de conteúdo, cores da
 * família `conn-*`. Não é modal e não bloqueia o que já carregou: em P2P o
 * estado da conexão é informação de primeira classe (§1, princípio 2), não
 * um erro que interrompe a leitura.
 */
export type StatusBannerTone =
  "offline" | "reconnecting" | "degraded" | "failed";

/**
 * O fundo é a própria cor do tom, lavada a 15% sobre o que estiver atrás.
 *
 * Era `surface-sidebar` fixo (#15171e) — **mais escuro** que a área de
 * conteúdo em que o banner vive (#1a1c24). Uma faixa escura entre o header do
 * canal e a lista de mensagens não lê como camada por cima: lê como buraco,
 * como se o header tivesse sido cortado. A lavagem inverte isso (o cinza a
 * 15% dá ≈#24262f, praticamente o `surface-elevated` usado em todo lugar que
 * sinaliza "camada própria") e, de quebra, faz a severidade chegar à
 * superfície: hoje um banner de falha só se distingue de um informativo pelo
 * ponto de 8px.
 */
const TONE: Record<
  StatusBannerTone,
  { dot: string; bg: string; text: string; pulse: boolean }
> = {
  offline: {
    dot: "bg-conn-offline",
    bg: "bg-conn-offline/15",
    text: "text-text-secondary",
    pulse: false,
  },
  // Transitório e ativo: leva movimento, senão parece "offline" (§5.4).
  reconnecting: {
    dot: "bg-conn-reconnecting",
    bg: "bg-conn-reconnecting/15",
    text: "text-text-secondary",
    pulse: true,
  },
  degraded: {
    dot: "bg-conn-degraded",
    bg: "bg-conn-degraded/15",
    text: "text-text-secondary",
    pulse: false,
  },
  failed: {
    dot: "bg-conn-failed",
    bg: "bg-conn-failed/15",
    text: "text-text-primary",
    pulse: false,
  },
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
        "px-4 py-2 text-meta",
        style.bg,
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
