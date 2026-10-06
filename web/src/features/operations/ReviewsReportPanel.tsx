import { EmptyState } from "../../design-system";
import { ReadFailure, ReportPanel } from "./OperationsReportPanel";
import styles from "./OperationsOverview.module.css";
import type { OperationsReadState } from "./contracts";

export function ReviewsReportPanel({
  read,
  onRetry,
}: {
  read: OperationsReadState<ReadonlyArray<unknown>>;
  onRetry: () => void;
}) {
  return (
    <ReportPanel
      id="operations-reviews-title"
      title="Pending reviews"
      description="A read-only summary of records returned by the current reviewer-scoped queue."
      className={styles.halfPanel}
    >
      {read.status !== "ready" ? <ReadFailure read={read} title="Review summary unavailable" onRetry={onRetry} /> : (
        <>
          <p className={styles.rangeNote} role="status">
            {read.data.length} review record{read.data.length === 1 ? "" : "s"} returned by this queue read; this is not an organization-wide total.
          </p>
          {!read.data.length ? <EmptyState title="No pending reviews were returned for your scope" /> : null}
        </>
      )}
    </ReportPanel>
  );
}
