import { Badge, Button, EmptyState, StateMessage } from "../../design-system";
import { ReadFailure, ReportPanel } from "./OperationsReportPanel";
import styles from "./OperationsOverview.module.css";
import type { OperationsOverviewProps, OperationsTasksReadState } from "./contracts";

function humanize(value: string | null | undefined, fallback: string) {
  const text = String(value || "").replaceAll("_", " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : fallback;
}

export function TaskReportPanel({
  read,
  taskHref,
  onOpenTask,
  onNext,
  onPrevious,
  canExport,
  onExport,
  onRetry,
  onRetryPage,
}: {
  read: OperationsTasksReadState;
  taskHref: OperationsOverviewProps["taskDetailHref"];
  onOpenTask: OperationsOverviewProps["onOpenTask"];
  onNext?: (cursor: string) => void;
  onPrevious?: () => void;
  canExport: boolean;
  onExport?: () => void;
  onRetry: () => void;
  onRetryPage?: () => void;
}) {
  return (
    <ReportPanel
      id="operations-work-title"
      title="Task context"
      description="Scoped task summaries from your current work access. The server reports non-cancelled assignment counts; assignment names are not included."
      className={styles.workPanel}
      actions={read.status === "ready" && canExport ? (
        <Button variant="secondary" size="compact" onClick={onExport}>Download this task page CSV</Button>
      ) : undefined}
    >
      {read.status === "loading" ? (
        <StateMessage kind="loading" title="Loading visible tasks">Reading task summaries within your current access scope.</StateMessage>
      ) : read.status === "denied" ? (
        <ReadFailure read={read} title="Task report unavailable" onRetry={onRetry} />
      ) : read.status === "error" ? (
        <div className={styles.failure}>
          <StateMessage kind="error" title="Task report unavailable">{read.message}</StateMessage>
          <Button variant="secondary" onClick={onRetry}>Try again</Button>
        </div>
      ) : (
        <>
          <p className={styles.rangeNote} role="status">
            Page {read.data.pageNumber}: {read.data.tasks.length} task{read.data.tasks.length === 1 ? "" : "s"} shown, up to {read.data.limit} per page. There is no total count; the CSV includes only this page.
          </p>
          {read.pageError ? (
            <div className={styles.pageError}>
              <StateMessage kind="error" title="Could not change task page">{read.pageError}</StateMessage>
              <Button variant="secondary" size="compact" onClick={onRetryPage || onRetry}>Try again</Button>
            </div>
          ) : null}
          {!read.data.tasks.length ? (
            <EmptyState title="No visible tasks on this page" description="The report contains only tasks authorized for your current work scope." />
          ) : (
            <ul className={styles.taskList} aria-label="Visible task context">
              {read.data.tasks.map((task) => {
                const context = [
                  task.client?.name || "Organisation",
                  task.workstream?.name || "Workstream",
                  task.group?.name ? `Group · ${task.group.name}` : null,
                  task.department?.name ? `Department · ${task.department.name}` : null,
                ].filter(Boolean);
                return (
                  <li className={styles.taskRow} key={task.id}>
                    <div className={styles.taskIdentity}>
                      <h3>
                        <a href={taskHref(task.id)} onClick={(event) => {
                          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
                            event.shiftKey || event.altKey || event.currentTarget.target === "_blank") return;
                          event.preventDefault();
                          onOpenTask(task.id);
                        }}>{task.title || "Untitled task"}</a>
                      </h3>
                      <p>{context.join(" · ")}</p>
                    </div>
                    <dl className={styles.taskFacts}>
                      <div><dt>Status</dt><dd><Badge tone="neutral">{humanize(task.status, "Unknown")}</Badge></dd></div>
                      <div><dt>Priority</dt><dd>{humanize(task.priority, "Unspecified")}</dd></div>
                      <div><dt>Due date</dt><dd>{task.dueDate || "No due date"}</dd></div>
                      <div><dt>Non-cancelled assignments</dt><dd>{task.assignmentCount}</dd></div>
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}
          <nav className={styles.peoplePagination} aria-label="Task report pages">
            <Button variant="secondary" size="compact" onClick={onPrevious}
              disabled={!onPrevious || !read.data.hasPrevious || read.loadingPage}>
              Previous page
            </Button>
            <span className={styles.pageProgress} tabIndex={read.loadingPage ? -1 : undefined}
              aria-live={read.loadingPage ? "polite" : undefined}>
              {read.loadingPage ? "Loading page…" : `Page ${read.data.pageNumber}; ${read.data.hasMore ? "a next page is available" : "no more pages"}. No total is available.`}
            </span>
            <Button variant="secondary" size="compact"
              onClick={() => read.data.nextCursor && onNext?.(read.data.nextCursor)}
              disabled={!onNext || !read.data.hasMore || !read.data.nextCursor || read.loadingPage}
              loading={read.loadingPage && !read.pageError}
              loadingLabel="Loading next page">
              Next page
            </Button>
          </nav>
        </>
      )}
    </ReportPanel>
  );
}
