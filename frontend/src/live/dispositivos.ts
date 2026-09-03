/**
 * Dispositivos de áudio e vídeo de verdade — §10, 3.1 ("Dispositivos").
 *
 * O que havia aqui antes era uma lista inventada (`MOCK_MICROPHONES` e irmãs) com nomes
 * fixos: "Blue Yeti", "Headset Bluetooth". A escolha era certa enquanto nada capturava —
 * pedir permissão de microfone para popular um select que não grava nada cobra um custo real
 * por uma tela falsa. Deixou de ser certa quando a §68 ligou `settings.setDevice` ao núcleo:
 * a partir dali a escolha era **persistida**, e o que se persistia era um id que não existe
 * em máquina nenhuma.
 *
 * Duas regras que valem a pena estar escritas:
 *
 * 1. **Enumerar não pede permissão; rotular pede.** Sem permissão o Chromium devolve as
 *    entradas com `label` vazio (e frequentemente uma só por tipo). Então a lista aparece
 *    desde o começo, com nome genérico, e os nomes reais chegam quando a pessoa autorizar —
 *    por um gesto dela, nunca por abrir a tela.
 * 2. **Preferência guardada que não existe mais não é escolha, é ruído.** Um id que sumiu
 *    (dispositivo desconectado, ou os `"usb"`/`"headset"` que o mock gravou no núcleo) cai
 *    para o padrão do sistema em vez de ficar apontando para o nada.
 */
import { useCallback, useEffect, useState } from "react";

export interface Dispositivo {
  value: string;
  label: string;
}

export type EstadoDeDispositivos =
  /** `navigator.mediaDevices` não existe — contexto sem permissão de mídia. */
  | "indisponivel"
  /** Enumerou, mas sem rótulos: falta a pessoa autorizar. */
  | "sem-rotulos"
  | "ok";

export interface Dispositivos {
  microfones: Dispositivo[];
  cameras: Dispositivo[];
  saidas: Dispositivo[];
  estado: EstadoDeDispositivos;
  /**
   * Falta autorizar ESTE tipo — e a pergunta é por tipo porque a permissão é por tipo.
   *
   * `estado` responde pela máquina inteira, e usá-lo nas duas dicas fazia a do microfone
   * continuar pedindo autorização depois de a pessoa já ter autorizado o microfone: bastava
   * a câmera seguir sem rótulo para o estado global continuar `sem-rotulos`.
   */
  semRotulos: (kind: "microphone" | "camera") => boolean;
  /** Pede a permissão pelo caminho normal do navegador e recarrega a lista com os nomes. */
  autorizar: (kind: "microphone" | "camera") => Promise<boolean>;
}

const PADRAO: Dispositivo = { value: "default", label: "Padrão do sistema" };

const NOME_GENERICO: Record<MediaDeviceKind, string> = {
  audioinput: "Microfone",
  videoinput: "Câmera",
  audiooutput: "Saída de áudio",
};

function agrupar(lista: MediaDeviceInfo[], kind: MediaDeviceKind): Dispositivo[] {
  const doTipo = lista.filter((d) => d.kind === kind);
  const mapeados = doTipo
    // `deviceId` vazio é a entrada-fantasma que o Chromium devolve sem permissão: ela não
    // identifica nada e escolher-la não teria efeito.
    .filter((d) => d.deviceId !== "" && d.deviceId !== "default")
    .map((d, i) => ({
      value: d.deviceId,
      label: d.label !== "" ? d.label : `${NOME_GENERICO[kind]} ${i + 1}`,
    }));
  return [PADRAO, ...mapeados];
}

/** Há dispositivo deste tipo esperando permissão para dizer o próprio nome. */
function faltaRotulo(lista: MediaDeviceInfo[], kind: MediaDeviceKind): boolean {
  return lista.some((d) => d.kind === kind && d.deviceId !== "" && d.label === "");
}

async function ler(): Promise<{ lista: MediaDeviceInfo[]; estado: EstadoDeDispositivos }> {
  if (typeof navigator === "undefined" || navigator.mediaDevices === undefined) {
    return { lista: [], estado: "indisponivel" };
  }
  try {
    const lista = await navigator.mediaDevices.enumerateDevices();
    // Um só rótulo vazio já significa "ainda não autorizado": o Chromium só preenche todos
    // depois da permissão, nunca alguns.
    const semRotulos = lista.some((d) => d.deviceId !== "" && d.label === "");
    return { lista, estado: semRotulos ? "sem-rotulos" : "ok" };
  } catch {
    return { lista: [], estado: "indisponivel" };
  }
}

export function useDispositivos(): Dispositivos {
  const [lista, setLista] = useState<MediaDeviceInfo[]>([]);
  const [estado, setEstado] = useState<EstadoDeDispositivos>("sem-rotulos");

  const recarregar = useCallback(async () => {
    const r = await ler();
    setLista(r.lista);
    setEstado(r.estado);
  }, []);

  useEffect(() => {
    void recarregar();
    const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (md === undefined) return;
    // Plugar um headset no meio da configuração precisa aparecer sem reabrir a tela.
    const aoMudar = (): void => void recarregar();
    md.addEventListener("devicechange", aoMudar);
    return () => md.removeEventListener("devicechange", aoMudar);
  }, [recarregar]);

  const autorizar = useCallback(
    async (kind: "microphone" | "camera") => {
      const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
      if (md === undefined) return false;
      try {
        const stream = await md.getUserMedia(kind === "microphone" ? { audio: true } : { video: true });
        // A permissão é o que se queria; o fluxo em si não — soltar já evita luz de câmera
        // acesa e microfone ocupado por uma tela de configuração.
        for (const t of stream.getTracks()) t.stop();
        await recarregar();
        return true;
      } catch {
        return false;
      }
    },
    [recarregar],
  );

  return {
    microfones: agrupar(lista, "audioinput"),
    cameras: agrupar(lista, "videoinput"),
    saidas: agrupar(lista, "audiooutput"),
    estado,
    semRotulos: (kind) => faltaRotulo(lista, kind === "microphone" ? "audioinput" : "videoinput"),
    autorizar,
  };
}

/**
 * A escolha guardada, checada contra o que existe agora. Devolve `default` quando o id
 * gravado não está mais na máquina — inclusive os `"usb"`/`"headset"` que o mock persistiu.
 */
export function escolhaValida(guardado: string, opcoes: Dispositivo[]): string {
  return opcoes.some((o) => o.value === guardado) ? guardado : PADRAO.value;
}

/**
 * §17.5 — o monitor de reprodução, para o Modo Música onde não há loopback.
 *
 * O `audio: 'loopback'` do Electron só existe no Windows. No Linux, o que entrega o
 * playback da máquina é a fonte de MONITOR do PulseAudio/PipeWire ("Monitor of ..."),
 * que o Chromium lista como `audioinput` comum e abre por `getUserMedia`. É o caminho
 * que faz o Modo Música existir fora do Windows sem seletor, portal nem captura de tela.
 *
 * Só o nome decide, e de propósito: não há id estável para "o monitor" — o `deviceId`
 * muda com o hardware e o `label` é o que o sistema diz que a fonte é. Sem rótulos
 * (permissão ainda não pedida) não há o que casar: devolve `null` e quem chama pede a
 * permissão pelo caminho normal antes de tentar de novo.
 */
export function acharMonitorDeSistema(lista: readonly MediaDeviceInfo[]): string | null {
  for (const d of lista) {
    if (d.kind !== "audioinput") continue;
    if (d.deviceId === "" || d.deviceId === "default") continue;
    if (/monitor/i.test(d.label)) return d.deviceId;
  }
  return null;
}
