import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type SyntheticEvent } from "react";
import { Badge, Button, Field, Input, SearchableSelect, Select, StateMessage, type SearchableSelectOption, type SelectOption } from "../../design-system";
import { formatAssignmentDueDate, getAssignmentStatus } from "../assignments/presentation";
import { ResponsiveDisclosure } from "./ResponsiveDisclosure";
import { useCompactWorkContainer } from "./use-compact-work-container";
import styles from "./MyAssignments.module.css";
import type {
  AssignmentCandidate,
  AssignmentCandidateRead,
  AssignmentFilters,
  WorkAssignment,
  WorkMyAssignmentsProps,
} from "./contracts";

const statusOptions = [
  ["all", "All statuses"],
  ["assigned", "Assigned"],
  ["in_progress", "In progress"],
  ["submitted", "Submitted"],
  ["awaiting_review", "Awaiting review"],
  ["changes_requested", "Changes requested"],
  ["approved", "Approved"],
] as const;

const dueOptions = [
  ["any", "Any due date"],
  ["overdue", "Overdue"],
  ["today", "Due today"],
  ["upcoming", "Due in the next 7 days"],
  ["unscheduled", "No due date"],
] as const;

const statusSelectOptions: readonly SelectOption[] = statusOptions.map(([value, label]) => ({ value, label }));
const dueSelectOptions: readonly SelectOption[] = dueOptions.map(([value, label]) => ({ value, label }));

export function countAssignmentFilters(filters: AssignmentFilters): number {
  return Number(filters.status !== "all") + Number(filters.due !== "any");
}

export function isEligibleAssignmentCandidate(candidateId: string, candidates: ReadonlyArray<AssignmentCandidate>) {
  return Boolean(candidateId) && candidates.some((candidate) => candidate.id === candidateId);
}

export function validateAssignmentCandidateRequest(
  candidateId: string,
  candidates: ReadonlyArray<AssignmentCandidate>,
  reason: string,
): "candidate" | "reason" | null {
  if (!isEligibleAssignmentCandidate(candidateId, candidates)) return "candidate";
  if (!reason.trim()) return "reason";
  return null;
}

function AssignmentContext({ assignment }: { assignment: WorkAssignment }) {
  if (!assignment.canViewTask) return null;
  return (
    <div className={styles.context}>
      <span>
        {assignment.billingClass === "billable"
          ? "Billable"
          : assignment.billingClass === "non_billable" ? "Non-billable" : "Classification recorded"}
        {assignment.billingPolicyRevision ? ` · policy r${assignment.billingPolicyRevision}` : ""}
      </span>
      <span>
        {assignment.taskDefinition
          ? `Task definition · revision ${assignment.taskDefinition.revision}`
          : "One-off task"}
      </span>
      {assignment.isCorrection ? (
        <span>
          Correction task{assignment.correctionOf?.title ? ` for “${assignment.correctionOf.title}”` : ""}
          {assignment.correctionReason ? ` · ${assignment.correctionReason}` : ""}
        </span>
      ) : null}
      {assignment.reviewRequired ? <span>Review required</span> : null}
      {assignment.resolutionSource === "policy" ? <span>Completed without review</span> : null}
      {assignment.reviewBlockedReason ? <span>Review blocked · no eligible reviewer</span> : null}
    </div>
  );
}

function AssignmentTaskLink({
  assignment,
  href,
  onOpen,
}: {
  assignment: WorkAssignment;
  href?: string;
  onOpen: (taskId: string) => void;
}) {
  if (!assignment.canViewTask) return <>{assignment.title || "Untitled assignment"}</>;

  return (
    <a
      className={styles.taskLink}
      href={href}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
          event.shiftKey || event.altKey || event.currentTarget.target === "_blank") return;
        event.preventDefault();
        onOpen(assignment.taskId);
      }}
    >
      {assignment.title || "Untitled assignment"}
    </a>
  );
}

