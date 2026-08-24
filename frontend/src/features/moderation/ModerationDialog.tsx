import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { TextArea } from "../../components/ui/TextArea";
import {
  TIMEOUT_OPTIONS,
  useModerationStore,
} from "../../store/moderationStore";
import { useToastStore } from "../../store/toastStore";

export type ModerationKind = "kick" | "ban" | "timeout";

const TITLE: Record<ModerationKind, string> = {
  kick: "Expulsar",
  ban: "Banir",
  timeout: "Aplicar timeout",
};

export interface ModerationDialogProps {
  kind: ModerationKind;
  communityId: string;
  targetId: string;
  targetLabel: string;
  byId: string;
  onClose: () => void;
  /** Chamado depois de aplicar — D12 usa para sumir com o alvo da tela. */
  onApplied?: () => void;
}

/**
 * Confirmação de ação de moderação (§11, D12 · §15).
 *
 * Nunca é ação de um clique só, e o texto nomeia a consequência exata em vez
 * de perguntar "tem certeza?". No ban, a nota de honestidade de §10 (3.3)
 * aparece aqui também: banir não impede tecnicamente que a pessoa volte com
 * identidade nova, e a interface diz isso antes de o clique acontecer.
 */
export function ModerationDialog({
  kind,
  communityId,
  targetId,
  targetLabel,
  byId,
  onClose,
  onApplied,
}: ModerationDialogProps) {
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState(TIMEOUT_OPTIONS[0].value);
  const ban = useModerationStore((state) => state.ban);
  const kick = useModerationStore((state) => state.kick);
  const applyTimeout = useModerationStore((state) => state.applyTimeout);
  const showToast = useToastStore((state) => state.showToast);

  function apply() {
    const payload = {
      communityId,
      identityId: targetId,
      label: targetLabel,
      byId,
      reason: reason.trim() || undefined,
    };

    if (kind === "ban") {
      ban(payload);
      // §12: ação de consequência maior não usa toast de sucesso comum — o
      // resultado visível já confirma. Aqui o toast existe porque o alvo
      // pode não estar visível na tela de onde a ação partiu.
      showToast(`${targetLabel} foi banido`);
    } else if (kind === "kick") {
      kick(payload);
      showToast(`${targetLabel} foi expulso`);
    } else {
      applyTimeout({
        ...payload,
        until: Date.now() + Number(duration) * 60_000,
      });
      showToast(`Timeout aplicado em ${targetLabel}`);
    }

    onApplied?.();
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${TITLE[kind]} ${targetLabel}?`}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-body text-text-secondary">
          {kind === "ban" &&
            `${targetLabel} não consegue mais entrar nesta comunidade com esta identidade, e as mensagens dele saem do canal.`}
          {kind === "kick" &&
            `${targetLabel} sai da comunidade agora, mas pode voltar com um convite válido.`}
          {kind === "timeout" &&
            `${targetLabel} fica sem enviar mensagens nem falar em voz durante o período escolhido.`}
        </p>

        {kind === "timeout" && (
          <Select
            label="Duração"
            value={duration}
            options={TIMEOUT_OPTIONS}
            onChange={setDuration}
          />
        )}

        <TextArea
          label="Motivo (opcional)"
          value={reason}
          onChange={setReason}
          maxLength={200}
          showCounter
          rows={2}
          hint="Vai para o log de auditoria como texto livre."
        />

        {kind === "ban" && (
          <p className="rounded-md border border-border-default bg-surface-primary p-3 text-meta text-text-secondary">
            Banir impede a entrada com esta identidade específica. Como não há
            autoridade central, a pessoa pode tecnicamente voltar com uma
            identidade nova através de outro convite.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={apply}>
            {TITLE[kind]}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
