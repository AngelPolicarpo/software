import { useEffect, useRef } from "react";
import { VideoOff } from "lucide-react";

import { Avatar } from "../../components/ui/Avatar";
import { cn } from "../../lib/cn";
import { cameraLocal, cameraRecebida } from "../../live/cameraStreams";
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
 * **Não há tile de tela.** §17.5 é estrela autorizada pelo host, §31.15 remove o host e não
 * menciona §17.5 — a decisão está em `acoesDeVideo`, e o que falta é **B68**. Um painel que
 * já reservasse o lugar da tela prometeria uma superfície que a norma não descreve.
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
  const videoSeq = useDmCallStore((s) => s.videoSeq);

  // Sem imagem de lado nenhum o painel não existe: uma chamada só de voz não precisa de duas
  // caixas pretas ocupando a conversa que a pessoa abriu para ler.
  if (!cameraLigada && !parComCamera) return null;

  return (
    <div className={cn("grid shrink-0 grid-cols-2 gap-2 border-b border-border-subtle p-2", className)}>
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
  );
}

interface DmVideoTileProps {
  rotulo: string;
  nome: string;
  ativo: boolean;
  avatarColor: number;
  espelhada?: boolean;
  obterStream: () => MediaStream | null;
  seq: number;
}

function DmVideoTile({
  rotulo,
  nome,
  ativo,
  avatarColor,
  espelhada = false,
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
          className={cn("size-full object-cover", espelhada && "-scale-x-100")}
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
