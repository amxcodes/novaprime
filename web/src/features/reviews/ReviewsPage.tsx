import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Badge, Button, EmptyState, StateMessage } from "../../design-system";
import type {
  PendingReviewReadState,
  PendingReviewSummary,
  ReviewContextReadState,
  ReviewCycleSummary,
  ReviewFeedbackDraft,
  ReviewsPageProps,
} from "./contracts";
import { REVIEW_FEEDBACK_LIMIT, validateReviewFeedback } from "./review-feedback";
import styles from "./ReviewsPage.module.css";

function readable(value: string | null | undefined, fallback = "Not provided"): string {
  if (!value?.trim()) return fallback;
  return value.replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

function dateTime(value: string | null | undefined): { iso: string; label: string } | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  return { iso: parsed.toISOString(), label: formatter.format(parsed) };
}

export function focusReviewCard(target: Pick<HTMLElement, "scrollIntoView" | "focus"> | null): void {
  if (!target) return;
  target.scrollIntoView({ block: "nearest" });
  target.focus({ preventScroll: true });
}

function DateLabel({ value, prefix }: { value: string | null | undefined; prefix?: string }) {
  const formatted = dateTime(value);
  return formatted
    ? <time dateTime={formatted.iso}>{prefix ? `${prefix} ` : ""}{formatted.label}</time>
    : <span>{prefix ? `${prefix} ` : ""}Date unavailable</span>;
}

