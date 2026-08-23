/**
 * A allowlist de esquema de §15.6.1 (T-18) e o escopo fechado do markdown.
 *
 * O caso que importa não é o negrito: é o `javascript:` que NÃO pode virar âncora. Conteúdo
 * de mensagem é texto escrito por outra pessoa, e transformá-lo em markup clicável é
 * exatamente o que a regra proíbe.
 */

import { describe, expect, it } from "vitest";
import { analisarMarkdown, esquemaPermitido, type No } from "../markdown";

const tipos = (nos: No[]): string[] => nos.map((n) => n.t);

describe("allowlist de esquema (§15.6.1, T-18)", () => {
  it("aceita exatamente http, https e mailto", () => {
    expect(esquemaPermitido("http://exemplo.org")).toBe(true);
    expect(esquemaPermitido("https://exemplo.org")).toBe(true);
    expect(esquemaPermitido("mailto:ana@exemplo.org")).toBe(true);
  });

  it("recusa javascript:, data:, file: e ftp:", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,<b>x", "file:///etc/passwd", "ftp://h/f"]) {
      expect(esquemaPermitido(href)).toBe(false);
    }
  });

  it("recusa o que o `URL` do runtime não analisa — normaliza, não lança", () => {
    expect(esquemaPermitido("://sem-esquema")).toBe(false);
    expect(esquemaPermitido("")).toBe(false);
  });

  it("um link de markdown com esquema fora da lista vira TEXTO, com o rótulo visível", () => {
    const nos = analisarMarkdown("veja [isto](javascript:alert(1))");
    expect(tipos(nos)).not.toContain("link");
    // Some seria pior: quem escreveu acharia que mandou algo que ninguém vê.
    expect(nos.map((n) => ("texto" in n ? n.texto : "")).join("")).toContain("isto");
  });

  it("um link de markdown http vira âncora com o href do parêntese", () => {
    const [, link] = analisarMarkdown("veja [isto](https://exemplo.org/a)");
    expect(link).toEqual({ t: "link", href: "https://exemplo.org/a", rotulo: "isto" });
  });

  it("URL solta vira âncora; esquema estranho solto fica texto", () => {
    expect(tipos(analisarMarkdown("olha https://exemplo.org"))).toEqual(["texto", "link"]);
    expect(tipos(analisarMarkdown("olha javascript://exemplo.org"))).toEqual(["texto", "texto"]);
  });

  it("mailto solto vira âncora", () => {
    expect(tipos(analisarMarkdown("escreva para mailto:ana@exemplo.org"))).toEqual(["texto", "link"]);
  });
});

describe("escopo fechado do markdown", () => {
  it("negrito, itálico e código inline", () => {
    expect(tipos(analisarMarkdown("**a** _b_ `c`"))).toEqual(["negrito", "texto", "italico", "texto", "codigo"]);
  });

  it("código inline vence: `**x**` dentro de crase é literal", () => {
    const [no] = analisarMarkdown("`**x**`");
    expect(no).toEqual({ t: "codigo", texto: "**x**" });
  });

  it("bloco de código sai inteiro, com o texto preservado", () => {
    const [no] = analisarMarkdown("```ts\nconst a = 1;\n```");
    expect(no).toEqual({ t: "bloco", texto: "const a = 1;\n" });
  });

  it("menção resolvida vira pill; texto sem menção conhecida fica texto", () => {
    expect(tipos(analisarMarkdown("oi @ana", ["@ana"]))).toEqual(["texto", "mencao"]);
    expect(tipos(analisarMarkdown("oi @ana", []))).toEqual(["texto"]);
  });

  it("HTML no conteúdo continua sendo texto — nunca vira markup", () => {
    const nos = analisarMarkdown("<img src=x onerror=alert(1)>");
    expect(tipos(nos)).toEqual(["texto"]);
  });

  it("análise de texto vazio não produz nó nenhum", () => {
    expect(analisarMarkdown("")).toEqual([]);
  });
});
