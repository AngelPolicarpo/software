import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "../../lib/cn";

/**
 * Conjunto curado, não catálogo completo — mesma postura das 7 cores de
 * cargo (§5.4): o mock não precisa de busca de emoji nem de dependência de
 * dados para provar a interação de reagir.
 */
const EMOJIS = [
  "👍", "❤️", "😂", "🎉", "🚀", "👀", "🔥", "✅",
  "🙏", "💡", "😅", "😮", "😢", "🤔", "👏", "💯",
  "🐛", "🛠️", "📌", "⚡", "🥳", "🤝", "☕", "🌙",
];

export interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Abre para cima quando o gatilho está na base da tela (composer). */
  side?: "top" | "bottom";
  align?: "start" | "end";
}

export function EmojiPicker({
  onPick,
  onClose,
  side = "bottom",
  align = "end",
}: EmojiPickerProps) {
  const ref = useRef<HTMLDialogElement>(null);

  // `show()` e não `showModal()`: o seletor é contextual, ancorado no gatilho,
  // e não tranca a tela atrás dele. O `<dialog>` dá a semântica ao leitor de
  // tela; a devolução do foco ao gatilho no desmonte é nossa.
  useLayoutEffect(() => {
    const gatilho = document.activeElement;
    ref.current?.show();
    return () => {
      if (gatilho instanceof HTMLElement && gatilho.isConnected) gatilho.focus();
    };
  }, []);

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

  return (
    <dialog
      ref={ref}
      aria-label="Escolher emoji"
      className={cn(
        "absolute z-40 w-64 rounded-lg border border-border-default",
        "bg-surface-elevated text-text-primary p-2 shadow-elevated animate-modal-in",
        // Zera o estilo de agente de usuário do `<dialog>`, como em `Modal`.
        // `inset-x-auto` porque o `<dialog>` nativo vem com `left: 0; right: 0`,
        // e isso vence o `right-0` do alinhamento à direita.
        "m-0 inset-x-auto max-h-none max-w-none",
        side === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
        align === "end" ? "right-0" : "left-0",
      )}
    >
      <div className="grid grid-cols-8 gap-1">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              onPick(emoji);
              onClose();
            }}
            className={cn(
              "grid size-7 place-items-center rounded-md text-[18px]",
              "transition-colors duration-(--duration-fast) ease-out",
              "hover:bg-accent-muted-bg",
            )}
          >
            <span aria-hidden="true">{emoji}</span>
            <span className="sr-only">{emoji}</span>
          </button>
        ))}
      </div>
    </dialog>
  );
}
