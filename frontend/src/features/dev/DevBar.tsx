import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { useCommunityStore } from "../../store/communityStore";
import { useIdentityStore } from "../../store/identityStore";
import { usePendingInviteStore } from "../../store/inviteStore";

/**
 * Afinador de estado só-de-desenvolvimento, recomendado por §19.1 — não faz
 * parte da spec de produto e não é renderizado em build de produção.
 *
 * Sem ele, estados que dependem de rede real (ou de já ter um rail cheio)
 * são difíceis de alcançar manualmente num mock.
 */
export function DevBar() {
  const [open, setOpen] = useState(false);

  const seedReferenceDataset = useCommunityStore(
    (state) => state.seedReferenceDataset,
  );
  const resetCommunities = useCommunityStore((state) => state.resetCommunities);
  const clearIdentity = useIdentityStore((state) => state.clearIdentity);
  const clearPendingInvite = usePendingInviteStore(
    (state) => state.clearPendingInvite,
  );

  if (!import.meta.env.DEV) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col items-start gap-2">
      {open && (
        <div className="flex w-72 flex-col gap-3 rounded-lg border border-border-default bg-surface-elevated p-3 shadow-elevated">
          <p className="text-caption text-text-tertiary uppercase">
            Estado de desenvolvimento
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={seedReferenceDataset}>
              Carregar dataset §2
            </Button>
            <Button variant="secondary" size="sm" onClick={resetCommunities}>
              Zerar comunidades
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                resetCommunities();
                clearPendingInvite();
                clearIdentity();
              }}
            >
              Apagar identidade
            </Button>
          </div>

          <div className="text-meta text-text-tertiary">
            <p className="text-text-secondary">Convites de teste:</p>
            <p>
              <code>x7K2qM</code> válido · <code>X7REV0</code> revogado ·{" "}
              <code>X7BAN1</code> banido
            </p>
          </div>
        </div>
      )}

      <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
        {open ? "Fechar dev" : "dev"}
      </Button>
    </div>
  );
}
