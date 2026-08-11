import { File, FileAudio, FileImage, FileText, FileVideo } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatFileSize } from "../../lib/format";
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
}

/**
 * Card de anexo/arquivo (§6, §11 B8) — nome, tamanho, ícone por tipo, barra
 * de progresso enquanto baixa e contagem de peers/seeders.
 *
 * Sem peer nenhum e com o host offline o arquivo fica indisponível: o card
 * diz isso em vez de deixar o progresso travado em 0% (§11, B8).
 */
export function AttachmentCard({ attachment }: AttachmentCardProps) {
  const Icon = KIND_ICON[attachment.kind];
  const unavailable =
    attachment.availablePeers === 0 && !attachment.hostAvailable;
  const complete = attachment.downloadProgress >= 100;
  const downloading = !unavailable && !complete;

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
          {unavailable ? (
            "Indisponível no momento — nenhum peer com este arquivo está online"
          ) : (
            <>
              {formatFileSize(attachment.sizeBytes)}
              {complete ? (
                <> · Baixado · Disponibilizando para outros</>
              ) : (
                <> · {availabilityLabel(attachment)}</>
              )}
            </>
          )}
        </p>

        {downloading && (
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
          </div>
        )}
      </div>
    </div>
  );
}
