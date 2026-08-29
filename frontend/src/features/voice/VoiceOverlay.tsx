import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  AudioLines,
  Music,
  Monitor,
  MonitorUp,
  Crown,
  PhoneOff,
  Settings,
  Circle,
  SkipForward,
  Square,
  Timer,
  UserMinus,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { Slider } from "../../components/ui/Slider";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { Tooltip } from "../../components/ui/Tooltip";
import { ProfilePopover } from "../members/ProfilePopover";
import { ScreenShareStage } from "./ScreenShareStage";
import { ShareSourceModal } from "./ShareSourceModal";
import { LeaveVoiceConfirm } from "./LeaveVoiceConfirm";
import { useLeaveVoiceGuard } from "./leaveGuard";
import { VoiceTile, VoiceTileSkeleton } from "./VoiceTile";
import { useIsMobile } from "../../lib/useMediaQuery";
import { criarGravadorDeCanal, gravacaoSuportada, type GravadorDeCanal } from "../../live/gravacao";
import { selectCanTransmitIn, selectChannel, selectCommunity, useCommunityStore, useFindMember, useHasPermission } from "../../store/communityStore";
import { useVoiceStore } from "../../store/voiceStore";

interface ControlProps {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  pressed?: boolean;
  tone?: "default" | "warning" | "danger";
  /** Destino que só existe na Camada 3 — visível e inativo (precedente §6). */
  inert?: boolean;
}

/**
 * Botão da barra de controles (§5.7: ícones de 24px nas ações primárias da
 * chamada). Sempre com nome acessível — o ícone sozinho não nomeia nada.
 */
function Control({
  label,
  icon,
  onClick,
  pressed,
  tone = "default",
  inert = false,
}: ControlProps) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        onClick={inert ? undefined : onClick}
        aria-pressed={pressed}
        aria-disabled={inert || undefined}
        className={cn(
          "grid size-11 place-items-center rounded-full",
          "transition-colors duration-(--duration-fast) ease-out",
          tone === "danger"
            ? "bg-feedback-danger text-text-on-accent hover:brightness-110"
            : tone === "warning"
              ? "bg-surface-elevated text-feedback-danger hover:bg-surface-primary"
              : "bg-surface-elevated text-text-secondary hover:bg-surface-primary hover:text-text-primary",
          inert && "cursor-not-allowed text-text-disabled",
        )}
      >
        {icon}
        <span className="sr-only">{label}</span>
      </button>
    </Tooltip>
  );
}

/**
 * 2.3 Canal de voz — grade de participantes, fala ativa, mute/deafen e
 * entrar/sair, com o compartilhamento de tela (2.4) como sub-modo.
 *
 * Abre **por cima** da área de conteúdo, sem trocá-la: entrar em voz não
 * muda o canal de texto que estava aberto (§4, C11). Recolher devolve a
 * barra persistente (2.3.1) sem encerrar a chamada.
 */
