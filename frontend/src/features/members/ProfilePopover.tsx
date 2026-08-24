import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { Popover } from "../../components/ui/Popover";
import { Slider } from "../../components/ui/Slider";
import { TextField } from "../../components/ui/TextField";
import { ROLE_TEXT_CLASS } from "../../lib/role";
import { AVATAR_BG_CLASS, PRESENCE_LABEL } from "../../lib/avatar";
import { selectCanModerate, selectMemberRoleIds, selectRole, useCommunityStore, useFindMember, useHasPermission, useLocalMemberId, useMemberLabel, useRoles } from "../../store/communityStore";
import {
  ModerationDialog,
  type ModerationKind,
} from "../moderation/ModerationDialog";
import { useIdentityStore } from "../../store/identityStore";
import { useUiStore } from "../../store/uiStore";
import { useVoiceStore } from "../../store/voiceStore";
import type { PresenceStatus, Role } from "../../domain/types";

/** Os quatro estados de §2/§5.4, na ordem em que aparecem no seletor. */
const PRESENCE_OPTIONS: PresenceStatus[] = [
  "online",
  "idle",
  "dnd",
  "invisible",
];

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
  /**
   * Aberto de dentro de uma chamada em que os dois estão (§9, 2.3) — libera
   * o volume individual e, com permissão, silenciar nesta chamada (§8, 1.4).
   */
  inCall?: boolean;
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
  inCall = false,
}: ProfilePopoverProps) {
  const findMember = useFindMember();
  const member = findMember(communityId, identityId);
  const roles = useCommunityStore(
    useShallow((state) =>
      selectMemberRoleIds(state, communityId, identityId)
        .map((roleId) => selectRole(state, roleId))
        .filter((role): role is Role => role !== undefined)
        .sort((a, b) => b.position - a.position),
    ),
  );

  const isSelf = useVoiceStore((state) => state.localId === identityId);
  const volume = useVoiceStore((state) => state.volumeById[identityId] ?? 100);
  const setVolume = useVoiceStore((state) => state.setVolume);
  const participantMuted = useVoiceStore((state) =>
    Boolean(
      state.participants.find((p) => p.identityId === identityId)?.muted,
    ),
  );
  const setParticipantMuted = useVoiceStore(
    (state) => state.setParticipantMuted,
  );
  // §15: ação que a permissão não autoriza não aparece — nunca desabilitada.
  const canMuteOthers = useHasPermission(communityId, "voice_mute_others");

  /**
   * Regra de hierarquia de §10: só dá para moderar quem está abaixo de você,
   * e o Fundador nunca é alvo. Sem isso, cada ação teria de repetir a
   * checagem — e uma delas acabaria esquecendo.
   */
  const canModerate = useCommunityStore((state) =>
    selectCanModerate(state, communityId, identityId),
  );
  const canManageRoles = useHasPermission(communityId, "manage_roles");
  const canKick = useHasPermission(communityId, "kick_members");
  const canBan = useHasPermission(communityId, "ban_members");
  const canTimeout = useHasPermission(communityId, "timeout_members");

  const communityRoles = useRoles(communityId);
  const assignedRoleIds = useCommunityStore((state) =>
    selectMemberRoleIds(state, communityId, identityId).join("|"),
  );
  const setMemberRoles = useCommunityStore((state) => state.setMemberRoles);
  const localMemberId = useLocalMemberId(communityId);
  const label = useMemberLabel(communityId, identityId);

  const setMemberNickname = useCommunityStore(
    (state) => state.setMemberNickname,
  );
  const identityPresence = useIdentityStore(
    (state) => state.identity?.presence ?? "online",
  );
  const setPresence = useIdentityStore((state) => state.setPresence);
  const openAccountSettings = useUiStore((state) => state.openAccountSettings);

  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [moderation, setModeration] = useState<ModerationKind | null>(null);

  if (!member) return null;

  const showCallSection = inCall && !isSelf;
  // `isSelf` do voiceStore só vale dentro de uma chamada; aqui a pergunta é
  // sobre identidade na comunidade, não sobre a chamada.
  const isOwnProfile = identityId === localMemberId;
  const assigned = assignedRoleIds === "" ? [] : assignedRoleIds.split("|");
  const showModeration =
    canModerate && (canManageRoles || canKick || canBan || canTimeout);

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
              {label}
            </p>
            {label !== member.displayName && (
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

        {/*
          Perfil próprio: apelido, presença e atalho para 3.1 — as ações de
          moderação nunca apontam para si mesma (§8, 1.4).
        */}
        {isOwnProfile && (
          <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
            {editingNickname ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  setMemberNickname(communityId, identityId, nicknameDraft);
                  setEditingNickname(false);
                }}
              >
                <TextField
                  label="Apelido nesta comunidade"
                  value={nicknameDraft}
                  onChange={setNicknameDraft}
                  maxLength={32}
                  showCounter
                  autoFocus
                  autoComplete="off"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setEditingNickname(false);
                    }
                  }}
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm">
                    Salvar
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setMemberNickname(communityId, identityId, null);
                      setEditingNickname(false);
                    }}
                  >
                    Usar meu nome
                  </Button>
                </div>
              </form>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                fullWidth
                onClick={() => {
                  setNicknameDraft(label === member.displayName ? "" : label);
                  setEditingNickname(true);
                }}
              >
                Editar apelido nesta comunidade
              </Button>
            )}

            <div>
              <p className="text-caption text-text-tertiary uppercase">
                Presença
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {PRESENCE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={identityPresence === option}
                    onClick={() => setPresence(option)}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-meta",
                      "transition-colors duration-(--duration-fast) ease-out",
                      identityPresence === option
                        ? "border-accent-default bg-accent-muted-bg text-text-primary"
                        : "border-border-default text-text-secondary hover:text-text-primary",
                    )}
                  >
                    {PRESENCE_LABEL[option]}
                  </button>
                ))}
              </div>
              {identityPresence === "invisible" && (
                <p className="mt-1.5 text-meta text-text-tertiary">
                  Você aparece como offline, mas continua recebendo tudo
                  normalmente.
                </p>
              )}
            </div>

            <Button
              variant="secondary"
              size="sm"
              fullWidth
              onClick={() => {
                onClose();
                openAccountSettings();
              }}
            >
              Editar perfil
            </Button>
          </div>
        )}

        {/* Ações condicionais à permissão (§8, 1.4 · §10). Item que a
            permissão ou a hierarquia não autoriza não aparece — nunca
            aparece desabilitado (§15). */}
        {showModeration && (
          <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
            {canManageRoles && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  aria-expanded={assigning}
                  onClick={() => setAssigning((open) => !open)}
                >
                  Atribuir cargo
                </Button>

                {assigning && (
                  <ul className="flex flex-col gap-1">
                    {communityRoles
                      .filter((role) => !role.isFounder)
                      .map((role) => {
                        const has = assigned.includes(role.id);
                        return (
                          <li key={role.id}>
                            <button
                              type="button"
                              aria-pressed={has}
                              onClick={() =>
                                setMemberRoles(
                                  communityId,
                                  identityId,
                                  has
                                    ? assigned.filter((id) => id !== role.id)
                                    : [...assigned, role.id],
                                )
                              }
                              className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-body",
                                "transition-colors duration-(--duration-fast) ease-out",
                                has
                                  ? "bg-accent-muted-bg text-text-primary"
                                  : "text-text-secondary hover:bg-surface-primary",
                              )}
                            >
                              <span
                                className={cn(
                                  "size-2 shrink-0 rounded-full",
                                  AVATAR_BG_CLASS[role.color],
                                )}
                                aria-hidden="true"
                              />
                              <span className="min-w-0 flex-1 truncate">
                                {role.name || "Cargo sem nome"}
                              </span>
                              {has && <Check size={16} strokeWidth={2} aria-hidden="true" />}
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </>
            )}

            {canTimeout && (
              <Button
                variant="secondary"
                size="sm"
                fullWidth
                onClick={() => setModeration("timeout")}
              >
                Aplicar timeout
              </Button>
            )}
            {canKick && (
              <Button
                variant="danger"
                size="sm"
                fullWidth
                onClick={() => setModeration("kick")}
              >
                Expulsar
              </Button>
            )}
            {canBan && (
              <Button
                variant="danger"
                size="sm"
                fullWidth
                onClick={() => setModeration("ban")}
              >
                Banir
              </Button>
            )}
          </div>
        )}

        {/* Ações específicas da chamada — só existem enquanto os dois estão
            nela (§8, 1.4). */}
        {showCallSection && (
          <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
            <Slider
              label="Volume nesta chamada"
              value={volume}
              onChange={(value) => setVolume(identityId, value)}
              valueLabel={`${volume}%`}
            />

            {canMuteOthers && (
              <Button
                variant="secondary"
                size="sm"
                fullWidth
                onClick={() => setParticipantMuted(identityId, !participantMuted)}
              >
                {participantMuted
                  ? "Reativar microfone nesta chamada"
                  : "Silenciar nesta chamada"}
              </Button>
            )}
          </div>
        )}
      </div>

      {moderation && (
        <ModerationDialog
          kind={moderation}
          communityId={communityId}
          targetId={identityId}
          targetLabel={member.displayName}
          byId={localMemberId}
          onClose={() => setModeration(null)}
          onApplied={onClose}
        />
      )}
    </Popover>
  );
}
