import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { Slider } from "../../components/ui/Slider";
import { Toggle } from "../../components/ui/Toggle";
import { SettingsSection } from "./SettingsLayout";
import { escolhaValida, useDispositivos } from "../../live/dispositivos";
import { motivoDoErroDeCamera } from "../../live/camera";
import { criarDetectorDeVoz } from "../../live/vad";
import { useSettingsStore } from "../../store/settingsStore";
import { useVoiceStore } from "../../store/voiceStore";

/**
 * §10, 3.1 — medidor de nível ao vivo enquanto o microfone é testado. O nível é REAL:
 * RMS da trilha capturada (Épico 4), não um número inventado — um medidor falso não mede
 * nada e ainda convence a pessoa de que o microfone funciona quando não funciona.
 */
function LevelMeter({ level }: { level: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(level * 100)));
  return (
    // `<meter>` nativo, e não `<div role="meter">`: a faixa e o valor saem dos atributos
    // do próprio elemento, então a leitura assistiva não depende de três `aria-*`
    // continuarem em dia com o `pct`.
    //
    // A objeção antiga era que `<meter>` não pinta os FILHOS — verdade, eles são fallback
    // para quem não suporta o elemento. Mas o preenchimento aqui não vem de filho nenhum:
    // vem do pseudo-elemento de agente de usuário, e o alvo é Chromium sozinho, porque o
    // produto é Electron. `::-webkit-meter-*` cobre 100% do v1, e os valores continuam
    // sendo os tokens da spec — o desenho é o mesmo pixel a pixel.
    //
    // A pintura vive em `index.css` (`.meter-nivel`): os pseudo-elementos do Chromium
    // trazem um `background-image` nativo que só o atalho `background` zera, e `bg-*` do
    // Tailwind emite `background-color` sozinho.
    <meter
      min={0}
      max={100}
      value={pct}
      aria-label="Nível de entrada do microfone"
      className="meter-nivel"
    />
  );
}

/**
 * §10, 3.1 — a prévia da câmera escolhida, ligada por um gesto e desligada ao sair.
 *
 * É o irmão do "Testar microfone", e faz duas coisas de uma vez: mostra o que a câmera está
 * vendo (a única forma honesta de responder "é esta mesmo?") e **destrava os nomes reais**
 * da lista — sem permissão de vídeo o Chromium devolve `label` vazio, e todas as câmeras da
 * máquina se chamam "Câmera 1", "Câmera 2".
 *
 * A trilha é parada ao fechar: uma tela de configuração não tem por que deixar a luz da
 * câmera acesa, e é a mesma postura de `autorizar` em `live/dispositivos.ts`.
 */
function PreviaDeCamera({ deviceId, onErro }: { deviceId: string; onErro: (m: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let vivo = true;
    let stream: MediaStream | null = null;
    const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (md === undefined) {
      onErro("Esta janela não tem acesso a dispositivos de mídia.");
      return;
    }
    void md
      .getUserMedia({ video: deviceId === "default" ? true : { deviceId: { exact: deviceId } } })
      .then((s) => {
        // Fechar a prévia enquanto a permissão ainda estava aberta: o stream chega depois do
        // desmonte, e sem isto a câmera ficaria ligada sem ninguém olhando.
        if (!vivo) {
          for (const t of s.getTracks()) t.stop();
          return;
        }
        stream = s;
        if (videoRef.current !== null) {
          videoRef.current.srcObject = s;
          void videoRef.current.play().catch(() => undefined);
        }
      })
      .catch((e: unknown) => {
        if (vivo) onErro(motivoDoErroDeCamera(e));
      });
    return () => {
      vivo = false;
      for (const t of stream?.getTracks() ?? []) t.stop();
    };
  }, [deviceId, onErro]);

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption -- prévia ao vivo da câmera local
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      aria-label="Prévia da câmera escolhida"
      // Espelhada, como em qualquer prévia da própria imagem: quem se olha espera um espelho.
      className="aspect-video w-full scale-x-[-1] rounded-md bg-black object-cover"
    />
  );
}

/**
 * §10, 3.1 — aba de dispositivos: entrada, saída, voz/música (Épico 4) e
 * vídeo. As permissões são pedidas no gesto que precisa delas, não ao abrir a
 * tela — é o que destrava os nomes reais nas listas.
 */
