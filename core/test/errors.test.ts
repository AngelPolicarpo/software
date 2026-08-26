/**
 * §28.1 — `errors` é um dos módulos puros; testa sem mock de nada.
 *
 * O teste central é o de paridade: §20.2 diz que o catálogo é **fonte única**. Então o
 * teste relê a tabela de `docs/backend-v2.md` e compara com o código. Se a spec mudar e o
 * código não, isto quebra — que é o ponto.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  AppErrorException,
  ERROR_CATALOG,
  ERROR_CODES,
  classOf,
  error,
  isAppError,
  isErrorCode,
  isRetryable,
  isTerminalForOutbox,
  retryPolicyOf,
  toAppError,
  type ErrorCode,
} from '../src/l1/errors/index.ts';

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'docs', 'backend-v2.md'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('docs/backend-v2.md não encontrado a partir do teste');
}

/** Extrai §20.2 do normativo, sem depender de números de linha. */
function specCatalog(): Map<string, { class: string; http: number; retry: string }> {
  const md = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');
  const start = md.indexOf('### 20.2 Catálogo completo');
  assert.notEqual(start, -1, '§20.2 sumiu de backend-v2.md');
  const end = md.indexOf('### 20.3', start);
  assert.notEqual(end, -1, '§20.3 sumiu de backend-v2.md');

  const CLS: Record<string, string> = {
    cliente: 'client',
    segurança: 'security',
    idempotência: 'idempotency',
    autorização: 'authorization',
    regra: 'rule',
    estado: 'state',
    conflito: 'conflict',
    validação: 'validation',
    proteção: 'protection',
    rede: 'network',
    infra: 'infra',
    lote: 'batch',
    'compat.': 'compat',
    bug: 'bug',
  };

  const out = new Map<string, { class: string; http: number; retry: string }>();
  for (const line of md.slice(start, end).split('\n')) {
    const m = /^\| `(E_[A-Z_]+)` \| ([^|]+?) \| (\d+) \| ([^|]+?) \| .+ \|$/.exec(line);
    if (m === null) continue;
    const [, code, cls, http, r] = m as unknown as [string, string, string, string, string];
    const rc = r.replace(/\*/g, '').trim();
    const retry =
      rc === 'não'
        ? 'no'
        : rc === '—'
          ? 'n/a'
          : rc.startsWith('sim, após')
            ? 'after-until'
            : rc.startsWith('sim (1')
              ? 'once'
              : 'yes';
    const mapped = CLS[cls.trim()];
    assert.ok(mapped !== undefined, `classe desconhecida em §20.2: ${cls}`);
    out.set(code, { class: mapped, http: Number(http), retry });
  }
  return out;
}

describe('catálogo (§20.2) — paridade com o normativo', () => {
  const spec = specCatalog();

  it('tem os 85 códigos que a spec declara', () => {
    // 87 até 2026-08-22; `E_BLOB_NOT_STAGED` entrou com a barreira de §13.7 no roteador,
    // e `E_SESSION_FULL`/`E_VOICE_FULL`/`E_CAMERA_LIMIT` saíram com os tetos de §90.
    assert.equal(spec.size, 85, 'a tabela de §20.2 deixou de ter 85 linhas');
    assert.equal(ERROR_CODES.length, 85);
  });

  it('não tem código a mais nem a menos que §20.2', () => {
    assert.deepEqual([...ERROR_CODES].sort(), [...spec.keys()].sort());
  });

  it('classe, equivalente HTTP e política de retentativa batem linha a linha', () => {
    for (const [code, s] of spec) {
      const got = ERROR_CATALOG[code as ErrorCode];
      assert.deepEqual(
        { class: got.class, http: got.http, retry: got.retry },
        s,
        `§20.2 divergiu em ${code}`,
      );
    }
  });

  it('toda mensagem existe e é não vazia (§20.1)', () => {
    for (const code of ERROR_CODES) {
      assert.equal(typeof ERROR_CATALOG[code].message, 'string');
      assert.ok(ERROR_CATALOG[code].message.length > 0, `${code} sem mensagem`);
    }
  });
});

