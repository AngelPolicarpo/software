import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../../src/lib/cn";

/** §6 — aparece após 500ms de hover. */
const HOVER_DELAY_MS = 500;

/** Distância entre o gatilho e o balão, e margem mínima da viewport. */
const GAP = 8;
const EDGE = 8;

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
 *
 * **O balão é `fixed`, medido a partir do gatilho** — mesmo caminho do
 * `Popover`. Posicionado como `absolute` dentro do próprio gatilho, ele era
 * recortado por qualquer ancestral com `overflow`: na lista de canais, o
 * `<nav>` rolável de 240px cortava 47px de "Criar canal em TEXTO", e o texto
 * chegava truncado ao usuário. Coordenada de viewport escapa do recorte, e o
 * grampo nas bordas evita trocar um vazamento por outro.
 */
export function Tooltip({
  label,
  side = "right",
  children,
  className,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  );
  const timer = useRef<number | undefined>(undefined);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function show(delay: number) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(true), delay);
  }

  function hide() {
    window.clearTimeout(timer.current);
    setVisible(false);
    setPosition(null);
  }

  useLayoutEffect(() => {
    if (!visible) return;
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;

    const a = anchor.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();

    const left =
      side === "right" ? a.right + GAP : a.left + a.width / 2 - b.width / 2;
    const top =
      side === "right" ? a.top + a.height / 2 - b.height / 2 : a.top - GAP - b.height;

    const clamp = (value: number, size: number, limit: number) =>
      Math.min(Math.max(EDGE, value), Math.max(EDGE, limit - size - EDGE));

    setPosition({
      left: clamp(left, b.width, window.innerWidth),
      top: clamp(top, b.height, window.innerHeight),
    });
  }, [visible, side, label]);

  // Rolar com o balão aberto o deixaria pendurado longe do gatilho, já que a
  // coordenada é de viewport. Some, em vez de perseguir o scroll.
  useEffect(() => {
    if (!visible) return;
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [visible]);

  const style = {
    "--tooltip-x": `${position?.left ?? 0}px`,
    "--tooltip-y": `${position?.top ?? 0}px`,
  } as CSSProperties;

  return (
    <span
      ref={anchorRef}
      className={cn("relative inline-flex", className)}
      onPointerEnter={() => show(HOVER_DELAY_MS)}
      onPointerLeave={hide}
      /*
        Clicar no gatilho quase sempre abre outra camada — menu de contexto,
        modal, painel. O balão continuava aberto por cima dela (é z-50 contra
        z-40 do menu) e tapava o primeiro item. Ativar dispensa o tooltip, que
        é a convenção: ele explica o que o controle faz, não o que ele abriu.
      */
      onPointerDown={hide}
      onFocusCapture={(event) => {
        /*
          Só foco por teclado. Clicar também foca, e o balão reaparecia
          imediatamente por cima do menu que o próprio clique abriu —
          `onPointerDown` escondia e o foco trazia de volta no mesmo gesto.
        */
        const target = event.target as HTMLElement;
        if (target.matches?.(":focus-visible")) show(0);
      }}
      onBlurCapture={hide}
    >
      {children}

      {visible && (
        <span
          ref={bubbleRef}
          role="tooltip"
          style={style}
          className={cn(
            "pointer-events-none fixed z-50 whitespace-nowrap",
            "left-(--tooltip-x) top-(--tooltip-y)",
            "rounded-md border border-border-default bg-surface-elevated px-2 py-1",
            "text-meta text-text-primary shadow-elevated",
            // Só aparece depois de medido, para não piscar no canto da tela.
            position === null && "invisible",
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
