import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Headphones,
  Palette,
  User,
  Wifi,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { escolhaValida, useDispositivos } from "../../live/dispositivos";
import { motivoDoErroDeCamera } from "../../live/camera";
import { Skeleton } from "../../components/ui/Skeleton";
import { Slider } from "../../components/ui/Slider";
import { TextField } from "../../components/ui/TextField";
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
  NAT_LABEL,
  NOTIFICATION_LABEL,
  useSettingsStore,
  type NotificationLevel,
} from "../../store/settingsStore";
import { usePendingInviteStore } from "../../store/inviteStore";
import { criarDetectorDeVoz } from "../../live/vad";

const TABS = [
  { id: "account", label: "Minha conta", icon: <User size={16} strokeWidth={2} /> },
  { id: "devices", label: "Dispositivos", icon: <Headphones size={16} strokeWidth={2} /> },
  { id: "appearance", label: "Aparência", icon: <Palette size={16} strokeWidth={2} /> },
  { id: "notifications", label: "Notificações", icon: <Bell size={16} strokeWidth={2} /> },
  { id: "network", label: "Rede", icon: <Wifi size={16} strokeWidth={2} /> },
];

const LEVELS: NotificationLevel[] = ["all", "mentions", "none"];

/**
 * §10, 3.1 — medidor de nível ao vivo enquanto o microfone é testado. O nível é REAL:
 * RMS da trilha capturada (Épico 4), não um número inventado — um medidor falso não mede
 * nada e ainda convence a pessoa de que o microfone funciona quando não funciona.
 */
