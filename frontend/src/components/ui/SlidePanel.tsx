import { useEffect } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";
import { cn } from "../../lib/cn";

/**
 * Painel deslizante do slot direito (§6) — membros e thread dividem este
 * espaço, e abrir um fecha o outro (quem garante isso é o `rightPanel` do
 * `uiStore`, que é um valor só).
 *
 * Layout por breakpoint (§16): **Desktop** coluna fixa no fluxo, do lado do
 * conteúdo; **Tablet** overlay flutuante ancorado à direita com scrim leve,
 * que fecha ao clicar fora; **Mobile** tela cheia com "voltar".
 *
 * Divergência registrada da spec: §17 diz que no Desktop o painel lateral
 * *sobrepõe* o conteúdo para não causar reflow do texto em leitura, mas §5.6
 * (tabela do grid) e §16 (tabela de breakpoints) descrevem o painel direito
 * como coluna fixa de 280px. Duas seções contra uma linha — vale a coluna, e
 * a divergência fica anotada aqui e no status de implementação.
 */
export interface SlidePanelProps {
  title: string;
  onClose: () => void;
  /** Largura da coluna no Desktop; cada tela declara a sua (§5.6, §9 2.2). */
  width?: number;
  /** Ação extra no cabeçalho, à esquerda do fechar. */
  headerAction?: ReactNode;
  children: ReactNode;
}

export function SlidePanel({
  title,
  onClose,
  width = 280,
  headerAction,
  children,
}: SlidePanelProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <>
      {/* Scrim leve só no Tablet, onde o painel flutua sobre o conteúdo. */}
      <button
        type="button"
        aria-label="Fechar painel"
        onClick={onClose}
        className="fixed inset-0 z-30 hidden bg-surface-overlay-scrim/60 tablet:block desktop:hidden"
      />

      <aside
        aria-label={title}
        style={{ ["--panel-w" as string]: `${width}px` }}
        className={cn(
          "flex flex-col bg-surface-sidebar animate-panel-in",
          // Mobile: tela cheia por cima da pilha de §16.
          "fixed inset-0 z-40",
          // Tablet: overlay flutuante à direita.
          "tablet:inset-y-0 tablet:right-0 tablet:left-auto tablet:w-[340px]",
          "tablet:border-l tablet:border-border-default tablet:shadow-elevated",
          // Desktop: coluna fixa no fluxo, sem sombra nem scrim.
          "desktop:static desktop:z-auto desktop:w-(--panel-w) desktop:shrink-0",
          "desktop:border-l desktop:border-border-default desktop:shadow-none",
        )}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "-ml-2 grid size-9 shrink-0 place-items-center rounded-md",
              "text-text-secondary hover:bg-surface-primary hover:text-text-primary",
              "transition-colors duration-(--duration-fast) ease-out",
              "tablet:hidden",
            )}
          >
            <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Voltar</span>
          </button>

          <h2 className="min-w-0 flex-1 truncate text-heading-3 text-text-primary">
            {title}
          </h2>

          {headerAction}

          <button
            type="button"
            onClick={onClose}
            className={cn(
              "hidden size-8 shrink-0 place-items-center rounded-md",
              "text-text-secondary hover:bg-surface-primary hover:text-text-primary",
              "transition-colors duration-(--duration-fast) ease-out",
              "tablet:grid",
            )}
          >
            <X size={20} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Fechar {title}</span>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </aside>
    </>
  );
}
