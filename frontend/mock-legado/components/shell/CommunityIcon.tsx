import { useState } from "react";
import { Settings } from "lucide-react";
import { cn } from "../../../src/lib/cn";
import { AVATAR_BG_CLASS, initialsFrom } from "../../lib/avatar";
import { Badge } from "../ui/Badge";
import { Menu } from "../ui/Menu";
import { Tooltip } from "../ui/Tooltip";
import { useHostStatus } from "../../store/connectionStore";
import { useCommunityUnread } from "../../store/communityStore";
import type { Community } from "../../domain/types";

export interface CommunityIconProps {
  community: Community;
  active: boolean;
  onSelect: () => void;
  /** Menu de contexto do ícone → Configurações da comunidade (§10, 3.1b). */
  onOpenSettings?: () => void;
}

/**
 * Ícone de comunidade no rail (§8, 1.1).
 *
 * Ativo ganha barra vertical `accent-default` de 4px à esquerda, e o ícone
 * deixa de ser circular para virar `radius-lg` — convenção do gênero: só o
 * ativo "quadra". Host offline reduz a opacidade e sobrepõe um dot
 * `conn-offline` (estado estável, sem animação — §12).
 */
export function CommunityIcon({
  community,
  active,
  onSelect,
  onOpenSettings,
}: CommunityIconProps) {
  // O host pode voltar durante a sessão (§11, B4) — o rail acompanha.
  const offline = useHostStatus(community) === "offline";
  // Sem isto, não-lida e menção só existem dentro da comunidade já aberta
  // — e a premissa 7 põe as duas no v1 (§8, 1.1).
  const { unread, mentions } = useCommunityUnread(community.id);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="relative flex w-full justify-center">
      <span
        className={cn(
          "absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full",
          "transition-all duration-(--duration-base) ease-out",
          active
            ? "h-8 bg-accent-default opacity-100"
            : unread
              // Comprimento é a gramática: ativo > não-lido > nada (§8, 1.1).
              ? "h-2 bg-text-primary opacity-100"
              : "h-0 opacity-0",
        )}
        aria-hidden="true"
      />

      <Tooltip
        label={
          offline
            ? `${community.name} — host offline`
            : mentions > 0
              ? `${community.name} — ${mentions} menção pendente`
              : community.name
        }
      >
        <button
          type="button"
          onClick={onSelect}
          onContextMenu={(event) => {
            if (!onOpenSettings) return;
            event.preventDefault();
            setMenuOpen(true);
          }}
          // Sem isto o nome acessível do botão é o que estiver desenhado —
          // as iniciais, ou pior, só o emoji do ícone.
          aria-label={community.name}
          aria-current={active ? "true" : undefined}
          className={cn(
            "group relative grid size-12 place-items-center",
            "text-heading-3 text-surface-app select-none",
            "transition-all duration-(--duration-base) ease-out",
            AVATAR_BG_CLASS[community.iconColor],
            active ? "rounded-lg" : "rounded-full hover:rounded-lg",
            offline && "opacity-60",
          )}
        >
          {community.iconEmoji ? (
            <span className="text-[22px]">{community.iconEmoji}</span>
          ) : (
            initialsFrom(community.name)
          )}

          {offline && (
            <span
              className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-surface-app bg-conn-offline"
              aria-hidden="true"
            />
          )}
        </button>
      </Tooltip>

      {/* Fora do <button> de propósito: dentro, a contagem entraria no nome
          acessível do botão junto com o nome da comunidade. */}
      {mentions > 0 && (
        <span className="pointer-events-none absolute right-2 bottom-0">
          <Badge
            count={mentions}
            srLabel={`${mentions} menção pendente em ${community.name}`}
          />
        </span>
      )}

      {onOpenSettings && (
        <Menu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          items={[
            {
              id: "settings",
              label: "Configurações da comunidade",
              icon: <Settings size={20} strokeWidth={2} />,
              onSelect: onOpenSettings,
            },
          ]}
        />
      )}
    </div>
  );
}
