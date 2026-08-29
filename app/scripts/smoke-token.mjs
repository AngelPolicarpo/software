/**
 * Smoke do token de confirmação nativa (§15.3).
 *
 * A emissão do `authToken` é main↔núcleo pela porta privada (IPC-M) e nenhuma suíte de
 * renderer ou do core enxerga esse trecho: o diálogo nativo confirma, o main pede a
 * emissão, e o `AuthTokenStore` responde — se o pedido sair pelo canal errado, o token
 * morre em timeout e TODO main-confirmed vira morto-vivo (encerrar comunidade incluído),
 * com a UI só dizendo "a resposta demorou". Este smoke fala com o utility como o main
 * fala e é o veredito dessa fronteira.
 *
 *   xvfb-run -a npm run smoke:token     (ou com DISPLAY já apontado)
 *
 * Requer `npm run build` em app/ (e o build ESM do core) — o utility é o de verdade.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const UTILITY = path.join(RAIZ, 'dist/utility/index.js');
const ELECTRON = path.join(RAIZ, 'node_modules/electron/cli.js');
const NUCLEO = path.join(AQUI, 'smoke-token-nucleo.cjs');

if (!fs.existsSync(UTILITY)) {
  console.error(`utility não encontrado em ${UTILITY} — rode \`npm run build\` em app/ antes.`);
  process.exit(2);
}
if (process.env.DISPLAY === undefined && process.platform === 'linux') {
  console.error('sem DISPLAY: rode por `xvfb-run -a` ou aponte um display.');
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-token-'));

const saida = [];
const filho = spawn(
  process.execPath,
  [
    ELECTRON, NUCLEO,
    `--utility=${UTILITY}`,
    `--data-dir=${tmp}`,
    '--no-sandbox',
    '--password-store=basic_text',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
// Um utility que nunca chega a `ready` não pode pendurar o smoke.
const morte = setTimeout(() => filho.kill('SIGKILL'), 45_000);
filho.stdout.on('data', (d) => {
  saida.push(String(d));
  process.stdout.write(d);
});
filho.stderr.on('data', (d) => {
  saida.push(String(d));
  process.stderr.write(d);
});
const codigo = await new Promise((resolve) => {
  filho.on('exit', (c) => {
    clearTimeout(morte);
    resolve(c ?? 1);
  });
});

const texto = saida.join('');
const problemas = [];
function conferir(ok, msg) {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${msg}`);
  if (!ok) problemas.push(msg);
}

console.log('\nsmoke do token de confirmação nativa (§15.3)');
conferir(texto.includes('SMOKE_TOKEN:TOKEN_1=OK'), 'pedido na IPC-M responde token de 32 bytes (§15.3)');
conferir(texto.includes('SMOKE_TOKEN:TOKEN_DISTINTO=OK'), 'cada emissão cunha um token novo — nada reutilizado');
conferir(texto.includes('SMOKE_TOKEN:MALFORMADO=OK'), 'cmd malformado falha fechado com E_BUSY');
if (!texto.includes('SMOKE_TOKEN:VEREDITO=PASSA')) {
  conferir(false, 'a fronteira inteira chegou ao veredito (sem timeout nem crash)');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(problemas.length === 0 ? '\ntudo verde' : `\n${problemas.length} problema(s)`);
process.exit(problemas.length === 0 && codigo === 0 ? 0 : 1);
