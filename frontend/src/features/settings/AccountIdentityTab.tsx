import { useState } from "react";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { TextField } from "../../components/ui/TextField";
import { DangerZone, SettingsSection } from "./SettingsLayout";
import { nextAvatarColor } from "../../lib/avatar";
import { useIdentityStore } from "../../store/identityStore";
import { useCommunityStore } from "../../store/communityStore";
import { useMessageStore } from "../../store/messageStore";
import { useVoiceStore } from "../../store/voiceStore";
import { usePendingInviteStore } from "../../store/inviteStore";
import type { Identity, PresenceStatus } from "../../domain/types";

/**
 * §10, 3.1 — identidade local e a zona de perigo.
 *
 * "Sair desta identidade" diz o que ninguém pode desfazer: sem conta central,
 * não existe recuperação (§1, princípio 1).
 */
export function AccountIdentityTab({ identity }: { identity: Identity }) {
  const updateIdentity = useIdentityStore((state) => state.updateIdentity);
  const clearIdentity = useIdentityStore((state) => state.clearIdentity);
  const setPresence = useIdentityStore((state) => state.setPresence);
  const resetCommunities = useCommunityStore((state) => state.resetCommunities);
  const resetMessages = useMessageStore((state) => state.reset);
  const leaveVoice = useVoiceStore((state) => state.leave);
  const clearPendingInvite = usePendingInviteStore(
    (state) => state.clearPendingInvite,
  );

  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  function signOut() {
    leaveVoice();
    resetCommunities();
    resetMessages();
    clearPendingInvite();
    clearIdentity();
  }

  return (
    <>
      <SettingsSection title="Identidade">
        <div className="flex items-center gap-4">
          <Avatar
            name={identity.displayName}
            color={identity.avatarColor}
            size="lg"
            presence={identity.presence}
            presenceRingClass="border-surface-elevated"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              updateIdentity({
                avatarColor: nextAvatarColor(identity.avatarColor),
              })
            }
          >
            Gerar outra cor
          </Button>
        </div>

        <TextField
          label="Nome de exibição"
          value={identity.displayName}
          onChange={(value) => updateIdentity({ displayName: value })}
          maxLength={32}
          showCounter
          counterWarningAt={28}
        />

        {/*
          §5.4 define quatro estados de presença, com dot e cor; até
          aqui não havia onde escolher um. Este é o caminho principal;
          o popover do próprio perfil (§8, 1.4) é o atalho.
        */}
        <Select
          label="Presença"
          value={identity.presence}
          onChange={(value) => setPresence(value as PresenceStatus)}
          hint={
            identity.presence === "invisible"
              ? "Você aparece como offline, mas continua recebendo tudo normalmente."
              : undefined
          }
          options={[
            { value: "online", label: "Online" },
            { value: "idle", label: "Ausente" },
            { value: "dnd", label: "Ocupado" },
            { value: "invisible", label: "Invisível" },
          ]}
        />

        <div>
          <p className="text-caption text-text-tertiary uppercase">
            Identificador local
          </p>
          <p className="mt-1 font-mono text-body text-text-secondary">
            {identity.handle} ·{" "}
            {identity.publicKey.slice(0, 8)}…{identity.publicKey.slice(-4)}
          </p>
          <p className="mt-1 text-meta text-text-tertiary">
            Esta chave existe só neste dispositivo. Ninguém, em lugar
            nenhum, tem uma cópia dela.
          </p>
        </div>
      </SettingsSection>

      <DangerZone>
        <p className="text-body text-text-secondary">
          Apagar a identidade remove o par de chaves deste dispositivo.
          Como não existe conta central, não há como recuperá-la — nem
          voltar às comunidades em que você entrou com ela.
        </p>
        <Button
          variant="danger"
          size="sm"
          onClick={() => setConfirmingSignOut(true)}
          className="self-start"
        >
          Sair desta identidade
        </Button>
      </DangerZone>

      {confirmingSignOut && (
        <Modal
          open
          onClose={() => setConfirmingSignOut(false)}
          title="Sair desta identidade?"
          size="sm"
        >
          <div className="flex flex-col gap-4">
            <p className="text-body text-text-secondary">
              A identidade {identity.displayName} será apagada deste
              dispositivo. Não há conta central e não existe recuperação — você
              precisaria de um convite novo para voltar a qualquer comunidade.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmingSignOut(false)}
              >
                Cancelar
              </Button>
              <Button variant="danger" onClick={signOut}>
                Apagar identidade
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
