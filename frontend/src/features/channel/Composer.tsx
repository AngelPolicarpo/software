import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  Code,
  CornerUpLeft,
  Italic,
  Paperclip,
  SendHorizontal,
  Smile,
  X,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { escapeRegExp } from "../../lib/text";
import { EmojiPicker } from "./EmojiPicker";
import { MentionAutocomplete } from "./MentionAutocomplete";
import {
  filterMentionCandidates,
  mentionToken,
  useMentionCandidates,
} from "./mentions";
import type { MentionCandidate } from "./mentions";
import { TypingIndicator } from "./TypingIndicator";
import { useFindMember } from "../../store/communityStore";
import { useMessageStore } from "../../store/messageStore";
import { ROLE_TEXT_CLASS } from "../../lib/role";
import { selectHighestRole, useCommunityStore } from "../../store/communityStore";
import type { Channel, Message } from "../../domain/types";

/** §6 — o textarea cresce até ~40% da altura da viewport antes de rolar. */
const MAX_HEIGHT_RATIO = 0.4;

interface ActiveMention {
  token: string;
  id: string;
}

/**
 * Menção sendo digitada: o `@` precisa começar palavra, e espaço ou
 * pontuação encerram o filtro e fecham o dropdown (§9, 2.1.1).
 */
function findMentionQuery(
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

/** Barra "respondendo a X" acima do campo, com cancelar (§9, 2.1). */
function ReplyingTo({
  message,
  communityId,
  onCancel,
}: {
  message: Message;
  communityId: string;
  onCancel: () => void;
}) {
  const findMember = useFindMember();
  const member = findMember(communityId, message.authorId);
  const highest = useCommunityStore((state) =>
    member ? selectHighestRole(state, member.roleIds) : undefined,
  );

  return (
    <div className="flex items-center gap-2 rounded-t-md border border-b-0 border-border-default bg-surface-sidebar px-3 py-1.5">
      <CornerUpLeft
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        className="shrink-0 text-text-tertiary"
      />
      <p className="min-w-0 flex-1 truncate text-meta text-text-secondary">
        respondendo a{" "}
        <span
          className={cn(
            "font-semibold",
            highest ? ROLE_TEXT_CLASS[highest.color] : "text-text-primary",
          )}
        >
          {member?.displayName ?? "membro"}
        </span>
      </p>
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 rounded-sm text-text-tertiary hover:text-text-primary"
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
        <span className="sr-only">Cancelar resposta</span>
      </button>
    </div>
  );
}

export interface ComposerProps {
  channel: Channel;
  replyTo?: Message | null;
  onCancelReply?: () => void;
  /** Composer da thread (§9, 2.2) — a mensagem nasce dentro dela. */
  threadId?: string;
  /** Sobrepõe "Conversar em #canal" (§6) no composer de thread. */
  placeholder?: string;
  /**
   * Coluna estreita (painel de thread, 320px): sem os botões de formatação.
   * O breakpoint do Tailwind mede a viewport, não o container, então quem
   * sabe que o espaço é curto é quem monta o composer.
   */
  compact?: boolean;
}

/**
 * Composer do canal de texto (§6 · §9, 2.1 · fluxo C9).
 *
 * O textarea é nativo — cresce até 40% da viewport e depois rola. As
 * menções confirmadas aparecem destacadas por trás do texto, num espelho
 * alinhado ao textarea: é o que permite o token visual de §9 2.1.1 sem
 * trocar o campo por um `contenteditable`, que quebraria seleção, undo e IME.
 *
 * Markdown é digitado, não renderizado aqui — §11 (C9) é explícito em não
 * ter preview WYSIWYG; o texto só vira formatação depois de enviado.
 */
export function Composer({
  channel,
  replyTo,
  onCancelReply,
  threadId,
  placeholder,
  compact = false,
}: ComposerProps) {
  const send = useMessageStore((state) => state.send);
  const candidates = useMentionCandidates(channel.communityId);

  const [value, setValue] = useState("");
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
  const [emojiOpen, setEmojiOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  /**
   * Cursor a reposicionar depois que o React aplicar o novo valor (inserir
   * ou apagar uma menção mexe no texto por fora do input). Vai num efeito de
   * layout, não num `requestAnimationFrame`: o frame pode chegar *depois* da
   * próxima tecla e jogar o cursor no meio do que o usuário acabou de digitar.
   */
  const pendingCaret = useRef<number | null>(null);

  const visible = useMemo(
    () => (query ? filterMentionCandidates(candidates, query.text) : []),
    [candidates, query],
  );

  // Cresce com o conteúdo até o teto e só então rola (§6).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(
      el.scrollHeight,
      window.innerHeight * MAX_HEIGHT_RATIO,
    )}px`;
  }, [value]);

  useEffect(() => setSelectedIndex(0), [query?.text]);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [value]);

  /** Trechos do texto que já são menção confirmada — pintados no espelho. */
  const segments = useMemo(() => {
    const tokens = mentions
      .map((mention) => mention.token)
      .filter((token) => value.includes(token));
    if (tokens.length === 0) return [{ text: value, isMention: false }];

    const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "g");
    return value
      .split(pattern)
      .map((part) => ({ text: part, isMention: tokens.includes(part) }));
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

  /** Insere texto no cursor — usado pelo emoji e pela formatação. */
  function insertAtCaret(before: string, after = "") {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const selected = value.slice(start, end);
    pendingCaret.current =
      selected === ""
        ? start + before.length
        : end + before.length + after.length;
    setValue(
      value.slice(0, start) + before + selected + after + value.slice(end),
    );
  }

  function handleSend() {
    const content = value.trim();
    if (content === "") return;

    // A bolha otimista e o transporte são da store; quem decide entre envio
    // imediato e fila é a outbox do núcleo (§11.1), nunca a tela.
    void send({
      communityId: channel.communityId,
      channelId: channel.id,
      content,
      mentions: mentions
        .filter((mention) => content.includes(mention.token))
        .map((mention) => mention.id),
      replyToId: replyTo?.id,
      threadId,
    });

    setValue("");
    setMentions([]);
    setQuery(null);
    onCancelReply?.();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (query && visible.length > 0) {
      // ↑/↓ dão a volta; Tab equivale a Enter (§9, 2.1.1).
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % visible.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex(
          (index) => (index - 1 + visible.length) % visible.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyMention(visible[selectedIndex]);
        return;
      }
    }

    if (query && event.key === "Escape") {
      // Fecha mantendo o "@" e o texto já digitado como texto comum.
      event.preventDefault();
      setDismissedStart(query.start);
      setQuery(null);
      return;
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
          return;
        }
      }
    }

    if (event.key === "Enter" && !event.shiftKey && !composing.current) {
      event.preventDefault();
      handleSend();
    }
  }

  /**
   * §13 — o anexo é o caminho do `blob.stage` (diálogo nativo, ticket, cota),
   * ainda não ligado à tela. O botão fica fora do ar com o aviso no lugar:
   * fingir anexo seria enviar mensagem sem o arquivo que ela anuncia.
   */
  const canSend = value.trim() !== "";

  return (
    <div className="px-4 pb-4">
      <TypingIndicator channelId={channel.id} communityId={channel.communityId} />

      <div className="relative">
        {query && (
          <MentionAutocomplete
            candidates={visible}
            selectedIndex={selectedIndex}
            query={query.text}
            onSelect={applyMention}
            onHover={setSelectedIndex}
          />
        )}

        {replyTo && onCancelReply && (
          <ReplyingTo
            message={replyTo}
            communityId={channel.communityId}
            onCancel={onCancelReply}
          />
        )}

        <div
          className={cn(
            "flex items-end gap-1 border border-border-default bg-surface-elevated p-1",
            replyTo ? "rounded-b-md" : "rounded-md",
          )}
        >
          <button
            type="button"
            disabled
            title="Anexos aguardam o caminho de arquivos do núcleo (§13)"
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-md",
              "text-text-disabled",
            )}
          >
            <Paperclip size={20} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">
              Anexar arquivo — indisponível: o caminho de arquivos do núcleo
              ainda não está ligado a esta tela
            </span>
          </button>

          {/* Formatação (§6): atalho para o markdown que C9 descreve digitado.
              Fica fora do Mobile para não espremer a barra — o caminho
              equivalente (digitar `**`) continua disponível lá (§19.4). */}
          <div
            className={cn(
              "hidden items-center gap-0.5",
              !compact && "tablet:flex",
            )}
          >
            {(
              [
                { id: "bold", label: "Negrito", icon: Bold, wrap: "**" },
                { id: "italic", label: "Itálico", icon: Italic, wrap: "*" },
                { id: "code", label: "Código", icon: Code, wrap: "`" },
              ] as const
            ).map(({ id, label, icon: Icon, wrap }) => (
              <button
                key={id}
                type="button"
                onClick={() => insertAtCaret(wrap, wrap)}
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-md",
                  "text-text-secondary hover:bg-surface-primary hover:text-text-primary",
                  "transition-colors duration-(--duration-fast) ease-out",
                )}
              >
                <Icon size={18} strokeWidth={2} aria-hidden="true" />
                <span className="sr-only">{label}</span>
              </button>
            ))}
          </div>

          <div className="relative min-w-0 flex-1">
            {/* Espelho do textarea: só os fundos das menções aparecem. */}
            <div
              ref={backdropRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden px-2 py-2 text-body break-words whitespace-pre-wrap text-transparent"
            >
              {segments.map((segment, index) =>
                segment.isMention ? (
                  <span
                    key={`${index}-${segment.text}`}
                    className="rounded-sm bg-accent-muted-bg"
                  >
                    {segment.text}
                  </span>
                ) : (
                  segment.text
                ),
              )}
            </div>

            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              placeholder={placeholder ?? `Conversar em #${channel.name}`}
              aria-label={placeholder ?? `Conversar em #${channel.name}`}
              onChange={(event) => {
                setValue(event.target.value);
                syncQuery(event.target.value, event.target.selectionStart);
              }}
              onKeyUp={(event) =>
                syncQuery(event.currentTarget.value, event.currentTarget.selectionStart)
              }
              onClick={(event) =>
                syncQuery(event.currentTarget.value, event.currentTarget.selectionStart)
              }
              onKeyDown={handleKeyDown}
              onCompositionStart={() => (composing.current = true)}
              onCompositionEnd={() => (composing.current = false)}
              onScroll={(event) => {
                if (backdropRef.current)
                  backdropRef.current.scrollTop = event.currentTarget.scrollTop;
              }}
              className={cn(
                "relative block max-h-[40vh] w-full resize-none bg-transparent px-2 py-2",
                "text-body break-words text-text-primary outline-none",
                "placeholder:text-text-tertiary",
              )}
            />
          </div>

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setEmojiOpen((open) => !open)}
              className={cn(
                "grid size-9 place-items-center rounded-md",
                "text-text-secondary hover:bg-surface-primary hover:text-text-primary",
                "transition-colors duration-(--duration-fast) ease-out",
              )}
            >
              <Smile size={20} strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">Emoji</span>
            </button>

            {emojiOpen && (
              <EmojiPicker
                side="top"
                onPick={(emoji) => insertAtCaret(emoji)}
                onClose={() => setEmojiOpen(false)}
              />
            )}
          </div>

          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-md",
              "transition-colors duration-(--duration-fast) ease-out",
              canSend
                ? "text-accent-default hover:bg-accent-muted-bg"
                : "text-text-disabled",
            )}
          >
            <SendHorizontal size={20} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Enviar mensagem</span>
          </button>
        </div>
      </div>
    </div>
  );
}
