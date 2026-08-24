import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Modal } from "../../components/ui/Modal";
import { Tabs, type TabItem } from "../../components/ui/Tabs";

export interface SettingsLayoutProps {
  title: string;
  items: TabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Chassi das telas de configuração (§10, 3.1 e 3.1b) — modal de ~720px com
 * tabs verticais de ~180px à esquerda e conteúdo à direita.
 *
 * Em Mobile as tabs viram uma lista própria em tela cheia; escolher uma
 * navega para o conteúdo, também em tela cheia, com "voltar" para a lista
 * (§10, 3.1, responsividade).
 */
export function SettingsLayout({
  title,
  items,
  activeId,
  onSelect,
  onClose,
  children,
}: SettingsLayoutProps) {
  const [mobileShowContent, setMobileShowContent] = useState(false);
  const active = items.find((item) => item.id === activeId);

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="xl"
      hideHeader
      bodyClassName="flex min-h-0 flex-1 overflow-hidden"
    >
      {/* Coluna de tabs — em Mobile, a primeira das duas telas. */}
      <div
        className={cn(
          "flex w-full shrink-0 flex-col bg-surface-sidebar",
          "tablet:w-[180px] tablet:border-r tablet:border-border-subtle",
          mobileShowContent && "hidden tablet:flex",
        )}
      >
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 px-3">
          <h2 className="min-w-0 truncate text-heading-3 text-text-primary">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-md tablet:hidden",
              "text-text-secondary hover:bg-surface-primary hover:text-text-primary",
            )}
          >
            <X size={20} strokeWidth={2} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <Tabs
            items={items}
            activeId={activeId}
            onSelect={(id) => {
              onSelect(id);
              setMobileShowContent(true);
            }}
          />
        </div>
      </div>

      {/* Conteúdo — em Mobile, a segunda tela, com "voltar". */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          !mobileShowContent && "hidden tablet:flex",
        )}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
          <button
            type="button"
            onClick={() => setMobileShowContent(false)}
            aria-label="Voltar para as seções"
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-md tablet:hidden",
              "text-text-secondary hover:bg-surface-primary hover:text-text-primary",
            )}
          >
            <ChevronLeft size={20} strokeWidth={2} />
          </button>

          <h3 className="min-w-0 flex-1 truncate text-heading-3 text-text-primary">
            {active?.label ?? title}
          </h3>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar configurações"
            className={cn(
              "hidden size-8 shrink-0 place-items-center rounded-md tablet:grid",
              "text-text-secondary hover:bg-surface-primary hover:text-text-primary",
            )}
          >
            <X size={20} strokeWidth={2} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </Modal>
  );
}

/** Seção de conteúdo com o espaçamento de 24px entre blocos (§5.6). */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <h4 className="text-caption text-text-tertiary uppercase">{title}</h4>
      {description && (
        <p className="mt-1 text-meta text-text-tertiary">{description}</p>
      )}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** Zona de perigo (§10, 3.1/3.1b) — sempre no fim, sempre nomeando o efeito. */
export function DangerZone({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <section className="mt-6 rounded-md border border-feedback-danger/40 p-4">
      <h4 className="text-caption text-feedback-danger uppercase">
        Zona de perigo
      </h4>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** Linha clicável de lista (convite, membro do cargo, banido). */
export function SettingsRow({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border-default bg-surface-primary px-3 py-2">
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
