/**
 * O catálogo de §6.4.2 é constante de protocolo.
 *
 * O teste que importa não é "o azul é azul": é que o **número** de cada cor não pode mudar,
 * porque ele viaja em material assinado. Reordenar o catálogo mudaria a cor de todo cargo já
 * gravado em todo log — e este arquivo é o que faz esse erro doer aqui em vez de lá.
 */

import { describe, expect, it } from "vitest";
import { CATALOGO, CORES_DE_CARGO, numeroDaCor, tokenDaCor, varDeCor } from "../../ipc/cores";

describe("catálogo de cores (§6.4.2)", () => {
  it("os oito números são exatamente os da tabela normativa", () => {
    expect([...CATALOGO]).toEqual([
      "role-gold",
      "role-blue",
      "role-green",
      "role-red",
      "role-purple",
      "role-pink",
      "role-neutral",
      "accent",
    ]);
  });

  it("cargo vai só até 6: `accent` não é atribuível a cargo", () => {
    expect(CORES_DE_CARGO).toHaveLength(7);
    expect(CORES_DE_CARGO).not.toContain("accent");
    expect(numeroDaCor("accent")).toBe(7);
  });

  it("token → número e volta", () => {
    for (const [i, token] of CATALOGO.entries()) {
      expect(numeroDaCor(token)).toBe(i);
      expect(tokenDaCor(i)).toBe(token);
    }
  });

  it("aceita a string de número que `UserRef.avatarColor` traz do fio", () => {
    expect(tokenDaCor("3")).toBe("role-red");
    expect(tokenDaCor(3)).toBe("role-red");
  });

  it("fora da faixa é `null`, não uma cor inventada", () => {
    for (const bruto of [8, -1, 1.5, "role-red", "", null, undefined, {}]) {
      expect(tokenDaCor(bruto)).toBeNull();
    }
    expect(numeroDaCor("azul-que-nao-existe")).toBeNull();
  });

  it("`varDeCor` cai num fallback NOMEADO, nunca numa variável inexistente", () => {
    expect(varDeCor(1)).toBe("var(--color-role-blue)");
    expect(varDeCor(99)).toBe("var(--color-role-neutral)");
    expect(varDeCor(99, "accent")).toBe("var(--color-accent)");
  });
});
