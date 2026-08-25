/**
 * Recusa nomeada → frase em português (§20.1: "o texto em português é do renderer").
 *
 * As escritas de estrutura, cargo e comunidade são **confirma-depois-desenha** (A25, U-02):
 * exigem host online, não enfileiram, e quando o núcleo recusa a tela mostra o motivo em vez
 * de desfazer um otimismo que nunca existiu. Os códigos abaixo são os declarados em §15.4
 * para esses comandos — nada é inventado aqui, e um código fora da lista aparece cru, que é
 * melhor do que uma frase genérica escondendo um caso não previsto.
 */
const FRASES: Record<string, string> = {
  // Estrutura (§15.4, channel.* / category.*)
  E_CHANNEL_NAME_TAKEN: "Já existe um canal com esse nome.",
  E_CHANNEL_NAME_EMPTY: "O canal precisa de um nome.",
  E_CHANNEL_NOT_FOUND: "Esse canal não existe mais.",
  E_CATEGORY_NOT_FOUND: "Essa categoria não existe mais.",
  E_LAST_CHANNEL: "A comunidade precisa de pelo menos um canal.",
  E_LIMIT_EXCEEDED: "Limite da comunidade atingido.",

  // Cargos (§15.4, role.* / member.set*)
  E_PERMISSION_ESCALATION: "Você não pode dar a um cargo permissão que você mesmo não tem.",
  E_HIERARCHY: "Esse cargo está no seu nível ou acima dele.",
  E_FOUNDER_IMMUTABLE: "O cargo de Fundador não pode ser alterado.",
  E_FOUNDER_TOP: "O Fundador fica sempre no topo.",
  E_BASE_ROLE_RESTRICTED: "O cargo base aceita só parte das alterações.",
  E_BASE_ROLE_REQUIRED: "O cargo base não pode ser removido.",
  E_NICKNAME_SELF_ONLY: "Só dá para mudar o próprio apelido.",

  // Comunidade (§15.4, community.*)
  E_NOT_HOST: "Só quem hospeda a comunidade pode fazer isso.",
  E_HOST_CANNOT_LEAVE: "Quem hospeda não pode sair da própria comunidade.",
  E_COMMUNITY_ENDED: "Esta comunidade foi encerrada.",
  E_SUCCESSION_DENIED: "A sucessão foi recusada.",

  // Transversais (§20.2)
  E_PERMISSION_DENIED: "Seu cargo não tem permissão para esta ação.",
  E_HOST_UNAVAILABLE: "Sem conexão com quem hospeda agora.",
  E_RATE_LIMITED: "Ações demais em pouco tempo. Espere um instante.",
  E_VALIDATION: "Algum campo está fora do permitido.",
  E_NOT_FOUND: "Não encontrado.",
  E_CORE_RESTARTED: "O núcleo reiniciou. Tente de novo.",
  E_TIMEOUT: "A resposta demorou demais. Tente de novo.",
};

export function motivoDaRecusa(code: string): string {
  return FRASES[code] ?? `Não foi possível concluir (${code}).`;
}

/**
 * U-02/U-23: com o host fora do ar o gatilho de estrutura fica **visível e desabilitado**,
 * com tooltip — a ação é sua, o momento é que não é. `reconnecting` conta como fora: a op é
 * síncrona e não enfileira, então oferecer o botão seria prometer o que não se cumpre.
 */
export const OFFLINE_HINT = "só muda com o host conectado";
