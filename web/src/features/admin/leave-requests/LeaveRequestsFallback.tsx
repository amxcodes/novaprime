import type { ReactElement } from "react";
import { StateMessage } from "../../../design-system/primitives/StateMessage";
import styles from "./LeaveRequestsFallback.module.css";

export function LeaveRequestsFallback({ loading = false }: { loading?: boolean }): ReactElement {
  return (
    <section className={styles.section} aria-labelledby="admin-leave-review-load-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Availability</p>
        <h2 className={styles.title} id="admin-leave-review-load-title">Leave review</h2>
        <p className={styles.description}>Review pending requests in the scope provided by the server.</p>
      </header>
      {loading ? (
        <StateMessage kind="loading" title="Loading leave review controls">Preparing the authorized request queue.</StateMessage>
      ) : (
        <StateMessage kind="error" title="Leave request review could not load">Leave request review could not load. Reload Admin to try again.</StateMessage>
      )}
    </section>
  );
}

export function LeaveRequestsLoadFailureSection(): ReactElement {
  return <LeaveRequestsFallback />;
}
