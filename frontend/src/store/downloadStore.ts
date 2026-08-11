import { create } from "zustand";
import type { Attachment } from "../domain/types";

/**
 * Download de arquivo estilo torrent (§11, B8).
 *
 * §2 congela o anexo de referência em 62%; o passo 2 do fluxo diz que o
 * progresso **avança sozinho** a partir dali. A fixture continua intacta —
 * como em `messageStore`, o que muda na sessão é override por id, e
 * recarregar devolve o card ao estado documentado na spec.
 */

/** ~5s de 62% a 100%: rápido o bastante para ver, lento o bastante para ler. */
const TICK_MS = 300;
const STEP = 2;

interface DownloadState {
  progressById: Record<string, number>;
  peersById: Record<string, number>;
  /** "1 peer desconectou, continuando com 2" (§11, B8, exceções). */
  noticeById: Record<string, string>;

  /** Idempotente: o card chama ao montar, quantas vezes for. */
  start: (attachment: Attachment) => void;
  /** Afinador de §19.1 — um peer some no meio do download. */
  devDropPeer: (attachment: Attachment) => void;
  reset: () => void;
}

const timers = new Map<string, number>();

function stop(id: string) {
  const timer = timers.get(id);
  if (timer !== undefined) {
    window.clearInterval(timer);
    timers.delete(id);
  }
}

export const useDownloadStore = create<DownloadState>()((set, get) => ({
  progressById: {},
  peersById: {},
  noticeById: {},

  start: (attachment) => {
    if (timers.has(attachment.id)) return;
    const current = get().progressById[attachment.id] ?? attachment.downloadProgress;
    if (current >= 100) return;

    const timer = window.setInterval(() => {
      const state = useDownloadStore.getState();
      const value = state.progressById[attachment.id] ?? attachment.downloadProgress;
      const next = Math.min(100, value + STEP);

      set({ progressById: { ...state.progressById, [attachment.id]: next } });
      // Chegou a 100%: o card vira "Baixado · Disponibilizando para outros",
      // e a identidade local passa a ser peer para os demais (B8 passo 3).
      if (next >= 100) stop(attachment.id);
    }, TICK_MS);

    timers.set(attachment.id, timer);
  },

  devDropPeer: (attachment) =>
    set((state) => {
      const peers = state.peersById[attachment.id] ?? attachment.availablePeers;
      if (peers <= 0) return {};
      const remaining = peers - 1;
      return {
        peersById: { ...state.peersById, [attachment.id]: remaining },
        // O download não reinicia: continua a partir de quem sobrou (B8).
        noticeById: {
          ...state.noticeById,
          [attachment.id]: `1 peer desconectou, continuando com ${remaining}`,
        },
      };
    }),

  reset: () => {
    for (const id of [...timers.keys()]) stop(id);
    set({ progressById: {}, peersById: {}, noticeById: {} });
  },
}));

/** Anexo com o que a sessão já mudou aplicado por cima da fixture. */
export function useLiveAttachment(attachment: Attachment): Attachment {
  const progress = useDownloadStore(
    (state) => state.progressById[attachment.id],
  );
  const peers = useDownloadStore((state) => state.peersById[attachment.id]);

  if (progress === undefined && peers === undefined) return attachment;
  return {
    ...attachment,
    downloadProgress: progress ?? attachment.downloadProgress,
    availablePeers: peers ?? attachment.availablePeers,
  };
}
