/**
 * Formatação de data, hora e tamanho de arquivo — textos de interface em
 * português (§0), sempre em pt-BR.
 *
 * A transcrição de §2 fixa o formato dos carimbos de mensagem ("hoje 09:14"),
 * então é ele que sai daqui, não o padrão do `Intl`.
 */

/** Agrupamento de mensagens consecutivas do mesmo autor (§9, 2.1). */
export const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

const clock = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
});

const shortDate = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const longDate = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Quantos dias separam `date` de hoje (0 = hoje, 1 = ontem). */
function daysFromToday(date: Date, now: Date): number {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round((startOfDay(now) - startOfDay(date)) / oneDay);
}

export function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a) === startOfDay(b);
}

/** "09:14" — hora isolada, usada na medianiz das mensagens agrupadas. */
export function formatClock(date: Date): string {
  return clock.format(date);
}

/** Separador de data da lista de mensagens (§6): "Hoje", "Ontem", ou a data. */
export function formatDaySeparator(date: Date, now = new Date()): string {
  const days = daysFromToday(date, now);
  if (days === 0) return "Hoje";
  if (days === 1) return "Ontem";
  return longDate.format(date);
}

/** Carimbo ao lado do autor: "hoje 09:14" (§2), "ontem 09:14", "12/03/2026 09:14". */
export function formatMessageTimestamp(date: Date, now = new Date()): string {
  const days = daysFromToday(date, now);
  if (days === 0) return `hoje ${clock.format(date)}`;
  if (days === 1) return `ontem ${clock.format(date)}`;
  return `${shortDate.format(date)} ${clock.format(date)}`;
}

/** Data completa para o `title` do carimbo: "12 de março de 2026 às 09:14". */
export function formatFullTimestamp(date: Date): string {
  return `${longDate.format(date)} às ${clock.format(date)}`;
}

function decimals(value: number, digits: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Tamanho de arquivo em unidades decimais — §2 descreve o anexo de
 * 1.240.000.000 bytes como "1.24 GB", que só fecha em base 1000.
 */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1e9) return `${decimals(bytes / 1e9, 2)} GB`;
  if (bytes >= 1e6) return `${decimals(bytes / 1e6, 1)} MB`;
  if (bytes >= 1e3) return `${decimals(bytes / 1e3, 0)} KB`;
  return `${bytes} B`;
}

/**
 * Carimbo relativo do log de auditoria (§10, 3.3): "há 2 dias", "há 3
 * semanas". Feed de eventos se lê por distância, não por data exata.
 */
export function formatRelativeTime(iso: string, now = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "agora mesmo";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `há ${days} ${days === 1 ? "dia" : "dias"}`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `há ${weeks} ${weeks === 1 ? "semana" : "semanas"}`;
  const months = Math.round(days / 30);
  return `há ${months} ${months === 1 ? "mês" : "meses"}`;
}
