import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { TEXTO_BLOQUEAR_CONVERSA, TEXTO_ESQUECER_CONVERSA } from "./dmRegras";

/**
 * As duas confirmações que §31.24 torna **obrigatórias**, e cujos textos são normativos
 * (`dmRegras.ts`): esquecer (**L-25**) e bloquear (**L-28**).
 *
 * Nenhuma das duas é "Tem certeza?" — a regra de §15 é nomear a consequência exata, e
 * nos dois casos a consequência é justamente o que não se adivinha: a conversa **não**
 * some por inteiro do disco, e o outro lado **não** é avisado.
 */

export interface DmConfirmProps {
  open: boolean;
  nomeDoPar: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function DmEsquecerModal({ open, nomeDoPar, onClose, onConfirm }: DmConfirmProps) {
  return (
    <Modal open={open} onClose={onClose} title={`Esquecer a conversa com ${nomeDoPar}?`} size="sm">
      <p className="text-body text-text-secondary">{TEXTO_ESQUECER_CONVERSA}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          Esquecer conversa
        </Button>
      </div>
    </Modal>
  );
}

export function DmBloquearModal({ open, nomeDoPar, onClose, onConfirm }: DmConfirmProps) {
  return (
    <Modal open={open} onClose={onClose} title={`Bloquear ${nomeDoPar}?`} size="sm">
      <p className="text-body text-text-secondary">{TEXTO_BLOQUEAR_CONVERSA}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          Bloquear
        </Button>
      </div>
    </Modal>
  );
}
