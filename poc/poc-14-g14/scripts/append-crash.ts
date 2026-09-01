// O filho do cenário 5: **um** append no caminho de §31.10, com um ponto de morte declarado.
//
// O pai o mata com `SIGKILL` no ponto pedido. O caminho é o de §31.13: grava
// `self_high_water` em `manifest.db` (`FULL`) **antes** do append, e só então appenda.
//
// Uso: node dist/scripts/append-crash.js <dir> <conversationId> <ponto> <indice>
//   ponto ∈ antes-hw | entre | durante | depois | limpo
//
// `limpo` não morre: é a corrida de controle, e é ela que prova que o harness mede a morte
// e não um bug do próprio caminho.

import { join } from 'node:path';

import Hypercore from 'hypercore';

import { dmHello, dmRecord, dmWorld } from '../src/core.js';
import { abrirManifesto, classificar } from '../src/manifesto.js';

const [, , dir, conversationId, ponto, indiceTexto] = process.argv;
if (dir === undefined || conversationId === undefined || ponto === undefined || indiceTexto === undefined) {
  process.exit(64);
}
const indice = Number(indiceTexto);

function morrer(): never {
  process.kill(process.pid, 'SIGKILL');
  // `SIGKILL` no próprio pid não retorna; o `throw` existe só para o tipo.
  throw new Error('inalcançável');
}

const w = dmWorld();
const manifesto = abrirManifesto(join(dir, 'manifest.db'));
const core = new Hypercore(join(dir, 'core'), { keyPair: w.lo.core, compat: true });
await core.ready();

const rec =
  core.length === 0
    ? dmHello(w, w.lo)
    : dmRecord(w, w.lo, { kind: 'dm.message', authorSeq: core.length + 1, ack: 0, payload: { content: `bloco-${core.length}` } } as never);

const hwAoAbrir = manifesto.ler(conversationId);
process.stdout.write(`${JSON.stringify({ fase: 'aberto', length: core.length, hw: hwAoAbrir })}\n`);

// §31.13, a regra de boot — e ela roda **antes** de qualquer append, aqui dentro do processo
// que escreve. `desynced` não appenda; a escrita devolveria `E_DM_FORKED`. É isto que o
// cenário 5 mede: não "o harness resolveu não appendar", mas o caminho de escrita se
// recusando por conta própria.
if (classificar(core.length, hwAoAbrir) === 'desynced') {
  process.stdout.write(`${JSON.stringify({ fase: 'desynced-recusou-append', length: core.length, hw: hwAoAbrir })}\n`);
  manifesto.fechar();
  await core.close();
  process.exit(0);
}

if (ponto === 'antes-hw') morrer();

manifesto.gravar(conversationId, core.length + 1);
process.stdout.write(`${JSON.stringify({ fase: 'hw-gravado', hw: core.length + 1 })}\n`);

if (ponto === 'entre') morrer();

if (ponto === 'durante') {
  // Morre com o append **em voo**: a promessa nunca resolve, e é exatamente o buraco que a
  // barreira de §10.7.1 deixa aberto.
  void core.append(rec);
  setTimeout(morrer, indice % 3);
  await new Promise(() => {});
}

await core.append(rec);
process.stdout.write(`${JSON.stringify({ fase: 'appendado', length: core.length })}\n`);

if (ponto === 'depois') morrer();

manifesto.fechar();
await core.close();
process.exit(0);
