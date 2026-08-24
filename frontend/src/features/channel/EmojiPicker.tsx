import { useEffect, useRef } from "react";
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
  const ref = useRef<HTMLDivElement>(null);

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
    <div
      ref={ref}
      role="dialog"
      aria-label="Escolher emoji"
      className={cn(
        "absolute z-40 w-64 rounded-lg border border-border-default",
        "bg-surface-elevated p-2 shadow-elevated animate-modal-in",
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
    </div>
  );
}
