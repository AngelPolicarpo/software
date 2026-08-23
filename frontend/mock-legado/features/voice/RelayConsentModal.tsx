import { useEffect, useState } from "react";
import { Button } from "../../../src/components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { Modal } from "../../components/ui/Modal";
import { useVoiceStore } from "../../store/voiceStore";

/**
 * A aba pode estar em segundo plano na hora em que a árvore precisa de mais
 * um nó. §11 (B6, exceções) é explícita: espera Ana voltar a focar a aba,
 * **nunca** assume recusa por inatividade ou timeout.
 */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );

  useEffect(() => {
    function handle() {
      setVisible(!document.hidden);
    }
    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, []);

  return visible;
}

/**
 * Modal de consentimento de repasse (§9, 2.4.1 · fluxo B6).
 *
 * Cobre diretamente o problema em aberto "consentimento de usar upload de
 * espectador para repassar a outros" (`CLAUDE.md:48`): o mock representa a
 * pergunta ao usuário, não a resolve tecnicamente. Recusar não tem custo
 * nenhum — o texto não usa tom de culpa e Ana segue como folha da árvore.
 */
export function RelayConsentModal() {
  const request = useVoiceStore((state) => state.consentRequest);
  const respondConsent = useVoiceStore((state) => state.respondConsent);
  const [remember, setRemember] = useState(false);
  const visible = useDocumentVisible();

  if (!request || !visible) return null;

  return (
    <Modal
      open
      // Não há fechar silencioso: a árvore precisa de uma resposta, e "sem
      // resposta" nunca vira recusa (§11, B6).
      onClose={() => respondConsent(false, remember)}
      title="Ajudar a retransmitir?"
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-body text-text-secondary">
          Sua conexão pode retransmitir esta transmissão para outras{" "}
          {request.relayCount} pessoas, usando um pouco do seu upload. Isso não
          afeta sua visualização.
        </p>

        <Checkbox
          checked={remember}
          onChange={setRemember}
          label="Lembrar minha escolha para esta comunidade"
        />

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => respondConsent(false, remember)}
          >
            Recusar
          </Button>
          <Button onClick={() => respondConsent(true, remember)}>Aceitar</Button>
        </div>
      </div>
    </Modal>
  );
}
