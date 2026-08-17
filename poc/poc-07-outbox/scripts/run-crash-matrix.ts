// A matriz de crash de §28.3, aplicada ao caminho de escrita de §11.
//
//   "Matriz de crash obrigatória: SIGKILL antes do append, depois do append e antes do flush,
//    depois do flush e antes do ACK, depois do ACK, entre o commit de view.db e o de
//    manifest.db, durante a reprojeção, durante o wipe em cada estágio, durante o staging de
//    blob. Oráculo: nenhuma operação confirmada é perdida; nenhuma é duplicada; o boot sempre
//    converge."
//
// O `wipe` e o staging de blob são de G10 e da fase 6 — fora deste POC. O ponto "depois do
// append e antes do flush" **não existe** desde §10.7.1: append e commit são o mesmo instante,
// e o ponto correspondente aqui é `host:after-append-before-ack`.
//
// Cada cenário tem três atos, e a separação é o que torna o oráculo exato:
//
//   1. enfileira e sai **limpo** — agora sabemos, do disco, exatamente quais `opId` existem;
//   2. envia, com o processo morrendo no ponto nomeado;
//   3. reabre tudo e reconcilia — e então se pergunta ao disco o que sobrou.
//
// Sem o ato 1 separado, um crash durante o enfileiramento deixaria ambíguo *quais* ops
// deveriam existir, e o oráculo mediria a própria ambiguidade.

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { KILL_POINTS, type KillPoint } from '../src/harness/kill.ts';
import { oracle, readConsumedAuthorSeq, readLog, readOutbox, walSizes } from '../src/harness/inspect.ts';
import { runClient, startHost, type HostHandle } from '../src/harness/spawn.ts';

export type CrashCase = {
  readonly ponto: KillPoint | 'sem-kill';
  readonly ops: number;
  readonly morreu: boolean;
  readonly perdidas: number;
  readonly duplicadas: number;
  readonly queimadas: number;
  readonly noLog: number;
  readonly naOutbox: number;
  readonly convergiu: boolean;
  readonly walBytes: { manifest: number; view: number };
  readonly recuperacaoMs: number;
  readonly ok: boolean;
  readonly detalhe: string;
};

export type CrashReport = {
  readonly ok: boolean;
  readonly casos: CrashCase[];
  readonly ms: number;
};

const COMMUNITY = '22'.repeat(32);

