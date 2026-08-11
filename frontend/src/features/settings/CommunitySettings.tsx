import { useState } from "react";
import { Copy, Settings, Shield, Users } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { TextArea } from "../../components/ui/TextArea";
import { TextField } from "../../components/ui/TextField";
import {
  DangerZone,
  SettingsLayout,
  SettingsRow,
  SettingsSection,
} from "./SettingsLayout";
import { ModerationTab } from "./ModerationTab";
import { RolesTab } from "./RolesTab";
import { useAutoSaveToast } from "./useAutoSave";
import { formatRelativeTime } from "../../lib/format";
import { findMember, INVITE_LINK_HOST } from "../../mocks/dataset";
import {
  useCommunityStore,
  useHasPermission,
  useInvites,
} from "../../store/communityStore";
import { useToastStore } from "../../store/toastStore";
import { useVoiceStore } from "../../store/voiceStore";
import type { Community } from "../../domain/types";

const EXPIRY_OPTIONS = [
  { value: "0", label: "Nunca" },
  { value: "1", label: "1 dia" },
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
];

const USES_OPTIONS = [
  { value: "0", label: "Ilimitado" },
  { value: "1", label: "1 uso" },
  { value: "10", label: "10 usos" },
  { value: "100", label: "100 usos" },
];

export interface CommunitySettingsProps {
  community: Community;
  localMemberId: string;
  onClose: () => void;
}

/**
 * 3.1b Configurações da comunidade — metadados, convites e zona de perigo,
 * mais as abas de cargos (3.2) e moderação (3.3).
 *
 * A aba de moderação só existe para quem tem `view_audit_log`: §15 manda
 * esconder o que a permissão não autoriza, nunca mostrar desabilitado.
 */
