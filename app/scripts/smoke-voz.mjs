/**
 * Smoke de voz de duas pontas (B45) — `RTCPeerConnection` REAL do Chromium entre DOIS
 * núcleos REAIS do produto, com a MalhaDeVoz REAL do renderer. É o contraponto da suíte
 * de unidade, que finge o WebRTC por necessidade: todos os defeitos de voz de §77–§89 e
 * de §97 eram do tipo que só duas pontas revelam.
 *
 *   xvfb-run -a npm run smoke:voz     (ou com DISPLAY já apontado)
 *
 * Requer `npm run build` em app/ e o build ESM do core (o utility é o de verdade). O
 * bundle do driver do renderer (`frontend/dist-smoke-voz/`) é reconstruído aqui, a cada
 * rodada — smoke que testa bundle velho não é smoke.
 *
 * O que o cenário prova (vereditos em `smoke-voz-nucleo.cjs`):
 *   descoberta e admissão reais pela DHT local; §16.1 inteiro; tickets de §17.4;
 *   sinalização §16.2/§16.3 nas duas direções; a chamada fechando de verdade com mídia
 *   fluindo nos dois sentidos; troca de canal e reentrada limpas (§97).
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const RAIZ_REPO = path.resolve(RAIZ, '..');
const UTILITY = path.join(RAIZ, 'dist/utility/index.js');
const ELECTRON = path.join(RAIZ, 'node_modules/electron/cli.js');
const NUCLEO = path.join(AQUI, 'smoke-voz-nucleo.cjs');
const FRONTEND = path.join(RAIZ_REPO, 'frontend');
const PAGINA = path.join(FRONTEND, 'dist-smoke-voz', 'src', 'smoke-voz', 'index.html');

if (!fs.existsSync(UTILITY)) {
  console.error(`utility não encontrado em ${UTILITY} — rode \`npm run build\` em app/ antes.`);
  process.exit(2);
}
if (process.env.DISPLAY === undefined && process.platform === 'linux') {
  console.error('sem DISPLAY: rode por `xvfb-run -a` ou aponte um display.');
  process.exit(2);
}

// O bundle do driver é reconstruído a cada rodada: o que ele embute (voz.ts, ipc/client)
// é exatamente o código em teste, e um bundle velho diria "ok" de código que já mudou.
console.log('construindo o bundle do driver do renderer (frontend/dist-smoke-voz)...');
const build = spawnSync('npx', ['vite', 'build', '--config', 'vite.smoke-voz.config.ts'], {
  cwd: FRONTEND,
  stdio: 'inherit',
});
if (build.status !== 0 || !fs.existsSync(PAGINA)) {
  console.error(`build do bundle falhou (status ${build.status}) — esperava ${PAGINA}`);
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-voz-'));

const saida = [];
const filho = spawn(
  process.execPath,
  [
    ELECTRON, NUCLEO,
    `--utility=${UTILITY}`,
    `--pagina=${PAGINA}`,
    `--data-dir=${tmp}`,
    '--no-sandbox',
    '--password-store=basic_text',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
// Um smoke que pendura não é veredito: matá-lo reprova, que é o desfecho honesto.
const morte = setTimeout(() => filho.kill('SIGKILL'), 240_000);
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
fs.rmSync(tmp, { recursive: true, force: true });

const exigidos = [
  ['DHT_LOCAL', 'a DHT local de verdade subiu'],
  ['NUCLEOS', 'os DOIS núcleos reais bootaram (utility do produto)'],
  ['PAGINAS', 'as duas páginas com a MalhaDeVoz real receberam a porta e o hello'],
  ['COMUNIDADE', 'comunidade, dois canais de voz e convite criados pela IPC-R'],
  ['ADMISSAO', 'o resgate do convite passou pela admissão §12 na rede local'],
  ['REPLICACAO', 'B replicou a estrutura antes de entrar'],
  ['CONECTADOS', 'as duas pontas chegam a `connected` na malha WebRTC real'],
  ['FLUXO_A_PARA_B', 'bytes de áudio de A chegam a B (mídia de verdade, não negociação só)'],
  ['FLUXO_B_PARA_A', 'bytes de áudio de B chegam a A'],
  ['TROCA_DE_CANAL', 'trocar de canal não derruba a chamada nova (§97.1)'],
  ['REENTRADA_LIMPA', 'reentrar fica conectado com UMA conexão por par — nada duplicado'],
  ['FLUXO_POS_TROCA', 'a mídia volta a fluir depois da troca e da reentrada'],
];

console.log('\nsmoke de voz de duas pontas (B45)');
let problemas = 0;
for (const [marca, descricao] of exigidos) {
  const re = new RegExp(`SMOKE_VOZ:META:${marca}=(.+)$`, 'm');
  const m = re.exec(texto);
  const valor = m?.[1] ?? 'AUSENTE';
  const ok = valor !== 'AUSENTE' && !valor.startsWith('FALHOU');
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${descricao} — ${valor}`);
  if (!ok) problemas++;
}
const veredito = /SMOKE_VOZ:META:VEREDITO=(.+)$/m.exec(texto)?.[1] ?? 'AUSENTE';
if (veredito !== 'PASSA') problemas++;
console.log(problemas === 0 && codigo === 0 ? '\ntudo verde' : `\n${problemas} problema(s) (exit ${codigo})`);
process.exit(problemas === 0 && codigo === 0 ? 0 : 1);
