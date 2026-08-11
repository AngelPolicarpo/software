import { cn } from "../../lib/cn";
import {
  AVATAR_BG_CLASS,
  PRESENCE_BG_CLASS,
  PRESENCE_LABEL,
  initialsFrom,
} from "../../lib/avatar";
import type { AvatarColor, PresenceStatus } from "../../domain/types";

/** §6 — P (24px) / M (32px) / G (80px, perfil). */
export type AvatarSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<AvatarSize, string> = {
  sm: "size-6 text-[10px]",
  md: "size-8 text-meta",
  lg: "size-20 text-heading-1",
};

const PRESENCE_SIZE_CLASS: Record<AvatarSize, string> = {
  sm: "size-2",
  md: "size-2.5",
  lg: "size-5",
};

const EMOJI_SIZE_CLASS: Record<AvatarSize, string> = {
  sm: "text-[13px]",
  md: "text-[17px]",
  lg: "text-[40px]",
};

export interface AvatarProps {
  /** Usado para gerar as iniciais quando não há emoji. */
  name: string;
  color: AvatarColor;
  size?: AvatarSize;
  /** Ícone de comunidade pode ser um emoji em vez de iniciais (§2). */
  emoji?: string;
  /** Camada opcional: dot de presença (§5.4, §6). */
  presence?: PresenceStatus;
  /**
   * Cor da superfície atrás do avatar — o dot recebe uma borda de 2px nela
   * para "recortar" do avatar (§5.4).
   */
  presenceRingClass?: string;
  /**
   * Camada opcional: fala ativa (§5.4). Diferenciável da presença por
   * *forma e movimento* (anel + waveform), nunca só por matiz.
   */
  speaking?: boolean;
  /** Avatar de pessoa é `radius-full`; ícone de comunidade, `radius-lg`. */
  shape?: "circle" | "squircle";
  className?: string;
}

export function Avatar({
  name,
  color,
  size = "md",
  emoji,
  presence,
  presenceRingClass = "border-surface-app",
  speaking = false,
  shape = "circle",
  className,
}: AvatarProps) {
  // Invisível é exibido como offline: dot vazado, sem preenchimento (§5.4).
  const isOfflineDot = presence === "offline" || presence === "invisible";

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn(
          "inline-flex select-none items-center justify-center font-semibold",
          "text-surface-app",
          SIZE_CLASS[size],
          AVATAR_BG_CLASS[color],
          shape === "circle" ? "rounded-full" : "rounded-lg",
        )}
        aria-hidden="true"
      >
        {emoji ? (
          <span className={EMOJI_SIZE_CLASS[size]}>{emoji}</span>
        ) : (
          initialsFrom(name)
        )}
      </span>

      {speaking && (
        <>
          <span
            className={cn(
              "pointer-events-none absolute -inset-0.5 border-2 border-presence-online",
              "animate-speaking-ring",
              shape === "circle" ? "rounded-full" : "rounded-lg",
            )}
            aria-hidden="true"
          />
          {/* Barras de waveform: a segunda pista de diferenciação exigida
              por §5.4 — forma + movimento, não só cor. */}
          <span
            className="pointer-events-none absolute -right-1 -bottom-1 flex items-end gap-px"
            aria-hidden="true"
          >
            {[0, 1, 2].map((bar) => (
              <span
                key={bar}
                className="w-0.5 animate-speaking-ring rounded-full bg-presence-online"
                style={{
                  height: [4, 7, 5][bar],
                  animationDelay: `${bar * 160}ms`,
                }}
              />
            ))}
          </span>
        </>
      )}

      {presence !== undefined && (
        <span
          className={cn(
            "absolute right-0 bottom-0 rounded-full border-2",
            PRESENCE_SIZE_CLASS[size],
            presenceRingClass,
            // Offline é dot vazado, sem preenchimento (§5.4).
            isOfflineDot
              ? "bg-surface-app ring-2 ring-presence-offline ring-inset"
              : PRESENCE_BG_CLASS[presence],
          )}
          role="img"
          aria-label={PRESENCE_LABEL[presence]}
        />
      )}
    </span>
  );
}
