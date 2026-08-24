/** Escapa um literal para uso dentro de `RegExp` — nomes de menção têm ponto,
 *  parêntese e afins, e um deles viraria metacaractere por acidente. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
