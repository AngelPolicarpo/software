/**
 * **U-34** — a chave pública é um endereço, e os textos que a acompanham são normativos.
 *
 * O que se afirma aqui é a **distinção** que a tela é obrigada a fazer. Ela é verificável
 * porque os textos são constantes e não JSX: a frase "existe só neste dispositivo" era
 * verdade da chave privada e estava colada sob a pública, onde lia como "não compartilhe" —
 * exatamente o oposto do que §31.8 exige de quem quer receber uma conversa direta.
 */

import { describe, expect, it } from "vitest";

import {
  TEXTO_CHAVE_PRIVADA,
  TEXTO_CHAVE_PUBLICA,
  chaveParaExibir,
} from "../chaveDeIdentidade";

const CHAVE = "ab".repeat(32);

describe("U-34 / L-24 — o texto da chave pública convida a entregá-la", () => {
  it("diz que é endereço e que não há busca: as duas metades de L-24", () => {
    expect(TEXTO_CHAVE_PUBLICA).toContain("seu endereço");
    expect(TEXTO_CHAVE_PUBLICA).toContain("não existe busca de pessoas");
  });

  it("NÃO desaconselha entregar a chave pública — um aviso ali deixaria a pessoa inalcançável", () => {
    // Trocar o texto por "não compartilhe esta chave com ninguém" derruba este caso, que é
    // o ponto: sem entregar a chave, ninguém consegue abrir a primeira conversa com você.
    for (const proibido of ["não compartilhe", "não divulgue", "mantenha em segredo", "cuidado ao"]) {
      expect(TEXTO_CHAVE_PUBLICA.toLowerCase()).not.toContain(proibido);
    }
  });

  it("a frase do dispositivo é da chave PRIVADA, e ela se nomeia", () => {
    expect(TEXTO_CHAVE_PRIVADA).toContain("chave privada");
    expect(TEXTO_CHAVE_PRIVADA).toContain("nunca sai dele");
    // A ambiguidade que U-34 corrige: a frase do dispositivo não pode estar no texto da
    // pública, que está por construção na DHT e no log de toda comunidade da pessoa.
    expect(TEXTO_CHAVE_PUBLICA).not.toContain("só neste dispositivo");
  });

  it("nenhum dos dois oferece exibir, exportar ou copiar a chave privada (§3.2 item 5)", () => {
    for (const texto of [TEXTO_CHAVE_PUBLICA, TEXTO_CHAVE_PRIVADA]) {
      for (const proibido of ["copie a chave privada", "exportar a chave privada", "veja a chave privada"]) {
        expect(texto.toLowerCase()).not.toContain(proibido);
      }
    }
  });
});

describe("U-34 — a chave vai INTEIRA e sem reformatar", () => {
  it("devolve os 64 caracteres, não uma versão truncada", () => {
    const exibida = chaveParaExibir(CHAVE);
    expect(exibida).toBe(CHAVE);
    expect(exibida).toHaveLength(64);
    // Truncar é o defeito que U-34 corrige: `a1b2c3d4…f9e2` não é fornecível.
    expect(exibida).not.toContain("…");
  });

  it("não agrupa nem insere separador: o que se vê é o que se copia", () => {
    expect(chaveParaExibir(CHAVE)).not.toMatch(/[\s-]/);
  });

  it("normaliza caixa e espaço de borda, porque o valor é o mesmo", () => {
    expect(chaveParaExibir(`  ${CHAVE.toUpperCase()} `)).toBe(CHAVE);
  });

  it("sem identidade carregada não inventa placeholder de endereço", () => {
    for (const ruim of [null, undefined, "", "abc", `${CHAVE}0`]) {
      expect(chaveParaExibir(ruim)).toBeNull();
    }
  });

  it("a chave exibida é aceita de volta pelo campo de nova conversa — as duas pontas casam", async () => {
    const { lerChaveDeIdentidade } = await import("../../dm/dmRegras");
    const exibida = chaveParaExibir(CHAVE);
    expect(exibida).not.toBeNull();
    // O ciclo que U-33 e U-34 fecham juntos: o que uma tela entrega, a outra aceita.
    expect(lerChaveDeIdentidade(exibida as string, { euHex: null, conversas: [] })).toEqual({
      ok: true,
      peerKey: CHAVE,
      jaExiste: null,
    });
  });
});
