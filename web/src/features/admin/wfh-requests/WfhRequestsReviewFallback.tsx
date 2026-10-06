import type { ReactElement } from "react";
import { StateMessage } from "../../../design-system/primitives/StateMessage";
import styles from "./WfhRequestsReviewFallback.module.css";

export function WfhRequestsReviewFallback({ loading = false }: { loading?: boolean }): ReactElement {
  return (
    <section className={styles.section} aria-labelledby="admin-wfh-review-load-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Availability</p>
        <h2 className={styles.title} id="admin-wfh-review-load-title">WFH request review</h2>
        <p className={styles.description}>Review work-from-home requests in the scope provided by the server.</p>
      </header>
      {loading ? (
        <StateMessage kind="loading" title="Loading WFH review controls">Preparing the authorized request queue.</StateMessage>
      ) : (
        <StateMessage kind="error" title="WFH request review could not load">WFH request review could not load. Reload Admin to try again.</StateMessage>
      )}
    </section>
  );
}

export function WfhRequestsReviewLoadFailureSection(): ReactElement {
  return <WfhRequestsReviewFallback />;
}
