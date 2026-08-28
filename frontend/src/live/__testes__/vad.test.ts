// Épico 4 — o VAD real: a histerese de `estaFalando` é a regra que decide quando o
// `voiceState {speaking}` sobe. O que se prova: ligar acima do threshold, desligar só
// ABAIXO dele (60%), e nunca piscar perto do limiar.

import { describe, expect, it } from "vitest";

import { estaFalando } from "../vad";

describe("estaFalando — histerese (Épico 4)", () => {
  it("começa a falar só acima do threshold", () => {
    expect(estaFalando(0.05, 0.1, false)).toBe(false);
    expect(estaFalando(0.11, 0.1, false)).toBe(true);
  });

  it("para de falar só abaixo de 60% do threshold — sem piscar perto do limiar", () => {
    // Falando: níveis entre 0.06 (60%) e 0.10 mantêm a fala; abaixo de 0.06 encerra.
    expect(estaFalando(0.09, 0.1, true)).toBe(true);
    expect(estaFalando(0.061, 0.1, true)).toBe(true);
    expect(estaFalando(0.059, 0.1, true)).toBe(false);
  });

  it("o threshold 0 é sensibilidade máxima: qualquer nível acima de zero fala", () => {
    expect(estaFalando(0.001, 0, false)).toBe(true);
    // E com a histerese em 0×0.6 = 0, só silêncio absoluto (0) encerra.
    expect(estaFalando(0, 0, true)).toBe(false);
  });
});
