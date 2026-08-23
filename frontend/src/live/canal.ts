/**
 * Canal aberto — mensagens, fila de envio, digitando e roster (§15.4, §15.5, §15.6).
 *
 * **A fila é honesta.** `message.send` responde `{opId, state:'queued'}` e mais nada: a
 * mensagem ainda não existe, não tem `seq` e não tem hora do host. O desfecho REAL chega por
 * evento — `message.accepted` (depois de `messages.appended`, §11.6 r. 2), `message.failed`
 * ou `message.dropped`. Nada aqui simula a mensagem no meio da lista como se já tivesse
 * chegado; a fila é desenhada como fila, abaixo do que o log tem.
 *
 * **Nada é reenviado sozinho.** Em `E_CORE_RESTARTED` a escrita em voo não se perde nem se
 * duplica: ela está na outbox (§15.2 passo 5), e é `query.outbox` — com o `preview` que
 * existe exatamente para isso (F-16) — que redesenha a fila. Reenviar seria a UI decidindo
 * por cima de §11.6.
 */

import { create } from "zustand";
import { api, cliente } from "../ipc/api";
import { registrarResync } from "./sessao";
import type {
  EvMessageAccepted,
  EvMessageDropped,
  EvMessageFailed,
  EvMessagesAppended,
  EvTypingChanged,
  MembersPage,
  MessageDto,
  ReplicationState,
} from "../ipc/dto";

export interface ItemDaFila {
  opId: string;
  clientRef?: string;
  /** O que a pessoa escreveu — do `preview.content` da outbox ao reabrir (§15.6). */
  content?: string;
  state: string;
  attempts?: number;
  lastError?: string;
  droppedReason?: string;
  terminal?: boolean;
}

interface Canal {
  communityId: string | null;
  channelId: string | null;
  mensagens: MessageDto[];
  temMais: boolean;
  proximoCursor: string | undefined;
  replicacao: ReplicationState | null;
  fila: ItemDaFila[];
  digitando: string[];
  membros: MembersPage | null;
  carregando: boolean;
  erro: string | null;

  abrir(communityId: string, channelId: string): Promise<void>;
  fechar(): Promise<void>;
  recarregar(): Promise<void>;
  carregarMais(): Promise<void>;
  recarregarFila(): Promise<void>;
  enviar(content: string): Promise<void>;
  tentarDeNovo(opId: string): Promise<void>;
  cancelar(opId: string): Promise<void>;
}

const LIMITE = 50;

