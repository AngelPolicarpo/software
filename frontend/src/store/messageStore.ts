import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Attachment, Message } from "../domain/types";
import { findChannelMessages } from "../mocks/dataset";

/**
 * Mensagens enviadas nesta sessão (§9, 2.1 · fluxos C9 e B4).
 *
 * Mesma divisão de `communityStore`: a transcrição de §2 vive nas fixtures —
 * é o histórico que já existia — e o que Ana escreve no mock mora aqui.
 * Nada é persistido: recarregar a página devolve o canal ao estado
 * documentado na spec, que é o que §19 pede para conferir.
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
  /** Host offline → entra na fila local em vez de bloquear (premissa 5). */
  queued: boolean;
}

interface MessageState {
  sentByChannel: Record<string, Message[]>;
  /** Quem está digitando agora, por canal (§9, 2.1). */
  typingByChannel: Record<string, string[]>;
  /** Afinador de §19.1 — sem rede real não há como provocar uma falha. */
  failNextSend: boolean;

  send: (input: SendMessageInput) => void;
  retrySend: (channelId: string, messageId: string) => void;
  /** Host voltou: a fila local é entregue (§11, B4 passo 4). */
  flushQueued: (channelIds: string[]) => void;
  setTyping: (channelId: string, identityIds: string[]) => void;
  setFailNextSend: (value: boolean) => void;
  reset: () => void;
}

function messageId(): string {
  const buffer = new Uint8Array(6);
  crypto.getRandomValues(buffer);
  return `msg-${Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Troca uma mensagem no lugar, sem tocar nas demais nem no resto da store. */
function patchMessage(
  state: MessageState,
  channelId: string,
  id: string,
  patch: Partial<Message>,
): Pick<MessageState, "sentByChannel"> {
  const messages = state.sentByChannel[channelId] ?? [];
  return {
    sentByChannel: {
      ...state.sentByChannel,
      [channelId]: messages.map((message) =>
        message.id === id ? { ...message, ...patch } : message,
      ),
    },
  };
}

export const useMessageStore = create<MessageState>()((set, get) => ({
  sentByChannel: {},
  typingByChannel: {},
  failNextSend: false,

  send: ({ channelId, authorId, content, mentions, attachment, queued }) => {
    const id = messageId();
    const message: Message = {
      id,
      channelId,
      authorId,
      content,
      timestamp: new Date().toISOString(),
      edited: false,
      pinned: false,
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
        patchMessage(state, channelId, id, {
          deliveryState: shouldFail ? "failed" : "sent",
        }),
      );
    }, SEND_CONFIRM_MS);
  },

  retrySend: (channelId, id) => {
    set((state) => patchMessage(state, channelId, id, { deliveryState: "sending" }));
    window.setTimeout(() => {
      set((state) => patchMessage(state, channelId, id, { deliveryState: "sent" }));
    }, SEND_CONFIRM_MS);
  },

  flushQueued: (channelIds) =>
    set((state) => {
      const next = { ...state.sentByChannel };
      for (const channelId of channelIds) {
        const messages = next[channelId];
        if (!messages?.some((message) => message.deliveryState === "queued"))
          continue;
        next[channelId] = messages.map((message) =>
          message.deliveryState === "queued"
            ? { ...message, deliveryState: "sent" }
            : message,
        );
      }
      return { sentByChannel: next };
    }),

  setTyping: (channelId, identityIds) =>
    set((state) => ({
      typingByChannel: { ...state.typingByChannel, [channelId]: identityIds },
    })),

  setFailNextSend: (value) => set({ failNextSend: value }),

  reset: () => set({ sentByChannel: {}, typingByChannel: {}, failNextSend: false }),
}));

/* ─── Seletores ──────────────────────────────────────────────────── */

/**
 * Histórico do canal: a transcrição de §2 primeiro, o que foi escrito nesta
 * sessão depois. Monta array novo a cada chamada, então passa por
 * `useShallow` — Zustand v5 compara por referência e entraria em loop.
 */
export function useChannelMessages(channelId: string): Message[] {
  return useMessageStore(
    useShallow((state) => {
      const sent = state.sentByChannel[channelId];
      const base = findChannelMessages(channelId);
      return sent && sent.length > 0 ? [...base, ...sent] : base;
    }),
  );
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
      messages.some((message) => message.deliveryState === "queued"),
    )
    .map(([channelId]) => channelId);
}
