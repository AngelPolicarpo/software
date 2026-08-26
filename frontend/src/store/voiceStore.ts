import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import type {
  Channel,
  MeshStatus,
  ScreenShareSession,
  VoiceParticipant,
} from "../domain/types";
import { type ShareViewerHealthDto } from "../ipc/api";

/**
 * Sessão de voz e compartilhamento de tela (§9, 2.3 / 2.3.1 / 2.4 · fluxos
 * B5, B6, B7 e C11).
 *
 * A chamada é **independente da navegação** (§4, C11): mora aqui e não na
 * comunidade/canal ativos, por isso sobrevive à troca de canal e até de
 * comunidade. Só existe uma sessão por vez — entrar em outro canal de voz
 * substitui a anterior, como no gênero.
 *
 * Nada disto é persistido, exceto a resposta ao consentimento de repasse
 * (§9, 2.4.1: "Lembrar minha escolha para esta comunidade"): estado de
 * conexão é sempre do agora.
 */


/* ─── Tipos ──────────────────────────────────────────────────────── */

export type VoiceStage = "connecting" | "connected" | "failed";

/** O que o store precisa da malha — nada de WebRTC atravessa esta fronteira. */
export interface PortaDeMalha {
  entrar: (a: { communityId: string; channelId: string; localId: string }) => Promise<void>;
  sair: () => Promise<void>;
  /** §15.4 `voice.setSelf` — mudo/ensurdecido/câmera vão ao host, que publica no roster. */
  mudarSelf: (patch: { muted?: boolean; deafened?: boolean; cameraOn?: boolean }) => void;
  /**
   * §17.4 L-12 — o efeito REAL das três decisões locais de áudio. `mudarSelf` conta ao host
   * e acende o ícone dos outros; nada disso interrompe som. Quem interrompe é isto:
   * `definirMudo` desliga a trilha do microfone, `definirSurdo` e `definirVolume` mexem na
   * saída de cada par. Sem essa metade, mudo e ensurdecer eram decoração.
   */
  definirMudo: (mudo: boolean) => void;
  definirSurdo: (surdo: boolean) => void;
  definirVolume: (peerHex: string, volume: number) => void;
}

let portaDeMalha: PortaDeMalha | null = null;

/**
 * §17.5 — iniciando · ativo · falha. `optimizing` era a transição estrela→árvore que A20
 * revogou (B26): sem árvore, não há distribuição a otimizar e o banner mentiria.
 */
export type SharePhase = "starting" | "live" | "failed";

export type ShareQuality = ScreenShareSession["quality"];

export interface ActiveShare extends ScreenShareSession {
  /**
   * §17.5 — a chave da sessão. Passou a ser obrigatória quando o canal deixou de ter no
   * máximo uma transmissão (2026-08-26): com várias vivas ao mesmo tempo, "a sessão" não
   * identifica mais nada. Vazio enquanto a MINHA está em `starting` — o host ainda não
   * respondeu com o id, e quem a identifica nesse intervalo é `presenterId`.
   */
  sessionId: string;
  phase: SharePhase;
  /**
   * §17.5 — quem assiste ocultou o vídeo **desta** transmissão. É por sessão porque a
   * decisão é por sessão: com duas telas no canal, esconder uma não diz nada sobre a outra.
   * Exibição local; a `RTCPeerConnection` continua de pé e o apresentador não é afetado.
   */
  oculto: boolean;
  /** O que está sendo transmitido, como a fonte real se chama (`track.label`). */
  sourceLabel: string;
  /** `share.failed` (§15.5) — por que a transmissão não subiu. */
  motivoDaFalha: string | null;
  /**
   * §17.5 — saúde por espectador, **só no apresentador**. Vem de `share.health`, que o
   * núcleo consolida a partir do que este renderer mediu (`share.report`).
   */
  saude: ShareViewerHealthDto[];
}

/**
 * §17.7 — o pedido de consentimento de **relay voluntário**. Diferente da árvore, isto NÃO
 * foi revogado: é v2, e §15.5 declara `relay.consentRequested{communityId, reason}`. Fica
 * dormente até o relay existir (B27/B30) — o que mudou nesta fatia é o gatilho, que era a
 * transição estrela→árvore e não existe mais.
 */
export interface ConsentRequest {
  communityId: string;
  reason: string;
}

