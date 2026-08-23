/**
 * Reconhecimento do `@` no composer.
 *
 * São as bordas que decidem se o painel de menção ajuda ou atrapalha: um endereço de e-mail
 * digitado no meio da frase não pode abrir a lista de pessoas, e uma menção não sobrevive ao
 * espaço que a encerra.
 */

import { describe, expect, it } from "vitest";
import { trechoDeMencao } from "../mencoes";

describe("trechoDeMencao", () => {
  it("abre no `@` do início da linha", () => {
    expect(trechoDeMencao("@an", 3)).toEqual({ inicio: 0, termo: "an" });
  });

  it("abre no `@` precedido de espaço", () => {
    expect(trechoDeMencao("olá @an", 7)).toEqual({ inicio: 4, termo: "an" });
  });

  it("abre vazio logo depois do `@` — a lista completa é o começo da escolha", () => {
    expect(trechoDeMencao("olá @", 5)).toEqual({ inicio: 4, termo: "" });
  });

  it("NÃO abre em `email@host`: `@` colado a caractere não é menção", () => {
    expect(trechoDeMencao("mande para ana@exemplo.org", 26)).toBeNull();
  });

  it("fecha ao passar o espaço", () => {
    expect(trechoDeMencao("@ana escreveu", 13)).toBeNull();
  });

  it("não atravessa quebra de linha", () => {
    expect(trechoDeMencao("@ana\nsegunda", 12)).toBeNull();
  });

  it("sem `@` não há menção", () => {
    expect(trechoDeMencao("texto comum", 11)).toBeNull();
  });

  it("usa o `@` mais recente antes do cursor, não o primeiro", () => {
    expect(trechoDeMencao("@ana e @bru", 11)).toEqual({ inicio: 7, termo: "bru" });
  });

  it("ignora o que está DEPOIS do cursor", () => {
    // O cursor no meio da palavra deve filtrar pelo que já foi digitado, não pelo resto.
    expect(trechoDeMencao("@ana", 2)).toEqual({ inicio: 0, termo: "a" });
  });
});
