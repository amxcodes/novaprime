import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Badge, Button, Field, Input, Select, StateMessage, type SelectOption } from "../../design-system";
import { VisibleTaskBoard } from "./VisibleTaskBoard";
import { ResponsiveDisclosure } from "./ResponsiveDisclosure";
import { useCompactWorkContainer } from "./use-compact-work-container";
import styles from "./VisibleTasks.module.css";
import type { VisibleTask, VisibleTaskFilters, WorkVisibleTasksProps } from "./contracts";

export const VISIBLE_TASK_STATUS_OPTIONS = [
  ["open", "Open tasks"], ["all", "All statuses"], ["backlog", "Backlog"],
  ["ready", "Ready"], ["in_progress", "In progress"], ["submitted", "Submitted"],
  ["approved", "Approved"], ["done", "Done"], ["blocked", "Blocked"],
  ["returned", "Returned"], ["cancelled", "Cancelled"],
] as const;

export const VISIBLE_TASK_DUE_OPTIONS = [
  ["any", "Any due date"], ["overdue", "Overdue"], ["today", "Due today"],
  ["upcoming", "Due in the next 7 days"], ["unscheduled", "No due date"],
] as const;
export const DEFAULT_VISIBLE_TASK_FILTERS: VisibleTaskFilters = {
  status: "open", due: "any", search: "", cursor: "",
};

export function countVisibleTaskFilters(filters: VisibleTaskFilters): number {
  return Number(filters.status !== DEFAULT_VISIBLE_TASK_FILTERS.status) + Number(filters.due !== DEFAULT_VISIBLE_TASK_FILTERS.due);
}

const statusOptions: readonly SelectOption[] = VISIBLE_TASK_STATUS_OPTIONS.map(([value, label]) => ({ value, label }));
const dueOptions: readonly SelectOption[] = VISIBLE_TASK_DUE_OPTIONS.map(([value, label]) => ({ value, label }));

export function visibleTaskFiltersFromForm(values: FormData): VisibleTaskFilters {
  const status = String(values.get("status") ?? "");
  const due = String(values.get("due") ?? "");
  return {
    status: VISIBLE_TASK_STATUS_OPTIONS.some(([value]) => value === status) ? status : DEFAULT_VISIBLE_TASK_FILTERS.status,
    due: VISIBLE_TASK_DUE_OPTIONS.some(([value]) => value === due) ? due : DEFAULT_VISIBLE_TASK_FILTERS.due,
    search: String(values.get("search") ?? "").trim(),
    cursor: "",
  };
}

function humanize(value: string | null | undefined, fallback: string) {
  const text = String(value || "").replaceAll("_", " ");
  return text ? text[0].toUpperCase() + text.slice(1) : fallback;
}

function formatDate(value: string | null) {
  if (!value) return "No due date";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric",
  }).format(date);
}

function TaskRow({ task, href, onOpen }: {
  task: VisibleTask;
  href: string;
  onOpen: (id: string) => void;
}) {
  const context = [
    task.client?.name ? `Client · ${task.client.name}` : "Organisation",
    task.workstream?.name ? `Workstream · ${task.workstream.name}` : "Workstream",
    task.group?.name ? `Group · ${task.group.name}` : null,
    task.department?.name ? `Department · ${task.department.name}` : null,
  ].filter(Boolean);

  return (
    <li className={styles.item}>
      <div className={styles.copy}>
        <h3 className={styles.title}>
          <a data-task-detail-id={task.id} data-task-detail-source="visible" href={href} onClick={(event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
              event.shiftKey || event.altKey || event.currentTarget.target === "_blank") return;
            event.preventDefault();
            onOpen(task.id);
          }}>{task.title || "Untitled task"}</a>
        </h3>
        {task.description ? <p className={styles.description}>{task.description}</p> : null}
        <p className={styles.context}>{context.join(" · ")}</p>
      </div>
      <dl className={styles.facts}>
        <div><dt>Status</dt><dd><Badge tone="neutral">{humanize(task.status, "Unknown")}</Badge></dd></div>
        <div><dt>Priority</dt><dd>{humanize(task.priority, "Unspecified")}</dd></div>
        <div><dt>Due</dt><dd>{formatDate(task.dueDate)}</dd></div>
        <div><dt>Assignments</dt><dd>{task.assignmentCount}</dd></div>
      </dl>
    </li>
  );
}

