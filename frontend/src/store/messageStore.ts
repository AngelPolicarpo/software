import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Attachment, Message, Reaction } from "../domain/types";
import { findChannelMessages } from "../mocks/dataset";

/**
 * Mensagens da sessão (§9, 2.1 · fluxos C9 e B4).
 *
 * Mesma divisão de `communityStore`: a transcrição de §2 vive nas fixtures —
 * é o histórico que já existia — e o que acontece no mock mora aqui. Toda
 * mutação (reação, fixar, editar, deletar, estado de entrega) é um
 * *override* por id, para que a fixture continue intacta e recarregar a
 * página devolva o canal ao estado documentado na spec, que é o que §19
 * manda conferir.
 */

/** C9 passo 4 — confirmação simulada do envio. */
const SEND_CONFIRM_MS = 800;

export interface SendMessageInput {
  channelId: string;
  authorId: string;
  content: string;
  /** Ids de membros/cargos mencionados; `@everyone` usa o id `everyone`. */
  mentions: string[];
  attachment?: Attachment;
  replyToId?: string;
  /** Host offline → entra na fila local em vez de bloquear (premissa 5). */
  queued: boolean;
}

interface MessageState {
  sentByChannel: Record<string, Message[]>;
  /** Mudanças de sessão sobre qualquer mensagem, por id. */
  overrides: Record<string, Partial<Message>>;
  deletedIds: string[];
  /** Quem está digitando agora, por canal (§9, 2.1). */
  typingByChannel: Record<string, string[]>;
  /** Afinador de §19.1 — sem rede real não há como provocar uma falha. */
  failNextSend: boolean;

  send: (input: SendMessageInput) => void;
  retrySend: (messageId: string) => void;
  /** Host voltou: a fila local é entregue (§11, B4 passo 4). */
  flushQueued: (channelIds: string[]) => void;
  toggleReaction: (message: Message, emoji: string, userId: string) => void;
  setPinned: (messageId: string, pinned: boolean) => void;
  editMessage: (messageId: string, content: string) => void;
  deleteMessage: (messageId: string) => void;
  setTyping: (channelId: string, identityIds: string[]) => void;
  setFailNextSend: (value: boolean) => void;
  reset: () => void;
}

function messageId(): string {
  const buffer = new Uint8Array(6);
  crypto.getRandomValues(buffer);
  return `msg-${Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("")}`;
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
  sentByChannel: {},
  overrides: {},
  deletedIds: [],
  typingByChannel: {},
  failNextSend: false,

  send: ({
    channelId,
    authorId,
    content,
    mentions,
    attachment,
    replyToId,
    queued,
  }) => {
    const id = messageId();
    const message: Message = {
      id,
      channelId,
      authorId,
      content,
      timestamp: new Date().toISOString(),
      edited: false,
      pinned: false,
      replyToId,
      reactions: [],
      attachments: attachment ? [attachment] : [],
      mentions,
      deliveryState: queued ? "queued" : "sending",
    };

    set((state) => ({
      sentByChannel: {
        ...state.sentByChannel,
        [channelId]: [...(state.sentByChannel[channelId] ?? []), message],
      },
    }));

    // Fila local não tem confirmação: ela espera o host voltar (B4).
    if (queued) return;

    const shouldFail = get().failNextSend;
    if (shouldFail) set({ failNextSend: false });

    window.setTimeout(() => {
      set((state) =>
        withOverride(state, id, {
          deliveryState: shouldFail ? "failed" : "sent",
        }),
      );
    }, SEND_CONFIRM_MS);
  },

  retrySend: (id) => {
    set((state) => withOverride(state, id, { deliveryState: "sending" }));
    window.setTimeout(() => {
      set((state) => withOverride(state, id, { deliveryState: "sent" }));
    }, SEND_CONFIRM_MS);
  },

  flushQueued: (channelIds) =>
    set((state) => {
      const overrides = { ...state.overrides };
      for (const channelId of channelIds) {
        for (const message of state.sentByChannel[channelId] ?? []) {
          const current =
            overrides[message.id]?.deliveryState ?? message.deliveryState;
          if (current !== "queued") continue;
          overrides[message.id] = {
            ...overrides[message.id],
            deliveryState: "sent",
          };
        }
      }
      return { overrides };
    }),

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

  setFailNextSend: (value) => set({ failNextSend: value }),

  reset: () =>
    set({
      sentByChannel: {},
      overrides: {},
      deletedIds: [],
      typingByChannel: {},
      failNextSend: false,
    }),
}));

/* ─── Seletores ──────────────────────────────────────────────────── */

/**
 * Histórico do canal: a transcrição de §2 primeiro, o que foi escrito nesta
 * sessão depois, com os overrides aplicados e as mensagens deletadas fora.
 *
 * A composição fica num `useMemo` sobre referências estáveis, não dentro do
 * seletor: aplicar override cria objeto novo a cada chamada, e nem
 * `useShallow` salva disso — ele compara elemento a elemento por referência
 * (a mesma armadilha que derrubou o autocomplete de menção).
 */
export function useChannelMessages(channelId: string): Message[] {
  const sent = useMessageStore((state) => state.sentByChannel[channelId]);
  const overrides = useMessageStore((state) => state.overrides);
  const deletedIds = useMessageStore((state) => state.deletedIds);

  return useMemo(() => {
    const base = findChannelMessages(channelId);
    const all = sent && sent.length > 0 ? [...base, ...sent] : base;
    const deleted = new Set(deletedIds);

    return all
      .filter((message) => !deleted.has(message.id))
      .map((message) => {
        const override = overrides[message.id];
        return override ? { ...message, ...override } : message;
      });
  }, [channelId, sent, overrides, deletedIds]);
}

export function useTypingIn(channelId: string): string[] {
  return useMessageStore(
    useShallow((state) => state.typingByChannel[channelId] ?? []),
  );
}

/** Canais da comunidade com mensagem na fila local — usado ao reconectar. */
export function selectQueuedChannelIds(state: MessageState): string[] {
  return Object.entries(state.sentByChannel)
    .filter(([, messages]) =>
      messages.some(
        (message) =>
          (state.overrides[message.id]?.deliveryState ??
            message.deliveryState) === "queued",
      ),
    )
    .map(([channelId]) => channelId);
}
