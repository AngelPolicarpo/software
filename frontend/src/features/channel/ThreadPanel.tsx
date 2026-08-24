import { MessagesSquare } from "lucide-react";
import { SlidePanel } from "../../components/ui/SlidePanel";
import { Composer } from "./Composer";
import { MessageRow } from "./MessageRow";
import { useChannelMessages, useThreadForRoot, useThreadReplies } from "../../store/messageStore";
import type { Channel } from "../../domain/types";

export interface ThreadPanelProps {
  channel: Channel;
  rootMessageId: string;
  readOnly: boolean;
  onClose: () => void;
}

/**
 * Painel de thread (§9, 2.2) — sub-conversa ancorada numa mensagem raiz, sem
 * poluir o canal principal. Raiz fixada no topo, respostas em ordem
 * cronológica, composer da thread na base.
 *
 * As respostas continuam aparecendo também no canal: é assim que a
 * transcrição de §2 as documenta (a resposta de Ana às 09:43 está no canal e
 * na thread de moderação), então a thread aqui é uma *vista* sobre as
 * mensagens do canal, não um compartimento separado.
 */
export function ThreadPanel({
  channel,
  rootMessageId,
  readOnly,
  onClose,
}: ThreadPanelProps) {
  const messages = useChannelMessages(channel.id);
  const root = messages.find((message) => message.id === rootMessageId);
  const thread = useThreadForRoot(rootMessageId);
  const replies = useThreadReplies(channel.id, thread);

  if (!root) return null;

  return (
    <SlidePanel title="Thread" onClose={onClose} width={320}>
      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        <div className="border-b border-border-subtle pb-3">
          <MessageRow
            message={root}
            communityId={channel.communityId}
            groupStart
            readOnly={readOnly}
            onReply={() => undefined}
            hideActions
          />
        </div>

        {replies.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <MessagesSquare
              size={28}
              strokeWidth={1.5}
              aria-hidden="true"
              className="text-text-tertiary"
            />
            <p className="text-body text-text-secondary">
              Seja o primeiro a responder
            </p>
          </div>
        ) : (
          replies.map((reply, index) => (
            <MessageRow
              key={reply.id}
              message={reply}
              communityId={channel.communityId}
              groupStart={
                index === 0 || replies[index - 1].authorId !== reply.authorId
              }
              readOnly={readOnly}
              onReply={() => undefined}
              hideActions
            />
          ))
        )}
      </div>

      {!readOnly && thread && (
        <Composer
          key={thread.id}
          channel={channel}
          threadId={thread.id}
          placeholder="Responder na thread"
          compact
        />
      )}
    </SlidePanel>
  );
}