describe('error() — a forma de §20.1', () => {
  it('usa a mensagem do catálogo e não inventa campo', () => {
    const e = error('E_BANNED');
    assert.deepEqual(e, { code: 'E_BANNED', message: ERROR_CATALOG.E_BANNED.message });
    assert.deepEqual(Object.keys(e), ['code', 'message']);
  });

  it('aceita mensagem própria', () => {
    assert.equal(error('E_NOT_FOUND', { message: 'role not found' }).message, 'role not found');
  });

  it('E_VALIDATION carrega o campo (§20.1)', () => {
    const e = error('E_VALIDATION', { field: 'content' });
    assert.equal(e.field, 'content');
    assert.equal(e.code, 'E_VALIDATION');
  });

  it('E_RATE_LIMITED, E_BUSY e E_QUOTA_EXCEEDED carregam retryAfterMs (§20.1, §20.2)', () => {
    assert.equal(error('E_RATE_LIMITED', { retryAfterMs: 2_000 }).retryAfterMs, 2_000);
    assert.equal(error('E_BUSY', { retryAfterMs: 50 }).retryAfterMs, 50);
    assert.equal(error('E_QUOTA_EXCEEDED', { retryAfterMs: 1 }).retryAfterMs, 1);
  });

  it('E_LIMIT_EXCEEDED traz limit e E_WIPE_INCOMPLETE traz stage (§20.2)', () => {
    assert.deepEqual(error('E_LIMIT_EXCEEDED', { details: { limit: 500 } }).details, { limit: 500 });
    assert.deepEqual(error('E_WIPE_INCOMPLETE', { details: { stage: 'key-wiped' } }).details, {
      stage: 'key-wiped',
    });
  });

  it('nunca lança — o fold depende disso (§4, §8.5)', () => {
    for (const code of ERROR_CODES) {
      assert.doesNotThrow(() =>
        // O tipo exige as opções por código; em runtime nada é obrigatório.
        (error as (c: ErrorCode, o?: unknown) => unknown)(code, {
          field: 'x',
          retryAfterMs: 1,
        }),
      );
    }
  });
});

describe('retentativa (§20.2 coluna R, §20.3.5)', () => {
  it('E_DUPLICATE não é retentável nem terminal — é sucesso (§20.3.7)', () => {
    assert.equal(retryPolicyOf('E_DUPLICATE'), 'n/a');
    assert.equal(isRetryable('E_DUPLICATE'), false);
    assert.equal(isTerminalForOutbox('E_DUPLICATE'), false);
  });

  it('os cinco casos não-"não" da coluna R são retentáveis', () => {
    for (const code of ['E_TIMED_OUT', 'E_QUOTA_EXCEEDED', 'E_NO_PEERS', 'E_INTERNAL'] as const) {
      assert.equal(isRetryable(code), true, code);
      assert.equal(isTerminalForOutbox(code), false, code);
    }
    assert.equal(retryPolicyOf('E_TIMED_OUT'), 'after-until');
    assert.equal(retryPolicyOf('E_INTERNAL'), 'once');
  });

  it('E_VERSION_UNSUPPORTED é terminal na outbox (§20.2)', () => {
    assert.equal(isTerminalForOutbox('E_VERSION_UNSUPPORTED'), true);
  });

  it('retentável e terminal são mutuamente exclusivos em todo código', () => {
    for (const code of ERROR_CODES) {
      assert.ok(!(isRetryable(code) && isTerminalForOutbox(code)), code);
    }
  });
});

describe('§20.3.3 — rede nunca vira validação', () => {
  it('nenhum código é de rede e de validação ao mesmo tempo', () => {
    const network = ERROR_CODES.filter((c) => classOf(c) === 'network');
    const validation = ERROR_CODES.filter((c) => classOf(c) === 'validation');
    assert.ok(network.length > 0);
    assert.ok(validation.length > 0);
    assert.equal(network.filter((c) => validation.includes(c)).length, 0);
  });

  it('E_HOST_UNAVAILABLE e E_RATE_LIMITED são distinguíveis por classe (§20.3.4)', () => {
    assert.equal(classOf('E_HOST_UNAVAILABLE'), 'network');
    assert.equal(classOf('E_RATE_LIMITED'), 'protection');
  });
});

describe('guardas e conversão', () => {
  it('isErrorCode só aceita o catálogo', () => {
    assert.equal(isErrorCode('E_BANNED'), true);
    assert.equal(isErrorCode('E_NOPE'), false);
    assert.equal(isErrorCode('toString'), false);
    assert.equal(isErrorCode(7), false);
  });

  it('isAppError exige código do catálogo e mensagem', () => {
    assert.equal(isAppError(error('E_TIMEOUT')), true);
    assert.equal(isAppError({ code: 'E_TIMEOUT' }), false);
    assert.equal(isAppError({ code: 'nope', message: 'x' }), false);
    assert.equal(isAppError(null), false);
  });

  it('§20.3.1 — toAppError não deixa stack atravessar', () => {
    const original = new TypeError('leaky internals at /home/alguem/x.ts:12');
    const e = toAppError(original);
    assert.equal(e.code, 'E_INTERNAL');
    assert.deepEqual(Object.keys(e), ['code', 'message']);
    assert.ok(!JSON.stringify(e).includes('leaky internals'));
  });

  it('toAppError devolve o erro carregado pela exceção', () => {
    const inner = error('E_VALIDATION', { field: 'name' });
    assert.deepEqual(toAppError(new AppErrorException(inner)), inner);
  });

  it('AppErrorException guarda o AppError fora da mensagem serializável', () => {
    const e = new AppErrorException(error('E_CORE_CORRUPT'));
    assert.equal(e.error.code, 'E_CORE_CORRUPT');
    assert.match(e.message, /^E_CORE_CORRUPT: /);
    assert.equal(e.name, 'AppErrorException');
  });

  it('§20.3.2 — E_INTERNAL é bug: classe bug, HTTP 500', () => {
    assert.equal(classOf('E_INTERNAL'), 'bug');
    assert.equal(ERROR_CATALOG.E_INTERNAL.http, 500);
  });
});
