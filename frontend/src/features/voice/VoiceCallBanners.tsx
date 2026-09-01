import { Button } from "../../components/ui/Button";
import { StatusBanner } from "../../components/ui/StatusBanner";
import { useVoiceStore } from "../../store/voiceStore";

/**
 * Os banners da chamada (§9, 2.3 · §11 B7) moram dentro da área de conteúdo,
 * e não colados no cabeçalho: é o mesmo lugar de onde o compartilhamento
 * anuncia "Reorganizando transmissão…" (§9, 2.4). Full-bleed sob o header,
 * eles não alinhavam com nada — a grade e o palco começam recuados — e liam
 * como parte do chrome em vez de estado da chamada.
 */
export function VoiceCallBanners({
  /** Peer que não conecta comigo mas conecta com os outros (§11, B7). */
  unstableName,
}: {
  unstableName: string | null;
}) {
  const stage = useVoiceStore((state) => state.stage);
  const motivoDaFalha = useVoiceStore((state) => state.motivoDaFalha);
  const erroDeCamera = useVoiceStore((state) => state.erroDeCamera);
  // §15.5 `voice.deviceError`/`RT-10` — o problema de dispositivo que o NÚCLEO anunciou.
  const erroDeDispositivo = useVoiceStore((state) => state.erroDeDispositivo);
  const retryJoin = useVoiceStore((state) => state.retryJoin);

  return (
    <>
      {stage === "failed" && (
        <StatusBanner tone="failed" inset>
          {motivoDaFalha ?? "Não foi possível conectar à chamada de voz"}
          <Button
            variant="ghost"
            size="sm"
            className="ml-1 h-6 px-1.5"
            onClick={retryJoin}
          >
            Tentar novamente
          </Button>
        </StatusBanner>
      )}

      {/*
        §15.5 `voice.deviceError`/`RT-10` — a câmera que o sistema negou tem motivo, e ele
        muda o que fazer: autorizar, escolher outra, ou fechar o outro aplicativo. Uma
        frase genérica mandaria procurar defeito no lugar errado.
      */}
      {erroDeCamera !== null && (
        <StatusBanner tone="failed" inset>
          {erroDeCamera}
        </StatusBanner>
      )}

      {erroDeDispositivo !== null && (
        <StatusBanner tone="failed" inset>
          {erroDeDispositivo}
        </StatusBanner>
      )}

      {stage === "connected" && unstableName && (
        <StatusBanner tone="degraded" inset>
          Conexão instável com {unstableName}
        </StatusBanner>
      )}

      {/*
        Mesmo lugar e mesma linguagem dos outros dois estados da chamada. Solto como
        parágrafo, "Conectando…" era o único que não se parecia com um estado: sem
        ponto de cor, sem fundo, sem o movimento que §5.4 pede de transitório — lia
        como legenda perdida acima da grade, e não como a chamada dizendo em que pé
        está. `reconnecting` é o tom de "transitório e ativo", que é exatamente isto.
      */}
      {stage === "connecting" && (
        <StatusBanner tone="reconnecting" inset>
          Conectando…
        </StatusBanner>
      )}
    </>
  );
}
