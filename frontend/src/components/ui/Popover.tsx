import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../lib/cn";

/** Distância entre o gatilho e o popover, e margem mínima da viewport. */
const GAP = 8;
const EDGE = 12;

export interface PopoverProps {
  /** Retângulo do elemento que abriu o popover, em coordenadas de viewport. */
  anchor: DOMRect;
  onClose: () => void;
  label: string;
  children: ReactNode;
  width?: number;
}

/**
 * Popover ancorado (§6) — abre ao lado do gatilho e não vaza da viewport:
 * tenta a direita, cai para a esquerda se não couber, e o topo é grampeado
 * nas bordas. Em Mobile vira bottom sheet (§8, 1.4).
 *
 * Fecha com `Esc` ou clique fora; é estritamente contextual e nunca navega.
 */
export function Popover({
  anchor,
  onClose,
  label,
  children,
  width = 320,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function handlePointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { height } = el.getBoundingClientRect();

    const toRight = anchor.right + GAP;
    const left =
      toRight + width + EDGE > window.innerWidth
        ? Math.max(EDGE, anchor.left - GAP - width)
        : toRight;

    const top = Math.min(
      Math.max(EDGE, anchor.top),
      Math.max(EDGE, window.innerHeight - height - EDGE),
    );

    setPosition({ left, top });
  }, [anchor, width]);

  const style = {
    "--popover-x": `${position?.left ?? 0}px`,
    "--popover-y": `${position?.top ?? 0}px`,
    "--popover-w": `${width}px`,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      style={style}
      className={cn(
        "fixed z-50 overflow-hidden border border-border-default",
        "bg-surface-elevated shadow-elevated animate-modal-in",
        // Mobile: bottom sheet colado na base, largura total (§8, 1.4).
        "inset-x-0 bottom-0 rounded-t-lg",
        // Tablet+: popover ancorado no gatilho.
        "tablet:inset-x-auto tablet:bottom-auto tablet:rounded-lg",
        "tablet:left-(--popover-x) tablet:top-(--popover-y) tablet:w-(--popover-w)",
        // Só aparece depois de medido, para não piscar no canto.
        position === null && "tablet:invisible",
      )}
    >
      {children}
    </div>
  );
}
