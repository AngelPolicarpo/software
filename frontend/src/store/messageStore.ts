import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Attachment, AttachmentKind, Message, Reaction, Thread } from "../domain/types";
import { useIdentityStore } from "./identityStore";
import { useToastStore } from "./toastStore";

/** Número do fio (§7.4.1) → token do domínio; a ordem É a de §13.6. */
const KINDS_DE_FIO: Record<number, AttachmentKind> = {
  0: "image",
  1: "video",
  2: "audio",
  3: "document",
  4: "other",
  5: "other",
};

/**
 * O anexo da PRÓPRIA bolha: nasce local (staging deste membro, §13.2) e já
 * disponibilizado como seed — progresso 100 é a verdade, não otimismo.
 */
function anexoDaBolha(attachment: { nome: string; tamanho: number; kind: number; hash: string }): Attachment {
  return {
    id: attachment.hash.slice(0, 32),
    name: attachment.nome,
    sizeBytes: attachment.tamanho,
    kind: KINDS_DE_FIO[attachment.kind] ?? "other",
    downloadProgress: 100,
    availablePeers: 0,
    hostAvailable: false,
  };
}

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
 * O canal de escrita injetado pelo sincronizador. Cada método devolve o `opId`
 * da op enfileirada (§15.4 responde `{opId, state}`), ou `{ cancelado: true }`
 * quando o gesto do usuário abortou antes do quadro — cancelar não é falha.
 * Quem resolve `communityId` a partir do canal é o sincronizador; a store não
 * conhece o mapeamento nem o transporte.
 */
export interface CanalDeEscrita {
  enviar(entrada: {
    communityId: string;
    channelId: string;
    content: string;
    mentions: string[];
    replyToId?: string;
    threadId?: string;
    /** §13.7 — o fio recebe o ticketId e NADA mais do anexo. */
    attachment?: { ticketId: string };
    /** Id da bolha otimista; é o `clientRef` de §11.2/F-44. */
    clientRef: string;
  }): Promise<{ opId: string; cancelado?: boolean }>;
  /** §15.1 r. 7 / §11.3 — reenvia o MESMO envelope, mesmo `opId`. */
  reenviar(opId: string): Promise<void>;
  editar(entrada: { channelId: string; messageId: string; content: string; clientRef: string }): Promise<{ opId: string }>;
  apagar(entrada: { channelId: string; messageId: string; clientRef: string }): Promise<{ opId: string }>;
  fixar(entrada: { channelId: string; messageId: string; pinned: boolean; clientRef: string }): Promise<{ opId: string }>;
  reagir(entrada: { channelId: string; messageId: string; emoji: string; present: boolean; clientRef: string }): Promise<{ opId: string }>;
  abrirThread(entrada: { channelId: string; rootMessageId: string; clientRef: string }): Promise<{ opId: string }>;
  /** Hidratação de reações (`query.message` → `MessageFull.reactions`, §15.6.1). */
  observarReacoes(channelId: string, messageId: string): void;
  /** Hidratação de thread (`query.thread` → respostas além da janela do canal, §15.6). */
  observarThread(communityId: string, threadId: string): void;
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
  /**
   * Anexo já STAGED (§13.2/§13.7): ao fio vai só o `ticketId`; o resto descreve a
   * bolha otimista — quem descreve o blob para o log é o núcleo, a partir do que
   * ele mesmo escreveu.
   */
  attachment?: { ticketId: string; nome: string; tamanho: number; kind: number; hash: string };
}

const NENHUMA: Message[] = [];

/** Prefixo do id provisório de thread, até a projeção trazer o real (§8.x R-24). */
export const THREAD_TEMPORARIA_PREFIXO = "thr-temp-";

interface MessageState {
  /** Base vinda do núcleo, por canal (§15.6 `query.messages`). */
  remoteMessages: Record<string, Message[]>;
  /** Threads vindas de `query.thread`, por id. */
  remoteThreads: Record<string, Thread>;
  /**
   * Leitura de §15.6 `query.thread` por thread aberta no painel: as respostas que a
   * página do canal não carrega (janela de 50) mais o total do fio. `null` total é
   * "consulta não concluída", não zero.
   */
  threadLeituras: Record<string, { respostas: Message[]; total: number | null }>;
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
  /**
   * Reações projetadas que `MessageDto` não carrega — vêm de `query.message`
   * por demanda (§15.6.1) e servem de base ao toggle otimista.
   */
  remoteReactions: Record<string, Reaction[]>;
  /** Anexo de §15.6.1 hidratado por `query.message`, por mensagem — o fio traz no máximo um. */
  anexosRemotos: Record<string, Attachment>;
  /**
   * Como desfazer cada escrita de mensagem ainda não aceita, com o rótulo da
   * ação para o aviso. Entra no desfecho de falha e sai no de aceite — uma
   * recusa nunca fica aplicada em silêncio (lição de §58.11/§59).
   */
  undoPorRef: Record<string, { acao: string; desfazer: () => void }>;

