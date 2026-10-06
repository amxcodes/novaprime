import { Badge, Button, StateMessage } from "../../design-system";
import { formatAssignmentDueDate, getAssignmentStatus } from "./presentation";
import styles from "./AssignmentList.module.css";
import type { AssignmentListProps, AssignmentSummaryRowProps } from "./contracts";

export function AssignmentSummaryRow({ assignment, title, context, actions }: AssignmentSummaryRowProps) {
  const status = getAssignmentStatus(assignment.status);
  const dueDate = formatAssignmentDueDate(assignment.dueDate);

  return (
    <li className={styles.item}>
      <div className={styles.copy}>
        <h3 className={styles.title}>{title || assignment.title || "Untitled assignment"}</h3>
        <p className={styles.metadata}>
          <Badge tone={status.tone}>{status.label}</Badge>
          <span className={styles.dueDate}>
            <span className={styles.dueDateLabel}>Due </span>
            {dueDate ? <time dateTime={assignment.dueDate ?? undefined}>{dueDate}</time> : "No due date"}
          </span>
        </p>
        {context ? <div className={styles.context}>{context}</div> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </li>
  );
}

function WorkButton({ onOpenWork }: Pick<AssignmentListProps, "onOpenWork">) {
  if (!onOpenWork) return null;
  return <Button variant="secondary" size="compact" onClick={onOpenWork}>Open Work</Button>;
}

export function AssignmentList({ read, onOpenWork }: AssignmentListProps) {
  if (read.status === "loading") {
    return (
      <div className={`${styles.state} ${styles.loadingState}`} aria-busy="true">
        <StateMessage kind="loading">Loading assignments</StateMessage>
        <ul className={styles.skeletonList} aria-hidden="true">
          <li className={styles.skeletonRow}>
            <span className={styles.skeletonLine} />
            <span className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
          </li>
          <li className={styles.skeletonRow}>
            <span className={styles.skeletonLine} />
            <span className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
          </li>
        </ul>
      </div>
    );
  }

  if (read.status === "denied") {
    return (
      <StateMessage kind="warning" title="Assignments unavailable" className={styles.state}>
        {read.message ?? "Your current access does not allow this assignment list."}
      </StateMessage>
    );
  }

  if (read.status === "error") {
    return (
      <div className={styles.state}>
        <StateMessage kind="error" title="Assignments could not load">
          {read.message}
        </StateMessage>
        {read.onRetry || onOpenWork ? (
          <div className={styles.footer}>
            <WorkButton onOpenWork={onOpenWork} />
            {read.onRetry ? (
              <Button className={styles.retry} variant="secondary" size="compact" onClick={() => void read.onRetry?.()}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const assignments = read.data.assignments;
  if (assignments.length === 0) {
    if (read.status === "partial") {
      return (
        <div className={styles.state}>
          <StateMessage kind="warning" title="Assignment list is incomplete">
            {read.message}
          </StateMessage>
          {read.onRetry || onOpenWork ? (
            <div className={styles.footer}>
              <WorkButton onOpenWork={onOpenWork} />
              {read.onRetry ? (
                <Button className={styles.retry} variant="secondary" size="compact" onClick={() => void read.onRetry?.()}>
                  Try again
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }
    return (
      <div className={styles.state}>
        <StateMessage kind="info" title="No assignments to show right now." />
        {onOpenWork ? <div className={styles.footer}><WorkButton onOpenWork={onOpenWork} /></div> : null}
      </div>
    );
  }

  return (
    <div className={styles.state}>
      <ul className={styles.list} aria-label="Your assignments">
        {assignments.map((assignment) => (
          <AssignmentSummaryRow
            key={assignment.assignmentId}
            assignment={assignment}
            title={assignment.title || "Untitled assignment"}
          />
        ))}
      </ul>
      {read.status === "partial" ? (
        <StateMessage kind="warning" className={styles.state}>{read.message}</StateMessage>
      ) : null}
      <div className={styles.footer}>
        <p className={styles.note}>
          {`Showing up to ${read.data.limit} assignments.${read.data.hasMore ? " More may be available in Work." : ""}`}
        </p>
        <WorkButton onOpenWork={onOpenWork} />
      </div>
      {read.status === "partial" && read.onRetry ? (
        <div className={styles.footer}>
          <Button className={styles.retry} variant="secondary" size="compact" onClick={() => void read.onRetry?.()}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
