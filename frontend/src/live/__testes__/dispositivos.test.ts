/**
 * §75 — a preferência guardada checada contra o que existe agora.
 *
 * O caso que motivou: a §68 ligou `settings.setDevice` ao núcleo enquanto a lista ainda era
 * inventada, então há instalações com `microphoneId: "usb"` persistido no manifest — um id
 * que nunca existiu em máquina nenhuma. Quando a captura entrar, ler isso cru daria
 * `OverconstrainedError` num lugar onde a pessoa não fez nada errado.
 */
import { describe, expect, it } from "vitest";

import { escolhaValida } from "../dispositivos";

const OPCOES = [
  { value: "default", label: "Padrão do sistema" },
  { value: "abc123", label: "Microfone USB" },
];

describe("escolhaValida", () => {
  it("mantém a escolha quando o dispositivo ainda está na máquina", () => {
    expect(escolhaValida("abc123", OPCOES)).toBe("abc123");
  });

  it("cai para o padrão quando o id guardado sumiu (headset desconectado)", () => {
    expect(escolhaValida("xyz789", OPCOES)).toBe("default");
  });

  it("cai para o padrão nos ids que o mock persistiu no núcleo", () => {
    expect(escolhaValida("usb", OPCOES)).toBe("default");
    expect(escolhaValida("headset", OPCOES)).toBe("default");
  });

  it("sem dispositivo nenhum, não inventa escolha", () => {
    expect(escolhaValida("abc123", [])).toBe("default");
  });
});
