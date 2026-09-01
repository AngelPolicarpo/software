// Os cenários que precisam de Hypercore e de rede: (3) partição e reconciliação, e (4) o
// core encurtado — que é a **pergunta aberta** que §31.13 marca `REQUIRES POC`.
//
// Ambiente de POC-14: `hyperdht/testnet`, **nunca** a DHT pública. A testnet sobe um
// bootstrap local; nada sai da máquina.

import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import Hypercore from 'hypercore';
import DHT from 'hyperdht';
import createTestnet from 'hyperdht/testnet.js';

import { dmHello, dmKeypair, dmRecord, type DmSide, type DmWorld } from './core.js';
import { hashDump } from './dump.js';
import { abrirManifesto, classificar } from './manifesto.js';
import { No } from './projetor.js';

const ESPERA_MS = 20_000;

const requerer = createRequire(import.meta.url);

/** A versão exata do pacote medido — o achado do critério 4 vale para ela, não em geral. */
export function versaoDe(pacote: string): string {
  try {
    const pkg = requerer.resolve(`${pacote}/package.json`);
    return String((JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }).version);
  } catch {
    return 'desconhecida';
  }
}

async function comLimite<T>(p: Promise<T>, ms: number, oque: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rj) => {
        t = setTimeout(() => rj(new Error(`timeout ${ms} ms: ${oque}`)), ms);
      }),
    ]);
  } finally {
    if (t !== undefined) clearTimeout(t);
  }
}

async function baixar(core: Hypercore, fim: number): Promise<void> {
  if (fim <= 0) return;
  await comLimite(core.download({ start: 0, end: fim }).done(), ESPERA_MS, `download 0..${fim}`);
}

async function lerTudo(core: Hypercore, ate: number): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (let i = 0; i < ate; i++) {
    const b = await core.get(i, { wait: false });
    if (b !== null) out.push(b);
  }
  return out;
}

// ─── Cenário 3 — partição e reconciliação ───────────────────────────────────────────────

export type Cenario3 = {
  readonly escritosNaParticao: { lo: number; hi: number };
  readonly comprimentos: { loNoNoA: number; hiNoNoA: number; loNoNoB: number; hiNoNoB: number };
  readonly hashNoA: string;
  readonly hashNoB: string;
  readonly hashReferencia: string;
  readonly convergiu: boolean;
  readonly hashDivergenteDuranteParticao: boolean;
  readonly intervencao: 'nenhuma';
  readonly forks: number;
  readonly ok: boolean;
  readonly erro?: string;
};

/**
 * Dois nós reais numa `hyperdht/testnet`: cada um dono do próprio core de DM e leitor do
 * core do par, os dois cores no mesmo socket. Escreve dos dois lados **durante** a partição
 * e reconcilia sem intervenção; o oráculo é o hash de dump dos dois nós.
 */