export function VoiceOverlay() {
  const findMember = useFindMember();
  const channelId = useVoiceStore((state) => state.channelId);
  const communityId = useVoiceStore((state) => state.communityId);
  const localId = useVoiceStore((state) => state.localId);
  const stage = useVoiceStore((state) => state.stage);
  const motivoDaFalha = useVoiceStore((state) => state.motivoDaFalha);
  const participants = useVoiceStore((state) => state.participants);
  const shares = useVoiceStore((state) => state.shares);
  const retryJoin = useVoiceStore((state) => state.retryJoin);
  const setExpanded = useVoiceStore((state) => state.setExpanded);
  const toggleMute = useVoiceStore((state) => state.toggleMute);
  const toggleDeafen = useVoiceStore((state) => state.toggleDeafen);
  const toggleCamera = useVoiceStore((state) => state.toggleCamera);
  const cameraPendente = useVoiceStore((state) => state.cameraPendente);
  const erroDeCamera = useVoiceStore((state) => state.erroDeCamera);
  const startShare = useVoiceStore((state) => state.startShare);
  const stopShare = useVoiceStore((state) => state.stopShare);
  // §17.5 (emenda de 2026-08-28) — Modo Música e seus controles rápidos (US-03).
  const musicaAtiva = useVoiceStore((state) => state.musicaAtiva);
  const musicaErro = useVoiceStore((state) => state.musicaErro);
  const musicaVolume = useVoiceStore((state) => state.musicaVolume);
  const musicaMutarMic = useVoiceStore((state) => state.musicaMutarMic);
  const toggleMusica = useVoiceStore((state) => state.toggleMusica);
  const definirMusicaVolume = useVoiceStore((state) => state.definirMusicaVolume);
  const definirMusicaMutarMic = useVoiceStore((state) => state.definirMusicaMutarMic);
  // §16.4 (emenda de 2026-08-28) — a fila de karaokê e suas ações.
  const fila = useVoiceStore((state) => state.fila);
  // Épico 4 — gravação local do canal (o que ESTA máquina ouve), sem protocolo nenhum.
  const gravadorRef = useRef<GravadorDeCanal | null>(null);
  const [gravando, setGravando] = useState(false);
  const motivoDaFila = useVoiceStore((state) => state.motivoDaFila);
  const entrarNaFila = useVoiceStore((state) => state.entrarNaFila);
  const sairDaFila = useVoiceStore((state) => state.sairDaFila);
  const moderarFila = useVoiceStore((state) => state.moderarFila);

  const channel = useCommunityStore((state) =>
    channelId ? selectChannel(state, channelId) : undefined,
  );
  const community = useCommunityStore((state) =>
    selectCommunity(state, communityId),
  );
  const activeCommunityId = useCommunityStore(
    (state) => state.activeCommunityId,
  );
  const canShareScreen = useHasPermission(
    communityId ?? "",
    "voice_share_screen",
  );
  // §16.4 — quem comanda a fila é quem modera a voz (decisão da Fatia do modo de fala).
  const podeModerarFila = useHasPermission(
    communityId ?? "",
    "voice_mute_others",
  );
  // §17.4 (emenda de 2026-08-28) — espelho local do gate do modo de fala. É conselho de
  // UI; quem decide é o host, e o roster traz o estado final de volta. No modo fila o
  // titular da fila (§16.4) é quem desmuta — o mesmo estado que a UI exibe.
  const podeTransmitir = useCommunityStore((state) =>
    channelId ? selectCanTransmitIn(state, channelId, fila?.turn?.keyHex ?? null) : true,
  );

  const [profile, setProfile] = useState<{
    identityId: string;
    anchor: DOMRect;
  } | null>(null);
  const [choosingSource, setChoosingSource] = useState(false);
  const guard = useLeaveVoiceGuard();
  const isMobile = useIsMobile();

  if (!channel || !community || !communityId || !localId) return null;

  const local = participants.find((p) => p.identityId === localId);
  const sharing = Boolean(local?.sharingScreen);
  const connecting = stage === "connecting";

  // §9, 2.3 — um peer que não conecta comigo mas conecta com os outros: a
  // chamada segue, e a interface diz de quem se trata em vez de deixar a
  // pessoa parecer calada (§11, B7).
  const unstable = participants.find(
    (p) => p.identityId !== localId && p.connectionToMe !== "ok",
  );
  const unstableName = unstable
    ? (findMember(communityId, unstable.identityId)?.displayName ?? "um peer")
    : null;

  /** Mobile: lista vertical compacta; acima de 4, carrossel horizontal. */
  const carousel = isMobile && participants.length > 4;

  const tiles = connecting
    ? participants.map((participant) => (
        <VoiceTileSkeleton key={participant.identityId} compact={isMobile} />
      ))
    : participants.map((participant) => (
        <VoiceTile
          key={participant.identityId}
          communityId={communityId}
          participant={participant}
          isLocal={participant.identityId === localId}
          compact={isMobile || shares.length > 0}
          onOpenProfile={(identityId, anchor) =>
            setProfile({ identityId, anchor })
          }
        />
      ));

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-surface-primary">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md",
            "text-text-secondary transition-colors duration-(--duration-fast) ease-out",
            "hover:bg-surface-sidebar hover:text-text-primary",
          )}
        >
          {isMobile ? (
            <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
          ) : (
            <ChevronDown size={20} strokeWidth={2} aria-hidden="true" />
          )}
          <span className="sr-only">Recolher chamada</span>
        </button>

        <Volume2
          size={20}
          strokeWidth={2}
          aria-hidden="true"
          className="shrink-0 text-text-tertiary"
        />
        <h2 className="min-w-0 truncate text-heading-3 text-text-primary">
          {channel.name}
        </h2>
        {/* Só quando a chamada é de outra comunidade — na própria seria
            informação redundante (mesma regra de 2.3.1). */}
        {communityId !== activeCommunityId && (
          <span className="min-w-0 truncate text-meta text-text-tertiary">
            · {community.name}
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {/*
          Os banners da chamada moram aqui, dentro da área de conteúdo, e não
          colados no cabeçalho: é o mesmo lugar de onde o compartilhamento
          anuncia "Reorganizando transmissão…" (§9, 2.4). Full-bleed sob o
          header, eles não alinhavam com nada — a grade e o palco começam
          recuados — e liam como parte do chrome em vez de estado da chamada.
        */}
        {stage === "failed" && (
          <StatusBanner tone="failed" inset>
            {motivoDaFalha ?? "Não foi possível conectar à chamada de voz"}
            <Button
              variant="ghost"
              size="sm"
              className="ml-1 h-6 px-1.5"
              onClick={retryJoin}
            >
              Tentar novamente
            </Button>
          </StatusBanner>
        )}

        {/*
          §15.5 `voice.deviceError`/`RT-10` — a câmera que o sistema negou tem motivo, e ele
          muda o que fazer: autorizar, escolher outra, ou fechar o outro aplicativo. Uma
          frase genérica mandaria procurar defeito no lugar errado.
        */}
        {erroDeCamera !== null && (
          <StatusBanner tone="failed" inset>
            {erroDeCamera}
          </StatusBanner>
        )}

        {stage === "connected" && unstableName && (
          <StatusBanner tone="degraded" inset>
            Conexão instável com {unstableName}
          </StatusBanner>
        )}

        {/*
          Mesmo lugar e mesma linguagem dos outros dois estados da chamada. Solto como
          parágrafo, "Conectando…" era o único que não se parecia com um estado: sem
          ponto de cor, sem fundo, sem o movimento que §5.4 pede de transitório — lia
          como legenda perdida acima da grade, e não como a chamada dizendo em que pé
          está. `reconnecting` é o tom de "transitório e ativo", que é exatamente isto.
        */}
        {connecting && (
          <StatusBanner tone="reconnecting" inset>
            Conectando…
          </StatusBanner>
        )}

        {/*
          §17.5 (2026-08-26) — o canal aceita **várias** transmissões ao mesmo tempo. Uma
          ocupa o palco inteiro; a partir de duas viram grade, que é o que a UX original
          pedia em §18 e que o teto de "exatamente 1 por canal" tinha cortado.

          O teto de duas colunas é deliberado: cada palco tem controles próprios e uma
          terceira coluna os espremeria abaixo do alvo de toque. Com 3+ a grade rola.
        */}
        {shares.length > 0 && communityId && (
          <div
            className={cn(
              "flex min-h-0 flex-1 gap-2",
              shares.length === 1
                ? "flex-col"
                : "flex-col overflow-y-auto tablet:grid tablet:auto-rows-fr tablet:grid-cols-2 tablet:overflow-y-auto",
            )}
          >
            {shares.map((s) => (
              <ScreenShareStage
                key={s.sessionId === "" ? `propria:${s.presenterId}` : s.sessionId}
                communityId={communityId}
                share={s}
                isPresenter={s.presenterId === localId}
              />
            ))}
          </div>
        )}

        <ul
          className={cn(
            shares.length > 0
              ? // Tira de miniaturas ao lado do compartilhamento (§9, 2.4).
                "flex shrink-0 gap-2 overflow-x-auto"
              : carousel
                ? "flex gap-2 overflow-x-auto"
                : "flex flex-col gap-2 tablet:grid tablet:grid-cols-2 desktop:grid-cols-3",
          )}
        >
          {tiles}
        </ul>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-border-subtle p-3">
        <Control
          label={
            !podeTransmitir
              ? channel.speechMode === "queue"
                ? "Aguardando sua vez na fila (karaokê)"
                : "O modo de fala deste canal não libera seu microfone"
              : local?.muted
                ? "Ativar microfone"
                : "Silenciar microfone"
          }
          pressed={local?.muted}
          tone={local?.muted ? "warning" : "default"}
          inert={!podeTransmitir}
          onClick={toggleMute}
          icon={
            local?.muted ? (
              <MicOff size={24} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Mic size={24} strokeWidth={2} aria-hidden="true" />
            )
          }
        />
        <Control
          label={local?.deafened ? "Reativar áudio" : "Ensurdecer"}
          pressed={local?.deafened}
          tone={local?.deafened ? "warning" : "default"}
          onClick={toggleDeafen}
          icon={
            local?.deafened ? (
              <HeadphoneOff size={24} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Headphones size={24} strokeWidth={2} aria-hidden="true" />
            )
          }
        />
        {/*
          §90 — não há mais teto de câmeras. O botão deixou de ter estado inativo
          "muitas câmeras nesta chamada": não existe número a partir do qual o host
          recuse, e desenhar um portão que o núcleo não aplica seria a interface
          inventando regra.
        */}
        <Control
          label={
            cameraPendente
              ? "Ligando câmera…"
              : local?.cameraOn
                ? "Desligar câmera"
                : "Ligar câmera"
          }
          pressed={local?.cameraOn}
          // Entre o gesto e a imagem está o diálogo de permissão do sistema, que demora o
          // que a pessoa levar para responder. Um segundo clique aí abriria uma segunda
          // captura; e anunciar a câmera antes de haver imagem é a decoração de §85.2.
          inert={cameraPendente}
          onClick={toggleCamera}
          icon={
            local?.cameraOn ? (
              <Video size={24} strokeWidth={2} aria-hidden="true" />
            ) : (
              <VideoOff size={24} strokeWidth={2} aria-hidden="true" />
            )
          }
        />
        {/*
          §17.5 (emenda de 2026-08-28) — Modo Música: um clique, captura do áudio do
          sistema. Disponível em qualquer modo de fala — quem transmite é sempre o gate
          de §17.4, e cortar a música junto com a voz é exatamente o que a imposição deve
          fazer.
        */}
        <Control
          label={musicaAtiva ? "Desligar Modo Música" : "Modo Música (áudio do computador)"}
          pressed={musicaAtiva}
          onClick={() => void toggleMusica()}
          icon={
            musicaAtiva ? (
              <AudioLines size={24} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Music size={24} strokeWidth={2} aria-hidden="true" />
            )
          }
        />
        {canShareScreen && (
          <Control
            label={sharing ? "Parar compartilhamento" : "Compartilhar tela"}
            pressed={sharing}
            onClick={() => (sharing ? stopShare() : setChoosingSource(true))}
            icon={
              sharing ? (
                <Monitor size={24} strokeWidth={2} aria-hidden="true" />
              ) : (
                <MonitorUp size={24} strokeWidth={2} aria-hidden="true" />
              )
            }
          />
        )}
        <Control
          label="Configurações de dispositivo"
          inert
          icon={<Settings size={24} strokeWidth={2} aria-hidden="true" />}
        />
        {gravacaoSuportada() && (
          <Control
            label={gravando ? "Parar gravação (baixa o arquivo)" : "Gravar o áudio do canal (local)"}
            pressed={gravando}
            tone={gravando ? "warning" : "default"}
            onClick={() => {
              const store = useVoiceStore.getState();
              if (gravando) {
                void gravadorRef.current?.parar().then((blob) => {
                  setGravando(false);
                  if (blob === null) return;
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `comunidade-${channel.name}-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.webm`;
                  a.click();
                  URL.revokeObjectURL(url);
                });
                return;
              }
              const fluxos = store.consultarFluxos();
              if (fluxos === null || fluxos.length === 0) return;
              gravadorRef.current ??= criarGravadorDeCanal();
              gravadorRef.current?.iniciar(fluxos);
              setGravando(gravadorRef.current?.gravando === true);
            }}
            icon={
              gravando ? (
                <Square size={22} strokeWidth={2} aria-hidden="true" />
              ) : (
                <Circle size={22} strokeWidth={2} aria-hidden="true" />
              )
            }
          />
        )}
        <Control
          label="Sair da chamada"
          tone="danger"
          onClick={guard.requestLeave}
          icon={<PhoneOff size={24} strokeWidth={2} aria-hidden="true" />}
        />
      </div>

      {/* §16.4 (emenda de 2026-08-28) — a fila de karaokê, só em canal do modo fila. */}
      {channel.speechMode === "queue" && (
        <FilaKaraokê
          fila={fila}
          motivo={motivoDaFila}
          communityId={communityId}
          localId={localId}
          podeModerar={podeModerarFila}
          entrarNaFila={() => void entrarNaFila()}
          sairDaFila={() => void sairDaFila()}
          moderar={moderarFila}
          findMember={findMember}
        />
      )}

      {/*
        §17.5 (US-03) — controles rápidos do Modo Música, só enquanto ativo: volume da
        música e a escolha de mutar o microfone junto (US-02). O erro da ativação também
        mora aqui: quem clicou precisa do porquê, no mesmo lugar do botão.
      */}
      {(musicaAtiva || musicaErro !== null) && (
        <div className="shrink-0 border-t border-border-subtle p-3">
          {musicaErro !== null ? (
            <p role="alert" className="text-meta text-feedback-danger">
              {musicaErro}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-meta text-text-secondary">
                  <Music size={14} strokeWidth={2} aria-hidden="true" />
                  Tocando música
                </span>
                <span className="flex-1" />
                <Checkbox
                  checked={musicaMutarMic}
                  onChange={definirMusicaMutarMic}
                  label="Microfone mudo enquanto toca"
                />
              </div>
              <Slider
                label="Volume da música"
                value={musicaVolume}
                onChange={definirMusicaVolume}
                valueLabel={`${musicaVolume}%`}
              />
            </div>
          )}
        </div>
      )}

      {profile && (
        <ProfilePopover
          communityId={communityId}
          identityId={profile.identityId}
          anchor={profile.anchor}
          onClose={() => setProfile(null)}
          inCall
        />
      )}

      {choosingSource && (
        <ShareSourceModal
          onClose={() => setChoosingSource(false)}
          onSelect={({ kind, quality, sourceId, audio }) => {
            setChoosingSource(false);
            startShare({ kind, quality, sourceId, audio });
          }}
        />
      )}

      <LeaveVoiceConfirm guard={guard} />
    </div>
  );
}