function ReadState({
  state,
  onRetry,
  labels,
}: {
  state: Extract<PendingReviewReadState | ReviewContextReadState, { status: "loading" | "denied" | "error" | "unavailable" }>;
  onRetry?: () => void;
  labels: { loading: string; denied: string; error: string; unavailable?: string };
}) {
  if (state.status === "loading") {
    return <StateMessage kind="loading" title={labels.loading}>The current authorized review data is being loaded.</StateMessage>;
  }
  if (state.status === "denied") {
    return (
      <div className={styles.stateWithAction}>
        <StateMessage kind="warning" title={labels.denied}>
          {state.message || "This review data is not available with the current access."}
        </StateMessage>
        {onRetry ? <Button variant="secondary" onClick={onRetry}>Retry</Button> : null}
      </div>
    );
  }
  if (state.status === "unavailable") {
    return <StateMessage kind="warning" title={labels.unavailable || "Review context is unavailable"}>
      {state.message || "The review is no longer open to you or is outside your current access."}
    </StateMessage>;
  }
  return (
    <div className={styles.stateWithAction}>
      <StateMessage kind="error" title={labels.error}>{state.message}</StateMessage>
      {onRetry ? <Button variant="secondary" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}

function ReviewDecisionForm({
  review,
  onSubmit,
  onDraftChange,
  pending,
  sending,
}: {
  review: PendingReviewSummary;
  onSubmit: ReviewsPageProps["onRequestChanges"];
  onDraftChange: ReviewsPageProps["onDraftChange"];
  pending: boolean;
  sending: boolean;
}) {
  const id = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [feedback, setFeedback] = useState(review.draft?.feedback ?? "");
  const [confirmed, setConfirmed] = useState(
    review.draft?.acknowledgedReviewCycleId === review.reviewCycleId,
  );
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const staleDraft = Boolean(review.draft && review.draft.sourceReviewCycleId !== review.reviewCycleId);
  const helpId = `${id}-help`;
  const countId = `${id}-count`;
  const errorId = `${id}-error`;

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const makeDraft = (nextFeedback: string, nextConfirmed: boolean): ReviewFeedbackDraft => ({
    sourceReviewCycleId: review.draft?.sourceReviewCycleId || review.reviewCycleId,
    acknowledgedReviewCycleId: nextConfirmed && staleDraft ? review.reviewCycleId : null,
    feedback: nextFeedback,
  });

  const updateFeedback = (value: string) => {
    setFeedback(value);
    setError(null);
    onDraftChange(review.assignmentId, makeDraft(value, confirmed));
  };

  const updateConfirmation = (checked: boolean) => {
    setConfirmed(checked);
    setError(null);
    onDraftChange(review.assignmentId, makeDraft(feedback, checked));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const validation = validateReviewFeedback(feedback, {
      staleDraft,
      confirmedCurrentCycle: confirmed,
    });
    if (!validation.ok) {
      setError(validation.reason === "required"
        ? "Enter what needs to change before sending this review back."
        : validation.reason === "too_long"
          ? `Feedback must be no longer than ${REVIEW_FEEDBACK_LIMIT} characters.`
          : "Review the newer submission and confirm that this feedback still applies.");
      if (validation.reason === "stale_cycle_confirmation") confirmationRef.current?.focus();
      else inputRef.current?.focus();
      return;
    }

    setError(null);
    setFeedback(validation.feedback);
    onDraftChange(review.assignmentId, makeDraft(validation.feedback, confirmed));
    try {
      await onSubmit(review, validation.feedback);
    } catch {
      setError("NOVA could not send this decision. Your feedback is still here; try again.");
    }
  };

  const close = () => {
    setIsOpen(false);
    setError(null);
    requestAnimationFrame(() => toggleRef.current?.focus());
  };

  return (
    <div className={styles.decisionFormRegion}>
      <Button
        ref={toggleRef}
        variant="secondary"
        size="compact"
        aria-expanded={isOpen}
        aria-controls={`${id}-form`}
        disabled={pending}
        onClick={() => setIsOpen((open) => !open)}
      >
        {isOpen ? "Close feedback" : "Request changes"}
      </Button>
      <form
        id={`${id}-form`}
        className={styles.feedbackForm}
        hidden={!isOpen}
        noValidate
        onSubmit={(event) => void submit(event)}
      >
          {staleDraft ? (
            <StateMessage kind="warning" title="A newer review cycle is open">
              Your earlier feedback is preserved. Read this submission before deciding whether it still applies.
            </StateMessage>
          ) : null}
          <label className={styles.feedbackField} htmlFor={`${id}-feedback`}>
            <span className={styles.feedbackLabel}>What needs to change?</span>
            <textarea
              ref={inputRef}
              id={`${id}-feedback`}
              name="feedback"
              className={styles.feedbackInput}
              value={feedback}
              maxLength={REVIEW_FEEDBACK_LIMIT}
              disabled={pending}
              aria-invalid={error && (!feedback.trim() || feedback.length > REVIEW_FEEDBACK_LIMIT) ? true : undefined}
              aria-describedby={[helpId, countId, error ? errorId : null].filter(Boolean).join(" ")}
              onChange={(event) => updateFeedback(event.currentTarget.value)}
            />
          </label>
          <p id={helpId} className={styles.help}>
            Be specific about the update needed. This note is saved in review history and sent to the assignee.
          </p>
          <p id={countId} className={styles.characterCount} role="status" aria-live="polite">
            {feedback.length} / {REVIEW_FEEDBACK_LIMIT} characters
          </p>
          {staleDraft ? (
            <label className={styles.confirmation}>
              <input
                type="checkbox"
                ref={confirmationRef}
                name="confirmCurrentCycle"
                checked={confirmed}
                aria-required="true"
                aria-invalid={error && !confirmed ? true : undefined}
                aria-describedby={error && !confirmed ? errorId : undefined}
                disabled={pending}
                onChange={(event) => updateConfirmation(event.currentTarget.checked)}
              />
              <span>I reviewed this newer submission and confirmed that this feedback still applies.</span>
            </label>
          ) : null}
          {error ? <p id={errorId} className={styles.formError} role="alert">{error}</p> : null}
          <div className={styles.formActions}>
            <Button type="submit" loading={sending} loadingLabel="Sending review decision" disabled={pending}>
              Send back for changes
            </Button>
            <Button type="button" variant="quiet" onClick={close} disabled={pending}>Keep reviewing</Button>
          </div>
      </form>
    </div>
  );
}

function ReviewRow({
  review,
  props,
  focus,
}: {
  review: PendingReviewSummary;
  props: ReviewsPageProps;
  focus: boolean;
}) {
  const [pendingAction, setPendingAction] = useState<"approve" | "changes" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submitted = dateTime(review.submittedAt);
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!focus) return;
    const frame = requestAnimationFrame(() => focusReviewCard(cardRef.current));
    return () => cancelAnimationFrame(frame);
  }, [focus]);

  const approve = async () => {
    if (pendingAction) return;
    setPendingAction("approve");
    setError(null);
    try {
      await props.onApprove(review);
    } catch {
      setError("NOVA could not approve this work. Refresh the review queue before trying again.");
    } finally {
      setPendingAction(null);
    }
  };

  const requestChanges: ReviewsPageProps["onRequestChanges"] = async (target, feedback) => {
    if (pendingAction) throw new Error("A review decision is already in progress.");
    setPendingAction("changes");
    setError(null);
    try {
      await props.onRequestChanges(target, feedback);
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <li className={styles.reviewItem}>
      <article
        ref={cardRef}
        className={styles.reviewCard}
        tabIndex={-1}
        aria-labelledby={`review-title-${review.assignmentId}`}
      >
        <div className={styles.reviewSummary}>
          <div className={styles.reviewTitleBlock}>
            <h3 className={styles.reviewTitle} id={`review-title-${review.assignmentId}`}>{review.title}</h3>
            <div className={styles.reviewMetadata}>
              <Badge tone="info">Cycle {review.cycleNumber}</Badge>
              <span>{submitted ? <DateLabel value={submitted.iso} prefix="Submitted" /> : "Submission date unavailable"}</span>
            </div>
          </div>
          <div className={styles.rowActions}>
            <Button
              variant="secondary"
              size="compact"
              aria-label={`Open review context for ${review.title}`}
              onClick={() => props.onOpenContext(review.assignmentId)}
            >
              Review context
            </Button>
            {review.canDecide ? (
              <>
                <Button loading={pendingAction === "approve"} loadingLabel="Approving work" disabled={Boolean(pendingAction)} onClick={() => void approve()}>
                  Approve
                </Button>
                <ReviewDecisionForm
                  review={review}
                  onSubmit={requestChanges}
                  onDraftChange={props.onDraftChange}
                  pending={Boolean(pendingAction)}
                  sending={pendingAction === "changes"}
                />
              </>
            ) : null}
          </div>
        </div>
        {error ? <p className={styles.formError} role="alert">{error}</p> : null}
      </article>
    </li>
  );
}

