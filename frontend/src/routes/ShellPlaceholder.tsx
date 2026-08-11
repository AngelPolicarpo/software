import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { useIdentityStore } from "../store/identityStore";
import { usePendingInviteStore } from "../store/inviteStore";

/**
 * TEMPORÁRIO — não é uma tela da spec.
 *
 * Ocupa o lugar do Hub vazio (0.2) e do Shell (1.1) enquanto eles não
 * existem, para que o fluxo A1 tenha um destino verificável. Este arquivo
 * inteiro é removido quando a Camada 1 for implementada.
 */
export function ShellPlaceholder() {
  const identity = useIdentityStore((state) => state.identity);
  const clearIdentity = useIdentityStore((state) => state.clearIdentity);
  const pendingInviteCode = usePendingInviteStore(
    (state) => state.pendingInviteCode,
  );

  if (!identity) return null;

  return (
    <main className="flex min-h-full items-center justify-center bg-surface-app px-4 py-8">
      <div className="w-full max-w-[420px] rounded-lg border border-border-default bg-surface-primary p-6">
        <div className="flex items-center gap-3">
          <Avatar
            name={identity.displayName}
            color={identity.avatarColor}
            size="md"
            presence={identity.presence}
            presenceRingClass="border-surface-primary"
          />
          <div className="min-w-0">
            <p className="truncate text-body-emphasis text-text-primary">
              {identity.displayName}
            </p>
            <p className="text-meta text-text-tertiary">{identity.handle}</p>
          </div>
        </div>

        <p className="mt-6 text-body text-text-secondary">
          Identidade criada e persistida. O Hub vazio (0.2) e o Shell (1.1)
          entram na próxima parte da implementação.
        </p>

        {pendingInviteCode && (
          <p className="mt-4 text-meta text-text-tertiary">
            Convite pendente guardado:{" "}
            <code className="text-text-secondary">{pendingInviteCode}</code> — o
            preview (0.3) será retomado a partir daqui.
          </p>
        )}

        <Button
          variant="secondary"
          size="sm"
          className="mt-6"
          onClick={clearIdentity}
        >
          Apagar identidade (dev)
        </Button>
      </div>
    </main>
  );
}
