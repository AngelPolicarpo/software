import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { decodeMessageRef } from "../lib/messageLink";
import { usePendingMessageStore } from "../store/inviteStore";

/**
 * Rota `/m/:code` (§4 · premissa 10).
 *
 * Mesma mecânica de `/invite/:code`: consome a URL, guarda a referência e
 * devolve para `/`, que resolve por estado. A distinção que justifica a rota
 * existir — canal selecionado é estado de navegação, link de mensagem é
 * referência a um artefato que viaja para fora da sessão — está em §4.
 */
export function MessageRoute() {
  const { code } = useParams<{ code: string }>();
  const setPendingMessage = usePendingMessageStore(
    (state) => state.setPendingMessage,
  );
  const [consumed, setConsumed] = useState(false);

  useEffect(() => {
    // `null` marca link inválido: o shell mostra o mesmo desfecho de um link
    // de comunidade da qual não se faz parte, sem vazar o motivo técnico.
    setPendingMessage(code ? decodeMessageRef(code) : null);
    setConsumed(true);
  }, [code, setPendingMessage]);

  if (!consumed) return null;

  return <Navigate to="/" replace />;
}
