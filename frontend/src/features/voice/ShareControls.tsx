import { useState } from "react";
import { Eye, EyeOff, Maximize2, Minimize2, Settings2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Popover } from "../../components/ui/Popover";
import { useVoiceStore, type ActiveShare } from "../../store/voiceStore";
import { TransmissionSettings } from "./TransmissionSettings";

export interface ShareControlsProps {
  share: ActiveShare;
  isPresenter: boolean;
  aoVivo: boolean;
  oculto: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Ajustes abertos: enquanto isso os controles não somem. */
  onAjustesChange: (aberto: boolean) => void;
  camada: string;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

/**
 * A fileira de ações sobre a imagem (§17.5).
 *
 * **Os controles da transmissão são de quem transmite.** Resolução, taxa de
 * quadros e perfil de qualidade decidem o que sai da máquina do apresentador e
 * quanto do upload dele é consumido; quem assiste não tem como pagar essa conta
 * nem como ver o que está sendo capturado. O controle de quem ASSISTE é um só:
 * parar de exibir — local, reversível e sem efeito sobre transmissão nenhuma.
 */
export function ShareControls({
  share,
  isPresenter,
  aoVivo,
  oculto,
  fullscreen,
  onToggleFullscreen,
  onAjustesChange,
  camada,
  onPointerEnter,
  onPointerLeave,
}: ShareControlsProps) {
  const stopShare = useVoiceStore((state) => state.stopShare);
  const alternarVideoRecebido = useVoiceStore(
    (state) => state.alternarVideoRecebido,
  );
  const [ajustes, setAjustes] = useState<DOMRect | null>(null);

  function abrirAjustes(rect: DOMRect | null) {
    setAjustes(rect);
    onAjustesChange(rect !== null);
  }

  return (
    <>
      <div
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        className={cn("absolute right-2 bottom-2 flex items-center gap-1.5", camada)}
      >
        {isPresenter && aoVivo && (
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => abrirAjustes(e.currentTarget.getBoundingClientRect())}
            aria-haspopup="dialog"
            aria-expanded={ajustes !== null}
            leadingIcon={<Settings2 size={16} strokeWidth={2} aria-hidden="true" />}
          >
            Transmissão
          </Button>
        )}

        {!isPresenter && aoVivo && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => alternarVideoRecebido(share.sessionId)}
            aria-pressed={oculto}
            leadingIcon={
              oculto ? (
                <Eye size={16} strokeWidth={2} aria-hidden="true" />
              ) : (
                <EyeOff size={16} strokeWidth={2} aria-hidden="true" />
              )
            }
          >
            {oculto ? "Mostrar vídeo" : "Ocultar vídeo"}
          </Button>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={onToggleFullscreen}
          leadingIcon={
            fullscreen ? (
              <Minimize2 size={16} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Maximize2 size={16} strokeWidth={2} aria-hidden="true" />
            )
          }
        >
          {fullscreen ? "Reduzir" : "Tela cheia"}
        </Button>

        {isPresenter && (
          <Button variant="danger" size="sm" onClick={stopShare}>
            Parar compartilhamento
          </Button>
        )}
      </div>

      {ajustes !== null && (
        <Popover
          anchor={ajustes}
          onClose={() => abrirAjustes(null)}
          label="Ajustes da transmissão"
          placement="below"
          width={288}
        >
          <TransmissionSettings onClose={() => abrirAjustes(null)} />
        </Popover>
      )}
    </>
  );
}
