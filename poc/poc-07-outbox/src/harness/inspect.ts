// Inspeção **do disco**, feita pelo orquestrador depois de o processo morrer.
//
// É aqui que o veredito do gate se forma. O processo que morreu não tem palavra: ele não
// escreveu linha de saída nenhuma. O que sobrou nos arquivos é a única evidência, e é
// exatamente o que o usuário teria na reabertura.

import Database from 'better-sqlite3';
import Hypercore from 'hypercore';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { decodeEnvelope, decodeRecord, opIdOf } from '../protocol/envelope.ts';

export type LogEntry = { seq: number; opId: string; author: string; authorSeq: number };

/** Lê o log inteiro do core do host, sem passar por processo nenhum. */
export async function readLog(hostDir: string): Promise<LogEntry[]> {
  const core = new Hypercore(join(hostDir, 'core'));
  await core.ready();
  const out: LogEntry[] = [];
  for (let seq = 0; seq < core.length; seq++) {
    const raw = await core.get(seq, { wait: false });
    if (raw === null) continue;
    const rec = decodeRecord(raw);
    if (rec === null) continue;
    const env = decodeEnvelope(rec.envelope);
    if (env === null) continue;
    out.push({ seq, opId: opIdOf(rec.envelope), author: env.author.toString('hex'), authorSeq: env.authorSeq });
  }
  await core.close();
  return out;
}

export type OutboxSnapshot = {
  opId: string;
  authorSeq: number;
  state: string;
  ackedSeq: number | null;
  droppedReason: string | null;
};

/** Estado da outbox como está **no arquivo**, sem abrir o processo cliente. */
export function readOutbox(clientDir: string): OutboxSnapshot[] {
  const p = join(clientDir, 'manifest.db');
  if (!existsSync(p)) return [];
  const db = new Database(p, { readonly: true });
  try {
    const rows = db
      .prepare('SELECT op_id, author_seq, state, acked_seq, dropped_reason FROM local_outbox ORDER BY local_seq')
      .all() as { op_id: string; author_seq: number; state: string; acked_seq: number | null; dropped_reason: string | null }[];
    return rows.map((r) => ({
      opId: r.op_id,
      authorSeq: r.author_seq,
      state: r.state,
      ackedSeq: r.acked_seq,
      droppedReason: r.dropped_reason,
    }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** `next_author_seq` — quantos números foram **consumidos** (§7.5). */
export function readConsumedAuthorSeq(clientDir: string, communityId: string): number {
  const p = join(clientDir, 'manifest.db');
  if (!existsSync(p)) return 0;
  const db = new Database(p, { readonly: true });
  try {
    const r = db
      .prepare('SELECT next_author_seq AS n FROM local_author_seq WHERE community_id = ?')
      .get(communityId) as { n: number } | undefined;
    return (r?.n ?? 1) - 1;
  } catch {
    return 0;
  } finally {
    db.close();
  }
}

/** Tamanho do WAL de cada banco — a métrica de §11 que o plano pede. */
export function walSizes(clientDir: string): { manifest: number; view: number } {
  const tam = (f: string): number => {
    try {
      return statSync(join(clientDir, f)).size;
    } catch {
      return 0;
    }
  };
  return { manifest: tam('manifest.db-wal'), view: tam('view.db-wal') };
}

/**
 * O oráculo de §28.3, aplicado ao par (log, outbox).
 *
 * `perdidas` é a pergunta que o gate existe para responder: um `opId` que estava commitado na
 * outbox e não está nem no log nem na outbox **sumiu** — e sumir é a reprovação. `queimadas`
 * é outra coisa: um `authorSeq` reservado cuja linha de fila nunca commitou. §7.5 abençoa o
 * número queimado ("uma op recusada antes do append queima o número"); o host só exige
 * `authorSeq > lastAuthorSeq`, então o buraco na numeração não recusa nada depois.
 */
export function oracle(opts: {
  esperados: readonly string[];
  log: readonly LogEntry[];
  outbox: readonly OutboxSnapshot[];
  consumidos: number;
}): {
  perdidas: string[];
  duplicadas: { par: string; seqs: number[] }[];
  noLog: number;
  naOutbox: number;
  dropped: number;
  queimadas: number;
} {
  const noLog = new Set(opts.log.map((e) => e.opId));
  const naOutbox = new Set(opts.outbox.filter((o) => o.state !== 'dropped').map((o) => o.opId));
  const dropped = new Set(opts.outbox.filter((o) => o.state === 'dropped').map((o) => o.opId));

  const perdidas = opts.esperados.filter((id) => !noLog.has(id) && !naOutbox.has(id) && !dropped.has(id));

  const porPar = new Map<string, number[]>();
  for (const e of opts.log) {
    const par = `${e.author}:${e.authorSeq}`;
    porPar.set(par, [...(porPar.get(par) ?? []), e.seq]);
  }
  const duplicadas = [...porPar]
    .filter(([, seqs]) => seqs.length > 1)
    .map(([par, seqs]) => ({ par, seqs }));

  const representados = new Set([...noLog, ...naOutbox, ...dropped]);
  return {
    perdidas,
    duplicadas,
    noLog: noLog.size,
    naOutbox: naOutbox.size,
    dropped: dropped.size,
    queimadas: Math.max(0, opts.consumidos - representados.size),
  };
}
