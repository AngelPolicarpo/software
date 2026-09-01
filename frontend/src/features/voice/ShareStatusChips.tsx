import { Star, Volume2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { Tooltip } from "../../components/ui/Tooltip";
import { useFindMember } from "../../store/communityStore";
import { useShareHealth, type ActiveShare, type ShareQuality } from "../../store/voiceStore";

/** §17.5 — os três perfis normativos. Não existe "auto": a degradação é do sistema. */
const QUALITY_LABEL: Record<ShareQuality, string> = {
  high: "Alta",
  balanced: "Equilibrada",
  low: "Baixa",
};

export interface ShareStatusChipsProps {
  communityId: string;
  share: ActiveShare;
  isPresenter: boolean;
  aoVivo: boolean;
  /** Classe da camada que some junto com o resto dos controles. */
  camada: string;
}

/**
 * O que a transmissão é, em cima da imagem (§17.5): topologia, espectadores,
 * fonte, som — e, só para quem apresenta, a saúde medida por espectador
 * (RT-08). Nada aqui é estimativa.
 */
export function ShareStatusChips({
  communityId,
  share,
  isPresenter,
  aoVivo,
  camada,
}: ShareStatusChipsProps) {
  const findMember = useFindMember();
  const saude = useShareHealth();

  return (
    <>
      <div className={cn("absolute top-2 left-2 flex flex-wrap items-center gap-1.5", camada)}>
        <span className="relative inline-flex items-center gap-1.5 rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-secondary">
          <Star size={16} strokeWidth={2} aria-hidden="true" />
          Transmissão direta
        </span>

        {/*
          §90 — o chip perdeu o denominador porque o teto deixou de existir. Continua
          dizendo QUANTOS assistem, que é a informação de que quem apresenta precisa;
          o "de 8" prometia uma vaga que ninguém mais conta.
        */}
        <Tooltip label="Quem está na chamada pode assistir" side="top">
          <span className="rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-secondary">
            {share.viewerCount}{" "}
            {share.viewerCount === 1 ? "espectador" : "espectadores"}
          </span>
        </Tooltip>

        {isPresenter && share.sourceLabel !== "" && (
          <span className="rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-tertiary">
            {share.sourceLabel}
          </span>
        )}

        {/*
          §17.5 — o som só é anunciado quando a captura o ENTREGOU. Pedir áudio e
          recebê-lo são coisas diferentes: onde a plataforma não separa o som da fonte, a
          transmissão sobe muda, e um selo dizendo o contrário mandaria a pessoa procurar
          defeito na conexão de quem assiste.
        */}
        {isPresenter && aoVivo && share.comAudio && (
          <Tooltip label="O som da fonte vai junto com a imagem" side="top">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-secondary">
              <Volume2 size={16} strokeWidth={2} aria-hidden="true" />
              Com áudio
            </span>
          </Tooltip>
        )}
      </div>

      {isPresenter && saude.length > 0 && (
        <div className={cn("absolute bottom-2 left-2 flex flex-col gap-1", camada)}>
          {saude.map((v) => (
            <span
              key={v.key}
              className="rounded-full border border-border-default bg-surface-app/80 px-2.5 py-1 text-meta text-text-secondary"
            >
              {findMember(communityId, v.key)?.displayName ?? v.key.slice(0, 8)} ·{" "}
              {/* Ainda não medido: "—" em vez de um zero que parece medida. */}
              {v.rttMs === undefined ? "—" : `${Math.round(v.rttMs)} ms`} ·{" "}
              {v.lossPct === undefined ? "—" : `${v.lossPct.toFixed(1)}%`} ·{" "}
              {QUALITY_LABEL[v.quality]}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
