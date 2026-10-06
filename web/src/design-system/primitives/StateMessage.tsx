import type { HTMLAttributes, ReactNode } from "react";
import styles from "./StateMessage.module.css";

export type StateMessageKind = "loading" | "info" | "success" | "warning" | "error";

export interface StateMessageProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  kind?: StateMessageKind;
  title?: ReactNode;
  children?: ReactNode;
}

export function StateMessage({
  kind = "info",
  title,
  children,
  className,
  ...messageProps
}: StateMessageProps) {
  const isError = kind === "error";
  const isLoading = kind === "loading";

  return (
    <div
      {...messageProps}
      className={[styles.message, className].filter(Boolean).join(" ")}
      data-kind={kind}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
      aria-busy={isLoading || undefined}
    >
      {isLoading ? <span className={styles.spinner} aria-hidden="true" /> : null}
      <span className={styles.copy}>
        {title ? <span className={styles.title}>{title}</span> : null}
        {children ? <span className={styles.description}>{children}</span> : null}
      </span>
    </div>
  );
}

export interface LoadingProps extends Omit<StateMessageProps, "kind" | "children"> {
  label?: ReactNode;
}

export function Loading({ label = "Loading", ...props }: LoadingProps) {
  return <StateMessage {...props} kind="loading">{label}</StateMessage>;
}