/* ─── §16.4 (emenda de 2026-08-28) — a fila de karaokê ──────────────────────────────── */

interface FilaEstadoUI {
  channelId: string;
  open: boolean;
  items: Array<{ keyHex: string; queuedAt: number }>;
  turn: { keyHex: string; endsAt: number } | null;
}

interface FilaKaraokêProps {
  fila: FilaEstadoUI | null;
  motivo: string | null;
  communityId: string;
  localId: string;
  podeModerar: boolean;
  entrarNaFila: () => void;
  sairDaFila: () => void;
  moderar: (a: { action: "promote" | "skip" | "remove" | "addTime" | "open" | "close"; targetKey?: string; seconds?: number }) => Promise<void>;
  findMember: (communityId: string, identityId: string) => { displayName: string } | undefined;
}

/** Relógio de 1 s para a contagem do turno — a UI não decide nada, só desenha. */
function useAgora(): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  return agora;
}

/**
 * Ação de lista da fila — o mesmo corpo do botão de sair do painel da chamada (2.3.1):
 * 44px de alvo de toque no Mobile, 32px onde há ponteiro, e sempre Tooltip, porque o
 * ícone sozinho não nomeia nada (§5.4). Os tons seguem os de §6: aviso para pular a vez
 * de alguém, perigo para tirar da fila.
 */
