/**
 * §28.1 — `opCodec` é puro (§4).
 *
 * Duas coisas são testadas aqui e não em `fold`, porque é onde elas vivem:
 *
 *  - **Totalidade** (§8.5): nenhuma função lança, para nenhuma entrada. É a propriedade que
 *    elimina a classe inteira de "exceção de reducer é parada permanente e
 *    auto-reproduzível" (`F-04`).
 *  - **Custo sob entrada hostil**: §8.2 não tem estágio de teto de bytes antes do decode,
 *    então um prefixo de tamanho mentiroso não pode virar alocação.
 *
 * Os vetores de paridade vêm de `poc-01-fold`, cuja implementação sustenta o `CONFIRMADO`
 * de G1 sobre 10⁷ entradas hostis.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { opId } from '../src/l1/idgen/index.ts';
import {
  FLAG_CLOCK_SKEWED,
  OP_VERSION,
  Reader,
  Writer,
  type Envelope,
  type Op,
  canonicalEnvelope,
  decodeEnvelope,
  decodeHostRecord,
  decodeOp,
  encodeEnvelope,
  encodeHostRecord,
  encodeOp,
  hostRecordSigningHash,
  isClockSkewed,
  isSupportedVersion,
  opSigningHash,
} from '../src/l1/opCodec/index.ts';

const OP: Op = {
  v: 1,
  communityId: Buffer.alloc(32, 0xab),
  kind: 1,
  author: Buffer.alloc(32, 0x11),
  authorSeq: 42,
  ts: 1_755_300_000_000,
  payload: Buffer.from('payload-de-teste'),
};
const ENV: Envelope = { op: encodeOp(OP), sig: Buffer.alloc(64, 0x77) };

describe('paridade com a implementação que G1 confirmou', () => {
  it('encodeOp bate byte a byte', () => {
    // prettier-ignore
    const esperado =
      '01' +                                                                    // v
      'ab'.repeat(32) +                                                         // communityId
      '0100' +                                                                  // kind u16 LE
      '11'.repeat(32) +                                                         // author
      '2a00000000000000' +                                                      // authorSeq u64 LE
      '007108b098010000' +                                                      // ts u64 LE
      '10' + Buffer.from('payload-de-teste').toString('hex');                   // bytes: uint + dados
    assert.equal(encodeOp(OP).toString('hex'), esperado);
  });

  it('encodeEnvelope bate', () => {
    assert.equal(encodeEnvelope(ENV).toString('hex').length, 2 * (1 + ENV.op.length + 64));
    assert.ok(encodeEnvelope(ENV).toString('hex').startsWith('6401abab'));
  });

  it('os dois hashes de assinatura batem (§5.2)', () => {
    assert.equal(
      opSigningHash(ENV.op).toString('hex'),
      '72c4cb9963b67b50855fb59feb23e3e2bcd9564bfd824cc87d9f9f5f76d128e2',
    );
    assert.equal(
      hostRecordSigningHash(encodeEnvelope(ENV), 1_755_300_001_234, 1).toString('hex'),
      '347ce7547452506c218b1e4a1433a7787dd2ef1156ce0a5643cca17378b71529',
    );
  });

  it('o opId sobre o envelope canônico bate', () => {
    assert.equal(
      opId(canonicalEnvelope(ENV)),
      '1819afbfa3c4b4720cbad086f2a2c2ba502dfaed9ebf46760b56f8e10134493e',
    );
  });
});

describe('round-trip (§7.1)', () => {
  it('Op sobrevive à ida e volta', () => {
    const back = decodeOp(encodeOp(OP));
    assert.notEqual(back, null);
    assert.equal(back!.v, OP.v);
    assert.equal(back!.kind, OP.kind);
    assert.equal(back!.authorSeq, OP.authorSeq);
    assert.equal(back!.ts, OP.ts);
    assert.ok(back!.communityId.equals(OP.communityId));
    assert.ok(back!.author.equals(OP.author));
    assert.ok(back!.payload.equals(OP.payload));
  });

  it('Envelope e HostRecord sobrevivem', () => {
    const env = decodeEnvelope(encodeEnvelope(ENV));
    assert.ok(env!.op.equals(ENV.op) && env!.sig.equals(ENV.sig));

    const hr = { envelope: encodeEnvelope(ENV), hostTs: 1_755_300_001_234, flags: 1, hostSig: Buffer.alloc(64, 0x99) };
    const back = decodeHostRecord(encodeHostRecord(hr));
    assert.equal(back!.hostTs, hr.hostTs);
    assert.equal(back!.flags, 1);
    assert.ok(back!.envelope.equals(hr.envelope) && back!.hostSig.equals(hr.hostSig));
  });

  it('payload vazio e authorSeq no topo de uint53', () => {
    const op = { ...OP, payload: Buffer.alloc(0), authorSeq: Number.MAX_SAFE_INTEGER };
    const back = decodeOp(encodeOp(op));
    assert.equal(back!.authorSeq, Number.MAX_SAFE_INTEGER);
    assert.equal(back!.payload.length, 0);
  });

  it('flags: bit 0 é clockSkewed, bits desconhecidos são ignorados (§7.1)', () => {
    assert.equal(FLAG_CLOCK_SKEWED, 1);
    assert.equal(isClockSkewed(0b0000_0001), true);
    assert.equal(isClockSkewed(0b1111_1111), true);
    assert.equal(isClockSkewed(0b1111_1110), false);
    assert.equal(isClockSkewed(0), false);
  });
});

describe('forma canônica (§7.2)', () => {
  it('a mesma Op produz sempre os mesmos bytes', () => {
    const a = encodeOp(OP).toString('hex');
    for (let i = 0; i < 20; i++) assert.equal(encodeOp(OP).toString('hex'), a);
  });

  it('um bit de diferença muda os bytes e o opId', () => {
    const outra = { ...OP, authorSeq: 43 };
    assert.notEqual(encodeOp(outra).toString('hex'), encodeOp(OP).toString('hex'));
    assert.notEqual(
      opId(canonicalEnvelope({ ...ENV, op: encodeOp(outra) })),
      opId(canonicalEnvelope(ENV)),
    );
  });

  it('opcional ausente escreve só o byte de presença', () => {
    const comAusente = new Writer().opt(undefined, (w, v: string) => void w.str(v)).toBuffer();
    assert.deepEqual([...comAusente], [0]);
    const comPresente = new Writer().opt('a', (w, v: string) => void w.str(v)).toBuffer();
    assert.deepEqual([...comPresente], [1, 1, 0x61]);
  });
});

describe('§7.2 regra 2 — leitor tolerante', () => {
  it('bytes sobrando no FIM são ignorados', () => {
    const comLixo = Buffer.concat([encodeOp(OP), Buffer.from('lixo-que-veio-depois')]);
    const back = decodeOp(comLixo);
    assert.notEqual(back, null);
    assert.ok(back!.payload.equals(OP.payload));
  });

  it('mas prefixo mentiroso NO MEIO é malformado, não tolerado', () => {
    const b = encodeOp(OP);
    b[b.length - OP.payload.length - 1] = 0xfe; // prefixo de payload promete 4 GiB
    assert.equal(decodeOp(b), null);
  });
});

describe('§8.5 — totalidade: nada lança', () => {
  it('truncamento em toda posição devolve null, nunca exceção', () => {
    const cheio = encodeOp(OP);
    for (let n = 0; n < cheio.length; n++) {
      const corte = cheio.subarray(0, n);
      assert.doesNotThrow(() => decodeOp(corte), `corte em ${n}`);
      assert.equal(decodeOp(corte), null, `corte em ${n} deveria falhar`);
    }
  });

  it('todo bit invertido é decodificado ou recusado, nunca lança', () => {
    const cheio = encodeOp(OP);
    for (let i = 0; i < cheio.length; i++) {
      for (const bit of [0x01, 0x80]) {
        const b = Buffer.from(cheio);
        b.writeUInt8(b.readUInt8(i) ^ bit, i);
        assert.doesNotThrow(() => decodeOp(b), `byte ${i} bit ${bit}`);
      }
    }
  });

  it('entrada aleatória nunca lança nas três estruturas', () => {
    let seed = 0x2026_0816;
    const rnd = (): number => (seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff) % 256;
    for (let n = 0; n < 400; n++) {
      const b = Buffer.from(Array.from({ length: n % 200 }, rnd));
      assert.doesNotThrow(() => decodeOp(b), `op n=${n}`);
      assert.doesNotThrow(() => decodeEnvelope(b), `env n=${n}`);
      assert.doesNotThrow(() => decodeHostRecord(b), `hr n=${n}`);
    }
  });

  it('buffer vazio devolve null nas três', () => {
    const v = Buffer.alloc(0);
    assert.equal(decodeOp(v), null);
    assert.equal(decodeEnvelope(v), null);
    assert.equal(decodeHostRecord(v), null);
  });
});

describe('custo sob entrada hostil — §8.2 não tem teto antes do decode', () => {
  it('prefixo de 4 GiB não aloca: falha imediata', () => {
    const b = Buffer.from([0xfe, 0xff, 0xff, 0xff, 0xff]); // uint = 2^32-1
    const antes = process.memoryUsage().heapUsed;
    const r = new Reader(b);
    r.bytes();
    assert.equal(r.failed, true);
    assert.ok(process.memoryUsage().heapUsed - antes < 8 * 1024 * 1024, 'alocou muito');
  });

  it('arr com contagem hostil falha antes de alocar', () => {
    const r = new Reader(Buffer.from([0xfe, 0xff, 0xff, 0xff, 0xff]));
    const out = r.arr((rr) => rr.u8());
    assert.equal(r.failed, true);
    assert.deepEqual(out, []);
  });

  it('u64 acima de 2^53 é recusado', () => {
    const w = new Writer().u64(2n ** 63n);
    const r = new Reader(w.toBuffer());
    r.u64();
    assert.equal(r.failed, true);
  });
});

describe('primitivos de §7.2.1', () => {
  it('bool só aceita 0 e 1', () => {
    for (const v of [0, 1]) {
      const r = new Reader(Buffer.from([v]));
      assert.equal(r.bool(), v === 1);
      assert.equal(r.failed, false);
    }
    for (const v of [2, 255]) {
      const r = new Reader(Buffer.from([v]));
      r.bool();
      assert.equal(r.failed, true, `bool ${v}`);
    }
  });

  it('opt só aceita 0 e 1 no byte de presença', () => {
    const r = new Reader(Buffer.from([2, 0]));
    r.opt((rr) => rr.u8());
    assert.equal(r.failed, true);
  });

  it('str recusa UTF-8 inválido — o opId depende disso', () => {
    const b = Buffer.concat([Buffer.from([2]), Buffer.from([0xff, 0xfe])]);
    const r = new Reader(b);
    r.str();
    assert.equal(r.failed, true);
  });

  it('str sobrevive a multibyte e emoji', () => {
    for (const s of ['ação', '🌍 canal', '日本語', '']) {
      const r = new Reader(new Writer().str(s).toBuffer());
      assert.equal(r.str(), s);
      assert.equal(r.failed, false);
    }
  });

  it('uint cobre as quatro larguras de compact-encoding', () => {
    for (const n of [0, 0xfc, 0xfd, 0xffff, 0x1_0000, 0xffff_ffff, 0x1_0000_0000]) {
      const r = new Reader(new Writer().uint(n).toBuffer());
      assert.equal(r.uint(), n, `uint ${n}`);
    }
  });

  it('key e sig têm largura fixa', () => {
    assert.equal(new Writer().key(Buffer.alloc(32, 1)).toBuffer().length, 32);
    assert.equal(new Writer().sig(Buffer.alloc(64, 1)).toBuffer().length, 64);
    // Entrada curta é preenchida com zero, nunca estoura o layout.
    assert.equal(new Writer().key(Buffer.alloc(4, 1)).toBuffer().length, 32);
  });
});

describe('versão (§7.2 regras 3 e 4)', () => {
  it('só a versão conhecida é suportada', () => {
    assert.equal(isSupportedVersion(OP_VERSION), true);
    for (const v of [0, 2, 255]) assert.equal(isSupportedVersion(v), false, `v=${v}`);
  });

  it('op de versão desconhecida ainda decodifica — quem decide é o estágio 2 de §8.2', () => {
    const futura = decodeOp(encodeOp({ ...OP, v: 99 }));
    assert.notEqual(futura, null, 'decode não pode ser o ponto de recusa de versão');
    assert.equal(futura!.v, 99);
    assert.equal(isSupportedVersion(futura!.v), false);
  });
});
