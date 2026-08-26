import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import type {
  Channel,
  MeshStatus,
  ScreenShareSession,
  VoiceParticipant,
} from "../domain/types";
import { SHARE_MAX_VIEWERS, type ShareViewerHealthDto } from "../ipc/api";

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

/**
 * §17.5 — o teto da estrela, e o único teto que existe: 8 espectadores. O `STAR_MAX_VIEWERS
 * = 5` que morava aqui era a fronteira estrela→árvore de um desenho que A20 revogou (B26);
 * ele contradizia o `SHARE_MAX_VIEWERS` normativo em valor E em significado — 5 era "a
 * partir daqui vira árvore", 8 é "a partir daqui o host recusa" (`E_SESSION_FULL`).
 *
 * O valor vem de `ipc/api` para não haver duas cópias de uma constante de protocolo.
 */
export { SHARE_MAX_VIEWERS };


/* ─── Tipos ──────────────────────────────────────────────────────── */

export type VoiceStage = "connecting" | "connected" | "failed";

/** O que o store precisa da malha — nada de WebRTC atravessa esta fronteira. */
export interface PortaDeMalha {
  entrar: (a: { communityId: string; channelId: string; localId: string }) => Promise<void>;
  sair: () => Promise<void>;
  /** §15.4 `voice.setSelf` — mudo/ensurdecido/câmera vão ao host, que publica no roster. */
  mudarSelf: (patch: { muted?: boolean; deafened?: boolean; cameraOn?: boolean }) => void;
}

let portaDeMalha: PortaDeMalha | null = null;

/**
 * §17.5 — iniciando · ativo · falha. `optimizing` era a transição estrela→árvore que A20
 * revogou (B26): sem árvore, não há distribuição a otimizar e o banner mentiria.
 */
export type SharePhase = "starting" | "live" | "failed";

export type ShareQuality = ScreenShareSession["quality"];

