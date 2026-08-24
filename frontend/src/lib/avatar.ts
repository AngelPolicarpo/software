import type { AvatarColor, PresenceStatus } from "../domain/types";

/**
 * Avatares e ícones de comunidade — §7 (0.1, 0.4) e §6 (Avatar).
 *
 * A spec pede "iniciais sobre cor gerada a partir do ID do usuário", sem
 * upload de imagem no v1. A paleta reaproveita as 7 cores curadas de cargo
 * (§5.4) + o accent do produto, em vez de inventar uma paleta paralela.
 */
export const AVATAR_COLORS: AvatarColor[] = [
  "accent",
  "role-blue",
  "role-green",
  "role-gold",
  "role-red",
  "role-purple",
  "role-pink",
  "role-neutral",
];

/**
 * Preenchimento sólido + tinta escura. As cores de §5.4 são validadas para
 * contraste *como texto sobre superfície escura*; usadas como fundo, o par
 * legível nas 8 é a tinta `surface-app`, não branco (branco sobre
 * `role-gold` ficaria ilegível).
 */
export const AVATAR_BG_CLASS: Record<AvatarColor, string> = {
  accent: "bg-accent-default",
  "role-gold": "bg-role-gold",
  "role-blue": "bg-role-blue",
  "role-green": "bg-role-green",
  "role-red": "bg-role-red",
  "role-purple": "bg-role-purple",
  "role-pink": "bg-role-pink",
  "role-neutral": "bg-role-neutral",
};

export const PRESENCE_BG_CLASS: Record<PresenceStatus, string> = {
  online: "bg-presence-online",
  idle: "bg-presence-idle",
  dnd: "bg-presence-dnd",
  // Invisível se mostra como offline para os outros (§2).
  invisible: "bg-transparent",
  offline: "bg-transparent",
};

export const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  online: "Online",
  idle: "Ausente",
  dnd: "Ocupado",
  invisible: "Invisível",
  offline: "Offline",
};

/** Conectores que não viram inicial: "Vale do Código" → "VC". */
const IGNORED_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "d"]);

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/**
 * "Ana Torres" → "AT" · "Vale do Código" → "VC" · "Ateliê" → "AT".
 * Nunca devolve string vazia enquanto houver ao menos uma letra/dígito.
 */
export function initialsFrom(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .filter((word) => !IGNORED_WORDS.has(stripDiacritics(word).toLowerCase()));

  if (words.length === 0) return "?";

  if (words.length === 1) {
    return stripDiacritics(words[0]).slice(0, 2).toUpperCase();
  }

  const first = stripDiacritics(words[0])[0] ?? "";
  const last = stripDiacritics(words[words.length - 1])[0] ?? "";
  return (first + last).toUpperCase();
}

/** Hash estável (djb2) — mesma seed sempre gera a mesma cor. */
function hash(seed: string): number {
  let value = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    value = (value * 33) ^ seed.charCodeAt(i);
  }
  return Math.abs(value);
}

export function avatarColorFromSeed(seed: string): AvatarColor {
  return AVATAR_COLORS[hash(seed) % AVATAR_COLORS.length];
}

/**
 * "Gerar outra cor" (§7, 0.1) — sempre devolve uma cor diferente da atual,
 * senão o clique parece não ter funcionado.
 */
export function nextAvatarColor(current: AvatarColor): AvatarColor {
  const options = AVATAR_COLORS.filter((color) => color !== current);
  return options[Math.floor(Math.random() * options.length)];
}

/** "Ana Torres" → "@ana" (identificador local exibido em 3.1). */
export function handleFromDisplayName(displayName: string): string {
  const firstWord = stripDiacritics(displayName.trim()).split(/\s+/)[0] ?? "";
  const slug = firstWord.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `@${slug || "usuario"}`;
}
