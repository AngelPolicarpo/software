// §31.18 — configuração operacional da conversa direta. **Local, sem efeito na
// interpretação**: nada aqui entra em `dmFold`, e por isso mudar um destes números não é
// bump de `DM_VERSION`.
//
// Os limites de **campo** (`MAX_ENVELOPE_BYTES`, `CLOCK_SKEW_MS`, `content`, `emoji`, …) não
// estão aqui de propósito: §31.18 manda reusar os de §8.6, e reusar é o que mantém uma fonte
// só para cada limite. Quem os aplica é o `dmFold`.

/** Conversas em estado `accepted` por instalação. Faixa 1–5 000. */
export const P2P_DM_MAX_CONVERSATIONS = 500;

/**
 * Conversas em `pending-in` simultâneas (§31.9 regra 4). Faixa 0–1 000.
 *
 * Cheio → o nó recusa `dmHello` novo com `E_LIMIT_EXCEEDED` e `limit`. **Não há descarte
 * silencioso do mais antigo**: um pedido que o usuário nunca viu não pode sumir sem ele saber.
 */
export const P2P_DM_PENDING_MAX = 100;

/** Registros replicados de um par ainda não aceito (§31.9). Faixa 1–256. Aplicado por B58. */
export const P2P_DM_PENDING_MAX_RECORDS = 32;

/** Acima disso numa conversa a UI avisa e oferece bloquear ou esquecer. **Não trunca**. */
export const P2P_DM_STORAGE_WARN_BYTES = 1024 * 1024 * 1024;

/**
 * §31.19 regra 3 — `retain_until = now + REMOVED_RETENTION_DAYS`, **exatamente como §18.4**.
 * O número é o `P2P_REMOVED_RETENTION_DAYS` de §27.2 (default 7), que mora em `config`; ele
 * chega por opção porque §4 não dá `config` a `directMessages`. Este é só o default de quem
 * não passa nada.
 */
export const DM_REMOVED_RETENTION_DAYS_DEFAULT = 7;

export const DIA_MS = 24 * 60 * 60 * 1000;
