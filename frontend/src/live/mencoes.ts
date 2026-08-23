/**
 * Reconhecimento do `@` no composer.
 *
 * Fica separado da tela porque é a única parte com regra própria: o que conta como menção em
 * curso e o que não conta. Uma menção não atravessa espaço, e um `@` colado a outro caractere
 * (`email@host`) não abre menção nenhuma — senão todo endereço digitado viraria um painel.
 *
 * Aqui não se decide o que É uma menção no domínio: isso é do `fold`, ao interpretar a op. O
 * que a UI monta é a lista de chaves escolhidas, e o texto continua sendo só texto.
 */

/** O `@` corrente: texto entre um `@` no fim da linha e o cursor. */
export function trechoDeMencao(texto: string, cursor: number): { inicio: number; termo: string } | null {
  const antes = texto.slice(0, cursor);
  const at = antes.lastIndexOf("@");
  if (at === -1) return null;
  const termo = antes.slice(at + 1);
  // Menção não atravessa espaço nem quebra de linha; e `a@b` não abre menção.
  if (/\s/.test(termo) || (at > 0 && !/\s/.test(antes[at - 1]!))) return null;
  return { inicio: at, termo };
}