export async function cenario3(w: DmWorld, dir: string, porLado: number): Promise<Cenario3> {
  mkdirSync(dir, { recursive: true });
  const testnet = await createTestnet(3);
  const dhtA = new DHT({ bootstrap: testnet.bootstrap });
  const dhtB = new DHT({ bootstrap: testnet.bootstrap });
  let forks = 0;

  const abrir = async (nome: string, opts: { keyPair?: { publicKey: Buffer; secretKey: Buffer }; key?: Buffer; compat: boolean }): Promise<Hypercore> => {
    const c = new Hypercore(join(dir, nome), opts);
    await c.ready();
    c.on('conflict', () => {
      forks++;
    });
    return c;
  };

  const aOwn = await abrir('a-own', { keyPair: w.lo.core, compat: true });
  const bOwn = await abrir('b-own', { keyPair: w.hi.core, compat: true });
  const chaveA = aOwn.key;
  const chaveB = bOwn.key;
  if (chaveA === null || chaveB === null) throw new Error('core sem chave');
  const aPeer = await abrir('a-peer', { key: chaveB, compat: true });
  const bPeer = await abrir('b-peer', { key: chaveA, compat: true });

  const parDht = dmKeypair('g14-dht-noA');
  const servidor = dhtA.createServer((sock) => {
    aOwn.replicate(sock);
    aPeer.replicate(sock);
  });
  await servidor.listen(parDht);

  const conectar = async (): Promise<{ destroy(): void }> => {
    const sock = dhtB.connect(parDht.publicKey);
    bOwn.replicate(sock);
    bPeer.replicate(sock);
    await comLimite(new Promise<void>((r) => sock.once('open', () => r())), ESPERA_MS, 'socket open');
    return sock;
  };

  const escrever = async (core: Hypercore, side: DmSide, ack: number, texto: string): Promise<void> => {
    const rec =
      core.length === 0
        ? dmHello(w, side)
        : dmRecord(w, side, { kind: 'dm.message', authorSeq: core.length + 1, ack, payload: { content: texto } } as never);
    await core.append(rec);
  };

  let erro: string | undefined;
  let hashNoA = '';
  let hashNoB = '';
  let hashReferencia = '';
  let hashDivergenteDuranteParticao = false;
  const comprimentos = { loNoNoA: 0, hiNoNoA: 0, loNoNoB: 0, hiNoNoB: 0 };

  try {
    let sock = await conectar();

    // Antes da partição: a gênese de cada lado e uma troca.
    await escrever(aOwn, w.lo, 0, '');
    await escrever(bOwn, w.hi, 0, '');
    await escrever(aOwn, w.lo, 1, 'antes da partição, de lo');
    await baixar(bPeer, aOwn.length);
    await escrever(bOwn, w.hi, bPeer.length, 'antes da partição, de hi');
    await baixar(aPeer, bOwn.length);

    // ─── PARTIÇÃO ───
    sock.destroy();
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 0; i < porLado; i++) {
      await escrever(aOwn, w.lo, aPeer.length, `lo durante a partição ${i}`);
      await escrever(bOwn, w.hi, bPeer.length, `hi durante a partição ${i}`);
    }

    const dumpDe = async (loLen: number, hiLen: number, loCore: Hypercore, hiCore: Hypercore): Promise<string> => {
      const no = new No({ ctx: w.ctx });
      no.entregar({ lo: await lerTudo(loCore, loLen), hi: await lerTudo(hiCore, hiLen) });
      return hashDump(no.state, no.tabelas);
    };

    const parcialA = await dumpDe(aOwn.length, aPeer.length, aOwn, aPeer);
    const parcialB = await dumpDe(bPeer.length, bOwn.length, bPeer, bOwn);
    hashDivergenteDuranteParticao = parcialA !== parcialB;

    // ─── RECONCILIAÇÃO, sem intervenção ───
    sock = await conectar();
    await baixar(bPeer, aOwn.length);
    await baixar(aPeer, bOwn.length);

    comprimentos.loNoNoA = aOwn.length;
    comprimentos.hiNoNoA = aPeer.length;
    comprimentos.loNoNoB = bPeer.length;
    comprimentos.hiNoNoB = bOwn.length;

    hashNoA = await dumpDe(aOwn.length, aPeer.length, aOwn, aPeer);
    hashNoB = await dumpDe(bPeer.length, bOwn.length, bPeer, bOwn);

    // A referência: um terceiro leitor que só vê os dois logs prontos.
    const referencia = new No({ ctx: w.ctx });
    referencia.entregar({ lo: await lerTudo(aOwn, aOwn.length), hi: await lerTudo(bOwn, bOwn.length) });
    hashReferencia = hashDump(referencia.state, referencia.tabelas);

    sock.destroy();
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  } finally {
    await Promise.all([aOwn.close(), bOwn.close(), aPeer.close(), bPeer.close()]);
    await servidor.close();
    await dhtA.destroy();
    await dhtB.destroy();
    await testnet.destroy();
    rmSync(dir, { recursive: true, force: true });
  }

  const convergiu = erro === undefined && hashNoA === hashNoB && hashNoA === hashReferencia && hashNoA !== '';
  const r: Cenario3 = {
    escritosNaParticao: { lo: porLado, hi: porLado },
    comprimentos,
    hashNoA,
    hashNoB,
    hashReferencia,
    convergiu,
    hashDivergenteDuranteParticao,
    intervencao: 'nenhuma',
    forks,
    ok: convergiu && forks === 0,
  };
  return erro === undefined ? r : { ...r, erro };
}

// ─── Cenário 4 — core encurtado, e a pergunta aberta de §31.13 ──────────────────────────

