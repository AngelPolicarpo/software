/**
 * Ações sobre mensagem, thread aberta e painéis do canal (§15.4 "Mensagens", §15.6).
 *
 * As cinco ações de mensagem são **A** por contrato (§11.1): respondem `{opId, state}` e o
 * desfecho chega por evento, igual ao envio. A tela não pinta o resultado antes da hora —
 * uma reação que "já apareceu" e depois some é pior que uma que demora.
 *
 * `query.message` existe porque `MessageDto` **não** carrega reações nem anexo (§15.6.1):
 * os dois são da consulta de uma mensagem só. Carregá-los por linha da lista seria uma
 * consulta por mensagem na tela; a lista pede sob demanda — ao abrir o anexo, ao abrir a
 * gaveta de reações.
 */

import { create } from "zustand";
import { api, cliente } from "../ipc/api";
import { registrarResync } from "./sessao";
import { useCanal } from "./canal";
import { useComunidades } from "./comunidades";
import type { AttachmentDto, EvBlobProgress, MessageFull, ReactorsDto, ThreadDto } from "../ipc/dto";

/** Painéis laterais do canal — só um por vez, e nenhum aberto é o normal. */
export type PainelDoCanal = "membros" | "fixados" | "arquivos" | "links" | "busca" | null;

interface Mensagens {
  /** Detalhes carregados sob demanda, por `messageId`. */
  detalhes: Record<string, MessageFull>;
  /** Progresso vivo de download por `blobIdHex` (§15.5, emenda de 2026-08-22). */
  progresso: Record<string, { progress: number; peers: number; hostAvailable: boolean }>;
  thread: ThreadDto | null;
  threadId: string | null;
  reatores: { messageId: string; emoji: string; dados: ReactorsDto } | null;
  painel: PainelDoCanal;
  erro: string | null;

  detalhar(messageId: string): Promise<MessageFull | null>;
  editar(messageId: string, content: string): Promise<void>;
  remover(messageId: string, reason?: string): Promise<void>;
  fixar(messageId: string, pinned: boolean): Promise<void>;
  reagir(messageId: string, emoji: string, present: boolean): Promise<void>;
  criarThread(rootMessageId: string): Promise<void>;
  abrirThread(threadId: string): Promise<void>;
  recarregarThread(): Promise<void>;
  fecharThread(): void;
  verReatores(messageId: string, emoji: string): Promise<void>;
  fecharReatores(): void;
  abrirPainel(p: PainelDoCanal): void;
  baixar(a: AttachmentDto): Promise<void>;
  cancelarDownload(a: AttachmentDto): Promise<void>;
  revelar(a: AttachmentDto, mode: "open" | "folder"): Promise<void>;
}

function contexto(): { communityId: string; channelId: string } | null {
  const { communityId, channelId } = useCanal.getState();
  if (communityId === null || channelId === null) return null;
  return { communityId, channelId };
}

