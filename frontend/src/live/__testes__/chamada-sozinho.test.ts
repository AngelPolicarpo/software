/**
 * §91 — entrar sozinho num canal de voz é um estado NORMAL e terminal.
 *
 * O que se afirma: quem entra primeiro na chamada sai de `connecting`, porque não há par
 * com quem conectar — é a mesma leitura que a malha já fazia ao **não** armar o prazo de
 * L-11 nesse caso (`live/voz.ts`). Antes disto, quem tirava de `connecting` era o par
 * conectando de verdade, e sem par a tela ficava em "Conectando…" para sempre, com o
 * próprio tile preso em esqueleto — quem entrava primeiro nunca se via na grade da chamada
 * em que já estava.
 *
 * Verificado por mutação: apagar a regra de `sozinho` em `aplicarRoster` derruba o primeiro
 * caso; trocar `participantes.length === 1` por `<= 1` derruba o do roster vazio, que é o
 * que protege o motivo preservado por `encerradaPeloHost`.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useVoiceStore } from "../../store/voiceStore";

const CANAL = {
  id: "ch-voz",
  communityId: "c1",
  name: "sala",
  type: "voice" as const,
  categoryId: "cat-1",
};

const EU = "eu";
const OUTRO = "outro";

function entrar(): void {
  useVoiceStore.getState().configurarVoz(null);
  useVoiceStore.getState().join(CANAL as never, EU);
}

describe("sozinho na chamada — a chamada está de pé, não 'conectando'", () => {
  beforeEach(() => {
    useVoiceStore.setState({ motivoDaFalha: null, channelId: null, stage: "connecting", participants: [] });
  });

  it("roster só comigo tira de `connecting`: não há par com quem conectar", () => {
    entrar();
    expect(useVoiceStore.getState().stage).toBe("connecting");

    useVoiceStore.getState().aplicarRoster([{ keyHex: EU }]);

    expect(useVoiceStore.getState().stage).toBe("connected");
  });

  it("com outra pessoa no roster, continua conectando até um par fechar", () => {
    entrar();
    useVoiceStore.getState().aplicarRoster([{ keyHex: EU }, { keyHex: OUTRO }]);
    // Há com quem conectar: a chamada só está de pé quando alguém conectar de verdade.
    expect(useVoiceStore.getState().stage).toBe("connecting");

    useVoiceStore.getState().aplicarEstadoDoPar(OUTRO, "ok");
    expect(useVoiceStore.getState().stage).toBe("connected");
  });

  it("ficar sozinho depois de uma falha apaga o motivo: não há mais com quem falhar", () => {
    entrar();
    useVoiceStore.getState().aplicarRoster([{ keyHex: EU }, { keyHex: OUTRO }]);
    useVoiceStore.getState().falhouAoConectar("Não foi possível estabelecer a conexão.");
    expect(useVoiceStore.getState().stage).toBe("failed");

    // O outro saiu. O banner com "Tentar novamente" ofereceria retentativa contra ninguém.
    useVoiceStore.getState().aplicarRoster([{ keyHex: EU }]);

    const s = useVoiceStore.getState();
    expect(s.stage).toBe("connected");
    expect(s.motivoDaFalha).toBeNull();
  });

  it("roster VAZIO não é 'sozinho': o motivo de um encerramento sobrevive", () => {
    entrar();
    useVoiceStore.getState().encerradaPeloHost("O canal desta chamada foi excluído.");

    // `encerradaPeloHost` já zerou os participantes; um roster vazio que chegue depois não
    // pode ressuscitar a chamada nem apagar o porquê — é o defeito que §86.9 fechou.
    useVoiceStore.getState().aplicarRoster([]);

    const s = useVoiceStore.getState();
    expect(s.stage).toBe("failed");
    expect(s.motivoDaFalha).toBe("O canal desta chamada foi excluído.");
  });
});