function hasFilters(filters: VisibleTaskFilters) {
  return filters.status !== "open" || filters.due !== "any" || Boolean(filters.search);
}

export function VisibleTasks({
  read,
  filters,
  displayMode: initialDisplayMode = "list",
  savedViews,
  focusTarget,
  taskDetailHref,
  onOpenTask,
  onDisplayModeChange,
  onApplyFilters,
  onNewer,
  onOlder,
  onRetry,
}: WorkVisibleTasksProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const due = useRef<HTMLDivElement>(null);
  const lastFilter = useRef("search");
  const [statusValue, setStatusValue] = useState(filters.status);
  const [dueValue, setDueValue] = useState(filters.due);
  const [searchValue, setSearchValue] = useState(filters.search);
  const [displayMode, setDisplayMode] = useState(initialDisplayMode);
  const [sectionRef, compact] = useCompactWorkContainer<HTMLElement>();

  useEffect(() => {
    setDisplayMode(initialDisplayMode);
  }, [initialDisplayMode]);

  useEffect(() => {
    setStatusValue(filters.status);
  }, [filters.status]);

  useEffect(() => {
    setDueValue(filters.due);
  }, [filters.due]);

  useEffect(() => {
    setSearchValue(filters.search);
  }, [filters.search]);

  useLayoutEffect(() => {
    if (read.status === "loading") return;
    const target = read.status === "denied" || read.status === "error"
      ? heading.current
      : focusTarget === "search" ? search.current
        : focusTarget === "status" ? status.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')
          : focusTarget === "due" ? due.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')
            : focusTarget === "heading" ? heading.current : null;
    if (target) {
      if (target === heading.current) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
  }, [focusTarget, read.status]);

  if (read.status === "loading") {
    return <section ref={sectionRef} className={styles.section} aria-busy="true"><StateMessage kind="loading">Loading visible tasks</StateMessage></section>;
  }
  if (read.status === "denied" || read.status === "error") {
    return (
      <section ref={sectionRef} className={styles.section} aria-labelledby="work-visible-tasks-heading">
        <header><p className={styles.eyebrow}>Work across your scopes</p><h2 id="work-visible-tasks-heading" ref={heading}>All visible tasks</h2></header>
        <StateMessage kind={read.status === "denied" ? "warning" : "error"}>
          {read.message}
        </StateMessage>
        {read.status === "error" && (read.onRetry || onRetry) ? (
          <Button variant="secondary" onClick={read.onRetry ?? onRetry}>Try again</Button>
        ) : null}
      </section>
    );
  }

  const tasks = read.data.tasks;
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const active = document.activeElement;
    const focus = status.current?.contains(active) ? "status" : due.current?.contains(active) ? "due"
      : active === search.current ? "search" : lastFilter.current;
    onApplyFilters(visibleTaskFiltersFromForm(values), focus);
  };

  const changeDisplayMode = (nextMode: "list" | "board") => {
    setDisplayMode(nextMode);
    onDisplayModeChange?.(nextMode);
  };

  return (
    <section ref={sectionRef} className={styles.section} aria-labelledby="work-visible-tasks-heading">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Work across your scopes</p>
          <h2 id="work-visible-tasks-heading" ref={heading}>All visible tasks</h2>
          <p className={styles.description}>Tasks are limited to work areas your current access allows you to view.</p>
        </div>
        <p className={styles.pageCount} role="status">
          {tasks.length ? `Showing ${tasks.length} task${tasks.length === 1 ? "" : "s"} on this page.` :
            hasFilters(filters) ? "No visible tasks match these filters." : "No visible open tasks."}
        </p>
      </header>

      <form className={styles.filters} onSubmit={apply}>
        <Field label="Search task titles" className={styles.searchField}>
          {(props) => <Input {...props} ref={search} type="search" name="search" maxLength={100}
            value={searchValue}
            onChange={(event) => { setSearchValue(event.currentTarget.value); lastFilter.current = "search"; }} />}
        </Field>
        <ResponsiveDisclosure
          label="Filters"
          compact={compact}
          activeCount={countVisibleTaskFilters(filters)}
          className={styles.filterDisclosure}
          panelClassName={styles.filterPanel}
        >
          <div ref={status} className={styles.filterControlField} onFocusCapture={() => { lastFilter.current = "status"; }}>
            <Select label="Task status" name="status" value={statusValue} options={statusOptions}
              placeholder="Choose a status"
              onChange={setStatusValue} />
          </div>
          <div ref={due} className={styles.filterControlField} onFocusCapture={() => { lastFilter.current = "due"; }}>
            <Select label="Due date" name="due" value={dueValue} options={dueOptions}
              placeholder="Choose a due date"
              onChange={setDueValue} />
          </div>
          <div className={styles.filterActions}>
            <Button type="submit" variant="secondary">Apply filters</Button>
            <Button type="button" variant="quiet" onClick={() => onApplyFilters({ ...DEFAULT_VISIBLE_TASK_FILTERS }, "search")}>Clear</Button>
          </div>
        </ResponsiveDisclosure>
      </form>

      {savedViews || tasks.length ? (
        <ResponsiveDisclosure
          label="More actions"
          compact={compact}
          className={styles.collectionActions}
          panelClassName={styles.collectionActionPanel}
        >
          {savedViews ? <div className={styles.savedViews}>{savedViews}</div> : null}
          {tasks.length ? (
            <div className={styles.viewControls} role="group" aria-label="Task layout">
              <Button
                aria-pressed={displayMode === "list"}
                variant={displayMode === "list" ? "secondary" : "quiet"}
                onClick={() => changeDisplayMode("list")}
              >List</Button>
              <Button
                aria-pressed={displayMode === "board"}
                variant={displayMode === "board" ? "secondary" : "quiet"}
                onClick={() => changeDisplayMode("board")}
              >Board</Button>
            </div>
          ) : null}
        </ResponsiveDisclosure>
      ) : null}
      {read.status === "partial" ? <StateMessage kind="warning">{read.message}</StateMessage> : null}
      {tasks.length ? (
        <>
          {displayMode === "board" ? (
            <VisibleTaskBoard tasks={tasks} taskDetailHref={taskDetailHref} onOpenTask={onOpenTask} />
          ) : (
            <div className={styles.collection}>
              <div className={styles.collectionHeader} aria-hidden="true">
                <span>Task</span>
                <div className={styles.factHeadings}>
                  <span>Status</span><span>Priority</span><span>Due</span><span>Assignments</span>
                </div>
              </div>
              <ul className={styles.list} aria-label="Visible tasks">
                {tasks.map((task) => <TaskRow key={task.id} task={task} href={taskDetailHref(task.id)} onOpen={onOpenTask} />)}
              </ul>
            </div>
          )}
        </>
      ) : <StateMessage kind="info" title={hasFilters(filters)
        ? "No visible tasks match these filters." : "No visible open tasks."} />}

      <footer className={styles.pagination}>
        {filters.cursor ? <Button variant="secondary" onClick={onNewer}>Newer tasks</Button> : null}
        {read.data.hasMore && read.data.nextCursor ?
          <Button variant="secondary" onClick={() => onOlder(read.data.nextCursor!)}>Older tasks</Button> : null}
      </footer>
    </section>
  );
}
