import { Bold, Code, Italic } from "lucide-react";
import { cn } from "../../lib/cn";

const MARKS = [
  { id: "bold", label: "Negrito", icon: Bold, wrap: "**" },
  { id: "italic", label: "Itálico", icon: Italic, wrap: "*" },
  { id: "code", label: "Código", icon: Code, wrap: "`" },
] as const;

/**
 * Formatação (§6): atalho para o markdown que C9 descreve digitado.
 * Fica fora do Mobile para não espremer a barra — o caminho equivalente
 * (digitar `**`) continua disponível lá (§19.4).
 */
export function ComposerFormatting({
  compact,
  onWrap,
}: {
  /** Coluna estreita (painel de thread): esconde a barra em qualquer largura. */
  compact: boolean;
  onWrap: (wrap: string) => void;
}) {
  return (
    <div className={cn("hidden items-center gap-0.5", !compact && "tablet:flex")}>
      {MARKS.map(({ id, label, icon: Icon, wrap }) => (
        <button
          key={id}
          type="button"
          onClick={() => onWrap(wrap)}
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-md",
            "text-text-secondary hover:bg-surface-primary hover:text-text-primary",
            "transition-colors duration-(--duration-fast) ease-out",
          )}
        >
          <Icon size={18} strokeWidth={2} aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
