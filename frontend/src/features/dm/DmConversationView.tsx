import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Mic, MicOff, MoreVertical, Phone, PhoneOff } from "lucide-react";

import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { Spinner } from "../../components/ui/Spinner";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { cn } from "../../lib/cn";
import { MESSAGE_GROUP_WINDOW_MS } from "../../lib/format";
import { DmBloquearModal, DmEsquecerModal } from "./DmDialogs";
import { DmComposer } from "./DmComposer";
import { DmMessageRow } from "./DmMessageRow";
import { DmPeerLabel } from "./DmPeerLabel";
import {
  acoesDaConversa,
  acoesDeChamada,
  composerDaConversa,
  faixaDeChamada,
  faixaDeSincronizacao,
} from "./dmRegras";
import {
  bloquearConversa,
  carregarMensagens,
  desbloquearConversa,
  esquecerConversa,
} from "../../live/dm";
import { chamar, definirMudo, desligar } from "../../live/dmVoz";
import { useDmCallStore } from "../../store/dmCallStore";
import { useDmStore } from "../../store/dmStore";
import type { DmConversationItem } from "../../ipc/dto";

/**
 * A conversa aberta — cabeçalho, faixa de estado, mensagens e composer.
 *
 * A faixa de sincronização é **faixa, não modal**: a conversa continua legível nos sete
 * estados de §31.13, e um modal esconderia justamente o histórico que a pessoa abriu para
 * ler. O texto de cada estado está em `dmRegras.ts` — inclusive a igualdade entre
 * `unauthorized` e `peer-offline`, que é requisito de **L-28** e não descuido.
 */
export interface DmConversationViewProps {
  conversa: DmConversationItem;
  onBack: () => void;
  className?: string;
}

