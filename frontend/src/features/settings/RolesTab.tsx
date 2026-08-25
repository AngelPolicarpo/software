import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Plus } from "lucide-react";
import { cn } from "../../lib/cn";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { Modal } from "../../components/ui/Modal";
import { Tabs } from "../../components/ui/Tabs";
import { TextField } from "../../components/ui/TextField";
import { Toggle } from "../../components/ui/Toggle";
import { Tooltip } from "../../components/ui/Tooltip";
import { SettingsRow, SettingsSection } from "./SettingsLayout";
import { api } from "../../ipc/api";
import { numeroDaCor } from "../../ipc/cores";
import { codigoDoErro } from "../../ipc/frames";
import { sincronizarComunidade } from "../../live/sincronizacao";
import { motivoDaRecusa, OFFLINE_HINT } from "../../live/recusas";
import { useHostStatus } from "../../store/connectionStore";
import { useToastStore } from "../../store/toastStore";
import { AVATAR_BG_CLASS } from "../../lib/avatar";
import { ROLE_TEXT_CLASS } from "../../lib/role";
import { PERMISSION_GROUPS } from "../../mocks/dataset";
import { selectMemberRoleIds, useCommunityStore, useFindMembers, useRoles } from "../../store/communityStore";
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
  roles: Role[];
  selectedId: string;
  onSelect: (roleId: string) => void;
  /** Commit da reordenação — UMA op de §15.4, disparada no drop. */
  mover: (roleId: string, paraIndice: number) => void;
  desabilitado: boolean;
  motivoDesabilitado?: string;
}

/**
 * Lista de cargos ordenada por hierarquia, do topo para baixo. Reordenável
 * por arrasto (§10, 3.2) **e** pelos botões de mover: arrastar é preciso,
 * mas não é alcançável por teclado, e §19.4 exige caminho equivalente.
 */
