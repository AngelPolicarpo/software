import { useState } from "react";

/**
 * Estado de abertura de um menu de contexto (§8, 1.1.1 · §10, 3.4) —
 * compartilhado pelo clique direito e pelo botão "⋯", que precisam chegar ao
 * mesmo menu (§19.4 exige caminho equivalente ao que depende de hover).
 */
export function useContextMenu() {
  const [open, setOpen] = useState(false);
  return {
    open,
    show: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen((current) => !current),
  };
}
