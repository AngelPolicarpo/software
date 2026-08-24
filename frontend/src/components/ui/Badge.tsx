import { cn } from "../../lib/cn";

/**
 * Badge / pill (§6).
 *
 * `count` — contagem de menções pendentes, trunca em "99+".
 * `live`  — pill "AO VIVO" do canal de voz com gente dentro.
 */
export type BadgeTone = "danger" | "live";

export interface BadgeProps {
  tone?: BadgeTone;
  /** Numérica: qualquer valor acima de 99 vira "99+". */
  count?: number;
  children?: string;
  /** Lido por leitor de tela no lugar do número seco ("3 menções"). */
  srLabel?: string;
  className?: string;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  danger: "bg-feedback-danger text-text-on-accent",
  live: "bg-accent-muted-bg text-accent-default",
};

export function Badge({
  tone = "danger",
  count,
  children,
  srLabel,
  className,
}: BadgeProps) {
  const label = count !== undefined ? (count > 99 ? "99+" : `${count}`) : children;
  if (label === undefined || label === "") return null;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        "px-1.5 text-caption tabular-nums",
        count !== undefined && "min-w-5 py-0.5",
        count === undefined && "py-px uppercase",
        TONE_CLASS[tone],
        className,
      )}
    >
      <span aria-hidden={srLabel ? "true" : undefined}>{label}</span>
      {srLabel && <span className="sr-only">{srLabel}</span>}
    </span>
  );
}
