import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

/** Casado com `--duration-base` (§5.9) — animação de saída do modal. */
const EXIT_MS = 180;

/**
 * 360px (confirmação) · 440px (0.3) · 480px (0.4) — §7 — e 720px, a tela
 * grande de configurações com tabs verticais (§10, 3.1/3.1b).
 */
export type ModalSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: "tablet:w-[360px]",
  md: "tablet:w-[440px]",
  lg: "tablet:w-[480px]",
  xl: "tablet:w-[720px]",
};

export interface ModalProps {
  open: boolean;
  /** Chamado depois da animação de saída, nunca durante. */
  onClose: () => void;
  title: string;
  size?: ModalSize;
  children: ReactNode;
  /**
   * Retorna `false` para bloquear o fechamento por `Esc`/scrim — usado por
   * formulário com dado não salvo, que pede confirmação de descarte (§15).
   * O botão explícito de fechar passa pelo mesmo caminho.
   */
  guardClose?: () => boolean;
  /** Oculta o cabeçalho quando a própria tela já se apresenta (0.3 passo 2). */
  hideHeader?: boolean;
  /** Substitui o padding padrão — telas com tabs desenham o próprio (§10). */
  bodyClassName?: string;
}

/**
 * Modal/Dialog (§6) sobre `<dialog>` nativo: foco preso, top layer e `Esc`
 * vêm do navegador em vez de reimplementados. Fecha com `Esc`, clique no
 * scrim ou botão explícito; em Mobile vira tela cheia sem cantos
 * arredondados (§7, 0.3/0.4).
 */
export function Modal({
  open,
  onClose,
  title,
  size = "md",
  children,
  guardClose,
  hideHeader = false,
  bodyClassName,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const exitTimer = useRef<number | undefined>(undefined);
  const [closing, setClosing] = useState(false);

  // Lidos dentro de listeners nativos, que não enxergam o estado do render.
  const openRef = useRef(open);
  const closingRef = useRef(closing);
  openRef.current = open;
  closingRef.current = closing;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  /**
   * Rede de segurança: o close watcher do Chrome ignora `preventDefault` no
   * `cancel` quando não houve ativação do usuário na página, e fecha o
   * dialog mesmo assim. Sem isto o React continuaria achando que o modal
   * está aberto enquanto o DOM já o fechou — e ele nunca mais reapareceria.
   * Reabrir aqui, de forma síncrona, também preserva a ordem do top layer:
   * um modal de confirmação montado logo depois fica por cima, não por
   * baixo.
   */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    function handleNativeClose() {
      if (openRef.current && !closingRef.current) dialog?.showModal();
    }

    dialog.addEventListener("close", handleNativeClose);
    return () => dialog.removeEventListener("close", handleNativeClose);
  }, []);

  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  const requestClose = useCallback(() => {
    if (guardClose && !guardClose()) return;
    setClosing(true);
    exitTimer.current = window.setTimeout(() => {
      setClosing(false);
      onClose();
    }, EXIT_MS);
  }, [guardClose, onClose]);

  /**
   * `Esc` precisa de listener nativo: pelo `onCancel` sintético do React o
   * `preventDefault` não segura o `<dialog>`, que fecha na hora — sem
   * animação de saída e, pior, atropelando a guarda de descarte (§15).
   */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    function handleCancel(event: Event) {
      event.preventDefault();
      requestClose();
    }

    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [requestClose]);

  /** Clique no scrim: o alvo é o próprio `<dialog>`, não o conteúdo. */
  function handleClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) requestClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClick={handleClick}
      aria-label={title}
      className={cn(
        "bg-surface-elevated text-text-primary",
        "backdrop:bg-surface-overlay-scrim",
        // Mobile: tela cheia, sem scrim visível, sem cantos arredondados.
        "m-0 h-full max-h-none w-full max-w-none rounded-none border-0 p-0",
        // `h-fit` e não `h-auto`: o `<dialog>` nativo vem com `inset: 0`, e
        // altura automática entre top e bottom fixos estica para a viewport
        // inteira em vez de acompanhar o conteúdo.
        "tablet:m-auto tablet:max-h-[calc(100dvh-64px)]",
        // Tela grande de configurações tem altura fixa: o conteúdo muda de
        // tamanho a cada aba, e um modal que pula a cada clique cansa.
        size === "xl" ? "tablet:h-[600px]" : "tablet:h-fit",
        "tablet:rounded-lg tablet:border tablet:border-border-default tablet:shadow-elevated",
        SIZE_CLASS[size],
        closing
          ? "animate-modal-out backdrop:animate-scrim-out"
          : "animate-modal-in backdrop:animate-scrim-in",
      )}
    >
      <div className="flex h-full flex-col">
        {!hideHeader && (
          <header className="flex items-start justify-between gap-4 px-6 pt-6">
            <h2 className="text-heading-2 text-text-primary">{title}</h2>
            <button
              type="button"
              onClick={requestClose}
              aria-label="Fechar"
              className={cn(
                "-mt-1 -mr-2 grid size-8 shrink-0 place-items-center rounded-md",
                "text-text-secondary transition-colors duration-(--duration-fast) ease-out",
                "hover:bg-surface-primary hover:text-text-primary",
              )}
            >
              <X size={20} strokeWidth={2} />
            </button>
          </header>
        )}

        <div className={cn("min-h-0 flex-1", bodyClassName ?? "overflow-y-auto p-6")}>
          {children}
        </div>
      </div>
    </dialog>
  );
}
