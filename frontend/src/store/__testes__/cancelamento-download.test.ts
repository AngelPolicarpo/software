/**
 * Cancelamento de download (§13.4 `blob.cancel`).
 *
 * O que se afirma: cancelar avisa o núcleo com a origem do anexo, marca o card,
 * limpa progresso/peers e LIBERA o pedido — "baixar novamente" re-dispara
 * `blob.download`. Completo não se cancela; sem origem não há a quem pedir.
 * Verificado por mutação: remover `pedidos.delete` do `cancelar` derruba o caso
 * de re-download.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDownloadStore } from "../downloadStore";
import type { Attachment } from "../../domain/types";

const api = vi.hoisted(() => ({
  blobDownload: vi.fn<() => Promise<unknown>>(),
  blobCancel: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("../../ipc/api", () => ({ api }));

function anexo(id: string, progresso = 40): Attachment {
  return {
    id,
    name: "relatorio.pdf",
    sizeBytes: 1200,
    kind: "document",
    downloadProgress: progresso,
    availablePeers: 2,
    hostAvailable: true,
    origem: {
      communityId: "c1",
      blobsCoreKey: "aa".repeat(32),
      blobId: { byteOffset: 0, blockOffset: 0, blockLength: 3, byteLength: 1200 },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.blobDownload.mockResolvedValue({});
  api.blobCancel.mockResolvedValue({});
  useDownloadStore.getState().reset();
});

describe("downloadStore.cancelar — §13.4", () => {
  it("avisa o núcleo, marca o cartão e limpa o progresso", async () => {
    const a = anexo("b1");
    useDownloadStore.getState().aplicarProgresso("b1", 40, 2, true);
    // O pedido em curso existe nesta sessão.
    useDownloadStore.getState().iniciar(a);
    expect(api.blobDownload).toHaveBeenCalledTimes(1);

    useDownloadStore.getState().cancelar(a);

    expect(api.blobCancel).toHaveBeenCalledWith({
      blobsCoreKey: "aa".repeat(32),
      blobId: a.origem!.blobId,
    });
    const s = useDownloadStore.getState();
    expect(s.canceladoById["b1"]).toBe(true);
    expect(s.progressById["b1"]).toBeUndefined();
    expect(s.peersById["b1"]).toBeUndefined();
  });

  it("baixar novamente re-dispara blob.download e sai do estado cancelado", async () => {
    const a = anexo("b1");
    useDownloadStore.getState().iniciar(a);
    useDownloadStore.getState().cancelar(a);
    api.blobDownload.mockClear();

    useDownloadStore.getState().iniciar(a);

    expect(api.blobDownload).toHaveBeenCalledTimes(1);
    expect(useDownloadStore.getState().canceladoById["b1"]).toBeUndefined();
  });

  it("completo não se cancela; anexos sem origem não têm a quem pedir", () => {
    useDownloadStore.getState().cancelar(anexo("pronto", 100));
    expect(api.blobCancel).not.toHaveBeenCalled();

    const semOrigem = { ...anexo("sem-origem"), origem: undefined };
    useDownloadStore.getState().cancelar(semOrigem);
    expect(api.blobCancel).not.toHaveBeenCalled();
    expect(useDownloadStore.getState().canceladoById["sem-origem"]).toBeUndefined();
  });
});
