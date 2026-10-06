import type { HTMLAttributes, ReactNode } from "react";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  title,
  description,
  action,
  className,
  ...regionProps
}: EmptyStateProps) {
  return (
    <div
      {...regionProps}
      className={[styles.emptyState, className].filter(Boolean).join(" ")}
    >
      <h2 className={styles.title}>{title}</h2>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
