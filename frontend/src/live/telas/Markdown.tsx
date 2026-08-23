/**
 * Renderização dos nós de `analisarMarkdown`.
 *
 * O resultado é sempre elemento React, **nunca HTML injetado**: conteúdo de mensagem é texto
 * escrito por outra pessoa e não pode virar markup por acidente. As decisões — o que é link,
 * o que vira texto — já foram tomadas na análise; aqui só se escolhe a tag.
 */

import type { ReactNode } from "react";
import { analisarMarkdown, type No } from "../markdown";

function nos(lista: readonly No[], prefixo: string): ReactNode[] {
  return lista.map((n, i) => {
    const k = `${prefixo}-${i}`;
    switch (n.t) {
      case "texto":
        return n.texto;
      case "negrito":
        return (
          <strong key={k} className="font-semibold">
            {nos(n.filhos, k)}
          </strong>
        );
      case "italico":
        return (
          <em key={k} className="italic">
            {nos(n.filhos, k)}
          </em>
        );
      case "codigo":
        return (
          <code key={k} className="rounded-sm bg-surface-app px-1 py-px font-mono text-[13px]">
            {n.texto}
          </code>
        );
      case "bloco":
        return (
          <pre key={k} className="my-1 overflow-x-auto rounded-md bg-surface-app p-2 font-mono text-[13px]">
            {n.texto}
          </pre>
        );
      case "link":
        return (
          <a
            key={k}
            href={n.href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent-default underline underline-offset-2 hover:text-accent-hover"
          >
            {n.rotulo}
          </a>
        );
      case "mencao":
        return (
          <span key={k} className="rounded-sm bg-accent-muted-bg px-1 py-px text-body-emphasis text-accent-default">
            {n.texto}
          </span>
        );
    }
  });
}

export function Markdown({ conteudo, mencoes }: { conteudo: string; mencoes?: readonly string[] }) {
  return (
    <p className="whitespace-pre-wrap break-words text-body text-text-primary">
      {nos(analisarMarkdown(conteudo, mencoes ?? []), "md")}
    </p>
  );
}
