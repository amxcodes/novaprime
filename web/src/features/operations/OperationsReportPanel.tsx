import type { ReactNode } from "react";
import { Button, SectionHeading, StateMessage } from "../../design-system";
import styles from "./OperationsOverview.module.css";

interface PanelProps {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function ReportPanel({ id, title, description, children, actions, className }: PanelProps) {
  return (
    <section className={[styles.panel, className].filter(Boolean).join(" ")} aria-labelledby={id}>
      <SectionHeading
        className={styles.panelHeading}
        title={<span id={id}>{title}</span>}
        description={description}
        actions={actions}
      />
      {children}
    </section>
  );
}

export function ReadFailure({
  read,
  title,
  onRetry,
}: {
  read: { status: "denied" | "error"; message: string };
  title: string;
  onRetry: () => void;
}) {
  return (
    <div className={styles.failure}>
      <StateMessage kind={read.status === "denied" ? "warning" : "error"} title={title}>
        {read.message}
      </StateMessage>
      {read.status === "error" ? <Button variant="secondary" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}

export function DisplayCell({ label, children }: { label: string; children: ReactNode }) {
  return <td data-label={label}>{children || "—"}</td>;
}
