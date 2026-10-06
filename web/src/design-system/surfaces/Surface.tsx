import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Surface.module.css";

export type SurfaceLevel = "plain" | "subtle" | "raised";
export type SurfaceElement = "div" | "section" | "aside";

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: SurfaceElement;
  level?: SurfaceLevel;
  children?: ReactNode;
}

/** A quiet grouping surface; use only when content needs a visible boundary. */
export function Surface({
  as: Element = "div",
  level = "plain",
  className,
  children,
  ...elementProps
}: SurfaceProps) {
  return (
    <Element
      {...elementProps}
      className={[styles.surface, className].filter(Boolean).join(" ")}
      data-level={level}
    >
      {children}
    </Element>
  );
}
