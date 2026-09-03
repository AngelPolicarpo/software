/**
 * §75 — a preferência guardada checada contra o que existe agora.
 *
 * O caso que motivou: a §68 ligou `settings.setDevice` ao núcleo enquanto a lista ainda era
 * inventada, então há instalações com `microphoneId: "usb"` persistido no manifest — um id
 * que nunca existiu em máquina nenhuma. Quando a captura entrar, ler isso cru daria
 * `OverconstrainedError` num lugar onde a pessoa não fez nada errado.
 */
import { describe, expect, it } from "vitest";

import { acharMonitorDeSistema, escolhaValida } from "../dispositivos";

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

describe("acharMonitorDeSistema — o playback onde não há loopback (§17.5)", () => {
  const entrada = (kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo =>
    ({ kind, deviceId, label, groupId: "" }) as MediaDeviceInfo;

  it("acha o monitor do PipeWire/PulseAudio pelo nome", () => {
    const lista = [
      entrada("audioinput", "mic1", "Microfone USB"),
      entrada("audioinput", "mon1", "Monitor of Áudio interno Estéreo analógico"),
    ];
    expect(acharMonitorDeSistema(lista)).toBe("mon1");
  });

  it("o nome casa sem importar a caixa", () => {
    expect(acharMonitorDeSistema([entrada("audioinput", "m", "MONITOR OF HDMI")])).toBe("m");
  });

  it("ignora o que não identifica fonte: default, id vazio e o que não é entrada", () => {
    const lista = [
      entrada("audioinput", "default", "Monitor do sistema"),
      entrada("audioinput", "", "Monitor fantasma"),
      entrada("audiooutput", "out1", "Monitor de saída"),
    ];
    expect(acharMonitorDeSistema(lista)).toBeNull();
  });

  it("sem rótulos (permissão ainda não pedida) não há o que casar", () => {
    expect(acharMonitorDeSistema([entrada("audioinput", "mon1", "")])).toBeNull();
  });

  it("sem monitor na máquina, não inventa fonte", () => {
    expect(acharMonitorDeSistema([entrada("audioinput", "mic1", "Microfone USB")])).toBeNull();
    expect(acharMonitorDeSistema([])).toBeNull();
  });
});
