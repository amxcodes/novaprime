import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Badge, Button, EmptyState, Field, Input, StateMessage } from "../../../design-system";
import {
  applyReviewerChange,
  canSaveReviewerSelection,
  projectReviewerManagementFocusedRead,
  projectReviewerManagementListRead,
  type ReviewerCandidate,
  type ReviewerManagementAssignment,
  type ReviewerManagementFocusedData,
  type ReviewerManagementPage,
  type ReviewerManagementProps,
  type ReviewerManagementRead,
  type ReviewerManagementSaveResult,
} from "./contracts";
import styles from "./ReviewerManagement.module.css";

type FocusedState = { status: "loading"; assignmentId: string } | ReviewerManagementRead<ReviewerManagementFocusedData>;

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    assigned: "Assigned",
    in_progress: "In progress",
    submitted: "Submitted",
    awaiting_review: "Awaiting review",
    changes_requested: "Changes requested",
    approved: "Approved",
    cancelled: "Cancelled",
  };
  return labels[status] ?? "Current status";
}

function blockedReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  if (["reviewer_unavailable", "no_eligible_reviewer"].includes(reason)) return "No eligible reviewer is currently assigned.";
  if (reason === "missing_evidence") return "Review evidence is missing.";
  return "Review is currently blocked.";
}

function replaceAssignment(page: ReviewerManagementPage, updated: ReviewerManagementAssignment): ReviewerManagementPage {
  return {
    ...page,
    assignments: page.assignments.map((item) => item.assignmentId === updated.assignmentId ? updated : item),
  };
}

function mergeAssignmentPage(current: ReviewerManagementPage, next: ReviewerManagementPage): ReviewerManagementPage {
  const known = new Set(current.assignments.map((item) => item.assignmentId));
  return {
    assignments: [...current.assignments, ...next.assignments.filter((item) => !known.has(item.assignmentId))],
    hasMore: next.hasMore,
    nextCursor: next.nextCursor,
    limit: next.limit,
  };
}

function mergeCandidatePage(current: ReviewerManagementFocusedData, next: ReviewerManagementFocusedData): ReviewerManagementFocusedData {
  const known = new Set(current.eligibleReviewers.items.map((item) => item.id));
  return {
    assignment: next.assignment,
    eligibleReviewers: {
      items: [...current.eligibleReviewers.items, ...next.eligibleReviewers.items.filter((item) => !known.has(item.id))],
      hasMore: next.eligibleReviewers.hasMore,
      nextCursor: next.eligibleReviewers.nextCursor,
      limit: next.eligibleReviewers.limit,
    },
  };
}

