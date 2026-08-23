/**
 * Componentes compartilhados das telas vivas.
 */

import type { ReactNode } from "react";
import { corDe, corDePresenca, iniciais } from "./formato";
import type { Presence, UserRef } from "../../ipc/dto";

export function Avatar({
  user,
  size = 36,
  presence,
}: {
  user: Pick<UserRef, "displayName" | "nickname" | "avatarColor">;
  size?: number;
  presence?: Presence | undefined;
}) {
  const nome = user.nickname ?? user.displayName;
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <span
        aria-hidden
        className="flex size-full items-center justify-center rounded-full text-caption text-text-on-accent"
        style={{ backgroundColor: corDe(user.avatarColor) }}
      >
        {iniciais(nome)}
      </span>
      {presence !== undefined && (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-surface-primary"
          style={{ backgroundColor: corDePresenca(presence) }}
        />
      )}
    </span>
  );
}

/**
 * Nome com o desempate de L-5. A colisão vem marcada pelo `fold` (§6.1): quando dois
 * homônimos estão ativos, o `handle` deixa de ser opcional na tela — é o que distingue
 * quem falou.
 */
export function Nome({ user, className }: { user: UserRef; className?: string }) {
  return (
    <span className={className}>
      {user.nickname ?? user.displayName}
      {user.collision && <span className="ml-1 text-caption text-text-tertiary">{user.handle}</span>}
    </span>
  );
}

export function Secao({ titulo, children, acao }: { titulo: string; children: ReactNode; acao?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-caption uppercase text-text-tertiary">{titulo}</h3>
        {acao}
      </div>
      {children}
    </section>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-meta text-text-tertiary">{children}</p>;
}