function QueueContent({ state, props }: { state: PendingReviewReadState; props: ReviewsPageProps }) {
  if (state.status === "loading" || state.status === "denied" || state.status === "error") {
    return <ReadState state={state} onRetry={props.onRetryQueue} labels={{
      loading: "Loading pending reviews",
      denied: "Pending reviews are unavailable",
      error: "Pending reviews could not be loaded",
    }} />;
  }
  if (state.status === "empty") {
    return <EmptyState
      className={styles.empty}
      title="No pending reviews"
      description="There are no submitted assignments waiting for your review in this request."
    />;
  }
  if (state.reviews.length === 0) {
    return <EmptyState
      className={styles.empty}
      title="No pending reviews"
      description="There are no submitted assignments waiting for your review in this request."
    />;
  }
  return (
    <div className={styles.queueContent}>
      <p className={styles.scopeNote}>
        {state.reviews.length} loaded · this request returns up to {state.requestLimit} pending reviews.
      </p>
      <ul className={styles.reviewList} aria-label="Pending work reviews">
        {state.reviews.map((review) => (
          <ReviewRow
            key={`${review.assignmentId}:${review.reviewCycleId}`}
            review={review}
            props={props}
            focus={props.focusAssignmentId === review.assignmentId}
          />
        ))}
      </ul>
    </div>
  );
}

