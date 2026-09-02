import { useEffect } from "react";
import { Download, FileText } from "lucide-react";

import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { formatFileSize } from "../../lib/format";
import { baixarAnexo, carregarAnexo } from "../../live/dm";
import { useDmStore } from "../../store/dmStore";

/**
 * O anexo de uma mensagem de conversa direta (§31.14).
 *
 * Duas coisas que este cartão não faz, e que são o reuso de §13 valendo aqui:
 *
 * - **não baixa sozinho.** §13.4 é *pull*: ninguém recebe bytes que não pediu, e é isso que
 *   torna a cota R-14 desnecessária numa dupla (§31.14). O botão é o pedido.
 * - **não renderiza o conteúdo inline** a não ser que §13.6 permita. A allowlist e a
 *   quarentena são de lá e não mudam aqui; abrir o arquivo continua sendo `blob.reveal`,
 *   com `archive` passando por confirmação do main (§15.3).
 */
export interface DmAttachmentCardProps {
  conversationId: string;
  messageId: string;
}

export function DmAttachmentCard({ conversationId, messageId }: DmAttachmentCardProps) {
  const anexo = useDmStore((s) => s.anexos[messageId]);

  // §31.16.3 — a lista de mensagens traz só `hasAttachment`; o anexo inteiro é uma query
  // por mensagem. Buscar aqui, e não ao carregar a página, evita N consultas por rolagem.
  useEffect(() => {
    if (anexo === undefined) void carregarAnexo(conversationId, messageId);
  }, [anexo, conversationId, messageId]);

  if (anexo === undefined) {
    return (
      <div className="mt-1 h-12 w-64 animate-pulse rounded-md border border-border-subtle bg-surface-elevated" />
    );
  }

  const baixado = anexo.localPath !== undefined;
  const baixando = anexo.state === "downloading";

  return (
    <div
      className={cn(
        "mt-1 flex max-w-md items-center gap-2 rounded-md border border-border-default",
        "bg-surface-elevated px-2 py-1.5",
      )}
    >
      <FileText size={16} strokeWidth={2} className="shrink-0 text-text-tertiary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-meta text-text-primary">{anexo.name}</span>
        <span className="block text-caption text-text-tertiary tabular-nums">
          {formatFileSize(anexo.sizeBytes)}
          {baixando && ` · ${Math.round(anexo.progress * 100)}%`}
        </span>
      </span>

      {!baixado && (
        <Button
          variant="icon"
          size="sm"
          disabled={baixando}
          onClick={() =>
            void baixarAnexo(conversationId, {
              blobsCoreKey: anexo.blobsCoreKey,
              blobId: anexo.blobId,
            })
          }
          aria-label={`Baixar ${anexo.name}`}
        >
          <Download size={14} strokeWidth={2} aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
