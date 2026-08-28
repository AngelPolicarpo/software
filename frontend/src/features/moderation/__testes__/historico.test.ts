// U-16 / §18.4 passo 5 — as duas decisões da tela de modo histórico que não são render:
// o que a frase afirma, e quanto tempo ela diz que resta.

import { describe, expect, it } from "vitest";
import { diasAte, tituloDoModoHistorico } from "../historico";

const DIA = 24 * 60 * 60 * 1000;

describe("U-16 — o cabeçalho nomeado (§18.4 passo 5)", () => {
  it("cada motivo tem a sua frase, e nenhuma delas afirma mais do que se sabe", () => {
    expect(tituloDoModoHistorico("banned", "Aula")).toBe("Você foi banido de Aula");
    expect(tituloDoModoHistorico("kicked", "Aula")).toBe("Você foi removido de Aula");
    expect(tituloDoModoHistorico("left", "Aula")).toBe("Você saiu de Aula");
  });

  it("U-17 — encerrada tem o texto obrigatório da delta, com a data", () => {
    const emJunho = new Date("2026-06-14T12:00:00Z").getTime();
    expect(tituloDoModoHistorico(undefined, "Aula", emJunho)).toMatch(
      /^Esta comunidade foi encerrada em /,
    );
    // A causa de remoção, quando existe, vence: quem foi banido de uma comunidade que
    // depois encerrou precisa ler o que aconteceu com ELE.
    expect(tituloDoModoHistorico("banned", "Aula", emJunho)).toBe("Você foi banido de Aula");
  });

  it("`unauthorized` não vira 'banido' — os pares recusaram, e não há auditoria a citar", () => {
    // §14.5: `E_NOT_AUTHORIZED_FOR_COMMUNITY` de todos os pares. Pode ser ban, pode ser
    // fork, pode ser o host tendo trocado de comunidade. Dizer "banido" seria inventar.
    expect(tituloDoModoHistorico("unauthorized", "Aula")).toBe(
      "Seu acesso a Aula foi encerrado",
    );
    expect(tituloDoModoHistorico(undefined, "Aula")).toBe("Seu acesso a Aula foi encerrado");
  });
});

describe("U-16 — o prazo da cópia local (§18.4 passo 6)", () => {
  const agora = 1_800_000_000_000;

  it("conta dias INTEIROS para cima: sobrando 6 h e meia, ainda é 'em 1 dia'", () => {
    // Arredondar para baixo diria "hoje" a quem ainda tem a tarde inteira.
    expect(diasAte(agora + 6.5 * 60 * 60 * 1000, agora)).toBe(1);
    expect(diasAte(agora + 7 * DIA, agora)).toBe(7);
  });

  it("prazo vencido é zero, nunca negativo — o purge é de outro dono e pode não ter rodado", () => {
    expect(diasAte(agora - 3 * DIA, agora)).toBe(0);
  });

  it("sem prazo declarado, não inventa um", () => {
    expect(diasAte(undefined, agora)).toBeNull();
  });
});