function ReadProblem({
  read,
  title,
  onRetry,
}: {
  read: Extract<ReviewerManagementRead<unknown>, { status: "denied" | "stale" | "error" }>;
  title: string;
  onRetry?: () => void;
}) {
  const kind = read.status === "denied" ? "warning" : read.status === "stale" ? "warning" : "error";
  return (
    <div className={styles.readProblem}>
      <StateMessage kind={kind} title={title}>{read.message}</StateMessage>
      {onRetry ? <Button variant="secondary" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}

export function reviewerSaveResultForError(error: unknown): ReviewerManagementSaveResult {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof source.code === "string" ? source.code : "REQUEST_FAILED";
  if (source.httpStatus === 403 || code === "PERMISSION_DENIED") {
    return { status: "denied", message: "Reviewer management access changed. Refresh Work to check current access." };
  }
  if ([
    "ASSIGNMENT_NOT_FOUND", "ASSIGNMENT_REVIEWER_NOT_CHANGEABLE", "REVIEWER_NOT_ASSIGNABLE",
    "SELF_REVIEW_NOT_ALLOWED", "ASSIGNMENT_INPUT_INVALID",
  ].includes(code)) {
    return { status: "stale", message: "The assignment or reviewer eligibility changed. Refresh this assignment before trying again." };
  }
  return { status: "error", message: "NOVA could not confirm that the reviewer changed. Refresh this assignment before trying again." };
}

export function ReviewerManagement({
  initialRead,
  onLoadAssignments,
  onLoadCandidates,
  onSaveReviewer,
}: ReviewerManagementProps) {
  const [listRead, setListRead] = useState(() => projectReviewerManagementListRead(initialRead));
  const [listBusy, setListBusy] = useState(false);
  const [listPageError, setListPageError] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusedRead, setFocusedRead] = useState<FocusedState | null>(null);
  const [focusedBusy, setFocusedBusy] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [focusedQuery, setFocusedQuery] = useState("");
  const [candidatePageError, setCandidatePageError] = useState<string | null>(null);
  const [selectedReviewerId, setSelectedReviewerId] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveResult, setSaveResult] = useState<"saved" | null>(null);
  const listRequestId = useRef(0);
  const focusedRequestId = useRef(0);
  const focusedPanelId = useId();
  const routeHeadingId = `${focusedPanelId}-title`;
  const focusedHeadingId = `${focusedPanelId}-heading`;
  const candidateSearchId = `${focusedPanelId}-candidate-search`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusedHeadingRef = useRef<HTMLHeadingElement>(null);
  const assignmentTriggers = useRef(new Map<string, HTMLButtonElement>());
  const previousFocusedId = useRef<string | null>(null);
  const restoreTriggerId = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (focusedId) {
      const target = focusedHeadingRef.current;
      target?.scrollIntoView({ block: "nearest" });
      target?.focus({ preventScroll: true });
    } else if (previousFocusedId.current) {
      const triggerId = restoreTriggerId.current;
      const target = triggerId
        ? assignmentTriggers.current.get(triggerId) ?? headingRef.current
        : headingRef.current;
      target?.focus({ preventScroll: true });
    }
    previousFocusedId.current = focusedId;
    restoreTriggerId.current = null;
  }, [focusedId]);

  async function loadList(cursor: string | null) {
    const requestId = ++listRequestId.current;
    const append = Boolean(cursor);
    const previous = listRead;
    if (append) setListPageError(null);
    setListBusy(true);
    try {
      const result = projectReviewerManagementListRead(await onLoadAssignments(cursor));
      if (requestId !== listRequestId.current) return;
      if (result.status === "ready" && append && previous.status === "ready") {
        setListRead({ status: "ready", data: mergeAssignmentPage(previous.data, result.data) });
      } else if (append && previous.status === "ready" && result.status !== "ready" && result.status !== "denied") {
        setListPageError(result.message);
      } else {
        setListRead(result);
      }
      if (result.status === "denied") {
        setListPageError(null);
        setFocusedId(null);
        setFocusedRead(result);
      }
    } catch {
      if (requestId === listRequestId.current) {
        if (append && previous.status === "ready") {
          setListPageError("Could not load more assignments. Refresh the list before trying again.");
        } else {
          setListRead({ status: "error", message: "Could not load reviewer-managed assignments. Try again." });
        }
      }
    } finally {
      if (requestId === listRequestId.current) setListBusy(false);
    }
  }

  async function loadCandidates(assignmentId: string, query: string, cursor: string | null) {
    const requestId = ++focusedRequestId.current;
    const append = Boolean(cursor);
    const appliedQuery = query.trim();
    const previous = focusedRead;
    setCandidatePageError(null);
    if (!append) {
      setFocusedRead({ status: "loading", assignmentId });
      setFocusedQuery(appliedQuery);
    }
    setFocusedBusy(true);
    setSaveResult(null);
    try {
      const result = projectReviewerManagementFocusedRead(await onLoadCandidates(assignmentId, appliedQuery, cursor));
      if (requestId !== focusedRequestId.current) return;
      if (result.status === "ready" && result.data.assignment.assignmentId !== assignmentId) {
        setFocusedRead({ status: "error", message: "The reviewer response did not match this assignment. Refresh Work before trying again." });
        setSelectedReviewerId("");
        return;
      }
      if (result.status === "denied") {
        setListRead(result);
        setListPageError(null);
        setFocusedId(null);
        setFocusedRead(result);
        setSelectedReviewerId("");
        return;
      }
      if (result.status === "ready" && append && previous?.status === "ready" && previous.data.assignment.assignmentId === assignmentId) {
        setFocusedRead({ status: "ready", data: mergeCandidatePage(previous.data, result.data) });
      } else if (append && result.status !== "ready" && previous?.status === "ready" && previous.data.assignment.assignmentId === assignmentId) {
        // Keep the candidates already shown if one bounded continuation fails.
        setCandidatePageError(result.message);
      } else {
        setFocusedRead(result);
      }
      if (!append) setSelectedReviewerId("");
    } catch {
      if (requestId === focusedRequestId.current) {
        if (append && previous?.status === "ready" && previous.data.assignment.assignmentId === assignmentId) {
          setCandidatePageError("Could not load more eligible reviewers. Refresh the search before trying again.");
        } else {
          setFocusedRead({ status: "error", message: "Could not load eligible reviewers. Try again." });
        }
      }
    } finally {
      if (requestId === focusedRequestId.current) setFocusedBusy(false);
    }
  }

  function openAssignment(assignmentId: string) {
    setFocusedId(assignmentId);
    setSearchDraft("");
    setFocusedQuery("");
    setSelectedReviewerId("");
    setCandidatePageError(null);
    setFocusedRead({ status: "loading", assignmentId });
    void loadCandidates(assignmentId, "", null);
  }

  function closeFocused() {
    restoreTriggerId.current = focusedId;
    focusedRequestId.current += 1;
    setFocusedId(null);
    setFocusedRead(null);
    setSelectedReviewerId("");
    setCandidatePageError(null);
    setSaveResult(null);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!focusedId || focusedBusy) return;
    void loadCandidates(focusedId, searchDraft.trim(), null);
  }

  async function saveReviewer(assignment: ReviewerManagementAssignment, candidates: ReadonlyArray<ReviewerCandidate>) {
    if (saveBusy || !canSaveReviewerSelection(assignment, candidates, selectedReviewerId)) return;
    const selected = candidates.find((candidate) => candidate.id === selectedReviewerId);
    if (!selected) return;
    setSaveBusy(true);
    setSaveResult(null);
    try {
      let result: ReviewerManagementSaveResult;
      try {
        result = await onSaveReviewer(assignment.assignmentId, selected.id);
      } catch (error) {
        result = reviewerSaveResultForError(error);
      }
      if (result.status === "denied") {
        setListRead(result);
        setFocusedRead(result);
        setFocusedId(null);
        setSelectedReviewerId("");
        return;
      }
      if (result.status === "stale" || result.status === "error") {
        setFocusedRead(result);
        setSelectedReviewerId("");
        return;
      }
      setSaveResult("saved");
      const updated = applyReviewerChange(assignment, selected);
      setListRead((current) => current.status === "ready"
        ? { status: "ready", data: replaceAssignment(current.data, updated) }
        : current);
      setFocusedRead((current) => current?.status === "ready"
        ? { status: "ready", data: { ...current.data, assignment: updated } }
        : current);
      setSelectedReviewerId("");
    } finally {
      setSaveBusy(false);
    }
  }

  const focusedAssignment = focusedRead?.status === "ready" ? focusedRead.data.assignment : null;
  const candidates = focusedRead?.status === "ready" ? focusedRead.data.eligibleReviewers : null;

  return (
    <section className={styles.feature} aria-labelledby={routeHeadingId}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Work · Access-controlled</p>
          <h2 id={routeHeadingId} ref={headingRef} tabIndex={-1}>Reviewer management</h2>
          <p className={styles.description}>
            Assign an eligible reviewer to an active assignment. Reviewer changes are managed separately from assignee changes.
          </p>
        </div>
        <p className={styles.pageCount}>
          {listRead.status === "ready" ? `Showing ${listRead.data.assignments.length} assignments returned in this view.` : "Assignment access is checked by NOVA."}
        </p>
      </header>

      {listRead.status !== "ready" ? (
        <ReadProblem
          read={listRead}
          title={listRead.status === "denied" ? "Reviewer management is unavailable" : listRead.status === "stale" ? "Reviewer data is out of date" : "Reviewer assignments could not load"}
          onRetry={listRead.status === "denied" ? undefined : () => void loadList(null)}
        />
      ) : listRead.data.assignments.length === 0 ? (
        <EmptyState
          title="No active assignments need reviewer management."
          description="Approved and cancelled assignments are excluded. More work appears when it falls within your current reviewer-management scope."
        />
      ) : (
        <>
          <ol className={styles.assignmentList} aria-label="Assignments in reviewer-management scope">
            {listRead.data.assignments.map((assignment) => {
              const active = focusedId === assignment.assignmentId;
              const blocked = blockedReasonLabel(assignment.reviewBlockedReason);
              return (
                <li key={assignment.assignmentId} className={styles.assignmentRow} data-active={active || undefined}>
                  <div className={styles.assignmentSummary}>
                    <div className={styles.assignmentTitleLine}>
                      <h3>{assignment.taskTitle}</h3>
                      <Badge>{statusLabel(assignment.status)}</Badge>
                    </div>
                    <p>Assigned to {assignment.assigneeName}</p>
                    <p>{assignment.currentReviewer
                      ? `Current reviewer: ${assignment.currentReviewer.displayName}`
                      : assignment.reviewRequired ? "No current reviewer" : "Review is not currently required"}</p>
                    {blocked ? <p className={styles.blocked}>{blocked}</p> : null}
                  </div>
                  <div className={styles.rowAction}>
                    <Button
                      variant={active ? "quiet" : "secondary"}
                      size="compact"
                      aria-expanded={active}
                      aria-controls={active ? focusedPanelId : undefined}
                      ref={(node) => {
                        if (node) assignmentTriggers.current.set(assignment.assignmentId, node);
                        else assignmentTriggers.current.delete(assignment.assignmentId);
                      }}
                      onClick={() => active ? closeFocused() : openAssignment(assignment.assignmentId)}
                    >
                      {active ? "Close reviewer panel" : assignment.currentReviewer ? "Change reviewer" : "Choose reviewer"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
          {listRead.data.hasMore && listRead.data.nextCursor && !listPageError ? (
            <div className={styles.listPagination}>
              <p>More assignments are available. NOVA returns at most {listRead.data.limit} per request.</p>
              <Button variant="secondary" loading={listBusy} loadingLabel="Loading more assignments" disabled={listBusy} onClick={() => void loadList(listRead.data.nextCursor)}>
                Load more assignments
              </Button>
            </div>
          ) : null}
          {listPageError ? (
            <div className={styles.pageError}>
              <StateMessage kind="warning" title="More assignments could not load">{listPageError}</StateMessage>
              <Button variant="secondary" disabled={listBusy} onClick={() => void loadList(null)}>Refresh assignments</Button>
            </div>
          ) : null}
          {listBusy ? <p className={styles.inlineStatus} role="status">Loading reviewer assignments…</p> : null}
        </>
      )}

      {focusedId ? (
        <section id={focusedPanelId} className={styles.focused} aria-labelledby={focusedHeadingId} aria-busy={focusedBusy || saveBusy || undefined}>
          <div className={styles.focusHeader}>
            <h3 id={focusedHeadingId} ref={focusedHeadingRef} tabIndex={-1}>Manage assignment reviewer</h3>
            <Button variant="quiet" size="compact" disabled={focusedBusy || saveBusy} onClick={closeFocused}>Close</Button>
          </div>
          {focusedRead?.status === "loading" ? (
            <StateMessage kind="loading" title="Loading assignment reviewer options">NOVA checks the assignment and its eligible reviewer scope.</StateMessage>
          ) : null}
          {focusedRead && focusedRead.status !== "ready" && focusedRead.status !== "loading" ? (
            <ReadProblem
              read={focusedRead}
              title={focusedRead.status === "denied" ? "Access to this assignment was denied" : focusedRead.status === "stale" ? "This assignment is no longer changeable" : "Eligible reviewers could not load"}
              onRetry={focusedRead.status === "denied" ? undefined : () => void loadCandidates(focusedId, focusedQuery, null)}
            />
          ) : null}
          {focusedRead?.status === "ready" && candidates ? (
            <>
              <dl className={styles.assignmentContext}>
                <div><dt>Task</dt><dd>{focusedAssignment?.taskTitle}</dd></div>
                <div><dt>Assigned to</dt><dd>{focusedAssignment?.assigneeName}</dd></div>
                <div><dt>Current reviewer</dt><dd>{focusedAssignment?.currentReviewer?.displayName ?? "None"}</dd></div>
              </dl>
              {!focusedAssignment?.reviewRequired ? (
                <p className={styles.policyNote}>Choosing a reviewer also enables review for this assignment.</p>
              ) : null}
              <form className={styles.searchForm} onSubmit={submitSearch}>
                <Field
                  id={candidateSearchId}
                  label="Search eligible reviewers"
                  hint="Search names within the current assignment scope. Emails and the People directory are not shown."
                >
                  {(control) => <Input {...control} value={searchDraft} maxLength={100} autoComplete="off" disabled={focusedBusy || saveBusy} placeholder="Search by name" onChange={(event) => setSearchDraft(event.currentTarget.value)} />}
                </Field>
                <div className={styles.searchActions}>
                  <Button type="submit" variant="secondary" disabled={focusedBusy || saveBusy} loading={focusedBusy} loadingLabel="Searching eligible reviewers">Search</Button>
                  {searchDraft ? <Button type="button" variant="quiet" disabled={focusedBusy || saveBusy} onClick={() => { setSearchDraft(""); void loadCandidates(focusedId, "", null); }}>Clear search</Button> : null}
                </div>
              </form>

              {candidates.items.length ? (
                <fieldset className={styles.candidateSet} disabled={focusedBusy || saveBusy}>
                  <legend>{focusedQuery ? `Eligible reviewers matching “${focusedQuery}”` : "Eligible reviewers"}</legend>
                  <ul className={styles.candidateList}>
                    {candidates.items.map((candidate) => (
                      <li key={candidate.id}>
                        <label className={styles.candidateOption}>
                          <input
                            type="radio"
                            name={`reviewer-${focusedId}`}
                            value={candidate.id}
                            checked={selectedReviewerId === candidate.id}
                            disabled={candidate.id === focusedAssignment?.currentReviewer?.id}
                            onChange={() => { setSelectedReviewerId(candidate.id); setSaveResult(null); }}
                          />
                          <span>{candidate.displayName}</span>
                          {candidate.id === focusedAssignment?.currentReviewer?.id ? <span className={styles.currentLabel}>Current</span> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              ) : (
                <EmptyState
                  title={focusedQuery ? "No eligible reviewers match this name." : "No eligible reviewers are available."}
                  description="The normal reviewer workflow only offers active people who can review this exact assignment."
                />
              )}

              {candidates.hasMore && candidates.nextCursor && !candidatePageError ? (
                <div className={styles.candidatePagination}>
                  <p>Showing {candidates.items.length} matching eligible reviewers. More may be available.</p>
                  <Button variant="secondary" loading={focusedBusy} loadingLabel="Loading more reviewers" disabled={focusedBusy || saveBusy} onClick={() => void loadCandidates(focusedId, focusedQuery, candidates.nextCursor)}>
                    Load more reviewers
                  </Button>
                </div>
              ) : null}
              {candidatePageError ? (
                <div className={styles.pageError}>
                  <StateMessage kind="warning" title="More eligible reviewers could not load">{candidatePageError}</StateMessage>
                  <Button variant="secondary" disabled={focusedBusy || saveBusy} onClick={() => void loadCandidates(focusedId, focusedQuery, null)}>Refresh reviewer search</Button>
                </div>
              ) : null}
              {saveResult === "saved" ? (
                <StateMessage kind="success" title="Reviewer updated">The selected person is now the reviewer. NOVA enabled review for this assignment.</StateMessage>
              ) : null}
              <div className={styles.saveActions}>
                <Button
                  variant="primary"
                  disabled={saveBusy || focusedBusy || !canSaveReviewerSelection(focusedAssignment!, candidates.items, selectedReviewerId)}
                  loading={saveBusy}
                  loadingLabel="Saving reviewer"
                  onClick={() => { if (focusedAssignment) void saveReviewer(focusedAssignment, candidates.items); }}
                >
                  Save reviewer
                </Button>
                <p>Changing the reviewer does not change the assigned person.</p>
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
