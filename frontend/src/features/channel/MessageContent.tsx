import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { findMember } from "../../mocks/dataset";
import type { Message } from "../../domain/types";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "@Ana Torres", "@everyone" — o texto exato que vira pill no corpo. */
function mentionTokens(message: Message, communityId: string): string[] {
  return message.mentions
    .map((id) => {
      if (id === "everyone") return "@everyone";
      const member = findMember(communityId, id);
      return member ? `@${member.nickname ?? member.displayName}` : null;
    })
    .filter((token): token is string => token !== null);
}

export interface MessageContentProps {
  message: Message;
  communityId: string;
}

/**
 * Corpo da mensagem em modo leitura (§9, 2.1).
 *
 * Menções viram pill `accent-muted-bg` (§5.3) e o rótulo "(editado)" fecha o
 * parágrafo, inline, sem quebrar linha. Renderização de markdown entra com o
 * composer — aqui o conteúdo é texto puro, preservando quebras de linha.
 */
export function MessageContent({ message, communityId }: MessageContentProps) {
  const tokens = mentionTokens(message, communityId);

  let body: ReactNode = message.content;

  if (tokens.length > 0) {
    const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "g");
    body = message.content.split(pattern).map((part, index) =>
      tokens.includes(part) ? (
        <span
          key={`${index}-${part}`}
          className={cn(
            "rounded-sm bg-accent-muted-bg px-1 py-px",
            "text-body-emphasis text-accent-default",
          )}
        >
          {part}
        </span>
      ) : (
        part
      ),
    );
  }

  return (
    <p className="text-body break-words whitespace-pre-wrap text-text-primary">
      {body}
      {message.edited && (
        <span className="ml-1 align-baseline text-caption text-text-tertiary">
          (editado)
        </span>
      )}
    </p>
  );
}