  /** O transporte corrente; `null` é "sem núcleo". Injetado pelo sincronizador. */
  escrita: CanalDeEscrita | null;

  /** Injeção do transporte; `null` devolve ao estado sem núcleo. Idempotente. */
  configurarEscrita(canal: CanalDeEscrita | null): void;
  send: (input: SendMessageInput) => Promise<void>;
  /** Abre thread numa mensagem que ainda não tem — devolve o id (temporário até a projeção). */
  createThread: (rootMessage: Message) => string;
  retrySend: (ref: string) => void;
  toggleReaction: (message: Message, emoji: string, userId: string) => void;
  setPinned: (message: Message, pinned: boolean) => void;
  editMessage: (message: Message, content: string) => void;
  deleteMessage: (message: Message) => void;
  setTyping: (channelId: string, identityIds: string[]) => void;

  /* ─── Leitura sob demanda e reconciliação fina — chamadas por telas/sincronizador ─── */

  /** Pede ao sincronizador as reações projetadas de uma mensagem (`query.message`). */
  hidratarReacoes: (channelId: string, messageId: string) => void;
  /** Mescla reações vindas de `query.message` na base sob o override otimista. */
  aplicarReacoesRemotas: (messageId: string, reactions: Reaction[]) => void;
  /** Guarda o anexo que `query.message` trouxe para uma mensagem (§15.6.1). */
  aplicarAnexoRemoto: (messageId: string, anexo: Attachment) => void;
  /** Pede ao sincronizador a thread projetada (`query.thread`) — painel aberto. */
  hidratarThread: (communityId: string, threadId: string) => void;
  /** Guarda o que `query.thread` respondeu, para a vista mesclar com a página do canal. */
  aplicarThreadRemota: (threadId: string, leitura: { respostas: Message[]; total: number }) => void;
  /** A raiz projetou o `threadId` real: substitui o temporário da criação otimista. */
  assentarThreadReal: (rootMessageId: string, threadIdReal: string) => void;

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

export const useMessageStore = create<MessageState>()((set, get) => {
  /**
   * Despacha uma escrita de mensagem pelo canal injetado. Falha de transporte
   * ou recusa futura do fold caem em `marcarFalha`, que é quem desfaz o
   * otimismo e avisa — o padrão é sempre o mesmo desfecho por evento (§11.1).
   */
  function despachar(ref: string, chamada: (canal: CanalDeEscrita) => Promise<{ opId: string }>): void {
    const canal = get().escrita;
    if (canal === null) {
      get().marcarFalha(ref, "O núcleo não está acessível");
      return;
    }
    chamada(canal)
      .then((r) => set((s) => ({ opIdPorRef: { ...s.opIdPorRef, [ref]: r.opId } })))
      .catch((e: unknown) => get().marcarFalha(ref, e instanceof Error ? e.message : String(e)));
  }

  return {
  remoteMessages: {},
  remoteThreads: {},
  aplicarRemoto: (patch) => set(patch),
  threadLeituras: {},
  sentByChannel: {},
  filaPorCanal: {},
  overrides: {},
  deletedIds: [],
  createdThreads: {},
  typingByChannel: {},
  opIdPorRef: {},
  aceitasRefs: {},
  errosPorRef: {},
  remoteReactions: {},
  anexosRemotos: {},
  undoPorRef: {},

  escrita: null,
  configurarEscrita(canal) {
    set({ escrita: canal });
  },

  async send({ communityId, channelId, content, mentions, replyToId, threadId, attachment }) {
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
      attachments: attachment !== undefined ? [anexoDaBolha(attachment)] : [],
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
        ...(attachment !== undefined ? { attachment: { ticketId: attachment.ticketId } } : {}),
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
    // R-24 — uma thread por raiz; já existindo (real ou em criação), é ela.
    if (rootMessage.threadId !== undefined && !rootMessage.threadId.startsWith(THREAD_TEMPORARIA_PREFIXO)) {
      return rootMessage.threadId;
    }
    const tempId = `${THREAD_TEMPORARIA_PREFIXO}${crypto.randomUUID().slice(0, 8)}`;
    const ref = clientRef();
    set((state) => ({
      createdThreads: {
        ...state.createdThreads,
        [tempId]: {
          id: tempId,
          rootMessageId: rootMessage.id,
          channelId: rootMessage.channelId,
          replyIds: [],
          participantIds: [rootMessage.authorId],
          unreadCount: 0,
        },
      },
      overrides: {
        ...state.overrides,
        [rootMessage.id]: { ...state.overrides[rootMessage.id], threadId: tempId },
      },
      undoPorRef: {
        ...state.undoPorRef,
        [ref]: {
          acao: "abrir a thread",
          desfazer: () =>
            useMessageStore.setState((s) => {
              const createdThreads = { ...s.createdThreads };
              delete createdThreads[tempId];
              let overrides = s.overrides;
              if (overrides[rootMessage.id]?.threadId === tempId) {
                const resto = { ...overrides[rootMessage.id] };
                delete resto.threadId;
                overrides = { ...overrides, [rootMessage.id]: resto };
              }
              return { createdThreads, overrides };
            }),
        },
      },
    }));
    despachar(ref, (canal) =>
      canal.abrirThread({ channelId: rootMessage.channelId, rootMessageId: rootMessage.id, clientRef: ref }),
    );
    return tempId;
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

  toggleReaction: (message, emoji, userId) => {
    const state = get();
    // Base mesclada: o que `query.message` trouxe por cima da lista vazia de §15.6.1,
    // e por fim o próprio override — reações em voo mandam até serem observadas.
    const base =
      state.overrides[message.id]?.reactions ??
      (message.reactions.length > 0 ? message.reactions : state.remoteReactions[message.id] ?? []);
    const atual = base.find((reaction) => reaction.emoji === emoji);
    const present = !(atual?.userIds.includes(userId) ?? false);
    const overrideAntes = state.overrides[message.id];
    const ref = clientRef();
    set((s) => ({
      ...withOverride(s, message.id, { reactions: toggled(base, emoji, userId) }),
      undoPorRef: {
        ...s.undoPorRef,
        [ref]: {
          acao: "reagir à mensagem",
          desfazer: () =>
            useMessageStore.setState((s2) => {
              const overrides = { ...s2.overrides };
              if (overrideAntes === undefined) delete overrides[message.id];
              else overrides[message.id] = overrideAntes;
              return { overrides };
            }),
        },
      },
    }));
    despachar(ref, (canal) =>
      canal.reagir({ channelId: message.channelId, messageId: message.id, emoji, present, clientRef: ref }),
    );
  },

  setPinned: (message, pinned) => {
    const overrideAntes = get().overrides[message.id];
    const ref = clientRef();
    set((s) => ({
      ...withOverride(s, message.id, { pinned }),
      undoPorRef: {
        ...s.undoPorRef,
        [ref]: {
          acao: pinned ? "fixar a mensagem" : "desafixar a mensagem",
          desfazer: () =>
            useMessageStore.setState((s2) => {
              const overrides = { ...s2.overrides };
              if (overrideAntes === undefined) delete overrides[message.id];
              else overrides[message.id] = overrideAntes;
              return { overrides };
            }),
        },
      },
    }));
    despachar(ref, (canal) =>
      canal.fixar({ channelId: message.channelId, messageId: message.id, pinned, clientRef: ref }),
    );
  },

  editMessage: (message, content) => {
    // Rollback EXATO: restaura o override como estava (ou remove a chave se não havia).
    const overrideAntes = get().overrides[message.id];
    const ref = clientRef();
    set((s) => ({
      ...withOverride(s, message.id, { content, edited: true }),
      undoPorRef: {
        ...s.undoPorRef,
        [ref]: {
          acao: "editar a mensagem",
          desfazer: () =>
            useMessageStore.setState((s2) => {
              const overrides = { ...s2.overrides };
              if (overrideAntes === undefined) delete overrides[message.id];
              else overrides[message.id] = overrideAntes;
              return { overrides };
            }),
        },
      },
    }));
    despachar(ref, (canal) =>
      canal.editar({ channelId: message.channelId, messageId: message.id, content, clientRef: ref }),
    );
  },

  deleteMessage: (message) => {
    const ref = clientRef();
    set((s) => ({
      deletedIds: [...s.deletedIds, message.id],
      undoPorRef: {
        ...s.undoPorRef,
        [ref]: {
          acao: "apagar a mensagem",
          desfazer: () =>
            useMessageStore.setState((s2) => ({
              deletedIds: s2.deletedIds.filter((id) => id !== message.id),
            })),
        },
      },
    }));
    despachar(ref, (canal) =>
      canal.apagar({ channelId: message.channelId, messageId: message.id, clientRef: ref }),
    );
  },

  setTyping: (channelId, identityIds) =>
    set((state) => ({
      typingByChannel: { ...state.typingByChannel, [channelId]: identityIds },
    })),

  assentarAceita(ref, messageId) {
    set((state) => {
      // Aceite descarta o rollback: observado na réplica, não há o que desfazer.
      const undoPorRef = { ...state.undoPorRef };
      delete undoPorRef[ref];
      return {
        aceitasRefs: { ...state.aceitasRefs, [ref]: messageId },
        ...withOverride(state, ref, { deliveryState: "sent" }),
        errosPorRef: Object.fromEntries(Object.entries(state.errosPorRef).filter(([id]) => id !== ref)),
        undoPorRef,
      };
    });
  },

  marcarFalha(ref, motivo) {
    const undo = get().undoPorRef[ref];
    if (undo !== undefined) {
      // Escrita sobre mensagem real (editar/apagar/fixar/reagir/thread): a recusa
      // desfaz o otimismo e avisa nomeado — nunca fica aplicada em silêncio.
      undo.desfazer();
      useToastStore.getState().showToast(`Não foi possível ${undo.acao} (${motivo})`, "error");
      set((state) => {
        const undoPorRef = { ...state.undoPorRef };
        delete undoPorRef[ref];
        return { undoPorRef };
      });
      return;
    }
    set((state) => ({
      ...withOverride(state, ref, { deliveryState: "failed" }),
      errosPorRef: { ...state.errosPorRef, [ref]: motivo },
    }));
  },

  hidratarReacoes(channelId, messageId) {
    get().escrita?.observarReacoes(channelId, messageId);
  },

  aplicarReacoesRemotas(messageId, reactions) {
    set((state) => ({ remoteReactions: { ...state.remoteReactions, [messageId]: reactions } }));
  },

  aplicarAnexoRemoto(messageId, anexo) {
    set((state) => ({ anexosRemotos: { ...state.anexosRemotos, [messageId]: anexo } }));
  },

  hidratarThread(communityId, threadId) {
    get().escrita?.observarThread(communityId, threadId);
  },

  aplicarThreadRemota(threadId, leitura) {
    set((state) => ({ threadLeituras: { ...state.threadLeituras, [threadId]: leitura } }));
  },

  assentarThreadReal(rootMessageId, threadIdReal) {
    set((state) => {
      const temp = Object.values(state.createdThreads).find(
        (t) => t.rootMessageId === rootMessageId && t.id.startsWith(THREAD_TEMPORARIA_PREFIXO),
      );
      if (temp === undefined || temp.id === threadIdReal) return {};
      const createdThreads = { ...state.createdThreads };
      delete createdThreads[temp.id];
      createdThreads[threadIdReal] = { ...temp, id: threadIdReal };
      let overrides = state.overrides;
      if (overrides[rootMessageId]?.threadId === temp.id) {
        overrides = { ...overrides, [rootMessageId]: { ...overrides[rootMessageId], threadId: threadIdReal } };
      }
      return { createdThreads, overrides };
    });
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
      threadLeituras: {},
      typingByChannel: {},
      opIdPorRef: {},
      aceitasRefs: {},
      errosPorRef: {},
      remoteReactions: {},
      anexosRemotos: {},
      undoPorRef: {},
    }),
  };
});

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
/** Exportado para o teste exercitar a mescla sem renderizar (hooks exigem React). */
export function compose(
  channelIds: string[],
  sentByChannel: Record<string, Message[]>,
  filaPorCanal: Record<string, Message[]>,
  overrides: Record<string, Partial<Message>>,
  deletedIds: string[],
  remoteMessages: Record<string, Message[]>,
  aceitasRefs: Record<string, string>,
  remoteReactions: Record<string, Reaction[]>,
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
      let efetiva = override ? { ...message, ...override } : message;
      // §15.6.1 — a lista não carrega reações; o que `query.message` hidratou
      // entra como base onde a linha ainda está vazia. Override otimista manda.
      if (efetiva.reactions.length === 0 && remoteReactions[message.id] !== undefined) {
        efetiva = { ...efetiva, reactions: remoteReactions[message.id] };
      }
      out.push(efetiva);
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
  const remoteReactions = useMessageStore((state) => state.remoteReactions);

  return useMemo(
    () =>
      compose([channelId], sentByChannel, filaPorCanal, overrides, deletedIds, remotas, aceitasRefs, remoteReactions),
    [channelId, sentByChannel, filaPorCanal, overrides, deletedIds, remotas, aceitasRefs, remoteReactions],
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
  const remoteReactions = useMessageStore((state) => state.remoteReactions);
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
        remoteReactions,
      ),
    [key, sentByChannel, filaPorCanal, overrides, deletedIds, remotas, aceitasRefs, remoteReactions],
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

/** A leitura de `query.thread` de uma thread, quando já veio. */
export function useThreadLeitura(
  threadId: string | undefined,
): { respostas: Message[]; total: number | null } | undefined {
  return useMessageStore((state) =>
    threadId === undefined ? undefined : state.threadLeituras[threadId],
  );
}

/** O anexo hidratado de `query.message` para uma mensagem (§15.6.1 — no máximo um). */
export function useAnexoRemoto(messageId: string): Attachment | undefined {
  return useMessageStore((state) => state.anexosRemotos[messageId]);
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
