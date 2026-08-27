import { useEffect, useMemo } from "react";
import { pontePresente } from "../../ipc/bridge";
import { useJoinedCommunities } from "../../store/communityStore";
import { useIdentityStore } from "../../store/identityStore";
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
 * rotina, e 3.5 é explícito em que o aviso não aparece nesse caso. A própria
 * identidade nunca entra na conta — o custo do fechamento é o que ele faz com
 * **os outros**.
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
  const euId = useIdentityStore((state) => state.identity?.id);
  const voiceCommunityId = useVoiceStore((state) => state.communityId);
  // **Sem mim.** Quem vai fechar a janela não é afetado por ela: contar-se junto
  // produzia "0 pessoas online, 1 numa chamada de voz" — a chamada onde a pessoa
  // estava sozinha, oferecida como motivo para não fechar o app.
  const outrosNaChamada = useVoiceStore(
    (state) =>
      state.participants.filter((p) => p.identityId !== state.localId).length,
  );

  return useMemo(() => {
    const impact: HostedImpact[] = [];
    for (const community of communities) {
      if (!community.isHostedByMe) continue;

      const online = membrosDaComunidade(community.id).filter(
        (member) => member.presence !== "offline" && member.identityId !== euId,
      ).length;
      const inCall =
        voiceCommunityId === community.id ? outrosNaChamada : 0;

      if (online > 0 || inCall > 0) impact.push({ community, online, inCall });
    }
    return impact;
  }, [communities, euId, voiceCommunityId, outrosNaChamada]);
}

/**
 * Registra o `beforeunload` enquanto houver gente conectada a uma comunidade
 * hospedada aqui. É o máximo que o NAVEGADOR permite; a interface de §10 (3.5)
 * é o `HostExitDialog`.
 *
 * **No Electron ele não entra, e a diferença não é de estilo — é o defeito de
 * "o app não fecha quando você é o host" (§92).** No navegador, `preventDefault`
 * num `beforeunload` faz o browser PERGUNTAR, e quem decide é a pessoa. No
 * Electron não há pergunta: o `preventDefault` **veta o fechamento em silêncio**,
 * para sempre. Medido em harness próprio — mesma janela, única diferença o
 * listener: com ele, três `close()` seguidos disparam o evento `close` e o
 * `closed` nunca chega, `window-all-closed` nunca chega, `app.quit()` nunca é
 * chamado; sem ele, a primeira chamada fecha.
 *
 * E o gatilho era exatamente "ser host com gente online" (`hostedImpact`), que é
 * a frase do relato. Os dois guardas estavam empilhados: o de web vetava a saída
 * que o de Electron — o main segurando o `close` e perguntando o impacto (U-06) —
 * tinha acabado de conceder. Nem "Fechar mesmo assim" escapava: `confirmExit`
 * mandava `mainWindow.close()` e o `beforeunload` engolia.
 *
 * Fora do Electron ele continua sendo a única defesa que existe, e continua ligado.
 */
export function useBeforeUnloadWarning(enabled: boolean): void {
  useEffect(() => {
    // Com shell, quem cuida da saída é o main (U-06). Empilhar os dois trava a janela.
    if (!enabled || pontePresente()) return;
    function handler(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [enabled]);
}
