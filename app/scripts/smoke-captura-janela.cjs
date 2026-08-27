/**
 * A janela do smoke de captura (§17.5) — exercita a resolução REAL de fonte
 * (`dist/main/captura.js`) dentro de um `setDisplayMediaRequestHandler` de verdade.
 * Rodado por `smoke-captura.mjs`, nunca à mão.
 *
 * A página é `file://` de propósito: `data:` não é contexto seguro, e sem contexto seguro
 * `navigator.mediaDevices` nem existe — a captura falharia por um motivo que não é o que
 * este smoke mede.
 */
const { app, BrowserWindow, desktopCapturer, session } = require('electron');
const path = require('node:path');
const { resolverFonte } = require(path.join(__dirname, '../dist/main/captura.js'));

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

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, p, cb) => cb(p === 'media'));

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