export type Cenario4 = {
  /** A detecção: `core.length < self_high_water` **antes** de qualquer append. */
  readonly deteccao: {
    readonly selfHighWater: number;
    readonly coreLengthAoReabrir: number;
    readonly estado: 'normal' | 'desynced';
    readonly appendsFeitosEmDesynced: number;
    readonly ok: boolean;
  };
  /** A afirmação `REQUIRES POC` de §31.13: recompor o próprio core a partir de um par. */
  readonly recomposicao: {
    readonly hypercore: string;
    readonly recompos: boolean;
    readonly lengthAntes: number;
    readonly lengthDepois: number;
    readonly blocosConferem: boolean;
    readonly appendDepoisFunciona: boolean;
    readonly parLeuOBlocoNovo: boolean;
    readonly forks: number;
    readonly ms: number;
    readonly erro?: string;
  };
  /** O contrafactual: appendar **antes** de recompor é o fork que a barreira existe para impedir. */
  readonly appendPrematuro: {
    readonly conflitoDetectado: boolean;
    readonly ondeConflitou: readonly string[];
    readonly parPreservouOBlocoOriginal: boolean;
  };
  readonly ok: boolean;
  readonly erro?: string;
};

/**
 * O escritor perde parte do próprio core (o `dmCoreSeed` é derivado, então a chave volta a
 * mesma) e reabre mais curto do que já esteve. Mede três coisas, nesta ordem:
 *
 *  (a) a detecção de §31.13 acontece **antes** do append;
 *  (b) se o `hypercore@11.x` deixa o escritor recompor o próprio core a partir do par sem
 *      appendar — a pergunta que decide se `desynced` é terminal e se **L-25** ganha uma
 *      segunda metade;
 *  (c) o que acontece quando se appenda **antes** de recompor, que é o desfecho que a regra
 *      existe para impedir.
 *
 * A perda é reconstruída num storage novo com a mesma `keyPair` e o mesmo prefixo de blocos.
 * Ed25519 é determinístico e o Merkle é função dos blocos, então o prefixo é byte a byte o
 * que o par já tem — é a forma honesta de produzir `core.length < self_high_water` sem
 * copiar um storage do RocksDB, que o próprio `device-file` recusa.
 */
