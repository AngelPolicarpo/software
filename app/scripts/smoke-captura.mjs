/**
 * Smoke da escolha de fonte de captura (§17.5, "Uma janela").
 *
 * O defeito que este smoke existe para não deixar voltar: a opção "Uma janela" abria uma
 * captura, mostrava imagem e transmitia **a primeira janela que o sistema listasse** — o
 * main resolvia `desktopCapturer.getSources(...)[0]` porque a escolha da pessoa nunca
 * chegava até ele. De fora nada parece quebrado: aparece uma tela e ela até se move. Só
 * quem esperava ver a própria janela sabe que é a errada.
 *
 *   xvfb-run -a npm run smoke:captura     (ou com DISPLAY já apontado)
 *
 * Três cenários, todos contra a `resolverFonte` do produto (`dist/main/captura.js`) dentro
 * de um `setDisplayMediaRequestHandler` real:
 *
 *   tela        — declara o id de uma fonte de tela: a captura tem de ser DELA.
 *   inexistente — declara um id que não está na lista viva (a janela fechou entre escolher
 *                 e capturar): a captura tem de ser NEGADA, nunca trocada por outra fonte.
 *                 É o cenário que reprova `fontes[0]` mesmo numa máquina com uma fonte só.
 *   janela      — o cenário completo: várias janelas abertas e a escolhida FORA da primeira
 *                 posição. Onde o X não lista janelas — display virtual sem gerenciador de
 *                 janelas, que é o caso do CI —, ele é declarado **não medido**, e não
 *                 aprovado: um verde que não olhou para nada é pior que um buraco conhecido.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const ELECTRON = path.join(RAIZ, 'node_modules/electron/cli.js');
const JANELA = path.join(AQUI, 'smoke-captura-janela.cjs');
const PAGINA = path.join(AQUI, 'smoke-captura-pagina.html');
const CAPTURA = path.join(RAIZ, 'dist/main/captura.js');

if (!fs.existsSync(CAPTURA)) {
  console.error(`${CAPTURA} não encontrado — rode \`npm run build\` em app/ antes.`);
  process.exit(2);
}
if (process.env.DISPLAY === undefined && process.platform === 'linux') {
  console.error('sem DISPLAY: rode por `xvfb-run -a` ou aponte um display.');
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-captura-'));

function cenario(nome) {
  return new Promise((resolve) => {
    const saida = [];
    const filho = spawn(
      process.execPath,
      [
        ELECTRON, JANELA,
        `--cenario=${nome}`,
        `--pagina=${PAGINA}`,
        '--no-sandbox',
        '--password-store=basic_text',
        `--user-data-dir=${path.join(tmp, nome)}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const morte = setTimeout(() => filho.kill('SIGKILL'), 60_000);
    filho.stdout.on('data', (d) => saida.push(String(d)));
    filho.stderr.on('data', (d) => saida.push(String(d)));
    filho.on('exit', () => {
      clearTimeout(morte);
      resolve(saida.join(''));
    });
  });
}

const problemas = [];
const naoMedidos = [];
function conferir(ok, msg) {
  console.log(`${ok ? '  ok  ' : ' FALHA'} ${msg}`);
  if (!ok) problemas.push(msg);
}
function naoMedido(msg) {
  console.log(`  --   ${msg}`);
  naoMedidos.push(msg);
}

/** `CHAVE=valor` numa linha da saída do cenário. */
function campo(saida, chave) {
  const m = saida.match(new RegExp(`^${chave}=(.*)$`, 'm'));
  return m === null ? null : m[1];
}

console.log('smoke da escolha de fonte de captura (§17.5)\n');

const tela = await cenario('tela');
console.log('tela — o id declarado é o concedido:');
if (campo(tela, 'SEM_FONTE') !== null || campo(tela, 'QUANTAS') === '0') {
  conferir(false, 'o ambiente não listou nenhuma tela — sem isso não há captura a exercitar');
  console.error(tela);
} else {
  conferir(
    campo(tela, 'CONCEDIDA') === campo(tela, 'ESCOLHIDA'),
    `a fonte concedida é a escolhida (${campo(tela, 'CONCEDIDA')})`,
  );
  conferir((campo(tela, 'CAPTURA') ?? '').startsWith('OK:'), 'a captura sobe com trilha de vídeo');
  conferir(
    (campo(tela, 'CAPTURA') ?? '').includes(campo(tela, 'ESCOLHIDA') ?? ' '),
    `a trilha capturada é a da fonte escolhida (${campo(tela, 'CAPTURA')})`,
  );
  conferir(
    Number(campo(tela, 'COM_MINIATURA')) === Number(campo(tela, 'QUANTAS')),
    `toda fonte listada tem miniatura (${campo(tela, 'COM_MINIATURA')}/${campo(tela, 'QUANTAS')})`,
  );
  conferir(campo(tela, 'PROPRIA_FILTRADA') === 'true', 'a própria janela do app fica fora da lista');
}

const inexistente = await cenario('inexistente');
console.log('\ninexistente — a fonte sumiu entre escolher e capturar:');
conferir(
  campo(inexistente, 'CONCEDIDA') === 'nenhuma',
  'fonte que não está na lista viva é NEGADA, não trocada pela primeira',
);
conferir(
  (campo(inexistente, 'CAPTURA') ?? '').startsWith('ERRO:'),
  `e o renderer recebe a recusa (${campo(inexistente, 'CAPTURA')})`,
);

