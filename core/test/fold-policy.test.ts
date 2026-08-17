/**
 * §9.4 — a matriz de enforcement é transcrição das colunas de §7.4, e este arquivo relê a
 * tabela do normativo **em tempo de execução** para provar isso.
 *
 * É o mesmo formato do teste de paridade de `errors` e `permissions`: se alguém mudar §7.4 e
 * esquecer o código — ou mudar o código e esquecer §7.4 —, quebra aqui, antes de qualquer
 * outra coisa. Uma segunda transcrição que ninguém confere é como as treze contradições de
 * 2026-08-16 apareceram.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { KINDS, type KindName } from '../src/l1/opCodec/index.ts';
import { AUDIT_TYPES, KIND_POLICY, policyOf } from '../src/l1/fold/index.ts';

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'docs', 'backend-v2.md'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('docs/backend-v2.md não encontrado');
}

const SPEC = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');

type LinhaSpec = { kind: string; perm: string; hier: string | null; aud: string; fila: boolean };

/**
 * Lê as cinco tabelas de §7.4. Elas **não** têm as mesmas colunas — §7.4.2 e §7.4.5 não têm
 * `Hier.`, e só §7.4.1 tem `Fila` —, então o cabeçalho é lido de cada uma.
 */
function lerCatalogo(): Map<string, LinhaSpec> {
  const inicio = SPEC.indexOf('### 7.4 Catálogo de ops');
  const fim = SPEC.indexOf('### 7.5 Idempotência');
  assert.ok(inicio > 0 && fim > inicio, '§7.4 não encontrada');
  const linhas = SPEC.slice(inicio, fim).split('\n');

  const out = new Map<string, LinhaSpec>();
  let colunas: string[] = [];
  for (const linha of linhas) {
    // O `|` de "própria \| manage_messages" é **conteúdo**, não separador de célula: dentro de
    // uma tabela markdown ele vem escapado. Separar sem olhar a barra invertida desloca as
    // colunas justamente nas duas linhas que têm alternativa — que são as que mais importam.
    const celulas = linha
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((c) => c.replaceAll('\\|', '|').trim());
    if (celulas.length < 4) continue;
    if (celulas[0] === '`kind`') {
      colunas = celulas;
      continue;
    }
    if (celulas[0]?.startsWith('---') === true || celulas[0]?.startsWith(':') === true) continue;
    const nome = /^`([a-zA-Z.]+)`$/.exec(celulas[0] ?? '')?.[1];
    if (nome === undefined) continue;
    const em = (coluna: string): string | null => {
      const i = colunas.indexOf(coluna);
      return i < 0 ? null : (celulas[i] ?? null);
    };
    out.set(nome, {
      kind: nome,
      perm: em('Perm.') ?? '',
      hier: em('Hier.'),
      aud: em('Aud.') ?? '',
      fila: (em('Fila') ?? '').includes('sim'),
    });
  }
  return out;
}

const CATALOGO = lerCatalogo();

/** Nome de permissão a partir do texto da coluna `Perm.` de §7.4. */
function permsCitadas(texto: string): string[] {
  return [...texto.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] as string);
}

describe('§7.4 — a leitura da spec bate com o catálogo do código', () => {
  it('a tabela tem exatamente os 38 `kind`s', () => {
    assert.equal(CATALOGO.size, 38);
    assert.equal(Object.keys(KINDS).length, 38);
    assert.deepEqual([...CATALOGO.keys()].sort(), Object.keys(KINDS).sort());
  });

  it('§7.4 declara o total, e o número é normativo', () => {
    assert.match(SPEC, /\*\*Total: 38 `kind`s\.\*\*/);
  });
});

