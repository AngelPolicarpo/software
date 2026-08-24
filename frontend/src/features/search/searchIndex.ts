import type { Channel, Member, Message } from "../../domain/types";

/**
 * Motor da busca (§8, 1.2 · §14) — client-side sobre o que já está
 * carregado, que é tudo que existe: o mock não simula busca no host, e a
 * réplica local de quem não é host é parcial por definição (premissa 6).
 */

/** §14 — top ~20 por grupo, com "ver todos" expandindo in-line. */
export const RESULTS_PER_GROUP = 20;

export type DateFilter = "today" | "7d" | "30d";
export type KindFilter = "attachment" | "link" | "pinned";

export interface SearchFilters {
  authorId?: string;
  channelId?: string;
  date?: DateFilter;
  kind?: KindFilter;
}

export interface SearchResults {
  messages: Message[];
  channels: Channel[];
  members: Member[];
}

export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function hasFilters(filters: SearchFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined);
}

function cutoffFor(date: DateFilter, now: Date): number {
  if (date === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  const days = date === "7d" ? 7 : 30;
  return now.getTime() - days * 24 * 60 * 60 * 1000;
}

function matchesKind(message: Message, kind: KindFilter): boolean {
  if (kind === "attachment") return message.attachments.length > 0;
  if (kind === "pinned") return message.pinned;
  return /https?:\/\//i.test(message.content);
}

export interface SearchInput {
  query: string;
  filters: SearchFilters;
  messages: Message[];
  channels: Channel[];
  members: Member[];
  /** Escopo "neste canal": restringe as mensagens antes dos filtros. */
  scopeChannelId?: string;
  now?: Date;
}

/**
 * Um motor, três grupos. Canais e membros só respondem ao texto — filtrar
 * "autor" ou "anexo" não faz sentido para eles, e mostrá-los filtrados por
 * critério que não se aplica confundiria mais do que ajudaria.
 */
export function search({
  query,
  filters,
  messages,
  channels,
  members,
  scopeChannelId,
  now = new Date(),
}: SearchInput): SearchResults {
  const needle = normalize(query.trim());
  const empty = needle === "";

  if (empty && !hasFilters(filters)) {
    return { messages: [], channels: [], members: [] };
  }

  const cutoff = filters.date ? cutoffFor(filters.date, now) : undefined;

  const matchedMessages = messages.filter((message) => {
    if (scopeChannelId && message.channelId !== scopeChannelId) return false;
    if (filters.channelId && message.channelId !== filters.channelId) return false;
    if (filters.authorId && message.authorId !== filters.authorId) return false;
    if (cutoff !== undefined && new Date(message.timestamp).getTime() < cutoff)
      return false;
    if (filters.kind && !matchesKind(message, filters.kind)) return false;
    return empty || normalize(message.content).includes(needle);
  });

  // Mais recentes primeiro: numa busca, o que acabou de ser dito pesa mais.
  matchedMessages.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const textMatch = <T,>(items: T[], label: (item: T) => string) =>
    empty ? [] : items.filter((item) => normalize(label(item)).includes(needle));

  return {
    messages: matchedMessages,
    channels: textMatch(channels, (channel) => channel.name),
    members: textMatch(members, (member) => member.nickname ?? member.displayName),
  };
}

/** Divide o texto no trecho que casou, para destacá-lo no resultado. */
export function splitOnMatch(
  text: string,
  query: string,
): { before: string; match: string; after: string } | null {
  const needle = normalize(query.trim());
  if (needle === "") return null;
  const index = normalize(text).indexOf(needle);
  if (index === -1) return null;
  return {
    before: text.slice(0, index),
    match: text.slice(index, index + needle.length),
    after: text.slice(index + needle.length),
  };
}
