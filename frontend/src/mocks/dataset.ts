/**
 * O que restou do dataset de referência de §2 da spec de UX/UI.
 *
 * As fixtures foram embora quando as telas passaram a ler da IPC-R (ver o comentário em
 * `store/communityStore.ts`): comunidades, canais, membros, mensagens, convites e log de
 * moderação vinham daqui e hoje vêm do núcleo. O que sobrou não é dado de exemplo — são
 * três constantes de produto que nunca tiveram outra casa:
 *
 *   - `PERMISSION_GROUPS`  — o catálogo de permissões de §10, 3.2, que o editor de cargos
 *                            desenha;
 *   - `INVITE_LINK_HOST`   — o host do link de convite (§2, §7 0.3);
 *   - `normalizeInviteCode`— a leitura tolerante do código colado.
 */
import type { Permission } from "../domain/types";

/* ─── Catálogo de permissões (§10, 3.2) ──────────────────────────── */

export const PERMISSION_GROUPS: {
  id: "general" | "text" | "voice" | "moderation";
  label: string;
  permissions: { id: Permission; label: string }[];
}[] = [
  {
    id: "general",
    label: "Geral",
    permissions: [
      { id: "manage_community", label: "Gerenciar comunidade" },
      { id: "manage_channels", label: "Gerenciar canais" },
      { id: "view_audit_log", label: "Ver log de auditoria" },
    ],
  },
  {
    id: "text",
    label: "Texto",
    permissions: [
      { id: "send_messages", label: "Enviar mensagens" },
      { id: "attach_files", label: "Anexar arquivos" },
      { id: "add_reactions", label: "Adicionar reações" },
      { id: "mention_everyone", label: "Mencionar @everyone" },
      { id: "pin_messages", label: "Fixar mensagens" },
      { id: "manage_messages", label: "Gerenciar mensagens" },
    ],
  },
  {
    id: "voice",
    label: "Voz",
    permissions: [
      { id: "voice_speak", label: "Falar" },
      { id: "voice_mute_others", label: "Silenciar outros" },
      { id: "voice_share_screen", label: "Compartilhar tela" },
    ],
  },
  {
    id: "moderation",
    label: "Moderação",
    permissions: [
      { id: "create_invite", label: "Convidar pessoas" },
      { id: "kick_members", label: "Expulsar" },
      { id: "ban_members", label: "Banir" },
      { id: "timeout_members", label: "Aplicar timeout" },
      { id: "manage_roles", label: "Gerenciar cargos" },
    ],
  },
];

/* ─── Convites (§2, §7 0.3) ──────────────────────────────────────── */

export const INVITE_LINK_HOST = "p2p.app";

/**
 * Aceita link completo ou código curto, em qualquer caixa:
 * "p2p.app/invite/x7K2qM", "https://p2p.app/invite/x7K2qM", "X7K2QM".
 */
export function normalizeInviteCode(raw: string): string {
  const trimmed = raw.trim();
  const fromLink = trimmed.match(/invite\/([A-Za-z0-9_-]+)/);
  const code = fromLink ? fromLink[1] : trimmed;
  return code.replace(/[^A-Za-z0-9_-]/g, "");
}
