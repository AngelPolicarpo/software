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

/**
 * As transmissões em que ESTA máquina entrou, por `sessionId` → apresentador.
 *
 * Não é a lista de transmissões do canal (essa é do store, e `share.started` a entrega a
 * todos): é o subconjunto em que o **host aceitou** o meu `share.join`. Só a esses pares o
 * apresentador manda trilha de tela — a audiência de §17.5 é nominal —, e é por isso que
 * esta é a resposta certa para "a próxima trilha de vídeo deste par é a tela?" (§94.1).
 */
const assinadas = new Map<string, string>();

export function marcarAssistindo(sessionId: string, presenterHex: string): void {
  assinadas.set(sessionId, presenterHex.toLowerCase());
}

export function deixarDeAssistir(sessionId: string): void {
  assinadas.delete(sessionId);
}

/** Entrei em alguma transmissão viva deste par? */
export function assinouTelaDe(peerHex: string): boolean {
  const alvo = peerHex.toLowerCase();
  for (const p of assinadas.values()) if (p === alvo) return true;
  return false;
}

/**
 * O `msid` que já está ligado à tela daquele apresentador.
 *
 * Existe porque uma segunda trilha de vídeo do MESMO par pode ser a câmera (§17.2) ou a
 * continuação da tela: quando o `MediaStream` é o que já está ligado aqui, a dúvida não
 * existe. Ver §93.2 e a lacuna B41.
 */
export function idDaTelaDe(presenterHex: string): string | null {
  return recebidas.get(presenterHex.toLowerCase())?.id ?? null;
}

export function esquecerTelaRecebida(presenterHex: string): void {
  recebidas.delete(presenterHex.toLowerCase());
}

/** Fim de chamada: nada de tela sobrevive a ela. */
export function esquecerTodasAsTelas(): void {
  daMinhaCaptura = null;
  recebidas.clear();
  assinadas.clear();
}
