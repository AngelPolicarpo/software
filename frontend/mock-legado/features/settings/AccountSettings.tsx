import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Headphones,
  Palette,
  User,
  Wifi,
} from "lucide-react";
import { cn } from "../../../src/lib/cn";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../../src/components/ui/Button";
import { Select } from "../../components/ui/Select";
import { Skeleton } from "../../components/ui/Skeleton";
import { Slider } from "../../components/ui/Slider";
import { TextField } from "../../../src/components/ui/TextField";
import { Toggle } from "../../components/ui/Toggle";
import { Modal } from "../../components/ui/Modal";
import { DangerZone, SettingsLayout, SettingsSection } from "./SettingsLayout";
import { nextAvatarColor } from "../../lib/avatar";
import { useIdentityStore } from "../../store/identityStore";
import type { PresenceStatus } from "../../domain/types";
import { useCommunityStore, useJoinedCommunities } from "../../store/communityStore";
import { useMessageStore } from "../../store/messageStore";
import { useVoiceStore } from "../../store/voiceStore";
import {
  MOCK_CAMERAS,
  MOCK_MICROPHONES,
  MOCK_OUTPUTS,
  NAT_LABEL,
  NOTIFICATION_LABEL,
  useSettingsStore,
  type NotificationLevel,
} from "../../store/settingsStore";
import { usePendingInviteStore } from "../../store/inviteStore";

const TABS = [
  { id: "account", label: "Minha conta", icon: <User size={16} strokeWidth={2} /> },
  { id: "devices", label: "Dispositivos", icon: <Headphones size={16} strokeWidth={2} /> },
  { id: "appearance", label: "Aparência", icon: <Palette size={16} strokeWidth={2} /> },
  { id: "notifications", label: "Notificações", icon: <Bell size={16} strokeWidth={2} /> },
  { id: "network", label: "Rede", icon: <Wifi size={16} strokeWidth={2} /> },
];

const LEVELS: NotificationLevel[] = ["all", "mentions", "none"];

/** §10, 3.1 — medidor de nível ao vivo enquanto o microfone é testado. */
function LevelMeter({ active }: { active: boolean }) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    const timer = window.setInterval(
      () => setLevel(20 + Math.random() * 80),
      120,
    );
    return () => window.clearInterval(timer);
  }, [active]);

  return (
    <div
      role="meter"
      aria-label="Nível de entrada do microfone"
      aria-valuenow={Math.round(level)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-border-default"
    >
      <div
        className="h-full rounded-full bg-presence-online transition-all duration-(--duration-fast) ease-out"
        style={{ width: `${level}%` }}
      />
    </div>
  );
}

export interface AccountSettingsProps {
  onClose: () => void;
}

/**
 * 3.1 Configurações de conta — identidade local, dispositivos, aparência,
 * notificações e diagnóstico de rede, independente de comunidade ativa.
 *
 * "Sair desta identidade" fica na zona de perigo e diz o que ninguém pode
 * desfazer: sem conta central, não existe recuperação (§1, princípio 1).
 */
