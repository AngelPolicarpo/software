/**
 * **U-34** — a chave pública de identidade é um **endereço**, e os textos que a acompanham
 * são normativos.
 *
 * Eles moram aqui, e não dentro do `AccountIdentityTab`, pela mesma razão de `dmRegras.ts`
 * (§107.1): U-34 é sobretudo uma **distinção de texto**, e distinção só é verificável se
 * houver função ou constante a chamar. O texto anterior — "Esta chave existe só neste
 * dispositivo. Ninguém, em lugar nenhum, tem uma cópia dela." — estava colado sob a chave
 * **pública**, e lia como "não compartilhe": o oposto do que §31.8 exige de quem quer receber
 * uma conversa direta.
 */

/**
 * O que a chave **pública** é, e por que entregá-la é o uso normal.
 *
 * **L-24**: ela é o nó na DHT. Não há diretório, não há busca, e §31.8 recusou o rendezvous
 * derivado de segredo compartilhado — quem quiser falar com você pela primeira vez precisa
 * destes 64 caracteres, obtidos por fora do produto.
 */
export const TEXTO_CHAVE_PUBLICA =
  "Este é o seu endereço. Entregue-o a quem você quiser que possa iniciar uma conversa " +
  "direta com você — não existe busca de pessoas, e é assim que alguém chega até você.";

/**
 * O que a chave **privada** é. É a frase que estava sob a pública, agora onde ela é verdade.
 *
 * A UI **não** oferece exibir, exportar ou copiar a chave privada, e U-34 declara isso: §3.2
 * item 5 não dá superfície para material de chave, e `identity.export` (U-01) é backup
 * cifrado, não exibição.
 */
export const TEXTO_CHAVE_PRIVADA =
  "A chave privada correspondente existe só neste dispositivo e nunca sai dele. " +
  "Ninguém, em lugar nenhum, tem uma cópia dela.";

/**
 * A chave pública para leitura na tela.
 *
 * **Inteira, e sem reformatar.** Agrupar em blocos ajudaria a conferir a olho, mas faria o
 * que se vê divergir do que se copia — e a chave é um valor a transportar, não um número a
 * ler em voz alta. Truncar é o que U-34 corrige: truncada ela não é fornecível, e sem
 * fornecê-la ninguém consegue abrir a primeira conversa com você (§31.16.1 `dm.open`).
 *
 * `null` enquanto a identidade não carregou — a tela não inventa placeholder para endereço.
 */
export function chaveParaExibir(publicKey: string | null | undefined): string | null {
  if (typeof publicKey !== "string") return null;
  const chave = publicKey.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(chave) ? chave : null;
}
