/**
 * Canal aberto — mensagens de `query.messages`, fila de envio de `query.outbox` e o que os
 * eventos de §15.5 mandam reconsultar.
 *
 * O que a tela promete é exatamente o que o fio entrega:
 *
 *  - a mensagem só aparece na lista depois que o log a tem (`messages.appended` →
 *    reconsulta). Antes disso ela está **na fila**, desenhada como fila;
 *  - `clockSkewed` (§15.6.1) é dito, não escondido: hora do autor divergente do host é
 *    informação, não erro a mascarar;
 *  - `content: null` é tombstone (§15.6.1), e o lugar dele continua na conversa;
 *  - a barra de estado usa o enum de `hostStatus` e o `ReplicationState` da própria página.
 *
 * U-17: comunidade encerrada entra em modo histórico — cabeçalho nomeado com a data e
 * nenhuma superfície de escrita.
 */

import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { Spinner } from "../../components/ui/Spinner";
import { useCanal } from "../canal";
import { useComunidades } from "../comunidades";
import { useComunidade } from "../comunidade";
import { useMensagens } from "../mensagem";
import { mensagemDeErro } from "../sessao";
import { Mensagem } from "./Mensagem";
import { Mencoes } from "./Mencoes";
import { trechoDeMencao } from "../mencoes";
import { ModeracaoPropria } from "./ModeracaoPropria";
import { tamanho } from "./formato";
import type { ReplicationState } from "../../ipc/dto";

const REPLICACAO: Record<ReplicationState, { tom: "offline" | "reconnecting" | "degraded" | "failed"; texto: string }> = {
  synced: { tom: "reconnecting", texto: "" },
  "catching-up": { tom: "reconnecting", texto: "Alcançando o histórico do host — o que falta ainda não chegou." },
  stalled: { tom: "degraded", texto: "A replicação parou de avançar. O que está na tela é o que chegou até agora." },
  blocked: { tom: "failed", texto: "A replicação está bloqueada." },
  unauthorized: { tom: "failed", texto: "O host não autoriza mais esta réplica." },
  forked: { tom: "failed", texto: "O histórico bifurcou (§5.5 L-4). Nada novo é aceito." },
};

