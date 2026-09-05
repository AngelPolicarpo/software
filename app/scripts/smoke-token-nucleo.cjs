/**
 * O main de mentira do smoke do token de §15.3 — exercita a fronteira IPC-M REAL com o
 * utility REAL do produto (`dist/utility/index.js`), sem janela e sem diálogo. O diálogo
 * nativo é do main de verdade e continua sendo o que o operador vê; o que este smoke mede
 * é o trecho DEPOIS dele, invisível a qualquer UI: o pedido de emissão na porta privada e
 * a resposta do `AuthTokenStore` do núcleo.
 *
 * Foi exatamente aqui que o encerrar comunidade morreu: o pedido saía por um canal que o
 * utility não escuta (o parentPort não vê tráfego de MessagePort), o diálogo confirmava, e
 * o token morria no timeout — mesma morte para TODOS os main-confirmed (§15.3). Um smoke
 * que só olha renderer↔main nunca pega essa classe de defeito; este fala com o utility
 * como o main fala.
 *
 *   xvfb-run -a npm run smoke:token     (ou com DISPLAY já apontado)
 */
const { app, utilityProcess, MessageChannelMain } = require('electron');

const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) ?? '').split('=')[1];
const UTILITY = arg('utility');
const DATA_DIR = arg('data-dir');
const t0 = Date.now();
const log = (m) => console.log(`[smoke-token ${String(Date.now() - t0).padStart(5)}ms] ${m}`);
const marcas = { TOKEN_1: null, TOKEN_DISTINTO: null, MALFORMADO: null };

function marca(nome, valor) {
  marcas[nome] = valor;
  console.log(`SMOKE_TOKEN:${nome}=${valor}`);
}

function finalizar() {
  const veredito = Object.values(marcas).every((v) => v === 'OK') ? 'PASSA' : 'REPROVA';
  marca('VEREDITO', veredito);
  app.exit(veredito === 'PASSA' ? 0 : 1);
}

app.whenReady().then(() => {
  const child = utilityProcess.fork(UTILITY, [], {
    serviceName: 'smoke-token-nucleo',
    env: { ...process.env, P2P_DATA_DIR: DATA_DIR },
  });

  const ipcM = new MessageChannelMain();
  const ipcR = new MessageChannelMain();
  child.postMessage({ kind: 'ipc-m-port' }, [ipcM.port2]);
  child.postMessage({ kind: 'ipc-r-port', epoch: 1 }, [ipcR.port1]);

  child.on('message', (msg) => {
    const m = msg;
    if (m.e === 'ready') {
      log(`núcleo pronto na fase ${m.phase} — pedindo emissão pela IPC-M`);
      ipcM.port1.postMessage({ kind: 'issueToken', cmd: 'community.end', id: 4241 });
    } else if (m.e === 'blocked') {
      marca('BOOT', 'FALHOU');
      log(`núcleo bloqueado: ${m.code} ${m.message ?? ''}`);
      finalizar();
    }
  });

  // O oráculo de keystore do main de verdade responde com safeStorage; aqui responde
  // identidade — o que o smoke mede é a emissão do token, não a cifra.
  let tokenPrimeiro = null;
  ipcM.port1.on('message', (e) => {
    const m = e.data;
    if (m.q === 'keystoreInfo' && m.id !== undefined) {
      ipcM.port1.postMessage({ a: 'keystoreInfo', id: m.id, available: true, backend: 'smoke' });
    } else if (m.q === 'wrapDataKey' && m.id !== undefined) {
      ipcM.port1.postMessage({ a: 'wrapDataKey', id: m.id, wrappedB64: m.dataKeyB64 });
    } else if (m.q === 'unwrapDataKey' && m.id !== undefined) {
      ipcM.port1.postMessage({ a: 'unwrapDataKey', id: m.id, dataKeyB64: m.wrappedB64 });
    } else if (m.a === 'issueToken') {
      log(`issueToken id=${m.id} ok=${m.ok} code=${m.code ?? '-'} token=${typeof m.token === 'string' ? `${m.token.length} chars` : '-'}`);
      if (m.id === 4241) {
        const bom = m.ok === true && typeof m.token === 'string' && /^[0-9a-f]{64}$/.test(m.token);
        tokenPrimeiro = m.token;
        marca('TOKEN_1', bom ? 'OK' : 'FALHOU');
        if (bom) ipcM.port1.postMessage({ kind: 'issueToken', cmd: 'community.end', escopoBruto: 'c-1', id: 4242 });
        else finalizar();
      } else if (m.id === 4242) {
        marca('TOKEN_DISTINTO', m.ok === true && typeof m.token === 'string' && m.token !== tokenPrimeiro ? 'OK' : 'FALHOU');
        // cmd malformado tem de falhar FECHADO: E_BUSY, nem crash nem silêncio.
        ipcM.port1.postMessage({ kind: 'issueToken', cmd: 42, id: 4243 });
      } else if (m.id === 4243) {
        marca('MALFORMADO', m.ok === false && m.code === 'E_BUSY' ? 'OK' : 'FALHOU');
        // §15.3 emendado, regra 2 — comando FORA da tabela não vira token. Sem isto, o
        // `AuthTokenStore` seria um oráculo de assinatura para qualquer nome.
        ipcM.port1.postMessage({ kind: 'issueToken', cmd: 'message.send', id: 4244 });
      } else if (m.id === 4244) {
        marca('FORA_DA_TABELA', m.ok === false && m.code === 'E_UNKNOWN_COMMAND' ? 'OK' : 'FALHOU');
        finalizar();
      }
    }
  });
  ipcM.port1.start();
  ipcR.port1.start();
});