describe('§9.4 — coluna `Perm.`', () => {
  for (const [nome, linha] of CATALOGO) {
    it(`${nome}: a política cita a mesma permissão que §7.4`, () => {
      const p = KIND_POLICY[nome as KindName].perm;
      const citadas = permsCitadas(linha.perm);

      if (linha.perm.startsWith('—')) {
        assert.equal(p.r, 'none', `§7.4 diz "—" para ${nome}`);
        return;
      }
      if (linha.perm === 'host') {
        assert.equal(p.r, 'host');
        return;
      }
      if (linha.perm.startsWith('sucessor')) {
        assert.equal(p.r, 'successor');
        return;
      }
      if (linha.perm === 'própria') {
        // `message.edit`: não é permissão, é `E_CANNOT_EDIT_OTHERS` no estágio 14 (§6.7).
        assert.equal(p.r, 'none');
        return;
      }
      assert.ok(citadas.length > 0, `sem permissão citada em "${linha.perm}"`);
      switch (p.r) {
        case 'perm':
          assert.deepEqual(citadas, [p.perm]);
          break;
        case 'permPlusAttachment':
          assert.deepEqual(citadas, [p.perm, p.comAnexo]);
          break;
        case 'ownOrPerm':
        case 'inviteOwnerOrPerm':
          assert.deepEqual(citadas, [p.perm]);
          assert.ok(linha.perm.includes('|'), 'a coluna precisa ser uma alternativa');
          break;
        default:
          assert.fail(`${nome}: §7.4 cita ${citadas.join(', ')} mas a política é ${p.r}`);
      }
    });
  }
});

describe('§9.4 — colunas `Hier.`, `Aud.` e `Fila`', () => {
  for (const [nome, linha] of CATALOGO) {
    it(`${nome}: hierarquia, auditoria e fila batem com §7.4`, () => {
      const p = KIND_POLICY[nome as KindName];
      // `Hier.` ausente na tabela (§7.4.2 e §7.4.5) equivale a "—".
      const querHier = linha.hier !== null && linha.hier !== '—' && linha.hier !== '';
      assert.equal(p.hier, querHier, `Hier. = "${linha.hier}"`);

      const querAud = linha.aud !== '—' && linha.aud !== '';
      assert.equal(p.audit !== null, querAud, `Aud. = "${linha.aud}"`);

      assert.equal(p.fila, linha.fila, `Fila = ${linha.fila}`);
    });
  }

  it('só as ops de §7.4.1 são enfileiráveis', () => {
    const enfileiraveis = [...CATALOGO.values()].filter((l) => l.fila).map((l) => l.kind);
    assert.deepEqual(enfileiraveis.sort(), [
      'message.delete',
      'message.edit',
      'message.pin',
      'message.send',
      'reaction.set',
      'thread.create',
    ]);
  });
});

describe('§6.13 — os 20 tipos de auditoria, 1:1 com `Aud. = sim`', () => {
  it('o enum tem 20 valores, e §6.13 declara 20', () => {
    assert.equal(AUDIT_TYPES.length, 20);
    assert.match(SPEC, /\(\*\*20\*\*\)/);
  });

  it('cada valor está na lista de §6.13, e a lista não tem valor a mais', () => {
    const bloco = SPEC.slice(SPEC.indexOf('### 6.13 ModerationEntry'), SPEC.indexOf('### 6.14'));
    const linha = /`kick · ban[^`]*`/.exec(bloco)?.[0] ?? '';
    const naSpec = linha
      .replaceAll('`', '')
      .split('·')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    assert.deepEqual(naSpec.sort(), [...AUDIT_TYPES].sort());
  });

  it('a correspondência com `Aud. = sim` de §7.4 é 1:1', () => {
    const comAuditoria = [...CATALOGO.values()].filter((l) => l.aud !== '—' && l.aud !== '');
    assert.equal(comAuditoria.length, AUDIT_TYPES.length, 'um tipo por linha auditável');

    const usados = comAuditoria.map((l) => KIND_POLICY[l.kind as KindName].audit);
    assert.equal(new Set(usados).size, AUDIT_TYPES.length, 'nenhum tipo é reaproveitado');
    assert.deepEqual([...usados].sort(), [...AUDIT_TYPES].sort());
  });
});

describe('§9.4 — falha fechado', () => {
  it('todo `kind` do catálogo tem linha na matriz', () => {
    for (const nome of Object.keys(KINDS) as KindName[]) {
      assert.notEqual(policyOf(KINDS[nome]), undefined, nome);
    }
  });

  it('um número fora do catálogo não tem política', () => {
    for (const n of [0, 7, 99, 4242, 65535]) assert.equal(policyOf(n), undefined, String(n));
  });
});
