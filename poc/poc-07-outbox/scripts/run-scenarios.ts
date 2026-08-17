// Os cenários nomeados de POC-07, um a um, com o oráculo de cada um explícito.
//
// Vários rodam o cliente **em processo** contra um host que é processo separado de verdade: o
// que precisa ser externo é quem detém o log e o append, porque é dele que a durabilidade
// depende. Onde o cenário é sobre a morte do cliente, aí sim ele é spawnado (matriz de crash).

import Database from 'better-sqlite3';
import { mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { Manifest } from '../src/client/manifest.ts';
import { Outbox } from '../src/client/outbox.ts';
import { Replica } from '../src/client/replica.ts';
import { Rpc } from '../src/client/rpc.ts';
import { readLog, readOutbox } from '../src/harness/inspect.ts';
import { startAckDroppingProxy } from '../src/harness/proxy.ts';
import { startHost, type HostHandle } from '../src/harness/spawn.ts';
import { encodeEnvelope, opIdOf } from '../src/protocol/envelope.ts';

export type Cenario = {
  readonly nome: string;
  readonly pergunta: string;
  readonly medido: string;
  readonly ok: boolean;
};

const AUTOR = Buffer.alloc(32, 0x11);
const COMUNIDADE = Buffer.alloc(32, 0x22);
const CID = COMUNIDADE.toString('hex');

type Cliente = {
  manifest: Manifest;
  replica: Replica;
  outbox: Outbox;
  rpc: Rpc;
  envelopeDe(authorSeq: number, canal?: string): Buffer;
  enfileira(n: number, canal?: string): void;
  fecha(): void;
};

/** `autor` é parâmetro porque cenários com dois membros precisam de **autores distintos**:
 * o envelope é função de `(autor, authorSeq, canal)`, então dois clientes com o mesmo autor
 * produziriam `opId` idênticos e um veria as ops do outro como suas. */
function abreCliente(dir: string, port: number, autor: Buffer = AUTOR): Cliente {
  mkdirSync(dir, { recursive: true });
  const manifest = new Manifest(join(dir, 'manifest.db'));
  const rpc = new Rpc({ port, timeoutMs: 3000 });
  const replica = new Replica(join(dir, 'view.db'), rpc.logSource(), manifest, CID);
  replica.load();
  const outbox = new Outbox({ manifest, replica, communityId: CID, submit: (e) => rpc.submitBatch(e) });
  const envelopeDe = (authorSeq: number, canal = 'c1'): Buffer =>
    encodeEnvelope({
      author: autor,
      authorSeq,
      communityId: COMUNIDADE,
      kind: 1,
      payload: Buffer.from(`${canal}-${authorSeq}`, 'utf8'),
    });
  return {
    manifest,
    replica,
    outbox,
    rpc,
    envelopeDe,
    enfileira: (n, canal = 'c1') => {
      for (let i = 0; i < n; i++) {
        const authorSeq = manifest.nextAuthorSeq(CID);
        outbox.enqueue(envelopeDe(authorSeq, canal), { channelId: canal, kind: 1, authorSeq });
      }
    },
    fecha: () => {
      rpc.close();
      replica.close();
      manifest.close();
    },
  };
}

async function drena(c: Cliente, voltas = 40): Promise<void> {
  for (let i = 0; i < voltas; i++) {
    const enviados = await c.outbox.flush();
    await c.replica.catchUp();
    c.outbox.reconcile();
    if (enviados === 0 && c.manifest.all(CID).filter((x) => x.state !== 'dropped').length === 0) return;
    if (enviados === 0) await new Promise((r) => setTimeout(r, 60));
  }
}

export async function runScenarios(opts: { root: string; work: string; log?: (m: string) => void }): Promise<{
  ok: boolean;
  cenarios: Cenario[];
  ms: number;
}> {
  const t0 = Date.now();
  const cenarios: Cenario[] = [];
  const reg = (c: Cenario): void => {
    cenarios.push(c);
    opts.log?.(`      ${c.ok ? 'OK   ' : 'FALHA'} ${c.nome.padEnd(46)} ${c.medido}`);
  };
  const base = (nome: string): string => {
    const d = join(opts.work, nome);
    rmSync(d, { recursive: true, force: true });
    mkdirSync(d, { recursive: true });
    return d;
  };

  // ── 1. ACK perdido com append durável ────────────────────────────────────────────────
  {
    const d = base('ack-perdido');
    const host = (await startHost({ root: opts.root, dir: join(d, 'host') })) as HostHandle;
    const proxy = await startAckDroppingProxy({ alvoPort: host.port, dropRate: 1 });
    const c = abreCliente(join(d, 'cli'), proxy.port);
    c.enfileira(10);
    // Com dropRate 1, **nenhum** ACK volta. O host appendou; o cliente não sabe.
    await c.outbox.flush();
    proxy.setDropRate(0);
    await drena(c);
    const fila = c.manifest.all(CID).filter((x) => x.state !== 'dropped').length;
    c.fecha();
    await proxy.close();
    await host.shutdown();
    const log = await readLog(join(d, 'host'));
    const pares = new Set(log.map((e) => `${e.author}:${e.authorSeq}`));
    reg({
      nome: 'ACK perdido, append durável',
      pergunta: 'a op entra uma vez só e a fila esvazia sem ACK?',
      medido: `${proxy.descartadas()} ACKs descartados · log=${log.length} pares=${pares.size} fila=${fila}`,
      ok: log.length === 10 && pares.size === 10 && fila === 0,
    });
  }

  // ── 2. ACK positivo antes do commit é impossível por construção ──────────────────────
  {
    // O host morre **depois** do append e antes de responder. Se algum ACK positivo pudesse
    // preceder a durabilidade, existiria um cliente com `acked_seq` para um registro ausente
    // do log. O oráculo é o inverso: todo `acked_seq` que existir tem registro no log.
    const d = base('ack-antes-do-commit');
    const host = (await startHost({
      root: opts.root,
      dir: join(d, 'host'),
      killAt: 'host:after-append-before-ack@1',
    })) as HostHandle;
    const c = abreCliente(join(d, 'cli'), host.port);
    c.enfileira(8);
    await c.outbox.flush();
    const comAck = c.manifest.all(CID).filter((x) => x.acked_seq !== null);
    c.fecha();
    await host.wait();
    const log = await readLog(join(d, 'host'));
    reg({
      nome: 'ACK positivo antes do commit (impossível)',
      pergunta: 'existe ACK positivo cujo registro não está no log?',
      medido: `itens com acked_seq=${comAck.length} · registros no log=${log.length} (host morto entre append e ACK)`,
      ok: comAck.length === 0 && log.length === 8,
    });
  }

  // ── 3. Perda de WAL — a diferença entre FULL e NORMAL, documentada ──────────────────
  {
    const d = base('perda-de-wal');
    const host = (await startHost({ root: opts.root, dir: join(d, 'host') })) as HostHandle;
    const cliDir = join(d, 'cli');
    const c = abreCliente(cliDir, host.port);
    c.enfileira(20);
    await drena(c);
    const antesFila = c.manifest.all(CID).length;
    const antesView = c.replica.count();
    c.fecha();
    // Apaga os dois `-wal` com os bancos fechados. Fechar faz checkpoint; o que sobreviver
    // aqui é o que já estava no arquivo principal.
    for (const f of ['manifest.db-wal', 'view.db-wal']) {
      try {
        unlinkSync(join(cliDir, f));
      } catch {
        /* já não existia */
      }
    }
    const m2 = new Database(join(cliDir, 'manifest.db'), { readonly: true });
    const fila2 = (m2.prepare('SELECT COUNT(*) AS n FROM local_outbox').get() as { n: number }).n;
    m2.close();
    const v2 = new Database(join(cliDir, 'view.db'), { readonly: true });
    const view2 = (v2.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n;
    v2.close();
    await host.shutdown();
    const log = await readLog(join(d, 'host'));
    reg({
      nome: 'perda de WAL (FULL vs NORMAL)',
      pergunta: 'o que sobrevive em cada banco, e a op se perde?',
      medido:
        `manifest: fila ${antesFila}→${fila2} · view: ${antesView}→${view2} · log=${log.length} ` +
        `(o log é a verdade; view.db é derivado e reprojeta)`,
      // O oráculo não é "nada muda" — é "nenhuma **operação** se perde": o log tem as 20, e
      // o que `view.db` perder volta por reprojeção.
      ok: log.length === 20,
    });
  }

  // ── 4. Expiração: §11.6 regra 1, com e sem reconciliação ────────────────────────────
  {
    const d = base('expiracao');
    // Sem host: nada é appendado, e o item envelhece.
    const c = abreCliente(join(d, 'cli'), 1); // porta morta
    c.enfileira(3);
    // Idade estourada, mas **sem** reconciliação nenhuma ainda: nada pode ser descartado.
    const antes = c.manifest.all(CID).filter((x) => x.state === 'dropped').length;
    // Envelhece os itens artificialmente, mexendo em `created_at` — o relógio de parede não
    // precisa passar para o teste ser válido.
    // Bem além de `OUTBOX_MAX_AGE_MS` — o teste é sobre a **regra**, não sobre o valor.
    c.manifest.raw.prepare('UPDATE local_outbox SET created_at = ?').run(Date.now() - 60 * 60 * 1000);
    const r = c.outbox.reconcile();
    const depois = c.manifest.all(CID).filter((x) => x.state === 'dropped');
    c.fecha();
    reg({
      nome: 'expiração só depois de reconciliar (§11.6 r1)',
      pergunta: 'idade sozinha descarta?',
      medido: `dropped antes=${antes} · depois de 1 reconciliação=${depois.length} motivo=${depois[0]?.dropped_reason ?? '—'} expirados=${r.expirados}`,
      ok: antes === 0 && depois.length === 3 && depois.every((x) => x.dropped_reason === 'expired'),
    });
  }

  // ── 5. Host offline ─────────────────────────────────────────────────────────────────
  {
    const d = base('host-offline');
    const c = abreCliente(join(d, 'cli'), 1); // ninguém escutando
    c.enfileira(12);
    await c.outbox.flush();
    const estados = c.manifest.all(CID).reduce<Record<string, number>>((a, x) => {
      a[x.state] = (a[x.state] ?? 0) + 1;
      return a;
    }, {});
    const perdidos = 12 - c.manifest.all(CID).length;
    c.fecha();
    reg({
      nome: 'host offline',
      pergunta: 'a fila segura tudo, sem perder e sem descartar?',
      medido: `estados=${JSON.stringify(estados)} perdidos=${perdidos}`,
      ok: perdidos === 0 && (estados.queued ?? 0) === 12,
    });
  }

  // ── 6. Duplicação de RPC: o mesmo envelope 3× ───────────────────────────────────────
  {
    const d = base('rpc-duplicado');
    const host = (await startHost({ root: opts.root, dir: join(d, 'host') })) as HostHandle;
    const c = abreCliente(join(d, 'cli'), host.port);
    const env = c.envelopeDe(1);
    const r1 = await c.rpc.submit(env);
    const r2 = await c.rpc.submit(env);
    const r3 = await c.rpc.submit(env);
    c.fecha();
    await host.shutdown();
    const log = await readLog(join(d, 'host'));
    const codigos = [r1, r2, r3].map((r) => (r === null ? 'sem-resposta' : r.ok ? `seq=${r.seq}` : r.code));
    reg({
      nome: 'reenvio do mesmo envelope 3×',
      pergunta: 'um `seq` só, `E_DUPLICATE` nas repetições?',
      medido: `${codigos.join(' · ')} · log=${log.length}`,
      ok:
        log.length === 1 &&
        r1?.ok === true &&
        r2?.ok === false &&
        r2.code === 'E_DUPLICATE' &&
        r3?.ok === false &&
        r3.code === 'E_DUPLICATE',
    });
  }

  // ── 7. Host adversário: confirma `seq` que nunca aparece no log ─────────────────────
  {
    const d = base('adversario-ack');
    const host = (await startHost({
      root: opts.root,
      dir: join(d, 'host'),
      adversary: 'ack-without-append',
    })) as HostHandle;
    const c = abreCliente(join(d, 'cli'), host.port);
    c.enfileira(5);
    await c.outbox.flush();
    const comAck = c.manifest.all(CID).filter((x) => x.acked_seq !== null).length;
    c.fecha();
    await host.shutdown();

    // A comunidade segue viva: o host volta honesto e outro membro escreve. É o que faz o log
    // interpretado **passar** dos `seq` inventados, que é a condição de detecção de §11.6.
    // Sem tráfego posterior o mismatch não tem como aparecer — ver o achado no REPORT.
    const host2 = (await startHost({ root: opts.root, dir: join(d, 'host') })) as HostHandle;
    {
      const outro = abreCliente(join(d, 'cli2'), host2.port, Buffer.alloc(32, 0x33));
      outro.enfileira(8);
      await drena(outro);
      outro.fecha();
    }

    const v = abreCliente(join(d, 'cli'), host2.port);
    await v.replica.catchUp();
    const r = v.outbox.reconcile();
    const estados = v.manifest.all(CID).reduce<Record<string, number>>((a, x) => {
      a[x.state] = (a[x.state] ?? 0) + 1;
      return a;
    }, {});
    const entregues = v.outbox.metrics.removidosPorObservacao;
    v.fecha();
    await host2.shutdown();
    reg({
      nome: 'host adversário: ACK sem append',
      pergunta: 'vira `ackMismatch` e volta a `queued`, nunca "entregue"?',
      medido: `acked=${comAck} mismatch=${r.mismatch} estados=${JSON.stringify(estados)} removidos-como-entregues=${entregues}`,
      ok: comAck === 5 && r.mismatch === 5 && (estados.queued ?? 0) === 5 && entregues === 0,
    });
  }

  // ── 8. Reabertura com itens em `sending` e `awaiting-confirmation` ──────────────────
  {
    const d = base('reabertura');
    const cliDir = join(d, 'cli');
    const host = (await startHost({ root: opts.root, dir: join(d, 'host') })) as HostHandle;
    {
      const c = abreCliente(cliDir, host.port);
      c.enfileira(6);
      // Envia de verdade: os seis vão ao log e ficam em `awaiting-confirmation`, que é onde o
      // ACK os deixa (§11.3 — o ACK **não** remove). Sem reconciliar: é exatamente o estado em
      // que um crash entre o ACK e a reconciliação encontra a fila.
      await c.outbox.flush();
      // E três deles voltam a `sending`, o estado que um crash no meio do envio deixa.
      const linhas = c.manifest.all(CID);
      for (let i = 0; i < 3; i++) c.manifest.setState((linhas[i] as { local_seq: number }).local_seq, 'sending');
      c.fecha();
    }
    const c2 = abreCliente(cliDir, host.port);
    const encalhados = c2.outbox.recoverStranded();
    await drena(c2);
    const fila = c2.manifest.all(CID).filter((x) => x.state !== 'dropped').length;
    const mismatch = c2.outbox.metrics.ackMismatch;
    c2.fecha();
    await host.shutdown();
    const log = await readLog(join(d, 'host'));
    reg({
      nome: 'reabertura com sending e awaiting-confirmation',
      pergunta: 'os seis chegam ao log e a fila esvazia?',
      medido: `encalhados recuperados=${encalhados} ackMismatch=${mismatch} log=${log.length} fila=${fila}`,
      ok: encalhados === 3 && log.length === 6 && fila === 0 && mismatch === 0,
    });
  }

  // ── 9. `authorSeq` ultrapassado entre canais — o achado ─────────────────────────────
  {
    // §11.7 ordena por canal; §7.5 numera por **autor**. Com dois canais, o item de um pode
    // ultrapassar o do outro, e o ultrapassado nunca mais é aceito (estágio 6). Este cenário
    // provoca isso de propósito e verifica que o desfecho é **nomeado**, não perda silenciosa.
    const d = base('authorseq-ultrapassado');
    const host = (await startHost({ root: opts.root, dir: join(d, 'host') })) as HostHandle;
    const c = abreCliente(join(d, 'cli'), host.port);
    const seqA = c.manifest.nextAuthorSeq(CID); // canal a
    const seqB = c.manifest.nextAuthorSeq(CID); // canal b, authorSeq maior
    c.outbox.enqueue(c.envelopeDe(seqA, 'a'), { channelId: 'a', kind: 1, authorSeq: seqA });
    c.outbox.enqueue(c.envelopeDe(seqB, 'b'), { channelId: 'b', kind: 1, authorSeq: seqB });
    // Bloqueia o canal `a` no futuro e envia só o `b`: o host aceita seqB e a marca d'água
    // passa de seqA para sempre.
    c.manifest.raw.prepare("UPDATE local_outbox SET next_attempt_at = ? WHERE channel_id = 'a'").run(Date.now() + 3600_000);
    await c.outbox.flush();
    await c.replica.catchUp();
    c.outbox.reconcile();
    // Agora libera `a` e tenta: o host recusa com E_DUPLICATE, para sempre.
    c.manifest.raw.prepare("UPDATE local_outbox SET next_attempt_at = 0 WHERE channel_id = 'a'").run();
    await drena(c, 6);
    const linhas = c.manifest.all(CID);
    const a = linhas.find((x) => x.channel_id === 'a');
    const ultrapassados = c.outbox.metrics.ultrapassados;
    c.fecha();
    await host.shutdown();
    const log = await readLog(join(d, 'host'));
    const opIdA = opIdOf(c.envelopeDe(seqA, 'a'));
    const noLog = log.some((e) => e.opId === opIdA);
    reg({
      nome: 'authorSeq ultrapassado entre canais',
      pergunta: 'o item ultrapassado tem desfecho nomeado, ou some?',
      medido:
        `log=${log.length} (só o canal b) · item do canal a no log=${noLog} · ` +
        `estado=${a?.state ?? 'REMOVIDO'} erro=${a?.last_error ?? '—'} ultrapassados=${ultrapassados}`,
      // O que **não** pode acontecer: o item sumir da fila sem estar no log.
      ok: !noLog && a !== undefined && a.state === 'failed' && ultrapassados === 1,
    });
  }

  return { ok: cenarios.every((c) => c.ok), cenarios, ms: Date.now() - t0 };
}
