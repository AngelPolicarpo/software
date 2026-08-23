import { cn } from "../../../src/lib/cn";

export interface SkeletonProps {
  className?: string;
}

/**
 * Skeleton loader (§6, §12) — sempre no formato do conteúdo real (linhas,
 * círculos de avatar), nunca um spinner genérico de tela cheia.
 */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      className={cn(
        "block animate-pulse rounded-sm bg-border-default",
        className,
      )}
      aria-hidden="true"
    />
  );
}
