/**
 * Uma linha da conversa — `MessageDto` de §15.6.1, inteiro.
 *
 * Os campos que a UI mais teria vontade de esconder são justamente os que a spec manda
 * mostrar:
 *
 *  - `clockSkewed` (F-33/M-17): a hora do autor divergia da do host. Dizer é o contrato.
 *  - `deleted` / `content: null`: a tombstone tem lugar na conversa. E U-20 exige a nota de
 *    honestidade — some da interface, os bytes ficam no registro da comunidade.
 *  - `hiddenByBan`: a mensagem foi ocultada por moderação, não sumiu do log.
 *  - `replyTo.deleted` (F-47/M-7): a citação sobrevive ao alvo, com "mensagem removida".
 *  - `editedAt` + U-19: editar não apaga o que havia antes.
 *
 * As reações e o anexo **não** estão no `MessageDto` (§15.6.1) — vêm de `query.message`,
 * carregado sob demanda. Pedir por linha seria uma consulta por mensagem na tela.
 */

import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { useCanal } from "../canal";
import { useMensagens } from "../mensagem";
import { useComunidade } from "../comunidade";
import { useComunidades } from "../comunidades";
import { useSessao } from "../sessao";
import { Anexo } from "./Anexo";
import { Markdown } from "./Markdown";
import { Avatar, Nome } from "./comuns";
import { hora } from "./formato";
import type { MessageDto } from "../../ipc/dto";

const EMOJIS = ["👍", "🎉", "❤️", "😄", "👀", "🙏"] as const;

