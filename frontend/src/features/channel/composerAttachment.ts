import { useState } from "react";
import { api } from "../../ipc/api";
import { codigoDoErro } from "../../ipc/frames";
import { useToastStore } from "../../store/toastStore";

/**
 * Anexo em staging para a PRÓXIMA mensagem (§13.2): o `ticketId` vai ao fio no
 * `message.send` (§13.7 — só ele); o resto descreve a bolha e o chip abaixo.
 */
export interface StagedAttachment {
  ticketId: string;
  nome: string;
  tamanho: number;
  kind: number;
  hash: string;
}

/** §13.2 — o diálogo é nativo (main), o stage é do núcleo; o caminho nunca volta. */
export function useAttachmentStaging(communityId: string) {
  const showToast = useToastStore((state) => state.showToast);
  const [anexo, setAnexo] = useState<StagedAttachment | null>(null);
  const [anexando, setAnexando] = useState(false);

  async function anexar() {
    if (anexando || anexo !== null) return;
    setAnexando(true);
    try {
      const pick = await api.filePickForAttachment(communityId);
      if (pick.ticketId === undefined) return;
      const staged = await api.blobStage(pick.ticketId);
      setAnexo({
        ticketId: pick.ticketId,
        nome: staged.name,
        tamanho: staged.sizeBytes,
        kind: staged.kind,
        hash: staged.hash,
      });
    } catch (e) {
      if (codigoDoErro(e) !== "E_CANCELLED") {
        showToast(`Não foi possível anexar (${codigoDoErro(e)})`, "error");
      }
    } finally {
      setAnexando(false);
    }
  }

  return {
    anexo,
    anexando,
    anexar,
    limpar: () => setAnexo(null),
  };
}
