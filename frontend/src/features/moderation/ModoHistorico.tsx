import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { api } from "../../ipc/api";
import { motivoDaRecusa } from "../../live/recusas";
import { useToastStore } from "../../store/toastStore";
import type { SelfModeration } from "../../ipc/dto";
import type { Community } from "../../domain/types";
import { diasAte, tituloDoModoHistorico } from "./modoHistorico";

/**
 * U-16 / §18.4 passo 5 — a comunidade em **modo histórico somente leitura**.
 *
 * O que esta tela existe para evitar está na própria delta: sem ela, "o app do alvo
 * simplesmente pararia de funcionar naquela comunidade". Antes desta fatia, o banido ficava
 * em `reconnecting` honesto, tentando para sempre um host que passou a recusá-lo, sem nada
 * dizer o que tinha acontecido — e a réplica não saía nunca, porque nada marcava o prazo.
 *
 * O cabeçalho diz as quatro coisas que a delta pede: **o que** aconteceu, **por quem**,
 * **com que motivo** (quando houver) e **por quanto tempo** a cópia local fica, com a opção
 * de apagá-la agora.
 *
 * `by`/`reason` vêm de `query.selfModeration` — a auditoria, não o rail. Uma remoção por
 * `unauthorized` (§14.5: todos os pares recusaram) não tem entrada de auditoria nenhuma, e
 * aí a frase é a que se pode afirmar: acesso encerrado, sem autor conhecido. Inventar um
 * autor seria pior do que omiti-lo.
 */
export interface ModoHistoricoProps {
  community: Community;
}

export function ModoHistorico({ community }: ModoHistoricoProps) {
  const [auditoria, setAuditoria] = useState<SelfModeration | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const showToast = useToastStore((s) => s.showToast);
  const reason = community.removedReason;

  useEffect(() => {
    // `left` e `unauthorized` não têm o que buscar: nenhum dos dois é entrada de auditoria.
    if (reason !== "banned" && reason !== "kicked") return;
    let vivo = true;
    void api
      .selfModeration(community.id)
      .then((r) => {
        if (vivo) setAuditoria(r);
      })
      .catch(() => {
        // Sem auditoria a frase perde o autor e o motivo, e continua verdadeira.
      });
    return () => {
      vivo = false;
    };
  }, [community.id, reason]);

  if (reason === undefined) return null;

  const dias = diasAte(community.retainUntil, Date.now());
  const porQuem = auditoria?.byLabel;
  const motivo = auditoria?.reason;

  async function apagarAgora(): Promise<void> {
    setApagando(true);
    try {
      // `community.forget` é main-confirmed (§15.3): o diálogo nativo é a segunda barreira,
      // e o `Modal` aqui é a primeira — apagar a cópia não tem desfazer.
      await api.communityForget(community.id);
      showToast(`Cópia local de ${community.name} apagada.`);
    } catch (e) {
      const code = (e as { code?: string }).code ?? "E_INTERNAL";
      showToast(motivoDaRecusa(code), "error");
    } finally {
      setApagando(false);
      setConfirmando(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-border-default bg-conn-failed/10 px-4 py-3">
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={18}
            strokeWidth={2}
            className="mt-0.5 shrink-0 text-conn-failed"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-body-emphasis text-text-primary">
              {tituloDoModoHistorico(reason, community.name)}
            </p>
            <p className="mt-0.5 text-meta text-text-secondary">
              {porQuem !== undefined && <>Por {porQuem}. </>}
              {motivo !== undefined && <>Motivo: {motivo}. </>}
              {/* L-7, repetida onde ela importa: o que já está aqui continua aqui, e é só
                  isso que resta — leitura, sem escrita e sem novidade. */}
              O que já sincronizou continua legível neste dispositivo. Nada novo chega, e
              nada seu sai daqui.
            </p>
            {dias !== null && (
              <p className="mt-1 text-meta text-text-tertiary">
                {dias === 0
                  ? "A cópia local será apagada hoje."
                  : `A cópia local será apagada em ${dias} ${dias === 1 ? "dia" : "dias"}.`}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="danger"
          size="sm"
          className="self-start"
          onClick={() => setConfirmando(true)}
        >
          Apagar a cópia agora
        </Button>
      </div>

      {confirmando && (
        <Modal
          open
          onClose={() => setConfirmando(false)}
          title={`Apagar a cópia de ${community.name}?`}
        >
          <div className="flex flex-col gap-4">
            <p className="text-body text-text-secondary">
              As mensagens, os arquivos baixados e o histórico saem deste dispositivo agora,
              sem esperar o prazo. Isto não tem desfazer.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmando(false)}>
                Cancelar
              </Button>
              <Button variant="danger" loading={apagando} onClick={() => void apagarAgora()}>
                Apagar agora
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