/** O que o store precisa da estrela de tela — nada de WebRTC atravessa esta fronteira. */
export interface PortaDeTelaStore {
  apresentar: (a: {
    communityId: string;
    channelId: string;
    localId: string;
    quality: ShareQuality;
    kind: "screen" | "window";
  }) => Promise<{ sessionId: string; sourceLabel: string }>;
  parar: () => Promise<void>;
  /** Papel **apresentador** (§15.4, emenda de 2026-08-26): o teto de banda da transmissão. */
  definirQualidade: (sessionId: string, quality: ShareQuality) => Promise<boolean>;
  /** §17.5 emendado — resolução e taxa de quadros da captura; local, sem host. */
  definirCaptura: (a: PerfilDeCaptura) => Promise<PerfilDeCaptura>;
  perfilDeCaptura: () => PerfilDeCaptura;
}

/**
 * §17.5 — o que a captura do apresentador está entregando. `null` é "como a fonte
 * entregar": ausência de restrição, que é o padrão e não um valor.
 */
export interface PerfilDeCaptura {
  height: number | null;
  frameRate: number | null;
}

interface VoiceState {
  channelId: string | null;
  communityId: string | null;
  /** Quem a identidade local é dentro desta comunidade (§8, 1.3). */
  localId: string | null;
  stage: VoiceStage;
  /** §17.3/§9 (2.3) — por que a chamada não fechou. `conn-failed` é estado desenhado. */
  motivoDaFalha: string | null;
  /** Inclui a identidade local — §18: sozinha, a grade mostra o tile dela. */
  participants: VoiceParticipant[];
  /** Grade expandida (2.3) vs. só a barra persistente (2.3.1). */
  expanded: boolean;
  /**
   * §17.5 — as transmissões vivas do canal, na ordem em que começaram. **Lista desde
   * 2026-08-26**: `E_ALREADY_SHARING` por canal era `RT-06`, uma contradição entre
   * documentos resolvida a favor do que já estava escrito, e não uma restrição de
   * arquitetura — a trilha de tela pega carona na conexão de voz que já existe entre cada
   * par, então um segundo apresentador não abre malha nova.
   */
  shares: ActiveShare[];
  /** `sessionId` da sessão de tela viva — a chave de todo comando de §15.4. */
  shareSessionId: string | null;
  /**
   * §17.5 — o perfil de captura do APRESENTADOR, como a fonte o está entregando. Espelho de
   * `getSettings()` da trilha, nunca do que foi pedido: entre pedir e conseguir há a fonte.
   * Um por instalação, porque a captura de tela de uma instalação é uma só.
   */
  capturaDaTela: PerfilDeCaptura;
  /** §17.7 — dormente até o relay voluntário existir; a decisão persistida já vale. */
  consentRequest: ConsentRequest | null;
  relayDecisionByCommunity: Record<string, boolean>;
  /** Volume individual por participante, 0-100 (§9, 2.3 · §8, 1.4). */
  volumeById: Record<string, number>;

  /**
   * §17.2 — a malha real, injetada por `live/sincronizacao.ts`. O store continua dono do
   * ESTADO que a tela lê; quem fala WebRTC é `live/voz.ts`. Sem porta (teste de componente,
   * Storybook), `join` só desenha o estado — não é simulação, é ausência declarada.
   */
  configurarVoz: (porta: PortaDeMalha | null) => void;
  /** `voice.roster` — o host publicou a lista. É ela que manda, não o palpite local. */
  aplicarRoster: (participantes: ReadonlyArray<{ keyHex: string; muted?: boolean; deafened?: boolean; speaking?: boolean; cameraOn?: boolean; sharing?: boolean }>) => void;
  /** Estado da conexão com UM par (§9, 2.3 — a falha é assimétrica e nomeada). */
  aplicarEstadoDoPar: (peerHex: string, estado: "ok" | "degraded" | "failed") => void;
  /**
   * `voice.revoked` para mim ou `voice.failed`: a chamada acabou por decisão do host
   * (§17.4). O motivo é **opcional** porque os dois eventos do MESMO encerramento chegam
   * separados e sem ordem garantida (§16.3 regra 1) — quem tem o motivo o entrega, quem
   * não tem preserva o que já foi entregue.
   */
  encerradaPeloHost: (motivo?: string) => void;
  /** A malha desistiu: prazo vencido sem par conectado, com o motivo já traduzido. */
  falhouAoConectar: (motivo: string) => void;
  join: (channel: Channel, localId: string) => void;
  retryJoin: () => void;
  leave: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleCamera: () => void;
  setExpanded: (expanded: boolean) => void;
  setVolume: (identityId: string, volume: number) => void;
  /** Silenciar outro participante — exige `voice_mute_others` (§10, 3.2). */
  setParticipantMuted: (identityId: string, muted: boolean) => void;

