import type { HTMLAttributes, ReactNode } from "react";
import styles from "./ContentFrame.module.css";

export interface ContentFrameProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  width?: "standard" | "wide" | "full";
}

export function ContentFrame({
  children,
  width,
  className,
  ...mainProps
}: ContentFrameProps) {
  return (
    <main
      {...mainProps}
      className={[styles.frame, className].filter(Boolean).join(" ")}
      data-width={width}
      id={mainProps.id ?? "nova-main-content"}
      tabIndex={mainProps.tabIndex ?? -1}
    >
      <div className={styles.inner}>{children}</div>
    </main>
  );
}
