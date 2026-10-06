import { useLayoutEffect, useRef } from "react";
import { Button, EmptyState, StateMessage } from "../../design-system";
import { AvailabilityReportPanel } from "./AvailabilityReportPanel";
import { PeopleReportPanel } from "./PeopleReportPanel";
import { ReviewsReportPanel } from "./ReviewsReportPanel";
import { TaskReportPanel } from "./TaskReportPanel";
import styles from "./OperationsOverview.module.css";
import type { OperationsOverviewProps } from "./contracts";

function RecoverySlot({ node }: { node?: HTMLElement | null }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!node || !host.current) return;
    host.current.append(node);
    return () => node.remove();
  }, [node]);
  return node ? <div className={styles.recovery} ref={host} /> : null;
}

export function OperationsOverview(props: OperationsOverviewProps) {
  const hasReports = Boolean(props.people || props.tasks || props.reviews || props.availability || props.recoverySlot);
  return (
    <div className={styles.overview}>
      {props.fatalMessage ? (
        <div className={styles.fatal}>
          <StateMessage kind="error" title="Operations could not load">{props.fatalMessage}</StateMessage>
          <Button variant="secondary" onClick={props.onRetry}>Try again</Button>
        </div>
      ) : !hasReports ? (
        <EmptyState title="No Operations reports are available" description="Reports appear only when their source grants are available to your current role." />
      ) : (
        <div className={styles.reportGrid}>
          {props.people ? <PeopleReportPanel
            read={props.people}
            onViewHistory={props.onViewPersonHistory}
            historyHref={props.personHistoryHref}
            canExport={props.people.status === "ready"}
            onExport={props.onExportPeople}
            onSearch={props.onSearchPeople}
            onNext={props.onNextPeoplePage}
            onPrevious={props.onPreviousPeoplePage}
            onRetry={props.onRetry}
            onRetryPeople={props.onRetryPeople}
            onRetryPage={props.onRetryPeoplePage}
          /> : null}
          {props.tasks ? <TaskReportPanel
            read={props.tasks}
            taskHref={props.taskDetailHref}
            onOpenTask={props.onOpenTask}
            onNext={props.onNextTasksPage}
            onPrevious={props.onPreviousTasksPage}
            canExport={props.tasks.status === "ready"}
            onExport={props.onExportWork}
            onRetry={props.onRetry}
            onRetryPage={props.onRetryTasksPage}
          /> : null}
          {props.reviews ? <ReviewsReportPanel read={props.reviews} onRetry={props.onRetry} /> : null}
          {props.availability ? <AvailabilityReportPanel
            read={props.availability}
            sources={props.availabilitySources}
            canExport={props.availability.status === "ready"}
            onExport={props.onExportAvailability}
            onRetry={props.onRetry}
          /> : null}
          {props.recoverySlot ? <RecoverySlot node={props.recoverySlot} /> : null}
        </div>
      )}
    </div>
  );
}
