// `self_high_water` — a metade de `manifest.db` que §31.13 exige, em versão **descartável**.
//
// **Não é produto.** A tabela `dm_conversations` inteira é B57, e B57 está bloqueado por
// este gate. O que existe aqui é a coluna que o cenário 4 e o cenário 5 medem, com a
// durabilidade que a regra pede: `synchronous=FULL`, gravada **antes** de cada append.
//
// A limitação vale registrar: `FULL` no SQLite garante que o commit chegou ao `fsync` do SO,
// e um `SIGKILL` mata o processo sem tocar o page cache. Isso mede **falha de processo**, que
// é exatamente o que §10.7.1 diz que a barreira cobre; queda de energia é G4 e continua sem
// evidência aqui.

import Database from 'better-sqlite3';

export type Manifesto = {
  ler(conversationId: string): number;
  gravar(conversationId: string, valor: number): void;
  fechar(): void;
};

export function abrirManifesto(caminho: string): Manifesto {
  const db = new Database(caminho);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.exec(
    'CREATE TABLE IF NOT EXISTS dm_conversations (conversation_id TEXT PRIMARY KEY, self_high_water INTEGER NOT NULL)',
  );
  const sel = db.prepare<[string], { self_high_water: number }>(
    'SELECT self_high_water FROM dm_conversations WHERE conversation_id = ?',
  );
  const ins = db.prepare(
    'INSERT INTO dm_conversations (conversation_id, self_high_water) VALUES (?, ?) ' +
      'ON CONFLICT(conversation_id) DO UPDATE SET self_high_water = excluded.self_high_water',
  );
  return {
    ler: (id) => sel.get(id)?.self_high_water ?? 0,
    gravar: (id, valor) => {
      ins.run(id, valor);
    },
    fechar: () => db.close(),
  };
}

/**
 * §31.13 — a regra de boot, e a única coisa que impede o fork: comparar antes de appendar.
 * `desynced` **não appenda**; a escrita devolve `E_DM_FORKED`.
 */
export function classificar(coreLength: number, selfHighWater: number): 'normal' | 'desynced' {
  return coreLength < selfHighWater ? 'desynced' : 'normal';
}