  /** §17.2/§17.5 — a estrela real, injetada por `live/sincronizacao.ts`. */
  configurarTela: (porta: PortaDeTelaStore | null) => void;
  startShare: (a?: { quality?: ShareQuality; kind?: "screen" | "window" }) => void;
  stopShare: () => void;
  /** §15.4 papel apresentador — o teto de banda com que a MINHA tela sai (§17.5). */
  setQuality: (quality: ShareQuality) => void;
  /** §17.5 — resolução e taxa de quadros da captura. Só quem apresenta, e sem host. */
  definirCaptura: (a: Partial<PerfilDeCaptura>) => void;
  /** §17.5 — quem assiste liga e desliga a EXIBIÇÃO local de UMA tela, nunca a transmissão. */
  alternarVideoRecebido: (sessionId: string) => void;
  retryShare: () => void;

  /** `share.started` (§15.5) — alguém começou a apresentar neste canal. */
  telaComecou: (a: { sessionId: string; presenterKey: string; channelId: string }) => void;
  /** `share.stopped` (§15.5) — a sessão acabou, por quem apresenta ou por moderação. */
  telaParou: (sessionId: string) => void;
  /** `share.viewersChanged` (§15.5) — a audiência mudou de tamanho. */
  telaMudouEspectadores: (a: { sessionId: string; viewerCount: number }) => void;
  /** `share.health` (§15.5) — só ao apresentador. */
  telaMediuSaude: (viewers: readonly ShareViewerHealthDto[]) => void;
  /** `share.failed` (§15.5) — a transmissão não subiu, com o motivo nomeado. */
  telaFalhou: (motivo: string) => void;

  /** §15.4 `relay.respondConsent` — a decisão de §17.7, com "lembrar nesta comunidade". */
  respondConsent: (accept: boolean, remember: boolean) => void;

  /* Afinadores de §19.1 — sem rede real, nada disto acontece sozinho. */
  devSetPeerMesh: (identityId: string, status: MeshStatus) => void;
  devFailJoin: () => void;
}

/* ─── Porta da tela ──────────────────────────────────────────────── */

/**
 * A árvore de distribuição que morava aqui (`buildRelays`, `relayCandidates`,
 * `retopologize`, `EXTRA_VIEWER_IDS`) saiu inteira: A20 adiou o multicast em árvore para
 * fora do v1 e §17.5 fixou a estrela. Junto saíram os temporizadores que simulavam preparo,
 * otimização e reparo — não há o que simular quando existe rede de verdade (B26).
 */
let portaDeTela: PortaDeTelaStore | null = null;

/* ─── Store ──────────────────────────────────────────────────────── */

const CAPTURA_LIVRE: PerfilDeCaptura = { height: null, frameRate: null };

/**
 * A transmissão que ESTA instalação apresenta, se houver. Com várias vivas no canal
 * (§17.5, 2026-08-26), "a minha" é a que tem a minha chave — não a única que existe.
 */
function minhaTela(shares: readonly ActiveShare[], localId: string | null): ActiveShare | undefined {
  if (localId === null) return undefined;
  const eu = localId.toLowerCase();
  return shares.find((s) => s.presenterId.toLowerCase() === eu);
}

/** Substitui UMA transmissão da lista, deixando as outras intactas. */
function comTela(
  shares: readonly ActiveShare[],
  sessionId: string,
  patch: (s: ActiveShare) => ActiveShare,
): ActiveShare[] {
  return shares.map((s) => (s.sessionId === sessionId ? patch(s) : s));
}

