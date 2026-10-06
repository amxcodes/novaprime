import { OperationsOverview } from "../../features/operations/OperationsOverview";
import type { OperationsOverviewProps } from "../../features/operations/contracts";
import { PageHeader } from "../../design-system";
import styles from "./OperationsPage.module.css";

export interface OperationsPageProps {
  overview: OperationsOverviewProps;
}

/** Route-level frame for Operations; report data and interactions stay feature/host-owned. */
export function OperationsPage({ overview }: OperationsPageProps) {
  return (
    <section className={styles.page} aria-label="Operations">
      <div className={styles.content}>
        <PageHeader
          className={styles.header}
          eyebrow="Operations"
          title="Operations"
          description="Scoped reports and tools are shown only when their source permissions allow them."
        />

        <p id="feedback" className={`notice ${styles.feedback}`} role="status" hidden />

        <OperationsOverview {...overview} />
      </div>
    </section>
  );
}