export function Mensagem({ m, somenteLeitura }: { m: MessageDto; somenteLeitura: boolean }) {
  const detalhes = useMensagens((s) => s.detalhes[m.id]);
  const detalhar = useMensagens((s) => s.detalhar);
  const reagir = useMensagens((s) => s.reagir);
  const fixar = useMensagens((s) => s.fixar);
  const remover = useMensagens((s) => s.remover);
  const editar = useMensagens((s) => s.editar);
  const criarThread = useMensagens((s) => s.criarThread);
  const abrirThread = useMensagens((s) => s.abrirThread);
  const verReatores = useMensagens((s) => s.verReatores);
  const responder = useCanal((s) => s.responder);
  const abrirPerfil = useComunidade((s) => s.abrirPerfil);
  const permissoes = useComunidades((s) => s.detalhe?.myPermissions ?? []);
  // A minha chave vem da identidade da sessão — `hostRef` é de quem hospeda, não de mim.
  const eu = useSessao((s) => s.identidade?.key);

  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(m.content ?? "");
  const [erro, setErro] = useState<string | null>(null);

  // Reações e anexo só chegam por `query.message`: pede quando a linha tem o que pedir.
  useEffect(() => {
    if (m.hasAttachment && detalhes === undefined) void detalhar(m.id);
  }, [m.id, m.hasAttachment, detalhes, detalhar]);

  async function acao(fn: () => Promise<void>): Promise<void> {
    setErro(null);
    try {
      await fn();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "a ação foi recusada");
    }
  }

  if (m.hiddenByBan) {
    return (
      <li className="px-4 py-1.5 text-meta italic text-text-tertiary">
        Mensagem ocultada pela moderação. Ela continua no registro da comunidade.
      </li>
    );
  }

  const podeGerenciar = permissoes.includes("manage_messages");
  const podeFixar = permissoes.includes("pin_messages");
  const minha = eu !== undefined && m.author.key === eu;

  return (
    <li className={"group relative px-4 py-1.5 hover:bg-surface-elevated/40 " + (m.mentionsMe ? "bg-accent-muted-bg/40" : "")}>
      <div className="flex gap-3">
        <button type="button" onClick={() => void abrirPerfil(m.author.key)} className="mt-0.5">
          <Avatar user={m.author} />
        </button>

        <div className="min-w-0 flex-1">
          {m.replyTo !== undefined && (
            <p className="mb-0.5 truncate text-caption text-text-tertiary">
              ↳{" "}
              {m.replyTo.deleted || m.replyTo.excerpt === null ? (
                <em>{m.replyTo.deleted ? "mensagem removida" : "mensagem ainda não replicada aqui"}</em>
              ) : (
                <>
                  {m.replyTo.author !== undefined && <Nome user={m.replyTo.author} className="text-text-secondary" />}{" "}
                  {m.replyTo.excerpt}
                </>
              )}
            </p>
          )}

          <p className="flex flex-wrap items-baseline gap-2">
            <button type="button" onClick={() => void abrirPerfil(m.author.key)}>
              <Nome user={m.author} className="text-body-emphasis text-text-primary" />
            </button>
            <span className="text-caption text-text-tertiary">{hora(m.hostTs)}</span>
            {m.clockSkewed && (
              <span className="text-caption text-feedback-warning" title="A hora declarada pelo autor divergia da do host">
                relógio divergente
              </span>
            )}
            {m.editedAt !== undefined && (
              <span className="text-caption text-text-tertiary" title="A versão anterior continua no registro (U-19)">
                (editada)
              </span>
            )}
            {m.pinned && <span className="text-caption text-accent-default">fixada</span>}
          </p>

          {editando ? (
            <div className="mt-1 flex flex-col gap-2">
              <textarea
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-md border border-border-default bg-surface-elevated px-3 py-2 text-body text-text-primary outline-none"
              />
              <p className="text-caption text-text-tertiary">
                Editar não apaga o conteúdo anterior: ele continua no registro da comunidade e é
                recuperável por quem inspecionar a cópia.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    void acao(async () => {
                      await editar(m.id, rascunho);
                      setEditando(false);
                    })
                  }
                >
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditando(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : m.content === null || m.deleted ? (
            <p className="text-body italic text-text-tertiary">
              Mensagem removida da interface — os bytes continuam no registro da comunidade.
            </p>
          ) : (
            <Markdown conteudo={m.content} />
          )}

          {detalhes?.attachment !== undefined && <Anexo a={detalhes.attachment} />}

          {detalhes !== undefined && detalhes.reactions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {detalhes.reactions.map((r) => (
                <button
                  key={r.emoji}
                  type="button"
                  onDoubleClick={() => void verReatores(m.id, r.emoji)}
                  onClick={() => void acao(() => reagir(m.id, r.emoji, !r.mine))}
                  className={
                    "rounded-full border px-2 py-0.5 text-caption " +
                    (r.mine
                      ? "border-accent-default bg-accent-muted-bg text-text-primary"
                      : "border-border-subtle bg-surface-elevated text-text-secondary")
                  }
                >
                  {r.emoji} {r.count}
                </button>
              ))}
            </div>
          )}

          {m.threadId !== undefined && (
            <button
              type="button"
              onClick={() => void abrirThread(m.threadId!)}
              className="mt-1 text-caption text-accent-default hover:underline"
            >
              {m.threadReplyCount ?? 0} {m.threadReplyCount === 1 ? "resposta" : "respostas"} na thread
            </button>
          )}

          {erro !== null && <p className="mt-1 text-caption text-feedback-danger">{erro}</p>}
        </div>
      </div>

      {!somenteLeitura && !m.deleted && (
        <div className="absolute right-4 top-0 hidden gap-0.5 rounded-md border border-border-subtle bg-surface-primary p-0.5 group-hover:flex">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              title={`Reagir com ${e}`}
              onClick={() => void acao(() => reagir(m.id, e, true))}
              className="rounded px-1 hover:bg-surface-elevated"
            >
              {e}
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => responder(m)}>
            Responder
          </Button>
          {m.threadId === undefined && (
            <Button size="sm" variant="ghost" onClick={() => void acao(() => criarThread(m.id))}>
              Thread
            </Button>
          )}
          {podeFixar && (
            <Button size="sm" variant="ghost" onClick={() => void acao(() => fixar(m.id, !m.pinned))}>
              {m.pinned ? "Desafixar" : "Fixar"}
            </Button>
          )}
          {minha && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRascunho(m.content ?? "");
                setEditando(true);
              }}
            >
              Editar
            </Button>
          )}
          {(minha || podeGerenciar) && (
            <Button size="sm" variant="ghost" onClick={() => void acao(() => remover(m.id))}>
              Remover
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
