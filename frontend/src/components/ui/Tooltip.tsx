import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** §6 — aparece após 500ms de hover. */
const HOVER_DELAY_MS = 500;

export interface TooltipProps {
  label: string;
  /** Lado em que a bolha aparece; o rail usa `right`. */
  side?: "right" | "top";
  children: ReactNode;
  className?: string;
}

/**
 * Tooltip (§6): texto curto, nunca a única fonte de uma informação crítica.
 * Aparece no hover com atraso e no foco por teclado imediatamente — quem
 * navega por teclado não tem como "esperar em cima" do elemento.
 */
export function Tooltip({
  label,
  side = "right",
  children,
  className,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function show(delay: number) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(true), delay);
  }

  function hide() {
    window.clearTimeout(timer.current);
    setVisible(false);
  }

  return (
    <span
      className={cn("relative inline-flex", className)}
      onPointerEnter={() => show(HOVER_DELAY_MS)}
      onPointerLeave={hide}
      onFocusCapture={() => show(0)}
      onBlurCapture={hide}
    >
      {children}

      {visible && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-40 whitespace-nowrap",
            "rounded-md border border-border-default bg-surface-elevated px-2 py-1",
            "text-meta text-text-primary shadow-elevated",
            side === "right"
              ? "top-1/2 left-[calc(100%+8px)] -translate-y-1/2"
              : "bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2",
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
