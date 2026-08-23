import { cn } from "../../../src/lib/cn";
import { Avatar } from "../../components/ui/Avatar";
import { Popover } from "../../components/ui/Popover";
import { findMember } from "../../mocks/dataset";
import type { RelayNode } from "../../domain/types";

/** Mesmos tokens de §5.4 — só "reconnecting" leva movimento. */
const STATUS_CLASS: Record<RelayNode["status"], string> = {
  ok: "bg-conn-ok",
  degraded: "bg-conn-degraded",
  reconnecting: "bg-conn-reconnecting animate-conn-pulse",
  failed: "bg-conn-failed",
};

const STATUS_LABEL: Record<RelayNode["status"], string> = {
  ok: "Conectado",
  degraded: "Degradado",
  reconnecting: "Reconectando",
  failed: "Falhou",
};

export interface TreeHealthPopoverProps {
  communityId: string;
  relays: RelayNode[];
  anchor: DOMRect;
  onClose: () => void;
}

/**
 * Painel do apresentador — saúde da árvore de distribuição (§9, 2.4.2).
 *
 * Só o apresentador vê isto, e só em modo árvore. Lista **apenas o primeiro
 * nível**: nem quem apresenta enxerga conexões que não são suas — coerente
 * com a natureza P2P, em que cada nó só conhece seus vizinhos diretos. A
 * contagem de cada linha já agrega toda a subárvore abaixo dela.
 *
 * Não há ação nenhuma sobre um nó individual no v1: forçar reconexão ou
 * remover um nó não existe. É painel de visibilidade — a mesma postura de
 * honestidade de 2.4.1, representando o problema em aberto de reparo de
 * árvore (`CLAUDE.md:46-47`) em vez de fingir resolvê-lo com um botão.
 */
export function TreeHealthPopover({
  communityId,
  relays,
  anchor,
  onClose,
}: TreeHealthPopoverProps) {
  return (
    <Popover
      anchor={anchor}
      onClose={onClose}
      placement="below"
      width={280}
      label="Saúde da árvore de distribuição"
    >
      <div className="flex flex-col gap-3 p-4">
        <h3 className="text-heading-3 text-text-primary">
          Retransmitindo através de {relays.length}{" "}
          {relays.length === 1 ? "pessoa" : "pessoas"}
        </h3>

        <ul className="flex flex-col gap-2">
          {relays.map((relay) => {
            const member = findMember(communityId, relay.identityId);
            const name = member?.displayName ?? "Participante";
            return (
              <li key={relay.identityId} className="flex items-center gap-2">
                <Avatar
                  name={name}
                  color={member?.avatarColor ?? "role-neutral"}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-text-primary">
                    {name}
                  </span>
                  <span className="block truncate text-meta text-text-tertiary">
                    retransmitindo para {relay.relayingTo}{" "}
                    {relay.relayingTo === 1 ? "pessoa" : "pessoas"}
                  </span>
                </span>
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    STATUS_CLASS[relay.status],
                  )}
                  role="img"
                  aria-label={STATUS_LABEL[relay.status]}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </Popover>
  );
}