function CandidateForms({
  assignment,
  onLoadCandidates,
  onRequestReviewer,
  onRequestHandover,
}: {
  assignment: WorkAssignment;
  onLoadCandidates: WorkMyAssignmentsProps["onLoadCandidates"];
  onRequestReviewer: WorkMyAssignmentsProps["onRequestReviewer"];
  onRequestHandover: WorkMyAssignmentsProps["onRequestHandover"];
}) {
  const [candidateRead, setCandidateRead] = useState<AssignmentCandidateRead>();
  const [loading, setLoading] = useState(false);
  const [loadStarted, setLoadStarted] = useState(false);
  const [reviewerId, setReviewerId] = useState("");
  const [handoverTargetId, setHandoverTargetId] = useState("");
  const [reviewerSearchResults, setReviewerSearchResults] = useState<ReadonlyArray<AssignmentCandidate>>([]);
  const [handoverSearchResults, setHandoverSearchResults] = useState<ReadonlyArray<AssignmentCandidate>>([]);
  const [selectedReviewer, setSelectedReviewer] = useState<AssignmentCandidate | null>(null);
  const [selectedHandoverTarget, setSelectedHandoverTarget] = useState<AssignmentCandidate | null>(null);
  const [reviewerError, setReviewerError] = useState<string | null>(null);
  const [reviewerReasonError, setReviewerReasonError] = useState<string | null>(null);
  const [handoverError, setHandoverError] = useState<string | null>(null);
  const [handoverReasonError, setHandoverReasonError] = useState<string | null>(null);
  const canRequestReviewer = assignment.canRequestReviewer === true;
  const canRequestHandover = assignment.canRequestHandover === true;
  if (!canRequestReviewer && !canRequestHandover) return null;

  const load = async (retry = false) => {
    if (loading || (loadStarted && !retry)) return;
    setLoadStarted(true);
    setLoading(true);
    try {
      setCandidateRead(await onLoadCandidates(assignment, { retry }));
    } catch {
      setCandidateRead({ reviewers: [], handoverTargets: [], readError: "REQUEST_FAILED" });
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open && !loadStarted) void load();
  };

  const reviewers = candidateRead?.reviewers ?? [];
  const handoverTargets = candidateRead?.handoverTargets ?? [];
  const hasCandidates = (canRequestReviewer && reviewers.length > 0) ||
    (canRequestHandover && handoverTargets.length > 0);
  const reviewerOptions: SearchableSelectOption[] = reviewers.map((person) => ({ value: person.id, label: person.displayName }));
  const handoverOptions: SearchableSelectOption[] = handoverTargets.map((person) => ({ value: person.id, label: person.displayName }));

  const searchCandidates = async (query: string) => {
    if (!query.trim() && candidateRead) return candidateRead;
    const result = await onLoadCandidates(assignment, { query });
    if (result.readError) throw new Error("Eligible teammates could not be loaded");
    return result;
  };

  function submitReviewer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateAssignmentCandidateRequest(
      reviewerId,
      selectedReviewer && reviewerId === selectedReviewer.id ? [selectedReviewer] : reviewers,
      String(new FormData(event.currentTarget).get("reason") ?? ""),
    );
    if (validationError === "candidate") {
      setReviewerError("Choose a reviewer from the current eligible list.");
      setReviewerReasonError(null);
      return;
    }
    if (validationError === "reason") {
      setReviewerError(null);
      setReviewerReasonError("Explain why a reviewer is needed.");
      return;
    }
    setReviewerError(null);
    setReviewerReasonError(null);
    onRequestReviewer(event, assignment);
  }

  function submitHandover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateAssignmentCandidateRequest(
      handoverTargetId,
      selectedHandoverTarget && handoverTargetId === selectedHandoverTarget.id ? [selectedHandoverTarget] : handoverTargets,
      String(new FormData(event.currentTarget).get("reason") ?? ""),
    );
    if (validationError === "candidate") {
      setHandoverError("Choose a teammate from the current eligible list.");
      setHandoverReasonError(null);
      return;
    }
    if (validationError === "reason") {
      setHandoverError(null);
      setHandoverReasonError("Explain why this should be handed over.");
      return;
    }
    setHandoverError(null);
    setHandoverReasonError(null);
    onRequestHandover(event, assignment);
  }

  return (
    <details className={styles.collaboration} onToggle={handleToggle}>
      <summary>
        {canRequestReviewer && canRequestHandover
          ? "Request reviewer or handover"
          : canRequestReviewer ? "Request a reviewer" : "Request a handover"}
      </summary>
      {loading ? <StateMessage kind="loading">Loading eligible teammates</StateMessage> : null}
      {!loading && candidateRead?.readError ? (
        <div className={styles.candidateState}>
          <StateMessage kind="warning" title="Eligible teammates could not be loaded.">
            Retry to load the current eligible people before sending a request.
          </StateMessage>
          <Button variant="secondary" size="compact" onClick={() => void load(true)} disabled={loading}>Retry</Button>
        </div>
      ) : null}
      {!loading && candidateRead && !candidateRead.readError && !hasCandidates ? (
        <StateMessage kind="info">No eligible teammates are available for this request.</StateMessage>
      ) : null}
      {candidateRead && !candidateRead.readError && canRequestReviewer && reviewers.length ? (
        <form className={styles.requestForm} noValidate onSubmit={submitReviewer}>
          <SearchableSelect label="Reviewer" name="candidateReviewerPersonId" value={reviewerId}
            options={reviewerOptions} placeholder="Choose a reviewer" emptyMessage="No eligible reviewers match this search."
            searchMode="remote"
            onSearch={async (query) => {
              const result = await searchCandidates(query);
              setReviewerSearchResults(result.reviewers);
              return result.reviewers.map((person) => ({ value: person.id, label: person.displayName }));
            }}
            selectedOption={selectedReviewer ? { value: selectedReviewer.id, label: selectedReviewer.displayName } : null}
            required error={reviewerError || undefined} onChange={(value) => {
              setReviewerId(value);
              setSelectedReviewer(value
                ? reviewerSearchResults.find((person) => person.id === value) ?? reviewers.find((person) => person.id === value) ?? null
                : null);
              setReviewerError(null);
            }} />
          <Field label="Why is a reviewer needed?" required error={reviewerReasonError}>
            {(controlProps) => <Input {...controlProps} name="reason" maxLength={2000} required onChange={() => setReviewerReasonError(null)} />}
          </Field>
          <Button type="submit" variant="secondary">Request reviewer</Button>
        </form>
      ) : null}
      {candidateRead && !candidateRead.readError && canRequestHandover && handoverTargets.length ? (
        <form className={styles.requestForm} noValidate onSubmit={submitHandover}>
          <SearchableSelect label="Teammate" name="targetPersonId" value={handoverTargetId}
            options={handoverOptions} placeholder="Choose a teammate" emptyMessage="No eligible teammates match this search."
            searchMode="remote"
            onSearch={async (query) => {
              const result = await searchCandidates(query);
              setHandoverSearchResults(result.handoverTargets);
              return result.handoverTargets.map((person) => ({ value: person.id, label: person.displayName }));
            }}
            selectedOption={selectedHandoverTarget ? { value: selectedHandoverTarget.id, label: selectedHandoverTarget.displayName } : null}
            required error={handoverError || undefined} onChange={(value) => {
              setHandoverTargetId(value);
              setSelectedHandoverTarget(value
                ? handoverSearchResults.find((person) => person.id === value) ?? handoverTargets.find((person) => person.id === value) ?? null
                : null);
              setHandoverError(null);
            }} />
          <Field label="Why should this be handed over?" required error={handoverReasonError}>
            {(controlProps) => <Input {...controlProps} name="reason" maxLength={2000} required onChange={() => setHandoverReasonError(null)} />}
          </Field>
          <Button type="submit" variant="secondary">Request handover</Button>
        </form>
      ) : null}
    </details>
  );
}

