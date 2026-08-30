/**
 * O main de mentira do smoke de voz de duas pontas (B45) — **duas instalações completas do
 * produto no mesmo processo**, cada uma com o utility REAL (`dist/utility/index.js`) e uma
 * janela rodando a malha de voz REAL do produto (`frontend/src/live/voz.ts` + cliente
 * IPC-R real) com `RTCPeerConnection` do Chromium de verdade.
 *
 *   xvfb-run -a npm run smoke:voz     (ou com DISPLAY já apontado)
 *
 * Por que este smoke existe: todos os defeitos de voz de §77–§89 e de §97 eram do tipo que
 * só DUAS PONTAS revelam — troca de canal que derrubava a chamada nova, reentrada que
 * duplicava conexões, sinalização cruzada, ticket que não chega a tempo. Os testes de
 * unidade usam `RTCPeerConnection` falso por necessidade; este smoke é o contraponto.
 *
 * Rede: hyperdht LOCAL (supernode com `bootstrap: []`) — os dois núcleos se acham pela
 * DHT de verdade no loopback, com anúncio, lookup, §16.1 e admissão de §12 inteiros.
 * Áudio: `--use-fake-device-for-media-stream` — o transporte WebRTC é real, o tom do
 * dispositivo falso é o que prova que bytes de mídia cruzam as duas pontas.
 *
 * Cenário (cada veredito sai como `SMOKE_VOZ:META:...`):
 *   1. A cria identidade, comunidade, dois canais de voz e um convite.
 *   2. B cria identidade e RESGATA o convite — admissão §12 pela rede local.
 *   3. B replica a estrutura; A e B entram no canal 1 pela malha real.
 *   4. Ambas as pontas chegam a `connected`, e bytes de áudio fluem nos dois sentidos.
 *   5. As DUAS trocam para o canal 2 — §97.1: a revogação da sessão antiga não derruba a
 *      chamada nova, e fica UMA conexão por par.
 *   6. B reentra no canal 2 — reentrada limpa, `connected` de novo.
 *   7. Os bytes voltam a fluir depois da troca e da reentrada.
 */
const { app, BrowserWindow, utilityProcess, MessageChannelMain, ipcMain } = require('electron');
const HyperDHT = require('hyperdht');
const path = require('node:path');

const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) ?? '').split('=')[1];
const PAGINA = arg('pagina');
const DATA_DIR = arg('data-dir');
const UTILITY = arg('utility');
const PRAZO_MS = Number(arg('prazo') ?? 180_000);

const t0 = Date.now();
const log = (m) => console.log(`[smoke-voz ${String(Date.now() - t0).padStart(6)}ms] ${m}`);
const marcas = {};

function marca(nome, valor) {
  marcas[nome] = valor;
  console.log(`SMOKE_VOZ:META:${nome}=${valor}`);
}

/** Espera um predicado ficar verdadeiro — o relógio do smoke, com diagnóstico. */
async function esperar(nome, predicado, deadlineMs = 45_000, intervalo = 500) {
  const fim = Date.now() + deadlineMs;
  while (Date.now() < fim) {
    const v = await predicado();
    if (v) return v;
    await new Promise((r) => setTimeout(r, intervalo));
  }
  throw new Error(`prazo de ${nome}`);
}

// ─── As duas pontas: comandos via relay pela porta IPC-R que a página possui ───────────

let proximoId = 1;
const pendentes = new Map();

function pedir(papel, op, arg = {}) {
  return new Promise((resolve, reject) => {
    const id = proximoId++;
    pendentes.set(`${papel}:${id}`, { resolve, reject, op });
    win[papel].webContents.send(`voz-op-${papel}`, { id, op, arg });
    setTimeout(() => {
      if (pendentes.delete(`${papel}:${id}`)) reject(new Error(`op ${op} para ${papel} não respondeu`));
    }, 30_000);
  });
}

for (const papel of ['A', 'B']) {
  ipcMain.on(`voz-resp-${papel}`, (_e, m) => {
    const chave = `${papel}:${m.id}`;
    const p = pendentes.get(chave);
    if (p === undefined) return;
    pendentes.delete(chave);
    if (m.erro !== undefined) p.reject(new Error(`${p.op}: ${m.erro}`));
    else p.resolve(m.r);
  });
}

// ─── Boot dos núcleos e janelas ─────────────────────────────────────────────────────────

const win = {};
const nucleos = {};

