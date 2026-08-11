import { AppWindow, Monitor } from "lucide-react";
import { cn } from "../../lib/cn";
import { Modal } from "../../components/ui/Modal";

/**
 * §9, 2.4 — "iniciar compartilhamento (escolher janela/tela — mock simula
 * sem captura real de tela)". As fontes são fixas e nomeadas: sem
 * `getDisplayMedia`, inventar uma miniatura de tela real seria mentira.
 */
const SOURCES = [
  { id: "screen", label: "Tela inteira", icon: Monitor },
  { id: "browser", label: "Janela — Navegador", icon: AppWindow },
  { id: "editor", label: "Janela — Editor de código", icon: AppWindow },
];

export interface ShareSourceModalProps {
  onSelect: (sourceLabel: string) => void;
  onClose: () => void;
}

export function ShareSourceModal({ onSelect, onClose }: ShareSourceModalProps) {
  return (
    <Modal open onClose={onClose} title="Compartilhar tela" size="md">
      <div className="flex flex-col gap-3">
        <p className="text-body text-text-secondary">
          Escolha o que transmitir para quem está em chamada.
        </p>

        <ul className="flex flex-col gap-2">
          {SOURCES.map((source) => (
            <li key={source.id}>
              <button
                type="button"
                onClick={() => onSelect(source.label)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border border-border-default",
                  "bg-surface-primary px-3 py-3 text-left",
                  "transition-colors duration-(--duration-fast) ease-out",
                  "hover:border-border-strong hover:bg-surface-elevated",
                )}
              >
                <source.icon
                  size={20}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="shrink-0 text-text-secondary"
                />
                <span className="text-body text-text-primary">
                  {source.label}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p className="text-meta text-text-tertiary">
          O mock não captura sua tela — a transmissão é simulada.
        </p>
      </div>
    </Modal>
  );
}