function AssignmentActions({
  assignment,
  onLoadCandidates,
  onStart,
  onSubmit,
  onSaveDueDate,
  onRequestReviewer,
  onRequestHandover,
}: {
  assignment: WorkAssignment;
  onLoadCandidates: WorkMyAssignmentsProps["onLoadCandidates"];
  onStart: WorkMyAssignmentsProps["onStart"];
  onSubmit: WorkMyAssignmentsProps["onSubmit"];
  onSaveDueDate: WorkMyAssignmentsProps["onSaveDueDate"];
  onRequestReviewer: WorkMyAssignmentsProps["onRequestReviewer"];
  onRequestHandover: WorkMyAssignmentsProps["onRequestHandover"];
}) {
  const hasPermittedAction = assignment.canStart || assignment.canSubmit || assignment.canEditDueDate ||
    assignment.canRequestReviewer || assignment.canRequestHandover;
  if (!hasPermittedAction) return <span className={styles.noActions}>No actions available</span>;

  return (
    <>
      <div className={styles.quickActions}>
        {assignment.canStart ? (
          <Button onClick={(event) => onStart(assignment, event.currentTarget)}>Start / resume</Button>
        ) : null}
        {assignment.canSubmit ? (
          <Button variant="secondary" onClick={(event) => onSubmit(assignment, event.currentTarget)}>
            Submit
          </Button>
        ) : null}
      </div>
      {assignment.canEditDueDate ? (
        <details className={styles.dueEditor}>
          <summary>Change due date</summary>
          <form onSubmit={(event) => onSaveDueDate(event, assignment)}>
            <Field label="Due date (blank removes it)">
              {(controlProps) => (
                <Input {...controlProps} name="dueDate" type="date" defaultValue={assignment.dueDate ?? ""} />
              )}
            </Field>
            <p>Changes are audited, old due reminders are withdrawn, and active assignees are notified when present.</p>
            <Button type="submit" variant="secondary">Save due date</Button>
          </form>
        </details>
      ) : null}
      <CandidateForms
        assignment={assignment}
        onLoadCandidates={onLoadCandidates}
        onRequestReviewer={onRequestReviewer}
        onRequestHandover={onRequestHandover}
      />
    </>
  );
}

