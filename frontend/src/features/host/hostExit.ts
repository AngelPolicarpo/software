import { useEffect, useMemo } from "react";
import { useJoinedCommunities } from "../../store/communityStore";
import { useVoiceStore } from "../../store/voiceStore";
import type { Community } from "../../domain/types";
import { membrosDaComunidade } from "../../store/communityStore";

export interface HostedImpact {
  community: Community;
  online: number;
  inCall: number;
}

/**
 * Quem perde o quê se este dispositivo fechar agora (§10, 3.5).
 *
 * Só conta comunidade hospedada aqui: fechar o app sem hospedar nada é
 * rotina, e 3.5 é explícito em que o aviso não aparece nesse caso.
 *
 * **A armadilha do Zustand v5, de novo.** Montar a lista dentro do seletor
 * devolve array novo a cada chamada e o app entra em "Maximum update depth"
 * no instante em que o shell monta — `useShallow` não salva, porque cada
 * item também é objeto novo. A saída é a mesma da Parte 4: o seletor devolve
 * referências já estáveis (`useJoinedCommunities`) e a lista é derivada num
 * `useMemo`.
 */
export function useHostedImpact(): HostedImpact[] {
  const communities = useJoinedCommunities();
  const voiceCommunityId = useVoiceStore((state) => state.communityId);
  const voiceParticipants = useVoiceStore((state) => state.participants.length);

  return useMemo(() => {
    const impact: HostedImpact[] = [];
    for (const community of communities) {
      if (!community.isHostedByMe) continue;

      const online = membrosDaComunidade(community.id).filter(
        (member) => member.presence !== "offline",
      ).length;
      const inCall =
        voiceCommunityId === community.id ? voiceParticipants : 0;

      if (online > 0 || inCall > 0) impact.push({ community, online, inCall });
    }
    return impact;
  }, [communities, voiceCommunityId, voiceParticipants]);
}

/**
 * Registra o `beforeunload` enquanto houver gente conectada a uma comunidade
 * hospedada aqui. É o máximo que o navegador permite; a interface de §10
 * (3.5) é o `HostExitDialog`.
 */
export function useBeforeUnloadWarning(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    function handler(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [enabled]);
}
