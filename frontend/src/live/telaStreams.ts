/**
 * Os `MediaStream` de tela vivos, fora da árvore do React — irmão do mapa de `<audio>` que
 * `live/sincronizacao.ts` mantém para a voz, e pela mesma razão.
 *
 * Um `MediaStream` não é estado de UI: ele não serializa, não compara e não sobrevive a ser
 * recriado. Guardá-lo no `voiceStore` faria cada render tocar em `srcObject` e a imagem
 * piscaria; guardá-lo em `useState` o perderia na primeira remontagem do tile. O store
 * guarda **quem** apresenta e **como** vai a transmissão; o pixel mora aqui.
 */

/** A tela que ESTA máquina captura e envia (§17.5, papel apresentador). */
let daMinhaCaptura: MediaStream | null = null;

/** Telas recebidas, por chave de quem apresenta. */
const recebidas = new Map<string, MediaStream>();

export function guardarTelaDoApresentador(stream: MediaStream | null): void {
  daMinhaCaptura = stream;
}

export function telaDoApresentador(): MediaStream | null {
  return daMinhaCaptura;
}

export function guardarTelaRecebida(presenterHex: string, stream: MediaStream): void {
  recebidas.set(presenterHex.toLowerCase(), stream);
}

export function telaRecebida(presenterHex: string): MediaStream | null {
  return recebidas.get(presenterHex.toLowerCase()) ?? null;
}

export function esquecerTelaRecebida(presenterHex: string): void {
  recebidas.delete(presenterHex.toLowerCase());
}

/** Fim de chamada: nada de tela sobrevive a ela. */
export function esquecerTodasAsTelas(): void {
  daMinhaCaptura = null;
  recebidas.clear();
}
