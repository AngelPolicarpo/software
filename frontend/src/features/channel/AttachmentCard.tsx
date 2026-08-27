import { File, FileAudio, FileImage, FileText, FileVideo } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatFileSize } from "../../lib/format";
import { useDownloadStore, useLiveAttachment } from "../../store/downloadStore";
import { api } from "../../ipc/api";
import type { Attachment, AttachmentKind } from "../../domain/types";

const KIND_ICON: Record<AttachmentKind, LucideIcon> = {
  video: FileVideo,
  image: FileImage,
  audio: FileAudio,
  document: FileText,
  other: File,
};

/** "3 peers + host disponíveis" (§11, B8 passo 1). */
function availabilityLabel(attachment: Attachment): string {
  const { availablePeers: peers, hostAvailable } = attachment;
  const peerLabel = `${peers} ${peers === 1 ? "peer" : "peers"}`;
  if (peers === 0) return hostAvailable ? "host disponível" : "";
  return hostAvailable
    ? `${peerLabel} + host disponíveis`
    : `${peerLabel} disponíveis`;
}

export interface AttachmentCardProps {
  attachment: Attachment;
  /** Anexo da própria Ana subindo junto com a mensagem (§11, C9 passo 3). */
  uploading?: boolean;
}

/**
 * Card de anexo/arquivo (§6, §11 B8) — nome, tamanho, ícone por tipo, barra
 * de progresso enquanto baixa e contagem de peers/seeders.
 *
 * Sem peer nenhum e com o host offline o arquivo fica indisponível: o card
 * diz isso em vez de deixar o progresso travado em 0% (§11, B8).
 */
export function AttachmentCard({
  attachment: fixture,
  uploading = false,
}: AttachmentCardProps) {
  const attachment = useLiveAttachment(fixture);
  const iniciar = useDownloadStore((state) => state.iniciar);
  const cancelar = useDownloadStore((state) => state.cancelar);
  const emCurso = useDownloadStore((state) => state.emCursoById[fixture.id] === true);
  const cancelado = useDownloadStore((state) => state.canceladoById[fixture.id] === true);
  const notice = useDownloadStore((state) => state.noticeById[fixture.id]);
  const indisponivel = useDownloadStore((state) => state.indisponivelById[fixture.id] === true);
  const corrompido = useDownloadStore((state) => state.corrompidoById[fixture.id]);
  const baixado = useDownloadStore((state) => state.caminhoById[fixture.id] === true);

  const Icon = KIND_ICON[attachment.kind];
  const semFonte =
    !uploading &&
    attachment.origem === undefined &&
    attachment.downloadProgress < 100;
  const unavailable =
    semFonte || (indisponivel && attachment.downloadProgress < 100);
  const complete =
    !uploading && (attachment.downloadProgress >= 100 || baixado);
  // §11, B8 passo 2: baixar é decisão de quem recebe. Receber a mensagem NÃO
  // pede blob.download — só o clique pede, e o card só mostra progresso do que
  // esta sessão pediu.
  const baixando = !uploading && !unavailable && !complete && emCurso;
  const podeBaixar =
    !uploading &&
    !unavailable &&
    !complete &&
    !emCurso &&
    attachment.origem !== undefined;
  /** Bytes que já chegaram numa sessão anterior — o Hypercore retoma daí (§13.4). */
  const parcial = !cancelado && attachment.downloadProgress > 0;

  return (
    <div className="mt-1 flex max-w-[440px] items-start gap-3 rounded-md border border-border-default bg-surface-sidebar p-3">
      <Icon
        size={20}
        strokeWidth={2}
        aria-hidden="true"
        className={cn(
          "mt-0.5 shrink-0",
          unavailable ? "text-text-disabled" : "text-text-secondary",
        )}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-body-emphasis text-text-primary">
          {attachment.name}
        </p>

        <p className="text-meta text-text-tertiary">
          {corrompido !== undefined ? (
            "Arquivo corrompido no download — peça a alguém que o reenvie"
          ) : unavailable ? (
            "Indisponível no momento — nenhum peer com este arquivo está online"
          ) : cancelado ? (
            "Download cancelado"
          ) : (
            <>
              {formatFileSize(attachment.sizeBytes)}
              {uploading ? (
                <> · Enviando…</>
              ) : complete ? (
                <> · Baixado · Disponibilizando para outros</>
              ) : baixando ? (
                <> · {notice ?? availabilityLabel(attachment)}</>
              ) : parcial ? (
                <> · {attachment.downloadProgress}% baixado</>
              ) : null}
            </>
          )}
        </p>

        {uploading && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-border-default">
            {/* Indeterminada: o staging do núcleo não publica progresso (§13.5). */}
            <div className="h-full w-1/3 animate-conn-pulse rounded-full bg-accent-default" />
          </div>
        )}

        {baixando && (
          <div className="mt-1 flex items-center gap-2">
            <div
              role="progressbar"
              aria-valuenow={attachment.downloadProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Baixando ${attachment.name}`}
              className="h-1 flex-1 overflow-hidden rounded-full bg-border-default"
            >
              <div
                className="h-full rounded-full bg-accent-default"
                style={{ width: `${attachment.downloadProgress}%` }}
              />
            </div>
            <span className="text-meta tabular-nums text-text-secondary">
              {attachment.downloadProgress}%
            </span>
            {/* §13.4 — cancelar é da pessoa que baixa; o núcleo para o job e o
                card oferece recomeçar, sem apagar o que já chegou. */}
            <button
              type="button"
              onClick={() => cancelar(fixture)}
              className="text-meta text-text-secondary underline underline-offset-2 hover:text-text-primary"
            >
              Cancelar
            </button>
          </div>
        )}

        {podeBaixar && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => iniciar(fixture)}
              className="text-meta text-accent-default underline underline-offset-2 hover:text-text-primary"
            >
              {cancelado
                ? "Baixar novamente"
                : parcial
                  ? "Retomar download"
                  : "Baixar"}
            </button>
          </div>
        )}

        {complete && !uploading && attachment.origem !== undefined && corrompido === undefined && (
          <div className="mt-1 flex gap-3">
            <button
              type="button"
              onClick={() =>
                void api.blobReveal({
                  blobsCoreKey: attachment.origem!.blobsCoreKey,
                  blobId: attachment.origem!.blobId,
                  mode: "open",
                })
              }
              className="text-meta text-accent-default underline underline-offset-2 hover:text-text-primary"
            >
              Abrir
            </button>
            <button
              type="button"
              onClick={() =>
                void api.blobReveal({
                  blobsCoreKey: attachment.origem!.blobsCoreKey,
                  blobId: attachment.origem!.blobId,
                  mode: "folder",
                })
              }
              className="text-meta text-accent-default underline underline-offset-2 hover:text-text-primary"
            >
              Mostrar na pasta
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
