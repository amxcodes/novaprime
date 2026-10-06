import type { HTMLAttributes } from "react";
import styles from "./Avatar.module.css";

export type AvatarSize = 24 | 32 | 40 | 48;

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  size?: AvatarSize;
  accessibleName?: string;
}

/** Geometric identity mark matching Orbit's avatar scale; it never implies profile-photo availability. */
export function Avatar({ size = 32, accessibleName, className, ...spanProps }: AvatarProps) {
  return (
    <span
      {...spanProps}
      className={[styles.avatar, className].filter(Boolean).join(" ")}
      data-size={size}
      role={accessibleName ? "img" : undefined}
      aria-label={accessibleName}
      aria-hidden={accessibleName ? undefined : true}
    >
      <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <circle cx="24" cy="16" r="8" />
        <path d="M8 42c.6-9.2 6.8-14 16-14s15.4 4.8 16 14H8Z" />
      </svg>
    </span>
  );
}