export function AccountDevicesTab() {
  const settings = useSettingsStore();
  const dispositivos = useDispositivos();
  const [testing, setTesting] = useState(false);
  const [nivelMic, setNivelMic] = useState(0);
  const [capturandoTecla, setCapturandoTecla] = useState(false);
  const [previa, setPrevia] = useState(false);
  const [erroDeCamera, setErroDeCamera] = useState<string | null>(null);
  const streamDeTeste = useRef<MediaStream | null>(null);
  const detector = useRef<ReturnType<typeof criarDetectorDeVoz> | null>(null);
  const nivelTimer = useRef<number | undefined>(undefined);

  // O teste REAL: captura o microfone e mede o RMS com o mesmo detector do VAD da
  // chamada. Sai daqui com a trilha parada — tela de configuração não deixa mic aberto.
  useEffect(
    () => () => {
      window.clearInterval(nivelTimer.current);
      detector.current?.encerrar();
      streamDeTeste.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function alternarTeste() {
    if (testing) {
      window.clearInterval(nivelTimer.current);
      detector.current?.encerrar();
      detector.current = null;
      streamDeTeste.current?.getTracks().forEach((t) => t.stop());
      streamDeTeste.current = null;
      setNivelMic(0);
      setTesting(false);
      return;
    }
    await dispositivos.autorizar("microphone");
    const md = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (md === undefined) return;
    const proc = useSettingsStore.getState().processamentoVoz;
    const stream = await md.getUserMedia({
      audio: {
        echoCancellation: proc,
        noiseSuppression: proc,
        autoGainControl: proc,
      },
    });
    streamDeTeste.current = stream;
    detector.current = criarDetectorDeVoz(stream);
    setTesting(true);
    nivelTimer.current = window.setInterval(() => {
      setNivelMic(detector.current?.nivel() ?? 0);
    }, 100);
  }

  // A captura da tecla do push-to-talk: enquanto ativa, a PRÓXIMA tecla vira o atalho
  // (Esc cancela). O ouvinte vive em useEffect — mutar textContent do botão fora do
  // React era briga perdida com a reconciliação.
  useEffect(() => {
    if (!capturandoTecla) return;
    const capturar = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setCapturandoTecla(false);
      if (e.key !== "Escape") useSettingsStore.getState().setPttTecla(e.key);
    };
    window.addEventListener("keydown", capturar, true);
    return () => window.removeEventListener("keydown", capturar, true);
  }, [capturandoTecla]);

  return (
<>
  <SettingsSection title="Entrada">
    <Select
      label="Microfone"
      value={escolhaValida(settings.microphoneId, dispositivos.microfones)}
      options={dispositivos.microfones}
      onChange={(id) => settings.setDevice("microphone", id)}
      {...(dispositivos.semRotulos("microphone")
        ? { hint: "Autorize o microfone para ver os nomes dos dispositivos." }
        : {})}
    />
    <Slider
      label="Volume de entrada"
      value={settings.inputVolume}
      onChange={(value) => settings.setVolume("input", value)}
      valueLabel={`${settings.inputVolume}%`}
    />
    <div className="flex items-center gap-3">
      {/*
        A permissão é pedida AQUI, não ao abrir a tela: testar o microfone é o
        gesto que precisa dele, e é o que destrava os nomes reais na lista.
      */}
      <Button variant="secondary" size="sm" onClick={() => void alternarTeste()}>
        {testing ? "Parar teste" : "Testar microfone"}
      </Button>
      <div className="flex-1">
        <LevelMeter level={nivelMic} />
      </div>
    </div>
  </SettingsSection>

  <SettingsSection title="Saída">
    <Select
      label="Saída de áudio"
      value={escolhaValida(settings.outputId, dispositivos.saidas)}
      options={dispositivos.saidas}
      onChange={(id) => settings.setDevice("output", id)}
    />
    <Slider
      label="Volume de saída"
      value={settings.outputVolume}
      onChange={(value) => settings.setVolume("output", value)}
      valueLabel={`${settings.outputVolume}%`}
    />
  </SettingsSection>

  {/* Épico 4 — voz, música e push-to-talk: preferências LOCAIS de captura.
      Nada disto atravessa o fio; vale para a próxima chamada (o teste de mic
      aplica na hora). */}
  <SettingsSection title="Voz e música">
    <Toggle
      checked={settings.processamentoVoz}
      onChange={(v) => settings.setProcessamentoVoz(v)}
      label="Processamento de voz (cancelamento de eco e ruído)"
      description="Deixa a conversa limpa, mas o AGC pode abafar a voz no meio da música. Quem canta com o Modo Música costuma desligar."
    />
    <Slider
      label="Sensibilidade da voz"
      value={settings.sensibilidadeVoz}
      onChange={(value) => settings.setSensibilidadeVoz(value)}
      valueLabel={`${settings.sensibilidadeVoz}%`}
    />
    <p className="text-meta text-text-tertiary">
      Quanto o microfone precisa ouvir para acender o anel de fala.
    </p>
    <Toggle
      checked={settings.pttAtivo}
      onChange={(v) => {
        settings.setPttAtivo(v);
        // PTT ligado começa mudo: o microfone só abre com a tecla pressionada.
        if (v) useVoiceStore.getState().aplicarPTT(false);
      }}
      label="Push-to-talk (aperte para falar)"
      description="Em vez de voz aberta, o microfone só fica ligado enquanto a tecla está pressionada."
    />
    {settings.pttAtivo && (
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setCapturandoTecla(true)}
        >
          {capturandoTecla ? "Aperte a tecla… (Esc cancela)" : "Trocar tecla"}
        </Button>
        <span className="text-body-emphasis text-text-primary">
          {settings.pttTecla}
        </span>
      </div>
    )}
  </SettingsSection>

  <SettingsSection title="Vídeo">
    <Select
      label="Câmera"
      value={escolhaValida(settings.cameraId, dispositivos.cameras)}
      options={dispositivos.cameras}
      onChange={(id) => {
        settings.setDevice("camera", id);
        // Trocar de câmera com a prévia aberta reabre a prévia na câmera nova;
        // o erro da anterior não vale mais para esta.
        setErroDeCamera(null);
      }}
      {...(dispositivos.semRotulos("camera")
        ? { hint: "Autorize a câmera para ver os nomes dos dispositivos." }
        : {})}
    />
    {/*
      A permissão é pedida AQUI, no gesto que precisa dela — mesma regra do
      microfone. É este botão que faz as câmeras terem nome na lista acima.
    */}
    <div className="flex items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setErroDeCamera(null);
          setPrevia((v) => !v);
          if (!previa) void dispositivos.autorizar("camera");
        }}
      >
        {previa ? "Parar prévia" : "Testar câmera"}
      </Button>
    </div>
    {previa && (
      <PreviaDeCamera
        deviceId={escolhaValida(settings.cameraId, dispositivos.cameras)}
        onErro={setErroDeCamera}
      />
    )}
    {erroDeCamera !== null && (
      <p className="text-meta text-feedback-danger">{erroDeCamera}</p>
    )}
  </SettingsSection>
</>
  );
}