export function CommunitySettings({
  community,
  localMemberId,
  onClose,
}: CommunitySettingsProps) {
  const canViewAudit = useHasPermission(community.id, "view_audit_log");
  const canManageRoles = useHasPermission(community.id, "manage_roles");
  const canInvite = useHasPermission(community.id, "create_invite");

  const [tab, setTab] = useState("general");
  const updateCommunity = useCommunityStore((state) => state.updateCommunity);
  const createInvite = useCommunityStore((state) => state.createInvite);
  const revokeInvite = useCommunityStore((state) => state.revokeInvite);
  const leaveCommunity = useCommunityStore((state) => state.leaveCommunity);
  const endCommunity = useCommunityStore((state) => state.endCommunity);
  const invites = useInvites(community.id);
  const showToast = useToastStore((state) => state.showToast);
  const leaveVoice = useVoiceStore((state) => state.leave);
  const voiceCommunityId = useVoiceStore((state) => state.communityId);

  const [creatingInvite, setCreatingInvite] = useState(false);
  const [expiry, setExpiry] = useState("0");
  const [uses, setUses] = useState("0");
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [endStep, setEndStep] = useState(1);

  useAutoSaveToast(`${community.name}|${community.description ?? ""}`);

  const tabs = [
    { id: "general", label: "Geral", icon: <Settings size={16} strokeWidth={2} /> },
    ...(canManageRoles
      ? [{ id: "roles", label: "Cargos", icon: <Users size={16} strokeWidth={2} /> }]
      : []),
    ...(canViewAudit
      ? [
          {
            id: "moderation",
            label: "Moderação",
            icon: <Shield size={16} strokeWidth={2} />,
          },
        ]
      : []),
  ];

  function closeAndLeave(end: boolean) {
    // Sair da comunidade que hospeda a chamada encerra a chamada junto.
    if (voiceCommunityId === community.id) leaveVoice();
    if (end) endCommunity(community.id);
    else leaveCommunity(community.id);
    onClose();
  }

  return (
    <>
      <SettingsLayout
        title={community.name}
        items={tabs}
        activeId={tab}
        onSelect={setTab}
        onClose={onClose}
      >
        {tab === "general" && (
          <>
            <SettingsSection title="Identidade da comunidade">
              <TextField
                label="Nome da comunidade"
                value={community.name}
                onChange={(name) => updateCommunity(community.id, { name })}
                maxLength={40}
                showCounter
                counterWarningAt={36}
                error={
                  community.name.trim().length < 2
                    ? "O nome precisa de pelo menos 2 caracteres"
                    : undefined
                }
              />
              <TextArea
                label="Descrição"
                value={community.description ?? ""}
                onChange={(description) =>
                  updateCommunity(community.id, { description })
                }
                maxLength={120}
                showCounter
                rows={3}
              />
            </SettingsSection>

            {canInvite && (
              <SettingsSection
                title="Convites"
                description="A única porta de entrada da comunidade — não existe diretório público."
              >
                {invites.length === 0 && (
                  <p className="text-body text-text-tertiary">
                    Nenhum convite ativo. Crie um para alguém entrar.
                  </p>
                )}

                {invites.map((invite) => (
                  <SettingsRow
                    key={invite.code}
                    action={
                      <span className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Copiar link do convite ${invite.code}`}
                          onClick={() => {
                            void navigator.clipboard.writeText(
                              `${INVITE_LINK_HOST}/invite/${invite.code}`,
                            );
                            showToast("Link copiado");
                          }}
                        >
                          <Copy size={16} strokeWidth={2} aria-hidden="true" />
                        </Button>
                        {/* Revogar é destrutivo mas reversível na prática:
                            basta criar outro convite (§15). */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => revokeInvite(invite.code)}
                        >
                          Revogar
                        </Button>
                      </span>
                    }
                  >
                    <span className="block truncate font-mono text-body text-text-primary">
                      {invite.code}
                    </span>
                    <span className="block truncate text-meta text-text-tertiary">
                      {findMember(community.id, invite.createdById)
                        ?.displayName ?? "Alguém"}{" "}
                      · {invite.uses}
                      {invite.maxUses ? `/${invite.maxUses}` : ""} usos ·{" "}
                      {invite.expiresAt
                        ? `expira ${formatRelativeTime(invite.expiresAt)}`
                        : "sem expiração"}
                    </span>
                  </SettingsRow>
                ))}

                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  onClick={() => setCreatingInvite(true)}
                >
                  Criar novo convite
                </Button>
              </SettingsSection>
            )}

            <DangerZone>
              {community.isHostedByMe ? (
                <>
                  <p className="text-body text-text-secondary">
                    Você hospeda {community.name} neste dispositivo. Quem é host
                    não sai da própria comunidade — precisa encerrá-la.
                  </p>
                  <Button
                    variant="danger"
                    size="sm"
                    className="self-start"
                    onClick={() => {
                      setEndStep(1);
                      setConfirmingEnd(true);
                    }}
                  >
                    Encerrar comunidade
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-body text-text-secondary">
                    Sair remove {community.name} do seu rail. Para voltar você
                    precisa de um convite novo.
                  </p>
                  <Button
                    variant="danger"
                    size="sm"
                    className="self-start"
                    onClick={() => setConfirmingLeave(true)}
                  >
                    Sair da comunidade
                  </Button>
                </>
              )}
            </DangerZone>
          </>
        )}

        {tab === "roles" && (
          <RolesTab community={community} localMemberId={localMemberId} />
        )}

        {tab === "moderation" && (
          <ModerationTab community={community} localMemberId={localMemberId} />
        )}
      </SettingsLayout>

      {creatingInvite && (
        <Modal
          open
          onClose={() => setCreatingInvite(false)}
          title="Criar convite"
          size="md"
        >
          <div className="flex flex-col gap-4">
            <Select
              label="Expiração"
              value={expiry}
              options={EXPIRY_OPTIONS}
              onChange={setExpiry}
            />
            <Select
              label="Limite de usos"
              value={uses}
              options={USES_OPTIONS}
              onChange={setUses}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setCreatingInvite(false)}
              >
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  const invite = createInvite({
                    communityId: community.id,
                    createdById: localMemberId,
                    expiresInDays: Number(expiry) || undefined,
                    maxUses: Number(uses) || undefined,
                  });
                  setCreatingInvite(false);
                  showToast(`Convite ${invite.code} criado`);
                }}
              >
                Criar convite
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {confirmingLeave && (
        <Modal
          open
          onClose={() => setConfirmingLeave(false)}
          title={`Sair de ${community.name}?`}
          size="sm"
        >
          <div className="flex flex-col gap-4">
            <p className="text-body text-text-secondary">
              Você deixa de receber as mensagens de {community.name} e some da
              lista de membros. Voltar exige um convite novo.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmingLeave(false)}
              >
                Cancelar
              </Button>
              <Button variant="danger" onClick={() => closeAndLeave(false)}>
                Sair da comunidade
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Dupla confirmação: encerrar desconecta todo mundo (§10, 3.1b). */}
      {confirmingEnd && (
        <Modal
          open
          onClose={() => setConfirmingEnd(false)}
          title={`Encerrar ${community.name}?`}
          size="sm"
        >
          <div className="flex flex-col gap-4">
            <p className="text-body text-text-secondary">
              {endStep === 1
                ? "Isso desconecta todos os membros permanentemente. Não pode ser desfeito."
                : `Confirme mais uma vez: ${community.memberCount} ${
                    community.memberCount === 1 ? "pessoa perde" : "pessoas perdem"
                  } o acesso a todo o histórico assim que a comunidade for encerrada.`}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmingEnd(false)}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                onClick={() =>
                  endStep === 1 ? setEndStep(2) : closeAndLeave(true)
                }
              >
                {endStep === 1 ? "Continuar" : "Encerrar para sempre"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
