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

/** As plataformas onde há áudio de captura para pedir, por tipo de fonte (§17.5). */
export function suporteDeAudio(plataforma: NodeJS.Platform = process.platform): {
  screen: boolean;
  window: boolean;
  platform: string;
} {
  return {
    screen: audioDaCaptura('screen', true, plataforma) !== undefined,
    window: audioDaCaptura('window', true, plataforma) !== undefined,
    platform: plataforma,
  };
}