/** `clientRef` é a correlação da UI com o desfecho; o núcleo o devolve nos três eventos. */
function novoClientRef(): string {
  return `cr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useCanal = create<Canal>((set, get) => ({
  communityId: null,
  channelId: null,
  mensagens: [],
  temMais: false,
  proximoCursor: undefined,
  replicacao: null,
  fila: [],
  digitando: [],
  membros: null,
  carregando: false,
  erro: null,

  async abrir(communityId, channelId) {
    const atual = get();
    if (atual.communityId === communityId && atual.channelId === channelId) return;
    // Emenda de §15.4 sobre §17.6: quem SAI do canal cancela a assinatura de typing dele.
    if (atual.communityId !== null && atual.channelId !== null) {
      await api
        .channelSubscribeTyping({ communityId: atual.communityId, channelId: atual.channelId, on: false })
        .catch(() => undefined);
    }
    set({
      communityId,
      channelId,
      mensagens: [],
      temMais: false,
      proximoCursor: undefined,
      replicacao: null,
      fila: [],
      digitando: [],
      membros: null,
      carregando: true,
      erro: null,
    });
    // Abrir o canal É o gatilho da assinatura de typing (§17.6 + emenda de §15.4 em §56).
    await api.channelSubscribeTyping({ communityId, channelId, on: true }).catch(() => undefined);
    await get().recarregar();
    await api.channelMarkRead({ communityId, channelId }).catch(() => undefined);
    void api
      .members({ communityId })
      .then((membros) => {
        if (get().communityId === communityId) set({ membros });
      })
      .catch(() => undefined);
  },

  async fechar() {
    const { communityId, channelId } = get();
    if (communityId !== null && channelId !== null) {
      await api.channelSubscribeTyping({ communityId, channelId, on: false }).catch(() => undefined);
    }
    set({ communityId: null, channelId: null, mensagens: [], fila: [], digitando: [], membros: null });
  },

  async recarregar() {
    const { communityId, channelId } = get();
    if (communityId === null || channelId === null) return;
    try {
      const pagina = await api.messages({ communityId, channelId, limit: LIMITE, direction: "before" });
      if (get().channelId !== channelId) return;
      set({
        mensagens: pagina.messages,
        temMais: pagina.hasMore,
        proximoCursor: pagina.nextCursor,
        replicacao: pagina.replication,
        carregando: false,
        erro: null,
      });
      await get().recarregarFila();
    } catch (e) {
      if (get().channelId !== channelId) return;
      set({ carregando: false, erro: e instanceof Error ? e.message : "falha ao ler o canal" });
    }
  },

  async carregarMais() {
    const { communityId, channelId, proximoCursor, temMais, mensagens } = get();
    if (communityId === null || channelId === null || !temMais || proximoCursor === undefined) return;
    const pagina = await api.messages({
      communityId,
      channelId,
      cursor: proximoCursor,
      limit: LIMITE,
      direction: "before",
    });
    if (get().channelId !== channelId) return;
    set({
      mensagens: [...pagina.messages, ...mensagens],
      temMais: pagina.hasMore,
      proximoCursor: pagina.nextCursor,
    });
  },

  async recarregarFila() {
    const { communityId, channelId } = get();
    if (communityId === null) return;
    try {
      const outbox = await api.outbox(communityId);
      if (get().communityId !== communityId) return;
      // A fila mostrada é a DESTE canal. `channelId` é opcional na linha de §15.6 (nem toda
      // op é de canal); sem ele, o item não é deste canal e não entra.
      const fila = outbox.items
        .filter((i) => i.channelId === channelId)
        .map<ItemDaFila>((i) => ({
          opId: i.opId,
          clientRef: i.clientRef,
          content: i.preview?.content,
          state: i.state,
          attempts: i.attempts,
          lastError: i.lastError,
          droppedReason: i.droppedReason,
        }));
      set({ fila });
    } catch {
      // Falha ao ler a outbox não pode apagar a fila que a tela já mostra.
    }
  },

  async enviar(content) {
    const { communityId, channelId } = get();
    if (communityId === null || channelId === null) return;
    const clientRef = novoClientRef();
    const r = await api.messageSend({ communityId, channelId, content, clientRef });
    // A resposta é exatamente o que entra na fila: `opId` e `state`. Nada de `seq`, nada de
    // hora — esses só existem depois que o host aceitou.
    set((s) => ({ fila: [...s.fila, { opId: r.opId, clientRef, content, state: r.state }] }));
  },

  async tentarDeNovo(opId) {
    const r = await api.messageRetry(opId);
    set((s) => ({ fila: s.fila.map((i) => (i.opId === opId ? { ...i, state: r.state, lastError: undefined } : i)) }));
  },

  async cancelar(opId) {
    await api.messageCancelQueued(opId);
    set((s) => ({ fila: s.fila.filter((i) => i.opId !== opId) }));
  },
}));

export function assinarCanal(): () => void {
  const store = useCanal;
  const recarregar = (): void => {
    void store.getState().recarregar();
  };

  const locais = [
    cliente.subscribe("messages.appended", (data) => {
      const ev = data as EvMessagesAppended;
      const s = store.getState();
      if (ev.communityId === s.communityId && ev.channelId === s.channelId) recarregar();
    }),
    cliente.subscribe("message.updated", (data) => {
      const ev = data as { communityId?: string; channelId?: string };
      const s = store.getState();
      if (ev.communityId === s.communityId && ev.channelId === s.channelId) recarregar();
    }),
    // §11.6 r. 2 — `accepted` chega DEPOIS do `messages.appended`: quando ele chega, a
    // mensagem já está na lista, e o item sai da fila sem piscar.
    cliente.subscribe("message.accepted", (data) => {
      const ev = data as EvMessageAccepted;
      store.setState((s) => ({ fila: s.fila.filter((i) => i.opId !== ev.opId) }));
    }),
    cliente.subscribe("message.failed", (data) => {
      const ev = data as EvMessageFailed;
      store.setState((s) => ({
        fila: s.fila.map((i) =>
          i.opId === ev.opId ? { ...i, state: "failed", lastError: ev.code, terminal: ev.terminal } : i,
        ),
      }));
    }),
    cliente.subscribe("message.dropped", (data) => {
      const ev = data as EvMessageDropped;
      store.setState((s) => ({
        fila: s.fila.map((i) => (i.opId === ev.opId ? { ...i, state: "dropped", droppedReason: ev.reason } : i)),
      }));
    }),
    cliente.subscribe("outbox.changed", () => {
      void store.getState().recarregarFila();
    }),
    cliente.subscribe("typing.changed", (data) => {
      const ev = data as EvTypingChanged;
      const s = store.getState();
      if (ev.communityId === s.communityId && ev.channelId === s.channelId) {
        store.setState({ digitando: ev.identityKeys ?? [] });
      }
    }),
  ];

  const cancelarResync = registrarResync(() => {
    const s = store.getState();
    if (s.communityId !== null && s.channelId !== null) {
      // §15.2 4d/4e — e a assinatura de typing é do núcleo anterior: refaz também.
      void api
        .channelSubscribeTyping({ communityId: s.communityId, channelId: s.channelId, on: true })
        .catch(() => undefined);
      recarregar();
    }
  });

  return () => {
    for (const l of locais) cliente.unsubscribe(l);
    cancelarResync();
  };
}