function nucleo(nome) {
  const child = utilityProcess.fork(UTILITY, [], {
    serviceName: `smoke-voz-${nome}`,
    env: { ...process.env, P2P_DATA_DIR: path.join(DATA_DIR, nome), P2P_DHT_BOOTSTRAP: bootstrap },
  });
  const ipcM = new MessageChannelMain();
  const ipcR = new MessageChannelMain();
  child.postMessage({ kind: 'ipc-m-port' }, [ipcM.port2]);
  child.postMessage({ kind: 'ipc-r-port', epoch: 1 }, [ipcR.port1]);

  const pronto = new Promise((resolve, reject) => {
    const prazo = setTimeout(() => reject(new Error(`núcleo ${nome} não ficou pronto`)), 60_000);
    child.on('message', (m) => {
      if (m.e === 'ready') {
        clearTimeout(prazo);
        log(`núcleo ${nome} pronto na fase ${m.phase}`);
        resolve(m);
      } else if (m.e === 'blocked') {
        clearTimeout(prazo);
        reject(new Error(`núcleo ${nome} bloqueado: ${m.code} ${m.message ?? ''}`));
      }
    });
  });

  // O oráculo de keystore — o mesmo do smoke do token: cifrar é do main de verdade; aqui
  // o que se mede é a voz, e o passthrough mantém a fronteira IPC-M em pé.
  ipcM.port1.on('message', (e) => {
    const m = e.data;
    if (m.q === 'keystoreInfo' && m.id !== undefined) {
      ipcM.port1.postMessage({ a: 'keystoreInfo', id: m.id, available: true, backend: 'smoke' });
    } else if (m.q === 'wrapDataKey' && m.id !== undefined) {
      ipcM.port1.postMessage({ a: 'wrapDataKey', id: m.id, wrappedB64: m.dataKeyB64 });
    } else if (m.q === 'unwrapDataKey' && m.id !== undefined) {
      ipcM.port1.postMessage({ a: 'unwrapDataKey', id: m.id, dataKeyB64: m.wrappedB64 });
    }
  });
  ipcM.port1.start();
  return { child, ipcR, pronto };
}

async function janela(papel) {
  const w = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  // O console da página sai no stdout do smoke. Sem isto, uma falha de negociação é um
  // prazo estourado sem causa: os rótulos `SMOKE_VOZ:<papel>:...` do driver e os `[voz]`
  // da própria malha são a única janela para dentro do renderer.
  w.webContents.on('console-message', (_e, _nivel, mensagem) => {
    console.log(`[${papel}] ${mensagem}`);
  });
  await w.loadFile(PAGINA, { query: { papel } });
  // A página avisa quando está escutando (`voz-pagina-pronta`); entre o loadFile e o
  // registro do `once` o aviso pode ter chegado — checar as duas vezes fecha a corrida.
  await new Promise((resolve) => {
    if (paginasProntas.has(papel)) return resolve();
    ipcMain.once(`voz-pagina-pronta-${papel}`, () => resolve());
    if (paginasProntas.has(papel)) resolve();
  });
  // A porta IPC-R do SEU núcleo vai para a página, como o main de verdade entrega no
  // did-finish-load (§15.1).
  w.webContents.postMessage('voz-port', { tipo: 'voz-port' }, [nucleos[papel].ipcR.port2]);
  await new Promise((resolve, reject) => {
    const prazo = setTimeout(() => reject(new Error(`página ${papel} sem hello`)), 45_000);
    ipcMain.once(`voz-pronto-${papel}`, () => {
      clearTimeout(prazo);
      resolve();
    });
  });
  win[papel] = w;
}

// O aviso de página pronta chega por `ipcRenderer.send('voz-pagina-pronta', papel)` —
// registrado ANTES das janelas existirem.
const paginasProntas = new Set();
ipcMain.on('voz-pagina-pronta', (_e, papel) => {
  paginasProntas.add(papel);
  ipcMain.emit(`voz-pagina-pronta-${papel}`);
});
ipcMain.on('voz-pronto', (_e, papel) => {
  ipcMain.emit(`voz-pronto-${papel}`);
});

// ─── O cenário ──────────────────────────────────────────────────────────────────────────

let dht = null;
let bootstrap = null;

