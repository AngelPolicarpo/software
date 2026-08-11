import { useState } from "react";
import { SmilePlus } from "lucide-react";
import { cn } from "../../lib/cn";
import { EmojiPicker } from "./EmojiPicker";
import type { Message } from "../../domain/types";

export interface ReactionBarProps {
  message: Message;
  /** Id da identidade local dentro desta comunidade. */
  localMemberId: string;
  canReact: boolean;
  onToggle: (emoji: string) => void;
}

/**
 * Reações da mensagem (§6, §9 2.1) — chip com emoji e contagem, destacado
 * quando a identidade local reagiu. Clicar alterna. O emoji "salta" ao ser
 * adicionado (§17); chip que zera some junto com a última reação (§18).
 */
export function ReactionBar({
  message,
  localMemberId,
  canReact,
  onToggle,
}: ReactionBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (message.reactions.length === 0 && !pickerOpen) return null;

  return (
    <div className="relative mt-1 flex flex-wrap items-center gap-1">
      {message.reactions.map((reaction) => {
        const mine = reaction.userIds.includes(localMemberId);
        return (
          <button
            key={reaction.emoji}
            type="button"
            disabled={!canReact}
            onClick={() => onToggle(reaction.emoji)}
            aria-pressed={mine}
            className={cn(
              "flex h-6 items-center gap-1 rounded-full border px-2",
              "text-meta tabular-nums",
              "transition-colors duration-(--duration-fast) ease-out",
              mine
                ? "border-accent-default bg-accent-muted-bg text-accent-default"
                : "border-border-default bg-surface-elevated text-text-secondary",
              canReact && !mine && "hover:border-border-strong",
            )}
          >
            <span key={reaction.count} className="animate-reaction-pop">
              {reaction.emoji}
            </span>
            {reaction.count}
          </button>
        );
      })}

      {canReact && (
        <>
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            className={cn(
              "grid size-6 place-items-center rounded-full border border-border-default",
              "bg-surface-elevated text-text-secondary",
              "transition-colors duration-(--duration-fast) ease-out",
              "hover:border-border-strong hover:text-text-primary",
            )}
          >
            <SmilePlus size={14} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Adicionar reação</span>
          </button>

          {pickerOpen && (
            <EmojiPicker
              align="start"
              onPick={onToggle}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