function AcaoDeFila({
  label,
  onClick,
  tone = "default",
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: "default" | "warning" | "danger";
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} side="top">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-md tablet:size-8",
          "transition-colors duration-(--duration-fast) ease-out",
          tone === "danger"
            ? "text-feedback-danger hover:bg-feedback-danger/15"
            : tone === "warning"
              ? "text-feedback-warning hover:bg-surface-primary hover:text-text-primary"
              : "text-text-secondary hover:bg-surface-primary hover:text-text-primary",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function FilaKaraokê({
  fila,
  motivo,
  communityId,
  localId,
  podeModerar,
  entrarNaFila,
  sairDaFila,
  moderar,
  findMember,
}: FilaKaraokêProps) {
  const agora = useAgora();
  const nomeDe = (keyHex: string): string =>
    findMember(communityId, keyHex)?.displayName ?? keyHex.slice(0, 8);

  const euNaFila = fila?.items.findIndex((i) => i.keyHex === localId) ?? -1;
  const souTitular = fila?.turn?.keyHex === localId;
  const segundosRestantes =
    fila?.turn === null || fila?.turn === undefined
      ? null
      : Math.max(0, Math.ceil((fila.turn.endsAt - agora) / 1000));

  return (
    <div className="shrink-0 border-t border-border-subtle p-3">
      {/* Cabeçalho: o rótulo segue o padrão de campo (caption caixa-alta) e o estado de
          fila fechada é pill no tom de aviso, lavado a 15% como o StatusBanner de §5.4. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-text-secondary uppercase">Fila (karaokê)</span>
        {!fila?.open && (
          <span className="rounded-full bg-feedback-warning/15 px-1.5 py-px text-caption uppercase text-feedback-warning">
            fila fechada
          </span>
        )}
        <span className="flex-1" />
        {souTitular ? (
          <span className="text-meta text-feedback-warning">É a sua vez — o palco é seu!</span>
        ) : euNaFila >= 0 ? (
          <span className="text-meta text-text-secondary">Você é o nº {euNaFila + 1} da fila</span>
        ) : (
          // §15 — fila fechada não é permissão, é estado: o botão some e a pill acima
          // diz o porquê. Botão visível e morto seria decorativa.
          fila?.open && (
            <Button variant="secondary" size="sm" onClick={entrarNaFila}>
              Entrar na fila
            </Button>
          )
        )}
        {(souTitular || euNaFila >= 0) && (
          <Button variant="ghost" size="sm" onClick={sairDaFila}>
            Sair da fila
          </Button>
        )}
      </div>

      {motivo !== null && (
        <p role="alert" className="mt-1 text-meta text-feedback-danger">
          {motivo}
        </p>
      )}

      {/* O palco: quem tem a vez, com contagem regressiva em tabular-nums (números que
          não dançam a cada segundo) e os controles do moderador. */}
      {fila?.turn != null && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border-default bg-surface-elevated p-2">
          <span className="min-w-0 truncate text-body-emphasis text-text-primary">
            {nomeDe(fila.turn.keyHex)}
          </span>
          <span className="text-meta text-text-tertiary">
            {fila.turn.keyHex === localId ? "cantando agora" : "no palco"}
          </span>
          {segundosRestantes !== null && (
            <span className="text-meta tabular-nums text-text-secondary">
              {Math.floor(segundosRestantes / 60)}:{String(segundosRestantes % 60).padStart(2, "0")}
            </span>
          )}
          <span className="flex-1" />
          {podeModerar && (
            <>
              <AcaoDeFila
                label="A plateia gostou: somar 1 minuto ao turno"
                onClick={() => void moderar({ action: "addTime", seconds: 60 })}
              >
                <Timer size={16} strokeWidth={2} aria-hidden="true" />
              </AcaoDeFila>
              <AcaoDeFila
                label="Pular a vez de quem está no palco"
                tone="warning"
                onClick={() => void moderar({ action: "skip" })}
              >
                <SkipForward size={16} strokeWidth={2} aria-hidden="true" />
              </AcaoDeFila>
            </>
          )}
        </div>
      )}

      {/* A fila de espera, na ordem — a lista segue o padrão de participantes da sidebar
          (§8, 1.1): um por linha, truncado, o meu destacado. */}
      {fila !== null && fila.items.length > 0 && (
        <ol className="mt-2 flex flex-col">
          {fila.items.map((item, i) => (
            <li
              key={item.keyHex}
              className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-primary"
            >
              <span className="w-5 text-right text-meta tabular-nums text-text-tertiary">
                {i + 1}.
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-meta",
                  item.keyHex === localId ? "text-text-primary" : "text-text-secondary",
                )}
              >
                {nomeDe(item.keyHex)}
              </span>
              {podeModerar && (
                <>
                  <AcaoDeFila
                    label={`Dar a vez a ${nomeDe(item.keyHex)}`}
                    onClick={() => void moderar({ action: "promote", targetKey: item.keyHex })}
                  >
                    <Crown size={16} strokeWidth={2} aria-hidden="true" />
                  </AcaoDeFila>
                  <AcaoDeFila
                    label={`Tirar ${nomeDe(item.keyHex)} da fila`}
                    tone="danger"
                    onClick={() => void moderar({ action: "remove", targetKey: item.keyHex })}
                  >
                    <UserMinus size={16} strokeWidth={2} aria-hidden="true" />
                  </AcaoDeFila>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
