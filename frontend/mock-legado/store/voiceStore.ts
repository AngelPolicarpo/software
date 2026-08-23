import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import type {
  Channel,
  MeshStatus,
  RelayNode,
  ScreenShareSession,
  VoiceParticipant,
} from "../domain/types";
import { findMember, IDS } from "../mocks/dataset";

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

/* ─── Tempos simulados (o mock não tem rede real) ─────────────────── */

/** §11, B7 passo 2 — mesh estabelecendo conexão com cada peer. */
const MESH_CONNECT_MS = 500;
/** §9, 2.3 — "no mock, simula ciclando entre participantes". */
const SPEAKING_TICK_MS = 2200;
/** §11, B5 passo 1 — "Preparando compartilhamento…". */
const SHARE_PREPARE_MS = 1000;
/** §11, B5 passo 3 — "Otimizando distribuição…" (~1-2s). */
const OPTIMIZING_MS = 1500;
/** §11, B5 passos 5-6 — reparo da árvore ("alguns segundos"). */
const TREE_REPAIR_MS = 4200;

/** §9, 2.4 — ≤5 espectadores é estrela; acima disso, árvore. */
export const STAR_MAX_VIEWERS = 5;

/**
 * §11, B7 passo 3 — a conexão com Bianca falha (simulado), assimétrica: ela
 * segue normal para os outros. É o único peer que nasce sem mesh; §9 (2.3)
 * usa Diego no exemplo do banner, mas o fluxo, que é o caminho percorrido,
 * nomeia Bianca.
 */
const MESH_FAILURE_ID: string = IDS.bianca;

/* ─── Tipos ──────────────────────────────────────────────────────── */

export type VoiceStage = "connecting" | "connected" | "failed";

/** §9, 2.4 — iniciando · ativo · transição estrela→árvore · falha total. */
export type SharePhase = "starting" | "optimizing" | "live" | "failed";

export type ShareQuality = ScreenShareSession["quality"];

export interface ActiveShare extends ScreenShareSession {
  phase: SharePhase;
  /** Fonte escolhida no seletor simulado — o mock não captura tela (§9, 2.4). */
  sourceLabel: string;
}

export interface ConsentRequest {
  /** Quantas pessoas a árvore quer que a identidade local atenda (§9, 2.4.1). */
  relayCount: number;
}

interface VoiceState {
  channelId: string | null;
  communityId: string | null;
  /** Quem a identidade local é dentro desta comunidade (§8, 1.3). */
  localId: string | null;
  stage: VoiceStage;
  /** Inclui a identidade local — §18: sozinha, a grade mostra o tile dela. */
  participants: VoiceParticipant[];
  /** Grade expandida (2.3) vs. só a barra persistente (2.3.1). */
  expanded: boolean;
  share: ActiveShare | null;
  consentRequest: ConsentRequest | null;
  relayDecisionByCommunity: Record<string, boolean>;
  /** Volume individual por participante, 0-100 (§9, 2.3 · §8, 1.4). */
  volumeById: Record<string, number>;

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

  startShare: (sourceLabel: string) => void;
  stopShare: () => void;
  setQuality: (quality: ShareQuality) => void;
  retryShare: () => void;
  respondConsent: (accept: boolean, remember: boolean) => void;

  /* Afinadores de §19.1 — sem rede real, nada disto acontece sozinho. */
  devSetPeerMesh: (identityId: string, status: MeshStatus) => void;
  devFailJoin: () => void;
  devStartRemoteShare: () => void;
  devAddViewer: () => void;
  devClearViewers: () => void;
  devSetTurnFallback: (using: boolean) => void;
  devFailShare: () => void;
  devRepairTree: () => void;
  devForgetConsent: () => void;
}

/* ─── Árvore de distribuição (§9, 2.4.2) ─────────────────────────── */

/**
 * Espectadores extras que a árvore precisa para deixar o modo estrela. São
 * os mesmos ids do compartilhamento de §2 — não têm registro de membro
 * porque nunca aparecem nomeados: só contam para a topologia.
 */
const EXTRA_VIEWER_IDS = [
  IDS.fernanda,
  "usr-espectador-5",
  "usr-espectador-6",
  "usr-espectador-7",
];

/**
 * Distribui os espectadores entre até 2 nós de primeiro nível.
 *
 * Só o primeiro nível é modelado: §9 (2.4.2) é explícita em que nem o
 * apresentador enxerga conexões que não são dele — a contagem de cada linha
 * já agrega tudo abaixo dela. Com 7 espectadores e 2 nós o resto vai para o
 * último, dando 2 e 3 — exatamente o exemplo da spec.
 */
