import { create } from "zustand";
import { api } from "../ipc/api";
import type { Attachment } from "../domain/types";

/**
 * Download de anexo (§13.4) — o progresso é o que o núcleo publica em `blob.progress`
 * (emenda de 2026-08-22: a chave do fio é `blobIdHex`), não uma simulação. O gatilho é
 * o card ao montar (§11, B8 passo 2); o comando é idempotente no núcleo e o pedido
 * também é aqui: um anexo só dispara uma vez por sessão.
 */

interface DownloadState {
  progressById: Record<string, number>;
  peersById: Record<string, number>;
  hostById: Record<string, boolean>;
  /** "1 peer desconectou, continuando com 2" (§11, B8, exceções) — de `blob.peerLost`. */
  noticeById: Record<string, string>;
  /** `blob.unavailable` — zero pares e host fora (§13.4). */
  indisponivelById: Record<string, true>;
  /** `attachment.corrupt` — hash/size divergiram (A-5); a UI não oferece abrir. */
  corrompidoById: Record<string, string>;
  /** Caminho local pós-`blob.completed` — nunca cruza o fio; quem abre é o main. */
  caminhoById: Record<string, true>;

  /** Dispara `blob.download` uma vez por anexo e sessão (§13.4 passo 1). */
  iniciar: (attachment: Attachment) => void;
  /** Eventos de §15.5 — chamados pelo sincronizador. */
  aplicarProgresso: (blobIdHex: string, progress: number, peers: number, hostAvailable: boolean) => void;
  aplicarPeerLost: (blobIdHex: string, remaining: number) => void;
  aplicarConcluido: (blobIdHex: string) => void;
  aplicarIndisponivel: (blobIdHex: string) => void;
  aplicarCorrompido: (blobIdHex: string, causa: string) => void;
  reset: () => void;
}

function omitir(map: Record<string, true>, chave: string): Record<string, true> {
  const { [chave]: _fora, ...resto } = map;
  return resto;
}

/** Os que já foram pedidos ao núcleo nesta sessão. */
const pedidos = new Set<string>();

export const useDownloadStore = create<DownloadState>()((set) => ({
  progressById: {},
  peersById: {},
  hostById: {},
  noticeById: {},
  indisponivelById: {},
  corrompidoById: {},
  caminhoById: {},

  iniciar: (attachment) => {
    const origem = attachment.origem;
    if (origem === undefined || pedidos.has(attachment.id)) return;
    if ((attachment.downloadProgress ?? 0) >= 100) return;
    pedidos.add(attachment.id);
    void api
      .blobDownload({
        communityId: origem.communityId,
        blobsCoreKey: origem.blobsCoreKey,
        blobId: origem.blobId,
      })
      .catch(() => {
        // E_NO_PEERS etc.: o card já mostra o estado do fio; `blob.unavailable`
        // chega por evento quando for o caso (§13.4).
        pedidos.delete(attachment.id);
      });
  },

  aplicarProgresso: (blobIdHex, progress, peers, hostAvailable) =>
    set((state) => ({
      progressById: { ...state.progressById, [blobIdHex]: progress },
      peersById: { ...state.peersById, [blobIdHex]: peers },
      hostById: { ...state.hostById, [blobIdHex]: hostAvailable },
      indisponivelById: omitir(state.indisponivelById, blobIdHex),
    })),

  aplicarPeerLost: (blobIdHex, remaining) =>
    set((state) => ({
      peersById: { ...state.peersById, [blobIdHex]: remaining },
      noticeById: {
        ...state.noticeById,
        [blobIdHex]: `1 peer desconectou, continuando com ${remaining}`,
      },
    })),

  aplicarConcluido: (blobIdHex) =>
    set((state) => ({
      progressById: { ...state.progressById, [blobIdHex]: 100 },
      caminhoById: { ...state.caminhoById, [blobIdHex]: true },
    })),

  aplicarIndisponivel: (blobIdHex) =>
    set((state) => ({
      indisponivelById: { ...state.indisponivelById, [blobIdHex]: true },
      peersById: { ...state.peersById, [blobIdHex]: 0 },
    })),

  aplicarCorrompido: (blobIdHex, causa) =>
    set((state) => ({
      corrompidoById: { ...state.corrompidoById, [blobIdHex]: causa },
    })),

  reset: () => {
    pedidos.clear();
    set({
      progressById: {},
      peersById: {},
      hostById: {},
      noticeById: {},
      indisponivelById: {},
      corrompidoById: {},
      caminhoById: {},
    });
  },
}));

/** Anexo com o que os eventos de §15.5 já disseram por cima do DTO. */
export function useLiveAttachment(attachment: Attachment): Attachment {
  const progress = useDownloadStore((state) => state.progressById[attachment.id]);
  const peers = useDownloadStore((state) => state.peersById[attachment.id]);
  const host = useDownloadStore((state) => state.hostById[attachment.id]);
  const indisponivel = useDownloadStore((state) => state.indisponivelById[attachment.id] === true);

  if (
    progress === undefined &&
    peers === undefined &&
    host === undefined &&
    !indisponivel
  ) {
    return attachment;
  }
  return {
    ...attachment,
    downloadProgress: progress ?? attachment.downloadProgress,
    availablePeers: indisponivel ? 0 : (peers ?? attachment.availablePeers),
    hostAvailable: indisponivel ? false : (host ?? attachment.hostAvailable),
  };
}