const IDLE = {
  channelId: null,
  communityId: null,
  localId: null,
  stage: "connecting" as VoiceStage,
  motivoDaFalha: null as string | null,
  participants: [] as VoiceParticipant[],
  expanded: false,
  shares: [] as ActiveShare[],
  shareSessionId: null,
  capturaDaTela: CAPTURA_LIVRE,
  consentRequest: null,
};

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set, get) => ({
      ...IDLE,
      relayDecisionByCommunity: {},
      volumeById: {},

      join: (channel, localId) => {

        const others = (channel.voiceParticipantIds ?? []).filter(
          (id) => id !== localId,
        );
        const participants: VoiceParticipant[] = [
          ...others.map((identityId) => ({
            identityId,
            speaking: false,
            muted: false,
            deafened: false,
            cameraOn: false,
            sharingScreen: false,
            connectionToMe: "ok" as MeshStatus,
          })),
          {
            identityId: localId,
            speaking: false,
            muted: false,
            deafened: false,
            cameraOn: false,
            sharingScreen: false,
            connectionToMe: "ok",
          },
        ];

        set({
          channelId: channel.id,
          communityId: channel.communityId,
          localId,
          stage: "connecting",
          motivoDaFalha: null,
          participants,
          // Entrar mostra a grade (§9, 2.3) — por cima do conteúdo, que
          // continua o canal de texto que estava aberto (§4).
          expanded: true,
          shares: [],
          shareSessionId: null,
          capturaDaTela: CAPTURA_LIVRE,
          consentRequest: null,
        });

        // Sem porta não há chamada: o estado fica em `connecting` e é honesto sobre isso.
        // Com porta, quem tira de `connecting` é o par conectando de verdade.
        void portaDeMalha
          ?.entrar({ communityId: channel.communityId, channelId: channel.id, localId })
          .catch(() => set({ stage: "failed" }));
      },

      retryJoin: () => {
        const { channelId, communityId, localId } = get();
        if (channelId === null || communityId === null || localId === null) return;
        set({ stage: "connecting", motivoDaFalha: null });
        void portaDeMalha
          ?.entrar({ communityId, channelId, localId })
          .catch(() => set({ stage: "failed" }));
      },

      leave: () => {
        void portaDeMalha?.sair().catch(() => undefined);
        set({ ...IDLE });
      },

      configurarVoz: (porta) => {
        portaDeMalha = porta;
      },

      aplicarRoster: (participantes) =>
        set((state) => {
          const local = state.localId;
          // Sozinho na chamada é um estado NORMAL e **terminal**, não uma etapa a caminho
          // de outro: não há par com quem conectar, e é por isso que a malha nem arma o
          // prazo de L-11 nesse caso ("entrar sozinho num canal de voz é normal —
          // espera-se alguém", `live/voz.ts`). A tela discordava do núcleo e ficava em
          // "Conectando…" para sempre, porque quem tirava de `connecting` era o par
          // conectando de verdade e não havia par nenhum. É a mentira que §80 tirou da
          // conexão, reaparecida por outra causa.
          //
          // O custo não era só a frase errada: `connecting` também mantinha o PRÓPRIO tile
          // como esqueleto. Quem entrava primeiro — o caso mais comum de todos — nunca se
          // via na grade da chamada em que já estava.
          //
          // Roster VAZIO não entra aqui: isso não é "sozinho", é "sem chamada" — é o que
          // sobra depois de `encerradaPeloHost`, e ressuscitá-lo apagaria o motivo que
          // aquele caminho existe para preservar.
          const sozinho = participantes.length === 1 && participantes[0]?.keyHex === local;
          return {
            stage:
              sozinho && (state.stage === "connecting" || state.stage === "failed")
                ? ("connected" as VoiceStage)
                : state.stage,
            // Ficar sozinho porque o outro saiu apaga o "não foi possível conectar": não
            // há mais com quem falhar, e o banner com "Tentar novamente" ofereceria uma
            // retentativa contra ninguém.
            motivoDaFalha: sozinho && state.stage === "failed" ? null : state.motivoDaFalha,
            participants: participantes.map((p) => {
              const anterior = state.participants.find((x) => x.identityId === p.keyHex);
              return {
                identityId: p.keyHex,
                speaking: p.speaking ?? false,
                muted: p.muted ?? false,
                deafened: p.deafened ?? false,
                cameraOn: p.cameraOn ?? false,
                sharingScreen: p.sharing ?? false,
                // O roster é do host e não sabe como ESTA máquina enxerga cada par: o
                // estado da conexão é local e sobrevive à republicação da lista.
                connectionToMe:
                  p.keyHex === local ? ("ok" as MeshStatus) : (anterior?.connectionToMe ?? ("ok" as MeshStatus)),
              };
            }),
          };
        }),

      aplicarEstadoDoPar: (peerHex, estado) =>
        set((state) => ({
          // Um par conectado já basta para a chamada estar de pé; a falha de outro é
          // assimétrica e aparece no tile dele, não na chamada inteira (§9, 2.3).
          //
          // `failed` também volta: o prazo de L-11 é um veredito sobre o que se sabia aos
          // 20 s, não uma sentença. Quando a negociação repetida de §17.4 fecha depois
          // disso, a chamada está de pé — e deixar a tela dizendo que falhou enquanto o
          // áudio já toca é a mesma mentira de "Conectando…" para sempre, ao contrário.
          stage:
            estado === "ok" && (state.stage === "connecting" || state.stage === "failed")
              ? "connected"
              : state.stage,
          // O motivo da falha não sobrevive à recuperação: o banner sairia com a chamada viva.
          motivoDaFalha:
            estado === "ok" && state.stage === "failed" ? null : state.motivoDaFalha,
          participants: state.participants.map((p) =>
            p.identityId === peerHex ? { ...p, connectionToMe: estado } : p,
          ),
        })),

      falhouAoConectar: (motivo) => set({ stage: "failed", motivoDaFalha: motivo }),

      encerradaPeloHost: (motivo) =>
        set((state) => {
          const razao = motivo ?? state.motivoDaFalha;
          // Sem motivo é o encerramento limpo de sempre: a chamada some da tela.
          if (razao === null || razao === undefined) return { ...IDLE };
          // Com motivo, a chamada acaba mas o overlay **fica**: o banner de `stage:"failed"`
          // é a única superfície que carrega o "por quê" (§9, 2.3), e ela vive dentro dele.
          // Zerar tudo faria o usuário ver a chamada evaporar sem explicação — que é o
          // defeito que este caminho existe para corrigir.
          return {
            ...IDLE,
            channelId: state.channelId,
            communityId: state.communityId,
            localId: state.localId,
            expanded: state.expanded,
            stage: "failed" as VoiceStage,
            motivoDaFalha: razao,
          };
        }),

      /**
       * §17.4 L-12 — silenciar a si mesmo é **efetivo**, não conselho. São três coisas, e
       * antes só a primeira acontecia: contar ao host (que acende o ícone dos outros),
       * desligar a trilha do microfone, e refletir no estado local.
       *
       * O estado muda ANTES dos efeitos: quem aplica a saída de áudio lê o store, e lê-lo
       * antes do `set` devolveria o valor velho.
       */
      toggleMute: () => {
        const eu = get().participants.find((p) => p.identityId === get().localId);
        const mudo = !(eu?.muted ?? false);
        const saiDoSurdo = !mudo && eu?.deafened === true;

        set((state) => ({
          participants: state.participants.map((p) =>
            p.identityId === state.localId
              ? // Desmutar com o áudio ensurdecido não faz sentido: sair do
                // mudo também tira do ensurdecido (convenção do gênero).
                {
                  ...p,
                  muted: mudo,
                  deafened: mudo ? p.deafened : false,
                  speaking: false,
                }
              : p,
          ),
        }));

        portaDeMalha?.mudarSelf({ muted: mudo, ...(saiDoSurdo ? { deafened: false } : {}) });
        // O mudo de verdade: sem esta linha a trilha continuava transmitindo e o ícone do
        // outro lado mentia.
        portaDeMalha?.definirMudo(mudo);
        if (saiDoSurdo) portaDeMalha?.definirSurdo(false);
      },

      /**
       * Ensurdecer é enforcement **local** nas duas direções: cala a saída de cada par e,
       * por convenção do gênero, também o próprio microfone. Antes nenhuma das duas
       * acontecia — só o ícone e o roster mudavam.
       */
      toggleDeafen: () => {
        const eu = get().participants.find((p) => p.identityId === get().localId);
        const surdo = !(eu?.deafened ?? false);

        set((state) => ({
          participants: state.participants.map((p) =>
            p.identityId === state.localId
              ? {
                  ...p,
                  deafened: surdo,
                  // Ensurdecer implica mudo; desensurdecer devolve a voz.
                  muted: surdo,
                  speaking: false,
                }
              : p,
          ),
        }));

        portaDeMalha?.mudarSelf({ deafened: surdo, muted: surdo });
        portaDeMalha?.definirMudo(surdo);
        portaDeMalha?.definirSurdo(surdo);
      },

      toggleCamera: () =>
        set((state) => ({
          participants: state.participants.map((p) =>
            p.identityId === state.localId ? { ...p, cameraOn: !p.cameraOn } : p,
          ),
        })),

      setExpanded: (expanded) => set({ expanded }),

      setVolume: (identityId, volume) => {
        set((state) => ({
          volumeById: { ...state.volumeById, [identityId]: volume },
        }));
        // O estado primeiro, o efeito depois: quem aplica lê o volume corrente do store.
        portaDeMalha?.definirVolume(identityId, volume);
      },

      setParticipantMuted: (identityId, muted) =>
        set((state) => ({
          participants: state.participants.map((p) =>
            p.identityId === identityId
              ? { ...p, muted, speaking: muted ? false : p.speaking }
              : p,
          ),
        })),

      configurarTela: (porta) => {
        portaDeTela = porta;
      },

      /**
       * §17.5 — começar a apresentar. A ordem de `T-41` mora na estrela (`live/tela.ts`):
       * o host decide, o núcleo cunha o `captureToken`, o main o verifica, e só então a
       * tela é capturada. Aqui só o estado que a UI lê.
       *
       * `starting` é honesto: a sessão existe no host e a captura ainda não voltou. Quem a
       * tira de `starting` é a captura de verdade, não um temporizador.
       */
      startShare: (a) => {
        const state = get();
        if (!state.channelId || !state.communityId || !state.localId) return;
        // §17.5, 2026-08-26 — o canal aceita várias transmissões; o que não se repete é a
        // MINHA, porque a captura de tela desta instalação é uma só (`E_ALREADY_SHARING`).
        if (minhaTela(state.shares, state.localId) !== undefined) return;
        const quality = a?.quality ?? "balanced";

        set({
          shares: [
            ...state.shares,
            {
              // O id só existe depois que o host responde; até lá quem identifica a minha
              // é a minha chave (`minhaTela`).
              sessionId: "",
              presenterId: state.localId,
              channelId: state.channelId,
              viewerCount: 0,
              quality,
              phase: "starting",
              sourceLabel: "",
              motivoDaFalha: null,
              saude: [],
              oculto: false,
            },
          ],
          expanded: true,
        });

        void portaDeTela
          ?.apresentar({
            communityId: state.communityId,
            channelId: state.channelId,
            localId: state.localId,
            quality,
            kind: a?.kind ?? "screen",
          })
          .then(({ sessionId, sourceLabel }) => {
            set((s) => {
              const minha = minhaTela(s.shares, s.localId);
              if (minha === undefined) return {};
              return {
                shareSessionId: sessionId,
                shares: comTela(s.shares, minha.sessionId, (t) => ({
                  ...t,
                  sessionId,
                  phase: "live" as SharePhase,
                  sourceLabel,
                })),
                // §17.5 — o que a fonte escolheu entregar, antes de qualquer restrição
                // nossa. É o ponto de partida que os controles de captura mostram.
                capturaDaTela: portaDeTela?.perfilDeCaptura() ?? CAPTURA_LIVRE,
                participants: s.participants.map((p) =>
                  p.identityId === s.localId ? { ...p, sharingScreen: true } : p,
                ),
              };
            });
          })
          .catch((e: unknown) => {
            // Cancelar o seletor do sistema é `NotAllowedError` e NÃO é falha: a pessoa
            // desistiu. Mostrar "falha ao transmitir" para uma desistência seria mentira.
            const nome = (e as { name?: string })?.name;
            if (nome === "NotAllowedError" || nome === "AbortError") {
              set((s) => ({
                shares: s.shares.filter((t) => minhaTela([t], s.localId) === undefined),
                shareSessionId: null,
              }));
              return;
            }
            get().telaFalhou("Não foi possível iniciar a transmissão de tela.");
          });
      },

      stopShare: () => {
        void portaDeTela?.parar().catch(() => undefined);
        set((state) => ({
          // Só a minha sai; a tela de quem mais estiver apresentando continua.
          shares: state.shares.filter((s) => minhaTela([s], state.localId) === undefined),
          shareSessionId: null,
          capturaDaTela: CAPTURA_LIVRE,
          participants: state.participants.map((p) =>
            p.identityId === state.localId ? { ...p, sharingScreen: false } : p,
          ),
        }));
      },

      /**
       * §15.4 papel **apresentador** (emenda de 2026-08-26): o teto de banda com que a
       * MINHA tela sai. Antes o comando era do espectador, e isso punha a conta no bolso
       * alheio — 8 espectadores pedindo `high` são 20 Mbps de subida na máquina de quem
       * transmite, que não tinha como recusar.
       *
       * O estado local só muda quando o host aceita: anunciar "Baixa" e continuar
       * transmitindo em alta seria o `F-08` de volta, agora do outro lado. Espectador que
       * chame isto é recusado no host com `E_PERMISSION_DENIED` e não vê nada mudar.
       */
      setQuality: (quality) => {
        const { shareSessionId, shares, localId } = get();
        // Só existe perfil a definir na transmissão que EU apresento (§17.5).
        if (shareSessionId === null || minhaTela(shares, localId) === undefined) return;
        void portaDeTela
          ?.definirQualidade(shareSessionId, quality)
          .then((applied) => {
            if (applied) set((s) => ({ shares: comTela(s.shares, shareSessionId, (t) => ({ ...t, quality })) }));
          })
          .catch(() => undefined);
      },

      /**
       * §17.5 — resolução e taxa de quadros da CAPTURA. Não passa pelo host e não tem RPC:
       * é `applyConstraints` sobre a trilha desta máquina, do mesmo jeito que `track.enabled`
       * é o mudo efetivo de §17.4 L-12. Quem possui o dispositivo decide o que sai dele.
       *
       * O que volta para o estado é o que a trilha ficou entregando (`getSettings`), não o
       * que foi pedido — uma fonte pode aproximar ou ignorar a restrição, e mostrar "720p"
       * porque foi o que pedimos seria inventar medida.
       */
      definirCaptura: (patch) => {
        const { shares, localId, capturaDaTela } = get();
        if (minhaTela(shares, localId) === undefined) return;
        const pedido: PerfilDeCaptura = {
          height: patch.height === undefined ? capturaDaTela.height : patch.height,
          frameRate: patch.frameRate === undefined ? capturaDaTela.frameRate : patch.frameRate,
        };
        void portaDeTela
          ?.definirCaptura(pedido)
          .then((efetivo) => set({ capturaDaTela: efetivo }))
          .catch(() => undefined);
      },

      /**
       * §17.5 — o único controle de quem ASSISTE. Ocultar é exibição local: não fala com o
       * host, não mexe na `RTCPeerConnection` e não chega ao apresentador. A trilha continua
       * chegando; o que para é o `<video>` desta máquina.
       *
       * Deliberadamente **não** é `share.setQuality` para `low` nem `share.leave`: os dois
       * teriam efeito sobre a transmissão de outra pessoa, e este botão é sobre a tela de
       * quem o aperta.
       */
      alternarVideoRecebido: (sessionId) =>
        set((state) => ({
          shares: comTela(state.shares, sessionId, (s) => ({ ...s, oculto: !s.oculto })),
        })),

      retryShare: () => {
        const minha = minhaTela(get().shares, get().localId);
        if (minha === undefined) return;
        get().stopShare();
        get().startShare({ quality: minha.quality });
      },

      telaComecou: ({ sessionId, presenterKey, channelId }) =>
        set((state) => {
          if (state.channelId !== channelId) return {};
          const eu = state.localId?.toLowerCase();
          const apresentador = presenterKey.toLowerCase();
          // O próprio `share.started` volta para quem começou: o estado dele já está de pé
          // e sobrescrevê-lo apagaria o `sourceLabel` que só esta máquina conhece. O que
          // falta é o id, que só o host sabe.
          if (eu !== undefined && apresentador === eu) {
            return {
              shareSessionId: sessionId,
              shares: state.shares.map((s) =>
                s.presenterId.toLowerCase() === eu ? { ...s, sessionId } : s,
              ),
            };
          }
          // Reentrega do mesmo `share.started` (§16.3 é at-most-once, mas nada proíbe
          // repetir) não pode duplicar a transmissão na lista.
          if (state.shares.some((s) => s.sessionId === sessionId)) return {};
          return {
            shares: [
              ...state.shares,
              {
                sessionId,
                presenterId: presenterKey,
                channelId,
                viewerCount: 0,
                quality: "balanced" as ShareQuality,
                phase: "starting" as SharePhase,
                sourceLabel: "",
                motivoDaFalha: null,
                saude: [],
                oculto: false,
              },
            ],
            participants: state.participants.map((p) =>
              p.identityId.toLowerCase() === apresentador ? { ...p, sharingScreen: true } : p,
            ),
            expanded: true,
          };
        }),

      telaParou: (sessionId) => {
        const state = get();
        const encerrada = state.shares.find((s) => s.sessionId === sessionId);
        if (encerrada === undefined) return;
        const eraMinha = state.shareSessionId === sessionId;
        // **A sessão pode ter sido encerrada pelo HOST** — ban, kick, canal apagado, sweep
        // (§17.5/§18.1). Se eu era quem apresentava, limpar só o estado deixaria a captura
        // viva: a luz de "compartilhando tela" do sistema continuaria acesa, transmitindo
        // para uma sessão que não existe mais. Quem para a captura é a estrela.
        if (eraMinha) void portaDeTela?.parar().catch(() => undefined);
        const restantes = state.shares.filter((s) => s.sessionId !== sessionId);
        const apresentador = encerrada.presenterId.toLowerCase();
        set({
          shares: restantes,
          // Só o que era meu é limpo; a tela de outra pessoa segue viva com o estado dela.
          ...(eraMinha ? { shareSessionId: null, capturaDaTela: CAPTURA_LIVRE } : {}),
          // O ícone do tile é de quem apresenta: só apaga se ELE não estiver mais em
          // nenhuma das transmissões restantes.
          participants: state.participants.map((p) =>
            p.identityId.toLowerCase() === apresentador &&
            !restantes.some((s) => s.presenterId.toLowerCase() === apresentador)
              ? { ...p, sharingScreen: false }
              : p,
          ),
        });
      },

      telaMudouEspectadores: ({ sessionId, viewerCount }) =>
        set((state) => ({ shares: comTela(state.shares, sessionId, (s) => ({ ...s, viewerCount })) })),

      // `share.health` é só ao apresentador (RT-08): a saúde é sempre da MINHA transmissão.
      telaMediuSaude: (viewers) =>
        set((state) => {
          const minha = minhaTela(state.shares, state.localId);
          if (minha === undefined) return {};
          return { shares: comTela(state.shares, minha.sessionId, (s) => ({ ...s, saude: [...viewers] })) };
        }),

      telaFalhou: (motivo) =>
        set((state) => {
          const minha = minhaTela(state.shares, state.localId);
          if (minha === undefined) return {};
          return {
            shares: comTela(state.shares, minha.sessionId, (s) => ({
              ...s,
              phase: "failed" as SharePhase,
              motivoDaFalha: motivo,
            })),
          };
        }),

      respondConsent: (accept, remember) =>
        set((state) => {
          const communityId = state.consentRequest?.communityId ?? state.communityId;
          if (communityId === null) return { consentRequest: null };
          return {
            consentRequest: null,
            relayDecisionByCommunity: remember
              ? { ...state.relayDecisionByCommunity, [communityId]: accept }
              : state.relayDecisionByCommunity,
          };
        }),

      /* ─── Afinadores de desenvolvimento (§19.1) ─────────────────── */

      devSetPeerMesh: (identityId, status) =>
        set((state) => ({
          participants: state.participants.map((p) =>
            p.identityId === identityId
              ? { ...p, connectionToMe: status, speaking: false }
              : p,
          ),
        })),

      devFailJoin: () => set({ stage: "failed" }),
    }),
    {
      name: "comunidade-p2p:voice",
      version: 1,
      // Só a escolha de repasse sobrevive ao reload (§9, 2.4.1); a chamada
      // em si é estado do agora.
      partialize: ({ relayDecisionByCommunity }) => ({
        relayDecisionByCommunity,
      }),
    },
  ),
);