function buildRelays(viewerIds: string[], candidateIds: string[]): RelayNode[] {
  const relays = candidateIds.filter((id) => viewerIds.includes(id)).slice(0, 2);
  if (relays.length === 0) return [];

  const downstream = Math.max(0, viewerIds.length - relays.length);
  const base = Math.floor(downstream / relays.length);
  const extra = downstream % relays.length;

  return relays.map((identityId, index) => ({
    identityId,
    relayingTo: base + (index >= relays.length - extra ? 1 : 0),
    status: "ok" as const,
  }));
}

/**
 * Quem pode virar nó intermediário: espectador com registro de membro (a
 * árvore precisa saber de quem se trata), fora o apresentador. A identidade
 * local só entra se tiver aceitado repassar (§9, 2.4.1) — recusar não tem
 * custo nenhum para ela.
 */
function relayCandidates(
  share: Pick<ActiveShare, "presenterId" | "viewerIds" | "channelId">,
  communityId: string,
  localId: string | null,
  consented: boolean | undefined,
): string[] {
  return share.viewerIds.filter((id) => {
    if (id === share.presenterId) return false;
    if (id === localId) return consented === true;
    return findMember(communityId, id) !== undefined;
  });
}

/** Recalcula topologia e nós de primeiro nível a partir dos espectadores. */
function retopologize(
  share: ActiveShare,
  communityId: string,
  localId: string | null,
  consented: boolean | undefined,
): ActiveShare {
  const tree = share.viewerIds.length > STAR_MAX_VIEWERS;
  return {
    ...share,
    topology: tree ? "tree" : "star",
    firstLevelRelays: tree
      ? buildRelays(
          share.viewerIds,
          relayCandidates(share, communityId, localId, consented),
        )
      : [],
  };
}

/* ─── Timers de módulo ───────────────────────────────────────────── */

let connectTimer: number | undefined;
let speakingTimer: number | undefined;
let shareTimer: number | undefined;
let repairTimer: number | undefined;

function clearShareTimers() {
  window.clearTimeout(shareTimer);
  window.clearTimeout(repairTimer);
}

function clearAllTimers() {
  window.clearTimeout(connectTimer);
  window.clearInterval(speakingTimer);
  clearShareTimers();
}

/** Peer sem mesh comigo não "fica calado": não entra no ciclo de fala. */
function canSpeak(participant: VoiceParticipant): boolean {
  return (
    !participant.muted &&
    !participant.deafened &&
    participant.connectionToMe !== "failed"
  );
}

function startSpeakingCycle() {
  window.clearInterval(speakingTimer);
  speakingTimer = window.setInterval(() => {
    const state = useVoiceStore.getState();
    if (state.stage !== "connected") return;

    const eligible = state.participants.filter(canSpeak);
    const currentIndex = eligible.findIndex((p) => p.speaking);
    const next =
      eligible.length > 0
        ? eligible[(currentIndex + 1) % eligible.length].identityId
        : null;

    // Sem mudança, sem `set`: um array novo por tique re-renderizaria a
    // grade inteira à toa.
    if (state.participants.every((p) => p.speaking === (p.identityId === next)))
      return;

    useVoiceStore.setState({
      participants: state.participants.map((p) => ({
        ...p,
        speaking: p.identityId === next,
      })),
    });
  }, SPEAKING_TICK_MS);
}

/* ─── Store ──────────────────────────────────────────────────────── */

const IDLE = {
  channelId: null,
  communityId: null,
  localId: null,
  stage: "connecting" as VoiceStage,
  participants: [] as VoiceParticipant[],
  expanded: false,
  share: null,
  consentRequest: null,
};