export interface ActiveShare extends ScreenShareSession {
  phase: SharePhase;
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
  /** Papel espectador (§15.4): pede o perfil ao host. */
  pedirQualidade: (sessionId: string, quality: ShareQuality) => Promise<boolean>;
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
  share: ActiveShare | null;
  /** `sessionId` da sessão de tela viva — a chave de todo comando de §15.4. */
  shareSessionId: string | null;
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
  /** `voice.revoked` para mim: a sessão acabou por decisão do host (§17.4). */
  encerradaPeloHost: () => void;
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
  setQuality: (quality: ShareQuality) => void;
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

const IDLE = {
  channelId: null,
  communityId: null,
  localId: null,
  stage: "connecting" as VoiceStage,
  motivoDaFalha: null as string | null,
  participants: [] as VoiceParticipant[],
  expanded: false,
  share: null,
  shareSessionId: null,
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
          share: null,
          shareSessionId: null,
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
          return {
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
          stage: estado === "ok" && state.stage === "connecting" ? "connected" : state.stage,
          participants: state.participants.map((p) =>
            p.identityId === peerHex ? { ...p, connectionToMe: estado } : p,
          ),
        })),

      falhouAoConectar: (motivo) => set({ stage: "failed", motivoDaFalha: motivo }),

      encerradaPeloHost: () => {
        set({ ...IDLE });
      },

      toggleMute: () => {
        const eu = get().participants.find((p) => p.identityId === get().localId);
        // §15.4 `voice.setSelf` — o host publica no roster; sem isso o outro lado nunca
        // veria o mudo, e o ícone seria decoração local.
        portaDeMalha?.mudarSelf({ muted: !(eu?.muted ?? false), ...(eu?.muted === true ? { deafened: false } : {}) });
        return set((state) => ({
          participants: state.participants.map((p) =>
            p.identityId === state.localId
              ? // Desmutar com o áudio ensurdecido não faz sentido: sair do
                // mudo também tira do ensurdecido (convenção do gênero).
                {
                  ...p,
                  muted: !p.muted,
                  deafened: p.muted ? false : p.deafened,
                  speaking: false,
                }
              : p,
          ),
        }));
      },

      toggleDeafen: () => {
        const eu = get().participants.find((p) => p.identityId === get().localId);
        portaDeMalha?.mudarSelf({ deafened: !(eu?.deafened ?? false) });
        return set((state) => ({
          participants: state.participants.map((p) =>
            p.identityId === state.localId
              ? {
                  ...p,
                  deafened: !p.deafened,
                  // Ensurdecer implica mudo; desensurdecer devolve a voz.
                  muted: !p.deafened,
                  speaking: false,
                }
              : p,
          ),
        }));
      },

      toggleCamera: () =>
        set((state) => ({
          participants: state.participants.map((p) =>
            p.identityId === state.localId ? { ...p, cameraOn: !p.cameraOn } : p,
          ),
        })),

      setExpanded: (expanded) => set({ expanded }),

      setVolume: (identityId, volume) =>
        set((state) => ({
          volumeById: { ...state.volumeById, [identityId]: volume },
        })),

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
        if (state.share !== null) return; // §17.5: exatamente 1 por canal (`E_ALREADY_SHARING`)
        const quality = a?.quality ?? "balanced";

        set({
          share: {
            presenterId: state.localId,
            channelId: state.channelId,
            viewerCount: 0,
            quality,
            phase: "starting",
            sourceLabel: "",
            motivoDaFalha: null,
            saude: [],
          },
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
            set((s) => ({
              shareSessionId: sessionId,
              share: s.share === null ? null : { ...s.share, phase: "live", sourceLabel },
              participants: s.participants.map((p) =>
                p.identityId === s.localId ? { ...p, sharingScreen: true } : p,
              ),
            }));
          })
          .catch((e: unknown) => {
            // Cancelar o seletor do sistema é `NotAllowedError` e NÃO é falha: a pessoa
            // desistiu. Mostrar "falha ao transmitir" para uma desistência seria mentira.
            const nome = (e as { name?: string })?.name;
            if (nome === "NotAllowedError" || nome === "AbortError") {
              set({ share: null, shareSessionId: null });
              return;
            }
            get().telaFalhou("Não foi possível iniciar a transmissão de tela.");
          });
      },

      stopShare: () => {
        void portaDeTela?.parar().catch(() => undefined);
        set((state) => ({
          share: null,
          shareSessionId: null,
          participants: state.participants.map((p) =>
            p.sharingScreen ? { ...p, sharingScreen: false } : p,
          ),
        }));
      },

      /**
       * §15.4 papel **espectador**: pede o perfil ao host, que o registra. O efeito
       * mensurável é do apresentador, que aprende o perfil pelo `quality` de `share.health`
       * (§17.5). Por isso o estado local só muda quando o host aceita — anunciar "Baixa" e
       * continuar recebendo em alta seria o `F-08` de volta.
       */
      setQuality: (quality) => {
        const { shareSessionId, share, localId } = get();
        if (shareSessionId === null || share === null) return;
        // Quem apresenta manda no próprio envio e não pede nada a ninguém.
        if (share.presenterId === localId) {
          set({ share: { ...share, quality } });
          return;
        }
        void portaDeTela
          ?.pedirQualidade(shareSessionId, quality)
          .then((applied) => {
            if (applied) set((s) => (s.share ? { share: { ...s.share, quality } } : {}));
          })
          .catch(() => undefined);
      },

      retryShare: () => {
        const { share } = get();
        if (share === null) return;
        get().stopShare();
        if (share.presenterId === get().localId) get().startShare({ quality: share.quality });
      },

      telaComecou: ({ sessionId, presenterKey, channelId }) =>
        set((state) => {
          if (state.channelId !== channelId) return {};
          const eu = state.localId?.toLowerCase();
          const apresentador = presenterKey.toLowerCase();
          // O próprio `share.started` volta para quem começou: o estado dele já está de pé
          // e sobrescrevê-lo apagaria o `sourceLabel` que só esta máquina conhece.
          if (eu !== undefined && apresentador === eu) return { shareSessionId: sessionId };
          return {
            shareSessionId: sessionId,
            share: {
              presenterId: presenterKey,
              channelId,
              viewerCount: 0,
              quality: "balanced" as ShareQuality,
              phase: "starting" as SharePhase,
              sourceLabel: "",
              motivoDaFalha: null,
              saude: [],
            },
            participants: state.participants.map((p) =>
              p.identityId.toLowerCase() === apresentador ? { ...p, sharingScreen: true } : p,
            ),
            expanded: true,
          };
        }),

      telaParou: (sessionId) => {
        const state = get();
        if (state.shareSessionId !== null && state.shareSessionId !== sessionId) return;
        // **A sessão pode ter sido encerrada pelo HOST** — ban, kick, canal apagado, sweep
        // (§17.5/§18.1). Se eu era quem apresentava, limpar só o estado deixaria a captura
        // viva: a luz de "compartilhando tela" do sistema continuaria acesa, transmitindo
        // para uma sessão que não existe mais. Quem para a captura é a estrela.
        if (state.share !== null && state.share.presenterId === state.localId) {
          void portaDeTela?.parar().catch(() => undefined);
        }
        set({
          share: null,
          shareSessionId: null,
          participants: state.participants.map((p) =>
            p.sharingScreen ? { ...p, sharingScreen: false } : p,
          ),
        });
      },

      telaMudouEspectadores: ({ sessionId, viewerCount }) =>
        set((state) => {
          if (state.share === null || state.shareSessionId !== sessionId) return {};
          return { share: { ...state.share, viewerCount } };
        }),

      telaMediuSaude: (viewers) =>
        set((state) =>
          state.share === null ? {} : { share: { ...state.share, saude: [...viewers] } },
        ),

      telaFalhou: (motivo) =>
        set((state) =>
          state.share === null
            ? {}
            : { share: { ...state.share, phase: "failed" as SharePhase, motivoDaFalha: motivo } },
        ),

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
    useShallow((state) =>
      state.share !== null && state.share.presenterId === state.localId
        ? state.share.saude
        : NO_HEALTH,
    ),
  );
}

/** Referência estável para quem não apresenta nada. */
const NO_HEALTH: ShareViewerHealthDto[] = [];
