import { cn } from "../../lib/cn";

export interface SpinnerProps {
  className?: string;
  /** Rótulo lido por leitor de tela; some visualmente. */
  label?: string;
}

/**
 * Indicador de carregamento de ação pontual (§12) — sempre dentro do
 * controle que disparou a ação, nunca overlay de tela cheia.
 */
export function Spinner({ className, label = "Carregando" }: SpinnerProps) {
  return (
    <span
      className={cn(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
      role="status"
      aria-label={label}
    />
  );
}