export const useVoiceStore = create<VoiceState>()(
  persist(
    (set, get) => ({
      ...IDLE,
      relayDecisionByCommunity: {},
      volumeById: {},

      join: (channel, localId) => {
        clearAllTimers();

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
          participants,
          // Entrar mostra a grade (§9, 2.3) — por cima do conteúdo, que
          // continua o canal de texto que estava aberto (§4).
          expanded: true,
          share: null,
          consentRequest: null,
        });

        connectTimer = window.setTimeout(() => {
          set((state) => ({
            stage: "connected",
            participants: state.participants.map((p) =>
              p.identityId === MESH_FAILURE_ID
                ? { ...p, connectionToMe: "failed" as MeshStatus }
                : p,
            ),
          }));
          startSpeakingCycle();
        }, MESH_CONNECT_MS);
      },

      retryJoin: () => {
        window.clearTimeout(connectTimer);
        set({ stage: "connecting" });
        connectTimer = window.setTimeout(() => {
          set({ stage: "connected" });
          startSpeakingCycle();
        }, MESH_CONNECT_MS);
      },

      leave: () => {
        clearAllTimers();
        set({ ...IDLE });
      },

      toggleMute: () =>
        set((state) => ({
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
        })),

      toggleDeafen: () =>
        set((state) => ({
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
        })),

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

      startShare: (sourceLabel) => {
        const state = get();
        if (!state.channelId || !state.communityId || !state.localId) return;
        clearShareTimers();

        const viewerIds = state.participants
          .map((p) => p.identityId)
          .filter((id) => id !== state.localId);

        const share: ActiveShare = {
          presenterId: state.localId,
          channelId: state.channelId,
          phase: "starting",
          topology: viewerIds.length > STAR_MAX_VIEWERS ? "tree" : "star",
          viewerIds,
          quality: "auto",
          treeHealth: "ok",
          usingTurnFallback: false,
          firstLevelRelays: [],
          sourceLabel,
        };

        set({
          share: retopologize(
            share,
            state.communityId,
            state.localId,
            state.relayDecisionByCommunity[state.communityId],
          ),
          participants: state.participants.map((p) =>
            p.identityId === state.localId ? { ...p, sharingScreen: true } : p,
          ),
          expanded: true,
        });

        // §11, B5 passo 1 — "Preparando compartilhamento…" (~1s).
        shareTimer = window.setTimeout(() => {
          set((s) => (s.share ? { share: { ...s.share, phase: "live" } } : {}));
        }, SHARE_PREPARE_MS);
      },

      stopShare: () => {
        clearShareTimers();
        set((state) => ({
          share: null,
          consentRequest: null,
          participants: state.participants.map((p) =>
            p.sharingScreen ? { ...p, sharingScreen: false } : p,
          ),
        }));
      },

      setQuality: (quality) =>
        set((state) => (state.share ? { share: { ...state.share, quality } } : {})),

      retryShare: () =>
        set((state) =>
          state.share ? { share: { ...state.share, phase: "live" } } : {},
        ),

      respondConsent: (accept, remember) => {
        const state = get();
        const communityId = state.communityId;
        if (!communityId) return;

        const decisions = remember
          ? { ...state.relayDecisionByCommunity, [communityId]: accept }
          : state.relayDecisionByCommunity;

        set({
          consentRequest: null,
          relayDecisionByCommunity: decisions,
          share: state.share
            ? retopologize(state.share, communityId, state.localId, accept)
            : null,
        });
      },

      /* ─── Afinadores de desenvolvimento (§19.1) ─────────────────── */

      devSetPeerMesh: (identityId, status) =>
        set((state) => ({
          participants: state.participants.map((p) =>
            p.identityId === identityId
              ? { ...p, connectionToMe: status, speaking: false }
              : p,
          ),
        })),

      devFailJoin: () => {
        clearAllTimers();
        set({ stage: "failed" });
      },

      /**
       * §11, B5 do ponto de vista de Ana: Rafael apresenta e ela assiste.
       * Começa em estrela com 3 espectadores, como o passo 2 descreve.
       */
      devStartRemoteShare: () => {
        const state = get();
        if (!state.channelId || !state.communityId) return;
        clearShareTimers();

        // A identidade local encabeça a lista de espectadores, como no
        // compartilhamento de §2 — é o que a torna candidata a nó de
        // primeiro nível quando a árvore entra (§9, 2.4.2).
        const others = state.participants
          .map((p) => p.identityId)
          .filter((id) => id !== IDS.rafael && id !== state.localId);
        const viewerIds = state.localId
          ? [state.localId, ...others]
          : others;

        set({
          share: {
            presenterId: IDS.rafael,
            channelId: state.channelId,
            phase: "starting",
            topology: "star",
            viewerIds,
            quality: "auto",
            treeHealth: "ok",
            usingTurnFallback: false,
            firstLevelRelays: [],
            sourceLabel: "Tela inteira",
          },
          participants: state.participants.map((p) =>
            p.identityId === IDS.rafael ? { ...p, sharingScreen: true } : p,
          ),
          expanded: true,
        });

        shareTimer = window.setTimeout(() => {
          set((s) => (s.share ? { share: { ...s.share, phase: "live" } } : {}));
        }, SHARE_PREPARE_MS);
      },

      /** §11, B5 passos 3-4 — o 6º espectador leva a árvore para o ar. */
      devAddViewer: () => {
        const state = get();
        const share = state.share;
        const communityId = state.communityId;
        if (!share || !communityId) return;

        // Quem está na chamada entra primeiro (a identidade local à frente,
        // como em §2), e só depois os espectadores extras — assim dá para
        // reconstruir a audiência do zero depois de zerá-la.
        const pool = [
          ...(state.localId && state.localId !== share.presenterId
            ? [state.localId]
            : []),
          ...state.participants
            .map((p) => p.identityId)
            .filter((id) => id !== share.presenterId && id !== state.localId),
          ...EXTRA_VIEWER_IDS,
        ];
        const next = pool.find((id) => !share.viewerIds.includes(id));
        if (!next) return;

        const viewerIds = [...share.viewerIds, next];
        const becomesTree =
          share.topology === "star" && viewerIds.length > STAR_MAX_VIEWERS;

        if (!becomesTree) {
          set({ share: { ...share, viewerIds } });
          return;
        }

        // Transição visível: "Otimizando distribuição…" antes da árvore, para
        // não parecer bug (§9, 2.4).
        set({ share: { ...share, viewerIds, phase: "optimizing" } });
        clearShareTimers();
        shareTimer = window.setTimeout(() => {
          const current = useVoiceStore.getState();
          if (!current.share || !current.communityId) return;
          const consented =
            current.relayDecisionByCommunity[current.communityId];
          const tree = retopologize(
            { ...current.share, phase: "live" },
            current.communityId,
            current.localId,
            consented,
          );
          set({
            share: tree,
            // §11, B6: a árvore precisa de mais um nó e Ana é candidata. Com
            // escolha lembrada, o modal não reaparece nesta comunidade.
            consentRequest:
              consented === undefined && current.localId !== tree.presenterId
                ? { relayCount: 2 }
                : null,
          });
        }, OPTIMIZING_MS);
      },

      /** §18 — compartilhamento cai para 0 espectadores e continua ativo. */
      devClearViewers: () =>
        set((state) =>
          state.share
            ? {
                share: {
                  ...state.share,
                  viewerIds: [],
                  topology: "star",
                  firstLevelRelays: [],
                },
                consentRequest: null,
              }
            : {},
        ),

      devSetTurnFallback: (using) =>
        set((state) =>
          state.share
            ? { share: { ...state.share, usingTurnFallback: using } }
            : {},
        ),

      devFailShare: () =>
        set((state) =>
          state.share ? { share: { ...state.share, phase: "failed" } } : {},
        ),

      /**
       * §11, B5 passos 5-6 — um nó do meio cai. O nó afetado passa a
       * `conn-reconnecting` (nunca some nem vira erro genérico, §9 2.4.2) e,
       * ao reorganizar, os espectadores dele são redistribuídos.
       */
      devRepairTree: () => {
        const state = get();
        const share = state.share;
        if (!share || share.topology !== "tree") return;
        if (share.firstLevelRelays.length < 2) return;

        // Cai um nó que não seja a identidade local: ela precisa continuar
        // vendo o próprio badge de repasse durante o reparo.
        const affected =
          share.firstLevelRelays.find((r) => r.identityId !== state.localId) ??
          share.firstLevelRelays[0];

        set({
          share: {
            ...share,
            treeHealth: "repairing",
            firstLevelRelays: share.firstLevelRelays.map((relay) =>
              relay.identityId === affected.identityId
                ? { ...relay, status: "reconnecting" }
                : relay,
            ),
          },
        });

        window.clearTimeout(repairTimer);
        repairTimer = window.setTimeout(() => {
          set((s) => {
            if (!s.share) return {};
            // Um espectador do nó que caiu passa para o outro nó — a
            // contagem muda, como §9 (2.4.2) prevê.
            const moved = s.share.firstLevelRelays.some(
              (r) => r.identityId !== affected.identityId,
            );
            return {
              share: {
                ...s.share,
                treeHealth: "ok",
                firstLevelRelays: s.share.firstLevelRelays.map((relay) => {
                  if (relay.identityId === affected.identityId) {
                    return {
                      ...relay,
                      status: "ok" as const,
                      relayingTo: Math.max(0, relay.relayingTo - (moved ? 1 : 0)),
                    };
                  }
                  return {
                    ...relay,
                    status: "ok" as const,
                    relayingTo: relay.relayingTo + (moved ? 1 : 0),
                  };
                }),
              },
            };
          });
        }, TREE_REPAIR_MS);
      },

      devForgetConsent: () =>
        set((state) => {
          if (!state.communityId) return {};
          const next = { ...state.relayDecisionByCommunity };
          delete next[state.communityId];
          return { relayDecisionByCommunity: next, consentRequest: null };
        }),
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
 * Quantas pessoas a identidade local está retransmitindo agora (§9, 2.4) —
 * `null` quando ela é folha da árvore, que é o normal.
 */
export function useMyRelayCount(): number | null {
  return useVoiceStore((state) => {
    const relay = state.share?.firstLevelRelays.find(
      (node) => node.identityId === state.localId,
    );
    return relay ? relay.relayingTo : null;
  });
}
