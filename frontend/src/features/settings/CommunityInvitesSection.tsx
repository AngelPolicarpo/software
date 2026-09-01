import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { SettingsRow, SettingsSection } from "./SettingsLayout";
import { formatRelativeTime } from "../../lib/format";
import { INVITE_LINK_HOST } from "../../mocks/dataset";
import { api } from "../../ipc/api";
import { mensagemDeErro } from "../../live/sessao";
import { sincronizarConvites } from "../../live/sincronizacao";
import { useFindMember, useInvites } from "../../store/communityStore";
import { useToastStore } from "../../store/toastStore";
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

/**
 * Convites da comunidade (§10, 3.1b) — a única porta de entrada; não existe
 * diretório público.
 */
export function CommunityInvitesSection({ community }: { community: Community }) {
  const findMember = useFindMember();
  const invites = useInvites(community.id);
  const showToast = useToastStore((state) => state.showToast);

  const [creatingInvite, setCreatingInvite] = useState(false);
  const [criandoConvite, setCriandoConvite] = useState(false);
  const [revogando, setRevogando] = useState<string | null>(null);
  const [expiry, setExpiry] = useState("0");
  const [uses, setUses] = useState("0");

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

  return (
    <>
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
              {findMember(community.id, invite.createdById)?.displayName ??
                "Alguém"}{" "}
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
              <Button variant="secondary" onClick={() => setCreatingInvite(false)}>
                Cancelar
              </Button>
              <Button loading={criandoConvite} onClick={() => void criarConvite()}>
                Criar convite
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
