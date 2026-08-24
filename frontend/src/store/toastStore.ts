import { create } from "zustand";

/**
 * Toasts (§6, §15) — canto inferior direito, empilha até 3 (o 4º substitui
 * o mais antigo), 4s de duração exceto erro, que fica até ser dispensado.
 * Nunca usado para erro de validação de formulário — isso é inline (§12).
 */
export type ToastVariant = "success" | "info" | "warning" | "error";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

const MAX_VISIBLE = 3;
export const TOAST_DURATION_MS = 4000;

interface ToastState {
  toasts: Toast[];
  showToast: (message: string, variant?: ToastVariant) => string;
  dismissToast: (id: string) => void;
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],

  showToast: (message, variant = "success") => {
    const id = crypto.randomUUID();
    set((state) => ({
      toasts: [...state.toasts, { id, message, variant }].slice(-MAX_VISIBLE),
    }));
    return id;
  },

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
