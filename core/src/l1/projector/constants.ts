// Defaults operacionais do `projector` — §27.2.
//
// §27.2 define estas variáveis como **configuração operacional** (`P2P_*`), resolvida e
// congelada no boot pelo `config` (L0). Quem monta o `projector` passa os valores; aqui
// moram os defaults normativos, que o `config` também usa como piso. Não são constantes de
// protocolo (§27.1): não mudam o resultado do `fold`, só o ritmo do trabalho.

/** Registros por transação de projeção (§10.5 passo 4). */
export const PROJECTOR_BATCH = 256;
/** Registros interpretados entre snapshots do `DecisionState` (§10.6). */
export const DS_SNAPSHOT_INTERVAL = 5_000;
/** A partir de quantos registros a reprojeção emite `core.reprojecting` (§10.5). */
export const REPROJECT_PROGRESS_SEQ = 100_000;
/** Teto de linhas de `rejected_records` por comunidade (§10.3). */
export const REJECTED_LOG_MAX = 2_000;
