import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Plus } from "lucide-react";
import { cn } from "../../../src/lib/cn";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../../src/components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { Modal } from "../../components/ui/Modal";
import { Tabs } from "../../components/ui/Tabs";
import { TextField } from "../../../src/components/ui/TextField";
import { Toggle } from "../../components/ui/Toggle";
import { Tooltip } from "../../components/ui/Tooltip";
import { SettingsRow, SettingsSection } from "./SettingsLayout";
import { useAutoSaveToast } from "./useAutoSave";
import { AVATAR_BG_CLASS } from "../../lib/avatar";
import { ROLE_TEXT_CLASS } from "../../lib/role";
import { findMembers, PERMISSION_GROUPS } from "../../mocks/dataset";
import {
  selectMemberRoleIds,
  useCommunityStore,
  useRoles,
} from "../../store/communityStore";
import { useModerationStore } from "../../store/moderationStore";
import type { Community, Permission, Role, RoleColor } from "../../domain/types";

/** §5.4 — conjunto curado fechado de 7; nunca color-picker livre. */
const ROLE_COLORS: RoleColor[] = [
  "role-gold",
  "role-blue",
  "role-green",
  "role-red",
  "role-purple",
  "role-pink",
  "role-neutral",
];

/** Altura da linha da lista — usada para saber quando o arrasto troca de posição. */
const ROW_HEIGHT = 36;

interface RoleListProps {
  communityId: string;
  roles: Role[];
  selectedId: string;
  onSelect: (roleId: string) => void;
}

/**
 * Lista de cargos ordenada por hierarquia, do topo para baixo. Reordenável
 * por arrasto (§10, 3.2) **e** pelos botões de mover: arrastar é preciso,
 * mas não é alcançável por teclado, e §19.4 exige caminho equivalente.
 */
