// Defaults operacionais do `dmProjector`.
//
// Nenhuma delas é constante de protocolo (§27.1): não mudam o resultado do `dmFold`, só o
// ritmo do trabalho. §27.2 declara quatro `P2P_DM_*` — todas de §31.18 e §31.9, todas de
// admissão e teto, **nenhuma** de projeção —, então estas moram aqui e não fingem ser da
// tabela de §27.2. Quem compõe o boot pode passar outros valores.

/** Registros por transação de projeção (§31.12, §10.5 passo 4). O mesmo lote da comunidade. */
export const DM_PROJECTOR_BATCH = 256;

/**
 * Registros interpretados entre snapshots do `DmState` (§31.12, §10.6). **1 000**, contra os
 * 5 000 da comunidade, e a diferença é escolha de custo declarada — `ACHADO-G14-03` e
 * `ACHADO-G14-04`:
 *
 * 1. **Snapshot é custo, não semântica.** Com e sem snapshot a reinterpretação converge para
 *    o mesmo hash de dump (`ACHADO-G14-03`). Errar a cadência custa tempo de boot e de
 *    reordenação; não custa dado, e não muda desfecho nenhum.
 * 2. **Reinterpretar do zero é super-linear.** A cópia-na-escrita do `DmDraft` é por
 *    container, então refazer `n` registros cresce mais que linear em `n`: o gate mediu log
 *    ×8 → ms/registro ×6,7 (2 000 → 241 ms; 16 000 → 12,9 s). O que a cadência compra é o
 *    teto desse `n`. Em 1 000 o pior caso de reinterpretação a partir do snapshot fica na
 *    ordem de 100 ms, dentro da curva medida; em 5 000 já passaria de 1 s.
 * 3. **§31.12 dá UMA linha de snapshot por conversa** (`conversation_id` é a PK inteira).
 *    Não há histórico de snapshots a escolher: ou o único que existe é prefixo válido da
 *    ordem canônica, ou a reinterpretação parte do zero. Uma cadência curta é o que mantém o
 *    caminho comum — chegada **em ordem** — barato, e o caminho raro limitado.
 * 4. **Há um caso em que o snapshot não ajuda por definição:** quando a inserção retroativa é
 *    o log do par chegando **inteiro** depois, o ponto de inserção é o começo da conversa e
 *    não existe snapshot anterior a ele (`ACHADO-G14-03`). Nenhuma cadência resolve isso, e é
 *    por isso que a escolha é sobre o caminho comum, não sobre o pior caso.
 *
 * O outro lado da conta é o preço de gravar. O blob de §31.12 carrega o `DmState` **e** a
 * projeção (ver `snapshot.ts`: sem as linhas, o passo 2 de §31.13 não tem como voltar a
 * projeção), então gravar custa O(conversa) e o total gasto numa conversa de `n` registros é
 * O(n²/intervalo). É a metade da conta que empurra a cadência para cima; a super-linearidade
 * de `ACHADO-G14-04` é a que empurra para baixo. 1 000 é onde as duas se encontram para a
 * ordem de grandeza que o gate mediu — e, por (1), errar aqui custa tempo, nunca dado.
 */
export const DM_SNAPSHOT_INTERVAL = 1_000;

/** Teto de linhas de `dm_rejected_records` por conversa (§31.12). O mesmo de §10.3. */
export const DM_REJECTED_LOG_MAX = 2_000;