function data(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function Canal() {
  const canal = useCanal();
  const abrirPainel = useMensagens((s) => s.abrirPainel);
  const painel = useMensagens((s) => s.painel);
  const carregarSelfModeration = useComunidade((s) => s.carregarSelfModeration);
  const self = useComunidade((s) => s.selfModeration);
  const detalhe = useComunidades((s) => s.detalhe);
  const hostStatus = useComunidades((s) => s.hostStatus);
  const estrutura = useComunidades((s) => s.estrutura);

  // §18.4 — o próprio ban/kick decide se este canal ainda aceita escrita.
  useEffect(() => {
    void carregarSelfModeration();
  }, [carregarSelfModeration, canal.communityId]);

  const [rascunho, setRascunho] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  // Chaves das pessoas escolhidas no autocomplete — é isso que vai em `mentions[]`.
  const [mencionados, setMencionados] = useState<Record<string, string>>({});
  const [mencao, setMencao] = useState<{ inicio: number; termo: string } | null>(null);

  const ch = estrutura?.categories.flatMap((c) => c.channels).find((c) => c.id === canal.channelId) ?? null;
  const encerrada = detalhe?.endedAt !== undefined;
  const moderada = self !== null && (self.banned || self.kicked);
  const emTimeout = self?.timeoutUntil !== undefined && self.timeoutUntil > Date.now();
  const somenteLeitura = encerrada || moderada || emTimeout || (ch?.readOnly ?? false);

  const nomePorChave = new Map<string, string>();
  for (const g of canal.membros?.groups ?? []) {
    for (const m of g.members) nomePorChave.set(m.key, m.nickname ?? m.displayName);
  }
  const digitando = canal.digitando.map((k) => nomePorChave.get(k) ?? "alguém");

  if (canal.channelId === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-meta text-text-tertiary">
        Escolha um canal para começar.
      </div>
    );
  }

  const rep = canal.replicacao === null ? null : REPLICACAO[canal.replicacao];

  async function enviar(): Promise<void> {
    const texto = rascunho.trim();
    // Anexo sem legenda é envio válido: o conteúdo da mensagem é o arquivo.
    if (texto.length === 0 && canal.anexo === null) return;
    setEnviando(true);
    setErroEnvio(null);
    try {
      // Só entram as chaves de quem continua citado no texto final.
      const chaves = Object.entries(mencionados)
        .filter(([, handle]) => texto.includes(`@${handle}`))
        .map(([key]) => key);
      await canal.enviar(texto, chaves);
      setRascunho("");
      setMencionados({});
    } catch (e) {
      setErroEnvio(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-surface-primary">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle px-4">
        <h2 className="text-body-emphasis text-text-primary">#{ch?.name ?? canal.channelId}</h2>
        {ch?.topic !== undefined && <p className="truncate text-meta text-text-tertiary">{ch.topic}</p>}
        <div className="ml-auto flex gap-1">
          {(["busca", "fixados", "arquivos", "links", "membros"] as const).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={painel === p ? "secondary" : "ghost"}
              onClick={() => abrirPainel(p)}
            >
              {p === "busca" ? "Buscar" : p === "fixados" ? "Fixadas" : p === "arquivos" ? "Arquivos" : p === "links" ? "Links" : "Membros"}
            </Button>
          ))}
          {/* Fora do escopo desta fatia: mídia pela rede real. O botão existe, desabilitado,
              com o motivo NOMEADO — melhor que esconder a capacidade ou fingir que funciona. */}
          <Button size="sm" variant="secondary" disabled title="Voz entra na fatia de mídia real (TURN/relay)">
            Voz
          </Button>
          <Button size="sm" variant="secondary" disabled title="Compartilhar tela entra na fatia de mídia real">
            Tela
          </Button>
        </div>
      </header>

      <ModeracaoPropria />

      {encerrada && detalhe?.endedAt !== undefined && (
        <StatusBanner tone="offline">
          Esta comunidade foi encerrada em {data(detalhe.endedAt)}. O histórico continua legível; não há escrita.
        </StatusBanner>
      )}

      {!encerrada && hostStatus !== null && hostStatus.status !== "online" && (
        <StatusBanner tone={hostStatus.status === "offline" ? "offline" : "reconnecting"}>
          {hostStatus.status === "offline"
            ? "Host offline — você lê a cópia local; o que enviar fica na fila."
            : `Host ${hostStatus.status}${hostStatus.attempt !== undefined ? ` (tentativa ${hostStatus.attempt})` : ""}.`}
        </StatusBanner>
      )}

      {rep !== null && rep.texto !== "" && <StatusBanner tone={rep.tom}>{rep.texto}</StatusBanner>}

      <div className="flex-1 overflow-y-auto">
        {canal.carregando && (
          <p className="flex items-center gap-2 px-4 py-3 text-meta text-text-tertiary">
            <Spinner /> Lendo o canal…
          </p>
        )}
        {canal.erro !== null && <p className="px-4 py-3 text-meta text-feedback-danger">{canal.erro}</p>}
        {canal.temMais && (
          <div className="px-4 py-2">
            <Button size="sm" variant="ghost" onClick={() => void canal.carregarMais()}>
              Carregar mensagens anteriores
            </Button>
          </div>
        )}
        <ul className="py-2">
          {canal.mensagens.map((m) => (
            <Mensagem key={m.id} m={m} somenteLeitura={somenteLeitura} />
          ))}
        </ul>

        {/* A fila NÃO se mistura à conversa: ela é o que ainda não é histórico (§11.1). */}
        {canal.fila.length > 0 && (
          <ul className="border-t border-border-subtle px-4 py-2">
            {canal.fila.map((i) => (
              <li key={i.opId} className="flex items-center gap-2 py-1 text-meta">
                <span className="flex-1 truncate text-text-secondary">{i.content ?? "(sem prévia)"}</span>
                <span className="text-caption text-text-tertiary">
                  {i.state === "queued" && "na fila"}
                  {i.state === "sending" && "enviando"}
                  {i.state === "failed" && `falhou${i.lastError !== undefined ? ` — ${i.lastError}` : ""}`}
                  {i.state === "dropped" && `descartada — ${i.droppedReason ?? "sem motivo declarado"}`}
                </span>
                {i.state === "failed" && (
                  // §15.1 r. 7 — "tentar de novo" reenvia o MESMO `opId`.
                  <Button size="sm" variant="ghost" onClick={() => void canal.tentarDeNovo(i.opId)}>
                    Tentar de novo
                  </Button>
                )}
                {(i.state === "queued" || i.state === "failed") && (
                  <Button size="sm" variant="ghost" onClick={() => void canal.cancelar(i.opId)}>
                    Cancelar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-border-subtle px-4 py-3">
        {digitando.length > 0 && (
          <p className="pb-1 text-caption text-text-tertiary">
            {digitando.join(", ")} {digitando.length === 1 ? "está digitando" : "estão digitando"}…
          </p>
        )}
        {canal.respondendo !== null && (
          <div className="mb-1 flex items-center gap-2 text-caption text-text-tertiary">
            <span className="min-w-0 flex-1 truncate">
              Respondendo a {canal.respondendo.author.nickname ?? canal.respondendo.author.displayName}:{" "}
              {canal.respondendo.content ?? "mensagem removida"}
            </span>
            <button type="button" onClick={() => canal.responder(null)} className="text-accent-default">
              cancelar
            </button>
          </div>
        )}

        {canal.anexo !== null && (
          <div className="mb-1 flex items-center gap-2 rounded-md border border-border-subtle bg-surface-elevated px-2 py-1 text-caption">
            {/* §13.7 — o blob já está escrito; a mensagem é que ainda não existe. */}
            <span className="min-w-0 flex-1 truncate text-text-secondary">
              {canal.anexo.descricao.name} · {tamanho(canal.anexo.descricao.sizeBytes)}
            </span>
            <button type="button" onClick={canal.descartarAnexo} className="text-accent-default">
              remover
            </button>
          </div>
        )}

        {somenteLeitura ? (
          <p className="text-meta text-text-tertiary">
            {encerrada
              ? "Comunidade encerrada: sem composer."
              : moderada
                ? "Você não participa mais desta comunidade: leitura histórica, sem escrita."
                : emTimeout
                  ? "Você está silenciada nesta comunidade até " +
                    new Date(self!.timeoutUntil!).toLocaleString("pt-BR") +
                    "."
                  : "Canal somente leitura para os seus cargos."}
          </p>
        ) : (
          <div className="relative flex gap-2">
            {mencao !== null && canal.communityId !== null && (
              <Mencoes
                communityId={canal.communityId}
                termo={mencao.termo}
                aoEscolher={(m) => {
                  const handle = m.handle.replace(/^@/, "");
                  setRascunho(
                    (r) => r.slice(0, mencao.inicio) + `@${handle} ` + r.slice(mencao.inicio + 1 + mencao.termo.length),
                  );
                  setMencionados((atual) => ({ ...atual, [m.key]: handle }));
                  setMencao(null);
                }}
              />
            )}
            <Button
              variant="secondary"
              loading={canal.anexando}
              onClick={() => void canal.anexarArquivo()}
              title="Anexar arquivo"
            >
              Anexar
            </Button>
            <textarea
              value={rascunho}
              onChange={(e) => {
                setRascunho(e.target.value);
                setMencao(trechoDeMencao(e.target.value, e.target.selectionStart ?? e.target.value.length));
              }}
              onBlur={() => setMencao(null)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && mencao !== null) {
                  e.preventDefault();
                  setMencao(null);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
              rows={1}
              placeholder={`Mensagem em #${ch?.name ?? ""}`}
              className="min-h-9 flex-1 resize-none rounded-md border border-border-default bg-surface-elevated px-3 py-2 text-body text-text-primary outline-none placeholder:text-text-tertiary"
            />
            <Button loading={enviando} disabled={rascunho.trim().length === 0 && canal.anexo === null} onClick={() => void enviar()}>
              Enviar
            </Button>
          </div>
        )}
        {erroEnvio !== null && <p className="pt-1 text-meta text-feedback-danger">{erroEnvio}</p>}
      </div>
    </section>
  );
}