function RoleList({ communityId, roles, selectedId, onSelect }: RoleListProps) {
  const moveRole = useCommunityStore((state) => state.moveRole);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragState = useRef<{ id: string; lastY: number } | null>(null);

  function handlePointerDown(
    event: React.PointerEvent<HTMLButtonElement>,
    role: Role,
  ) {
    // Fundador é sempre o topo, posição fixa (§10, D13, exceções).
    if (role.isFounder) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = { id: role.id, lastY: event.clientY };
    setDraggingId(role.id);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragState.current;
    if (!drag) return;
    const delta = event.clientY - drag.lastY;
    if (Math.abs(delta) < ROW_HEIGHT) return;
    moveRole(communityId, drag.id, delta > 0 ? 1 : -1);
    drag.lastY = event.clientY;
  }

  function endDrag() {
    dragState.current = null;
    setDraggingId(null);
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {roles.map((role, index) => {
        const active = role.id === selectedId;
        const canMoveUp = index > 0 && !role.isFounder && !roles[index - 1].isFounder;
        const canMoveDown = index < roles.length - 1 && !role.isFounder;

        return (
          <li
            key={role.id}
            className={cn(
              "group flex items-center gap-1 rounded-md pr-1",
              // §17 — o item levanta levemente e os demais deslizam.
              draggingId === role.id &&
                "bg-surface-elevated shadow-elevated ring-1 ring-border-strong",
              active && draggingId !== role.id && "bg-accent-muted-bg",
            )}
          >
            <Tooltip
              label={
                role.isFounder
                  ? "Fundador é sempre o topo da hierarquia"
                  : "Arraste para reordenar"
              }
              side="top"
            >
              <button
                type="button"
                aria-label={`Arrastar ${role.name || "cargo sem nome"}`}
                onPointerDown={(event) => handlePointerDown(event, role)}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-sm text-text-tertiary",
                  role.isFounder
                    ? "cursor-not-allowed opacity-40"
                    : "cursor-grab hover:text-text-secondary",
                )}
              >
                <GripVertical size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </Tooltip>

            <button
              type="button"
              onClick={() => onSelect(role.id)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left",
                "transition-colors duration-(--duration-fast) ease-out",
                !active && "hover:bg-surface-primary",
              )}
            >
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  AVATAR_BG_CLASS[role.color],
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-body",
                  role.name ? ROLE_TEXT_CLASS[role.color] : "text-text-tertiary",
                )}
              >
                {role.name || "Cargo sem nome"}
              </span>
            </button>

            <span className="flex shrink-0 opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100 focus-within:opacity-100">
              <button
                type="button"
                disabled={!canMoveUp}
                onClick={() => moveRole(communityId, role.id, -1)}
                aria-label={`Mover ${role.name || "cargo"} para cima`}
                className="grid size-6 place-items-center rounded-sm text-text-tertiary hover:text-text-primary disabled:opacity-30"
              >
                <ChevronUp size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={!canMoveDown}
                onClick={() => moveRole(communityId, role.id, 1)}
                aria-label={`Mover ${role.name || "cargo"} para baixo`}
                className="grid size-6 place-items-center rounded-sm text-text-tertiary hover:text-text-primary disabled:opacity-30"
              >
                <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export interface RolesTabProps {
  community: Community;
  localMemberId: string;
}

/**
 * 3.2 Gestão de cargos e permissões — lista à esquerda, editor à direita.
 *
 * Salva sozinho (§13): não há botão "Salvar" porque não há servidor para
 * onde enviar. Fundador e o cargo base "Membro" não podem ser deletados.
 */
export function RolesTab({ community, localMemberId }: RolesTabProps) {
  const roles = useRoles(community.id);
  const createRole = useCommunityStore((state) => state.createRole);
  const updateRole = useCommunityStore((state) => state.updateRole);
  const deleteRole = useCommunityStore((state) => state.deleteRole);
  const setMemberRoles = useCommunityStore((state) => state.setMemberRoles);
  const log = useModerationStore((state) => state.log);

  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? "");
  const [section, setSection] = useState("permissions");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [mobileEditing, setMobileEditing] = useState(false);

  const selected = roles.find((role) => role.id === selectedId) ?? roles[0];

  // O que a sessão atribuiu nesta comunidade; sem isto a lista não reagiria
  // a alguém ganhando ou perdendo o cargo.
  const assignments = useCommunityStore(
    (state) => state.memberRoleOverrides[community.id],
  );
  const membersWithRole = useMemo(() => {
    if (!selected) return [];
    return findMembers(community.id).filter((member) =>
      (assignments?.[member.identityId] ?? member.roleIds).includes(selected.id),
    );
  }, [community.id, selected, assignments]);

  useAutoSaveToast(
    JSON.stringify(
      roles.map((role) => [role.name, role.color, role.mentionable, role.permissions.length, role.position]),
    ),
  );

  if (!selected) return null;

  const canDelete = !selected.isFounder && !selected.isDefault;

  function togglePermission(permission: Permission) {
    const has = selected.permissions.includes(permission);
    updateRole(selected.id, {
      permissions: has
        ? selected.permissions.filter((item) => item !== permission)
        : [...selected.permissions, permission],
    });
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4 tablet:h-full">
      {/* Lista de cargos — em Mobile, a primeira das duas telas (§10, 3.2). */}
      <div
        className={cn(
          "flex w-full flex-col gap-3 tablet:w-[240px] tablet:shrink-0",
          mobileEditing && "hidden tablet:flex",
        )}
      >
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Plus size={16} strokeWidth={2} aria-hidden="true" />}
          onClick={() => {
            const roleId = createRole(community.id);
            log({
              communityId: community.id,
              type: "createRole",
              targetId: roleId,
              targetLabel: "Cargo sem nome",
              authorId: localMemberId,
            });
            setSelectedId(roleId);
            setSection("permissions");
            setMobileEditing(true);
          }}
        >
          Novo cargo
        </Button>

        <RoleList
          communityId={community.id}
          roles={roles}
          selectedId={selected.id}
          onSelect={(roleId) => {
            setSelectedId(roleId);
            setMobileEditing(true);
          }}
        />
      </div>

      {/* Editor do cargo selecionado. */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-4",
          !mobileEditing && "hidden tablet:flex",
        )}
      >
        <button
          type="button"
          onClick={() => setMobileEditing(false)}
          className="self-start text-meta text-text-secondary tablet:hidden"
        >
          ← Todos os cargos
        </button>

        <TextField
          label="Nome do cargo"
          value={selected.name}
          onChange={(value) => updateRole(selected.id, { name: value })}
          maxLength={32}
          showCounter
          error={
            selected.name.trim() === "" ? "O cargo precisa de um nome" : undefined
          }
          disabled={selected.isFounder}
        />

        <div>
          <p className="text-caption text-text-tertiary uppercase">Cor</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ROLE_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                aria-pressed={selected.color === color}
                disabled={selected.isFounder}
                onClick={() => updateRole(selected.id, { color })}
                className={cn(
                  "size-7 rounded-full transition-transform duration-(--duration-fast)",
                  AVATAR_BG_CLASS[color],
                  selected.color === color &&
                    "ring-2 ring-border-strong ring-offset-2 ring-offset-surface-elevated",
                  selected.isFounder && "cursor-not-allowed opacity-50",
                )}
              />
            ))}
          </div>
        </div>

        <Toggle
          checked={selected.mentionable}
          onChange={(mentionable) => updateRole(selected.id, { mentionable })}
          label="Mencionável"
          description="Permite escrever @cargo no composer."
        />

        <Tabs
          orientation="horizontal"
          activeId={section}
          onSelect={setSection}
          items={[
            { id: "permissions", label: "Permissões" },
            { id: "members", label: `Membros (${membersWithRole.length})` },
          ]}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {section === "permissions" &&
            PERMISSION_GROUPS.map((group) => (
              <SettingsSection key={group.id} title={group.label}>
                {group.permissions.map((permission) => (
                  <Checkbox
                    key={permission.id}
                    checked={selected.permissions.includes(permission.id)}
                    onChange={() => togglePermission(permission.id)}
                    label={permission.label}
                  />
                ))}
              </SettingsSection>
            ))}

          {section === "members" && (
            <div className="flex flex-col gap-2">
              {membersWithRole.length === 0 && (
                <p className="text-body text-text-tertiary">
                  Nenhum membro tem o cargo {selected.name || "sem nome"} ainda.
                </p>
              )}
              {membersWithRole.map((member) => (
                <SettingsRow
                  key={member.identityId}
                  action={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const state = useCommunityStore.getState();
                        setMemberRoles(
                          community.id,
                          member.identityId,
                          selectMemberRoleIds(
                            state,
                            community.id,
                            member.identityId,
                          ).filter((id) => id !== selected.id),
                        );
                      }}
                    >
                      Remover
                    </Button>
                  }
                >
                  <span className="flex items-center gap-2">
                    <Avatar
                      name={member.displayName}
                      color={member.avatarColor}
                      size="sm"
                    />
                    <span className="truncate text-body text-text-primary">
                      {member.displayName}
                    </span>
                  </span>
                </SettingsRow>
              ))}
            </div>
          )}
        </div>

        {canDelete && (
          <Button
            variant="danger"
            size="sm"
            className="self-start"
            onClick={() => setConfirmingDelete(true)}
          >
            Deletar cargo
          </Button>
        )}
      </div>

      {confirmingDelete && (
        <Modal
          open
          onClose={() => setConfirmingDelete(false)}
          title="Deletar cargo?"
          size="sm"
        >
          <div className="flex flex-col gap-4">
            <p className="text-body text-text-secondary">
              {membersWithRole.length > 0
                ? `Este cargo tem ${membersWithRole.length} ${
                    membersWithRole.length === 1 ? "membro" : "membros"
                  }. Remover o cargo, não os membros?`
                : `O cargo ${selected.name || "sem nome"} será removido desta comunidade.`}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  deleteRole(community.id, selected.id);
                  log({
                    communityId: community.id,
                    type: "deleteRole",
                    targetId: selected.id,
                    targetLabel: selected.name || "Cargo sem nome",
                    authorId: localMemberId,
                  });
                  setConfirmingDelete(false);
                  setSelectedId(roles[0]?.id ?? "");
                }}
              >
                Deletar cargo
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
