import { cn } from "../../../src/lib/cn";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/**
 * Toggle (§6) — usado nos switches de notificação e no "Mencionável" de um
 * cargo (§10, 3.1/3.2).
 *
 * `role="switch"` sobre um botão de verdade: o estado vai em `aria-checked`,
 * não só na posição do círculo, que é a única pista para quem enxerga.
 */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: ToggleProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-body text-text-primary">{label}</p>
        {description && (
          <p className="text-meta text-text-tertiary">{description}</p>
        )}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full",
          "transition-colors duration-(--duration-fast) ease-out",
          checked ? "bg-accent-default" : "bg-border-strong",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-text-primary",
            "transition-all duration-(--duration-fast) ease-out",
            checked ? "left-4.5" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}