function LevelMeter({ level }: { level: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(level * 100)));
  return (
    <div
      role="meter"
      aria-label="Nível de entrada do microfone"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 w-full overflow-hidden rounded-full bg-border-default"
    >
      <div
        className="h-full rounded-full bg-presence-online transition-all duration-(--duration-fast) ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * §10, 3.1 — a prévia da câmera escolhida, ligada por um gesto e desligada ao sair.
 *
 * É o irmão do "Testar microfone", e faz duas coisas de uma vez: mostra o que a câmera está
 * vendo (a única forma honesta de responder "é esta mesmo?") e **destrava os nomes reais**
 * da lista — sem permissão de vídeo o Chromium devolve `label` vazio, e todas as câmeras da
 * máquina se chamam "Câmera 1", "Câmera 2".
 *
 * A trilha é parada ao fechar: uma tela de configuração não tem por que deixar a luz da
 * câmera acesa, e é a mesma postura de `autorizar` em `live/dispositivos.ts`.
 */
function PreviaDeCamera({ deviceId, onErro }: { deviceId: string; onErro: (m: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let vivo = true;
    let stream: MediaStream | null = null;
    const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (md === undefined) {
      onErro("Esta janela não tem acesso a dispositivos de mídia.");
      return;
    }
    void md
      .getUserMedia({ video: deviceId === "default" ? true : { deviceId: { exact: deviceId } } })
      .then((s) => {
        // Fechar a prévia enquanto a permissão ainda estava aberta: o stream chega depois do
        // desmonte, e sem isto a câmera ficaria ligada sem ninguém olhando.
        if (!vivo) {
          for (const t of s.getTracks()) t.stop();
          return;
        }
        stream = s;
        if (videoRef.current !== null) {
          videoRef.current.srcObject = s;
          void videoRef.current.play().catch(() => undefined);
        }
      })
      .catch((e: unknown) => {
        if (vivo) onErro(motivoDoErroDeCamera(e));
      });
    return () => {
      vivo = false;
      for (const t of stream?.getTracks() ?? []) t.stop();
    };
  }, [deviceId, onErro]);

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- prévia ao vivo da câmera local
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      aria-label="Prévia da câmera escolhida"
      // Espelhada, como em qualquer prévia da própria imagem: quem se olha espera um espelho.
      className="aspect-video w-full scale-x-[-1] rounded-md bg-black object-cover"
    />
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
  const dispositivos = useDispositivos();
  const [testing, setTesting] = useState(false);
  const [nivelMic, setNivelMic] = useState(0);
  const [capturandoTecla, setCapturandoTecla] = useState(false);
  const [previa, setPrevia] = useState(false);
  const [erroDeCamera, setErroDeCamera] = useState<string | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const streamDeTeste = useRef<MediaStream | null>(null);
  const detector = useRef<ReturnType<typeof criarDetectorDeVoz> | null>(null);
  const nivelTimer = useRef<number | undefined>(undefined);

  // O teste REAL: captura o microfone e mede o RMS com o mesmo detector do VAD da
  // chamada. Sai daqui com a trilha parada — tela de configuração não deixa mic aberto.
  useEffect(
    () => () => {
      window.clearInterval(nivelTimer.current);
      detector.current?.encerrar();
      streamDeTeste.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function alternarTeste() {
    if (testing) {
      window.clearInterval(nivelTimer.current);
      detector.current?.encerrar();
      detector.current = null;
      streamDeTeste.current?.getTracks().forEach((t) => t.stop());
      streamDeTeste.current = null;
      setNivelMic(0);
      setTesting(false);
      return;
    }
    await dispositivos.autorizar("microphone");
    const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (md === undefined) return;
    const proc = useSettingsStore.getState().processamentoVoz;
    const stream = await md.getUserMedia({
      audio: {
        echoCancellation: proc,
        noiseSuppression: proc,
        autoGainControl: proc,
      },
    });
    streamDeTeste.current = stream;
    detector.current = criarDetectorDeVoz(stream);
    setTesting(true);
    nivelTimer.current = window.setInterval(() => {
      setNivelMic(detector.current?.nivel() ?? 0);
    }, 100);
  }

  // A captura da tecla do push-to-talk: enquanto ativa, a PRÓXIMA tecla vira o atalho
  // (Esc cancela). O ouvinte vive em useEffect — mutar textContent do botão fora do
  // React era briga perdida com a reconciliação.
  useEffect(() => {
    if (!capturandoTecla) return;
    const capturar = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setCapturandoTecla(false);
      if (e.key !== "Escape") useSettingsStore.getState().setPttTecla(e.key);
    };
    window.addEventListener("keydown", capturar, true);
    return () => window.removeEventListener("keydown", capturar, true);
  }, [capturandoTecla]);

  if (!identity) return null;

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
                value={escolhaValida(settings.microphoneId, dispositivos.microfones)}
                options={dispositivos.microfones}
                onChange={(id) => settings.setDevice("microphone", id)}
                {...(dispositivos.semRotulos("microphone")
                  ? { hint: "Autorize o microfone para ver os nomes dos dispositivos." }
                  : {})}
              />
              <Slider
                label="Volume de entrada"
                value={settings.inputVolume}
                onChange={(value) => settings.setVolume("input", value)}
                valueLabel={`${settings.inputVolume}%`}
              />
              <div className="flex items-center gap-3">
                {/*
                  A permissão é pedida AQUI, não ao abrir a tela: testar o microfone é o
                  gesto que precisa dele, e é o que destrava os nomes reais na lista.
                */}
                <Button variant="secondary" size="sm" onClick={() => void alternarTeste()}>
                  {testing ? "Parar teste" : "Testar microfone"}
                </Button>
                <div className="flex-1">
                  <LevelMeter level={nivelMic} />
                </div>
              </div>
            </SettingsSection>

            <SettingsSection title="Saída">
              <Select
                label="Saída de áudio"
                value={escolhaValida(settings.outputId, dispositivos.saidas)}
                options={dispositivos.saidas}
                onChange={(id) => settings.setDevice("output", id)}
              />
              <Slider
                label="Volume de saída"
                value={settings.outputVolume}
                onChange={(value) => settings.setVolume("output", value)}
                valueLabel={`${settings.outputVolume}%`}
              />
            </SettingsSection>

            {/* Épico 4 — voz, música e push-to-talk: preferências LOCAIS de captura.
                Nada disto atravessa o fio; vale para a próxima chamada (o teste de mic
                aplica na hora). */}
            <SettingsSection title="Voz e música">
              <Toggle
                checked={settings.processamentoVoz}
                onChange={(v) => settings.setProcessamentoVoz(v)}
                label="Processamento de voz (cancelamento de eco e ruído)"
                description="Deixa a conversa limpa, mas o AGC pode abafar a voz no meio da música. Quem canta com o Modo Música costuma desligar."
              />
              <Slider
                label="Sensibilidade da voz"
                value={settings.sensibilidadeVoz}
                onChange={(value) => settings.setSensibilidadeVoz(value)}
                valueLabel={`${settings.sensibilidadeVoz}%`}
              />
              <p className="text-meta text-text-tertiary">
                Quanto o microfone precisa ouvir para acender o anel de fala.
              </p>
              <Toggle
                checked={settings.pttAtivo}
                onChange={(v) => {
                  settings.setPttAtivo(v);
                  // PTT ligado começa mudo: o microfone só abre com a tecla pressionada.
                  if (v) useVoiceStore.getState().aplicarPTT(false);
                }}
                label="Push-to-talk (aperte para falar)"
                description="Em vez de voz aberta, o microfone só fica ligado enquanto a tecla está pressionada."
              />
              {settings.pttAtivo && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setCapturandoTecla(true)}
                  >
                    {capturandoTecla ? "Aperte a tecla… (Esc cancela)" : "Trocar tecla"}
                  </Button>
                  <span className="text-body-emphasis text-text-primary">
                    {settings.pttTecla}
                  </span>
                </div>
              )}
            </SettingsSection>

            <SettingsSection title="Vídeo">
              <Select
                label="Câmera"
                value={escolhaValida(settings.cameraId, dispositivos.cameras)}
                options={dispositivos.cameras}
                onChange={(id) => {
                  settings.setDevice("camera", id);
                  // Trocar de câmera com a prévia aberta reabre a prévia na câmera nova;
                  // o erro da anterior não vale mais para esta.
                  setErroDeCamera(null);
                }}
                {...(dispositivos.semRotulos("camera")
                  ? { hint: "Autorize a câmera para ver os nomes dos dispositivos." }
                  : {})}
              />
              {/*
                A permissão é pedida AQUI, no gesto que precisa dela — mesma regra do
                microfone. É este botão que faz as câmeras terem nome na lista acima.
              */}
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setErroDeCamera(null);
                    setPrevia((v) => !v);
                    if (!previa) void dispositivos.autorizar("camera");
                  }}
                >
                  {previa ? "Parar prévia" : "Testar câmera"}
                </Button>
              </div>
              {previa && (
                <PreviaDeCamera
                  deviceId={escolhaValida(settings.cameraId, dispositivos.cameras)}
                  onErro={setErroDeCamera}
                />
              )}
              {erroDeCamera !== null && (
                <p className="text-meta text-feedback-danger">{erroDeCamera}</p>
              )}
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
