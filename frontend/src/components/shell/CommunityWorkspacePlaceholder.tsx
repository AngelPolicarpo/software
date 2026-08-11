import { Avatar } from "../ui/Avatar";
import type { Community } from "../../domain/types";

/**
 * TEMPORÁRIO — não é uma tela da spec.
 *
 * Ocupa as colunas de lista de canais e conteúdo do shell (1.1) enquanto
 * elas não existem, para que 0.3 e 0.4 tenham um destino verificável. Este
 * arquivo é removido quando a Camada 1 for implementada.
 */
export function CommunityWorkspacePlaceholder({
  community,
}: {
  community: Community;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center bg-surface-primary px-8 py-12">
      <div className="flex w-full max-w-[420px] flex-col items-center text-center">
        <Avatar
          name={community.name}
          color={community.iconColor}
          emoji={community.iconEmoji}
          size="lg"
          shape="squircle"
        />
        <h1 className="mt-6 text-heading-1 text-text-primary">
          {community.name}
        </h1>
        <p className="mt-1 text-meta text-text-secondary">
          {community.memberCount.toLocaleString("pt-BR")} membros ·{" "}
          {community.isHostedByMe
            ? "hospedada neste dispositivo"
            : `host ${community.connectionHealth.hostStatus}`}
        </p>
        <p className="mt-6 text-body text-text-secondary">
          A lista de canais e a área de conteúdo (1.1) entram na próxima parte
          da implementação.
        </p>
      </div>
    </div>
  );
}
