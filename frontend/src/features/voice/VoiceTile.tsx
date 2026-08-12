import { HeadphoneOff, MicOff, MonitorUp, SignalLow, SignalZero, Video } from "lucide-react";
import { cn } from "../../lib/cn";
import { Avatar } from "../../components/ui/Avatar";
import { Skeleton } from "../../components/ui/Skeleton";
import { Tooltip } from "../../components/ui/Tooltip";
import { ROLE_TEXT_CLASS } from "../../lib/role";
import { findMember } from "../../mocks/dataset";
import { selectHighestRole, useCommunityStore } from "../../store/communityStore";
import type { VoiceParticipant } from "../../domain/types";

export interface VoiceTileProps {
  communityId: string;
  participant: VoiceParticipant;
  isLocal: boolean;
  /** Mobile e tira de miniaturas: linha compacta em vez de card (§9, 2.3). */
  compact?: boolean;
  onOpenProfile: (identityId: string, anchor: DOMRect) => void;
}

/**
 * Tile de participante de voz/vídeo (§6) — avatar + anel de fala + ícones de
 * estado sobrepostos no canto.
 *
 * O anel de fala vem do próprio `Avatar` (forma + movimento, §5.4), então
 * nunca colide com o dot de presença: são pistas visuais diferentes no mesmo
 * componente, como a spec exige por acessibilidade.
 */
export function VoiceTile({
  communityId,
  participant,
  isLocal,
  compact = false,
  onOpenProfile,
}: VoiceTileProps) {
  const member = findMember(communityId, participant.identityId);
  const role = useCommunityStore((state) =>
    selectHighestRole(state, member?.roleIds ?? []),
  );

  const name = member?.displayName ?? "Participante";
  const failed = participant.connectionToMe === "failed";
  const degraded = participant.connectionToMe === "degraded";
  // Conexão ruim derruba o vídeo antes da voz: o áudio tem prioridade
  // declarada (§9, 2.3.2), e o tile volta a mostrar o avatar.
  const video = participant.cameraOn && !failed && !degraded;

  const stateIcons = (
    <>
      {participant.muted && (
        <Tooltip label="Microfone desligado" side="top">
          <span className="grid size-6 place-items-center rounded-full bg-surface-app/80 text-text-secondary">
            <MicOff size={16} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Microfone desligado</span>
          </span>
        </Tooltip>
      )}
      {participant.deafened && (
        <Tooltip label="Áudio desligado" side="top">
          <span className="grid size-6 place-items-center rounded-full bg-surface-app/80 text-text-secondary">
            <HeadphoneOff size={16} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Áudio desligado</span>
          </span>
        </Tooltip>
      )}
      {participant.cameraOn && (
        <Tooltip label="Câmera ligada" side="top">
          <span className="grid size-6 place-items-center rounded-full bg-surface-app/80 text-text-secondary">
            <Video size={16} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Câmera ligada</span>
          </span>
        </Tooltip>
      )}
      {participant.sharingScreen && (
        <Tooltip label="Compartilhando a tela" side="top">
          <span className="grid size-6 place-items-center rounded-full bg-surface-app/80 text-accent-default">
            <MonitorUp size={16} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Compartilhando a tela</span>
          </span>
        </Tooltip>
      )}
      {/* §11, B7 passo 3 — falha pontual de mesh, só neste tile. */}
      {(failed || degraded) && (
        <Tooltip
          label={failed ? "Sem conexão com você" : "Conexão instável"}
          side="top"
        >
          <span
            className={cn(
              "grid size-6 place-items-center rounded-full bg-surface-app/80",
              failed ? "text-conn-failed" : "text-conn-degraded",
            )}
          >
            {failed ? (
              <SignalZero size={16} strokeWidth={2} aria-hidden="true" />
            ) : (
              <SignalLow size={16} strokeWidth={2} aria-hidden="true" />
            )}
            <span className="sr-only">
              {failed ? "Sem conexão com você" : "Conexão instável"}
            </span>
          </span>
        </Tooltip>
      )}
    </>
  );

  return (
    <li>
      <button
        type="button"
        onClick={(event) =>
          onOpenProfile(
            participant.identityId,
            event.currentTarget.getBoundingClientRect(),
          )
        }
        aria-label={`${name}${isLocal ? " (você)" : ""}`}
        className={cn(
          "group relative flex w-full items-center overflow-hidden rounded-md border",
          "transition-colors duration-(--duration-fast) ease-out",
          "bg-surface-sidebar hover:border-border-strong",
          failed ? "border-conn-failed/40" : "border-border-default",
          compact
            ? "h-14 shrink-0 gap-3 px-3"
            : "aspect-[4/3] flex-col justify-center gap-2 p-3",
        )}
      >
        {/*
          §9, 2.3.2 — câmera ligada troca o avatar pelo vídeo, mantendo o que
          já estava sobreposto. O mock não captura câmera de verdade (mesma
          postura de 2.4 para tela): a superfície é simulada, o suficiente
          para validar proporção, prioridade na grade e espelhamento.
        */}
        {video && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute inset-0 bg-surface-app",
              "bg-[radial-gradient(circle_at_30%_30%,var(--color-surface-elevated),var(--color-surface-app))]",
              "animate-camera-drift",
              // Você se vê espelhada; os outros te veem como você é.
              isLocal && "scale-x-[-1]",
            )}
          />
        )}

        <Avatar
          name={name}
          color={member?.avatarColor ?? "role-neutral"}
          size={compact ? "md" : "lg"}
          speaking={participant.speaking}
          className={cn(video && "relative")}
        />

        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <span
            className={cn(
              "max-w-full truncate text-body-emphasis",
              role ? ROLE_TEXT_CLASS[role.color] : "text-text-primary",
            )}
          >
            {name}
            {isLocal && (
              <span className="text-text-tertiary"> (você)</span>
            )}
          </span>
          {failed && (
            <span className="text-meta text-conn-failed">
              Sem conexão com você
            </span>
          )}
        </span>

        <span
          className={cn(
            "flex items-center gap-1",
            compact ? "ml-auto" : "absolute top-2 right-2",
          )}
        >
          {stateIcons}
        </span>
      </button>
    </li>
  );
}

/** §11, B7 passo 2 — tiles com skeleton enquanto o mesh se estabelece. */
export function VoiceTileSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <li
      className={cn(
        "flex items-center rounded-md border border-border-default bg-surface-sidebar",
        compact
          ? "h-14 shrink-0 gap-3 px-3"
          : "aspect-[4/3] flex-col justify-center gap-2 p-3",
      )}
    >
      <Skeleton className={compact ? "size-8 rounded-full" : "size-20 rounded-full"} />
      <Skeleton className="h-3 w-24" />
    </li>
  );
}
