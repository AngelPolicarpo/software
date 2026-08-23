import type { ReactNode } from "react";
import { cn } from "../../../src/lib/cn";

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Ação destrutiva no fim da lista, separada por divisor (§15). */
  danger?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  /**
   * `vertical` é a coluna de ~180px das telas de configuração (§10, 3.1);
   * `horizontal` são as sub-abas de moderação (§10, 3.3).
   */
  orientation?: "vertical" | "horizontal";
  className?: string;
}

/**
 * Tabs (§6) — Configurações (Geral/Cargos/Moderação) e as sub-abas do log.
 *
 * `role="tablist"` com `aria-selected` de verdade: o item ativo não se
 * distingue só pelo fundo, que é a única pista visual.
 */
export function Tabs({
  items,
  activeId,
  onSelect,
  orientation = "vertical",
  className,
}: TabsProps) {
  return (
    <div
      role="tablist"
      aria-orientation={orientation}
      className={cn(
        orientation === "vertical"
          ? "flex flex-col gap-0.5"
          : "flex items-center gap-1 border-b border-border-subtle",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(item.id)}
            className={cn(
              "flex items-center gap-2 text-left",
              "transition-colors duration-(--duration-fast) ease-out",
              orientation === "vertical"
                ? "h-8 rounded-md px-2 text-body"
                : "-mb-px h-9 border-b-2 px-3 text-body-emphasis",
              orientation === "horizontal" &&
                (active
                  ? "border-accent-default text-text-primary"
                  : "border-transparent text-text-secondary hover:text-text-primary"),
              orientation === "vertical" &&
                (active
                  ? "bg-accent-muted-bg text-text-primary"
                  : item.danger
                    ? "text-feedback-danger hover:bg-surface-primary"
                    : "text-text-secondary hover:bg-surface-primary hover:text-text-primary"),
            )}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
