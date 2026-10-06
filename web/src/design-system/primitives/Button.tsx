import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "default" | "compact";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
}

function joinClassNames(...names: Array<string | undefined>): string {
  return names.filter(Boolean).join(" ");
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "default",
    loading = false,
    loadingLabel,
    disabled = false,
    type = "button",
    className,
    children,
    "aria-label": accessibleName,
    ...buttonProps
  },
  ref,
) {
  return (
    <button
      {...buttonProps}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={loading && loadingLabel ? loadingLabel : accessibleName}
      data-variant={variant}
      data-size={size}
      className={joinClassNames(styles.button, className)}
    >
      <span className={styles.content}>{children}</span>
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "children"> {
  "aria-label": string;
  children: ReactNode;
}

export function IconButton({ className, children, ...props }: IconButtonProps) {
  return (
    <Button
      {...props}
      className={joinClassNames(styles.iconButton, className)}
      variant={props.variant ?? "quiet"}
      size={props.size ?? "default"}
    >
      {children}
    </Button>
  );
}
