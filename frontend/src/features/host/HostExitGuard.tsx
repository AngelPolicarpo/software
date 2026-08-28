import { useEffect, useRef } from "react";
import { AlertTriangle, CloudUpload, Users, Volume2 } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
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
  const totalOnline = impact.reduce((sum, item) => sum + item.online, 0);
  const totalEmChamada = impact.reduce((sum, item) => sum + item.inCall, 0);
  const totalPendente = impact.reduce((sum, item) => sum + item.pendingReplication, 0);

  /*
    O título conta gente, e só conta o que existe. "Fechar o app desconecta 0
    pessoas" era o que saía quando o único impacto era uma chamada — um número
    zero usado como argumento para não fechar o app.

    E o terceiro caso é o de §18.7: ninguém online, ninguém em chamada, e ops que
    não foram para lugar nenhum. Fechar aqui não desconecta — perde.
  */
  const titulo =
    totalOnline > 0
      ? `Fechar o app desconecta ${totalOnline} ${totalOnline === 1 ? "pessoa" : "pessoas"}`
      : totalEmChamada > 0
        ? `Fechar o app encerra ${totalEmChamada === 1 ? "a chamada de voz" : "as chamadas de voz"}`
        : `${totalPendente} ${totalPendente === 1 ? "operação ainda não foi" : "operações ainda não foram"} para outro dispositivo`;

  return (
    <Modal open onClose={onClose} title={titulo} size="lg">
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {impact.map(({ community, online, inCall, pendingReplication }) => (
            <li
              key={community.id}
              className="flex items-center gap-3 rounded-md border border-border-default bg-surface-sidebar p-3"
            >
              <Avatar
                name={community.name}
                color={community.iconColor}
                emoji={community.iconEmoji}
                shape="squircle"
                size="md"
              />
              <div className="min-w-0">
                <p className="truncate text-body-emphasis text-text-primary">
                  {community.name}
                </p>
                {/*
                  Só o que é maior que zero aparece. A linha dizia "0 pessoas
                  online, 1 numa chamada de voz" — duas contagens que se
                  contradiziam na mesma frase.
                */}
                <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-text-secondary">
                  {online > 0 && (
                    <span className="flex items-center gap-1.5">
                      <Users
                        size={14}
                        strokeWidth={2}
                        aria-hidden="true"
                        className="shrink-0 text-text-tertiary"
                      />
                      {online} {online === 1 ? "pessoa online" : "pessoas online"}
                    </span>
                  )}
                  {inCall > 0 && (
                    <span className="flex items-center gap-1.5 text-conn-degraded">
                      <Volume2
                        size={14}
                        strokeWidth={2}
                        aria-hidden="true"
                        className="shrink-0"
                      />
                      {inCall} {inCall === 1 ? "em chamada" : "em chamada"}
                    </span>
                  )}
                  {/*
                    §18.7 passo 1 — o número que o modal devia mostrar desde sempre e não
                    mostrava: quantas ops ainda não chegaram a outro dispositivo. Não é o
                    atraso da projeção local (essa conta lia zero num host em dia consigo
                    mesmo e sozinho no swarm, que é o caso em que fechar perde tudo): é o
                    que falta para a barreira de PARES de §18.7 passo 2.
                  */}
                  {pendingReplication > 0 && (
                    <span className="flex items-center gap-1.5 text-conn-degraded">
                      <CloudUpload
                        size={14}
                        strokeWidth={2}
                        aria-hidden="true"
                        className="shrink-0"
                      />
                      {pendingReplication} {pendingReplication === 1 ? "op sem replicar" : "ops sem replicar"}
                    </span>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {/* Nota de honestidade fixa, no espírito do princípio 3. O tom lavado a
            15% é a gramática de aviso de §6 — a caixa cinza de antes não se
            distinguia do card de impacto logo acima. */}
        <div className="flex items-start gap-3 rounded-md border border-conn-degraded/30 bg-conn-degraded/10 p-3">
          <AlertTriangle
            size={18}
            strokeWidth={2}
            className="mt-0.5 shrink-0 text-conn-degraded"
            aria-hidden="true"
          />
          <p className="text-meta text-text-secondary">
            Enquanto seu dispositivo estiver fechado, ninguém envia novas
            mensagens {impact.length === 1 ? "nesta comunidade" : "nestas comunidades"} — só
            leem o que já sincronizaram.
          </p>
        </div>

        {/*
          **"Avisar quem está online" saiu (U-06, §18.7).** O botão appendava uma mensagem
          assinada pelo host e desligava em seguida — quase certamente antes de ela
          replicar, então ninguém a receberia; e usava um tipo de "mensagem de sistema" que
          o modelo de domínio não tem. É o `F-43` que §18.7 diz ter fechado, e ele continuava
          aqui, no botão de largura inteira acima do par de decisão. O que fica no lugar é o
          que a delta pede: os números, incluindo o que ainda não replicou.
        */}
        <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
          <div className="flex flex-col gap-2 tablet:flex-row tablet:justify-end">
            {/* A ação segura é a padrão e leva o foco inicial (§10, 3.5); a
                destrutiva vai por último, como nos outros diálogos (§15). */}
            <Button autoFocus onClick={onClose}>
              Cancelar
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
      </div>
    </Modal>
  );
}
