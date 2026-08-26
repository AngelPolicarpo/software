/**
 * Smoke do ciclo de fechamento (U-06/§18.7, §92).
 *
 * §78.3 registrou que este ciclo **nunca foi exercitado** — "este ambiente não tem
 * gerenciador de janelas para disparar o `close`" —, e foi por isso que ele voltou
 * quebrado duas vezes. Gerenciador de janelas não é necessário: `win.close()` percorre o
 * mesmo caminho que o X do sistema, e um display virtual basta.
 *
 *   xvfb-run -a npm run smoke:fechamento     (ou com DISPLAY já apontado)
 *
 * Três cenários, todos com o **preload real do produto**:
 *
 *   confirma — o renderer responde `confirmExit`: a janela morre pela RESPOSTA, não pelo
 *              prazo de 10 s que existe só para o silêncio.
 *   cancela  — responde `cancelExit`: a janela FICA, nenhum prazo a fecha por trás, e o
 *              X seguinte volta a perguntar (o guarda não pode ficar gasto).
 *   veto     — o renderer registra `beforeunload` com `preventDefault`, como fazia quem
 *              hospedava com gente online. **Tem de reprovar**: é a prova de que o veto
 *              silencioso do Electron trava a janela para sempre — a causa de §92.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const PRELOAD = path.join(RAIZ, 'dist/preload/index.js');
const ELECTRON = path.join(RAIZ, 'node_modules/electron/cli.js');
const JANELA = path.join(AQUI, 'smoke-fechamento-janela.cjs');

if (!fs.existsSync(PRELOAD)) {
  console.error(`preload não encontrado em ${PRELOAD} — rode \`npm run build\` em app/ antes.`);
  process.exit(2);
}
if (process.env.DISPLAY === undefined && process.platform === 'linux') {
  console.error('sem DISPLAY: rode por `xvfb-run -a` ou aponte um display.');
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-fechamento-'));

function cenario(nome) {
  return new Promise((resolve) => {
    const saida = [];
    const filho = spawn(
      process.execPath,
      [
        ELECTRON, JANELA,
        `--cenario=${nome}`,
        `--preload=${PRELOAD}`,
        '--no-sandbox',
        '--password-store=basic_text',
        `--user-data-dir=${path.join(tmp, nome)}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    // A janela travada é justamente o cenário `veto`: sem esta rédea o smoke pendura.
    const morte = setTimeout(() => filho.kill('SIGKILL'), 20_000);
    filho.stdout.on('data', (d) => saida.push(String(d)));
    filho.stderr.on('data', (d) => saida.push(String(d)));
    filho.on('exit', () => {
      clearTimeout(morte);
      resolve(saida.join(''));
    });
  });
}

const problemas = [];
function conferir(ok, msg) {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${msg}`);
  if (!ok) problemas.push(msg);
}

console.log('smoke do ciclo de fechamento (§92)\n');

const confirma = await cenario('confirma');
console.log('confirma:');
conferir(confirma.includes('CLOSED'), 'confirmar o impacto fecha a janela');
conferir(!confirma.includes('PRAZO'), 'fecha pela RESPOSTA, não pelo prazo de 10 s');

const cancela = await cenario('cancela');
console.log('\ncancela:');
conferir(cancela.includes('VIVA_APOS_CANCELAR=true'), 'cancelar mantém a janela viva');
conferir(cancela.includes('PERGUNTAS=2'), 'o X seguinte pergunta de novo — o guarda não fica gasto');
conferir(!cancela.includes('PRAZO'), 'cancelar desarma o prazo que fecharia a janela por trás');

const veto = await cenario('veto');
console.log('\nveto — o comportamento anterior a §92, que precisa continuar reprovando:');
conferir(!veto.includes('CLOSED'), 'beforeunload com preventDefault TRAVA a janela no Electron');
conferir(veto.includes('FECHOU=false'), 'e o processo segue vivo, sem `window-all-closed` e sem quit');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(problemas.length === 0 ? '\ntudo verde' : `\n${problemas.length} problema(s)`);
process.exit(problemas.length === 0 ? 0 : 1);
