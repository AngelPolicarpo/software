import { useEffect } from "react";
import { MessagesSquare } from "lucide-react";
import { SlidePanel } from "../../components/ui/SlidePanel";
import { Composer } from "./Composer";
import { MessageRow } from "./MessageRow";
import {
  useChannelMessages,
  THREAD_TEMPORARIA_PREFIXO,
  useThreadForRoot,
  useThreadReplies,
  useThreadLeitura,
  useMessageStore,
} from "../../store/messageStore";
import type { Channel, Message } from "../../domain/types";

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
 * mensagens do canal, não um compartimento separado. A leitura de `query.thread`
 * entra como segunda fonte: cobre as respostas fora da janela de 50 do canal —
 * inclusive as de outras instalações — e o total do fio.
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
  const doCanal = useThreadReplies(channel.id, thread);
  const leitura = useThreadLeitura(thread?.id);
  const hidratarThread = useMessageStore((state) => state.hidratarThread);

  const threadIdReal = thread && !thread.id.startsWith(THREAD_TEMPORARIA_PREFIXO) ? thread.id : undefined;
  useEffect(() => {
    if (threadIdReal !== undefined) hidratarThread(channel.communityId, threadIdReal);
  }, [threadIdReal, channel.communityId, hidratarThread]);

  if (!root) return null;

  const respostas = mesclarRespostas(doCanal, leitura?.respostas);

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

        {respostas.length === 0 ? (
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
          respostas.map((reply, index) => (
            <MessageRow
              key={reply.id}
              message={reply}
              communityId={channel.communityId}
              groupStart={
                index === 0 || respostas[index - 1].authorId !== reply.authorId
              }
              readOnly={readOnly}
              onReply={() => undefined}
              hideActions
            />
          ))
        )}
      </div>

      {!readOnly && thread && (
        thread.id.startsWith(THREAD_TEMPORARIA_PREFIXO) ? (
          // A criação ainda não foi projetada: responder agora seria op com
          // threadId desconhecida do fold. "Abrindo a thread…" é a verdade.
          <p className="px-4 pb-4 text-meta text-text-tertiary">
            Abrindo a thread…
          </p>
        ) : (
          <Composer
            key={thread.id}
            channel={channel}
            threadId={thread.id}
            placeholder="Responder na thread"
            compact
          />
        )
      )}
    </SlidePanel>
  );
}

/**
 * As duas fontes de respostas — a página do canal (ao vivo por
 * `messages.appended`) e a leitura de `query.thread` (janela completa) —
 * mescladas sem duplicar, na ordem em que o log as aplicou.
 */
function mesclarRespostas(doCanal: Message[], daLeitura: Message[] | undefined): Message[] {
  if (daLeitura === undefined || daLeitura.length === 0) return doCanal;
  const porId = new Map(doCanal.map((m) => [m.id, m]));
  for (const m of daLeitura) if (!porId.has(m.id)) porId.set(m.id, m);
  return [...porId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