function readMessage(message: string, title: string, kind: "warning" | "error") {
  return <StateMessage kind={kind} title={title}>{message}</StateMessage>;
}

export function MyAssignments({
  read,
  filters,
  savedViews,
  onLoadCandidates,
  focusHeading = false,
  taskDetailHref,
  onApplyFilters,
  onClearFilters,
  onOpenTask,
  onStart,
  onSubmit,
  onSaveDueDate,
  onRequestReviewer,
  onRequestHandover,
  onOlder,
  onNewer,
  onRetry,
}: WorkMyAssignmentsProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [statusValue, setStatusValue] = useState(filters.status);
  const [dueValue, setDueValue] = useState(filters.due);
  const [sectionRef, compact] = useCompactWorkContainer<HTMLElement>();

  useEffect(() => { setStatusValue(filters.status); }, [filters.status]);
  useEffect(() => { setDueValue(filters.due); }, [filters.due]);

  useLayoutEffect(() => {
    if (focusHeading) heading.current?.focus({ preventScroll: true });
  }, [focusHeading, read.status]);

  if (read.status === "loading") {
    return <section ref={sectionRef} className={styles.section} aria-busy="true"><StateMessage kind="loading">Loading your assignments</StateMessage></section>;
  }

  if (read.status === "denied" || read.status === "error") {
    return (
      <section ref={sectionRef} className={styles.section} aria-labelledby="work-assignments-heading">
        <header className={styles.header}>
          <div><p className={styles.eyebrow}>Your work</p><h2 id="work-assignments-heading" ref={heading}>My assignments</h2></div>
        </header>
        {readMessage(read.message, "denied" in read ? "Assignments unavailable" : "Assignments could not load", read.status === "denied" ? "warning" : "error")}
        {read.status === "error" && (read.onRetry || onRetry) ? (
          <Button variant="secondary" onClick={read.onRetry ?? onRetry}>Try again</Button>
        ) : null}
      </section>
    );
  }

  const assignments = read.data.assignments;
  const hasFilter = filters.status !== "all" || filters.due !== "any" || Boolean(filters.search);
  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    onApplyFilters({
      status: String(values.get("status") ?? "all"),
      due: String(values.get("due") ?? "any"),
      search: String(values.get("search") ?? "").trim(),
      cursor: "",
    });
  };

  return (
    <section ref={sectionRef} className={styles.section} aria-labelledby="work-assignments-heading">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Your work</p>
          <h2 id="work-assignments-heading" ref={heading} tabIndex={focusHeading ? -1 : undefined}>My assignments</h2>
          <p className={styles.description}>Your current role determines which assignments and permitted actions appear here.</p>
        </div>
        <p className={styles.pageCount} role="status">
          {assignments.length
            ? `Showing ${assignments.length} assignment${assignments.length === 1 ? "" : "s"} on this page.`
            : hasFilter ? "No assignments match these filters." : "No assignments to show right now."}
        </p>
      </header>

      <form className={styles.filters} onSubmit={apply}>
        <Field label="Search task titles" className={styles.searchField}>
          {(controlProps) => <Input {...controlProps} type="search" name="search" maxLength={100} defaultValue={filters.search} />}
        </Field>
        <ResponsiveDisclosure
          label="Filters"
          compact={compact}
          activeCount={countAssignmentFilters(filters)}
          className={styles.filterDisclosure}
          panelClassName={styles.filterPanel}
        >
          <Select label="Assignment status" name="status" value={statusValue} options={statusSelectOptions}
            placeholder="Choose a status" onChange={setStatusValue} />
          <Select label="Due date" name="due" value={dueValue} options={dueSelectOptions}
            placeholder="Choose a due date" onChange={setDueValue} />
          <div className={styles.filterActions}>
            <Button type="submit" variant="secondary">Apply filters</Button>
            <Button type="button" variant="quiet" onClick={onClearFilters}>Clear</Button>
          </div>
        </ResponsiveDisclosure>
      </form>

      {savedViews ? (
        <ResponsiveDisclosure label="More actions" compact={compact} className={styles.collectionActions}>
          <div className={styles.savedViews}>{savedViews}</div>
        </ResponsiveDisclosure>
      ) : null}

      {read.status === "partial" ? readMessage(read.message, "Some assignments could not be loaded", "warning") : null}
      {assignments.length ? (
        <div className={styles.collection}>
          <div className={styles.collectionHeader} aria-hidden="true">
            <span>Assignment</span>
            <span>Status</span>
            <span>Due date</span>
            <span>Available actions</span>
          </div>
          <ul className={styles.list} aria-label="Your assignments">
            {assignments.map((assignment) => {
              const status = getAssignmentStatus(assignment.status);
              const dueDate = formatAssignmentDueDate(assignment.dueDate);
              return (
                <li className={styles.item} key={assignment.assignmentId}>
                  <div className={styles.task}>
                    <span className={styles.fieldLabel}>Assignment</span>
                    <h3 className={styles.title}>
                      <AssignmentTaskLink
                        assignment={assignment}
                        href={assignment.canViewTask ? taskDetailHref(assignment.taskId) : undefined}
                        onOpen={onOpenTask}
                      />
                    </h3>
                    <AssignmentContext assignment={assignment} />
                  </div>
                  <div className={styles.status}>
                    <span className={styles.fieldLabel}>Status</span>
                    <Badge tone={status.tone} showDot>{status.label}</Badge>
                  </div>
                  <div className={styles.due}>
                    <span className={styles.fieldLabel}>Due date</span>
                    {dueDate
                      ? <time dateTime={assignment.dueDate ?? undefined}>{dueDate}</time>
                      : <span>No due date</span>}
                  </div>
                  <div className={styles.actions}>
                    <span className={styles.fieldLabel}>Available actions</span>
                    <AssignmentActions
                      assignment={assignment}
                      onLoadCandidates={onLoadCandidates}
                      onStart={onStart}
                      onSubmit={onSubmit}
                      onSaveDueDate={onSaveDueDate}
                      onRequestReviewer={onRequestReviewer}
                      onRequestHandover={onRequestHandover}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <StateMessage kind="info" title={hasFilter ? "No assignments match these filters." : "No assignments to show right now."} />
      )}

      <footer className={styles.pagination}>
        {filters.cursor ? <Button variant="secondary" onClick={onNewer}>Newer assignments</Button> : null}
        {read.data.hasMore && read.data.nextCursor ? (
          <Button variant="secondary" onClick={() => onOlder(read.data.nextCursor!)}>Older assignments</Button>
        ) : null}
      </footer>
    </section>
  );
}
