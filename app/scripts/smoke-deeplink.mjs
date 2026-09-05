/**
 * Smoke da gramática **fechada** de deep link (§3.5).
 *
 * Por que um smoke e não um teste do core: a gramática vivia em dois lugares — o produto
 * (`app/src/main`) e uma cópia em `core/src/l3/ipcMain` —, e só a cópia tinha teste. Ela já
 * havia divergido (faltava a rota `u/<KEY64>` da emenda B64), então a suíte validava uma
 * implementação que nenhum processo executava. Ficou uma só, no processo que de fato recebe
 * `argv` e `open-url`, e este smoke é a verificação dela.
 *
 *   npm run smoke:deeplink
 *
 * Requer `npm run build` em app/ (roda contra `dist/main/deeplink.js`).
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MODULO = path.resolve(AQUI, '../dist/main/deeplink.js');

const { parseDeepLink } = await import(pathToFileURL(MODULO).href);

const CHAVE64 = 'A'.repeat(64);
const casos = [
  // Aceita: as três rotas de §3.5 + B64.
  ['comunidadep2p://join/0123456789ABCDEF', { route: 'join', code: '0123456789ABCDEF' }],
  [`comunidadep2p://m/${'A'.repeat(86)}`, { route: 'message', ref: 'A'.repeat(86) }],
  [`comunidadep2p://u/${CHAVE64}`, { route: 'user', key: CHAVE64.toLowerCase() }],
  // A caixa da URL é tolerada na rota de pessoa, e a chave segue em minúsculas.
  [`  comunidadep2p://u/${CHAVE64.toLowerCase()}  `, { route: 'user', key: CHAVE64.toLowerCase() }],

  // Recusa: gramática fechada quer dizer que tudo o mais é `null`.
  ['comunidadep2p://join/invalid-short', null],
  ['comunidadep2p://join/0123456789ABCDEFG', null], // 17 caracteres
  ['comunidadep2p://join/0123456789abcdef', null], // Crockford é maiúsculo
  ['comunidadep2p://join/0123456789ABCDEI', null], // `I` não existe em Crockford
  [`comunidadep2p://u/${'A'.repeat(63)}`, null],
  [`comunidadep2p://u/${'Z'.repeat(64)}`, null], // fora do alfabeto hexadecimal
  [`comunidadep2p://m/${'A'.repeat(85)}`, null],
  ['https://comunidadep2p.org/join/0123456789ABCDEF', null],
  ['comunidadep2p://outra/coisa', null],
  ['javascript:alert(1)', null],
  ['file:///etc/passwd', null],
  ['', null],
];

let falhas = 0;
for (const [entrada, esperado] of casos) {
  const obtido = parseDeepLink(entrada);
  try {
    assert.deepEqual(obtido, esperado);
  } catch {
    falhas++;
    console.error(`FALHOU ${JSON.stringify(entrada)}\n  esperado ${JSON.stringify(esperado)}\n  obtido   ${JSON.stringify(obtido)}`);
  }
}

if (falhas > 0) {
  console.error(`\nsmoke:deeplink REPROVADO — ${falhas} de ${casos.length} casos`);
  process.exit(1);
}
console.log(`smoke:deeplink OK — ${casos.length} casos da gramática de §3.5`);
