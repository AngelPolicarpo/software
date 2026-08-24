import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Message, Reaction, Thread } from "../domain/types";
import { useIdentityStore } from "./identityStore";

/**
 * Mensagens da sessão (§9, 2.1 · fluxos C9 e B4) sobre a fonte real.
 *
 * A base (`remoteMessages`/`remoteThreads`) vem do núcleo por `query.messages`/
 * `query.thread`. O que nasce aqui é só a **bolha otimista** do envio: ela existe
 * enquanto a op ainda não foi observada na réplica. O transporte NÃO mora nesta
 * store — quem o injeta é o sincronizador (`configurarEscrita`), porque este
 * módulo não pode conhecer IPC-R; sem canal configurado, enviar falha calado na
 * bolha em vez de fingir confirmação.
 *
 * A durabilidade é da outbox do núcleo (`manifest.db`, §11.2) — não desta store.
 * Por isso nada aqui sobrevive a um reload: ao reabrir, a fila é redesenhada a
 * partir de `query.outbox` (`aplicarFila`), cujo preview existe exatamente para
 * isso (F-16). Persistir bolha no localStorage seria um segundo dono de promessa
 * de entrega, e promessa duplicada é mentira.
 */

/** Id da bolha = `clientRef` que viaja na op e volta em todo desfecho de §15.5. */
function clientRef(): string {
  const buffer = new Uint8Array(8);
  crypto.getRandomValues(buffer);
  return `b-${Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * O canal de escrita injetado pelo sincronizador. `enviar` devolve o `opId` da op
 * enfileirada, ou `{ cancelado: true }` quando o gesto do usuário abortou antes
 * do quadro (cancelamento do diálogo nativo de anexo) — cancelar não é falha.
 */
export interface CanalDeEscrita {
  enviar(entrada: {
    communityId: string;
    channelId: string;
    content: string;
    mentions: string[];
    replyToId?: string;
    threadId?: string;
    /** Id da bolha otimista; é o `clientRef` de §11.2/F-44. */
    clientRef: string;
  }): Promise<{ opId: string; cancelado?: boolean }>;
  /** §15.1 r. 7 / §11.3 — reenvia o MESMO envelope, mesmo `opId`. */
  reenviar(opId: string): Promise<void>;
}

export interface SendMessageInput {
  communityId: string;
  channelId: string;
  content: string;
  /** Ids de membros/cargos mencionados; `@everyone` usa o id `everyone` — formato do fio. */
  mentions: string[];
  replyToId?: string;
  /** Resposta dentro de uma thread (§9, 2.2). */
  threadId?: string;
}

const NENHUMA: Message[] = [];

interface MessageState {
  /** Base vinda do núcleo, por canal (§15.6 `query.messages`). */
  remoteMessages: Record<string, Message[]>;
  /** Threads vindas de `query.thread`, por id. */
  remoteThreads: Record<string, Thread>;
  aplicarRemoto: (patch: { remoteMessages?: Record<string, Message[]>; remoteThreads?: Record<string, Thread> }) => void;
  /** Bolhas otimistas desta sessão, por canal. Sai delas só por desfecho. */
  sentByChannel: Record<string, Message[]>;
  /**
   * Bolhas derivadas de `query.outbox` ao reabrir (F-16), por canal. A origem
   * manda: cada sincronização SUBSTITUI o conjunto inteiro — o item que saiu da
   * fila some daqui, porque ou virou mensagem projetada ou saiu com motivo.
   */
  filaPorCanal: Record<string, Message[]>;
  /** Mudanças de sessão sobre qualquer mensagem, por id. */
  overrides: Record<string, Partial<Message>>;
  deletedIds: string[];
  /** Threads abertas nesta sessão; as de §2 vivem nas fixtures. */
  createdThreads: Record<string, Thread>;
  /** Quem está digitando agora, por canal (§9, 2.1). */
  typingByChannel: Record<string, string[]>;
  /** Correlação da bolha com a op: `clientRef → opId` (§11.2 `client_ref`). */
  opIdPorRef: Record<string, string>;
  /** Desfecho feliz: `clientRef → messageId` observado na réplica (§11.6 passo 8). */
  aceitasRefs: Record<string, string>;
  /** Última recusa/descarte por bolha — o código nomeado de §20, para a linha mostrar. */
  errosPorRef: Record<string, string>;

  /** O transporte corrente; `null` é "sem núcleo". Injetado pelo sincronizador. */
  escrita: CanalDeEscrita | null;

  /** Injeção do transporte; `null` devolve ao estado sem núcleo. Idempotente. */
  configurarEscrita(canal: CanalDeEscrita | null): void;
  send: (input: SendMessageInput) => Promise<void>;
  /** Abre thread numa mensagem que ainda não tem — devolve o id. */
  createThread: (rootMessage: Message) => string;
  retrySend: (ref: string) => void;
  toggleReaction: (message: Message, emoji: string, userId: string) => void;
  setPinned: (messageId: string, pinned: boolean) => void;
  editMessage: (messageId: string, content: string) => void;
  deleteMessage: (messageId: string) => void;
  setTyping: (channelId: string, identityIds: string[]) => void;

  /* ─── Desfechos de §15.5 e fila de §15.6 — chamados pelo sincronizador ─── */

  /** `message.accepted` — casa pelo `clientRef` e assenta na posição de `seq`. */
  assentarAceita: (ref: string, messageId: string) => void;
  /** `message.failed`/`message.dropped` — a bolha fica visível COM o motivo. */
  marcarFalha: (ref: string, motivo: string) => void;
  /** Redesenho da fila a partir de `query.outbox`; substitui o conjunto anterior. */
  aplicarFila: (
    bolhas: Array<{ ref: string; opId: string; channelId: string; content: string; deliveryState: Message["deliveryState"] }>,
  ) => void;
  /**
   * Bolhas de canais que deixaram de existir na réplica local (§18) — devolve
   * quantas caíram, para quem chamou poder avisar em vez de sumir calado.
   */
  descartarCanal: (channelIds: string[]) => number;
  reset: () => void;
}

/** Estado de entrega efetivo: o override manda sobre o da mensagem. */
function deliveryOf(state: MessageState, message: Message) {
  return state.overrides[message.id]?.deliveryState ?? message.deliveryState;
}

function withOverride(
  state: MessageState,
  id: string,
  patch: Partial<Message>,
): Pick<MessageState, "overrides"> {
  return {
    overrides: {
      ...state.overrides,
      [id]: { ...state.overrides[id], ...patch },
    },
  };
}

/** Reação de um usuário entra ou sai; chip zerado some junto (§18). */
function toggled(
  reactions: Reaction[],
  emoji: string,
  userId: string,
): Reaction[] {
  const current = reactions.find((reaction) => reaction.emoji === emoji);
  if (!current) {
    return [...reactions, { emoji, count: 1, userIds: [userId] }];
  }
  const mine = current.userIds.includes(userId);
  const userIds = mine
    ? current.userIds.filter((id) => id !== userId)
    : [...current.userIds, userId];

  return reactions
    .map((reaction) =>
      reaction.emoji === emoji
        ? { ...reaction, userIds, count: userIds.length }
        : reaction,
    )
    .filter((reaction) => reaction.count > 0);
}

export const useMessageStore = create<MessageState>()((set, get) => ({
  remoteMessages: {},
  remoteThreads: {},
  aplicarRemoto: (patch) => set(patch),
  sentByChannel: {},
  filaPorCanal: {},
  overrides: {},
  deletedIds: [],
  createdThreads: {},
  typingByChannel: {},
  opIdPorRef: {},
  aceitasRefs: {},
  errosPorRef: {},

  escrita: null,
  configurarEscrita(canal) {
    set({ escrita: canal });
  },

  async send({ communityId, channelId, content, mentions, replyToId, threadId }) {
    const ref = clientRef();
    const eu = useIdentityStore.getState().identity;
    const message: Message = {
      id: ref,
      channelId,
      authorId: eu?.id ?? "",
      content,
      timestamp: new Date().toISOString(),
      edited: false,
      pinned: false,
      ...(replyToId !== undefined ? { replyToId } : {}),
      ...(threadId !== undefined ? { threadId } : {}),
      reactions: [],
      attachments: [],
      mentions,
      // Verdade provisória: a op ainda nem foi enfileirada. Os estados seguintes
      // vêm da outbox — nunca de um temporizador desta store.
      deliveryState: "sending",
    };

    set((state) => ({
      sentByChannel: {
        ...state.sentByChannel,
        [channelId]: [...(state.sentByChannel[channelId] ?? []), message],
      },
    }));

    const canal = get().escrita;
    if (canal === null) {
      set((state) => ({ ...withOverride(state, ref, { deliveryState: "failed" }), errosPorRef: { ...state.errosPorRef, [ref]: "O núcleo não está acessível" } }));
      return;
    }

    try {
      const r = await canal.enviar({
        communityId,
        channelId,
        content,
        mentions,
        ...(replyToId !== undefined ? { replyToId } : {}),
        ...(threadId !== undefined ? { threadId } : {}),
        clientRef: ref,
      });
      if (r.cancelado === true) {
        // O gesto abortou antes do quadro: a bolha nunca deveria ter existido.
        set((state) => ({
          sentByChannel: {
            ...state.sentByChannel,
            [channelId]: (state.sentByChannel[channelId] ?? []).filter((m) => m.id !== ref),
          },
        }));
        return;
      }
      set((state) => ({ opIdPorRef: { ...state.opIdPorRef, [ref]: r.opId } }));
    } catch (e) {
      set((state) => ({
        ...withOverride(state, ref, { deliveryState: "failed" }),
        errosPorRef: { ...state.errosPorRef, [ref]: e instanceof Error ? e.message : String(e) },
      }));
    }
  },

  createThread: (rootMessage) => {
    const id = `thr-${crypto.randomUUID().slice(0, 8)}`;
    set((state) => ({
      createdThreads: {
        ...state.createdThreads,
        [id]: {
          id,
          rootMessageId: rootMessage.id,
          channelId: rootMessage.channelId,
          replyIds: [],
          participantIds: [rootMessage.authorId],
          unreadCount: 0,
        },
      },
      overrides: {
        ...state.overrides,
        [rootMessage.id]: { ...state.overrides[rootMessage.id], threadId: id },
      },
    }));
    return id;
  },

  retrySend: (ref) => {
    const state = get();
    const opId = state.opIdPorRef[ref];
    // Sem `opId` não há envelope para reenviar (§11.3: retry reenvia o MESMO).
    // Acontece só se o desfecho de erro veio antes da resposta do comando.
    if (opId === undefined) return;
    set((s) => ({
      ...withOverride(s, ref, { deliveryState: "sending" }),
      errosPorRef: Object.fromEntries(Object.entries(s.errosPorRef).filter(([id]) => id !== ref)),
    }));
    void get()
      .escrita?.reenviar(opId)
      .catch((e: unknown) => {
        set((s) => ({
          ...withOverride(s, ref, { deliveryState: "failed" }),
          errosPorRef: { ...s.errosPorRef, [ref]: e instanceof Error ? e.message : String(e) },
        }));
      });
  },

  toggleReaction: (message, emoji, userId) =>
    set((state) =>
      withOverride(state, message.id, {
        reactions: toggled(message.reactions, emoji, userId),
      }),
    ),

  setPinned: (id, pinned) =>
    set((state) => withOverride(state, id, { pinned })),

  editMessage: (id, content) =>
    set((state) => withOverride(state, id, { content, edited: true })),

  deleteMessage: (id) =>
    set((state) => ({ deletedIds: [...state.deletedIds, id] })),

  setTyping: (channelId, identityIds) =>
    set((state) => ({
      typingByChannel: { ...state.typingByChannel, [channelId]: identityIds },
    })),

  assentarAceita(ref, messageId) {
    set((state) => ({
      aceitasRefs: { ...state.aceitasRefs, [ref]: messageId },
      ...withOverride(state, ref, { deliveryState: "sent" }),
      errosPorRef: Object.fromEntries(Object.entries(state.errosPorRef).filter(([id]) => id !== ref)),
    }));
  },

  marcarFalha(ref, motivo) {
    set((state) => ({
      ...withOverride(state, ref, { deliveryState: "failed" }),
      errosPorRef: { ...state.errosPorRef, [ref]: motivo },
    }));
  },

  aplicarFila(bolhas) {
    set((state) => {
      const filaPorCanal: Record<string, Message[]> = {};
      const opIdPorRef = { ...state.opIdPorRef };
      for (const b of bolhas) {
        // Já observada na réplica: a linha real vem por `query.messages`.
        if (state.aceitasRefs[b.ref] !== undefined) continue;
        opIdPorRef[b.ref] = b.opId;
        const lista = filaPorCanal[b.channelId] ?? [];
        filaPorCanal[b.channelId] = [
          ...lista,
          {
            id: b.ref,
            channelId: b.channelId,
            authorId: useIdentityStore.getState().identity?.id ?? "",
            content: b.content,
            timestamp: new Date(0).toISOString(),
            edited: false,
            pinned: false,
            reactions: [],
            attachments: [],
            mentions: [],
            deliveryState: b.deliveryState,
          },
        ];
      }
      return { filaPorCanal, opIdPorRef };
    });
  },

  descartarCanal: (channelIds) => {
    if (channelIds.length === 0) return 0;
    const alvos = new Set(channelIds);
    let dropped = 0;
    set((state) => {
      const sentByChannel: Record<string, Message[]> = {};
      const filaPorCanal: Record<string, Message[]> = {};
      for (const [channelId, messages] of Object.entries(state.sentByChannel)) {
        if (alvos.has(channelId)) {
          dropped += messages.length;
          continue;
        }
        sentByChannel[channelId] = messages;
      }
      for (const [channelId, messages] of Object.entries(state.filaPorCanal)) {
        if (alvos.has(channelId)) {
          dropped += messages.length;
          continue;
        }
        filaPorCanal[channelId] = messages;
      }
      return { sentByChannel, filaPorCanal };
    });
    return dropped;
  },

  reset: () =>
    set({
      sentByChannel: {},
      filaPorCanal: {},
      overrides: {},
      deletedIds: [],
      createdThreads: {},
      typingByChannel: {},
      opIdPorRef: {},
      aceitasRefs: {},
      errosPorRef: {},
    }),
}));

/* ─── Seletores ──────────────────────────────────────────────────── */

/**
 * Histórico do canal: base do núcleo, depois as bolhas derivadas da outbox e as
 * da sessão, com os overrides aplicados e as mensagens deletadas fora.
 *
 * Uma bolha cujo `clientRef` já tem `messageId` observado SOME quando a linha
 * real chega à base — é o assentamento de §11.6 passo 8 (casa pelo `clientRef`,
 * posiciona pela ordem do log). Antes disso ela continua visível como "sent",
 * para a mensagem não piscar entre o evento e a reconsulta.
 *
 * A composição fica num `useMemo` sobre referências estáveis, não dentro do
 * seletor: aplicar override cria objeto novo a cada chamada, e nem
 * `useShallow` salva disso — ele compara elemento a elemento por referência
 * (a mesma armadilha que derrubou o autocomplete de menção).
 */
function compose(
  channelIds: string[],
  sentByChannel: Record<string, Message[]>,
  filaPorCanal: Record<string, Message[]>,
  overrides: Record<string, Partial<Message>>,
  deletedIds: string[],
  remoteMessages: Record<string, Message[]>,
  aceitasRefs: Record<string, string>,
): Message[] {
  const deleted = new Set(deletedIds);
  const out: Message[] = [];

  for (const channelId of channelIds) {
    const base = remoteMessages[channelId] ?? NENHUMA;
    const presentes = new Set(base.map((m) => m.id));
    const bolhas = [
      ...(filaPorCanal[channelId] ?? []),
      ...(sentByChannel[channelId] ?? []),
    ].filter((bolha) => {
      const aceitada = aceitasRefs[bolha.id];
      return aceitada === undefined || !presentes.has(aceitada);
    });
    for (const message of [...base, ...bolhas]) {
      if (deleted.has(message.id)) continue;
      const override = overrides[message.id];
      out.push(override ? { ...message, ...override } : message);
    }
  }
  return out;
}

export function useChannelMessages(channelId: string): Message[] {
  const sentByChannel = useMessageStore((state) => state.sentByChannel);
  const filaPorCanal = useMessageStore((state) => state.filaPorCanal);
  const overrides = useMessageStore((state) => state.overrides);
  const deletedIds = useMessageStore((state) => state.deletedIds);
  const remotas = useMessageStore((state) => state.remoteMessages);
  const aceitasRefs = useMessageStore((state) => state.aceitasRefs);

  return useMemo(
    () => compose([channelId], sentByChannel, filaPorCanal, overrides, deletedIds, remotas, aceitasRefs),
    [channelId, sentByChannel, filaPorCanal, overrides, deletedIds, remotas, aceitasRefs],
  );
}

/**
 * Mensagens de vários canais de uma vez — é o que a busca com escopo de
 * comunidade percorre (§8, 1.2). A chave da memo é a lista serializada, e
 * não o array, que muda de identidade a cada render de quem chama.
 */
export function useMessagesForChannels(channelIds: string[]): Message[] {
  const sentByChannel = useMessageStore((state) => state.sentByChannel);
  const filaPorCanal = useMessageStore((state) => state.filaPorCanal);
  const overrides = useMessageStore((state) => state.overrides);
  const deletedIds = useMessageStore((state) => state.deletedIds);
  const remotas = useMessageStore((state) => state.remoteMessages);
  const aceitasRefs = useMessageStore((state) => state.aceitasRefs);
  const key = channelIds.join("|");

  return useMemo(
    () =>
      compose(
        key === "" ? [] : key.split("|"),
        sentByChannel,
        filaPorCanal,
        overrides,
        deletedIds,
        remotas,
        aceitasRefs,
      ),
    [key, sentByChannel, filaPorCanal, overrides, deletedIds, remotas, aceitasRefs],
  );
}

/**
 * Thread ancorada numa mensagem (§9, 2.2). A de §2 vive na fixture; as
 * abertas no mock moram na store.
 */
export function useThreadForRoot(
  rootMessageId: string | undefined,
): Thread | undefined {
  const created = useMessageStore((state) => state.createdThreads);
  const remotas = useMessageStore((state) => state.remoteThreads);
  return useMemo(() => {
    if (!rootMessageId) return undefined;
    const match = (thread: Thread): boolean => thread.rootMessageId === rootMessageId;
    return Object.values(created).find(match) ?? Object.values(remotas).find(match);
  }, [created, remotas, rootMessageId]);
}

/**
 * Mapa `threadId → rootMessageId`. O indicador "N respostas" só pode
 * aparecer sob a raiz: a resposta também carrega o `threadId`, e sem esta
 * distinção ela anunciaria uma thread que não ancora.
 */
export function useThreadRoots(): Map<string, string> {
  const created = useMessageStore((state) => state.createdThreads);
  const remotas = useMessageStore((state) => state.remoteThreads);
  return useMemo(
    () =>
      new Map(
        [...Object.values(remotas), ...Object.values(created)].map((thread) => [
          thread.id,
          thread.rootMessageId,
        ]),
      ),
    [created, remotas],
  );
}

/** Respostas de uma thread, em ordem cronológica, sem a mensagem raiz. */
export function useThreadReplies(
  channelId: string,
  thread: Thread | undefined,
): Message[] {
  const messages = useChannelMessages(channelId);
  return useMemo(
    () =>
      thread
        ? messages.filter(
            (message) =>
              message.threadId === thread.id &&
              message.id !== thread.rootMessageId,
          )
        : [],
    [messages, thread],
  );
}

export function useTypingIn(channelId: string): string[] {
  return useMessageStore(
    useShallow((state) => state.typingByChannel[channelId] ?? []),
  );
}

/**
 * Quantas mensagens deste canal ainda não foram observadas na réplica — a
 * contagem honesta de fila: bolhas da sessão e da outbox em `queued`/`sending`,
 * exceto as já aceitas (§11.3: aceito é quem saiu da fila por observação).
 */
export function contaPendentes(state: MessageState, channelId: string): number {
  const pendentes = (messages: Message[]): number =>
    messages.filter(
      (message) =>
        state.aceitasRefs[message.id] === undefined &&
        (deliveryOf(state, message) === "queued" ||
          deliveryOf(state, message) === "sending"),
    ).length;
  return (
    pendentes(state.sentByChannel[channelId] ?? []) +
    pendentes(state.filaPorCanal[channelId] ?? [])
  );
}

export function useQueuedCount(channelId: string): number {
  return useMessageStore((state) => contaPendentes(state, channelId));
}