function RoleList({ roles, selectedId, onSelect, mover, desabilitado, motivoDesabilitado }: RoleListProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragState = useRef<{ id: string; lastY: number; indice: number } | null>(null);
  /**
   * Ordem só do gesto. `role.move` é op SÍNCRONA (A25/U-02): commitar a cada linha cruzada
   * mandaria uma op por linha e queimaria o rate limit de §14.4, do mesmo jeito que o
   * auto-save fazia nos formulários. O arrasto mostra o preview; o drop manda uma op.
   */
  const [preview, setPreview] = useState<Role[] | null>(null);
  const exibidos = preview ?? roles;

  function handlePointerDown(
    event: React.PointerEvent<HTMLButtonElement>,
    role: Role,
  ) {
    // Fundador é sempre o topo, posição fixa (§10, D13, exceções).
    if (role.isFounder || desabilitado) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      id: role.id,
      lastY: event.clientY,
      indice: roles.findIndex((r) => r.id === role.id),
    };
    setDraggingId(role.id);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragState.current;
    if (!drag) return;
    const delta = event.clientY - drag.lastY;
    if (Math.abs(delta) < ROW_HEIGHT) return;
    const base = preview ?? roles;
    const de = base.findIndex((r) => r.id === drag.id);
    // O Fundador ocupa o índice 0 e não sai de lá: ninguém passa por cima dele.
    const para = Math.min(Math.max(de + (delta > 0 ? 1 : -1), 1), base.length - 1);
    if (para !== de) {
      const proxima = [...base];
      const [movido] = proxima.splice(de, 1);
      proxima.splice(para, 0, movido!);
      setPreview(proxima);
    }
    drag.lastY = event.clientY;
  }

  function endDrag() {
    const drag = dragState.current;
    dragState.current = null;
    setDraggingId(null);
    if (drag === null) return;
    const destino = (preview ?? roles).findIndex((r) => r.id === drag.id);
    setPreview(null);
    if (destino >= 0 && destino !== drag.indice) mover(drag.id, destino);
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {exibidos.map((role, index) => {
        const active = role.id === selectedId;
        const canMoveUp =
          !desabilitado && index > 0 && !role.isFounder && !exibidos[index - 1].isFounder;
        const canMoveDown = !desabilitado && index < exibidos.length - 1 && !role.isFounder;

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
                title={desabilitado ? motivoDesabilitado : undefined}
                onClick={() => mover(role.id, index - 1)}
                aria-label={`Mover ${role.name || "cargo"} para cima`}
                className="grid size-6 place-items-center rounded-sm text-text-tertiary hover:text-text-primary disabled:opacity-30"
              >
                <ChevronUp size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={!canMoveDown}
                title={desabilitado ? motivoDesabilitado : undefined}
                onClick={() => mover(role.id, index + 1)}
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
}

/**
 * 3.2 Gestão de cargos e permissões — lista à esquerda, editor à direita.
 *
 * Salva sozinho (§13): não há botão "Salvar" porque não há servidor para
 * onde enviar. Fundador e o cargo base "Membro" não podem ser deletados.
 */
export function RolesTab({ community }: RolesTabProps) {
  const findMembers = useFindMembers();
  const roles = useRoles(community.id);
  const hostStatus = useHostStatus(community);
  const showToast = useToastStore((state) => state.showToast);
  const semHost = hostStatus !== "online";

  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [recusa, setRecusa] = useState<string | null>(null);
  const [section, setSection] = useState("permissions");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [mobileEditing, setMobileEditing] = useState(false);

  const selected = roles.find((role) => role.id === selectedId) ?? roles[0];

  // Quem tem o cargo vem do roster do núcleo: `member.setRoles` é op de §15.4 e a lista
  // reage porque `sincronizarMembros` reconsulta depois de cada escrita.
  const membersWithRole = useMemo(() => {
    if (!selected) return [];
    return findMembers(community.id).filter((member) =>
      member.roleIds.includes(selected.id),
    );
  }, [community.id, selected, findMembers]);

  /**
   * U-23: o editor tem rascunho e botão. O auto-save saiu porque `role.update` é op síncrona
   * de §15.4 num log append-only com o rate limit de §14.4 — marcar permissões uma a uma
   * mandava uma op por clique (`F-12`). O rascunho pertence a UM cargo: trocar de cargo na
   * lista descarta o que não foi salvo, e é por isso que ele carrega o próprio `roleId`.
   */
  const [rascunho, setRascunho] = useState<{
    roleId: string;
    name: string;
    color: RoleColor;
    mentionable: boolean;
    permissions: Permission[];
  } | null>(null);

  const draft =
    selected && rascunho?.roleId === selected.id
      ? rascunho
      : selected && {
          roleId: selected.id,
          name: selected.name,
          color: selected.color,
          mentionable: selected.mentionable,
          permissions: selected.permissions,
        };

  async function comRecusa(acao: () => Promise<void>) {
    if (ocupado) return;
    setOcupado(true);
    setRecusa(null);
    try {
      await acao();
      await sincronizarComunidade(community.id);
    } catch (e) {
      setRecusa(motivoDaRecusa(codigoDoErro(e)));
    } finally {
      setOcupado(false);
    }
  }

  /**
   * §6.4.1 — `role.move` manda os VIZINHOS observados, não uma posição. O `fold` ordena por
   * `rank` ascendente e usa o seguinte como teto, então `afterRoleId` é o cargo logo ABAIXO
   * do destino na lista exibida (que é `rank DESC`). Sem ninguém abaixo, o destino é o fundo
   * e o que se manda é `beforeRoleId`: o cargo que vai ficar acima.
   */
  function moverCargo(roleId: string, paraIndice: number) {
    const nova = roles.filter((r) => r.id !== roleId);
    nova.splice(paraIndice, 0, roles.find((r) => r.id === roleId)!);
    const abaixo = nova[paraIndice + 1];
    const acima = nova[paraIndice - 1];
    void comRecusa(async () => {
      await api.roleMove({
        communityId: community.id,
        roleId,
        ...(abaixo !== undefined
          ? { afterRoleId: abaixo.id }
          : acima !== undefined
            ? { beforeRoleId: acima.id }
            : {}),
      });
    });
  }

  if (!selected || !draft) return null;

  const canDelete = !selected.isFounder && !selected.isDefault;
  const sujo =
    draft.name !== selected.name ||
    draft.color !== selected.color ||
    draft.mentionable !== selected.mentionable ||
    draft.permissions.length !== selected.permissions.length ||
    draft.permissions.some((perm) => !selected.permissions.includes(perm));

  function togglePermission(permission: Permission) {
    setRascunho({
      ...draft!,
      permissions: draft!.permissions.includes(permission)
        ? draft!.permissions.filter((item) => item !== permission)
        : [...draft!.permissions, permission],
    });
  }

  function salvar() {
    const cor = numeroDaCor(draft!.color);
    void comRecusa(async () => {
      await api.roleUpdate({
        communityId: community.id,
        roleId: draft!.roleId,
        ...(draft!.name !== selected!.name ? { name: draft!.name } : {}),
        ...(draft!.color !== selected!.color && cor !== null ? { color: cor } : {}),
        ...(draft!.mentionable !== selected!.mentionable ? { mentionable: draft!.mentionable } : {}),
        permissions: draft!.permissions,
      });
      setRascunho(null);
      showToast("Alterações salvas", "success");
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
          disabled={semHost || ocupado}
          title={semHost ? OFFLINE_HINT : undefined}
          onClick={() =>
            void comRecusa(async () => {
              // Cargo novo nasce vazio e no fundo — quem posiciona é o `fold` (§8.5).
              const r = await api.roleCreate({
                communityId: community.id,
                name: "Novo cargo",
                color: numeroDaCor("role-neutral") ?? 6,
                permissions: [],
                mentionable: false,
              });
              setSelectedId(r.roleId);
              setSection("permissions");
              setMobileEditing(true);
            })
          }
        >
          Novo cargo
        </Button>

        <RoleList
          mover={moverCargo}
          desabilitado={semHost || ocupado}
          {...(semHost ? { motivoDesabilitado: OFFLINE_HINT } : {})}
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
          value={draft.name}
          onChange={(value) => setRascunho({ ...draft, name: value })}
          maxLength={32}
          showCounter
          error={
            draft.name.trim() === "" ? "O cargo precisa de um nome" : undefined
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
                aria-pressed={draft.color === color}
                disabled={selected.isFounder}
                onClick={() => setRascunho({ ...draft, color })}
                className={cn(
                  "size-7 rounded-full transition-transform duration-(--duration-fast)",
                  AVATAR_BG_CLASS[color],
                  draft.color === color &&
                    "ring-2 ring-border-strong ring-offset-2 ring-offset-surface-elevated",
                  selected.isFounder && "cursor-not-allowed opacity-50",
                )}
              />
            ))}
          </div>
        </div>

        <Toggle
          checked={draft.mentionable}
          onChange={(mentionable) => setRascunho({ ...draft, mentionable })}
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
                    checked={draft.permissions.includes(permission.id)}
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
                      disabled={semHost || ocupado}
                      title={semHost ? OFFLINE_HINT : undefined}
                      onClick={() =>
                        void comRecusa(async () => {
                          const atuais = selectMemberRoleIds(
                            useCommunityStore.getState(),
                            community.id,
                            member.identityId,
                          );
                          await api.memberSetRoles({
                            communityId: community.id,
                            targetKey: member.identityId,
                            roleIds: atuais.filter((id) => id !== selected.id),
                          });
                        })
                      }
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

        {recusa !== null && (
          <p role="alert" className="rounded-md border border-feedback-danger/40 bg-surface-primary p-3 text-meta text-feedback-danger">
            {recusa}
          </p>
        )}

        {/* U-23 — salvamento explícito: sujo, carregando, e fora do ar com tooltip. */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={salvar}
            loading={ocupado}
            disabled={!sujo || semHost || draft.name.trim() === ""}
            title={semHost ? OFFLINE_HINT : undefined}
          >
            Salvar alterações
          </Button>
          {sujo && (
            <Button variant="ghost" size="sm" onClick={() => setRascunho(null)} disabled={ocupado}>
              Descartar
            </Button>
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
                loading={ocupado}
                disabled={semHost}
                title={semHost ? OFFLINE_HINT : undefined}
                onClick={() =>
                  void comRecusa(async () => {
                    await api.roleDelete({ communityId: community.id, roleId: selected.id });
                    setConfirmingDelete(false);
                    setSelectedId(roles[0]?.id ?? "");
                  })
                }
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