export async function cenario4(w: DmWorld, dir: string, total: number, perdidos: number): Promise<Cenario4> {
  mkdirSync(dir, { recursive: true });
  const manifesto = abrirManifesto(join(dir, 'manifest.db'));
  const side = w.lo;
  const bloco = (i: number): Buffer =>
    i === 0
      ? dmHello(w, side)
      : dmRecord(w, side, { kind: 'dm.message', authorSeq: i + 1, ack: 0, payload: { content: `bloco-${i}` } } as never);

  let erro: string | undefined;
  const conflitos: string[] = [];
  let forksRecomposicao = 0;

  const versaoHypercore = versaoDe('hypercore');

  const cores: Hypercore[] = [];
  const fechar = async (): Promise<void> => {
    for (const c of cores) {
      try {
        await c.close();
      } catch {
        /* já fechado por conflito */
      }
    }
  };

  let deteccao: Cenario4['deteccao'] = {
    selfHighWater: 0,
    coreLengthAoReabrir: 0,
    estado: 'normal',
    appendsFeitosEmDesynced: 0,
    ok: false,
  };
  let recomposicao: Cenario4['recomposicao'] = {
    hypercore: versaoHypercore,
    recompos: false,
    lengthAntes: 0,
    lengthDepois: 0,
    blocosConferem: false,
    appendDepoisFunciona: false,
    parLeuOBlocoNovo: false,
    forks: 0,
    ms: 0,
  };
  let appendPrematuro: Cenario4['appendPrematuro'] = {
    conflitoDetectado: false,
    ondeConflitou: [],
    parPreservouOBlocoOriginal: false,
  };

  try {
    // 1. O escritor escreve `total` blocos, gravando `self_high_water` ANTES de cada append.
    const inteiro = new Hypercore(join(dir, 'w0'), { keyPair: side.core, compat: true });
    cores.push(inteiro);
    await inteiro.ready();
    for (let i = 0; i < total; i++) {
      manifesto.gravar(w.conversationId, inteiro.length + 1);
      await inteiro.append(bloco(i));
    }
    const chave = inteiro.key;
    if (chave === null) throw new Error('core sem chave');

    // 2. O par replica tudo.
    const par = new Hypercore(join(dir, 'peer'), chave, { compat: true });
    cores.push(par);
    await par.ready();
    let s1 = inteiro.replicate(true) as { pipe(x: unknown): { pipe(y: unknown): void }; destroy(): void };
    let s2 = par.replicate(false) as { pipe(x: unknown): { pipe(y: unknown): void }; destroy(): void };
    s1.pipe(s2).pipe(s1);
    await baixar(par, total);
    s1.destroy();
    s2.destroy();
    await inteiro.close();

    // 3. Perda local: storage novo, mesma keyPair, só o prefixo.
    const curto = new Hypercore(join(dir, 'w1'), { keyPair: side.core, compat: true });
    cores.push(curto);
    await curto.ready();
    curto.on('conflict', () => {
      forksRecomposicao++;
      conflitos.push('escritor-recompondo');
    });
    for (let i = 0; i < perdidos; i++) await curto.append(bloco(i));

    // (a) A detecção, antes de qualquer append.
    const hw = manifesto.ler(w.conversationId);
    const estado = classificar(curto.length, hw);
    deteccao = {
      selfHighWater: hw,
      coreLengthAoReabrir: curto.length,
      estado,
      appendsFeitosEmDesynced: 0,
      ok: estado === 'desynced' && curto.length < hw,
    };

    // (b) A pergunta aberta: recompor sem appendar.
    const t0 = process.hrtime.bigint();
    const antes = curto.length;
    s1 = curto.replicate(true) as never;
    s2 = par.replicate(false) as never;
    s1.pipe(s2).pipe(s1);
    let recompos = false;
    let erroRec: string | undefined;
    try {
      await baixar(curto, total);
      recompos = curto.length === total && (await curto.has(0, total));
    } catch (e) {
      erroRec = e instanceof Error ? e.message : String(e);
    }
    let blocosConferem = recompos;
    if (recompos) {
      for (let i = 0; i < total; i++) {
        const lido = await curto.get(i, { wait: false });
        if (lido === null || !lido.equals(bloco(i))) blocosConferem = false;
      }
    }
    let appendDepoisFunciona = false;
    let parLeuOBlocoNovo = false;
    if (recompos) {
      manifesto.gravar(w.conversationId, curto.length + 1);
      const extra = dmRecord(w, side, { kind: 'dm.message', authorSeq: curto.length + 1, ack: 0, payload: { content: 'depois da recomposição' } } as never);
      await curto.append(extra);
      appendDepoisFunciona = curto.length === total + 1;
      const noPar = await comLimite(par.get(total, { wait: true }), ESPERA_MS, 'par lê o bloco novo').catch(() => null);
      parLeuOBlocoNovo = noPar !== null && noPar.equals(extra);
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    s1.destroy();
    s2.destroy();
    recomposicao = {
      hypercore: versaoHypercore,
      recompos,
      lengthAntes: antes,
      lengthDepois: curto.length,
      blocosConferem,
      appendDepoisFunciona,
      parLeuOBlocoNovo,
      forks: forksRecomposicao,
      ms: Math.round(ms * 1000) / 1000,
      ...(erroRec === undefined ? {} : { erro: erroRec }),
    };
    await curto.close();

    // (c) O contrafactual: appendar ANTES de recompor.
    const mau = new Hypercore(join(dir, 'w2'), { keyPair: side.core, compat: true });
    cores.push(mau);
    await mau.ready();
    mau.on('conflict', () => conflitos.push('escritor-divergente'));
    par.on('conflict', () => conflitos.push('par'));
    for (let i = 0; i < perdidos; i++) await mau.append(bloco(i));
    const conflitante = dmRecord(w, side, { kind: 'dm.message', authorSeq: perdidos + 1, ack: 0, payload: { content: 'BLOCO CONFLITANTE' } } as never);
    await mau.append(conflitante);
    const antesDoConflito = conflitos.length;
    const t1 = mau.replicate(true) as { pipe(x: unknown): { pipe(y: unknown): void }; destroy(): void };
    const t2 = par.replicate(false) as { pipe(x: unknown): { pipe(y: unknown): void }; destroy(): void };
    t1.pipe(t2).pipe(t1);
    await new Promise((r) => setTimeout(r, 1500));
    const original = await par.get(perdidos, { wait: false }).catch(() => null);
    appendPrematuro = {
      conflitoDetectado: conflitos.length > antesDoConflito,
      ondeConflitou: [...new Set(conflitos.slice(antesDoConflito))],
      parPreservouOBlocoOriginal: original !== null && original.equals(bloco(perdidos)),
    };
    t1.destroy();
    t2.destroy();
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  } finally {
    await fechar();
    manifesto.fechar();
    rmSync(dir, { recursive: true, force: true });
  }

  const ok =
    erro === undefined &&
    deteccao.ok &&
    deteccao.appendsFeitosEmDesynced === 0 &&
    appendPrematuro.conflitoDetectado;
  const r: Cenario4 = { deteccao, recomposicao, appendPrematuro, ok };
  return erro === undefined ? r : { ...r, erro };
}
