import { Paperclip, X } from "lucide-react";
import type { StagedAttachment } from "./composerAttachment";

/** Chip acima do campo, enquanto o arquivo está em staging (§13.2). */
export function AttachmentChip({
  anexo,
  onRemove,
}: {
  anexo: StagedAttachment;
  onRemove: () => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-md border border-border-default bg-surface-sidebar px-3 py-2">
      <Paperclip size={14} strokeWidth={2} aria-hidden="true" className="shrink-0 text-text-tertiary" />
      <p className="min-w-0 flex-1 truncate text-meta text-text-secondary">
        {anexo.nome} <span className="text-text-tertiary">· em staging (§13.2)</span>
      </p>
      <button
        type="button"
        aria-label={`Remover anexo ${anexo.nome}`}
        onClick={onRemove}
        className="shrink-0 text-text-tertiary hover:text-text-primary"
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
