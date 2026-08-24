import { useState } from "react";
import { useVoiceStore } from "../../store/voiceStore";

export interface LeaveVoiceGuard {
  requestLeave: () => void;
  confirming: boolean;
  cancel: () => void;
  confirm: () => void;
}

/**
 * §11, C11 (exceções) — sair da chamada enquanto compartilha a tela pede
 * confirmação, porque encerra o compartilhamento junto; sem compartilhamento
 * ativo, sai direto, sem "tem certeza?" à toa (§15).
 *
 * Vive num hook porque os dois pontos de saída — barra persistente (2.3.1) e
 * grade expandida (2.3) — precisam da mesma regra.
 */
export function useLeaveVoiceGuard(): LeaveVoiceGuard {
  const sharing = useVoiceStore((state) =>
    Boolean(
      state.participants.find((p) => p.identityId === state.localId)
        ?.sharingScreen,
    ),
  );
  const leave = useVoiceStore((state) => state.leave);
  const [confirming, setConfirming] = useState(false);

  return {
    requestLeave: () => (sharing ? setConfirming(true) : leave()),
    confirming,
    cancel: () => setConfirming(false),
    confirm: () => {
      setConfirming(false);
      leave();
    },
  };
}
