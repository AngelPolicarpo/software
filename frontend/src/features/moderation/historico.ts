import type { Community } from "../../domain/types";

/**
 * As duas decisões da tela de U-16 que não são render — separadas do componente porque são
 * o que o teste afirma, e porque o Fast Refresh só funciona num arquivo que só exporta
 * componentes.
 *
 * **O nome não é `modoHistorico`**, e a diferença não é de gosto: `ModoHistorico.tsx` e
 * `modoHistorico.ts` diferem só em maiúsculas, e num filesystem que não distingue caso — o
 * do runner Windows do CI — o TypeScript os trata como o MESMO arquivo e recusa o programa
 * inteiro (`TS1261`). O repositório é multiplataforma por escopo declarado (§v1: Windows e
 * Linux), então dois arquivos irmãos nunca podem se distinguir só pela caixa.
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
  endedAt?: number,
): string {
  switch (reason) {
    case "banned":
      return `Você foi banido de ${nome}`;
    case "kicked":
      return `Você foi removido de ${nome}`;
    case "left":
      return `Você saiu de ${nome}`;
    case undefined:
      // U-17 — encerrada é a única causa que não é sobre MIM: ela vale para todo mundo, e
      // o texto obrigatório da delta é a data.
      return endedAt === undefined
        ? `Seu acesso a ${nome} foi encerrado`
        : `Esta comunidade foi encerrada em ${dataCurta(endedAt)}`;
    default:
      return `Seu acesso a ${nome} foi encerrado`;
  }
}

/** A data do texto obrigatório de U-17, no formato do resto do produto. */
export function dataCurta(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
