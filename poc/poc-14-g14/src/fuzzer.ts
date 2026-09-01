// Critério 2 de §31.26 e teste 8 de §5 do plano: totalidade sob fuzzer, com o volume do
// gate (10⁷ no perfil `full`) e não o do ensaio de unidade (60 000 em
// `core/test/dm-fold-totality.test.ts`).
//
// O que é reaproveitado do ensaio é o **desenho**: doze sabotagens, uma por estágio de
// §31.7.3, e um PRNG determinístico — a semente é o que torna uma falha reproduzível. O
// código não é, e o `dmFold` medido é o do produto.

import {
  DM_MAX_ENVELOPE_BYTES_ATTACHMENT,
  DM_T0,
  DM_VERSION,
  dmFoldRecord,
  dmHello,
  dmKeypair,
  dmRecord,
  limparPanico,
  ultimoPanico,
  type DmDecision,
  type DmOrigin,
  type DmState,
  type DmWorld,
} from './core.js';

/**
 * PRNG determinístico (LCG de Numerical Recipes) — a semente reproduz a corrida inteira.
 *
 * **Devolve os bits ALTOS.** Os bits baixos de um LCG módulo 2³² têm período curto (o bit
 * *k* repete a cada 2^(k+1)), então `next() % 12` sobre o valor cru escolhe sempre as mesmas
 * poucas sabotagens e o corpus deixa de cobrir os doze estágios de §31.7.3. Isso é ruído do
 * harness, não propriedade do `dmFold`: o fuzzer precisa medir o produto, não o próprio
 * gerador.
 */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    // Os 21 bits altos, que é onde o período do LCG é longo.
    return s >>> 11;
  };
}

export const SABOTAGENS = [
  'bytes-aleatorios',
  'dm-version-desconhecida',
  'kind-fora-do-catalogo',
  'payload-truncado',
  'aead-nao-abre',
  'assinatura-corrompida',
  'assinada-por-terceiro',
  'outra-conversa',
  'autor-nao-e-dono-do-core',
  'referencia-quebrada',
  'campo-fora-do-limite',
  'genese-fora-da-forma',
] as const;

export type Sabotagem = (typeof SABOTAGENS)[number];

const DESFECHOS: ReadonlySet<string> = new Set<DmDecision>(['APPLIED', 'REJECTED', 'IGNORED']);

/** Um registro hostil e o nome da sabotagem que o produziu. */
export function hostil(w: DmWorld, next: () => number): { rec: Uint8Array; sabotagem: Sabotagem } {
  const escolha = next() % SABOTAGENS.length;
  const sabotagem = SABOTAGENS[escolha] as Sabotagem;
  const lado = next() % 2 === 0 ? w.lo : w.hi;
  const authorSeq = next() % 8;
  const ack = next() % 10_000;
  const ts = next() % 2 === 0 ? 0 : DM_T0 + (next() % 1_000_000) - 500_000;
  const base = { authorSeq, ack, ts };

  switch (sabotagem) {
    case 'bytes-aleatorios': {
      const n = next() % 400;
      const b = Buffer.alloc(n);
      for (let i = 0; i < n; i++) b[i] = next() & 0xff;
      return { rec: b, sabotagem };
    }
    case 'dm-version-desconhecida':
      return {
        rec: dmRecord(w, lado, { kind: 'dm.message', ...base, v: (next() % 255) + DM_VERSION + 1, payload: { content: 'x' } }),
        sabotagem,
      };
    case 'kind-fora-do-catalogo':
      return {
        rec: dmRecord(w, lado, { kind: 'dm.message', ...base, kindNumber: 7 + (next() % 60_000), payload: { content: 'x' } }),
        sabotagem,
      };
    case 'payload-truncado': {
      // Ao menos um byte a menos: truncar em zero devolveria o registro **íntegro**, e um
      // registro íntegro não é sabotagem — foi assim que dois `APPLIED` apareceram numa
      // corrida de 10⁷ antes desta linha existir.
      const rec = dmRecord(w, lado, { kind: 'dm.message', ...base, payload: { content: 'x'.repeat(50) } });
      return { rec: rec.subarray(0, Math.max(1, rec.length - 1 - (next() % 40))), sabotagem };
    }
    case 'aead-nao-abre':
      return {
        rec: dmRecord(w, lado, { kind: 'dm.message', ...base, contentKey: Buffer.alloc(32, next() & 0xff), payload: { content: 'x' } }),
        sabotagem,
      };
    case 'assinatura-corrompida':
      return { rec: dmRecord(w, lado, { kind: 'dm.message', ...base, corruptSig: true, payload: { content: 'x' } }), sabotagem };
    case 'assinada-por-terceiro':
      return {
        rec: dmRecord(w, lado, { kind: 'dm.message', ...base, signWith: dmKeypair(`intruso-${next() % 7}`).secretKey, payload: { content: 'x' } }),
        sabotagem,
      };
    case 'outra-conversa':
      return {
        rec: dmRecord(w, lado, { kind: 'dm.message', ...base, conversationKey: Buffer.alloc(32, next() & 0xff), payload: { content: 'x' } }),
        sabotagem,
      };
    case 'autor-nao-e-dono-do-core':
      return {
        rec: dmRecord(w, lado, { kind: 'dm.message', ...base, author: dmKeypair(`estranho-${next() % 7}`).publicKey, payload: { content: 'x' } }),
        sabotagem,
      };
    case 'referencia-quebrada':
      return {
        rec: dmRecord(w, lado, {
          kind: next() % 2 === 0 ? 'dm.edit' : 'dm.delete',
          ...base,
          payload: { messageId: `dmsg-${'Z'.repeat(next() % 40)}`, content: 'x' },
        }),
        sabotagem,
      };
    case 'campo-fora-do-limite':
      // §31.7.5 — `content` é 1..4000 code points. O excesso é garantido, não sorteado: um
      // comprimento que caísse dentro do limite produziria um registro **válido**, e um
      // registro válido não é sabotagem nenhuma.
      return {
        rec: dmRecord(w, lado, { kind: 'dm.message', ...base, payload: { content: 'x'.repeat(4001 + (next() % 5000)) } }),
        sabotagem,
      };
    default:
      // RD-1/RD-2 — a gênese é `dm.hello` no índice 0 com `authorSeq = 1` e `ack = 0`. O
      // desvio é forçado pela mesma razão: sorteado, ele às vezes acertaria a forma.
      return { rec: dmHello(w, lado, { ...base, authorSeq: authorSeq === 1 ? 2 : authorSeq, ack: ack === 0 ? 1 : ack }), sabotagem };
  }
}

