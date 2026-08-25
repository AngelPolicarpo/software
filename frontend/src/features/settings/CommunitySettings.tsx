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
import { formatRelativeTime } from "../../lib/format";
import { INVITE_LINK_HOST } from "../../mocks/dataset";
import { api } from "../../ipc/api";
import { mensagemDeErro } from "../../live/sessao";
import {
  sincronizarComunidade,
  sincronizarComunidades,
  sincronizarConvites,
} from "../../live/sincronizacao";
import { codigoDoErro } from "../../ipc/frames";
import { useFindMember, useHasPermission, useInvites } from "../../store/communityStore";
import { useToastStore } from "../../store/toastStore";
import { useHostStatus } from "../../store/connectionStore";
import { motivoDaRecusa, OFFLINE_HINT } from "../../live/recusas";
import { useVoiceStore } from "../../store/voiceStore";
import type { Community, Invite } from "../../domain/types";

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
  onClose: () => void;
}

/**
 * 3.1b Configurações da comunidade — metadados, convites e zona de perigo,
 * mais as abas de cargos (3.2) e moderação (3.3).
 *
 * A aba de moderação só existe para quem tem `view_audit_log`: §15 manda
 * esconder o que a permissão não autoriza, nunca mostrar desabilitado.
 */
export function CommunitySettings({ community, onClose }: CommunitySettingsProps) {
  const findMember = useFindMember();
  const canViewAudit = useHasPermission(community.id, "view_audit_log");
  const canManageRoles = useHasPermission(community.id, "manage_roles");
  const canInvite = useHasPermission(community.id, "create_invite");

  const [tab, setTab] = useState("general");
  const hostStatus = useHostStatus(community);
  const semHost = hostStatus !== "online";
  const invites = useInvites(community.id);
  const showToast = useToastStore((state) => state.showToast);
  const leaveVoice = useVoiceStore((state) => state.leave);
  const voiceCommunityId = useVoiceStore((state) => state.communityId);

  const [creatingInvite, setCreatingInvite] = useState(false);
  const [criandoConvite, setCriandoConvite] = useState(false);
  const [revogando, setRevogando] = useState<string | null>(null);
  const [expiry, setExpiry] = useState("0");
  const [uses, setUses] = useState("0");
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [endStep, setEndStep] = useState(1);

  /**
   * U-23 — o formulário da comunidade também tinha auto-save; `community.update` é op ⏱ de
   * §15.4 e vale o mesmo `F-12` dos cargos e dos canais. Rascunho + botão.
   */
  const [rascunho, setRascunho] = useState<{ name: string; description: string } | null>(null);
  const draft = rascunho ?? { name: community.name, description: community.description ?? "" };
  const sujo =
    draft.name !== community.name || draft.description !== (community.description ?? "");
  const [salvando, setSalvando] = useState(false);
  const [recusa, setRecusa] = useState<string | null>(null);

  async function salvarIdentidade() {
    if (salvando || !sujo) return;
    setSalvando(true);
    setRecusa(null);
    try {
      await api.communityUpdate({
        communityId: community.id,
        ...(draft.name !== community.name ? { name: draft.name.trim() } : {}),
        ...(draft.description !== (community.description ?? "")
          ? { description: draft.description.trim() }
          : {}),
      });
      await sincronizarComunidade(community.id);
      setRascunho(null);
      showToast("Alterações salvas", "success");
    } catch (e) {
      setRecusa(motivoDaRecusa(codigoDoErro(e)));
    } finally {
      setSalvando(false);
    }
  }

  /**
   * §15.4 `invite.create` — confirma-depois-desenha (U-02): nada de convite
   * otimista. O `code` só existe NESTA resposta (nunca no log nem em
   * evento), então o toast é a única vez que ele aparece pronto para copiar.
   */
  async function criarConvite() {
    if (criandoConvite) return;
    setCriandoConvite(true);
    try {
      const dias = Number(expiry);
      const limite = Number(uses);
      const r = await api.inviteCreate({
        communityId: community.id,
        ...(dias > 0 ? { expiresInDays: dias } : {}),
        ...(limite > 0 ? { maxUses: limite } : {}),
      });
      setCreatingInvite(false);
      showToast(`Convite ${r.code} criado`);
      await sincronizarConvites(community.id);
    } catch (e) {
      showToast(mensagemDeErro(e), "error");
    } finally {
      setCriandoConvite(false);
    }
  }

  /**
   * §15.4 `invite.revoke` — a lista de §15.6 só dá o código de quem criou
   * aqui (delta U-04), então quem revoga por um código precisa do
   * `invitePublicKey`, que é o identificador estável da linha.
   */
  async function revogarConvite(invite: Invite) {
    if (revogando !== null) return;
    setRevogando(invite.code);
    try {
      const lista = await api.invites(community.id);
      const alvo = lista.items.find(
        (i) => i.code === invite.code || i.invitePublicKey === invite.code,
      );
      if (alvo === undefined) {
        showToast("Este convite não existe mais", "error");
        await sincronizarConvites(community.id);
        return;
      }
      await api.inviteRevoke({ communityId: community.id, invitePublicKey: alvo.invitePublicKey });
      await sincronizarConvites(community.id);
    } catch (e) {
      showToast(mensagemDeErro(e), "error");
    } finally {
      setRevogando(null);
    }
  }

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

  /**
   * Sair e encerrar são coisas diferentes no fio. `community.leave` tem **efeito local
   * imediato** e enfileira o `member.leave` (§15.4, L-22) — é a exceção de §11.1, e é o que
   * sustenta U-29: dá para sair com o host offline. `community.end` é main-confirmed e só o
   * host corrente pode; o `reqConfirmado` cuida do diálogo nativo.
   */
  async function closeAndLeave(end: boolean) {
    if (salvando) return;
    setSalvando(true);
    setRecusa(null);
    try {
      if (end) await api.communityEnd({ communityId: community.id });
      else await api.communityLeave(community.id);
      // Sair da comunidade que hospeda a chamada encerra a chamada junto.
      if (voiceCommunityId === community.id) leaveVoice();
      await sincronizarComunidades();
      onClose();
    } catch (e) {
      setRecusa(motivoDaRecusa(codigoDoErro(e)));
    } finally {
      setSalvando(false);
    }
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
                value={draft.name}
                onChange={(name) => setRascunho({ ...draft, name })}
                maxLength={40}
                showCounter
                counterWarningAt={36}
                error={
                  draft.name.trim().length < 2
                    ? "O nome precisa de pelo menos 2 caracteres"
                    : undefined
                }
              />
              <TextArea
                label="Descrição"
                value={draft.description}
                onChange={(description) => setRascunho({ ...draft, description })}
                maxLength={120}
                showCounter
                rows={3}
              />

              {recusa !== null && (
                <p role="alert" className="rounded-md border border-feedback-danger/40 bg-surface-primary p-3 text-meta text-feedback-danger">
                  {recusa}
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => void salvarIdentidade()}
                  loading={salvando}
                  disabled={!sujo || semHost || draft.name.trim().length < 2}
                  title={semHost ? OFFLINE_HINT : undefined}
                >
                  Salvar alterações
                </Button>
                {sujo && (
                  <Button variant="ghost" size="sm" onClick={() => setRascunho(null)} disabled={salvando}>
                    Descartar
                  </Button>
                )}
              </div>
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
                          loading={revogando === invite.code}
                          disabled={revogando !== null && revogando !== invite.code}
                          onClick={() => void revogarConvite(invite)}
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
          <RolesTab community={community} />
        )}

        {tab === "moderation" && (
          <ModerationTab community={community} />
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
                loading={criandoConvite}
                onClick={() => void criarConvite()}
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
            {/* U-29 — texto obrigatório: a saída é local na hora, o aviso é assíncrono. */}
            {semHost && (
              <p className="rounded-md border border-border-default bg-surface-sidebar p-3 text-meta text-text-tertiary">
                Você vai sair agora neste computador. Como quem hospeda está
                offline, as outras pessoas só vão ver sua saída quando ela voltar.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmingLeave(false)}
              >
                Cancelar
              </Button>
              <Button variant="danger" loading={salvando} onClick={() => void closeAndLeave(false)}>
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
                  endStep === 1 ? setEndStep(2) : void closeAndLeave(true)
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
