import { useEffect } from "react";
import { MessagesSquare } from "lucide-react";

import { cn } from "../../lib/cn";
import { DmConversationView } from "./DmConversationView";
import { DmList } from "./DmList";
import { fecharConversa, sincronizarConversas, sincronizarPrefsDm } from "../../live/dm";
import { useDmStore } from "../../store/dmStore";
import { useUiStore } from "../../store/uiStore";

/**
 * O destino da conversa direta — a proposta declarada de **B63(a)**, e nada além dela.
 *
 * B63(a) é decisão do operador e continua aberta: nem §31 nem `frontend.md` dizem se a
 * DM é entrada no rail, visão de topo separada ou parte do hub. A proposta escrita lá é
 * "entrada no topo do rail, que troca a sidebar pela lista de conversas e o painel
 * principal pela conversa — reusa o `AppShell` sem layout novo", e é o que está aqui.
 * Trocar de forma depois é trocar de lugar de montagem, não de componente: a lista e a
 * conversa não sabem onde estão.
 */
export function DmDestino({ className }: { className?: string }) {
  const conversas = useDmStore((s) => s.conversas);
  const ativaId = useDmStore((s) => s.ativa);
  const mobilePane = useUiStore((s) => s.mobilePane);
  const setMobilePane = useUiStore((s) => s.setMobilePane);

  useEffect(() => {
    void sincronizarConversas();
    void sincronizarPrefsDm();
  }, []);

  // Sair do destino solta a residência do projetor (§31.16.1 `dm.activate`): sem isto, a
  // conversa que ficou aberta continuaria consumindo lote com ninguém olhando.
  useEffect(() => () => void fecharConversa(), []);

  const ativa = conversas.find((c) => c.conversationId === ativaId);
  const conteudoEmFoco = mobilePane === "content";

  return (
    <div className={cn("flex min-h-0 flex-1", className)}>
      <DmList className={cn(conteudoEmFoco && "hidden tablet:flex")} />

      {ativa ? (
        <DmConversationView
          // Trocar de conversa remonta a área: o rascunho do composer é daquela conversa
          // e não pode vazar para a próxima — o mesmo argumento do `key` do `ChannelView`.
          key={ativa.conversationId}
          conversa={ativa}
          onBack={() => setMobilePane("channels")}
          className={cn(!conteudoEmFoco && "hidden tablet:flex")}
        />
      ) : (
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col items-center justify-center gap-2 bg-surface-primary p-8 text-center",
            !conteudoEmFoco && "hidden tablet:flex",
          )}
        >
          <MessagesSquare size={40} strokeWidth={1.5} className="text-text-tertiary" aria-hidden="true" />
          <p className="text-body text-text-secondary">Escolha uma conversa.</p>
          <p className="max-w-sm text-meta text-text-tertiary">
            Conversas diretas não passam por host nenhum: as mensagens vão da sua máquina
            para a da outra pessoa, e as duas precisam estar online ao mesmo tempo em algum
            momento.
          </p>
        </div>
      )}
    </div>
  );
}