const janela = await cenario('janela');
console.log('\njanela — a escolhida não é a primeira da lista:');
const quantas = Number(campo(janela, 'QUANTAS') ?? '0');
if (quantas < 2) {
  naoMedido(
    `o X listou ${quantas} janela(s): sem gerenciador de janelas o Chromium não enumera janela nenhuma. ` +
      'Rode este smoke numa sessão gráfica de verdade para exercitar o cenário completo.',
  );
} else {
  conferir(
    campo(janela, 'INDICE_DA_ESCOLHIDA') !== '0',
    `a janela escolhida está fora da primeira posição (índice ${campo(janela, 'INDICE_DA_ESCOLHIDA')})`,
  );
  conferir(
    campo(janela, 'CONCEDIDA') === campo(janela, 'ESCOLHIDA'),
    `o main concede a janela ESCOLHIDA (${campo(janela, 'CONCEDIDA')}) e não a primeira (${campo(janela, 'PRIMEIRA')})`,
  );
  conferir(
    (campo(janela, 'CAPTURA') ?? '').includes(campo(janela, 'ESCOLHIDA') ?? ' '),
    `a trilha capturada é a da janela escolhida (${campo(janela, 'CAPTURA')})`,
  );
  conferir(
    Number(campo(janela, 'COM_MINIATURA')) === quantas,
    `toda janela listada tem miniatura (${campo(janela, 'COM_MINIATURA')}/${quantas})`,
  );
}

// ── De quem é a escolha da fonte, por plataforma (§17.5) ────────────────────────────────
//
// Não precisa de Electron: é decisão pura, e é a que resolve o loop do Wayland — onde
// `getSources` é o próprio pedido de permissão, listar aqui mostrava a caixa do sistema,
// depois a nossa, e depois a do sistema de novo. A tabela fica presa aqui porque o erro
// natural é afrouxá-la ("é Linux, então é portal") e perder o seletor do produto no X11,
// onde ele é a única escolha real que existe.
console.log('\nde quem é a escolha da fonte:');
const { seletorDoSistema } = await import(`file://${CAPTURA}`);
for (const [plataforma, env, esperado, porque] of [
  ['win32', { WAYLAND_DISPLAY: 'wayland-0' }, false, 'Windows nunca usa portal'],
  ['darwin', { XDG_SESSION_TYPE: 'wayland' }, false, 'macOS nunca usa portal'],
  ['linux', { XDG_SESSION_TYPE: 'wayland' }, true, 'sessão Wayland declarada'],
  ['linux', { WAYLAND_DISPLAY: 'wayland-0' }, true, 'socket do compositor sem declaração (WSLg)'],
  [
    'linux',
    { XDG_SESSION_TYPE: 'x11', WAYLAND_DISPLAY: 'wayland-0' },
    false,
    'X11 declarado vence WAYLAND_DISPLAY herdado do ambiente',
  ],
  ['linux', {}, false, 'X11 puro — o seletor do produto é a única escolha'],
]) {
  conferir(
    seletorDoSistema(plataforma, env) === esperado,
    `${plataforma} ${JSON.stringify(env)} → ${esperado ? 'sistema' : 'produto'} · ${porque}`,
  );
}

// §17.5 (emenda de 2026-09-03, B39) — o som da captura, e quem o decide.
//
// O main não passa mais a **declaração do renderer** para cá: passa a **resposta do núcleo**
// (`capture.decision{audio}`, §15.7). Esta tabela prende a metade que mora neste módulo —
// que "não concedido" produz captura MUDA e não captura recusada, que é o desfecho declarado
// em §17.5. A outra metade (o núcleo decidir) é unidade, em `musica-captura.test.ts`.
console.log('\no som da captura, e quem o decide:');
const { audioDaCaptura } = await import(`file://${CAPTURA}`);
for (const [plataforma, tipo, concedido, esperado, porque] of [
  ['win32', 'screen', true, 'loopback', 'som concedido numa tela inteira é o som do sistema'],
  ['win32', 'window', true, 'loopback', 'som concedido numa janela — o isolamento é do pedido, §17.5'],
  ['win32', 'screen', false, undefined, 'som NEGADO pelo núcleo sobe a captura muda, não a derruba'],
  ['linux', 'screen', true, undefined, 'sem loopback na plataforma, sobe muda — nunca outra fonte'],
]) {
  conferir(
    audioDaCaptura(tipo, concedido, plataforma) === esperado,
    `${plataforma}/${tipo} · núcleo ${concedido ? 'concedeu' : 'negou'} → ${esperado ?? 'sem som'} · ${porque}`,
  );
}

fs.rmSync(tmp, { recursive: true, force: true });
if (naoMedidos.length > 0) console.log(`\n${naoMedidos.length} cenário(s) NÃO MEDIDO(S) neste ambiente`);
console.log(problemas.length === 0 ? 'tudo verde' : `\n${problemas.length} problema(s)`);
process.exit(problemas.length === 0 ? 0 : 1);
