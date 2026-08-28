/**
 * §17.5 — a resolução da fonte de captura, isolada do resto do main.
 *
 * Mora num arquivo próprio por um motivo prático: `main/index.ts` roda `app.whenReady()` e
 * abre janela ao ser importado, então nada nele é exercitável fora de um app inteiro. Estas
 * duas decisões — **qual fonte** e **que áudio** — são justamente as que o smoke de captura
 * (`scripts/smoke-captura.mjs`) precisa exercitar contra o código de verdade, e não contra
 * uma cópia que pode divergir sem ninguém notar.
 */

export type TipoDeFonte = 'screen' | 'window';

/** O mínimo de `Electron.DesktopCapturerSource` que a escolha usa. */
export interface FonteCapturavel {
  readonly id: string;
  readonly name: string;
}

/**
 * A fonte que a captura deve usar, dada a lista VIVA e o id que o renderer declarou.
 *
 * `null` é "a primeira do tipo" — o caminho de quem chama sem passar pelo seletor, e o
 * único lugar onde `fontes[0]` continua sendo resposta legítima. Com um id declarado, é
 * ele ou nada: um id que não está na lista significa que aquela janela fechou entre a
 * escolha e a captura, e substituí-la pela primeira disponível transmitiria uma janela que
 * ninguém escolheu — o defeito de origem, só que mais tarde.
 */
export function resolverFonte<T extends FonteCapturavel>(
  fontes: readonly T[],
  sourceId: string | null,
): T | undefined {
  if (sourceId === null) return fontes[0];
  return fontes.find((f) => f.id === sourceId);
}

/**
 * O áudio da captura, e o que este produto tem permissão de prometer sobre ele.
 *
 * O Electron expõe **um** botão: `audio: 'loopback'`, documentado como "captura o áudio do
 * sistema, e só no Windows". Não existe nesta API um "áudio daquela janela" que o main
 * possa pedir — quem sabe separar por janela é o Chromium, e o pedido vai pelo lado do
 * renderer (`windowAudio: 'window'` + `systemAudio: 'exclude'` no `getDisplayMedia`, ver
 * `frontend/src/live/sincronizacao.ts`). O main concede a captura de áudio; o renderer é
 * quem diz de onde ela pode vir.
 *
 * Fora do Windows não há loopback nenhum: conceder ali entregaria uma sessão sem trilha de
 * áudio e uma UI dizendo que há som. Não conceder é o que deixa a tela dizer a verdade.
 */
export function audioDaCaptura(
  kind: TipoDeFonte,
  pedido: boolean,
  plataforma: NodeJS.Platform = process.platform,
): 'loopback' | undefined {
  if (!pedido) return undefined;
  if (plataforma !== 'win32') return undefined;
  void kind;
  return 'loopback';
}

/**
 * **Este sistema tem seletor de fonte próprio e OBRIGATÓRIO?**
 *
 * No Wayland, enumerar telas e janelas não é uma leitura: é um pedido de permissão. Quem
 * responde é o `xdg-desktop-portal`, e a resposta É a escolha da pessoa — a caixa que diz
 * "o app quer compartilhar sua tela". Não há como listar sem perguntar, e não há como
 * perguntar sem que a pessoa escolha ali.
 *
 * Isso torna o seletor do produto impossível de sustentar nesse caminho, e o defeito não
 * era cosmético: o seletor listava (portal #1), a pessoa escolhia na NOSSA lista, e o
 * handler relistava para validar (portal #2) — a caixa do sistema aparecia duas vezes, e o
 * `id` da primeira sessão do portal não existia na segunda, então `resolverFonte` recusava
 * e a captura **nunca** subia no Wayland.
 *
 * O sinal é o ambiente, e é o que a plataforma dá: `WAYLAND_DISPLAY` (ou `XDG_SESSION_TYPE`)
 * é o que distingue "o portal manda aqui" de X11, onde `getSources` continua sendo leitura
 * e o seletor do produto continua sendo a única escolha real que existe.
 */
export function seletorDoSistema(
  plataforma: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (plataforma !== 'linux') return false;
  // `XDG_SESSION_TYPE` é a declaração da própria sessão e tem a última palavra nos dois
  // sentidos: `x11` explícito vence um `WAYLAND_DISPLAY` que ficou no ambiente (um
  // compositor rodando ao lado, ou um `xvfb-run` que herdou o env do shell), e é o que
  // impede o seletor do produto de sumir de uma sessão X11 onde ele funciona.
  const tipo = env['XDG_SESSION_TYPE'];
  if (tipo === 'wayland') return true;
  if (tipo === 'x11') return false;
  // Sem declaração — o caso do WSLg, que não a define — sobra o socket do compositor.
  return (env['WAYLAND_DISPLAY'] ?? '') !== '';
}

/**
 * O que ESTA plataforma faz com captura — as duas perguntas que o seletor precisa responder
 * antes de desenhar qualquer coisa: se há áudio para oferecer, e de quem é a escolha da
 * fonte. As duas viajam juntas porque são feitas no mesmo instante (a abertura do seletor)
 * e um segundo round-trip por um booleano seria pior.
 */
export function suporteDeCaptura(
  plataforma: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): {
  screen: boolean;
  window: boolean;
  platform: string;
  systemPicker: boolean;
} {
  return {
    screen: audioDaCaptura('screen', true, plataforma) !== undefined,
    window: audioDaCaptura('window', true, plataforma) !== undefined,
    platform: plataforma,
    systemPicker: seletorDoSistema(plataforma, env),
  };
}
