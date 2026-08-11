import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Paperclip, SendHorizontal, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatFileSize } from "../../lib/format";
import { escapeRegExp } from "../../lib/text";
import { MentionAutocomplete } from "./MentionAutocomplete";
import {
  filterMentionCandidates,
  mentionToken,
  useMentionCandidates,
} from "./mentions";
import type { MentionCandidate } from "./mentions";
import { TypingIndicator } from "./TypingIndicator";
import { IDS, findMember } from "../../mocks/dataset";
import { useIdentityStore } from "../../store/identityStore";
import { useMessageStore } from "../../store/messageStore";
import type { Attachment, AttachmentKind, Channel } from "../../domain/types";

/** Teto ilustrativo do anexo (§11, C9 — exceções). */
const MAX_ATTACHMENT_BYTES = 8_000_000_000;
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

function attachmentKind(file: File): AttachmentKind {
  const type = file.type;
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("text/") || type.includes("pdf") || type.includes("word"))
    return "document";
  return "other";
}

function toAttachment(file: File): Attachment {
  return {
    id: `att-${crypto.randomUUID()}`,
    name: file.name,
    sizeBytes: file.size,
    kind: attachmentKind(file),
    // Arquivo da própria Ana: ela já o tem inteiro e passa a semeá-lo.
    downloadProgress: 100,
    availablePeers: 0,
    hostAvailable: true,
  };
}

export interface ComposerProps {
  channel: Channel;
  /** Host offline → a mensagem entra na fila local (§11, B4 · premissa 5). */
  hostOffline: boolean;
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
export function Composer({ channel, hostOffline }: ComposerProps) {
  const identity = useIdentityStore((state) => state.identity);
  const send = useMessageStore((state) => state.send);
  const candidates = useMentionCandidates(channel.communityId);

  const [value, setValue] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  function handleSend() {
    const content = value.trim();
    if (content === "" && !file) return;

    send({
      channelId: channel.id,
      // Nas comunidades de §2 a identidade local ocupa o lugar de Ana; nas
      // criadas no app, ela é ela mesma (§19.2).
      authorId: findMember(channel.communityId, IDS.ana)
        ? IDS.ana
        : (identity?.id ?? IDS.ana),
      content,
      mentions: mentions
        .filter((mention) => content.includes(mention.token))
        .map((mention) => mention.id),
      attachment: file ? toAttachment(file) : undefined,
      queued: hostOffline,
    });

    setValue("");
    setFile(null);
    setFileError(null);
    setMentions([]);
    setQuery(null);
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

  function handleFile(selected: File | undefined) {
    if (!selected) return;
    if (selected.size > MAX_ATTACHMENT_BYTES) {
      setFile(null);
      setFileError("Arquivo muito grande");
      return;
    }
    setFile(selected);
    setFileError(null);
  }

  const canSend = value.trim() !== "" || file !== null;

  return (
    <div className="px-4 pb-4">
      <TypingIndicator channelId={channel.id} communityId={channel.communityId} />

      {file && (
        <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-border-default bg-surface-sidebar px-3 py-2">
          <span className="text-body text-text-primary">{file.name}</span>
          <span className="text-meta text-text-tertiary">
            {formatFileSize(file.size)}
          </span>
          <button
            type="button"
            onClick={() => setFile(null)}
            className="rounded-sm text-text-tertiary hover:text-text-primary"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Remover anexo</span>
          </button>
        </div>
      )}

      {fileError && (
        <p className="mb-2 text-meta text-feedback-danger">{fileError}</p>
      )}

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

        <div className="flex items-end gap-1 rounded-md border border-border-default bg-surface-elevated p-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-md",
              "text-text-secondary hover:bg-surface-primary hover:text-text-primary",
              "transition-colors duration-(--duration-fast) ease-out",
            )}
          >
            <Paperclip size={20} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Anexar arquivo</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />

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
              placeholder={`Conversar em #${channel.name}`}
              aria-label={`Conversar em #${channel.name}`}
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
