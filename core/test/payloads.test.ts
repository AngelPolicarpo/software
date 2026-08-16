/**
 * §28.1 — registry de payload de §7.4.
 *
 * O teste central relê as **cinco tabelas** de §7.4 do normativo e compara nome, número e
 * layout campo a campo. §7.4 diz "Total: 38 `kind`s. O número é normativo e fechado para
 * `opVersion = 1`" — e §7.2.1 fecha `DR-10`: nenhum `kind` pode ser implementado sem sua
 * linha de payload. Se a tabela mudar e o código não, isto quebra.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  KINDS,
  KIND_NAMES,
  PAYLOAD_FIELDS,
  PAYLOAD_LAYOUT,
  type Attachment,
  type BlobRef,
  type KindName,
  type PayloadOf,
  decodePayload,
  encodePayload,
  isKnownKind,
  kindName,
  kindNumber,
  parseLayout,
} from '../src/l1/opCodec/index.ts';

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'docs', 'backend-v2.md'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('docs/backend-v2.md não encontrado');
}

/** As cinco subtabelas de §7.4, na ordem em que aparecem. */
function specCatalog(): Array<{ nome: string; n: number; layout: string }> {
  const md = fs.readFileSync(path.join(repoRoot(), 'docs', 'backend-v2.md'), 'utf8');
  const a = md.indexOf('### 7.4 Catálogo de ops');
  const b = md.indexOf('### 7.5', a);
  assert.ok(a !== -1 && b !== -1, '§7.4 sumiu de backend-v2.md');

  const out: Array<{ nome: string; n: number; layout: string }> = [];
  for (const line of md.slice(a, b).split('\n')) {
    const m = /^\| `([a-z]+\.[a-zA-Z]+)` \| (\d+) \| (.+?) \|/.exec(line);
    if (m === null) continue;
    const [, nome, n, payload] = m as unknown as [string, string, string, string];
    // A tabela escreve o payload em crases por campo; `*(vazio)*` é o payload sem campos.
    const layout = payload.trim() === '*(vazio)*' ? '' : payload.trim().replace(/`/g, '');
    out.push({ nome, n: Number(n), layout });
  }
  return out;
}

describe('catálogo de `kind` (§7.4) — paridade com o normativo', () => {
  const spec = specCatalog();

  it('são os 38 que §7.4 declara', () => {
    assert.equal(spec.length, 38, 'a tabela de §7.4 deixou de ter 38 linhas');
    assert.equal(KIND_NAMES.length, 38);
  });

  it('nome e número batem linha a linha — o número é normativo', () => {
    for (const { nome, n } of spec) {
      assert.equal(KINDS[nome as KindName], n, `${nome} deveria ser ${n}`);
    }
  });

  it('nenhum kind a mais nem a menos', () => {
    assert.deepEqual([...KIND_NAMES].sort(), spec.map((s) => s.nome).sort());
  });

  it('nenhum número repetido', () => {
    const ns = KIND_NAMES.map((k) => KINDS[k]);
    assert.equal(new Set(ns).size, 38);
  });

  it('o layout de payload bate campo a campo com §7.4', () => {
    for (const { nome, layout } of spec) {
      const k = nome as KindName;
      // §7.4.1 escreve `opt<blobref+meta> attachment` e define a estrutura logo abaixo da
      // tabela; o registry usa o tipo composto `attachment`. É a única substituição.
      const esperado = layout.replace('opt<blobref+meta> attachment', 'opt<attachment> attachment');
      assert.equal(PAYLOAD_LAYOUT[k], esperado, `layout de ${nome} divergiu de §7.4`);
    }
  });

  it('todo kind tem linha de payload — §7.2.1 fecha DR-10', () => {
    for (const k of KIND_NAMES) {
      assert.notEqual(PAYLOAD_FIELDS[k], undefined, k);
    }
  });

  it('member.leave e relay.withdraw são os únicos sem campo', () => {
    const vazios = KIND_NAMES.filter((k) => PAYLOAD_FIELDS[k].length === 0);
    assert.deepEqual(vazios.sort(), ['member.leave', 'relay.withdraw']);
  });
});

describe('resolução de kind', () => {
  it('kindName e kindNumber são inversos', () => {
    for (const k of KIND_NAMES) assert.equal(kindName(kindNumber(k)), k);
  });

  it('kind desconhecido não resolve — §7.2 regra 4 manda IGNORED, não exceção', () => {
    for (const n of [0, 7, 9, 17, 35, 62, 999, 65_535, -1]) {
      assert.equal(isKnownKind(n), false, String(n));
      assert.equal(kindName(n), null, String(n));
    }
  });
});

// ─── round-trip ────────────────────────────────────────────────────────────────────────

const KEY = Buffer.alloc(32, 0x5a);
const SIG = Buffer.alloc(64, 0x3c);
const BLOB: BlobRef = {
  blobsCoreKey: KEY,
  byteOffset: 1,
  blockOffset: 2,
  blockLength: 3,
  byteLength: 4,
};
const ATTACH: Attachment = { blob: BLOB, name: 'foto.png', sizeBytes: 1024, kind: 1, hash: KEY };

function valorDe(tipo: string): unknown {
  if (tipo.startsWith('opt<')) return valorDe(tipo.slice(4, -1));
  if (tipo.startsWith('arr<')) return [valorDe(tipo.slice(4, -1)), valorDe(tipo.slice(4, -1))];
  switch (tipo) {
    case 'u8': return 7;
    case 'u16': return 1000;
    case 'u32': return 100_000;
    case 'u64': return 1_755_300_000_000;
    case 'key': return KEY;
    case 'sig': return SIG;
    case 'str': return 'texto com acentuação e 🌍';
    case 'id': return 'msg-HVDMWKXAD1045Q59TQN01BX7RR';
    case 'rank': return 'M1';
    case 'bool': return true;
    case 'bytes': return Buffer.from([1, 2, 3]);
    case 'blobref': return BLOB;
    case 'attachment': return ATTACH;
    default: throw new Error(`sem valor para ${tipo}`);
  }
}

function payloadCheio(k: KindName): Record<string, unknown> {
  return Object.fromEntries(PAYLOAD_FIELDS[k].map((f) => [f.name, valorDe(f.type)]));
}

describe('round-trip dos 38 kinds', () => {
  it('com todo campo presente, ida e volta preserva tudo', () => {
    for (const k of KIND_NAMES) {
      const v = payloadCheio(k);
      const back = decodePayload(k, encodePayload(k, v as PayloadOf<typeof k>));
      assert.notEqual(back, null, `${k} não decodificou`);
      const rec = back as Record<string, unknown>;
      for (const f of PAYLOAD_FIELDS[k]) {
        const esperado = v[f.name];
        const obtido = rec[f.name];
        if (Buffer.isBuffer(esperado)) {
          assert.ok(Buffer.isBuffer(obtido) && obtido.equals(esperado), `${k}.${f.name}`);
        } else {
          assert.deepEqual(obtido, esperado, `${k}.${f.name}`);
        }
      }
    }
  });

  it('com todo opcional ausente, a chave não aparece no objeto', () => {
    for (const k of KIND_NAMES) {
      const obrigatorios = PAYLOAD_FIELDS[k].filter((f) => !f.type.startsWith('opt<'));
      const v = Object.fromEntries(obrigatorios.map((f) => [f.name, valorDe(f.type)]));
      const back = decodePayload(k, encodePayload(k, v as PayloadOf<typeof k>));
      assert.notEqual(back, null, k);
      for (const f of PAYLOAD_FIELDS[k]) {
        if (f.type.startsWith('opt<')) {
          assert.ok(!(f.name in (back as object)), `${k}.${f.name} não devia existir`);
        }
      }
    }
  });

  it('a forma canônica é estável: mesma entrada, mesmos bytes', () => {
    for (const k of KIND_NAMES) {
      const v = payloadCheio(k) as PayloadOf<typeof k>;
      const a = encodePayload(k, v).toString('hex');
      assert.equal(encodePayload(k, v).toString('hex'), a, k);
    }
  });

  it('kinds vazios produzem payload de zero bytes', () => {
    for (const k of ['member.leave', 'relay.withdraw'] as const) {
      assert.equal(encodePayload(k, {} as PayloadOf<typeof k>).length, 0);
      assert.deepEqual(decodePayload(k, Buffer.alloc(0)), {});
    }
  });
});

describe('§8.5 — totalidade do registry', () => {
  it('nenhum kind lança em truncamento, para nenhuma posição', () => {
    for (const k of KIND_NAMES) {
      const cheio = encodePayload(k, payloadCheio(k) as PayloadOf<typeof k>);
      for (let n = 0; n < cheio.length; n++) {
        assert.doesNotThrow(() => decodePayload(k, cheio.subarray(0, n)), `${k} corte ${n}`);
      }
    }
  });

  it('nenhum kind lança em bytes aleatórios', () => {
    let seed = 0x2026_0816;
    const rnd = (): number => (seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff) % 256;
    for (const k of KIND_NAMES) {
      for (let n = 0; n < 40; n++) {
        const b = Buffer.from(Array.from({ length: n * 3 }, rnd));
        assert.doesNotThrow(() => decodePayload(k, b), `${k} n=${n}`);
      }
    }
  });

  it('§7.2 regra 2: bytes sobrando no fim são ignorados', () => {
    for (const k of KIND_NAMES) {
      const cheio = encodePayload(k, payloadCheio(k) as PayloadOf<typeof k>);
      const comLixo = Buffer.concat([cheio, Buffer.from('sobra')]);
      assert.notEqual(decodePayload(k, comLixo), null, k);
    }
  });
});

describe('parseLayout', () => {
  it('quebra o layout na ordem declarada', () => {
    const f = parseLayout('id channelId · opt<arr<id>> readOnlyForRoleIds · bool x');
    assert.deepEqual(f.map((x) => x.name), ['channelId', 'readOnlyForRoleIds', 'x']);
    assert.deepEqual(f.map((x) => x.type), ['id', 'opt<arr<id>>', 'bool']);
  });

  it('layout vazio não tem campo', () => {
    assert.deepEqual(parseLayout(''), []);
  });

  it('recusa tipo fora de §7.2.1', () => {
    assert.throws(() => parseLayout('float x'), /tipo desconhecido/);
  });
});

describe('tipos derivados do layout', () => {
  it('message.send tem os campos de §7.4.1, com os opcionais opcionais', () => {
    const p: PayloadOf<'message.send'> = {
      channelId: 'ch-x',
      content: 'oi',
      mentions: ['everyone'],
      // attachment, replyToId e threadId são opt<> — omitir precisa compilar
    };
    assert.equal(p.content, 'oi');
    assert.equal(p.attachment, undefined);
  });

  it('opt<arr<id>> vira string[] | undefined', () => {
    const p: PayloadOf<'channel.update'> = { channelId: 'ch-x', readOnlyForRoleIds: ['role-a'] };
    assert.deepEqual(p.readOnlyForRoleIds, ['role-a']);
  });

  it('key e sig viram Buffer', () => {
    const p: PayloadOf<'member.join'> = {
      invitePublicKey: KEY,
      joinProof: SIG,
      displayName: 'ana',
      avatarColor: 3,
      blobsCoreKey: KEY,
    };
    assert.ok(Buffer.isBuffer(p.invitePublicKey));
  });
});
