import { Lock } from "lucide-react";
import { cn } from "../../lib/cn";
import { ChannelHeader } from "./ChannelHeader";
import { MessageList } from "./MessageList";
import {
  selectIsChannelReadOnly,
  useCommunityStore,
} from "../../store/communityStore";
import type { Channel } from "../../domain/types";

/**
 * §9, 2.1 — canal somente-leitura para o cargo atual (`#avisos` para quem
 * não é Moderador+): o composer é substituído por este aviso, não fica
 * desabilitado nem some sem explicação.
 */
function ReadOnlyNotice() {
  return (
    <div className="mx-4 mb-4 flex items-center gap-2 rounded-md border border-border-default bg-surface-sidebar px-4 py-3">
      <Lock
        size={16}
        strokeWidth={2}
        aria-hidden="true"
        className="shrink-0 text-text-tertiary"
      />
      <p className="text-body text-text-tertiary">
        Só moderadores podem postar aqui
      </p>
    </div>
  );
}

export interface ChannelViewProps {
  channel: Channel;
  onBack: () => void;
  className?: string;
}

/**
 * Área de conteúdo do shell com um canal de texto aberto (§8 1.1, §9 2.1).
 * Cabeçalho + histórico em leitura; o composer e o resto de 2.1 entram na
 * próxima parte.
 */
export function ChannelView({ channel, onBack, className }: ChannelViewProps) {
  const readOnly = useCommunityStore((state) =>
    selectIsChannelReadOnly(state, channel),
  );

  return (
    <section
      className={cn(
        "flex min-w-0 flex-1 flex-col bg-surface-primary",
        className,
      )}
    >
      <ChannelHeader channel={channel} onBack={onBack} />
      <MessageList channel={channel} />
      {readOnly && <ReadOnlyNotice />}
    </section>
  );
}
