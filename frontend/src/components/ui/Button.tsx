import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Spinner } from "./Spinner";

/** §6 — variantes obrigatórias do botão. */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "icon";

export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-accent-default text-text-on-accent",
    "hover:bg-accent-hover active:bg-accent-active",
  ),
  secondary: cn(
    "bg-surface-elevated text-text-primary border border-border-default",
    "hover:border-border-strong hover:bg-surface-elevated/80",
    "active:bg-surface-primary",
  ),
  ghost: cn(
    "bg-transparent text-text-secondary",
    "hover:bg-surface-elevated hover:text-text-primary",
    "active:bg-surface-primary",
  ),
  danger: cn(
    "bg-feedback-danger text-text-on-accent",
    "hover:brightness-110 active:brightness-95",
  ),
  icon: cn(
    "bg-transparent text-text-secondary",
    "hover:bg-surface-elevated hover:text-text-primary",
    "active:bg-surface-primary",
  ),
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-8 px-2 gap-1 text-body-emphasis rounded-md",
  md: "h-9 px-3 gap-2 text-body-emphasis rounded-md",
  lg: "h-11 px-4 gap-2 text-body-emphasis rounded-md",
};

const ICON_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "size-8 rounded-md",
  md: "size-9 rounded-md",
  lg: "size-11 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Spinner substitui o label sem mudar a largura do botão (§17). */
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  leadingIcon,
  trailingIcon,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const isInert = disabled === true || loading;

  return (
    <button
      type={type}
      disabled={isInert}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex items-center justify-center",
        // Rótulo nunca quebra linha: a altura do botão é fixa (h-8/h-9/h-11),
        // então uma segunda linha não cabe — ela transbordava por cima do
        // padding e o botão aparecia sem respiro nenhum, como no aviso de
        // saída do host, onde "Avisar quem está online" quebrava em duas.
        "whitespace-nowrap",
        "transition-colors duration-(--duration-fast) ease-out",
        "disabled:cursor-not-allowed disabled:text-text-disabled",
        // Desabilitado perde a cor de fundo semântica em vez de só esmaecer.
        "disabled:border-border-subtle disabled:bg-surface-elevated disabled:hover:bg-surface-elevated",
        variant === "icon" ? ICON_SIZE_CLASS[size] : SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center gap-2",
          loading && "invisible",
        )}
      >
        {leadingIcon}
        {children}
        {trailingIcon}
      </span>

      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </span>
      )}
    </button>
  );
}
