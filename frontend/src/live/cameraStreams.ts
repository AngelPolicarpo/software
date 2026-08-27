/**
 * Os `MediaStream` de câmera vivos, fora da árvore do React — irmão de `telaStreams.ts` e do
 * mapa de `<audio>` de `sincronizacao.ts`, e pela mesma razão.
 *
 * Um `MediaStream` não é estado de UI: ele não serializa, não compara e não sobrevive a ser
 * recriado. Guardá-lo no `voiceStore` faria cada render tocar em `srcObject` e a imagem
 * piscaria; guardá-lo em `useState` o perderia na primeira remontagem do tile. O store
 * guarda **quem** está com a câmera ligada; o pixel mora aqui.
 *
 * Separado de `telaStreams` porque as duas coisas têm ciclos de vida diferentes: a tela é
 * uma sessão do host (§17.5), a câmera é um dispositivo desta máquina (§17.2). Um mapa só,
 * indexado por par, não saberia dizer qual das duas apagar quando uma acabasse.
 */

/** A câmera que ESTA máquina captura e envia. */
let daMinhaCaptura: MediaStream | null = null;

/** Câmeras recebidas, por chave de quem transmite. */
const recebidas = new Map<string, MediaStream>();

export function guardarCameraLocal(stream: MediaStream | null): void {
  daMinhaCaptura = stream;
}

export function cameraLocal(): MediaStream | null {
  return daMinhaCaptura;
}

export function guardarCameraRecebida(peerHex: string, stream: MediaStream): void {
  recebidas.set(peerHex.toLowerCase(), stream);
}

export function cameraRecebida(peerHex: string): MediaStream | null {
  return recebidas.get(peerHex.toLowerCase()) ?? null;
}

/** O `msid` que já está ligado à câmera daquele par — a metade "já decidida" de §93.2. */
export function idDaCameraDe(peerHex: string): string | null {
  return recebidas.get(peerHex.toLowerCase())?.id ?? null;
}

export function esquecerCameraRecebida(peerHex: string): void {
  recebidas.delete(peerHex.toLowerCase());
}

/** Fim de chamada: nenhuma câmera sobrevive a ela. */
export function esquecerTodasAsCameras(): void {
  daMinhaCaptura = null;
  recebidas.clear();
}
