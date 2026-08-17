// Vazão e latência do caminho de escrita — os 100 000 envelopes de POC-07.
//
// Mede o que o plano pede: p95 de `submitOp`, tamanho de grupo do commit (§11.5), tamanho de
// WAL, e o oráculo de sempre (nada perdido, nada duplicado). O alvo de p95 é de §26.1 e é
// `BENCHMARK REQUIRED` — se não fechar, §11.5 é explícito: **renegocia-se o alvo, nunca a
// barreira**. Por isso o número entra no artefato como medida, e o critério de aprovação do
// gate não reprova por latência: ele reprova por perda.
//
// A latência aqui é **por envelope dentro do lote**: o cliente manda `submitOps` de até 32 e
// espera a resposta do lote inteiro (§11.9), então o tempo de um envelope é o do lote dividido
// pelo tamanho dele. Medir o lote inteiro como se fosse uma op só inflaria o p95 por um
// fator 32 e não descreveria nada que o usuário sinta.
//
// ─── Um canal, e por quê ────────────────────────────────────────────────────────────────
//
// Esta medição usa **um** canal. Não é simplificação de conveniência: com mais de um, o
// caminho de escrita como especificado **perde a maioria das mensagens**, e o motivo está em
// `run-scenarios.ts` (cenário `authorSeq ultrapassado`). §7.5 numera por **autor** e §11.7
// ordena por **canal**; enviado canal a canal, o primeiro lote leva a marca d'água do autor
// adiante e todo `authorSeq` menor dos outros canais é recusado para sempre no estágio 6.
//
// Medido aqui, com 8 canais: do primeiro giro de 256 envelopes, **45** entraram no log e 211
// foram recusados como duplicata — sem nunca terem sido aceitos. Por isso a vazão mede o caso
// que a especificação vigente sustenta, e o caso que ela não sustenta virou achado.
// A fila também respeita `OUTBOX_MAX_ITEMS` (500, §11.7): o volume total entra em **ondas**,
// que é como um cliente real acumula e drena.

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { Manifest } from '../src/client/manifest.ts';
import { Outbox } from '../src/client/outbox.ts';
import { Replica } from '../src/client/replica.ts';
import { Rpc } from '../src/client/rpc.ts';
import { readLog, walSizes } from '../src/harness/inspect.ts';
import { startHost, type HostHandle } from '../src/harness/spawn.ts';
import { encodeEnvelope } from '../src/protocol/envelope.ts';

export type ThroughputReport = {
  readonly envelopes: number;
  readonly noLog: number;
  readonly duplicadas: number;
  readonly perdidas: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly opsPorSegundo: number;
  readonly grupos: number;
  readonly maiorGrupo: number;
  readonly grupoMedio: number;
  readonly walBytes: { manifest: number; view: number };
  readonly enqueueMsPorOp: number;
  readonly ms: number;
  readonly ok: boolean;
};

const AUTOR = Buffer.alloc(32, 0x11);
const COMUNIDADE = Buffer.alloc(32, 0x22);
const CID = COMUNIDADE.toString('hex');

function percentil(v: number[], p: number): number {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number;
}

export async function runThroughput(opts: {
  root: string;
  work: string;
  envelopes: number;
  log?: (m: string) => void;
}): Promise<ThroughputReport> {
  const t0 = Date.now();
  const d = join(opts.work, 'vazao');
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  const hostDir = join(d, 'host');
  const cliDir = join(d, 'cli');
  mkdirSync(cliDir, { recursive: true });

  const host = (await startHost({ root: opts.root, dir: hostDir })) as HostHandle;
  const manifest = new Manifest(join(cliDir, 'manifest.db'));
  const rpc = new Rpc({ port: host.port, timeoutMs: 30_000 });
  const replica = new Replica(join(cliDir, 'view.db'), rpc.logSource(), manifest, CID);
  replica.load();

  const latencias: number[] = [];
  const outbox = new Outbox({
    manifest,
    replica,
    communityId: CID,
    submit: async (envs) => {
      const t = Date.now();
      const r = await rpc.submitBatch(envs);
      // Por envelope, não por lote — ver o cabeçalho.
      const porOp = (Date.now() - t) / Math.max(envs.length, 1);
      for (let i = 0; i < envs.length; i++) latencias.push(porOp);
      return r;
    },
  });

  // O enfileiramento é `synchronous=FULL`: um fsync por op, e é **essa** a garantia forte do
  // sistema (§10.7.1). O custo dela é medido à parte, porque é o preço declarado de A06.
  let enqueueMs = 0;
  let restantesNaOnda = 0;
  const ONDA = 400; // abaixo de OUTBOX_MAX_ITEMS (500, §11.7)
  let enviadosTotal = 0;

  for (let feitos = 0; feitos < opts.envelopes; ) {
    const nesta = Math.min(ONDA, opts.envelopes - feitos);
    const tEnq = Date.now();
    for (let i = 0; i < nesta; i++) {
      const authorSeq = manifest.nextAuthorSeq(CID);
      const env = encodeEnvelope({
        author: AUTOR,
        authorSeq,
        communityId: COMUNIDADE,
        kind: 1,
        payload: Buffer.from(`msg-${authorSeq}`, 'utf8'),
      });
      const r = outbox.enqueue(env, { channelId: 'c0', kind: 1, authorSeq });
      if (!r.ok) break;
    }
    enqueueMs += Date.now() - tEnq;
    feitos += nesta;

    // Drena a onda: flush → projeta → reconcilia.
    for (let voltas = 0; voltas < 5_000; voltas++) {
      const enviados = await outbox.flush();
      enviadosTotal += enviados;
      await replica.catchUp();
      outbox.reconcile();
      restantesNaOnda = manifest.all(CID).filter((x) => x.state !== 'dropped').length;
      if (restantesNaOnda === 0) break;
      if (enviados === 0) await new Promise((r) => setTimeout(r, 25));
    }
    if (feitos % 10_000 < ONDA) {
      opts.log?.(`        ${feitos}/${opts.envelopes} enfileirados · log~${replica.state.interpretedSeq + 1}`);
    }
  }
  void enviadosTotal;

  const status = await rpc.status();
  const wal = walSizes(cliDir);
  const duplicadas = replica.duplicateLogical().length;
  const restantes = manifest.all(CID).filter((x) => x.state !== 'dropped').length;
  rpc.close();
  replica.close();
  manifest.close();
  await host.shutdown();

  const log = await readLog(hostDir);
  const enfileirados = outbox.metrics.enfileirados;
  const ms = Date.now() - t0;
  rmSync(d, { recursive: true, force: true });

  const grupos = status?.metrics.grupos ?? 0;
  const agrupados = status?.metrics.registrosAgrupados ?? 0;
  return {
    envelopes: enfileirados,
    noLog: log.length,
    duplicadas,
    perdidas: enfileirados - log.length - restantes,
    p50Ms: percentil(latencias, 50),
    p95Ms: percentil(latencias, 95),
    p99Ms: percentil(latencias, 99),
    opsPorSegundo: Math.round((log.length / Math.max(ms, 1)) * 1000),
    grupos,
    maiorGrupo: status?.metrics.maiorGrupo ?? 0,
    grupoMedio: grupos > 0 ? +(agrupados / grupos).toFixed(1) : 0,
    walBytes: wal,
    enqueueMsPorOp: +(enqueueMs / Math.max(enfileirados, 1)).toFixed(3),
    ms,
    ok: log.length === enfileirados && duplicadas === 0 && restantes === 0,
  };
}
