import { useTypingIn } from "../../store/messageStore";
import { useFindMember } from "../../store/communityStore";

/**
 * "X está digitando…" (§9, 2.1) — rodapé do canal, acima do composer, com
 * os pontos animados de §17.
 *
 * Sem rede, ninguém digita sozinho: quem alimenta este estado no mock é o
 * afinador de desenvolvimento (§19.1).
 */
export function TypingIndicator({
  channelId,
  communityId,
}: {
  channelId: string;
  communityId: string;
}) {
  const findMember = useFindMember();
  const typingIds = useTypingIn(channelId);
  if (typingIds.length === 0) return null;

  const names = typingIds.map(
    (id) => findMember(communityId, id)?.displayName ?? "Alguém",
  );
  const label =
    names.length === 1
      ? `${names[0]} está digitando`
      : `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]} estão digitando`;

  return (
    <p className="mb-1 flex items-center gap-1 text-meta text-text-secondary">
      <span className="flex items-end gap-0.5" aria-hidden="true">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="size-1 animate-conn-pulse rounded-full bg-text-secondary"
            style={{ animationDelay: `${dot * 200}ms` }}
          />
        ))}
      </span>
      {label}…
    </p>
  );
}