async function umCaso(opts: {
  root: string;
  work: string;
  ponto: KillPoint | 'sem-kill';
  ops: number;
  repeticao: number;
}): Promise<CrashCase> {
  const base = join(opts.work, `${opts.ponto.replace(/[:@]/g, '_')}-${opts.repeticao}`);
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const hostDir = join(base, 'host');
  const cliDir = join(base, 'cli');
  const doHost = opts.ponto.startsWith('host:');
  const doCliente = opts.ponto.startsWith('client:');
  // Mata no meio do fluxo, não na primeira op — mas a **unidade** de contagem difere entre os
  // dois lados, e confundi-las trava o gate.
  //
  // Nos pontos do host, `@n` conta **grupos de commit**, não registros: um lote de 32 vira um
  // append só (§11.5). Contar como se fosse por registro arma a morte num grupo que nunca
  // acontece, e a espera pelo host morto nunca resolve. Foi o que travou a primeira corrida
  // deste gate — e só apareceu **depois** de o group commit passar a agrupar de verdade.
  // Nos pontos do cliente, `@n` conta itens, e o meio do fluxo é uma fração deles.
  const nth = doHost ? 2 : Math.max(2, Math.floor(opts.ops / 8));
  const killArg = opts.ponto === 'sem-kill' ? '' : `${opts.ponto}@${nth}`;

  // ── ato 1: enfileira e sai limpo ───────────────────────────────────────────────────
  let host: HostHandle | null = await startHost({ root: opts.root, dir: hostDir });
  if (host === null) {
    return caso(opts.ponto, opts.ops, false, 'host não subiu no ato 1', false);
  }
  await runClient({
    root: opts.root,
    dir: cliDir,
    port: host.port,
    n: opts.ops,
    phases: 'enqueue',
    community: COMMUNITY,
  });
  const esperados = readOutbox(cliDir).map((o) => o.opId);

  // ── ato 2: envia, morrendo no ponto ────────────────────────────────────────────────
  if (doHost) {
    await host.shutdown();
    host = await startHost({ root: opts.root, dir: hostDir, killAt: killArg });
    if (host === null) return caso(opts.ponto, opts.ops, false, 'host não subiu no ato 2', false);
  }
  const r2 = await runClient({
    root: opts.root,
    dir: cliDir,
    port: host.port,
    phases: 'flush,project,reconcile',
    killAt: doCliente ? killArg : '',
    community: COMMUNITY,
    // Contra um host morto o cliente insiste com backoff e breaker (§11.8) — corretamente, e
    // por minutos. O ato 2 não precisa disso: o que ele produz é o **estado no disco** no
    // instante do crash. Vinte segundos bastam, e é o que um usuário faria: fechar o app.
    timeoutMs: 20_000,
  });
  // A espera pelo host é **limitada**. Se o ponto não for alcançado, o host segue vivo, e um
  // gate que trava é pior do que um gate que reprova: o caso vira `morreu=false` e o oráculo
  // continua valendo (nada pode ter se perdido se ninguém morreu).
  const morreu = doHost ? (await esperaLimitada(host.wait(), 30_000)) === 137 : r2.morreuDeSigkill;

  // ── ato 3: reabre tudo e reconcilia ────────────────────────────────────────────────
  const t0 = Date.now();
  if (host.proc.exitCode === null && host.proc.signalCode === null) await host.shutdown();
  const host2 = await startHost({ root: opts.root, dir: hostDir });
  if (host2 === null) return caso(opts.ponto, opts.ops, morreu, 'host não reabriu no ato 3', false);

  // Duas voltas de recuperação: a primeira pode reencontrar o host com a fila cheia de itens
  // em `sending` (o crash não deixou ninguém desfazer o estado), e a segunda prova que a
  // convergência é estável — o boot **sempre** converge, não converge na média.
  for (let i = 0; i < 2; i++) {
    await runClient({
      root: opts.root,
      dir: cliDir,
      port: host2.port,
      phases: 'flush,project,reconcile',
      community: COMMUNITY,
    });
  }
  const recuperacaoMs = Date.now() - t0;

  // Lê o WAL **antes** de encerrar: um shutdown ordenado faz checkpoint, e medir o WAL
  // depois mediria o resultado da limpeza, não o que um crash teria deixado.
  const wal = walSizes(cliDir);
  const outbox = readOutbox(cliDir);
  const consumidos = readConsumedAuthorSeq(cliDir, COMMUNITY);
  // O core só pode ser aberto pelo orquestrador com o host **fora**: o RocksDB tem lock
  // próprio (§10.8 passo 3), e disputá-lo aqui mediria o lock, não a durabilidade.
  await host2.shutdown();
  const log = await readLog(hostDir);

  const o = oracle({ esperados, log, outbox, consumidos });
  // Converge = tudo que foi enfileirado chegou ao log, e a fila esvaziou.
  const restantes = outbox.filter((i) => i.state !== 'dropped').length;
  const convergiu = o.perdidas.length === 0 && restantes === 0 && log.length >= esperados.length;
  const ok = o.perdidas.length === 0 && o.duplicadas.length === 0 && convergiu;

  rmSync(base, { recursive: true, force: true });
  return {
    ponto: opts.ponto,
    ops: esperados.length,
    morreu,
    perdidas: o.perdidas.length,
    duplicadas: o.duplicadas.length,
    queimadas: o.queimadas,
    noLog: o.noLog,
    naOutbox: restantes,
    convergiu,
    walBytes: wal,
    recuperacaoMs,
    ok,
    detalhe: ok
      ? 'nada perdido, nada duplicado, boot convergiu'
      : `perdidas=${o.perdidas.length} duplicadas=${o.duplicadas.length} restantes=${restantes} log=${log.length}/${esperados.length}`,
  };
}

/** `null` vira o valor de fallback quando o prazo estoura — nunca uma espera infinita. */
async function esperaLimitada(p: Promise<number>, ms: number): Promise<number> {
  let timer: NodeJS.Timeout | undefined;
  const prazo = new Promise<number>((r) => {
    timer = setTimeout(() => r(-1), ms);
    timer.unref?.();
  });
  const v = await Promise.race([p, prazo]);
  clearTimeout(timer);
  return v;
}

function caso(ponto: KillPoint | 'sem-kill', ops: number, morreu: boolean, detalhe: string, ok: boolean): CrashCase {
  return {
    ponto,
    ops,
    morreu,
    perdidas: 0,
    duplicadas: 0,
    queimadas: 0,
    noLog: 0,
    naOutbox: 0,
    convergiu: false,
    walBytes: { manifest: 0, view: 0 },
    recuperacaoMs: 0,
    ok,
    detalhe,
  };
}

export async function runCrashMatrix(opts: {
  root: string;
  work: string;
  ops: number;
  repeticoes: number;
  log?: (m: string) => void;
}): Promise<CrashReport> {
  const t0 = Date.now();
  const casos: CrashCase[] = [];
  const pontos: (KillPoint | 'sem-kill')[] = ['sem-kill', ...KILL_POINTS];
  for (const ponto of pontos) {
    for (let r = 0; r < opts.repeticoes; r++) {
      const c = await umCaso({ root: opts.root, work: opts.work, ponto, ops: opts.ops, repeticao: r });
      casos.push(c);
      opts.log?.(
        `      ${c.ok ? 'OK   ' : 'FALHA'} ${ponto.padEnd(34)} morreu=${String(c.morreu).padEnd(5)} ` +
          `log=${c.noLog} fila=${c.naOutbox} queimadas=${c.queimadas} · ${c.detalhe}`,
      );
    }
  }
  return { ok: casos.every((c) => c.ok), casos, ms: Date.now() - t0 };
}
