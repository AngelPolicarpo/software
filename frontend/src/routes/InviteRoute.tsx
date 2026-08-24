import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { usePendingInviteStore } from "../store/inviteStore";

/**
 * Rota `/invite/:code` (§4 · fluxo A2 passos 1-2).
 *
 * Alvo de um link compartilhado fora do app, inclusive por quem nunca o
 * abriu. Consome a URL, guarda o código como convite pendente e devolve
 * para `/` — que mostra o onboarding se ainda não houver identidade e, com
 * ela pronta, retoma o preview do convite (0.3) sem pedir o código de novo.
 */
export function InviteRoute() {
  const { code } = useParams<{ code: string }>();
  const setPendingInvite = usePendingInviteStore(
    (state) => state.setPendingInvite,
  );
  const [consumed, setConsumed] = useState(false);

  useEffect(() => {
    if (code) setPendingInvite(code);
    setConsumed(true);
  }, [code, setPendingInvite]);

  // Um frame sem nada renderizado: evita flash de outra tela antes do
  // onboarding (§7, 0.1) enquanto o código é guardado.
  if (!consumed) return null;

  return <Navigate to="/" replace />;
}
