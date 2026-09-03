/**
 * A janela do smoke de captura (§17.5) — exercita a resolução REAL de fonte
 * (`dist/main/captura.js`) dentro de um `setDisplayMediaRequestHandler` de verdade.
 * Rodado por `smoke-captura.mjs`, nunca à mão.
 *
 * A página é `file://` de propósito: `data:` não é contexto seguro, e sem contexto seguro
 * `navigator.mediaDevices` nem existe — a captura falharia por um motivo que não é o que
 * este smoke mede.
 */
const { app, BrowserWindow, desktopCapturer, session, utilityProcess, MessageChannelMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { resolverFonte, atenderPedidoDeCaptura } = require(path.join(__dirname, '../dist/main/captura.js'));
const UTILITY = path.join(__dirname, '../dist/utility/index.js');

const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) ?? '').split('=')[1];
const CENARIO = arg('cenario');
const PAGINA = arg('pagina');

const log = (m) => console.log(m);

/** Uma janela visível com título próprio — é o `name` que o `desktopCapturer` devolve. */
function janelaChamada(titulo) {
  const w = new BrowserWindow({ width: 300, height: 200, show: true, title: titulo });
  w.setTitle(titulo);
  void w.loadURL('data:text/html,' + encodeURIComponent(`<title>${titulo}</title><body>${titulo}`));
  return w;
}

app.on('window-all-closed', () => app.quit());

/**
 * §114.5 — **o cenário que fechou a lacuna de cobertura de B39.**
 *
 * Duas metades, e as duas eram descobertas:
 *
 * 1. **O fio.** `capture.authorize`/`capture.decision` levam `audio` desde a emenda de
 *    2026-09-03 (§15.7), e nada exercitava essa travessia. Aqui ela é feita contra o
 *    `utilityProcess` **do produto**, com `MessageChannelMain` de verdade: o núcleo não
 *    conhece a sessão e responde `allowed:false`, e o que se prova é que a pergunta chega
 *    com o som e a resposta volta com o campo — não que a sessão exista.
 * 2. **O handler honrar a decisão.** `atenderPedidoDeCaptura` é a função do PRODUTO
 *    (`dist/main/captura.js`), a mesma que o `setDisplayMediaRequestHandler` real chama.
 *    A mutação que fazia o main obedecer o renderer em vez do núcleo passava em typecheck,
 *    unidade e neste smoke — porque o corpo morava dentro de `main/index.ts`, onde nada o
 *    alcançava.
 *
 * A plataforma é injetada: sem isso, "o núcleo negou o som" e "esta máquina não tem
 * loopback" produzem a mesma captura muda, e o cenário não distinguiria um do outro.
 */
