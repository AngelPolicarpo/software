import { AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import {
  selectFirstTextChannelId,
  useCommunityStore,
} from "../../store/communityStore";
import { useMessageStore } from "../../store/messageStore";
import { useUiStore } from "../../store/uiStore";
import type { HostedImpact } from "./hostExit";

export interface HostExitDialogProps {
  impact: HostedImpact[];
  onClose: () => void;
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
export function HostExitDialog({ impact, onClose }: HostExitDialogProps) {
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
          <Button variant="danger" onClick={onClose}>
            Fechar mesmo assim
          </Button>
        </div>
      </div>
    </Modal>
  );
}
