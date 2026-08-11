import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface MenuItem {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  /** Ação destrutiva: vai por último, separada por divisor (§15). */
  danger?: boolean;
  onSelect: () => void;
}

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  items: MenuItem[];
  /** Ancoragem relativa ao gatilho; o rail abre à direita do botão. */
  side?: "right" | "bottom" | "bottom-end";
  className?: string;
}

/**
 * Dropdown menu (§6) — seleção de opção única. Fecha com `Esc` ou clique
 * fora. Itens que a permissão não autoriza simplesmente não são passados,
 * nunca aparecem desabilitados (§15).
 */
export function Menu({
  open,
  onClose,
  items,
  side = "right",
  className,
}: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function handlePointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    // `capture` para fechar antes de o clique virar ação em outro lugar.
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="menu"
      className={cn(
        "absolute z-40 w-56 overflow-hidden rounded-lg border border-border-default",
        "bg-surface-elevated p-1 shadow-elevated",
        "animate-modal-in",
        side === "right" && "top-0 left-[calc(100%+8px)]",
        side === "bottom" && "top-[calc(100%+8px)] left-0",
        side === "bottom-end" && "top-[calc(100%+4px)] right-0",
        className,
      )}
    >
      {items.map((item, index) => (
        <div key={item.id}>
          {/* Divisor antes do primeiro item destrutivo (§15). */}
          {item.danger && !items[index - 1]?.danger && index > 0 && (
            <hr className="my-1 border-t border-border-subtle" />
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className={cn(
              "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left",
              "transition-colors duration-(--duration-fast) ease-out",
              item.danger ? "hover:bg-feedback-danger/15" : "hover:bg-accent-muted-bg",
            )}
          >
            {item.icon && (
              <span
                className={cn(
                  "mt-px shrink-0",
                  item.danger ? "text-feedback-danger" : "text-text-secondary",
                )}
              >
                {item.icon}
              </span>
            )}
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-body-emphasis",
                  item.danger ? "text-feedback-danger" : "text-text-primary",
                )}
              >
                {item.label}
              </span>
              {item.description && (
                <span className="block text-meta text-text-tertiary">
                  {item.description}
                </span>
              )}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
