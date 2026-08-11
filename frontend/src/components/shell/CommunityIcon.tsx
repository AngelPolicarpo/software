import { cn } from "../../lib/cn";
import { AVATAR_BG_CLASS, initialsFrom } from "../../lib/avatar";
import { Tooltip } from "../ui/Tooltip";
import { useHostStatus } from "../../store/connectionStore";
import type { Community } from "../../domain/types";

export interface CommunityIconProps {
  community: Community;
  active: boolean;
  onSelect: () => void;
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
}: CommunityIconProps) {
  // O host pode voltar durante a sessão (§11, B4) — o rail acompanha.
  const offline = useHostStatus(community) === "offline";

  return (
    <div className="relative flex w-full justify-center">
      <span
        className={cn(
          "absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-accent-default",
          "transition-all duration-(--duration-base) ease-out",
          active ? "h-8 opacity-100" : "h-0 opacity-0",
        )}
        aria-hidden="true"
      />

      <Tooltip
        label={
          offline ? `${community.name} — host offline` : community.name
        }
      >
        <button
          type="button"
          onClick={onSelect}
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
    </div>
  );
}
