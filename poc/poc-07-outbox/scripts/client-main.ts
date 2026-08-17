// Processo CLIENTE. Enfileira, faz flush, projeta e reconcilia — o caminho de §11 inteiro.
//
// Ambiente:
//   POC07_DIR       diretório de dados do cliente (manifest.db, view.db)
//   POC07_PORT      porta do host (ou do proxy)
//   POC07_AUTHOR    chave de autor em hex (32 bytes)
//   POC07_COMMUNITY comunidade em hex (32 bytes)
//   POC07_N         quantas ops enfileirar nesta corrida
//   POC07_KILL_AT   ponto de kill
//   POC07_PHASES    lista separada por vírgula: enqueue,flush,project,reconcile
//
// Escreve **uma linha de JSON** no stdout ao final. Se morrer antes, o orquestrador não vê
// linha nenhuma — e é justamente o caso interessante: o veredito sai da inspeção do disco na
// reabertura, não da palavra do processo que morreu.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { Manifest } from '../src/client/manifest.ts';
import { Outbox } from '../src/client/outbox.ts';
import { Replica } from '../src/client/replica.ts';
import { Rpc } from '../src/client/rpc.ts';
import { armFromEnv } from '../src/harness/kill.ts';
import { encodeEnvelope } from '../src/protocol/envelope.ts';

async function main(): Promise<void> {
  armFromEnv();
  const dir = process.env.POC07_DIR;
  const port = Number(process.env.POC07_PORT ?? 0);
  if (dir === undefined || port === 0) throw new Error('POC07_DIR/POC07_PORT ausentes');
  mkdirSync(dir, { recursive: true });

  const author = Buffer.from(process.env.POC07_AUTHOR ?? '11'.repeat(32), 'hex');
  const communityId = Buffer.from(process.env.POC07_COMMUNITY ?? '22'.repeat(32), 'hex');
  const cidHex = communityId.toString('hex');
  const n = Number(process.env.POC07_N ?? 0);
  const fases = new Set((process.env.POC07_PHASES ?? 'enqueue,flush,project,reconcile').split(','));

  const manifest = new Manifest(join(dir, 'manifest.db'));
  const rpc = new Rpc({ port });
  const replica = new Replica(join(dir, 'view.db'), rpc.logSource(), manifest, cidHex);
  replica.load();

  const outbox = new Outbox({
    manifest,
    replica,
    communityId: cidHex,
    submit: (envs) => rpc.submitBatch(envs),
  });

  // Boot: devolve à fila os `sending` que sobraram de um processo morto. Ver
  // `Outbox.recoverStranded` — é buraco de spec, não detalhe de implementação.
  const encalhados = outbox.recoverStranded();

  // ── enfileira ────────────────────────────────────────────────────────────────────────
  if (fases.has('enqueue')) {
    for (let i = 0; i < n; i++) {
      const authorSeq = manifest.nextAuthorSeq(cidHex);
      const envelope = encodeEnvelope({
        author,
        authorSeq,
        communityId,
        kind: 1,
        payload: Buffer.from(`op-${authorSeq}`, 'utf8'),
      });
      const r = outbox.enqueue(envelope, { channelId: 'c1', kind: 1, authorSeq });
      if (!r.ok) break; // E_OUTBOX_FULL — na hora, nunca às cegas
    }
  }

  // ── flush · projeta · reconcilia, até drenar ─────────────────────────────────────────
  //
  // O cliente real faz isto em timer (§22.3: `outbox.flush` a cada 1 s). Aqui o laço roda até
  // não haver mais o que enviar, com teto de voltas: o gate precisa de um fim determinístico,
  // e um item que não drena é resultado, não motivo para girar para sempre.
  let rec = { removidos: 0, mismatch: 0, expirados: 0 };
  const maxVoltas = Number(process.env.POC07_MAX_ROUNDS ?? 2000);
  // Sem progresso = nada saiu **e** a fila não encolheu. O cliente real gira para sempre num
  // timer; o gate precisa de fim determinístico, então desiste depois de um tempo sem
  // progresso — e "desistiu com fila cheia" é um resultado reprovador, não um empate.
  const tetoSemProgresso = Number(process.env.POC07_STALL_ROUNDS ?? 120);
  let semProgresso = 0;
  let restantesAntes = Number.POSITIVE_INFINITY;
  for (let volta = 0; volta < maxVoltas; volta++) {
    const enviados = fases.has('flush') ? await outbox.flush() : 0;
    if (fases.has('project')) await replica.catchUp();
    if (fases.has('reconcile')) {
      const r = outbox.reconcile();
      rec = {
        removidos: rec.removidos + r.removidos,
        mismatch: rec.mismatch + r.mismatch,
        expirados: rec.expirados + r.expirados,
      };
    }
    if (!fases.has('flush')) break;

    const pendentes = manifest.all(cidHex).filter((i) => i.state !== 'dropped');
    if (pendentes.length === 0) break;
    if (enviados > 0 || pendentes.length < restantesAntes) semProgresso = 0;
    else semProgresso++;
    restantesAntes = pendentes.length;
    if (semProgresso >= tetoSemProgresso) break;

    // Espera o backoff de §11.8. A cabeça de **cada canal** é que destrava o canal (§11.7),
    // então o alvo é o menor `next_attempt_at` entre as cabeças, não entre todos os itens: um
    // item do meio já pronto não adianta nada enquanto o da frente não vencer.
    const cabecas = new Map<string, number>();
    for (const i of pendentes) {
      const canal = i.channel_id ?? '';
      if (!cabecas.has(canal)) cabecas.set(canal, i.next_attempt_at);
    }
    const proximo = Math.min(...cabecas.values());
    const esperaMs = Math.min(Math.max(proximo - Date.now(), 0), 2_000);
    await new Promise((r) => setTimeout(r, Math.max(esperaMs, 25)));
  }

  const saida = {
    ok: true,
    outbox: outbox.metrics,
    encalhadosRecuperados: encalhados,
    reconciliacao: rec,
    interpretedSeq: replica.state.interpretedSeq,
    projetadas: replica.count(),
    restantes: manifest.all(cidHex).length,
    dumpHash: replica.dumpHash(),
  };
  process.stdout.write(`${JSON.stringify(saida)}\n`);

  rpc.close();
  replica.close();
  manifest.close();
  process.exit(0);
}

await main();
