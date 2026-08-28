import type { Community } from "../../domain/types";

/**
 * As duas decisões da tela de U-16 que não são render — separadas do componente porque são
 * o que o teste afirma, e porque o Fast Refresh só funciona num arquivo que só exporta
 * componentes.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Quantos dias INTEIROS faltam até o prazo de §18.4 passo 6.
 *
 * Para cima: sobrando seis horas, "em 1 dia" é verdade e "hoje" assusta quem ainda tem a
 * tarde toda. Nunca negativo — o `removed.purge` é de outro dono e pode não ter rodado, e
 * "em −3 dias" é a forma de dizer que o produto perdeu a conta.
 */
export function diasAte(retainUntil: number | undefined, agora: number): number | null {
  if (retainUntil === undefined) return null;
  return Math.max(0, Math.ceil((retainUntil - agora) / DIA_MS));
}

/**
 * A frase do cabeçalho. `unauthorized` é o caso a não estragar: §14.5 o produz quando
 * TODOS os pares recusam esta réplica, e isso pode ser ban, fork ou host que trocou de
 * comunidade. Dizer "banido" ali afirmaria mais do que se sabe.
 */
export function tituloDoModoHistorico(
  reason: Community["removedReason"],
  nome: string,
): string {
  switch (reason) {
    case "banned":
      return `Você foi banido de ${nome}`;
    case "kicked":
      return `Você foi removido de ${nome}`;
    case "left":
      return `Você saiu de ${nome}`;
    default:
      return `Seu acesso a ${nome} foi encerrado`;
  }
}