export function AccountSettings({ onClose }: AccountSettingsProps) {
  const [tab, setTab] = useState("account");
  const identity = useIdentityStore((state) => state.identity);
  const updateIdentity = useIdentityStore((state) => state.updateIdentity);
  const clearIdentity = useIdentityStore((state) => state.clearIdentity);
  const setPresence = useIdentityStore((state) => state.setPresence);
  const resetCommunities = useCommunityStore((state) => state.resetCommunities);
  const resetMessages = useMessageStore((state) => state.reset);
  const leaveVoice = useVoiceStore((state) => state.leave);
  const clearPendingInvite = usePendingInviteStore(
    (state) => state.clearPendingInvite,
  );
  const communities = useJoinedCommunities();

  const settings = useSettingsStore();
  const [testing, setTesting] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const testTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(testTimer.current), []);

  if (!identity) return null;

  function startTest() {
    setTesting(true);
    window.clearTimeout(testTimer.current);
    testTimer.current = window.setTimeout(() => setTesting(false), 3000);
  }

  function signOut() {
    leaveVoice();
    resetCommunities();
    resetMessages();
    clearPendingInvite();
    clearIdentity();
  }

  return (
    <>
      <SettingsLayout
        title="Configurações"
        items={TABS}
        activeId={tab}
        onSelect={setTab}
        onClose={onClose}
      >
        {tab === "account" && (
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
          </>
        )}

        {tab === "devices" && (
          <>
            <SettingsSection title="Entrada">
              <Select
                label="Microfone"
                value={settings.microphoneId}
                options={MOCK_MICROPHONES}
                onChange={(id) => settings.setDevice("microphone", id)}
              />
              <Slider
                label="Volume de entrada"
                value={settings.inputVolume}
                onChange={(value) => settings.setVolume("input", value)}
                valueLabel={`${settings.inputVolume}%`}
              />
              <div className="flex items-center gap-3">
                <Button variant="secondary" size="sm" onClick={startTest}>
                  {testing ? "Testando…" : "Testar microfone"}
                </Button>
                <div className="flex-1">
                  <LevelMeter active={testing} />
                </div>
              </div>
            </SettingsSection>

            <SettingsSection title="Saída">
              <Select
                label="Saída de áudio"
                value={settings.outputId}
                options={MOCK_OUTPUTS}
                onChange={(id) => settings.setDevice("output", id)}
              />
              <Slider
                label="Volume de saída"
                value={settings.outputVolume}
                onChange={(value) => settings.setVolume("output", value)}
                valueLabel={`${settings.outputVolume}%`}
              />
            </SettingsSection>

            <SettingsSection title="Vídeo">
              <Select
                label="Câmera"
                value={settings.cameraId}
                options={MOCK_CAMERAS}
                onChange={(id) => settings.setDevice("camera", id)}
                hint="O mock não captura mídia: a lista é ilustrativa."
              />
            </SettingsSection>
          </>
        )}

        {tab === "appearance" && (
          <SettingsSection title="Tema">
            {/* §10, 3.1: informativo, sem toggle que não faz nada. */}
            <p className="text-body text-text-primary">
              Tema escuro (único disponível nesta versão)
            </p>
            <p className="text-meta text-text-tertiary">
              A hierarquia visual vem de superfícies por elevação, não de
              sombra — um tema claro exigiria repensar essa escala inteira.
            </p>
          </SettingsSection>
        )}

        {tab === "notifications" && (
          <>
            <SettingsSection title="Geral">
              <Toggle
                checked={settings.notificationsEnabled}
                onChange={settings.setNotificationsEnabled}
                label="Notificações"
                description="Desligar aqui silencia todas as comunidades."
              />
            </SettingsSection>

            <SettingsSection
              title="Por comunidade"
              description="Notificação nativa do sistema fica fora desta versão."
            >
              {communities.map((community) => {
                const level =
                  settings.notificationByCommunity[community.id] ?? "all";
                return (
                  <div
                    key={community.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="min-w-0 truncate text-body text-text-primary">
                      {community.name}
                    </span>
                    <div className="flex shrink-0 gap-1">
                      {LEVELS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          aria-pressed={level === option}
                          disabled={!settings.notificationsEnabled}
                          onClick={() =>
                            settings.setCommunityNotification(
                              community.id,
                              option,
                            )
                          }
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-meta",
                            "transition-colors duration-(--duration-fast) ease-out",
                            level === option
                              ? "border-accent-default bg-accent-muted-bg text-accent-default"
                              : "border-border-default text-text-secondary hover:text-text-primary",
                            !settings.notificationsEnabled &&
                              "cursor-not-allowed opacity-50",
                          )}
                        >
                          {NOTIFICATION_LABEL[option]}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </SettingsSection>
          </>
        )}

        {tab === "network" && (
          <SettingsSection
            title="Diagnóstico"
            description="Somente leitura — é o que este dispositivo consegue medir sobre a própria conexão."
          >
            {settings.diagnosticRunning ? (
              <>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </>
            ) : (
              <>
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      settings.natType === "cgnat"
                        ? "bg-conn-degraded"
                        : "bg-conn-ok",
                    )}
                    aria-hidden="true"
                  />
                  <p className="text-body text-text-primary">
                    {NAT_LABEL[settings.natType]}
                  </p>
                </div>
                <p className="text-body text-text-secondary">
                  {settings.connectedPeers} peers conectados agora
                </p>
              </>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={settings.runDiagnostic}
              loading={settings.diagnosticRunning}
              className="self-start"
            >
              Executar diagnóstico novamente
            </Button>
          </SettingsSection>
        )}
      </SettingsLayout>

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
