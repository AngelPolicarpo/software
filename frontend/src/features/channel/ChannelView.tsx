import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { cn } from "../../lib/cn";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { ChannelHeader } from "./ChannelHeader";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import {
  selectIsChannelReadOnly,
  useCommunityStore,
} from "../../store/communityStore";
import { useHostStatus } from "../../store/connectionStore";
import type { Channel, Community, Message } from "../../domain/types";

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
  community: Community;
  channel: Channel;
  onBack: () => void;
  className?: string;
}

/**
 * Área de conteúdo do shell com um canal de texto aberto (§8 1.1, §9 2.1).
 *
 * O banner de host offline (§11, B4) fica acima da lista e não bloqueia a
 * leitura: o histórico da réplica local é dado válido, não erro.
 */
export function ChannelView({
  community,
  channel,
  onBack,
  className,
}: ChannelViewProps) {
  const readOnly = useCommunityStore((state) =>
    selectIsChannelReadOnly(state, channel),
  );
  const hostStatus = useHostStatus(community);

  // Resposta em preparo (§9, 2.1) — some ao trocar de canal, junto com o
  // rascunho do composer.
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  useEffect(() => setReplyTo(null), [channel.id]);

  return (
    <section
      className={cn(
        "flex min-w-0 flex-1 flex-col bg-surface-primary",
        className,
      )}
    >
      <ChannelHeader channel={channel} onBack={onBack} />

      {hostStatus === "offline" && (
        <StatusBanner tone="offline">
          {community.name} está offline — mostrando histórico salvo neste
          dispositivo
        </StatusBanner>
      )}
      {hostStatus === "reconnecting" && (
        <StatusBanner tone="reconnecting">Reconectando…</StatusBanner>
      )}

      <MessageList channel={channel} readOnly={readOnly} onReply={setReplyTo} />

      {readOnly ? (
        <ReadOnlyNotice />
      ) : (
        <Composer
          // Trocar de canal zera o rascunho e o autocomplete.
          key={channel.id}
          channel={channel}
          hostOffline={hostStatus === "offline"}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
        />
      )}
    </section>
  );
}
