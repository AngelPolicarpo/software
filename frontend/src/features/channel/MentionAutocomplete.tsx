import { useEffect, useRef } from "react";
import { AtSign } from "lucide-react";
import { cn } from "../../lib/cn";
import { Avatar } from "../../components/ui/Avatar";
import { AVATAR_BG_CLASS } from "../../lib/avatar";
import { ROLE_TEXT_CLASS } from "../../lib/role";
import type { MentionCandidate } from "./mentions";

function SectionHeader({ children }: { children: string }) {
  return (
    <li
      className="px-3 pt-2 pb-1 text-caption text-text-tertiary uppercase"
      role="presentation"
    >
      {children}
    </li>
  );
}

function CandidateRow({
  candidate,
  selected,
  onSelect,
  onHover,
}: {
  candidate: MentionCandidate;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <li
      ref={ref}
      role="option"
      aria-selected={selected}
      onMouseEnter={onHover}
      onMouseDown={(event) => {
        // Antes do blur do textarea, senão o composer perde o cursor.
        event.preventDefault();
        onSelect();
      }}
      className={cn(
        "flex cursor-pointer items-center gap-2 px-3 py-1.5",
        selected && "bg-accent-muted-bg",
      )}
    >
      {candidate.kind === "member" ? (
        <Avatar
          name={candidate.label}
          color={candidate.avatarColor}
          size="sm"
          presence={candidate.presence}
          presenceRingClass="border-surface-elevated"
        />
      ) : candidate.kind === "role" ? (
        /* Swatch circular de 16px preenchido com a cor do cargo (§9, 2.1.1). */
        <span
          className={cn(
            "size-4 shrink-0 rounded-full",
            AVATAR_BG_CLASS[candidate.color],
          )}
          aria-hidden="true"
        />
      ) : (
        <AtSign
          size={16}
          strokeWidth={2}
          aria-hidden="true"
          className="shrink-0 text-text-secondary"
        />
      )}

      <span
        className={cn(
          "shrink-0 text-body-emphasis",
          candidate.kind === "member"
            ? ROLE_TEXT_CLASS[candidate.roleColor]
            : candidate.kind === "role"
              ? ROLE_TEXT_CLASS[candidate.color]
              : "text-text-primary",
        )}
      >
        {candidate.label}
      </span>
      <span className="truncate text-meta text-text-tertiary">
        {candidate.secondary}
      </span>
    </li>
  );
}

export interface MentionAutocompleteProps {
  candidates: MentionCandidate[];
  selectedIndex: number;
  query: string;
  onSelect: (candidate: MentionCandidate) => void;
  onHover: (index: number) => void;
}

/**
 * Autocomplete de menção (§9, 2.1.1) — ancorado imediatamente acima do
 * composer, com a mesma largura dele. Sem resultado, uma linha compacta, e
 * não o empty state de tela cheia.
 */
export function MentionAutocomplete({
  candidates,
  selectedIndex,
  query,
  onSelect,
  onHover,
}: MentionAutocompleteProps) {
  const roles = candidates.filter((c) => c.kind === "role");
  const members = candidates.filter((c) => c.kind === "member");
  const everyone = candidates.find((c) => c.kind === "everyone");

  return (
    <div
      className={cn(
        "absolute right-0 bottom-full left-0 mb-2 overflow-hidden",
        "rounded-lg border border-border-default bg-surface-elevated shadow-elevated",
      )}
    >
      {candidates.length === 0 ? (
        <p className="px-3 py-2 text-body text-text-tertiary">
          Nenhum resultado para "@{query}"
        </p>
      ) : (
        <ul role="listbox" aria-label="Menções" className="max-h-64 overflow-y-auto py-1">
          {everyone && (
            <CandidateRow
              candidate={everyone}
              selected={candidates.indexOf(everyone) === selectedIndex}
              onSelect={() => onSelect(everyone)}
              onHover={() => onHover(candidates.indexOf(everyone))}
            />
          )}

          {roles.length > 0 && <SectionHeader>Cargos</SectionHeader>}
          {roles.map((candidate) => {
            const index = candidates.indexOf(candidate);
            return (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                selected={index === selectedIndex}
                onSelect={() => onSelect(candidate)}
                onHover={() => onHover(index)}
              />
            );
          })}

          {members.length > 0 && <SectionHeader>Membros</SectionHeader>}
          {members.map((candidate) => {
            const index = candidates.indexOf(candidate);
            return (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                selected={index === selectedIndex}
                onSelect={() => onSelect(candidate)}
                onHover={() => onHover(index)}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
