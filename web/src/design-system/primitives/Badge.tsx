import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Badge.module.css";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  children: ReactNode;
  showDot?: boolean;
}

export function Badge({
  tone = "neutral",
  showDot = false,
  className,
  children,
  ...spanProps
}: BadgeProps) {
  return (
    <span
      {...spanProps}
      className={[styles.badge, className].filter(Boolean).join(" ")}
      data-tone={tone}
    >
      {showDot ? <span className={styles.dot} aria-hidden="true" /> : null}
      <span>{children}</span>
    </span>
  );
}

/** A semantic alias for status text; status meaning is always stated in words. */
export const Status = Badge;
