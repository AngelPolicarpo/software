import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import {
  selectFirstTextChannelId,
  useCommunityStore,
} from "../../store/communityStore";
import { useMessageStore } from "../../store/messageStore";
import { useUiStore } from "../../store/uiStore";
import { confirmarSaida, ouvirPedidoDeSaida } from "../../ipc/bridge";
import { useHostedImpact, type HostedImpact } from "./hostExit";

/**
 * U-06 — quem atende o pedido de saída do main, e mora **na raiz**.
 *
 * O main segura o PRIMEIRO fechamento da janela e pergunta aqui qual é o impacto; sem
 * resposta ele solta por prazo, e o prazo é de 10 s. Enquanto isto vivia dentro do
 * `AppShell`, toda tela anterior ao shell — onboarding, identidade, restauração — ficava
 * sem ninguém do outro lado: fechar a janela ali dava dez segundos de janela morta antes
 * de o prazo agir. Medido no produto real, com o núcleo em `awaiting-identity`.
 *
 * A escuta é registrada UMA vez e lê o impacto por `ref`: o impacto muda a cada pessoa que
 * entra ou sai de uma chamada, e reinscrever a cada mudança dependia de o `off` da ponte
 * funcionar — que era justamente o outro defeito de §92.
 */
export function HostExitListener() {
  const impact = useHostedImpact();
  const openHostExit = useUiStore((state) => state.openHostExit);
  const atual = useRef(impact);
  atual.current = impact;

  useEffect(
    () =>
      ouvirPedidoDeSaida(() => {
        // `useHostedImpact` só devolve comunidade hospedada COM gente online ou em
        // chamada. Vazio = ninguém cai por este fechamento, e não há o que perguntar.
        if (atual.current.length === 0) {
          void confirmarSaida();
          return;
        }
        openHostExit();
      }),
    [openHostExit],
  );

  return null;
}

export interface HostExitDialogProps {
  impact: HostedImpact[];
  onClose: () => void;
  /**
   * Confirmar de verdade. Ausente no caminho do afinador de §19.1 (não há janela para
   * fechar); presente quando o main segurou o fechamento e espera resposta (U-06).
   */
  onConfirm?: () => void;
}

/**
 * 3.5 Aviso de saída do host.
 *
 * O estado mais próprio deste produto: aqui o "servidor" é a janela que
 * alguém está prestes a fechar. A ação segura é a padrão e recebe o foco.
 *
 * **Limitação declarada (§10, 3.5):** num app web o navegador não deixa
 * customizar o diálogo de saída. O `beforeunload` abaixo só consegue pedir a
 * confirmação genérica do próprio navegador; este modal é a decisão de
 * produto, alcançável pelo afinador de §19.1 e pronta para a versão
 * empacotada (premissa 1), que consegue cumpri-la de verdade.
 */
export function HostExitDialog({ impact, onClose, onConfirm }: HostExitDialogProps) {
  const closeOverlay = useUiStore((state) => state.closeOverlay);

  const totalOnline = impact.reduce((sum, item) => sum + item.online, 0);

  function warnEveryone() {
    const state = useCommunityStore.getState();
    for (const { community } of impact) {
      const channelId = selectFirstTextChannelId(state, community.id);
      if (!channelId) continue;
      // A fila é a outbox do núcleo (§11.2): se o app fechar antes de drenar,
      // a mensagem sobrevive no `manifest.db` e sai quando a máquina voltar.
      void useMessageStore.getState().send({
        communityId: community.id,
        channelId,
        content:
          "Vou ficar offline agora — a comunidade fica em modo leitura até eu voltar.",
        mentions: [],
      });
    }
    closeOverlay();
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Fechar o app desconecta ${totalOnline} ${totalOnline === 1 ? "pessoa" : "pessoas"}`}
      size="md"
    >
      <div className="flex flex-col gap-5">
        <ul className="flex flex-col gap-2">
          {impact.map(({ community, online, inCall }) => (
            <li
              key={community.id}
              className="rounded-md border border-border-default bg-surface-sidebar p-3"
            >
              <p className="text-body-emphasis text-text-primary">
                {community.name}
              </p>
              <p className="text-meta text-text-secondary">
                {online} {online === 1 ? "pessoa online" : "pessoas online"}
                {inCall > 0 &&
                  `, ${inCall} ${inCall === 1 ? "numa chamada de voz" : "numa chamada de voz"}`}
              </p>
            </li>
          ))}
        </ul>

        {/* Nota de honestidade fixa, no espírito do princípio 3. */}
        <div className="flex items-start gap-3 rounded-md border border-border-default p-3">
          <AlertTriangle
            size={20}
            strokeWidth={2}
            className="mt-px shrink-0 text-conn-degraded"
            aria-hidden="true"
          />
          <p className="text-meta text-text-secondary">
            Enquanto seu dispositivo estiver fechado, ninguém envia novas
            mensagens nesta comunidade — só leem o que já sincronizaram.
          </p>
        </div>

        <div className="flex flex-col gap-3 tablet:flex-row tablet:justify-end">
          {/* A ação segura é a padrão e leva o foco inicial. */}
          <Button autoFocus onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="secondary" onClick={warnEveryone}>
            Avisar quem está online
          </Button>
          {/*
            Antes, "Cancelar" e "Fechar mesmo assim" chamavam o MESMO `onClose`: os dois
            fechavam o modal e nenhum fechava o app. Agora a ação destrutiva responde ao
            main, que é quem segura a janela.
          */}
          <Button variant="danger" onClick={onConfirm ?? onClose}>
            Fechar mesmo assim
          </Button>
        </div>
      </div>
    </Modal>
  );
}
