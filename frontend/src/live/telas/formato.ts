/**
 * Formatação compartilhada das telas vivas.
 *
 * Fica separado dos componentes porque é código puro: as cores são as do fio, que o núcleo
 * entrega como string, e o fallback existe porque uma cor desconhecida não pode apagar o
 * avatar. Nada aqui conhece o modelo do mock (`src/domain/types.ts`).
 */

import { varDeCor } from "../../ipc/cores";
import type { Presence } from "../../ipc/dto";

/**
 * O que veio do fio → variável CSS. O fio manda o **número** de §6.4.2 (às vezes como
 * string, ver `ipc/cores.ts`), nunca um token de tema: tratar o valor como token produzia
 * `var(--color-3)`, que não existe, e todo avatar caía no fallback.
 */
export function corDe(bruto: unknown): string {
  return varDeCor(bruto);
}

export function iniciais(nome: string): string {
  return nome.trim().slice(0, 2).toUpperCase();
}

export function hora(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function dataHora(ms: number): string {
  return new Date(ms).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function data(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** §6.1 — `offline` não é publicado: ausência é que significa offline, e a cor diz isso. */
export function corDePresenca(p: Presence | undefined): string {
  switch (p) {
    case "online":
      return "var(--color-presence-online)";
    case "idle":
      return "var(--color-presence-idle)";
    case "dnd":
      return "var(--color-presence-dnd)";
    // `invisible` é escolha de quem não quer ser visto: desenhar diferente de offline a
    // denunciaria para quem olha a tela. Cai no mesmo cinza da ausência.
    default:
      return "var(--color-presence-offline)";
  }
}