export const useMensagens = create<Mensagens>((set, get) => ({
  detalhes: {},
  progresso: {},
  thread: null,
  threadId: null,
  reatores: null,
  painel: null,
  erro: null,

  async detalhar(messageId) {
    const ctx = contexto();
    if (ctx === null) return null;
    const r = await api.message({ communityId: ctx.communityId, messageId }).catch(() => null);
    if (r !== null) set((s) => ({ detalhes: { ...s.detalhes, [messageId]: r } }));
    return r;
  },

  async editar(messageId, content) {
    const ctx = contexto();
    if (ctx === null) return;
    await api.messageEdit({ communityId: ctx.communityId, messageId, content });
  },

  async remover(messageId, reason) {
    const ctx = contexto();
    if (ctx === null) return;
    await api.messageDelete({
      communityId: ctx.communityId,
      messageId,
      ...(reason !== undefined && reason.length > 0 ? { reason } : {}),
    });
  },

  async fixar(messageId, pinned) {
    const ctx = contexto();
    if (ctx === null) return;
    await api.messagePin({ communityId: ctx.communityId, messageId, pinned });
  },

  async reagir(messageId, emoji, present) {
    const ctx = contexto();
    if (ctx === null) return;
    await api.messageReact({ communityId: ctx.communityId, messageId, emoji, present });
  },

  /**
   * `thread.create` é **A** e não devolve `threadId` — nem poderia: o id é o que o `fold`
   * decidir. A mensagem ganha `threadId` no lote projetado, e é de lá que a gaveta abre.
   * Inventar um id aqui prometeria uma thread que ainda não existe.
   */
  async criarThread(rootMessageId) {
    const ctx = contexto();
    if (ctx === null) return;
    await api.threadCreate({ communityId: ctx.communityId, rootMessageId });
  },

  async abrirThread(threadId) {
    const ctx = contexto();
    if (ctx === null) return;
    set({ threadId, thread: null });
    const r = await api.thread({ communityId: ctx.communityId, threadId }).catch(() => null);
    if (get().threadId !== threadId) return;
    set({ thread: r });
    if (r !== null) await api.threadMarkRead({ communityId: ctx.communityId, threadId }).catch(() => undefined);
  },

  async recarregarThread() {
    const { threadId } = get();
    const ctx = contexto();
    if (threadId === null || ctx === null) return;
    const r = await api.thread({ communityId: ctx.communityId, threadId }).catch(() => null);
    if (get().threadId === threadId) set({ thread: r });
  },

  fecharThread() {
    set({ thread: null, threadId: null });
  },

  async verReatores(messageId, emoji) {
    const ctx = contexto();
    if (ctx === null) return;
    const dados = await api.reactors({ communityId: ctx.communityId, messageId, emoji }).catch(() => null);
    if (dados !== null) set({ reatores: { messageId, emoji, dados } });
  },

  fecharReatores() {
    set({ reatores: null });
  },

  abrirPainel(painel) {
    set((s) => ({ painel: s.painel === painel ? null : painel }));
  },

  async baixar(a) {
    const communityId = useComunidades.getState().ativa;
    if (communityId === null) return;
    try {
      await api.blobDownload({ communityId, blobsCoreKey: a.blobsCoreKey, blobId: a.blobId });
      set({ erro: null });
    } catch (e) {
      // `E_NO_PEERS` é resposta, não falha do produto: ninguém tem os bytes agora.
      set({ erro: e instanceof Error ? e.message : "falha ao baixar" });
    }
  },

  async cancelarDownload(a) {
    await api.blobCancel({ blobsCoreKey: a.blobsCoreKey, blobId: a.blobId }).catch(() => undefined);
  },

  async revelar(a, mode) {
    try {
      await api.blobReveal({ blobsCoreKey: a.blobsCoreKey, blobId: a.blobId, mode });
      set({ erro: null });
    } catch (e) {
      set({ erro: e instanceof Error ? e.message : "não foi possível abrir" });
    }
  },
}));

export function assinarMensagens(): () => void {
  const store = useMensagens;

  const recarregarThread = (): void => {
    void store.getState().recarregarThread();
  };

  const locais = [
    cliente.subscribe("message.updated", (data) => {
      const ev = data as { messageId?: string };
      const id = ev.messageId;
      // Detalhe já carregado é o único que precisa voltar ao núcleo; o resto da linha vem
      // da lista, que o `canal.ts` já reconsulta pelo mesmo evento.
      if (id !== undefined && store.getState().detalhes[id] !== undefined) void store.getState().detalhar(id);
      const r = store.getState().reatores;
      if (r !== null && r.messageId === id) void store.getState().verReatores(r.messageId, r.emoji);
      recarregarThread();
    }),
    cliente.subscribe("messages.appended", () => {
      recarregarThread();
    }),
    // §15.5 — progresso a cada 500 ms; é o único lugar em que o payload vira estado, porque
    // não há query de progresso: `AttachmentDto.progress` é a foto do momento da consulta.
    cliente.subscribe("blob.progress", (data) => {
      const ev = data as EvBlobProgress;
      if (typeof ev.blobIdHex !== "string") return;
      store.setState((s) => ({
        progresso: {
          ...s.progresso,
          [ev.blobIdHex]: { progress: ev.progress, peers: ev.peers, hostAvailable: ev.hostAvailable },
        },
      }));
    }),
    cliente.subscribe("blob.completed", (data) => {
      const ev = data as { blobIdHex?: string };
      if (typeof ev.blobIdHex !== "string") return;
      store.setState((s) => {
        const progresso = { ...s.progresso };
        delete progresso[ev.blobIdHex!];
        return { progresso };
      });
      // O anexo completo tem `localPath`; quem estava mostrando barra precisa do estado novo.
      for (const id of Object.keys(store.getState().detalhes)) void store.getState().detalhar(id);
    }),
    cliente.subscribe("blob.unavailable", (data) => {
      const ev = data as { blobIdHex?: string };
      if (typeof ev.blobIdHex !== "string") return;
      store.setState((s) => ({
        progresso: { ...s.progresso, [ev.blobIdHex!]: { progress: 0, peers: 0, hostAvailable: false } },
      }));
    }),
    cliente.subscribe("attachment.corrupt", (data) => {
      const ev = data as { cause?: string };
      store.setState({
        erro:
          ev.cause === "hash"
            ? "O anexo baixado não bate com o hash declarado e foi descartado."
            : "O anexo baixado tem tamanho diferente do declarado e foi descartado.",
      });
    }),
  ];

  const cancelarResync = registrarResync(() => {
    recarregarThread();
    for (const id of Object.keys(store.getState().detalhes)) void store.getState().detalhar(id);
  });

  return () => {
    for (const l of locais) cliente.unsubscribe(l);
    cancelarResync();
  };
}
