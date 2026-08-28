import { useEffect, useMemo, useState } from "react";
import { api } from "../../ipc/api";
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
  /**
   * §18.7 passo 1 — quantas ops ainda não replicaram. **Contra a barreira de PARES**, não
   * contra a projeção local: é o número que separa "fechar agora custa uma reconexão" de
   * "fechar agora perde o que foi escrito". Vem de `host.exitImpact`, porque só o núcleo
   * enxerga o bitfield remoto de quem replica.
   */
  pendingReplication: number;
}

/**
 * §15.4 `host.exitImpact` — o impacto medido pelo NÚCLEO.
 *
 * As contagens de presença e de chamada as stores até derivam sozinhas, mas
 * `pendingReplication` não: ele depende do que os PARES anunciaram ter (§18.7 passo 2), que
 * é estado do transporte e não chega ao renderer por query nenhuma. Como o comando devolve
 * os três juntos, tomar dois de uma fonte e um de outra só criaria a chance de a linha
 * "3 pessoas online" e a linha "2 ops pendentes" descreverem instantes diferentes.
 */
export function useImpactoDoNucleo(): Map<string, { onlineCount: number; inCallCount: number; pendingReplication: number }> {
  const [porComunidade, setPorComunidade] = useState(
    () => new Map<string, { onlineCount: number; inCallCount: number; pendingReplication: number }>(),
  );
  useEffect(() => {
    let vivo = true;
    const ler = async (): Promise<void> => {
      try {
        const linhas = await api.hostExitImpact();
        if (!vivo) return;
        setPorComunidade(new Map(linhas.map((l) => [l.communityId, l])));
      } catch {
        // Núcleo reiniciando ou sem identidade: a leitura seguinte corrige. O modal
        // degrada para as contagens das stores, nunca para um número inventado.
      }
    };
    void ler();
    // O impacto muda a cada pessoa que entra ou sai, e a cada op que replica. Cadência
    // baixa de propósito: isto é um número de modal, não um medidor.
    const timer = setInterval(() => void ler(), 3_000);
    return () => {
      vivo = false;
      clearInterval(timer);
    };
  }, []);
  return porComunidade;
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
  const doNucleo = useImpactoDoNucleo();
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

      const nucleo = doNucleo.get(community.id);
      const online =
        nucleo?.onlineCount ??
        membrosDaComunidade(community.id).filter(
          (member) => member.presence !== "offline" && member.identityId !== euId,
        ).length;
      const inCall = nucleo?.inCallCount ?? (voiceCommunityId === community.id ? outrosNaChamada : 0);
      const pendingReplication = nucleo?.pendingReplication ?? 0;

      // Op pendente conta como impacto por si só: fechar com gente zero e fila cheia é
      // exatamente o caso em que §18.7 existe, e o modal antigo não abria.
      if (online > 0 || inCall > 0 || pendingReplication > 0) {
        impact.push({ community, online, inCall, pendingReplication });
      }
    }
    return impact;
  }, [communities, euId, voiceCommunityId, outrosNaChamada, doNucleo]);
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
