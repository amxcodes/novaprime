import { PageHeader } from "../../design-system";
import styles from "./WorkSetupPage.module.css";

export interface WorkSetupPageProps {
  showTaskCatalog: boolean;
  showBillingPolicy: boolean;
}

/** Route-level work-setup heading and feature slots; reads and actions stay in the host. */
export function WorkSetupPage({ showTaskCatalog, showBillingPolicy }: WorkSetupPageProps) {
  return (
    <section className={styles.page} aria-labelledby="work-setup-page-title">
      <div className={styles.content}>
        <PageHeader
          className={styles.header}
          eyebrow="Work configuration"
          title={<span id="work-setup-page-title">Work setup</span>}
          description="Manage reusable task definitions and automatic workstream billing rules. Changes to billing policy apply to future tasks; existing task records keep their saved classification."
        />

        <p id="feedback" className={`notice ${styles.feedback}`} role="status" hidden />

        <div id="work-setup-content" className={styles.sections}>
          {showTaskCatalog ? (
            <div id="work-setup-catalog-root" className={styles.slot} data-work-setup-slot="catalog" />
          ) : null}
          {showBillingPolicy ? (
            <div id="work-setup-billing-root" className={styles.slot} data-work-setup-slot="billing-policy" />
          ) : null}
          {showTaskCatalog || showBillingPolicy ? (
            <p className={styles.loading} data-work-setup-loading role="status">Loading work setup.</p>
          ) : (
            <p className={styles.loading} data-work-setup-no-features role="status">
              Checking the work-setup features available to your current role.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
