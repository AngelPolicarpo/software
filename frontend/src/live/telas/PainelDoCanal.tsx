/**
 * Painéis laterais do canal: fixados, arquivos, links, busca e membros.
 *
 * Os três primeiros são páginas próprias de §15.6 (`query.pinned`, `query.files`,
 * `query.links`) — não são recortes da lista de mensagens já carregada. A diferença importa:
 * filtrar no cliente mostraria só o que coube na última página, e o painel ficaria mentindo
 * por omissão.
 */

import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { Spinner } from "../../components/ui/Spinner";
import { api } from "../../ipc/api";
import { useCanal } from "../canal";
import { useMensagens } from "../mensagem";
import { useBusca, MOTIVO_PARCIAL } from "../busca";
import { Membros } from "./Membros";
import { Avatar, Nome, Vazio } from "./comuns";
import { dataHora, hora, tamanho } from "./formato";
import type { FileItem, LinkItem, MessageDto } from "../../ipc/dto";

function Fixados({ communityId, channelId }: { communityId: string; channelId: string }) {
  const [itens, setItens] = useState<MessageDto[] | null>(null);
  useEffect(() => {
    void api
      .pinned({ communityId, channelId })
      .then((p) => setItens(p.items))
      .catch(() => setItens([]));
  }, [communityId, channelId]);

  if (itens === null) return <Vazio>Carregando…</Vazio>;
  if (itens.length === 0) return <Vazio>Nenhuma mensagem fixada neste canal.</Vazio>;
  return (
    <ul className="flex flex-col gap-3">
      {itens.map((m) => (
        <li key={m.id} className="rounded-md border border-border-subtle bg-surface-elevated p-2">
          <p className="flex items-baseline gap-2">
            <Nome user={m.author} className="text-meta text-text-primary" />
            <span className="text-caption text-text-tertiary">{hora(m.hostTs)}</span>
          </p>
          <p className="mt-0.5 line-clamp-3 text-meta text-text-secondary">
            {m.content ?? <em>mensagem removida</em>}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Arquivos({ communityId, channelId }: { communityId: string; channelId: string }) {
  const [itens, setItens] = useState<FileItem[] | null>(null);
  useEffect(() => {
    void api
      .files({ communityId, channelId })
      .then((p) => setItens(p.items))
      .catch(() => setItens([]));
  }, [communityId, channelId]);

  if (itens === null) return <Vazio>Carregando…</Vazio>;
  if (itens.length === 0) return <Vazio>Nenhum arquivo enviado neste canal.</Vazio>;
  return (
    <ul className="flex flex-col gap-2">
      {itens.map((f) => (
        <li key={f.messageId} className="flex items-center gap-2">
          <Avatar user={f.author} size={24} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-meta text-text-primary">{f.attachment.name}</p>
            <p className="text-caption text-text-tertiary">
              {tamanho(f.attachment.sizeBytes)} · {dataHora(f.at)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Links({ communityId, channelId }: { communityId: string; channelId: string }) {
  const [itens, setItens] = useState<LinkItem[] | null>(null);
  useEffect(() => {
    void api
      .links({ communityId, channelId })
      .then((p) => setItens(p.items))
      .catch(() => setItens([]));
  }, [communityId, channelId]);

  if (itens === null) return <Vazio>Carregando…</Vazio>;
  if (itens.length === 0) return <Vazio>Nenhum link neste canal.</Vazio>;
  return (
    <ul className="flex flex-col gap-2">
      {itens.map((l) => (
        <li key={`${l.messageId}-${l.url}`} className="min-w-0">
          {/* §15.6.1 — sem unfurl, nunca: buscar a página vazaria o IP de todo mundo. */}
          <p className="truncate text-meta text-text-primary">{l.url}</p>
          <p className="text-caption text-text-tertiary">
            {l.host} · <Nome user={l.author} /> · {dataHora(l.at)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Busca({ channelId }: { channelId: string }) {
  const busca = useBusca();
  const [escopoCanal, setEscopoCanal] = useState(true);

  return (
    <div className="flex h-full flex-col gap-3">
      <TextField
        label="Buscar na comunidade"
        value={busca.termo}
        onChange={(v) => void busca.buscar(v, escopoCanal ? channelId : null)}
        autoFocus
      />
      <label className="flex items-center gap-2 text-caption text-text-secondary">
        <input
          type="checkbox"
          checked={escopoCanal}
          onChange={(e) => {
            setEscopoCanal(e.target.checked);
            void busca.buscar(busca.termo, e.target.checked ? channelId : null);
          }}
        />
        Só neste canal
      </label>
      <p className="text-caption text-text-tertiary">
        O texto é procurado como texto: <code>AND</code>, <code>OR</code>, <code>*</code> e{" "}
        <code>:</code> são literais, não operadores.
      </p>

      {busca.buscando && (
        <p className="flex items-center gap-2 text-meta text-text-tertiary">
          <Spinner /> Procurando…
        </p>
      )}
      {busca.erro !== null && <p className="text-meta text-feedback-danger">{busca.erro}</p>}

      {busca.resultado !== null && (
        <div className="flex-1 overflow-y-auto">
          {/* §14.5 — resultado incompleto se apresentando como completo é o pior desfecho. */}
          {busca.resultado.partial && (
            <p className="mb-2 rounded-md bg-conn-degraded/15 p-2 text-caption text-text-secondary">
              Resultado incompleto:{" "}
              {MOTIVO_PARCIAL[busca.resultado.partialReason ?? ""] ?? "parte do histórico não foi varrida"}.
            </p>
          )}

          {busca.resultado.channels.length > 0 && (
            <section className="mb-3">
              <h4 className="pb-1 text-caption uppercase text-text-tertiary">Canais</h4>
              <ul className="text-meta text-text-secondary">
                {busca.resultado.channels.map((c) => (
                  <li key={c.id}>#{c.name}</li>
                ))}
              </ul>
            </section>
          )}

          {busca.resultado.members.length > 0 && (
            <section className="mb-3">
              <h4 className="pb-1 text-caption uppercase text-text-tertiary">Pessoas</h4>
              <ul className="flex flex-col gap-1">
                {busca.resultado.members.map((u) => (
                  <li key={u.key} className="flex items-center gap-2">
                    <Avatar user={u} size={22} />
                    <Nome user={u} className="text-meta text-text-secondary" />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h4 className="pb-1 text-caption uppercase text-text-tertiary">Mensagens</h4>
            {busca.resultado.messages.length === 0 ? (
              <Vazio>Nada encontrado.</Vazio>
            ) : (
              <ul className="flex flex-col gap-2">
                {busca.resultado.messages.map((m) => (
                  <li key={m.id} className="rounded-md border border-border-subtle p-2">
                    <p className="flex items-baseline gap-2">
                      <Nome user={m.author} className="text-meta text-text-primary" />
                      <span className="text-caption text-text-tertiary">
                        #{m.channelName} · {hora(m.hostTs)}
                      </span>
                    </p>
                    <p className="mt-0.5 text-meta text-text-secondary">{m.snippet}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

const TITULO = {
  membros: "Membros",
  fixados: "Fixadas",
  arquivos: "Arquivos",
  links: "Links",
  busca: "Buscar",
} as const;

export function PainelDoCanal() {
  const painel = useMensagens((s) => s.painel);
  const abrirPainel = useMensagens((s) => s.abrirPainel);
  const communityId = useCanal((s) => s.communityId);
  const channelId = useCanal((s) => s.channelId);

  if (painel === null || communityId === null || channelId === null) return null;

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border-subtle bg-surface-sidebar">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle px-4">
        <h3 className="text-body-emphasis text-text-primary">{TITULO[painel]}</h3>
        <Button size="sm" variant="ghost" onClick={() => abrirPainel(null)}>
          Fechar
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {painel === "membros" && <Membros />}
        {painel === "fixados" && <Fixados communityId={communityId} channelId={channelId} />}
        {painel === "arquivos" && <Arquivos communityId={communityId} channelId={channelId} />}
        {painel === "links" && <Links communityId={communityId} channelId={channelId} />}
        {painel === "busca" && <Busca channelId={channelId} />}
      </div>
    </aside>
  );
}
