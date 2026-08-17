// Processo HOST. Sobe o core, reconstrói o `DS` do log e serve o transporte.
//
// Um processo de verdade, não um objeto no mesmo event loop: é o que permite matá-lo com
// `SIGKILL` no meio de um append e reabrir para ver o que sobrou. §28.3 exige exatamente isso.
//
// Ambiente:
//   POC07_DIR        diretório de dados (o core fica em <dir>/core)
//   POC07_ADVERSARY  none | ack-without-append | silent   (§28.5)
//   POC07_KILL_AT    ponto de kill (src/harness/kill.ts)
//   POC07_PORT       porta fixa; 0 ou ausente = efêmera, anunciada no stdout

import Hypercore from 'hypercore';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { Admission } from '../src/host/admission.ts';
import { startHostServer, type AdversaryMode } from '../src/host/server.ts';
import { armFromEnv } from '../src/harness/kill.ts';

async function main(): Promise<void> {
  armFromEnv();
  const dir = process.env.POC07_DIR;
  if (dir === undefined) throw new Error('POC07_DIR ausente');
  mkdirSync(dir, { recursive: true });

  const core = new Hypercore(join(dir, 'core'));
  await core.ready();

  const admission = new Admission(core);
  // O `DS` sai do log, sempre. Ver `Admission.recover`.
  await admission.recover();

  const server = await startHostServer(admission, {
    port: Number(process.env.POC07_PORT ?? 0),
    adversary: (process.env.POC07_ADVERSARY ?? 'none') as AdversaryMode,
    coreLength: () => core.length,
    readBlock: (seq) => core.get(seq, { wait: false }),
  });

  // Handshake com o orquestrador: uma linha de JSON no stdout.
  process.stdout.write(`${JSON.stringify({ ready: true, port: server.port, length: core.length })}\n`);

  const encerra = async (): Promise<void> => {
    await admission.drain();
    await server.close();
    await core.close();
    process.exit(0);
  };
  // `SIGTERM` é o encerramento **ordenado**, usado quando o cenário não é de crash. A
  // durabilidade nunca depende dele — quem prova isso é o `SIGKILL` da matriz.
  process.on('SIGTERM', () => void encerra());
  process.on('message', (m) => {
    if (m === 'shutdown') void encerra();
  });

  // Mantém o processo vivo.
  setInterval(() => {}, 1 << 30).unref?.();
  await new Promise<void>(() => {});
}

await main();
