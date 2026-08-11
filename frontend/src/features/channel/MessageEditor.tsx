import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import type { Message } from "../../domain/types";

export interface MessageEditorProps {
  message: Message;
  onCancel: () => void;
  onSave: (content: string) => void;
}

/**
 * Edição inline da própria mensagem (§9, 2.1 · §13).
 *
 * `Enter` salva, `Esc` cancela, `Shift+Enter` quebra linha. Esvaziar não
 * salva: mensagem vazia se resolve com "Deletar", não editando para nada
 * (§13) — por isso o botão fica desabilitado em vez de apagar por engano.
 */
export function MessageEditor({ message, onCancel, onSave }: MessageEditorProps) {
  const [value, setValue] = useState(message.content);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const valid = value.trim() !== "";

  function save() {
    if (!valid) return;
    onSave(value.trim());
  }

  return (
    <div className="mt-1">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        aria-label="Editar mensagem"
        onChange={(event) => {
          setValue(event.target.value);
          event.target.style.height = "auto";
          event.target.style.height = `${event.target.scrollHeight}px`;
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            save();
          }
        }}
        className={cn(
          "block w-full resize-none rounded-md border border-border-default",
          "bg-surface-elevated px-3 py-2 text-body text-text-primary outline-none",
          "focus:border-border-strong",
        )}
      />
      <p className="mt-1 text-meta text-text-tertiary">
        <button
          type="button"
          onClick={onCancel}
          className="underline underline-offset-2 hover:text-text-primary"
        >
          Esc para cancelar
        </button>
        {" · "}
        <button
          type="button"
          onClick={save}
          disabled={!valid}
          className={cn(
            "underline underline-offset-2",
            valid ? "hover:text-text-primary" : "text-text-disabled",
          )}
        >
          Enter para salvar
        </button>
      </p>
    </div>
  );
}