function ReviewContext({ state, onRetry }: { state: ReviewContextReadState; onRetry?: () => void }) {
  if (state.status !== "ready") {
    return <ReadState state={state} onRetry={onRetry} labels={{
      loading: "Loading review context",
      denied: "Review context is unavailable",
      unavailable: "Review context is no longer available",
      error: "Review context could not be loaded",
    }} />;
  }

  const { review, history, historyTruncated } = state.detail;
  const workstream = [review.clientName, review.workstreamName, review.groupName].filter(Boolean).join(" · ");
  const historyNewestFirst = [...history].reverse();

  return (
    <div className={styles.contextContent}>
      <h3 className={styles.contextTaskTitle}>{review.taskTitle || "Task details unavailable"}</h3>
      <dl className={styles.summary}>
        <div><dt>Assignee</dt><dd>{review.assigneeName || "Not provided"}</dd></div>
        <div><dt>Workstream</dt><dd>{workstream || "Not provided"}</dd></div>
        <div><dt>Task status</dt><dd>{readable(review.taskStatus)}</dd></div>
        <div><dt>Priority</dt><dd>{readable(review.priority)}</dd></div>
        <div><dt>Due date</dt><dd>{review.dueDate || "Not provided"}</dd></div>
        <div><dt>Submitted</dt><dd><DateLabel value={review.submittedAt} /></dd></div>
      </dl>
      {review.taskDescription?.trim() ? <p className={styles.taskDescription}>{review.taskDescription}</p> : null}
      <p className={styles.scopeNote}>
        NOVA stores the task description and review decisions. No submitted file or attachment is returned for this assignment.
      </p>
      <section className={styles.history} aria-labelledby="review-history-title">
        <div className={styles.historyHeader}>
          <h3 className={styles.subheading} id="review-history-title">Review history</h3>
          <span className={styles.scopeNote}>{history.length} {history.length === 1 ? "cycle" : "cycles"} returned</span>
        </div>
        {historyTruncated ? (
          <StateMessage kind="warning" title="This history is bounded">
            The assignment has more review cycles than this response includes. Showing the {history.length} most recent cycles.
          </StateMessage>
        ) : null}
        {historyNewestFirst.length ? (
          <ol className={styles.historyList}>
            {historyNewestFirst.map((cycle) => <HistoryEntry key={cycle.reviewCycleId} cycle={cycle} />)}
          </ol>
        ) : (
          <EmptyState className={styles.empty} title="No review history" description="No review cycles were returned for this assignment." />
        )}
      </section>
    </div>
  );
}

function HistoryEntry({ cycle }: { cycle: ReviewCycleSummary }) {
  const tone = cycle.decision === "approved" ? "success" : cycle.decision === "changes_requested" ? "warning" : "neutral";
  const decision = cycle.decision ? readable(cycle.decision) : "Awaiting review";

  return (
    <li className={styles.historyEntry}>
      <div className={styles.historyEntryHeader}>
        <h4 className={styles.historyTitle}>Cycle {cycle.cycleNumber}{cycle.isCurrent ? " · current" : ""}</h4>
        <Badge tone={tone}>{decision}</Badge>
      </div>
      <p className={styles.historyDate}>
        {cycle.decidedAt
          ? <DateLabel value={cycle.decidedAt} prefix="Decided" />
          : <DateLabel value={cycle.submittedAt} prefix="Submitted" />}
      </p>
      {cycle.feedback ? <blockquote className={styles.historyFeedback}>{cycle.feedback}</blockquote> : null}
    </li>
  );
}

export function ReviewsPage(props: ReviewsPageProps) {
  const queueTitleId = useId();
  const contextTitleId = useId();
  return (
    <div className={styles.page}>
      {props.context ? (
        <section className={styles.section} aria-labelledby={contextTitleId}>
          <header className={styles.header}>
            <div>
              <p className={styles.eyebrow}>Reviewer-only detail</p>
              <h2 className={styles.title} id={contextTitleId}>Review context</h2>
              <p className={styles.description}>Task details and the returned review history for this assignment.</p>
            </div>
          </header>
          <ReviewContext state={props.context} onRetry={props.onRetryContext} />
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby={queueTitleId}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Work</p>
            <h2 className={styles.title} id={queueTitleId}>Pending reviews</h2>
            <p className={styles.description}>Review submitted work available to you. Decision controls appear only when the row allows a decision.</p>
          </div>
        </header>
        <QueueContent state={props.queue} props={props} />
      </section>
    </div>
  );
}