async function cenario() {
  // Rede local de verdade: um BOOTSTRAP DHT no loopback (o mesmo `HyperDHT.bootstrapper`
  // do bin do hyperdht); os dois núcleos bootstrapam nele e se acham por announce/lookup.
  // O bootstrapper exige porta CONCRETA: reserva-se uma UDP livre antes.
  const portaDht = await new Promise((resolve, reject) => {
    const s = require('node:dgram').createSocket('udp4');
    s.on('error', reject);
    s.bind(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  dht = HyperDHT.bootstrapper(portaDht, '127.0.0.1');
  await dht.ready();
  bootstrap = `127.0.0.1:${portaDht}`;
  marca('DHT_LOCAL', portaDht);

  nucleos.A = nucleo('a');
  nucleos.B = nucleo('b');
  await Promise.all([nucleos.A.pronto, nucleos.B.pronto]);
  marca('NUCLEOS', 'OK');

  await janela('A');
  await janela('B');
  marca('PAGINAS', 'OK');

  // 1. A: identidade, comunidade, categoria do default, dois canais de voz e um convite.
  await pedir('A', 'cmd', { cmd: 'identity.create', arg: { displayName: 'Anfitriã', avatarColor: 1 } });
  const criada = await pedir('A', 'cmd', { cmd: 'community.create', arg: { name: 'Fumaça de voz', iconColor: 3 } });
  const estruturaA = await pedir('A', 'cmd', { cmd: 'query.structure', arg: { communityId: criada.communityId } });
  const categoriaId = estruturaA.categories[0].id;
  const voz1 = await pedir('A', 'cmd', {
    cmd: 'channel.create',
    arg: { communityId: criada.communityId, categoryId: categoriaId, type: 1, name: 'palco' },
  });
  const voz2 = await pedir('A', 'cmd', {
    cmd: 'channel.create',
    arg: { communityId: criada.communityId, categoryId: categoriaId, type: 1, name: 'ensaio' },
  });
  const convite = await pedir('A', 'cmd', { cmd: 'invite.create', arg: { communityId: criada.communityId, maxUses: 4 } });
  marca('COMUNIDADE', 'OK');

  // 2. B: identidade própria e RESGATE pela admissão §12 sobre a rede local de verdade.
  await pedir('B', 'cmd', { cmd: 'identity.create', arg: { displayName: 'Participante', avatarColor: 2 } });
  let tentativa = 0;
  const resgatado = await esperar(
    'resgate',
    async () => {
      tentativa++;
      try {
        return await pedir('B', 'cmd', {
          cmd: 'invite.redeem',
          arg: { codeOrLink: convite.code, displayName: 'Participante', avatarColor: 2 },
        });
      } catch (e) {
        // O host ainda não é alcançável pela DHT: o desfecho nomeado de §12.3, não um crash.
        log(`redeem tentativa ${tentativa}: ${e.message}`);
        return null;
      }
    },
    90_000,
    2_000,
  );
  marca('ADMISSAO', 'OK');

  // 3. B replica a estrutura antes de entrar: sem o log, o canal não existe para ele —
  // e enquanto a comunidade não abre na réplica a própria consulta é E_NOT_FOUND.
  let diagnostico = 0;
  await esperar(
    'replicacao',
    async () => {
      try {
        const s = await pedir('B', 'cmd', { cmd: 'query.structure', arg: { communityId: resgatado.communityId } });
        // §15.6 — os canais vêm AGRUPADOS por categoria, não num vetor de topo.
        const canais = (s.categories ?? []).flatMap((cat) => (cat.channels ?? []).map((c) => c.id));
        if (!canais.includes(voz1.channelId) || !canais.includes(voz2.channelId)) {
          diagnostico++;
          if (diagnostico % 5 === 1) {
            const comunidades = await pedir('B', 'cmd', { cmd: 'query.communities' }).catch((e) => `erro ${e.message}`);
            log(`estrutura B: canais=${JSON.stringify(canais)} · comunidades=${JSON.stringify(comunidades)}`);
          }
        }
        return canais.includes(voz1.channelId) && canais.includes(voz2.channelId);
      } catch (e) {
        diagnostico++;
        if (diagnostico % 5 === 1) {
          const comunidades = await pedir('B', 'cmd', { cmd: 'query.communities' }).catch((e) => `erro ${e.message}`);
          const statusHost = await pedir('B', 'cmd', { cmd: 'query.hostStatus', arg: { communityId: resgatado.communityId } }).catch((e) => `erro ${e.message}`);
          log(`replicação: ${e.message} · comunidades B=${JSON.stringify(comunidades)} · hostStatus=${JSON.stringify(statusHost)}`);
        }
        return null;
      }
    },
    45_000,
    1_000,
  );
  marca('REPLICACAO', 'OK');

  // 4. Chamada no canal 1: as duas pontas entram pela malha REAL (voice.join de §15.4).
  await pedir('A', 'voz.entrar', { communityId: criada.communityId, channelId: voz1.channelId });
  await pedir('B', 'voz.entrar', { communityId: resgatado.communityId, channelId: voz1.channelId });
  await esperar('conexão', async () => {
    const a = await pedir('A', 'voz.estado');
    const b = await pedir('B', 'voz.estado');
    return a.conectados >= 1 && b.conectados >= 1 ? { a, b } : null;
  }, 60_000, 1_000);
  marca('CONECTADOS', 'OK');

  // 5. A mídia cruza nos DOIS sentidos — negociação fechada sem som não vale.
  const fluxoA = await pedir('A', 'voz.medirFluxo');
  const fluxoB = await pedir('B', 'voz.medirFluxo');
  marca('FLUXO_A_PARA_B', fluxoB.bytes > 0 ? `OK(${fluxoB.bytes}B)` : 'FALHOU');
  marca('FLUXO_B_PARA_A', fluxoA.bytes > 0 ? `OK(${fluxoA.bytes}B)` : 'FALHOU');

  // 6. As DUAS trocam para o canal 2 — é o defeito de §97.1: a revogação da sessão ANTIGA
  // (que o host emite no mesmo fôlego em que admite a nova) não pode derrubar a chamada
  // nova, e a reentrada não pode duplicar conexões. A de cá primeiro: é quem vai estar no
  // canal novo quando a de lá chegar — o caso real de "sair de um canal para outro onde
  // já tem gente".
  await pedir('A', 'voz.entrar', { communityId: criada.communityId, channelId: voz2.channelId });
  await esperar('troca de A', async () => {
    const a = await pedir('A', 'voz.estado');
    return a.pares === 0 ? a : null; // A fica sozinha até B chegar — e não pode ter caído
  }, 30_000, 1_000);
  await pedir('B', 'voz.entrar', { communityId: resgatado.communityId, channelId: voz2.channelId });
  await esperar('troca de canal', async () => {
    const a = await pedir('A', 'voz.estado');
    const b = await pedir('B', 'voz.estado');
    return a.conectados >= 1 && b.conectados >= 1 && b.pares === 1 ? { a, b } : null;
  }, 45_000, 1_000);
  marca('TROCA_DE_CANAL', 'OK');

  // 7. B reentra no MESMO canal (o "Tentar novamente" de §80): continua de pé, sem sobra.
  await pedir('B', 'voz.entrar', { communityId: resgatado.communityId, channelId: voz2.channelId });
  await esperar('reentrada', async () => {
    const b = await pedir('B', 'voz.estado');
    return b.conectados >= 1 && b.pares === 1 ? b : null;
  }, 45_000, 1_000);
  const depois = await pedir('B', 'voz.estado');
  marca('REENTRADA_LIMPA', depois.pcs === 3 ? 'OK' : `FALHOU(pcs=${depois.pcs})`);

  // 8. E os bytes voltam a fluir depois da troca e da reentrada.
  const fluxoFim = await pedir('B', 'voz.medirFluxo');
  marca('FLUXO_POS_TROCA', fluxoFim.bytes > 0 ? `OK(${fluxoFim.bytes}B)` : 'FALHOU');
}

function finalizar(falha) {
  if (falha !== undefined) marca('FALHA', String(falha.message ?? falha).slice(0, 300));
  const exigidos = ['DHT_LOCAL', 'NUCLEOS', 'PAGINAS', 'COMUNIDADE', 'ADMISSAO', 'REPLICACAO', 'CONECTADOS', 'FLUXO_A_PARA_B', 'FLUXO_B_PARA_A', 'TROCA_DE_CANAL', 'REENTRADA_LIMPA', 'FLUXO_POS_TROCA'];
  const reprovado = exigidos.some((k) => marcas[k] === undefined || String(marcas[k]).startsWith('FALHOU'));
  marca('VEREDITO', reprovado ? 'REPROVA' : 'PASSA');
  const saida = () => app.exit(reprovado || falha !== undefined ? 1 : 0);
  // As janelas fecham primeiro: app.exit com janelas vivas pula o window-all-closed.
  for (const w of Object.values(win)) {
    try {
      w.destroy();
    } catch {}
  }
  // O bootstrap local morre por último: destruí-lo antes dos núcleos derrubaria a DHT.
  void dht
    ?.destroy()
    .catch(() => {})
    .then(() => new Promise((r) => setTimeout(r, 300)))
    .then(saida);
}

const prazoGlobal = setTimeout(() => finalizar(new Error('prazo global do smoke')), PRAZO_MS);

// Antes do `whenReady`: a linha de comando dos processos de renderer é montada no boot do
// Chromium, e uma chave ligada depois não chega a quem captura o áudio.
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(async () => {
  try {
    await cenario();
    clearTimeout(prazoGlobal);
    finalizar();
  } catch (err) {
    log(`cenário falhou: ${err.message}`);
    clearTimeout(prazoGlobal);
    finalizar(err);
  }
});

app.on('window-all-closed', () => {});