export function DmConversationView({ conversa, onBack, className }: DmConversationViewProps) {
  const detalhe = useDmStore((s) => s.detalhe);
  const carregada = useDmStore((s) => s.porConversa[conversa.conversationId]);
  const digitando = useDmStore((s) => s.digitando[conversa.conversationId] ?? false);

  // §31.15 — a chamada de dois. Uma conversa por vez ("voz é uma só", §15.4), então o
  // estado só vale para ESTA conversa quando é ela que está na chamada.
  const chamadaId = useDmCallStore((s) => s.conversationId);
  const chamadaEstado = useDmCallStore((s) => s.estado);
  const chamadaFalha = useDmCallStore((s) => s.falha);
  const chamadaMuda = useDmCallStore((s) => s.mudo);
  const daConversa = chamadaId === conversa.conversationId;

  const [menuAberto, setMenuAberto] = useState(false);
  const [bloquear, setBloquear] = useState(false);
  const [esquecer, setEsquecer] = useState(false);

  const fim = useRef<HTMLDivElement>(null);
  const mensagens = carregada?.mensagens ?? [];

  // A conversa nasce no fim, como qualquer canal de texto (§9, 2.1).
  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [mensagens.length]);

  const sync = detalhe?.sync ?? conversa.sync;
  const faixa = faixaDeSincronizacao(sync);
  const composer = composerDaConversa(conversa.state, sync);
  const acoes = acoesDaConversa(conversa.state);
  const acoesChamada = acoesDeChamada(conversa.state, daConversa ? chamadaEstado : "fora");
  const bannerChamada = faixaDeChamada(
    daConversa ? chamadaEstado : "fora",
    daConversa ? chamadaFalha : null,
  );
  const agora = Date.now();

  return (
    <div className={cn("flex min-w-0 flex-1 flex-col bg-surface-primary", className)}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        {/* §16, Mobile: a conversa é a tela em foco, e voltar é a saída. */}
        <Button
          variant="icon"
          size="sm"
          onClick={onBack}
          aria-label="Voltar para a lista de conversas"
          className="tablet:hidden"
        >
          <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
        </Button>

        <DmPeerLabel peer={conversa.peer} className="min-w-0 flex-1" />

        {/*
          §31.15 — chamar, atender e desligar. §15: item aparece só quando a ação existe
          naquele estado. Não há botão de câmera nem de tela nesta fatia, e não há **nada**
          que ofereça relay: §17.7 pressupõe um terceiro, e numa dupla não existe (**L-29**).
        */}
        {acoesChamada.includes("chamar") && (
          <Button
            variant="icon"
            size="sm"
            onClick={() => void chamar(conversa.conversationId)}
            aria-label="Chamar"
            className="shrink-0"
          >
            <Phone size={16} strokeWidth={2} aria-hidden="true" />
          </Button>
        )}
        {acoesChamada.includes("atender") && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => void chamar(conversa.conversationId)}
            className="shrink-0"
          >
            Atender
          </Button>
        )}
        {/*
          §9 (2.3.1) / **L-12** — o mudo do próprio microfone, e só ele. Não há ensurdecer
          (numa dupla é desligar), não há silenciar o outro (isso é moderação, e §31.15
          remove a moderação inteira) e não há volume por participante.
        */}
        {daConversa && chamadaEstado === "na-chamada" && (
          <Button
            variant="icon"
            size="sm"
            onClick={() => definirMudo(!chamadaMuda)}
            aria-label={chamadaMuda ? "Ligar o microfone" : "Desligar o microfone"}
            aria-pressed={chamadaMuda}
            className="shrink-0"
          >
            {chamadaMuda ? (
              <MicOff size={16} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Mic size={16} strokeWidth={2} aria-hidden="true" />
            )}
          </Button>
        )}
        {acoesChamada.includes("desligar") && (
          <Button
            variant="icon"
            size="sm"
            onClick={() => void desligar()}
            aria-label="Desligar"
            className="shrink-0"
          >
            <PhoneOff size={16} strokeWidth={2} aria-hidden="true" />
          </Button>
        )}

        <div className="relative shrink-0">
          <Button
            variant="icon"
            size="sm"
            onClick={() => setMenuAberto((a) => !a)}
            aria-haspopup="menu"
            aria-expanded={menuAberto}
            aria-label="Ações da conversa"
          >
            <MoreVertical size={16} strokeWidth={2} aria-hidden="true" />
          </Button>
          {/*
            §15 — item aparece só quando a ação existe naquele estado; nada de
            desabilitado-mas-visível. `acoesDaConversa` é quem decide, e é o que o teste
            afirma.
          */}
          <Menu
            open={menuAberto}
            onClose={() => setMenuAberto(false)}
            items={[
              ...(acoes.includes("desbloquear")
                ? [
                    {
                      id: "desbloquear",
                      label: "Desbloquear",
                      onSelect: () => void desbloquearConversa(conversa.conversationId),
                    },
                  ]
                : []),
              ...(acoes.includes("bloquear")
                ? [{ id: "bloquear", label: "Bloquear", onSelect: () => setBloquear(true) }]
                : []),
              ...(acoes.includes("esquecer")
                ? [
                    {
                      id: "esquecer",
                      label: "Esquecer conversa",
                      danger: true,
                      onSelect: () => setEsquecer(true),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </header>

      {faixa && <StatusBanner tone={faixa.tone}>{faixa.texto}</StatusBanner>}

      {/*
        §31.15 / **L-29** — o desfecho da chamada. O texto vem de `faixaDeChamada`, e o que
        ele **não** traz é a oferta de relay: o teste afirma a ausência, porque oferecer o
        caminho que §17.7 dá na comunidade seria prometer um terceiro que não existe.
      */}
      {bannerChamada && (
        <StatusBanner tone={bannerChamada.tone}>{bannerChamada.texto}</StatusBanner>
      )}

      {/*
        §31.4 — `kind` ou versão desconhecidos nesta conversa. As listas de §31.16.2 saem
        vazias enquanto a fonte não existir (§105.7), então a faixa diz o FATO e não
        enumera: um "kind desconhecido: —" seria pior do que a frase honesta.
      */}
      {detalhe?.partialInterpretation && (
        <StatusBanner tone="degraded">
          Parte desta conversa foi escrita por uma versão mais nova do aplicativo e não pode
          ser interpretada aqui. Escrever nela está suspenso.
        </StatusBanner>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {carregada?.temMais && (
          <div className="flex justify-center py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void carregarMensagens(conversa.conversationId, carregada.cursorAnterior)
              }
            >
              Carregar mensagens anteriores
            </Button>
          </div>
        )}

        {/*
          §31.13 — a faixa foi descartada por `dm.reordered` e a reconsulta está em voo.
          Mostrar o carregando é o que impede a tela de exibir a história antiga com as
          mensagens novas penduradas no fim.
        */}
        {carregada?.recarregando && (
          <div className="flex items-center justify-center gap-2 py-3 text-meta text-text-tertiary">
            <Spinner />
            A ordem da conversa mudou. Recarregando…
          </div>
        )}

        {mensagens.map((m, i) => {
          const anterior = mensagens[i - 1];
          const agrupada =
            anterior !== undefined &&
            anterior.author.key === m.author.key &&
            m.ts - anterior.ts < MESSAGE_GROUP_WINDOW_MS;
          return (
            <DmMessageRow key={m.id} mensagem={m} agrupada={agrupada} agora={agora} />
          );
        })}

        <div ref={fim} />
      </div>

      {digitando && (
        <p className="px-4 pb-1 text-caption text-text-tertiary" role="status">
          {conversa.peer.displayName} está digitando…
        </p>
      )}

      {/*
        §31.9 regra 1 — em `pending-out` o outro lado ainda não aceitou, logo não existe
        core dele, logo não existe `ack`: nada aqui aparece como entregue, e a faixa diz
        isso em vez de deixar todas as mensagens com "não entregue" sem explicação.
      */}
      {conversa.state === "pending-out" && (
        <p className="px-4 pb-2 text-caption text-text-tertiary">
          {conversa.peer.displayName} ainda não aceitou esta conversa. Até lá, nada aparece
          como entregue.
        </p>
      )}

      {composer.visivel ? (
        <DmComposer
          conversationId={conversa.conversationId}
          nomeDoPar={conversa.peer.displayName}
          desabilitado={!composer.habilitado}
          {...(composer.motivo !== undefined ? { motivo: composer.motivo } : {})}
        />
      ) : (
        <p className="px-4 pb-4 text-meta text-text-tertiary">
          {conversa.state === "blocked"
            ? "Você bloqueou esta conversa. Ela continua legível."
            : "Esta conversa é somente leitura."}
        </p>
      )}

      <DmBloquearModal
        open={bloquear}
        nomeDoPar={conversa.peer.displayName}
        onClose={() => setBloquear(false)}
        onConfirm={() => void bloquearConversa(conversa.conversationId)}
      />
      <DmEsquecerModal
        open={esquecer}
        nomeDoPar={conversa.peer.displayName}
        onClose={() => setEsquecer(false)}
        onConfirm={() => void esquecerConversa(conversa.conversationId)}
      />
    </div>
  );
}
