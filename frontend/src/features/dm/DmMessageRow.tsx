import { Avatar } from "../../components/ui/Avatar";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { formatClock } from "../../lib/format";
import { corDoPar, marcasDaMensagem, rotuloDeEntrega } from "./dmRegras";
import type { DmMessageDto } from "../../ipc/dto";

/**
 * Uma mensagem da conversa direta, na anatomia de §9 2.1.
 *
 * As três coisas que este componente **não** faz, e que são o conteúdo normativo de
 * U-33 (a lógica está em `dmRegras.ts`, que é onde o teste a alcança):
 *
 * - não afirma a causa de "não entregue" (**L-26**, **L-28**);
 * - não escreve "lido" em lugar nenhum (§31.11: o `ack` é chegada, não leitura);
 * - não esconde nem corrige a marca de ordem provisória (**L-27**).
 */
export interface DmMessageRowProps {
  mensagem: DmMessageDto;
  /** Continuação do mesmo autor dentro da janela de agrupamento (§9, 2.1). */
  agrupada: boolean;
  agora: number;
}

export function DmMessageRow({ mensagem, agrupada, agora }: DmMessageRowProps) {
  const entrega = rotuloDeEntrega(mensagem, agora);
  const marcas = marcasDaMensagem(mensagem);

  return (
    <article
      className={cn(
        "flex gap-2 px-4 hover:bg-surface-hover",
        agrupada ? "py-0.5" : "pt-3 pb-0.5",
      )}
    >
      <div className="w-8 shrink-0">
        {!agrupada && (
          <Avatar
            name={mensagem.author.displayName}
            color={corDoPar(mensagem.author.avatarColor)}
            size="md"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!agrupada && (
          <p className="flex items-baseline gap-1.5">
            <span className="text-body-emphasis text-text-primary">
              {mensagem.author.displayName}
            </span>
            <span className="text-caption text-text-tertiary">{mensagem.author.handle}</span>
            <span className="text-caption text-text-tertiary tabular-nums">
              {formatClock(new Date(mensagem.ts))}
            </span>
          </p>
        )}

        {mensagem.deleted || mensagem.content === null ? (
          // A26 — o tombstone apaga o conteúdo da projeção, não os bytes. "Apagada" é a
          // verdade da interface, e a spec é explícita em não prometer mais que isso.
          <p className="text-body text-text-tertiary italic">Mensagem apagada</p>
        ) : (
          <p className="text-body whitespace-pre-wrap text-text-primary">{mensagem.content}</p>
        )}

        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 empty:hidden">
          {mensagem.editedAt !== undefined && (
            <span className="text-caption text-text-tertiary">(editada)</span>
          )}

          {/* L-27 — marcado, nunca corrigido e nunca escondido. */}
          {marcas.map((marca) => (
            <Tooltip key={marca.id} label={marca.detalhe}>
              <span
                className={cn(
                  "rounded-sm px-1 py-px text-caption",
                  "bg-conn-degraded/15 text-text-secondary",
                )}
              >
                {marca.rotulo}
              </span>
            </Tooltip>
          ))}

          {entrega && (
            <Tooltip label={entrega.detalhe}>
              <span
                className={cn(
                  "text-caption",
                  entrega.texto === "Entregue"
                    ? "text-text-tertiary"
                    : "text-conn-offline",
                )}
              >
                {entrega.texto}
              </span>
            </Tooltip>
          )}
        </p>
      </div>
    </article>
  );
}
