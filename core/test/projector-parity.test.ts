/**
 * Paridade do `projector`/`view` com o normativo, relido **em tempo de execução**.
 *
 * O mesmo padrão do catálogo de erros: a spec é fonte única, então o teste abre
 * `docs/backend-v2.md` e compara com o código. Se a spec mudar e o código não, isto quebra
 * — que é o ponto. Cobre:
 *
 * - §10.3 — toda tabela e coluna do schema de `view.db` existe no SQLite aberto, e toda PK
 *   inclui `community_id` (§10.1). O FTS5 é contentless-delete (`content=''`).
 * - §10.3.1 — as chaves de `meta` do código são exatamente a lista fechada do normativo.
 * - §10.4 — os PRAGMAs do `view.db`.
 * - §8.0 — o `FoldResult` declara `kind` e `author`, a fonte de `rejected_records` e de
 *   `fold.panic{seq, kind}`.
 * - §8.4 — toda forma da union de `Effect` é tratada pelo projector, e as três populações de
 *   `recount` do normativo são as que o SQL conta.
 * - §27.2 — os defaults operacionais do projector (`P2P_PROJECTOR_BATCH` etc.).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  META_FOLD_PANIC,
  META_GLOBAL_KEYS,
  META_INTERPRETED_SEQ,
  META_OP_VERSION,
  META_PER_COMMUNITY_PREFIXES,
  META_VIEW_SCHEMA_VERSION,
  openViewDb,
  type ViewDb,
} from '../src/l0/view/index.ts';
import { SQL_EFFECT_FORMS } from '../src/l1/projector/apply.ts';
import {
  DS_SNAPSHOT_INTERVAL,
  PROJECTOR_BATCH,
  REJECTED_LOG_MAX,
  REPROJECT_PROGRESS_SEQ,
} from '../src/l1/projector/constants.ts';
import { tempDir } from './helpers/projector.ts';

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'docs', 'backend-v2.md'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('docs/backend-v2.md não encontrado a partir do teste');
}

function section(md: string, start: string, end: string): string {
  const a = md.indexOf(start);
  assert.notEqual(a, -1, `${start} sumiu de backend-v2.md`);
  const b = md.indexOf(end, a);
  assert.notEqual(b, -1, `${end} sumiu de backend-v2.md`);
  return md.slice(a, b);
}

/** Extrai as tabelas de Estado de Conteúdo de §10.3: nome → colunas (na ordem). */
function specCsTables(): Map<string, string[]> {
  const md = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');
  const s = section(md, '#### Estado de Conteúdo', '#### 10.3.1');
  const out = new Map<string, string[]>();
  for (const line of s.split('\n')) {
    const m = /^\| `([a-z_]+)` \| (.*?) \|/.exec(line);
    if (m === null) continue;
    const [, table, cell] = m as unknown as [string, string, string];
    // `ds_snapshot`, `rejected_records` e `meta` não são tabelas de CS — são conferidas à
    // parte. A linha do FTS5 não casa com o padrão de colunas.
    if (table === 'ds_snapshot' || table === 'rejected_records' || table === 'meta' || table === 'messages_fts') continue;
    // Colunas começam com crase e carregam tipo (TEXT|INT|BLOB) — anotações de PK e índice
    // ficam de fora porque não casam com o padrão.
    const names = [...cell.matchAll(/`([a-z_]+) (?:TEXT|INT|BLOB)[^`]*`/g)].map(
      (x) => (x as unknown as [string, string])[1],
    );
    out.set(table, names);
  }
  return out;
}

/** Tipos declarados em §10.3, por tabela — comparados **verbatim** com o DDL (SQLite
 * devolve o tipo como escrito, não a afinidade). */
function specTypes(): Map<string, Map<string, string>> {
  const md = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');
  const s = section(md, '#### Estado de Conteúdo', '#### 10.3.1');
  const out = new Map<string, Map<string, string>>();
  for (const line of s.split('\n')) {
    const m = /^\| `([a-z_]+)` \| (.*?) \|/.exec(line);
    if (m === null) continue;
    const [, table, cell] = m as unknown as [string, string, string];
    if (table === 'ds_snapshot' || table === 'rejected_records' || table === 'meta' || table === 'messages_fts') continue;
    const cols = new Map<string, string>();
    for (const c of cell.matchAll(/`([a-z_]+) (TEXT|INT|BLOB)[^`]*`/g)) {
      const [, nome, tipo] = c as unknown as [string, string, string];
      cols.set(nome, tipo);
    }
    out.set(table, cols);
  }
  return out;
}

function openTempView(): { view: ViewDb; dir: string } {
  const dir = tempDir();
  const view = openViewDb(path.join(dir, 'view.db'));
  return { view, dir };
}

