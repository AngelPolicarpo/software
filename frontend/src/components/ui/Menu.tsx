import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
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
/** Distância entre o gatilho e o menu, e margem mínima da viewport. */
const GAP = 8;
const EDGE = 8;

export function Menu({
  open,
  onClose,
  items,
  side = "right",
  className,
}: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  );

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

  /**
   * Posição em coordenadas de viewport, medida a partir do contêiner que
   * ancora o menu — o mesmo elemento `relative` que o `absolute` usava.
   *
   * Trocar `absolute` por `fixed` é o que tira o menu do recorte: ancorado
   * dentro da lista de canais, um menu aberto no último canal perdia 111px
   * na borda do `<nav>` rolável. Medido, não suposto.
   */
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const el = ref.current;
    const anchor = el?.parentElement;
    if (!el || !anchor) return;

    const a = anchor.getBoundingClientRect();
    const m = el.getBoundingClientRect();

    const left =
      side === "right"
        ? a.right + GAP
        : side === "bottom-end"
          ? a.right - m.width
          : a.left;
    let top = side === "right" ? a.top : a.bottom + (side === "bottom" ? GAP : 4);

    // Não cabe embaixo: vira para cima, em vez de ser cortado na borda.
    if (top + m.height + EDGE > window.innerHeight)
      top = a.top - GAP - m.height;

    const clamp = (value: number, size: number, limit: number) =>
      Math.min(Math.max(EDGE, value), Math.max(EDGE, limit - size - EDGE));

    setPosition({
      left: clamp(left, m.width, window.innerWidth),
      top: clamp(top, m.height, window.innerHeight),
    });
  }, [open, side, items.length]);

  if (!open) return null;

  const style = {
    "--menu-x": `${position?.left ?? 0}px`,
    "--menu-y": `${position?.top ?? 0}px`,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      role="menu"
      style={style}
      className={cn(
        "fixed z-40 w-56 overflow-hidden rounded-lg border border-border-default",
        "bg-surface-elevated p-1 shadow-elevated",
        "animate-modal-in",
        "left-(--menu-x) top-(--menu-y)",
        // Só aparece depois de medido, para não piscar no canto da tela.
        position === null && "invisible",
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
