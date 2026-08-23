/**
 * Gaveta de thread — `query.thread` (§15.6, fecha DR-48).
 *
 * A raiz vem junto com as respostas na mesma consulta, e a contagem de não-lidas da thread é
 * própria (`unread.count`): thread tem estado de leitura separado do canal, e é por isso que
 * `thread.markRead` existe como comando à parte de `channel.markRead`.
 *
 * Responder na thread é `message.send` com `threadId` — mesmo comando, mesma fila, mesmo
 * desfecho por evento. Não há caminho especial para thread, e inventar um criaria uma
 * segunda fila.
 */

import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { useCanal } from "../canal";
import { useMensagens } from "../mensagem";
import { api } from "../../ipc/api";
import { Avatar, Nome, Vazio } from "./comuns";
import { hora } from "./formato";
import { mensagemDeErro } from "../sessao";
import type { MessageDto } from "../../ipc/dto";

function Linha({ m }: { m: MessageDto }) {
  return (
    <li className="flex gap-2 py-1.5">
      <Avatar user={m.author} size={28} />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <Nome user={m.author} className="text-meta text-text-primary" />
          <span className="text-caption text-text-tertiary">{hora(m.hostTs)}</span>
          {m.clockSkewed && <span className="text-caption text-feedback-warning">relógio divergente</span>}
        </p>
        <p className="whitespace-pre-wrap break-words text-meta text-text-secondary">
          {m.content ?? <em>mensagem removida</em>}
        </p>
      </div>
    </li>
  );
}

export function Thread() {
  const thread = useMensagens((s) => s.thread);
  const threadId = useMensagens((s) => s.threadId);
  const fechar = useMensagens((s) => s.fecharThread);
  const communityId = useCanal((s) => s.communityId);
  const channelId = useCanal((s) => s.channelId);

  const [rascunho, setRascunho] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (threadId === null || communityId === null || channelId === null) return null;

  async function enviar(): Promise<void> {
    const texto = rascunho.trim();
    if (texto.length === 0) return;
    setEnviando(true);
    setErro(null);
    try {
      await api.messageSend({ communityId: communityId!, channelId: channelId!, content: texto, threadId: threadId! });
      setRascunho("");
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border-subtle bg-surface-sidebar">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle px-4">
        <h3 className="text-body-emphasis text-text-primary">
          Thread{thread !== null ? ` — ${thread.replyCount} ${thread.replyCount === 1 ? "resposta" : "respostas"}` : ""}
        </h3>
        <Button size="sm" variant="ghost" onClick={fechar}>
          Fechar
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        {thread === null ? (
          <Vazio>Carregando a thread…</Vazio>
        ) : (
          <>
            <ul className="border-b border-border-subtle">
              <Linha m={thread.root} />
            </ul>
            <ul>
              {thread.replies.map((r) => (
                <Linha key={r.id} m={r} />
              ))}
            </ul>
            {thread.participants.length > 0 && (
              <p className="py-2 text-caption text-text-tertiary">
                {thread.participants.length}{" "}
                {thread.participants.length === 1 ? "participante" : "participantes"}
              </p>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 border-t border-border-subtle p-3">
        <div className="flex gap-2">
          <textarea
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            rows={1}
            placeholder="Responder na thread"
            className="min-h-9 flex-1 resize-none rounded-md border border-border-default bg-surface-elevated px-3 py-2 text-meta text-text-primary outline-none placeholder:text-text-tertiary"
          />
          <Button size="sm" loading={enviando} onClick={() => void enviar()}>
            Enviar
          </Button>
        </div>
        {erro !== null && <p className="pt-1 text-caption text-feedback-danger">{erro}</p>}
      </div>
    </aside>
  );
}
