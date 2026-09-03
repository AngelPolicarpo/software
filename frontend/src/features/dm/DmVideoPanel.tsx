import { useEffect, useRef } from "react";
import { VideoOff } from "lucide-react";

import { Avatar } from "../../components/ui/Avatar";
import { cn } from "../../lib/cn";
import { cameraLocal, cameraRecebida } from "../../live/cameraStreams";
import { telaDoApresentador, telaRecebida } from "../../live/telaStreams";
import { corDoPar, nomeComHandle } from "./dmRegras";
import { useDmCallStore } from "../../store/dmCallStore";
import type { DmPeerRef } from "../../ipc/dto";

/**
 * §17.2 — as duas imagens de uma chamada de dois.
 *
 * **Dois tiles, e nunca mais que dois.** Numa comunidade a grade de §9 (2.3) cresce com o
 * roster; aqui não há roster (§31.15) e não há terceiro possível, então a grade é fixa. Ela
 * também não tem tira de miniaturas nem seletor de quem está em foco: os dois são superfície
 * de uma chamada com mais de duas pessoas.
 *
 * **A tela, quando existe, ocupa o palco e as câmeras viram miniaturas.** §31.15 (emenda de
 * 2026-09-03) traz a tela para a DM sem sessão, sem espectadores e sem perfil de qualidade —
 * então não há aqui contador de audiência, seletor de perfil nem barra de saúde. O que a UI
 * mostra é o que existe: uma imagem grande e duas pequenas.
 *
 * O `MediaStream` mora fora do React (`live/cameraStreams`), como na comunidade: reatribuir
 * `srcObject` a cada render pisca a imagem, e um `useState` o perderia na remontagem. O que
 * atravessa o store é `videoSeq`, a ordem de ir buscá-lo de novo.
 */
export interface DmVideoPanelProps {
  peer: DmPeerRef;
  className?: string;
}

export function DmVideoPanel({ peer, className }: DmVideoPanelProps) {
  const cameraLigada = useDmCallStore((s) => s.cameraLigada);
  const parComCamera = useDmCallStore((s) => s.parComCamera);
  const telaLigada = useDmCallStore((s) => s.telaLigada);
  const parComTela = useDmCallStore((s) => s.parComTela);
  const videoSeq = useDmCallStore((s) => s.videoSeq);

  // Sem imagem de lado nenhum o painel não existe: uma chamada só de voz não precisa de
  // caixas pretas ocupando a conversa que a pessoa abriu para ler.
  if (!cameraLigada && !parComCamera && !telaLigada && !parComTela) return null;

  /*
   * Uma tela por vez no palco, e a do PAR ganha da minha: quem compartilha já vê a própria
   * tela na máquina, e ocupar o palco com ela esconderia a única imagem que a pessoa não tem
   * de outro jeito. Não há seletor de foco — ele é superfície de uma chamada com mais de
   * duas pessoas.
   */
  const palco = parComTela ? "par" : telaLigada ? "eu" : null;

  return (
    <div className={cn("shrink-0 border-b border-border-subtle p-2", className)}>
      {palco !== null && (
        <div className="mb-2">
          <DmVideoTile
            rotulo={palco === "par" ? `Tela de ${peer.displayName}` : "Sua tela"}
            ativo
            avatarColor={peer.avatarColor}
            nome={peer.displayName}
            obterStream={palco === "par" ? () => telaRecebida(peer.key) : telaDoApresentador}
            seq={videoSeq}
            // A tela vai INTEIRA: `object-contain`. Recortar para preencher esconderia
            // justamente as bordas, que é onde moram menus e barras de ferramentas.
            inteira
          />
        </div>
      )}
      <div className={cn("grid gap-2", palco === null ? "grid-cols-2" : "grid-cols-4")}>
      <DmVideoTile
        rotulo="Você"
        ativo={cameraLigada}
        avatarColor={peer.avatarColor}
        nome="Você"
        // A própria imagem vai espelhada e MUDA: espelhar é o que faz o gesto bater com o que
        // a pessoa vê, e o áudio do próprio microfone voltando seria eco.
        espelhada
        obterStream={cameraLocal}
        seq={videoSeq}
      />
      <DmVideoTile
        rotulo={nomeComHandle(peer)}
        ativo={parComCamera}
        avatarColor={peer.avatarColor}
        nome={peer.displayName}
        obterStream={() => cameraRecebida(peer.key)}
        seq={videoSeq}
      />
      </div>
    </div>
  );
}

interface DmVideoTileProps {
  rotulo: string;
  nome: string;
  ativo: boolean;
  avatarColor: number;
  espelhada?: boolean;
  /** Tela vai inteira (`contain`); câmera preenche (`cover`). */
  inteira?: boolean;
  obterStream: () => MediaStream | null;
  seq: number;
}

function DmVideoTile({
  rotulo,
  nome,
  ativo,
  avatarColor,
  espelhada = false,
  inteira = false,
  obterStream,
  seq,
}: DmVideoTileProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (!ativo) {
      // Soltar o `srcObject` é o que de fato para a decodificação; esconder por CSS
      // continuaria pintando quadro a quadro para ninguém.
      el.srcObject = null;
      return;
    }
    const stream = obterStream();
    if (stream === null) return;
    // Reatribuir o MESMO stream reinicia a decodificação e pisca a imagem.
    if (el.srcObject !== stream) el.srcObject = stream;
    void el.play().catch(() => undefined);
    // `obterStream` é recriada a cada render e não entra nas dependências de propósito: o
    // que diz "há stream novo" é `seq`, e incluí-la faria o efeito rodar a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, seq]);

  // Desmontar solta o stream, em efeito próprio: juntá-lo ao de cima faria a limpeza rodar a
  // cada troca de dependência, e um `srcObject` que vai a `null` e volta pisca a imagem.
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el !== null) el.srcObject = null;
    };
  }, []);

  return (
    <div className="relative aspect-video overflow-hidden rounded-md bg-surface-app">
      {ativo ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted
          className={cn(
            "size-full",
            inteira ? "object-contain" : "object-cover",
            espelhada && "-scale-x-100",
          )}
          aria-label={`Câmera de ${rotulo}`}
        />
      ) : (
        <div className="grid size-full place-items-center gap-1">
          <Avatar name={nome} color={corDoPar(avatarColor)} size="md" />
          <span className="flex items-center gap-1 text-meta text-text-tertiary">
            <VideoOff size={12} strokeWidth={2} aria-hidden="true" />
            Câmera desligada
          </span>
        </div>
      )}
      <span className="absolute bottom-1 left-1 max-w-[90%] truncate rounded bg-surface-app/80 px-1 text-meta text-text-secondary">
        {rotulo}
      </span>
    </div>
  );
}
