import { MessagesSquare } from "lucide-react";

import { Badge } from "../../components/ui/Badge";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { selecionarPedidos, useDmStore } from "../../store/dmStore";
import { useUiStore } from "../../store/uiStore";

/**
 * A entrada da conversa direta no topo do rail (proposta de **B63(a)**).
 *
 * A gramática do rail é a de §8 1.1 e não muda: barra vertical de 4px quando ativo, ícone
 * que "quadra" no ativo/hover, badge numérico `feedback-danger` no canto. O que ele conta
 * é a soma de não lidas mais os pedidos — um pedido é exatamente a coisa que não pode
 * ficar invisível (§31.9 regra 4).
 */
export function DmRailButton() {
  const conversas = useDmStore((s) => s.conversas);
  const destino = useUiStore((s) => s.destino);
  const abrirDm = useUiStore((s) => s.abrirDm);

  const ativo = destino === "dm";
  const pedidos = selecionarPedidos(conversas).length;
  const naoLidas = conversas.reduce((total, c) => total + c.unread.count, 0);
  const total = pedidos + naoLidas;

  return (
    <div className="relative flex w-full justify-center">
      <Tooltip label="Conversas diretas">
        <button
          type="button"
          onClick={abrirDm}
          aria-current={ativo ? "true" : undefined}
          className={cn(
            "relative grid size-12 place-items-center",
            "transition-all duration-(--duration-base) ease-out",
            ativo
              ? "rounded-lg bg-accent-default text-text-on-accent"
              : "rounded-full bg-surface-sidebar text-text-secondary hover:rounded-lg hover:bg-accent-default hover:text-text-on-accent",
          )}
        >
          <MessagesSquare size={24} strokeWidth={2} aria-hidden="true" />
          <span className="sr-only">Conversas diretas</span>
          {total > 0 && (
            <Badge
              tone="danger"
              count={total}
              srLabel={`${total} pendentes`}
              className="absolute -right-1 -bottom-1"
            />
          )}
        </button>
      </Tooltip>

      {ativo && (
        <span
          className="absolute top-1/2 -left-2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-text-primary"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
