import type { RoleColor } from "../domain/types";

/**
 * As 7 cores curadas de cargo (§5.4) aplicadas como **texto** — nome do autor
 * no chat, nome do membro na lista, pill de cargo. É o uso para o qual elas
 * foram pré-validadas de contraste; como preenchimento, quem manda é
 * `AVATAR_BG_CLASS` (`lib/avatar.ts`), que troca a tinta.
 */
export const ROLE_TEXT_CLASS: Record<RoleColor, string> = {
  "role-gold": "text-role-gold",
  "role-blue": "text-role-blue",
  "role-green": "text-role-green",
  "role-red": "text-role-red",
  "role-purple": "text-role-purple",
  "role-pink": "text-role-pink",
  "role-neutral": "text-role-neutral",
};
