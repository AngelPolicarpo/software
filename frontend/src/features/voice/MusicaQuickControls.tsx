import { Music } from "lucide-react";
import { Checkbox } from "../../components/ui/Checkbox";
import { Slider } from "../../components/ui/Slider";
import { useVoiceStore } from "../../store/voiceStore";

/**
 * §17.5 (US-03) — controles rápidos do Modo Música, só enquanto ativo: volume da
 * música e a escolha de mutar o microfone junto (US-02). O erro da ativação também
 * mora aqui: quem clicou precisa do porquê, no mesmo lugar do botão.
 */
export function MusicaQuickControls() {
  const musicaAtiva = useVoiceStore((state) => state.musicaAtiva);
  const musicaErro = useVoiceStore((state) => state.musicaErro);
  const musicaVolume = useVoiceStore((state) => state.musicaVolume);
  const musicaMutarMic = useVoiceStore((state) => state.musicaMutarMic);
  const definirMusicaVolume = useVoiceStore((state) => state.definirMusicaVolume);
  const definirMusicaMutarMic = useVoiceStore(
    (state) => state.definirMusicaMutarMic,
  );

  if (!musicaAtiva && musicaErro === null) return null;

  return (
    <div className="shrink-0 border-t border-border-subtle p-3">
      {musicaErro !== null ? (
        <p role="alert" className="text-meta text-feedback-danger">
          {musicaErro}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-meta text-text-secondary">
              <Music size={14} strokeWidth={2} aria-hidden="true" />
              Tocando música
            </span>
            <span className="flex-1" />
            <Checkbox
              checked={musicaMutarMic}
              onChange={definirMusicaMutarMic}
              label="Microfone mudo enquanto toca"
            />
          </div>
          <Slider
            label="Volume da música"
            value={musicaVolume}
            onChange={definirMusicaVolume}
            valueLabel={`${musicaVolume}%`}
          />
        </div>
      )}
    </div>
  );
}
