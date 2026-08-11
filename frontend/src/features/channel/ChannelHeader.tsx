import { ChevronLeft, Hash, MessagesSquare, Pin, Search, Users, Volume2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { Tooltip } from "../../components/ui/Tooltip";
import type { Channel } from "../../domain/types";

/**
 * Ícone de ação do cabeçalho (§9, 2.1). Os quatro destinos — thread (2.2),
 * fixados, busca (1.2) e membros (1.3) — são painéis que ainda não existem,
 * então o controle fica visível e inativo (`aria-disabled`), nunca some: a
 * regra de esconder-em-vez-de-desabilitar de §15 vale para permissão de
 * moderação, não para navegação.
 */
function HeaderAction({ label, icon: Icon }: { label: string; icon: LucideIcon }) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        aria-disabled="true"
        className="grid size-9 cursor-default place-items-center rounded-md text-text-disabled"
      >
        <Icon size={20} strokeWidth={2} aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </button>
    </Tooltip>
  );
}

export interface ChannelHeaderProps {
  channel: Channel;
  /** §16, Mobile: volta para a lista de canais. */
  onBack: () => void;
}

/** Cabeçalho do canal (§9, 2.1) — nome, tópico e ícones de ação. */
export function ChannelHeader({ channel, onBack }: ChannelHeaderProps) {
  const ChannelIcon = channel.type === "voice" ? Volume2 : Hash;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
      <button
        type="button"
        onClick={onBack}
        className={cn(
          "-ml-2 grid size-9 shrink-0 place-items-center rounded-md",
          "text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
          "transition-colors duration-(--duration-fast) ease-out",
          "tablet:hidden",
        )}
      >
        <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
        <span className="sr-only">Voltar para a lista de canais</span>
      </button>

      <ChannelIcon
        size={20}
        strokeWidth={2}
        aria-hidden="true"
        className="shrink-0 text-text-tertiary"
      />
      <h1 className="shrink-0 truncate text-heading-3 text-text-primary">
        {channel.name}
      </h1>

      {channel.topic && (
        <>
          <span
            className="hidden h-4 w-px shrink-0 bg-border-default tablet:block"
            aria-hidden="true"
          />
          <p className="hidden min-w-0 truncate text-meta text-text-secondary tablet:block">
            {channel.topic}
          </p>
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <HeaderAction label="Threads" icon={MessagesSquare} />
        <HeaderAction label="Mensagens fixadas" icon={Pin} />
        <HeaderAction label="Buscar" icon={Search} />
        <HeaderAction label="Membros" icon={Users} />
      </div>
    </header>
  );
}