export type ResultadoFuzzer = {
  readonly registros: number;
  readonly lotes: number;
  readonly registrosPorLote: number;
  readonly semente: number;
  readonly panic: number;
  readonly ultimoPanico: { ordSum: number; err: string } | null;
  readonly desfechoFora: number;
  readonly applied: number;
  readonly rejected: number;
  readonly ignored: number;
  /** POC-14 pede o desfecho **de cada registro hostil**: aqui, por sabotagem. */
  readonly porSabotagem: Record<string, { applied: number; rejected: number; ignored: number; motivos: Record<string, number> }>;
  readonly semCodigo: number;
  readonly ordSumSempreInteiro: boolean;
  readonly efeitoEmRecusa: number;
  readonly ms: number;
  readonly registrosPorSegundo: number;
};

/**
 * Roda `n` registros hostis contra o `dmFold` do produto, em **lotes** que recomeçam de uma
 * conversa recém-aberta.
 *
 * O lote não é conveniência: a janela de `ts` de §31.7.2 é podada pelo `ack` do outro lado, e
 * um corpus em que os dois lados só escrevem lixo nunca produz um `ack` que ande — a janela
 * cresce com o lote e o custo por registro cresce com ela (ACHADO-G14-04, medido à parte em
 * `custo.ts`). Sem o lote, o fuzzer mediria essa curva em vez da totalidade. Cada lote é uma
 * conversa nova; a totalidade é propriedade **por registro**, e é ela que está sob teste.
 */
export function rodarFuzzer(
  w: DmWorld,
  abertura: () => DmState,
  n: number,
  semente: number,
  registrosPorLote = 5_000,
): ResultadoFuzzer {
  limparPanico();
  const metrics = { panic: 0, tsClamped: 0, ackAhead: 0, clockSkewed: 0, idCollision: 0, applied: 0, rejected: 0, ignored: 0, rejectedBy: new Map<string, number>(), ignoredBy: new Map<string, number>() };
  const next = rng(semente);
  const porSabotagem: ResultadoFuzzer['porSabotagem'] = {};
  for (const sab of SABOTAGENS) porSabotagem[sab] = { applied: 0, rejected: 0, ignored: 0, motivos: {} };

  let desfechoFora = 0;
  let efeitoEmRecusa = 0;
  let semCodigo = 0;
  let ordSumSempreInteiro = true;
  let lotes = 0;
  const t0 = process.hrtime.bigint();

  let feitos = 0;
  while (feitos < n) {
    const doLote = Math.min(registrosPorLote, n - feitos);
    lotes++;
    let s = abertura();
    for (let i = 0; i < doLote; i++) {
      const { rec, sabotagem } = hostil(w, next);
      const origin: DmOrigin = next() % 2 === 0 ? 'lo' : 'hi';
      const index = next() % 5;
      const r = dmFoldRecord(s, rec, origin, index, w.ctx, metrics);
      if (!DESFECHOS.has(r.decision)) desfechoFora++;
      if (r.decision !== 'APPLIED' && r.effects.length > 0) efeitoEmRecusa++;
      if (!Number.isInteger(r.ordSum)) ordSumSempreInteiro = false;
      const linha = porSabotagem[sabotagem];
      if (linha !== undefined) {
        if (r.decision === 'APPLIED') linha.applied++;
        else if (r.decision === 'REJECTED') linha.rejected++;
        else linha.ignored++;
        if (r.decision !== 'APPLIED') {
          const k = r.reason ?? 'sem-codigo';
          if (r.reason === undefined) semCodigo++;
          linha.motivos[k] = (linha.motivos[k] ?? 0) + 1;
        }
      }
      s = r.next;
    }
    feitos += doLote;
  }

  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return {
    registros: n,
    lotes,
    registrosPorLote,
    semente,
    panic: metrics.panic,
    ultimoPanico: ultimoPanico(),
    desfechoFora,
    applied: metrics.applied,
    rejected: metrics.rejected,
    ignored: metrics.ignored,
    porSabotagem,
    semCodigo,
    ordSumSempreInteiro,
    efeitoEmRecusa,
    ms: Math.round(ms),
    registrosPorSegundo: Math.round(n / (ms / 1000)),
  };
}

/** Os tamanhos de borda: 0 bytes, 1 byte, o teto exato e um byte acima dele. */
export function tamanhosDeBorda(): number[] {
  return [0, 1, DM_MAX_ENVELOPE_BYTES_ATTACHMENT, DM_MAX_ENVELOPE_BYTES_ATTACHMENT + 1];
}
