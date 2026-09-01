import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * Markdown básico da mensagem (§0, premissa 8 · §9, 2.1 · §11, C9).
 *
 * O escopo é fechado e pequeno — negrito, itálico, código inline, bloco de
 * código, link e menção —, então não entra dependência nova: um parser de
 * ~80 linhas cobre exatamente o que a spec descreve, e nada mais.
 *
 * O resultado é sempre elemento React, nunca HTML injetado: conteúdo de
 * mensagem é texto de terceiro e não deve virar markup por acidente.
 */

const BLOCK_PATTERN = /```(?:[a-zA-Z0-9-]*)\n?([\s\S]*?)```/g;

function inlinePattern(mentionTokens: string[]): RegExp {
  const escaped = mentionTokens.map((token) =>
    token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const mention = escaped.length > 0 ? `|(${escaped.join("|")})` : "";
  return new RegExp(
    // código inline vem primeiro: `**x**` dentro de crase é literal
    "(`[^`\\n]+`)" +
      "|(\\*\\*[^*\\n]+\\*\\*)" +
      "|(\\*[^*\\n]+\\*|_[^_\\n]+_)" +
      "|(\\[[^\\]\\n]+\\]\\((?:https?:\\/\\/[^)\\s]+)\\))" +
      "|(https?:\\/\\/[^\\s]+)" +
      mention,
    "g",
  );
}

const MENTION_CLASS = cn(
  "rounded-sm bg-accent-muted-bg px-1 py-px",
  "text-body-emphasis text-accent-default",
);

const LINK_CLASS = "text-accent-default underline underline-offset-2 hover:text-accent-hover";

/**
 * Fábricas de nó, não componentes: são chamadas direto durante o parse, e o
 * arquivo já exporta `renderMarkdown`, que não é componente.
 */
function codeNode(text: string, key: string): ReactNode {
  return (
    <code
      key={key}
      className="rounded-sm bg-surface-app px-1 py-px font-mono text-[13px]"
    >
      {text}
    </code>
  );
}

/** Só `http(s)` vira link — nada de `javascript:` vindo de texto de mensagem. */
function linkNode(href: string, label: string, key: string): ReactNode {
  if (!/^https?:\/\//i.test(href)) return label;
  return (
    <a
      key={key}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={LINK_CLASS}
    >
      {label}
    </a>
  );
}

function renderInline(
  text: string,
  mentionTokens: string[],
  keyPrefix: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = inlinePattern(mentionTokens);
  let lastIndex = 0;
  let match = pattern.exec(text);

  while (match !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    // Chave é a posição do token dentro do texto, não a ordem de varredura:
    // dois tokens nunca começam no mesmo caractere, e um token editado adiante
    // não renumera os de trás.
    const inicio = match.index;
    const key = `${keyPrefix}-${inicio}`;
    const [whole, code, bold, italic, mdLink, bareUrl, mention] = match;

    if (code !== undefined) {
      nodes.push(codeNode(code.slice(1, -1), key));
    } else if (bold !== undefined) {
      nodes.push(
        <strong key={key} className="font-semibold">
          {renderInline(bold.slice(2, -2), mentionTokens, key)}
        </strong>,
      );
    } else if (italic !== undefined) {
      nodes.push(
        <em key={key} className="italic">
          {renderInline(italic.slice(1, -1), mentionTokens, key)}
        </em>,
      );
    } else if (mdLink !== undefined) {
      const label = mdLink.slice(1, mdLink.indexOf("]"));
      const href = mdLink.slice(mdLink.indexOf("](") + 2, -1);
      nodes.push(linkNode(href, label, key));
    } else if (bareUrl !== undefined) {
      nodes.push(linkNode(bareUrl, bareUrl, key));
    } else if (mention !== undefined) {
      nodes.push(
        <span key={key} className={MENTION_CLASS}>
          {mention}
        </span>,
      );
    } else {
      nodes.push(whole);
    }

    lastIndex = match.index + whole.length;
    match = pattern.exec(text);
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/**
 * Converte o conteúdo de uma mensagem em nós React. `mentionTokens` são os
 * textos já resolvidos ("@Ana Torres", "@everyone") que devem virar pill.
 */
export function renderMarkdown(
  content: string,
  mentionTokens: string[],
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let index = 0;

  BLOCK_PATTERN.lastIndex = 0;
  let match = BLOCK_PATTERN.exec(content);

  while (match !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        ...renderInline(
          content.slice(lastIndex, match.index),
          mentionTokens,
          `t${index}`,
        ),
      );
    }
    nodes.push(
      <pre
        key={`block-${index}`}
        className="my-1 overflow-x-auto rounded-md border border-border-default bg-surface-app p-3 font-mono text-[13px] text-text-primary"
      >
        <code>{match[1].replace(/\n$/, "")}</code>
      </pre>,
    );
    lastIndex = match.index + match[0].length;
    index += 1;
    match = BLOCK_PATTERN.exec(content);
  }

  if (lastIndex < content.length) {
    nodes.push(
      ...renderInline(content.slice(lastIndex), mentionTokens, `t${index}`),
    );
  }
  return nodes;
}
