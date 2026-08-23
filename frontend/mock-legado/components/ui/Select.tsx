import { ChevronDown } from "lucide-react";
import { cn } from "../../../src/lib/cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  hint?: string;
  disabled?: boolean;
}

/**
 * Select (§6) — dispositivo de microfone, câmera e saída de áudio (§10,
 * 3.1). Em cima do `<select>` nativo: teclado, busca por digitação e o
 * popup do sistema vêm de graça, e no Mobile vira a roleta nativa.
 */
export function Select({
  label,
  value,
  options,
  onChange,
  hint,
  disabled = false,
}: SelectProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-caption text-text-tertiary uppercase">{label}</span>

      <span className="relative inline-flex">
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "h-9 w-full appearance-none rounded-md border border-border-default",
            "bg-surface-primary pr-9 pl-3 text-body text-text-primary",
            "transition-colors duration-(--duration-fast) ease-out",
            "hover:border-border-strong",
            "disabled:cursor-not-allowed disabled:text-text-disabled",
          )}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          strokeWidth={2}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-text-tertiary"
        />
      </span>

      {hint && <span className="text-meta text-text-tertiary">{hint}</span>}
    </label>
  );
}
