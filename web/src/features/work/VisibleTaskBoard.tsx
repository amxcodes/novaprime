import { useId, useState } from "react";
import { Badge, Select, type SelectOption } from "../../design-system";
import type { VisibleTask } from "./contracts";
import { groupVisibleTasksByBoardLane } from "./visible-task-board-model";
import styles from "./VisibleTaskBoard.module.css";

export interface VisibleTaskBoardProps {
  tasks: ReadonlyArray<VisibleTask>;
  taskDetailHref: (taskId: string) => string;
  onOpenTask: (taskId: string) => void;
}

function humanize(value: string | null | undefined, fallback: string): string {
  const text = String(value || "").replaceAll("_", " ");
  return text ? text[0].toUpperCase() + text.slice(1) : fallback;
}

function formatDate(value: string | null): string {
  if (!value) return "No due date";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "approved" || status === "done") return "success";
  if (status === "submitted") return "info";
  if (status === "blocked" || status === "returned") return "warning";
  if (status === "cancelled") return "danger";
  return "neutral";
}

function TaskBoardCard({ task, href, onOpen }: {
  task: VisibleTask;
  href: string;
  onOpen: (taskId: string) => void;
}) {
  const context = [
    task.client?.name,
    task.workstream?.name,
    task.group?.name,
  ].filter((value): value is string => Boolean(value));

  return (
    <li className={styles.cardItem}>
      <article className={styles.card}>
        <h4 className={styles.title}>
          <a data-task-detail-id={task.id} data-task-detail-source="visible" href={href} onClick={(event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
              event.shiftKey || event.altKey || event.currentTarget.target === "_blank") return;
            event.preventDefault();
            onOpen(task.id);
          }}>{task.title || "Untitled task"}</a>
        </h4>
        <p className={styles.context}>{context.join(" · ") || "Organisation work"}</p>
        <div className={styles.status}>
          <Badge tone={statusTone(task.status)}>{humanize(task.status, "Unknown")}</Badge>
        </div>
        <dl className={styles.facts}>
          <div><dt>Priority</dt><dd>{humanize(task.priority, "Unspecified")}</dd></div>
          <div><dt>Due</dt><dd>{formatDate(task.dueDate)}</dd></div>
          <div><dt>Assignments</dt><dd>{task.assignmentCount}</dd></div>
        </dl>
      </article>
    </li>
  );
}

export function VisibleTaskBoard({ tasks, taskDetailHref, onOpenTask }: VisibleTaskBoardProps) {
  const id = useId();
  const lanes = groupVisibleTasksByBoardLane(tasks);
  const [selectedLaneId, setSelectedLaneId] = useState<string>(lanes[0]?.id ?? "");
  const selectedLane = lanes.find((lane) => lane.id === selectedLaneId) ?? lanes[0];
  const laneOptions: readonly SelectOption[] = lanes.map((lane) => ({
    value: lane.id,
    label: `${lane.label} (${lane.tasks.length})`,
  }));

  return (
    <section className={styles.boardRoot} aria-label="Visible tasks grouped by status">
      <p className={styles.guidance}>
        This board shows only tasks on the current page. Task status is managed by the work workflow; changing this view does not change status.
      </p>
      {lanes.length > 1 ? (
        <div className={styles.lanePicker}>
          <Select
            label="Status lane"
            name="taskLane"
            value={selectedLane?.id ?? ""}
            options={laneOptions}
            onChange={setSelectedLaneId}
          />
        </div>
      ) : null}
      <div className={styles.lanes}>
        {lanes.map((lane) => {
          const headingId = `${id}-lane-${lane.id}`;
          return (
            <section
              aria-labelledby={headingId}
              className={styles.lane}
              data-active={lane.id === selectedLane?.id ? "true" : "false"}
              key={lane.id}
            >
              <header className={styles.laneHeader}>
                <h3 id={headingId}>{lane.label}</h3>
                <span>{lane.tasks.length} on this page</span>
              </header>
              <ul className={styles.cards} aria-labelledby={headingId}>
                {lane.tasks.map((task) => (
                  <TaskBoardCard
                    key={task.id}
                    task={task}
                    href={taskDetailHref(task.id)}
                    onOpen={onOpenTask}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}