async function cenarioNucleo() {
  const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-captura-nucleo-'));
  const filho = utilityProcess.fork(UTILITY, [], {
    serviceName: 'smoke-captura-nucleo',
    env: { ...process.env, P2P_DATA_DIR: dados },
  });
  const ipcM = new MessageChannelMain();
  filho.postMessage({ kind: 'ipc-m-port' }, [ipcM.port2]);
  // O oráculo de keystore, como no smoke de voz: cifrar é do main de verdade, e aqui o que
  // se mede é a captura.
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

  /** A perna real de §15.7: pergunta ao núcleo e espera o `capture.decision`. */
  function perguntarAoNucleo(sessionId, kind, audio) {
    return new Promise((resolve) => {
      const prazo = setTimeout(() => resolve({ allowed: false, sourceTypes: [], audio: false }), 15_000);
      const ouvir = (e) => {
        const d = e.data;
        if (d?.a !== 'capture.decision' || d.sessionId !== sessionId) return;
        clearTimeout(prazo);
        ipcM.port1.off('message', ouvir);
        log(`NUCLEO_RESPONDEU=${JSON.stringify({ allowed: d.allowed, audio: d.audio, temCampo: 'audio' in d })}`);
        resolve({ allowed: d.allowed === true, sourceTypes: d.sourceTypes ?? [], audio: d.audio === true });
      };
      ipcM.port1.on('message', ouvir);
      filho.postMessage({ kind: 'capture.authorize', sessionId, captureKind: kind, captureAudio: audio });
    });
  }

  // Um respiro para o núcleo subir; ele responde mesmo sem runtime pronto (falha fechada).
  await new Promise((r) => setTimeout(r, 3_000));

  const fontes = await desktopCapturer.getSources({ types: ['screen'] });
  const base = {
    sessaoDeclarada: () => 's'.repeat(64),
    getSources: () => Promise.resolve(fontes),
    seletorDoSistema: () => false,
    plataforma: () => 'win32',
  };
  const atender = (declaracao, perguntar, plataforma = () => 'win32') =>
    new Promise((resolve) => {
      atenderPedidoDeCaptura(
        { ...base, plataforma, declaracao: () => declaracao, perguntarAoNucleo: perguntar },
        resolve,
      );
    });

  // (1) O fio, contra o núcleo de verdade.
  const doNucleo = await atender(
    { kind: 'screen', sourceId: fontes[0]?.id ?? null, audio: true, mode: 'share' },
    perguntarAoNucleo,
  );
  log(`NUCLEO_CONCEDEU=${JSON.stringify({ video: doNucleo.video !== undefined, audio: doNucleo.audio ?? null })}`);

  // (2) O handler honrando a decisão, com as três combinações que importam.
  const escolhida = fontes[0]?.id ?? null;
  const casos = [
    ['pediu-negou', { audio: true }, { allowed: true, audio: false }],
    ['pediu-concedeu', { audio: true }, { allowed: true, audio: true }],
    ['nao-pediu-concedeu', { audio: false }, { allowed: true, audio: true }],
  ];
  for (const [nome, decl, decisao] of casos) {
    const r = await atender({ kind: 'screen', sourceId: escolhida, audio: decl.audio, mode: 'share' }, () =>
      Promise.resolve({ ...decisao, sourceTypes: ['screen', 'window'] }),
    );
    log(`CASO_${nome}=${JSON.stringify({ video: r.video !== undefined, audio: r.audio ?? null })}`);
  }

  // (3) O Modo Música, que É som: ele só concede onde há loopback E com o áudio
  // concedido pelo núcleo. Sem um dos dois, nega nomeado — música muda não é música.
  const casosMusica = [
    // [nome, plataforma, decisao]
    ['musica-win32-concedida', 'win32', { allowed: true, sourceTypes: ['screen'], audio: true }],
    ['musica-linux-sem-loopback', 'linux', { allowed: true, sourceTypes: ['screen'], audio: true }],
    ['musica-win32-som-negado', 'win32', { allowed: true, sourceTypes: ['screen'], audio: false }],
  ];
  for (const [nome, plat, decisao] of casosMusica) {
    const r = await atender(
      { kind: 'screen', sourceId: null, audio: true, mode: 'music' },
      () => Promise.resolve(decisao),
      () => plat,
    );
    log(`CASO_${nome}=${JSON.stringify({ video: r.video !== undefined, audio: r.audio ?? null })}`);
  }

  filho.kill();
  fs.rmSync(dados, { recursive: true, force: true });
  app.exit(0);
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, p, cb) => cb(p === 'media'));

  if (CENARIO === 'nucleo') {
    await cenarioNucleo();
    return;
  }

  // Duas iscas nascidas ANTES do alvo: numa lista por ordem de criação, é uma delas que
  // cai em `fontes[0]` — o valor que o main devolvia para qualquer escolha da pessoa.
  const iscas = [janelaChamada('ISCA-PRIMEIRA'), janelaChamada('ISCA-SEGUNDA')];
  const alvo = janelaChamada('ALVO-CORRETO');

  const host = new BrowserWindow({ width: 400, height: 300, show: true, title: 'HOST-DO-SMOKE' });
  await host.loadFile(PAGINA);

  // Um respiro para o X registrar as janelas recém-mapeadas.
  await new Promise((r) => setTimeout(r, 1_500));

  const meuId = host.getMediaSourceId();
  // Só o cenário `janela` precisa de janelas; os outros dois exercitam a MESMA resolução
  // sobre telas, que qualquer display lista — inclusive um virtual, sem gerenciador.
  const tipo = CENARIO === 'janela' ? 'window' : 'screen';
  const brutas = await desktopCapturer.getSources({
    types: [tipo],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: tipo === 'window',
  });
  // O produto tira a própria janela da lista: transmiti-la é a sala de espelhos.
  const fontes = brutas.filter((f) => f.id !== meuId);

  log(`TIPO=${tipo}`);
  log(`FONTES=${fontes.map((f) => f.name).join('|')}`);
  log(`QUANTAS=${fontes.length}`);
  log(`PROPRIA_NA_LISTA=${brutas.some((f) => f.id === meuId)}`);
  log(`PROPRIA_FILTRADA=${!fontes.some((f) => f.id === meuId)}`);
  log(`COM_MINIATURA=${fontes.filter((f) => !f.thumbnail.isEmpty()).length}`);

  // A escolhida é a ÚLTIMA da lista sempre que houver mais de uma: é a posição que
  // `fontes[0]` erra. Com uma fonte só, a escolha coincide — e o cenário `inexistente`
  // é quem continua distinguindo as duas implementações.
  const escolhida = fontes[fontes.length - 1];
  if (escolhida === undefined) {
    log('SEM_FONTE');
    app.exit(0);
    return;
  }
  log(`ESCOLHIDA=${escolhida.name}`);
  log(`INDICE_DA_ESCOLHIDA=${fontes.length - 1}`);
  log(`PRIMEIRA=${fontes[0].name}`);

  // `inexistente` é a falha fechada: a janela fechou entre escolher e capturar.
  const declarado = CENARIO === 'inexistente' ? 'window:99999999:0' : escolhida.id;

  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    void desktopCapturer
      .getSources({ types: [tipo] })
      .then((vivas) => {
        // A MESMA função que o produto usa — não uma cópia dela.
        const f = resolverFonte(vivas, declarado);
        if (f === undefined) {
          log('CONCEDIDA=nenhuma');
          callback({});
          return;
        }
        log(`CONCEDIDA=${f.name}`);
        callback({ video: f });
      })
      .catch(() => callback({}));
  });

  const r = await host.webContents
    .executeJavaScript(
      `navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
         .then((s) => { const t = s.getVideoTracks()[0]; const l = t ? t.label : ''; s.getTracks().forEach((x) => x.stop()); return 'OK:' + l; })
         .catch((e) => 'ERRO:' + e.name)`,
      true,
    )
    .catch((e) => 'FALHOU:' + e.message);
  log(`CAPTURA=${r}`);

  for (const w of [...iscas, alvo, host]) w.destroy();
  app.exit(0);
});