/* ─── Seletores ──────────────────────────────────────────────────── */

/** Referência estável para quem não está em chamada nenhuma. */
const NO_PARTICIPANTS: VoiceParticipant[] = [];

export function useVoiceParticipants(): VoiceParticipant[] {
  return useVoiceStore((state) => state.participants ?? NO_PARTICIPANTS);
}

/** Estado da identidade local dentro da chamada (mudo, câmera, …). */
export function useLocalParticipant(): VoiceParticipant | undefined {
  return useVoiceStore((state) =>
    state.participants.find((p) => p.identityId === state.localId),
  );
}

/** `true` quando a chamada ativa é justamente a deste canal. */
export function useIsInVoiceChannel(channelId: string): boolean {
  return useVoiceStore((state) => state.channelId === channelId);
}

/**
 * Ids de quem está no canal de voz *agora*: a fixture descreve como o canal
 * nasce, e a chamada em curso sobrepõe — sem isto a lista de canais e a
 * grade discordariam depois que a identidade local entra.
 */
export function useVoiceChannelParticipantIds(channel: Channel): string[] {
  return useVoiceStore(
    useShallow((state) =>
      state.channelId === channel.id
        ? state.participants.map((p) => p.identityId)
        : (channel.voiceParticipantIds ?? []),
    ),
  );
}

/**
 * §17.5 — a saúde por espectador, **só para quem apresenta**. É o que `share.health`
 * entrega, e a única leitura de rede que o tile mostra.
 *
 * Substitui `useMyRelayCount`, que contava quantas pessoas esta máquina retransmitia numa
 * árvore que A20 tirou do v1: em estrela ninguém retransmite para ninguém (B26).
 */
export function useShareHealth(): ShareViewerHealthDto[] {
  return useVoiceStore(
    useShallow((state) => minhaTela(state.shares, state.localId)?.saude ?? NO_HEALTH),
  );
}

/** Referência estável para quem não apresenta nada. */
const NO_HEALTH: ShareViewerHealthDto[] = [];
