import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, EmptyState, Field, Input, SearchableSelect, SectionHeading, StateMessage } from "../../../design-system";
import type {
  WorkOperationsAssignment,
  WorkOperationsAssignmentOptions,
  WorkOperationsAssignmentInput,
  WorkOperationsDueDateInput,
  WorkOperationsProps,
  WorkOperationsReassignmentInput,
  WorkOperationsTask,
} from "./contracts";
import styles from "./WorkOperations.module.css";

const fallbackError = "The task action could not be completed. Refresh Admin and try again.";

function readableError(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : fallbackError;
}

export function WorkOperations(props: WorkOperationsProps) {
  return (
    <section className={styles.root} aria-label="Tasks and assignments">
      <SectionHeading
        title="Tasks and assignments"
        description="Visible tasks are listed with their assignment history. The API returns at most 200 tasks and provides no total or cursor, so this may be a partial view rather than a full history. Cancel closes future work and preserves recorded history."
      />

      {props.taskRead.status !== "ready" ? (
        <StateMessage kind={props.taskRead.status === "error" ? "error" : "info"} title="Tasks unavailable">
          {props.taskRead.message}
        </StateMessage>
      ) : props.taskRead.items.length === 0 ? (
        <EmptyState title="No visible tasks yet" description="Tasks available to your current scope will appear here." />
      ) : (
        <ol className={styles.taskList} aria-label="Tasks and assignments visible in the current scope">
          {props.taskRead.items.map((task) => (
            <li key={task.id}>
              <TaskCard
                task={task}
                loadAssignmentOptions={props.loadAssignmentOptions}
                onAssign={props.onAssign}
                onReassign={props.onReassign}
                onCancel={props.onCancel}
                onUpdateDueDate={props.onUpdateDueDate}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TaskCard({
  task,
  loadAssignmentOptions,
  onAssign,
  onReassign,
  onCancel,
  onUpdateDueDate,
}: {
  task: WorkOperationsTask;
  loadAssignmentOptions: WorkOperationsProps["loadAssignmentOptions"];
  onAssign: WorkOperationsProps["onAssign"];
  onReassign: WorkOperationsProps["onReassign"];
  onCancel: WorkOperationsProps["onCancel"];
  onUpdateDueDate: WorkOperationsProps["onUpdateDueDate"];
}) {
  const id = useId();
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelConfirmationOpen, setCancelConfirmationOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const canShowActions = !["cancelled", "done"].includes(task.status);

  async function cancelTask() {
    setCancelPending(true);
    setCancelError(null);
    try {
      await onCancel(task.id);
    } catch (error) {
      setCancelError(readableError(error));
    } finally {
      setCancelPending(false);
    }
  }

  return (
    <article className={styles.task} aria-labelledby={`${id}-title`}>
      <header className={styles.taskHeader}>
        <div className={styles.taskCopy}>
          <h3 id={`${id}-title`}>{task.title}</h3>
          <p className={styles.meta}>
            {task.clientName ? `${task.clientName} / ` : "Organisation / "}{task.workstreamName}
            <span aria-hidden="true"> · </span>{task.status}<span aria-hidden="true"> · </span>{task.priority}
          </p>
        </div>
        {task.dueDate ? <time className={styles.dueDate} dateTime={task.dueDate}>Due {task.dueDate}</time> : null}
      </header>

      <p className={styles.policy}>{task.billingConfirmation}<span aria-hidden="true"> · </span>{task.definitionProvenance}</p>
      {task.isCorrection ? (
        <p className={styles.detail}>Correction task{task.correctionOfTitle ? ` for “${task.correctionOfTitle}”` : ""}{task.correctionReason ? ` · ${task.correctionReason}` : ""}</p>
      ) : null}
      {task.description ? <p className={styles.description}>{task.description}</p> : null}

      {task.canEditDueDate && !["approved", "done", "cancelled"].includes(task.status) ? (
        <DueDateEditor task={task} onSave={onUpdateDueDate} />
      ) : null}

      {task.assignments.length ? (
        <section className={styles.assignmentSection} aria-labelledby={`${id}-assignments-title`}>
          <h4 id={`${id}-assignments-title`}>Assignment history</h4>
          <ul className={styles.assignmentList}>
            {task.assignments.map((assignment) => (
              <li key={assignment.id}>
                <AssignmentRow
                  task={task}
                  assignment={assignment}
                  loadAssignmentOptions={loadAssignmentOptions}
                  onReassign={onReassign}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : <p className={styles.detail}>No assignment history.</p>}

      {canShowActions ? (
        <div className={styles.taskActions}>
          {task.canCancel && task.status !== "approved" ? (
            <div>
              {cancelConfirmationOpen ? (
                <div className={styles.cancelConfirmation} role="group" aria-label={`Confirm cancellation of ${task.title}`}>
                  <p>Cancel this task? Recorded work remains preserved.</p>
                  <div className={styles.confirmActions}>
                    <Button variant="danger" size="compact" loading={cancelPending} loadingLabel="Cancelling task" onClick={() => void cancelTask()}>
                      Confirm cancellation
                    </Button>
                    <Button variant="secondary" size="compact" disabled={cancelPending} onClick={() => setCancelConfirmationOpen(false)}>
                      Keep task
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="danger" size="compact" onClick={() => setCancelConfirmationOpen(true)}>
                  Cancel task
                </Button>
              )}
              {cancelError ? <p className={styles.error} role="alert">{cancelError}</p> : null}
            </div>
          ) : null}
          {task.canAssign ? (
            <AssignmentEditor
              task={task}
              loadAssignmentOptions={loadAssignmentOptions}
              reviewRequiredByPolicy={task.workstreamKind === "client"}
              onAssign={onAssign}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function AssignmentRow({
  task,
  assignment,
  loadAssignmentOptions,
  onReassign,
}: {
  task: WorkOperationsTask;
  assignment: WorkOperationsAssignment;
  loadAssignmentOptions: WorkOperationsProps["loadAssignmentOptions"];
  onReassign: WorkOperationsProps["onReassign"];
}) {
  const id = useId();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRead = useAssignmentOptions(task.id, loadAssignmentOptions);
  const [personId, setPersonId] = useState("");
  const [reviewerPersonId, setReviewerPersonId] = useState("");
  const [reviewerChoiceInitialized, setReviewerChoiceInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<"assignee" | "reviewer" | null>(null);
  const [busy, setBusy] = useState(false);
  const replacementOptions = optionsRead.status === "ready"
    ? optionsRead.options.assignees.filter((person) => person.id !== assignment.personId).map((person) => ({ value: person.id, label: person.name }))
    : [];
  const mustReview = task.workstreamKind === "client" || assignment.reviewRequired;
  const reviewerOptions = optionsRead.status === "ready"
    ? optionsRead.options.reviewers.filter((person) => person.id !== personId).map((person) => ({ value: person.id, label: person.name }))
    : [];
  const canReassign = assignment.canReassign && !["cancelled", "approved"].includes(assignment.status);

  useEffect(() => {
    if (!optionsOpen || reviewerChoiceInitialized || optionsRead.status !== "ready") return;
    const currentReviewerIsEligible = optionsRead.options.reviewers.some((reviewer) =>
      reviewer.id === assignment.reviewerPersonId && reviewer.id !== assignment.personId
    );
    setReviewerPersonId(currentReviewerIsEligible ? assignment.reviewerPersonId || "" : "");
    setReviewerChoiceInitialized(true);
  }, [assignment.personId, assignment.reviewerPersonId, optionsOpen, optionsRead.status, reviewerChoiceInitialized]);

  function openOptions() {
    setOptionsOpen(true);
    setPersonId("");
    setReviewerPersonId("");
    setReviewerChoiceInitialized(false);
    setValidation(null);
    setError(null);
    void optionsRead.refresh();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!personId) {
      setValidation("assignee");
      setError(null);
      return;
    }
    if (mustReview && (!reviewerPersonId || reviewerPersonId === personId)) {
      setValidation("reviewer");
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    setValidation(null);
    try {
      const input: WorkOperationsReassignmentInput = {
        personId,
        reviewerPersonId: mustReview ? reviewerPersonId : null,
        reviewRequired: mustReview,
      };
      await onReassign(task.id, assignment.id, input);
      setOptionsOpen(false);
    } catch (submitError) {
      setError(readableError(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.assignment}>
      <div className={styles.assignmentSummary}>
        <span>{assignment.personName} · {assignment.status}
          {assignment.reviewerName ? ` · reviewer ${assignment.reviewerName}` : ""}
          {assignment.reviewRequired ? " · review required" : ""}
          {assignment.resolutionSource === "policy" ? " · completed without review" : ""}
          {assignment.reviewBlockedReason ? ` · review blocked: ${assignment.reviewBlockedReason}` : ""}
        </span>
      </div>
      {canReassign ? optionsOpen ? (
        <div className={styles.optionsPanel} role="group" aria-label={`Reassign ${assignment.personName}`}>
          <div className={styles.formActions}>
            <Button type="button" variant="quiet" size="compact" disabled={busy} onClick={() => setOptionsOpen(false)}>Close reassignment</Button>
          </div>
          <AssignmentOptionsStatus read={optionsRead} retry={() => void optionsRead.retry()} />
          {optionsRead.status === "ready" ? replacementOptions.length ? (
            <form className={styles.reassignForm} noValidate onSubmit={(event) => void submit(event)}>
              <SearchableSelect
                id={`${id}-replacement`}
                label={`Replacement for ${assignment.personName}`}
                required
                value={personId}
                options={replacementOptions}
                placeholder="Choose replacement"
                emptyMessage="No eligible assignees match this search."
                searchMode="remote"
                onSearch={(query) => optionsRead.search(query).then((result) =>
                  result.assignees.map((person) => ({ value: person.id, label: person.name })))}
                error={validation === "assignee" ? "Choose an eligible replacement." : undefined}
                disabled={busy}
                onChange={(value) => { setPersonId(value); setValidation(null); setError(null); if (value === reviewerPersonId) setReviewerPersonId(""); }}
              />
              {mustReview ? (
                reviewerOptions.length ? (
                  <SearchableSelect
                    id={`${id}-replacement-reviewer`}
                    label="Replacement reviewer"
                    hint="Choose a reviewer for this review-required assignment."
                    required
                    value={reviewerPersonId}
                    options={reviewerOptions}
                    placeholder="Choose reviewer"
                    emptyMessage="No eligible reviewers match this search."
                    searchMode="remote"
                    onSearch={(query) => optionsRead.search(query).then((result) =>
                      result.reviewers.map((person) => ({ value: person.id, label: person.name })))}
                    clearLabel="Clear reviewer"
                    error={validation === "reviewer" ? "Choose an eligible reviewer other than the assignee." : undefined}
                    disabled={busy}
                    onChange={(value) => { setReviewerPersonId(value); setValidation(null); setError(null); }}
                  />
                ) : <p className={styles.error} role="alert">No eligible reviewer is available for this review-required assignment.</p>
              ) : null}
              {error ? <p className={styles.error} role="alert">{error}</p> : null}
              <div className={styles.formActions}>
                <Button type="submit" variant="secondary" size="compact" loading={busy} loadingLabel="Reassigning">Reassign</Button>
              </div>
            </form>
          ) : <p className={styles.detail}>No eligible replacement is available.</p> : null}
        </div>
      ) : (
        <Button type="button" variant="secondary" size="compact" onClick={openOptions}>Reassign…</Button>
      ) : null}
    </div>
  );
}

function AssignmentEditor({
  task,
  loadAssignmentOptions,
  reviewRequiredByPolicy,
  onAssign,
}: {
  task: WorkOperationsTask;
  loadAssignmentOptions: WorkOperationsProps["loadAssignmentOptions"];
  reviewRequiredByPolicy: boolean;
  onAssign: WorkOperationsProps["onAssign"];
}) {
  const id = useId();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRead = useAssignmentOptions(task.id, loadAssignmentOptions);
  const [personId, setPersonId] = useState("");
  const [reviewerPersonId, setReviewerPersonId] = useState("");
  const [reviewRequired, setReviewRequired] = useState(reviewRequiredByPolicy);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<"assignee" | "reviewer" | null>(null);
  const [busy, setBusy] = useState(false);
  const assignablePeople = optionsRead.status === "ready" ? optionsRead.options.assignees : [];
  const assignableOptions = assignablePeople.map((person) => ({ value: person.id, label: person.name }));
  const eligibleReviewers = optionsRead.status === "ready"
    ? optionsRead.options.reviewers.filter((person) => person.id !== personId)
    : [];
  const reviewerOptions = eligibleReviewers.map((person) => ({ value: person.id, label: person.name }));
  const effectiveReviewRequired = reviewRequiredByPolicy || reviewRequired;

  function openOptions() {
    setOptionsOpen(true);
    setPersonId("");
    setReviewerPersonId("");
    setValidation(null);
    setError(null);
    void optionsRead.refresh();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!personId) {
      setValidation("assignee");
      setError(null);
      return;
    }
    if (effectiveReviewRequired && (!reviewerPersonId || reviewerPersonId === personId)) {
      setValidation("reviewer");
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    setValidation(null);
    const input: WorkOperationsAssignmentInput = {
      personId,
      reviewerPersonId: effectiveReviewRequired ? reviewerPersonId : null,
      reviewRequired: effectiveReviewRequired,
    };
    try {
      await onAssign(task.id, input);
      setOptionsOpen(false);
    } catch (submitError) {
      setError(readableError(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.assignmentEditor}>
      {optionsOpen ? (
        <div className={styles.optionsPanel} role="group" aria-label={`Assign ${task.title}`}>
          <div className={styles.formActions}>
            <Button type="button" variant="quiet" size="compact" disabled={busy} onClick={() => setOptionsOpen(false)}>Close assignment</Button>
          </div>
          <AssignmentOptionsStatus read={optionsRead} retry={() => void optionsRead.retry()} />
          {optionsRead.status === "ready" ? assignablePeople.length ? (
            <form className={styles.assignmentForm} noValidate onSubmit={(event) => void submit(event)}>
              <div className={styles.peopleFields}>
                <SearchableSelect
                  id={`${id}-assignee`}
                  label="Assignee"
                  required
                  value={personId}
                  options={assignableOptions}
                  placeholder="Choose assignee"
                  emptyMessage="No eligible assignees match this search."
                  searchMode="remote"
                  onSearch={(query) => optionsRead.search(query).then((result) =>
                    result.assignees.map((person) => ({ value: person.id, label: person.name })))}
                  error={validation === "assignee" ? "Choose an eligible assignee." : undefined}
                  disabled={busy}
                  onChange={(value) => { setPersonId(value); setValidation(null); setError(null); if (value === reviewerPersonId) setReviewerPersonId(""); }}
                />
              </div>
              {reviewRequiredByPolicy ? (
                reviewerOptions.length ? (
                  <SearchableSelect
                    id={`${id}-reviewer`}
                    label="Reviewer"
                    hint="Client work requires a different eligible reviewer."
                    required
                    value={reviewerPersonId}
                    options={reviewerOptions}
                    placeholder="Choose reviewer"
                    emptyMessage="No eligible reviewers match this search."
                    searchMode="remote"
                    onSearch={(query) => optionsRead.search(query).then((result) =>
                      result.reviewers.map((person) => ({ value: person.id, label: person.name })))}
                    error={validation === "reviewer" ? "Choose an eligible reviewer other than the assignee." : undefined}
                    disabled={busy}
                    onChange={(value) => { setReviewerPersonId(value); setValidation(null); setError(null); }}
                  />
                ) : <p className={styles.error} role="alert">No eligible reviewer is available. Client work cannot be assigned until a reviewer is available.</p>
              ) : (
                <>
                  <label className={styles.reviewRequired}>
                    <input type="checkbox" checked={reviewRequired} disabled={busy} onChange={(event) => {
                      setReviewRequired(event.currentTarget.checked);
                      if (!event.currentTarget.checked) setReviewerPersonId("");
                      setValidation(null);
                      setError(null);
                    }} />
                    <span>Require review</span>
                  </label>
                  {reviewRequired ? reviewerOptions.length ? (
                    <SearchableSelect
                      id={`${id}-reviewer`}
                      label="Reviewer"
                      hint="Review is required when you select a reviewer."
                      required
                      value={reviewerPersonId}
                      options={reviewerOptions}
                      placeholder="Choose reviewer"
                      emptyMessage="No eligible reviewers match this search."
                      searchMode="remote"
                      onSearch={(query) => optionsRead.search(query).then((result) =>
                        result.reviewers.map((person) => ({ value: person.id, label: person.name })))}
                      error={validation === "reviewer" ? "Choose an eligible reviewer other than the assignee." : undefined}
                      disabled={busy}
                      onChange={(value) => { setReviewerPersonId(value); setValidation(null); setError(null); }}
                    />
                  ) : <p className={styles.detail}>No eligible reviewer is available for this target. Turn off review to assign without review.</p> : null}
                </>
              )}
              {error ? <p className={styles.error} role="alert">{error}</p> : null}
              <div className={styles.formActions}>
                <Button type="submit" size="compact" loading={busy} loadingLabel="Assigning task">Assign task</Button>
              </div>
            </form>
          ) : <p className={styles.detail}>No eligible assignees are available for this task.</p> : null}
        </div>
      ) : (
        <Button type="button" size="compact" onClick={openOptions}>Assign…</Button>
      )}
    </div>
  );
}

type AssignmentOptionsRead =
  | { status: "idle" | "loading" }
  | { status: "ready"; options: WorkOperationsAssignmentOptions }
  | { status: "error"; message: string };

type AssignmentOptionsController =
  | { status: "idle" | "loading"; refresh(): Promise<void>; retry(): Promise<void>; search(query: string): Promise<WorkOperationsAssignmentOptions> }
  | { status: "ready"; options: WorkOperationsAssignmentOptions; refresh(): Promise<void>; retry(): Promise<void>; search(query: string): Promise<WorkOperationsAssignmentOptions> }
  | { status: "error"; message: string; refresh(): Promise<void>; retry(): Promise<void>; search(query: string): Promise<WorkOperationsAssignmentOptions> };

function useAssignmentOptions(taskId: string, loadAssignmentOptions: WorkOperationsProps["loadAssignmentOptions"]) {
  const [read, setRead] = useState<AssignmentOptionsRead>({ status: "idle" });
  const loadingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  async function run() {
    if (loadingRef.current || read.status === "loading") return;
    loadingRef.current = true;
    setRead({ status: "loading" });
    try {
      const options = await loadAssignmentOptions(taskId, { refresh: true });
      if (!Array.isArray(options?.assignees) || !Array.isArray(options?.reviewers)) {
        throw new Error("Assignment options response was incomplete. Retry to try again.");
      }
      if (mountedRef.current) setRead({ status: "ready", options: {
        assignees: cleanOptions(options.assignees),
        reviewers: cleanOptions(options.reviewers),
      } });
    } catch (error) {
      if (mountedRef.current) setRead({ status: "error", message: readableError(error) });
    } finally {
      loadingRef.current = false;
    }
  }

  async function search(query: string) {
    const options = await loadAssignmentOptions(taskId, { query });
    if (!Array.isArray(options?.assignees) || !Array.isArray(options?.reviewers)) {
      throw new Error("Assignment options response was incomplete. Retry to try again.");
    }
    return {
      assignees: cleanOptions(options.assignees),
      reviewers: cleanOptions(options.reviewers),
    };
  }

  return { ...read, refresh: run, retry: run, search };
}

function cleanOptions(options: WorkOperationsAssignmentOptions["assignees"]): WorkOperationsAssignmentOptions["assignees"] {
  const seen = new Set<string>();
  return options.flatMap((option) => {
    const id = typeof option?.id === "string" ? option.id.trim() : "";
    const name = typeof option?.name === "string" ? option.name.trim() : "";
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name }];
  });
}

function AssignmentOptionsStatus({ read, retry }: {
  read: AssignmentOptionsController;
  retry(): void;
}) {
  if (read.status === "idle") return null;
  if (read.status === "loading") return <p className={styles.detail} role="status">Loading eligible assignees and reviewers…</p>;
  if (read.status === "error") return (
    <div className={styles.optionsError} role="group" aria-label="Assignment options unavailable">
      <p className={styles.error} role="alert">{read.message}</p>
      <Button type="button" variant="secondary" size="compact" onClick={retry}>Retry loading choices</Button>
    </div>
  );
  return null;
}

function DueDateEditor({
  task,
  onSave,
}: {
  task: WorkOperationsTask;
  onSave: WorkOperationsProps["onUpdateDueDate"];
}) {
  const id = useId();
  const [dueDate, setDueDate] = useState(task.dueDate || "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const input: WorkOperationsDueDateInput = {
      dueDate: dueDate || null,
      expectedDueDate: task.dueDate,
      expectedDueDateRevision: task.dueDateRevision,
    };
    try {
      await onSave(task.id, input);
    } catch (submitError) {
      setError(readableError(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className={styles.dueDateEditor}>
      <summary>Change due date</summary>
      <form className={styles.dueDateForm} onSubmit={(event) => void submit(event)}>
        <Field id={`${id}-date`} label="Due date (blank removes it)">
          {(control) => <Input {...control} type="date" value={dueDate} disabled={busy} onChange={(event) => setDueDate(event.currentTarget.value)} />}
        </Field>
        <p className={styles.detail}>Changes are audited, old due reminders are withdrawn, and active assignees are notified when present.</p>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.formActions}>
          <Button type="submit" variant="secondary" size="compact" loading={busy} loadingLabel="Saving due date">Save due date</Button>
        </div>
      </form>
    </details>
  );
}
