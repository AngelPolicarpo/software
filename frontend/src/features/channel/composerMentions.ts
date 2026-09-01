import { useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import { escapeRegExp } from "../../lib/text";
import {
  filterMentionCandidates,
  mentionToken,
  useMentionCandidates,
} from "./mentions";
import type { MentionCandidate } from "./mentions";

interface ActiveMention {
  token: string;
  id: string;
}

/** Um pedaço do texto no espelho do composer: menção confirmada ou não. */
export interface MentionSegment {
  text: string;
  isMention: boolean;
}

/**
 * Menção sendo digitada: o `@` precisa começar palavra, e espaço ou
 * pontuação encerram o filtro e fecham o dropdown (§9, 2.1.1).
 */
export function findMentionQuery(
  value: string,
  caret: number,
): { start: number; text: string } | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;

  const text = before.slice(at + 1);
  if (/[\s,.;:!?]/.test(text)) return null;
  return { start: at, text };
}

export interface ComposerMentionsParams {
  communityId: string;
  value: string;
  setValue: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Cursor a reposicionar depois que o React aplicar o novo valor. */
  pendingCaret: RefObject<number | null>;
}

/**
 * Toda a máquina de menção do composer (§9, 2.1.1): o que está sendo digitado
 * depois do `@`, quem já foi confirmado, o realce no espelho e as teclas que
 * pertencem ao dropdown.
 *
 * Vive fora do `Composer` porque é uma responsabilidade inteira e fechada: o
 * composer só precisa saber o que desenhar e se a tecla já foi consumida.
 */
export function useComposerMentions({
  communityId,
  value,
  setValue,
  textareaRef,
  pendingCaret,
}: ComposerMentionsParams) {
  const candidates = useMentionCandidates(communityId);

  const [mentions, setMentions] = useState<ActiveMention[]>([]);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(
    null,
  );
  /**
   * Posição do `@` que o usuário fechou com `Esc`. Sem isso o dropdown
   * reabriria no `keyup` seguinte — e o próximo `Enter` confirmaria uma
   * menção em vez de enviar a mensagem.
   */
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filtro novo recomeça a seleção no topo, senão a seta continua de onde
  // parou numa lista que já é outra.
  useEffect(() => setSelectedIndex(0), [query?.text]);

  const visible = useMemo(
    () => (query ? filterMentionCandidates(candidates, query.text) : []),
    [candidates, query],
  );

  /** Trechos do texto que já são menção confirmada — pintados no espelho. */
  const segments = useMemo<MentionSegment[]>(() => {
    const tokens = mentions
      .map((mention) => mention.token)
      .filter((token) => value.includes(token));
    if (tokens.length === 0) return [{ text: value, isMention: false }];

    const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "g");
    // Conjunto: o texto quebrado pode ter muitos pedaços, e cada um pergunta
    // pela mesma lista de tokens.
    const confirmados = new Set(tokens);
    return value
      .split(pattern)
      .map((part) => ({ text: part, isMention: confirmados.has(part) }));
  }, [value, mentions]);

  function syncQuery(next: string, caret: number) {
    const found = findMentionQuery(next, caret);
    if (found && found.start === dismissedStart) {
      // Mesma menção que o usuário já dispensou: segue como texto comum.
      setQuery(null);
      return;
    }
    if (dismissedStart !== null) setDismissedStart(null);
    setQuery(found);
  }

  function applyMention(candidate: MentionCandidate) {
    const el = textareaRef.current;
    if (!el || !query) return;

    const token = mentionToken(candidate);
    const caret = el.selectionStart;
    const next = `${value.slice(0, query.start)}${token} ${value.slice(caret)}`;
    const nextCaret = query.start + token.length + 1;

    pendingCaret.current = nextCaret;
    setValue(next);
    setMentions((prev) => [
      ...prev.filter((mention) => mention.token !== token),
      { token, id: candidate.id },
    ]);
    setQuery(null);
  }

  /** Ids das menções que sobreviveram até o texto enviado (§9, 2.1.1). */
  function mentionIdsIn(content: string): string[] {
    return mentions
      .filter((mention) => content.includes(mention.token))
      .map((mention) => mention.id);
  }

  function reset() {
    setMentions([]);
    setQuery(null);
  }

  /**
   * As teclas que pertencem à menção. Devolve `true` quando a tecla já foi
   * consumida — o composer só trata o que sobra (Enter para enviar).
   */
  function handleKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ): boolean {
    if (query && visible.length > 0) {
      // ↑/↓ dão a volta; Tab equivale a Enter (§9, 2.1.1).
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % visible.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(
          (index) => (index - 1 + visible.length) % visible.length,
        );
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyMention(visible[selectedIndex]);
        return true;
      }
    }

    if (query && event.key === "Escape") {
      // Fecha mantendo o "@" e o texto já digitado como texto comum.
      event.preventDefault();
      setDismissedStart(query.start);
      setQuery(null);
      return true;
    }

    // Um único Backspace apaga a menção inteira, não caractere a caractere.
    if (event.key === "Backspace" && !event.shiftKey) {
      const el = event.currentTarget;
      if (el.selectionStart === el.selectionEnd) {
        const before = value.slice(0, el.selectionStart);
        const hit = mentions.find((mention) => before.endsWith(mention.token));
        if (hit) {
          event.preventDefault();
          const start = el.selectionStart - hit.token.length;
          pendingCaret.current = start;
          setValue(value.slice(0, start) + value.slice(el.selectionStart));
          setMentions((prev) =>
            prev.filter((mention) => mention.token !== hit.token),
          );
          return true;
        }
      }
    }

    return false;
  }

  return {
    query,
    visible,
    selectedIndex,
    setSelectedIndex,
    segments,
    syncQuery,
    applyMention,
    mentionIdsIn,
    reset,
    handleKeyDown,
  };
}
