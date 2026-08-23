/**
 * Autocomplete de menção — alimentado por `query.members` (§15.6).
 *
 * A lista é **do núcleo**, com o filtro `query` que a própria query aceita: filtrar no
 * cliente sobre o último roster carregado mostraria só quem coube na página, e o painel
 * ficaria mentindo por omissão em comunidade grande.
 *
 * O que a UI monta e manda em `mentions[]` são as **chaves** de quem foi escolhido. O texto
 * digitado é só texto; quem decide o que é menção de fato é o `fold`, ao interpretar a op.
 */

import { useEffect, useState } from "react";
import { api } from "../../ipc/api";
import { Avatar } from "./comuns";
import type { MemberEntry } from "../../ipc/dto";

export function Mencoes({
  communityId,
  termo,
  aoEscolher,
}: {
  communityId: string;
  termo: string;
  aoEscolher: (m: MemberEntry) => void;
}) {
  const [candidatos, setCandidatos] = useState<MemberEntry[]>([]);

  useEffect(() => {
    let vivo = true;
    void api
      .membersFiltrados({
        communityId,
        ...(termo.length > 0 ? { filter: { query: termo } } : {}),
        limit: 100,
      })
      .then((p) => {
        if (!vivo) return;
        setCandidatos(p.groups.flatMap((g) => g.members).slice(0, 8));
      })
      .catch(() => {
        if (vivo) setCandidatos([]);
      });
    return () => {
      vivo = false;
    };
  }, [communityId, termo]);

  if (candidatos.length === 0) return null;

  return (
    <ul className="absolute bottom-full left-0 mb-1 max-h-56 w-72 overflow-y-auto rounded-md border border-border-subtle bg-surface-primary p-1 shadow-lg">
      {candidatos.map((m) => (
        <li key={m.key}>
          <button
            type="button"
            onMouseDown={(e) => {
              // `mousedown`, não `click`: o clique tiraria o foco do textarea antes de a
              // escolha ser aplicada, e o cursor se perderia.
              e.preventDefault();
              aoEscolher(m);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-surface-elevated"
          >
            <Avatar user={m} size={22} />
            <span className="min-w-0 flex-1 truncate text-meta text-text-primary">
              {m.nickname ?? m.displayName}
            </span>
            <span className="text-caption text-text-tertiary">{m.handle}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
