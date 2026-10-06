import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Badge, Button, Field, Input, StateMessage } from "../../../design-system";
import styles from "./TaskDetail.module.css";
import type { DueDateSaveResult, WorkTaskDetailProps, WorkTaskDetailRecord } from "./contracts";

function valueText(value: string | null | undefined, fallback = "Not set") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readableCode(value: string | null | undefined, fallback = "Not recorded") {
  return valueText(value, fallback).replaceAll("_", " ");
}

function billingSourceLabel(source: string | null) {
  return ({
    client_workstream: "Client workstream policy",
    client_workstream_task_definition: "Task definition rule",
    organisation_default: "Organisation workstream policy",
  } as Record<string, string>)[source ?? ""] || "Recorded policy source";
}

function formatTimestamp(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleString();
}

function formatDateOnly(value: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return "Not set";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    return "Not set";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["done", "approved"].includes(status)) return "success";
  if (status === "blocked") return "warning";
  if (["in_progress", "submitted"].includes(status)) return "info";
  return "neutral";
}

function DetailField({ label, value }: { label: string; value: string }) {
  return <div className={styles.field}><dt>{label}</dt><dd>{value}</dd></div>;
}

function Section({ id, title, description, children }: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div>
        <h3 className={styles.sectionTitle} id={headingId}>{title}</h3>
        {description ? <p className={styles.sectionDescription}>{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function DueDateEditor({ task, onSave, onRetry, onSaved }: {
  task: WorkTaskDetailRecord;
  onSave: WorkTaskDetailProps["onSaveDueDate"];
  onRetry: () => void;
  onSaved: (dueDate: string | null) => void;
}) {
  const [draftDueDate, setDraftDueDate] = useState(task.dueDate ?? "");
  const [result, setResult] = useState<DueDateSaveResult | { status: "idle" | "saving" }>({ status: "idle" });
  const inFlight = useRef(false);

  if (!task.canEditDueDate || ["approved", "done", "cancelled"].includes(task.status)) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setResult({ status: "saving" });
    const form = event.currentTarget;
    try {
      const saved = await onSave(form);
      if (saved.status === "aborted") return;
      if (saved.status === "saved" || saved.status === "unchanged") {
        setDraftDueDate(saved.dueDate ?? "");
        onSaved(saved.dueDate);
      }
      setResult(saved);
    } catch {
      setResult({ status: "error", message: "The due date could not be saved. Try again." });
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <details className={styles.dueEditor}>
      <summary>Change due date</summary>
      <form className={styles.dueForm} onSubmit={submit}>
        <Field label="Due date (blank removes it)" hint="Changes are audited. Active assignees may be notified.">
          {(control) => <Input
            {...control}
            name="dueDate"
            type="date"
            value={draftDueDate}
            disabled={result.status === "saving" || result.status === "conflict"}
            onChange={(event) => {
              setDraftDueDate(event.currentTarget.value);
              if (result.status !== "saving" && result.status !== "conflict") setResult({ status: "idle" });
            }}
          />}
        </Field>
        <Button type="submit" variant="secondary" disabled={result.status === "conflict"} loading={result.status === "saving"} loadingLabel="Saving due date">
          Save due date
        </Button>
        {result.status === "saving" ? <StateMessage kind="loading">Saving due date</StateMessage> : null}
        {result.status === "saved" || result.status === "unchanged" ? (
          <StateMessage kind="success">{result.message}</StateMessage>
        ) : null}
        {result.status === "error" ? <StateMessage kind="error">{result.message}</StateMessage> : null}
        {result.status === "conflict" ? (
          <div className={styles.saveConflict}>
            <StateMessage kind="warning">{result.message}</StateMessage>
            <Button type="button" variant="secondary" onClick={onRetry}>Reload task</Button>
          </div>
        ) : null}
      </form>
    </details>
  );
}

function ReadyTask({ task, onBack, onRetry, onSaveDueDate, headingRef }: {
  task: WorkTaskDetailRecord;
  onBack: () => void;
  onRetry: () => void;
  onSaveDueDate: WorkTaskDetailProps["onSaveDueDate"];
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const id = useId();
  const [dueDate, setDueDate] = useState(task.dueDate);
  return (
    <article className={styles.root} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <Button variant="secondary" size="compact" onClick={onBack}>Back</Button>
        <div className={styles.identity}>
          <p className={styles.eyebrow}>Task</p>
          <h2 className={styles.title} id={`${id}-title`} ref={headingRef} tabIndex={-1}>{valueText(task.title, "Untitled task")}</h2>
          <div className={styles.badges}>
            <Badge tone={statusTone(task.status)}>{readableCode(task.status, "Unknown status")}</Badge>
            <Badge tone="neutral">{readableCode(task.priority, "Normal")} priority</Badge>
          </div>
        </div>
      </header>

      <Section id={`${id}-context`} title="Work context">
        <dl className={styles.fields}>
          {task.workstreamKind === "client" ? (
            <DetailField label="Client" value={valueText(task.clientName)} />
          ) : (
            <DetailField label="Organisation department" value={valueText(task.departmentName)} />
          )}
          <DetailField label="Workstream" value={valueText(task.workstreamName)} />
          <DetailField label="Group" value={valueText(task.groupName)} />
          <DetailField label="Due date" value={formatDateOnly(dueDate)} />
          <DetailField label="Created" value={formatTimestamp(task.createdAt)} />
        </dl>
        <DueDateEditor task={task} onSave={onSaveDueDate} onRetry={onRetry} onSaved={setDueDate} />
      </Section>

      <Section id={`${id}-description`} title="Description">
        <p className={task.description ? styles.description : styles.muted}>
          {valueText(task.description, "No description was provided.")}
        </p>
      </Section>

      <Section id={`${id}-assignments`} title="Visible assignments" description="Only assignment details available to this view are shown.">
        {task.assignments.length ? (
          <ul className={styles.assignments}>
            {task.assignments.map((assignment, index) => (
              <li className={styles.assignment} key={`${assignment.personName ?? "assignment"}-${index}`}>
                <strong className={styles.person}>{valueText(assignment.personName, "Assigned person")}</strong>
                <Badge className={styles.assignmentState} tone="neutral">
                  {readableCode(assignment.status, "Unknown state")}
                </Badge>
                <span className={styles.assignmentMeta}>
                  {assignment.reviewerName
                    ? `Reviewer: ${assignment.reviewerName}`
                    : assignment.reviewRequired ? "Reviewer not assigned" : "Review not required"}
                </span>
                {assignment.reviewBlockedReason ? (
                  <span className={styles.blocker}>
                    Review blocked: {readableCode(assignment.reviewBlockedReason).toLowerCase()}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <StateMessage kind="info">No assignments are available in this view.</StateMessage>}
      </Section>

      <Section id={`${id}-history`} title="Classification and history">
        <dl className={styles.fields}>
          <DetailField label="Billing class" value={readableCode(task.billingClass)} />
          <DetailField label="Billing policy" value={billingSourceLabel(task.billingPolicySource)} />
          <DetailField label="Policy revision" value={String(task.billingPolicyRevision ?? "Not recorded")} />
          <DetailField label="Task definition" value={task.taskDefinitionRevision === null ? "One-off task" : `Revision ${task.taskDefinitionRevision}`} />
        </dl>
        {task.isCorrection ? (
          <p className={styles.correction}>
            Correction task{task.correctionTitle ? ` for “${task.correctionTitle}”` : ""}
            {task.correctionReason ? ` · ${task.correctionReason}` : ""}
          </p>
        ) : null}
      </Section>
    </article>
  );
}

export function TaskDetail({ read, onBack, onRetry, onSaveDueDate }: WorkTaskDetailProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [read.status]);

  if (read.status === "loading") {
    return (
      <section className={styles.root} aria-labelledby="task-loading-heading" aria-busy="true">
        <h2 className={styles.noticeTitle} id="task-loading-heading" ref={heading} tabIndex={-1}>Task details</h2>
        <StateMessage kind="loading">Loading task details</StateMessage>
      </section>
    );
  }

  if (read.status === "unavailable") {
    return (
      <section className={`${styles.root} ${styles.unavailable}`} aria-labelledby="task-unavailable-heading">
        <h2 className={styles.noticeTitle} id="task-unavailable-heading" ref={heading} tabIndex={-1}>Task unavailable</h2>
        <StateMessage kind="warning">{read.message}</StateMessage>
        <div className={styles.badges}>
          <Button variant="secondary" onClick={onBack}>Back</Button>
          {read.canRetry ? <Button onClick={onRetry}>Try again</Button> : null}
        </div>
      </section>
    );
  }

  return <ReadyTask task={read.data} onBack={onBack} onRetry={onRetry} onSaveDueDate={onSaveDueDate} headingRef={heading} />;
}
