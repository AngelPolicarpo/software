import { useState } from "react";
import { AppWindow, Monitor } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { SHARE_MAX_VIEWERS } from "../../ipc/api";
import type { ShareQuality } from "../../store/voiceStore";

/**
 * §17.5 — o que transmitir e em que perfil.
 *
 * **A escolha da fonte concreta não é feita aqui.** Quem a faz é o seletor do sistema, que
 * o Electron abre no `setDisplayMediaRequestHandler` do main — e é ele que sabe quais
 * janelas existem. O que esta tela escolhe é o *tipo* (tela inteira ou janela), que vira o
 * `types` do `desktopCapturer`, e o perfil de qualidade, que vira o `quality` do
 * `share.start`.
 *
 * A lista de fontes inventada que morava aqui ("Janela — Navegador", "Janela — Editor de
 * código") era do mock: sem captura real, nomear janelas que não existem seria mentira. Com
 * captura real, quem nomeia é o sistema.
 */
const TIPOS = [
  {
    id: "screen" as const,
    label: "Tela inteira",
    hint: "Tudo o que aparece no seu monitor",
    icon: Monitor,
  },
  {
    id: "window" as const,
    label: "Uma janela",
    hint: "Só o aplicativo que você escolher",
    icon: AppWindow,
  },
];

/** §17.5 — `high` 2500 kbps · `balanced` 1200 · `low` 600. */
const QUALIDADES: Array<{ id: ShareQuality; label: string; hint: string }> = [
  { id: "high", label: "Alta", hint: "2500 kbps — texto pequeno legível" },
  { id: "balanced", label: "Equilibrada", hint: "1200 kbps — o padrão" },
  { id: "low", label: "Baixa", hint: "600 kbps — conexões apertadas" },
];

export interface ShareSourceModalProps {
  onSelect: (a: { kind: "screen" | "window"; quality: ShareQuality }) => void;
  onClose: () => void;
}

export function ShareSourceModal({ onSelect, onClose }: ShareSourceModalProps) {
  const [kind, setKind] = useState<"screen" | "window">("screen");
  const [quality, setQuality] = useState<ShareQuality>("balanced");

  return (
    <Modal open onClose={onClose} title="Compartilhar tela" size="md">
      <div className="flex flex-col gap-4">
        <p className="text-body text-text-secondary">
          Quem está na chamada pode assistir — até {SHARE_MAX_VIEWERS} pessoas.
        </p>

        <ul className="flex flex-col gap-2">
          {TIPOS.map((tipo) => (
            <li key={tipo.id}>
              <button
                type="button"
                aria-pressed={kind === tipo.id}
                onClick={() => setKind(tipo.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md border px-3 py-3 text-left",
                  "transition-colors duration-(--duration-fast) ease-out",
                  kind === tipo.id
                    ? "border-border-strong bg-surface-elevated"
                    : "border-border-default bg-surface-primary hover:border-border-strong hover:bg-surface-elevated",
                )}
              >
                <tipo.icon
                  size={20}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="shrink-0 text-text-secondary"
                />
                <span className="flex flex-col">
                  <span className="text-body text-text-primary">{tipo.label}</span>
                  <span className="text-meta text-text-tertiary">{tipo.hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-meta text-text-secondary">Qualidade</legend>
          <div className="flex flex-wrap gap-2">
            {QUALIDADES.map((q) => (
              <button
                key={q.id}
                type="button"
                aria-pressed={quality === q.id}
                onClick={() => setQuality(q.id)}
                title={q.hint}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-meta",
                  "transition-colors duration-(--duration-fast) ease-out",
                  quality === q.id
                    ? "border-border-strong bg-surface-elevated text-text-primary"
                    : "border-border-default text-text-secondary hover:border-border-strong",
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
        </fieldset>

        <p className="text-meta text-text-tertiary">
          O sistema vai perguntar exatamente o que compartilhar antes de começar.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onSelect({ kind, quality })}>Compartilhar</Button>
        </div>
      </div>
    </Modal>
  );
}
