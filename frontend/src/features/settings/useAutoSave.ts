import { useEffect, useRef } from "react";
import { useToastStore } from "../../store/toastStore";

/** §13 — formulários de edição salvam sozinhos, com debounce de ~800ms. */
const DEBOUNCE_MS = 800;

/**
 * Salvamento automático de §10 (3.1b/3.2): não há botão "Salvar" porque não
 * há "enviar pro servidor" — a escrita é local. O toast discreto é o único
 * sinal de que a alteração pegou.
 *
 * `key` muda a cada alteração; o efeito só dispara depois da primeira, para
 * não anunciar "salvo" ao simplesmente abrir a tela.
 */
export function useAutoSaveToast(key: string): void {
  const showToast = useToastStore((state) => state.showToast);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = window.setTimeout(
      () => showToast("Alterações salvas", "success"),
      DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [key, showToast]);
}
