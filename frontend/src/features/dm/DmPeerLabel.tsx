import { Avatar } from "../../components/ui/Avatar";
import { cn } from "../../lib/cn";
import { corDoPar } from "./dmRegras";
import type { AvatarSize } from "../../components/ui/Avatar";
import type { DmPeerRef } from "../../ipc/dto";

/**
 * O par, com o **`handle` sempre ao lado do nome** (U-33).
 *
 * §31.16.3 não declara `collision`, e não precisa: numa conversa de dois não há conjunto
 * em que colidir. O `handle` de §6.1 fica junto mesmo assim, porque a mitigação (a) de
 * **L-5** vale aqui mais forte — o nome de exibição é escolhido pelo próprio par, e o que
 * o amarra à chave que eu já tenho é o `handle`.
 */
export interface DmPeerLabelProps {
  peer: DmPeerRef;
  size?: AvatarSize;
  /** Uma linha só (lista) ou nome em cima e handle embaixo (cabeçalho). */
  layout?: "inline" | "stacked";
  className?: string;
}

export function DmPeerLabel({
  peer,
  size = "md",
  layout = "inline",
  className,
}: DmPeerLabelProps) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <Avatar name={peer.displayName} color={corDoPar(peer.avatarColor)} size={size} />
      <span className={cn("flex min-w-0", layout === "stacked" ? "flex-col" : "items-baseline gap-1.5")}>
        <span className="truncate text-body-emphasis text-text-primary">
          {peer.displayName}
        </span>
        <span className="truncate text-meta text-text-tertiary">{peer.handle}</span>
      </span>
    </span>
  );
}
