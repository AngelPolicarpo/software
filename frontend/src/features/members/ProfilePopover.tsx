import { useShallow } from "zustand/react/shallow";
import { cn } from "../../lib/cn";
import { Avatar } from "../../components/ui/Avatar";
import { Popover } from "../../components/ui/Popover";
import { ROLE_TEXT_CLASS } from "../../lib/role";
import { AVATAR_BG_CLASS, PRESENCE_LABEL } from "../../lib/avatar";
import { findMember } from "../../mocks/dataset";
import { selectRole, useCommunityStore } from "../../store/communityStore";
import type { Role } from "../../domain/types";

const joinedFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export interface ProfilePopoverProps {
  communityId: string;
  identityId: string;
  anchor: DOMRect;
  onClose: () => void;
}

/**
 * Popover de perfil de membro (§8, 1.4) — mesmo componente para os três
 * gatilhos: lista de membros, autor de uma mensagem e (quando 2.3 existir)
 * participante de voz.
 *
 * A seção de ações condicionais à permissão (atribuir cargo, timeout,
 * expulsar, banir) entra com a moderação de §10 (3.2/3.3) e o fluxo D12 —
 * hoje nenhuma dessas ações existe para levar o clique a lugar nenhum. Para
 * Ana, que é Contribuidora, o popover já é exatamente este: só informação.
 */
export function ProfilePopover({
  communityId,
  identityId,
  anchor,
  onClose,
}: ProfilePopoverProps) {
  const member = findMember(communityId, identityId);
  const roles = useCommunityStore(
    useShallow((state) =>
      (member?.roleIds ?? [])
        .map((roleId) => selectRole(state, roleId))
        .filter((role): role is Role => role !== undefined)
        .sort((a, b) => b.position - a.position),
    ),
  );

  if (!member) return null;

  return (
    <Popover anchor={anchor} onClose={onClose} label={`Perfil de ${member.displayName}`}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <Avatar
            name={member.displayName}
            color={member.avatarColor}
            size="lg"
            presence={member.presence}
            presenceRingClass="border-surface-elevated"
          />
          <div className="min-w-0">
            <p className="truncate text-heading-2 text-text-primary">
              {member.nickname ?? member.displayName}
            </p>
            {member.nickname && (
              <p className="truncate text-meta text-text-secondary">
                {member.displayName}
              </p>
            )}
            <p className="truncate text-meta text-text-tertiary">
              {member.handle} · {PRESENCE_LABEL[member.presence]}
            </p>
          </div>
        </div>

        {roles.length > 0 && (
          <div>
            <p className="text-caption text-text-tertiary uppercase">Cargos</p>
            <ul className="mt-1.5 flex flex-wrap gap-1">
              {roles.map((role) => (
                <li
                  key={role.id}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border border-border-default",
                    "bg-surface-primary px-2 py-0.5 text-meta",
                    ROLE_TEXT_CLASS[role.color],
                  )}
                >
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      AVATAR_BG_CLASS[role.color],
                    )}
                    aria-hidden="true"
                  />
                  {role.name}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="text-caption text-text-tertiary uppercase">
            Membro desde
          </p>
          <p className="mt-1 text-body text-text-secondary">
            Entrou em {joinedFormat.format(new Date(member.joinedAt))}
          </p>
        </div>
      </div>
    </Popover>
  );
}