describe('paridade — §10.3 schema de view.db', () => {
  const tables = specCsTables();

  it('as 16 tabelas de Estado de Conteúdo existem, com as colunas do normativo', () => {
    const { view, dir } = openTempView();
    try {
      assert.equal(tables.size, 16, '§10.3 lista 16 tabelas de CS');
      for (const [table, cols] of tables) {
        const info = view.pragma(`table_info(${table})`) as Array<{ name: string; type: string; pk: number }>;
        assert.ok(info.length > 0, `tabela ${table} não existe`);
        const nomes = info.map((c) => c.name);
        for (const c of cols) {
          assert.ok(nomes.includes(c), `tabela ${table} sem a coluna ${c}`);
        }
        assert.ok(nomes.includes('community_id'), `${table} sem community_id`);
        const communityPk = info.find((c) => c.name === 'community_id');
        assert.ok(communityPk !== undefined && communityPk.pk > 0, `${table}: community_id fora da PK (§10.1)`);
      }
    } finally {
      view.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tipos das colunas casam com a declaração de §10.3', () => {
    const { view, dir } = openTempView();
    try {
      for (const [table, cols] of specTypes()) {
        const info = view.pragma(`table_info(${table})`) as Array<{ name: string; type: string }>;
        const porNome = new Map(info.map((c) => [c.name, c.type]));
        for (const [col, tipo] of cols) {
          assert.equal(porNome.get(col), tipo, `${table}.${col}`);
        }
      }
    } finally {
      view.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ds_snapshot tem as colunas de §10.3, fold_build_id inclusive (H-22)', () => {
    // A lista sai do normativo, não do teste: §10.3 ganhou `fold_build_id` porque §10.6 exige
    // que o snapshot carregue a procedência do `fold`, e sem a coluna o requisito não cabe.
    const md = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');
    const s = section(md, '#### Estado de Decisão', '#### Estado de Conteúdo');
    const linha = s.split('\n').find((l) => l.startsWith('| `ds_snapshot`'));
    assert.ok(linha !== undefined, 'linha de ds_snapshot sumiu de §10.3');
    const cols = [...linha.matchAll(/`([a-z_]+) (?:TEXT|INT|BLOB)[^`]*`/g)].map(
      (m) => (m as unknown as [string, string])[1],
    );
    assert.ok(cols.includes('fold_build_id'), '§10.3 voltou a não declarar fold_build_id');

    const { view, dir } = openTempView();
    try {
      const snap = view.pragma('table_info(ds_snapshot)') as Array<{ name: string; notnull: number }>;
      assert.deepEqual(snap.map((c) => c.name), cols);
      const build = snap.find((c) => c.name === 'fold_build_id');
      assert.equal(build?.notnull, 1, 'snapshot sem procedência é snapshot inválido (§10.3)');
      const rej = view.pragma('table_info(rejected_records)') as Array<{ name: string }>;
      assert.deepEqual(rej.map((c) => c.name), ['community_id', 'seq', 'kind', 'author_key', 'reason']);
      const meta = view.pragma('table_info(meta)') as Array<{ name: string }>;
      assert.deepEqual(meta.map((c) => c.name), ['key', 'value']);
    } finally {
      view.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('§10.3.1: as chaves de meta do código são exatamente as da lista fechada (H-23)', () => {
    const md = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');
    const s = section(md, '#### 10.3.1', '### 10.4');
    const chaves = s
      .split('\n')
      .filter((l) => l.startsWith('| `'))
      .map((l) => /^\| `([^`]+)`/.exec(l)?.[1])
      .filter((k): k is string => k !== undefined);
    assert.deepEqual(chaves, [
      META_VIEW_SCHEMA_VERSION,
      META_OP_VERSION,
      `${META_FOLD_PANIC}:<communityId>`,
      `${META_INTERPRETED_SEQ}:<communityId>`,
    ]);
    // As duas por comunidade são prefixo, não chave: um `view.db` serve todas (§10.1).
    assert.deepEqual([...META_GLOBAL_KEYS], [META_VIEW_SCHEMA_VERSION, META_OP_VERSION]);
    assert.deepEqual([...META_PER_COMMUNITY_PREFIXES], [META_FOLD_PANIC, META_INTERPRETED_SEQ]);
  });

  it('messages_fts é FTS5 contentless-delete com rowid = messages.rowid', () => {
    const { view, dir } = openTempView();
    try {
      const row = view.prepare("SELECT sql FROM sqlite_master WHERE name = 'messages_fts'").get() as { sql: string };
      assert.match(row.sql, /USING fts5/i);
      assert.match(row.sql, /content=''/);
      assert.match(row.sql, /tokenize='unicode61 remove_diacritics 2'/);
      assert.match(row.sql, /prefix='2 3'/);
    } finally {
      view.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('paridade — §10.4 PRAGMAs do view.db', () => {
  it('os sete PRAGMAs batem com a tabela', () => {
    const md = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');
    const s = section(md, '### 10.4', '### 10.5');
    const row = s.split('\n').find((l) => l.includes('`view.db`'));
    assert.ok(row !== undefined, 'linha do view.db sumiu de §10.4');
    const esperados: Record<string, string | number> = {};
    for (const m of row.matchAll(/`([a-z_]+)=([^`]+)`/g)) {
      const [, k, v] = m as unknown as [string, string, string];
      esperados[k] = Number.isNaN(Number(v)) ? v : Number(v);
    }
    assert.equal(Object.keys(esperados).length, 7, '§10.4 lista 7 PRAGMAs');

    const { view, dir } = openTempView();
    try {
      const leitura: Record<string, unknown> = {};
      for (const k of Object.keys(esperados)) {
        const r = view.pragma(k) as Array<Record<string, unknown>>;
        // O SQLite devolve `busy_timeout` sob a chave `timeout` — exceção conhecida do PRAGMA.
        leitura[k] = r[0]?.[k] ?? r[0]?.[k === 'busy_timeout' ? 'timeout' : 'nunca'];
      }
      // Mapeia os valores enumerados que o SQLite devolve como número.
      assert.equal(leitura.journal_mode, 'wal');
      assert.equal(leitura.synchronous, 1); // NORMAL
      assert.equal(leitura.foreign_keys, 0);
      assert.equal(leitura.busy_timeout, 5000);
      assert.equal(leitura.temp_store, 2); // MEMORY
      assert.equal(leitura.mmap_size, 268435456);
      assert.equal(leitura.cache_size, -32000);
    } finally {
      view.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('paridade — §8.4 formas de Effect', () => {
  it('toda forma da union é tratada pelo projector', () => {
    const md = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');
    const s = section(md, 'type Effect =', '```');
    const formas = new Set([...s.matchAll(/\{\s*t:'([a-zA-Z]+)'/g)].map((m) => (m as unknown as [string, string])[1]));
    assert.ok(formas.size >= 9, '§8.4 sumiu ou mudou de forma');
    const tratadas = new Set<string>([...SQL_EFFECT_FORMS, 'notify']);
    for (const f of formas) {
      assert.ok(tratadas.has(f), `forma ${f} de §8.4 sem tratamento no projector`);
    }
    // ftsRemoveScope é a forma a mais que o fold emite — não está em §8.4 (família H-20).
    assert.ok(tratadas.has('ftsRemoveScope'));
    assert.ok(!formas.has('ftsRemoveScope'), 'ftsRemoveScope entrou em §8.4 — a ressalva acima venceu');
  });
});

describe('paridade — §8.0 e §8.4, o que o normativo declara e o projector consome', () => {
  it('§8.0 declara `kind` e `author` no FoldResult (H-21, H-26)', () => {
    const md = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');
    const s = section(md, 'type FoldResult = {', '}');
    for (const campo of ['kind?', 'author?', 'field?', 'limit?', 'hostTsClamped?']) {
      assert.ok(s.includes(campo), `§8.0 não declara ${campo} — o projector depende dele`);
    }
  });

  it('§8.4 define a população dos três recount, e o SQL conta a mesma (H-25)', () => {
    const md = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');
    const s = section(md, '**População de cada `recount`', '### 8.5');
    // A tabela do normativo nomeia as colunas do predicado; o SQL do projector precisa usar
    // exatamente essas, sob pena de a contagem legendar a tela com outro número.
    for (const [what, predicados] of [
      ['memberCount', ['left_at IS NULL', 'banned = 0']],
      ['roleMemberCount', ['member_roles']],
      ['threadReplyCount', ['deleted_at IS NULL', 'orphaned = 0']],
    ] as const) {
      const linha = s.split('\n').find((l) => l.startsWith(`| \`${what}\``));
      assert.ok(linha !== undefined, `§8.4 não define a população de ${what}`);
      for (const p of predicados) assert.ok(linha.includes(p), `${what}: §8.4 sem \`${p}\``);
    }
    // `hidden_by_ban` é explicitamente **não** subtrativo — a ocultação por ban é reversível.
    assert.ok(s.includes('`hidden_by_ban` não subtrai'), '§8.4 perdeu a ressalva de hidden_by_ban');
    const sql = fs.readFileSync(
      path.join(repoRoot(), 'core', 'src', 'l1', 'projector', 'apply.ts'),
      'utf8',
    );
    const recount = sql.slice(sql.indexOf('function applyRecount'));
    assert.ok(!recount.slice(0, recount.indexOf('\n}')).includes('hidden_by_ban'));
  });
});

describe('paridade — §27.2 defaults operacionais do projector', () => {
  it('os quatro defaults batem com a tabela', () => {
    const md = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');
    const s = section(md, '| `P2P_PROJECTOR_BATCH`', '| `P2P_TURN_ALLOC_TTL_MS`');
    const lidos = new Map<string, number>();
    for (const line of s.split('\n')) {
      const m = /^\| `(P2P_[A-Z_]+)` \| (\d+(?: \d{3})*)/.exec(line);
      if (m === null) continue;
      const [, nome, valor] = m;
      lidos.set(nome as string, Number((valor as string).replace(/ /g, '')));
    }
    assert.equal(lidos.get('P2P_PROJECTOR_BATCH'), PROJECTOR_BATCH);
    assert.equal(lidos.get('P2P_DS_SNAPSHOT_INTERVAL'), DS_SNAPSHOT_INTERVAL);
    assert.equal(lidos.get('P2P_REPROJECT_PROGRESS_SEQ'), REPROJECT_PROGRESS_SEQ);
    assert.equal(lidos.get('P2P_REJECTED_LOG_MAX'), REJECTED_LOG_MAX);
  });
});
