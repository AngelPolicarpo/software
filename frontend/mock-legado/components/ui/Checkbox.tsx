import { Check } from "lucide-react";
import { cn } from "../../../src/lib/cn";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  className?: string;
}

/**
 * Checkbox (§6) — em cima do input nativo, que continua sendo o alvo real de
 * clique e teclado; o quadrado desenhado é só a camada visual.
 */
export function Checkbox({ checked, onChange, label, className }: CheckboxProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 text-body text-text-secondary",
        className,
      )}
    >
      <span className="relative inline-flex size-4 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer size-4 cursor-pointer appearance-none rounded-sm border border-border-strong bg-surface-primary checked:border-accent-default checked:bg-accent-default"
        />
        <Check
          size={12}
          strokeWidth={3}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-auto text-text-on-accent opacity-0 peer-checked:opacity-100"
        />
      </span>
      {label}
    </label>
  );
}
