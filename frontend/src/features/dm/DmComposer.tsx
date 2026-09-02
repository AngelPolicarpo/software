import { useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";

import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { avisarDigitacao, enviarMensagem } from "../../live/dm";

/**
 * O composer da conversa direta — e a consequência de tela da **ausência de outbox**.
 *
 * `dm.send` é síncrono, com o registro já no log (§31.10). Os cinco estados de outbox
 * (`queued`, `sending`, `awaiting-confirmation`, `failed`, `dropped`) não são declarados
 * em §31.11 porque não podem ocorrer — e por isso este componente **não** os inventa:
 * não há linha "enviando", não há linha "falhou" na conversa e não há "tentar de novo".
 * Ou a promessa resolve e a mensagem é final, ou ela rejeita e nada foi escrito; o
 * segundo caso é um toast, e o texto continua no campo para a pessoa decidir.
 *
 * `desabilitado` é a única exceção de U-33 à regra de esconder-nunca-desabilitar (§15):
 * em `desynced`/`forked` o campo fica visível e morto, porque o estado é temporário e
 * espera o par (§31.13) — sumir com ele faria a conversa parecer somente-leitura.
 */
export interface DmComposerProps {
  conversationId: string;
  nomeDoPar: string;
  desabilitado: boolean;
  motivo?: string;
}

export function DmComposer({
  conversationId,
  nomeDoPar,
  desabilitado,
  motivo,
}: DmComposerProps) {
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const digitando = useRef(false);

  async function enviar() {
    const conteudo = texto.trim();
    if (conteudo.length === 0 || desabilitado || ocupado) return;
    setOcupado(true);
    const ok = await enviarMensagem(conversationId, conteudo);
    setOcupado(false);
    // O campo só esvazia quando a escrita aconteceu. Não há retentativa a oferecer, e
    // limpar antes perderia o texto de quem não tem para onde reenviá-lo.
    if (ok) {
      setTexto("");
      if (digitando.current) {
        digitando.current = false;
        void avisarDigitacao(conversationId, false);
      }
    }
  }

  function aoDigitar(valor: string) {
    setTexto(valor);
    const agoraDigitando = valor.length > 0;
    if (agoraDigitando === digitando.current) return;
    digitando.current = agoraDigitando;
    void avisarDigitacao(conversationId, agoraDigitando);
  }

  return (
    <div className="shrink-0 px-4 pb-4">
      {desabilitado && motivo && (
        <p className="mb-1.5 text-caption text-text-tertiary">{motivo}</p>
      )}
      <div
        className={cn(
          "flex items-end gap-2 rounded-lg border border-border-default bg-surface-elevated p-2",
          desabilitado && "opacity-60",
        )}
      >
        <textarea
          value={texto}
          onChange={(e) => aoDigitar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar();
            }
          }}
          disabled={desabilitado}
          rows={1}
          placeholder={`Mensagem para ${nomeDoPar}`}
          aria-label={`Mensagem para ${nomeDoPar}`}
          className={cn(
            "max-h-40 min-h-9 flex-1 resize-none bg-transparent text-body text-text-primary",
            "placeholder:text-text-tertiary focus:outline-none disabled:cursor-not-allowed",
          )}
        />
        <Button
          variant="icon"
          size="sm"
          onClick={() => void enviar()}
          disabled={desabilitado || texto.trim().length === 0 || ocupado}
          aria-label="Enviar"
        >
          <SendHorizontal size={16} strokeWidth={2} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
