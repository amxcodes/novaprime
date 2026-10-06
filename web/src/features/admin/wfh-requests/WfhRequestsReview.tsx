import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Badge, Button, EmptyState, StateMessage } from "../../../design-system";
import type {
  WfhPendingRequestSummary,
  WfhRequestDecision,
  WfhRequestReviewCommand,
  WfhRequestsReviewProps,
} from "./contracts";
import styles from "./WfhRequestsReview.module.css";

const reasonLimit = 2000;

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return "Date unavailable";
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || "This request could not be reviewed. Refresh the queue and try again.";
}

function RequestDates({ request }: { request: WfhPendingRequestSummary }) {
  const start = formatDate(request.startDate);
  const end = formatDate(request.endDate);
  const sameDay = request.startDate === request.endDate;

  return (
    <p className={styles.dateRange}>
      <time dateTime={request.startDate}>{start}</time>
      {!sameDay ? <><span aria-hidden="true">–</span><time dateTime={request.endDate}>{end}</time></> : null}
    </p>
  );
}

function RequestCard({
  request,
  actionEligibility,
  busy,
  blocked,
  onReview,
}: {
  request: WfhPendingRequestSummary;
  actionEligibility: WfhRequestsReviewProps["actionEligibility"];
  busy: boolean;
  blocked: boolean;
  onReview: WfhRequestsReviewProps["onReview"];
}) {
  const reasonId = useId();
  const declineTriggerRef = useRef<HTMLButtonElement>(null);
  const declineFormRef = useRef<HTMLFormElement>(null);
  const restoreDeclineFocusRef = useRef(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<WfhRequestDecision | null>(null);
  const [pendingDecision, setPendingDecision] = useState<WfhRequestDecision | null>(null);
  const canDecide = actionEligibility.allowed && request.canReview;

  useEffect(() => {
    if (declineOpen || !restoreDeclineFocusRef.current) return;
    restoreDeclineFocusRef.current = false;
    declineTriggerRef.current?.focus();
  }, [declineOpen]);

  useEffect(() => {
    if (!canDecide) {
      setDeclineOpen(false);
      setReason("");
      setError(null);
      setCompleted(null);
    }
  }, [canDecide, request.id]);

  async function submit(decision: WfhRequestDecision, candidateReason?: string) {
    if (!canDecide || busy) return;
    const normalizedReason = candidateReason?.trim();
    const command: WfhRequestReviewCommand = {
      decision,
      ...(normalizedReason ? { reason: normalizedReason } : {}),
    };
    setError(null);
    setCompleted(null);
    setPendingDecision(decision);
    try {
      await onReview(request.id, command);
      closeDeclineForm();
      setReason("");
      setCompleted(decision);
    } catch (reviewError) {
      setError(safeErrorMessage(reviewError));
    } finally {
      setPendingDecision(null);
    }
  }

  function closeDeclineForm() {
    restoreDeclineFocusRef.current = shouldRestoreDeclineTriggerFocus(
      declineFormRef.current,
      document.activeElement,
    );
    setDeclineOpen(false);
  }

  function submitDecline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.length > reasonLimit) return;
    void submit("rejected", reason);
  }

  return (
    <article className={styles.request} aria-labelledby={`${reasonId}-title`}>
      <div className={styles.requestHeading}>
        <div className={styles.requestSummary}>
          <h3 className={styles.requestTitle} id={`${reasonId}-title`}>Work from home</h3>
          <RequestDates request={request} />
        </div>
        <Badge tone="warning">Pending</Badge>
      </div>

      <div className={styles.reasonBlock}>
        <p className={styles.reasonLabel}>Request reason</p>
        <p className={styles.reason}>{request.reason?.trim() || "No reason supplied."}</p>
      </div>

      {error ? <StateMessage className={styles.feedback} kind="error" title="Review was not completed">{error}</StateMessage> : null}
      {completed ? (
        <StateMessage className={styles.feedback} kind="success" title={completed === "approved" ? "Request approved" : "Request declined"}>
          The review was recorded. The queue may refresh to reflect the latest request state.
        </StateMessage>
      ) : null}

      {canDecide ? (
        <div className={styles.actions}>
          <Button
            type="button"
            size="compact"
            variant="primary"
            loading={busy && pendingDecision === "approved"}
            loadingLabel="Approving request"
            disabled={busy || blocked || declineOpen}
            onClick={() => void submit("approved")}
          >
            Approve
          </Button>
          <Button
            type="button"
            size="compact"
            variant="danger"
            ref={declineTriggerRef}
            aria-expanded={declineOpen}
            aria-controls={`${reasonId}-decline`}
            disabled={busy || blocked}
            onClick={() => {
              setError(null);
              setCompleted(null);
              if (declineOpen) closeDeclineForm();
              else setDeclineOpen(true);
            }}
          >
            {declineOpen ? "Close decline" : "Decline"}
          </Button>
        </div>
      ) : (
        actionEligibility.allowed ? (
          <p className={styles.actionNote}>This request is visible, but the server has not marked it eligible for your review.</p>
        ) : null
      )}

      {canDecide ? <form
        className={styles.declineForm}
        id={`${reasonId}-decline`}
        ref={declineFormRef}
        hidden={!declineOpen}
        onSubmit={submitDecline}
      >
          <label className={styles.reasonField} htmlFor={`${reasonId}-reason`}>Reason for declining <span>(optional)</span></label>
          <textarea
            id={`${reasonId}-reason`}
            className={styles.textarea}
            value={reason}
            maxLength={reasonLimit}
            rows={3}
            disabled={busy || blocked}
            aria-describedby={`${reasonId}-reason-count`}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          <div className={styles.declineFooter}>
            <span className={styles.characterCount} id={`${reasonId}-reason-count`}>{reason.length} / {reasonLimit}</span>
            <div className={styles.actions}>
              <Button type="button" size="compact" variant="quiet" disabled={busy || blocked} onClick={closeDeclineForm}>
                Cancel
              </Button>
              <Button type="submit" size="compact" variant="danger" loading={busy && pendingDecision === "rejected"} loadingLabel="Declining request" disabled={busy || blocked}>
                Confirm decline
              </Button>
            </div>
          </div>
          <p className={styles.reasonHelp}>An explanation is optional. If entered, it will be included in the outcome notification.</p>
      </form> : null}
    </article>
  );
}

/** Focus is returned only when closing the form would otherwise hide its active control. */
export function shouldRestoreDeclineTriggerFocus(
  form: Pick<HTMLFormElement, "contains"> | null,
  activeElement: Element | null,
): boolean {
  return Boolean(form && activeElement && form.contains(activeElement));
}

export function WfhRequestsReview({
  readEligibility,
  actionEligibility,
  readState,
  focusRequestId,
  onReview,
}: WfhRequestsReviewProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (readState.status !== "ready" || !focusRequestId ||
        !readState.requests.some((request) => request.id === focusRequestId)) return;
    const target = document.getElementById("wfh-request-" + focusRequestId);
    if (!(target instanceof HTMLElement)) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "center" });
  }, [focusRequestId, readState]);

  if (!readEligibility.allowed) {
    return <StateMessage kind="info" title="Pending WFH requests are unavailable">
      {readEligibility.message || "The pending request list is not available for the current access."}
    </StateMessage>;
  }

  return (
    <section className={styles.section} aria-labelledby="admin-wfh-review-title">
      <header className={styles.header}>
        <div className={styles.headingCopy}>
          <p className={styles.eyebrow}>Availability</p>
          <h2 className={styles.title} id="admin-wfh-review-title">WFH request review</h2>
          <p className={styles.description}>
            Review work-from-home dates and the requester’s note. Approval is checked again against current policy and attendance before it is recorded.
          </p>
        </div>
        {readState.status === "ready" ? (
          <p className={styles.scopeCount}>{readState.requests.length} {readState.requests.length === 1 ? "request" : "requests"} in this view</p>
        ) : null}
      </header>

      {readState.status === "loading" ? (
        <StateMessage kind="loading" title="Loading pending WFH requests">Reading requests available in the current review scope.</StateMessage>
      ) : null}
      {readState.status === "unavailable" ? (
        <StateMessage kind="warning" title="Pending WFH requests are unavailable">{readState.message}</StateMessage>
      ) : null}
      {readState.status === "error" ? (
        <StateMessage kind="error" title="Pending WFH requests could not load">{readState.message}</StateMessage>
      ) : null}
      {readState.status === "ready" && !readState.requests.length ? (
        <EmptyState
          title="No pending WFH requests"
          description={focusRequestId
            ? "The linked request is not in the pending list currently available to your review scope."
            : "There are no requests awaiting review in the current scope."}
        />
      ) : null}

      {readState.status === "ready" && readState.requests.length && !actionEligibility.allowed ? (
        <StateMessage kind="info" title="Review actions are unavailable">
          {actionEligibility.message || "You can view these requests, but cannot decide them with the current access."}
        </StateMessage>
      ) : null}

      {readState.status === "ready" && focusRequestId &&
        !readState.requests.some((request) => request.id === focusRequestId) ? (
        <StateMessage kind="info" title="Showing the authorized WFH queue">
          That request is not in the pending list currently available to your review scope.
        </StateMessage>
      ) : null}

      {readState.status === "ready" && readState.requests.length ? (
        <ol className={styles.requestList} aria-label="Pending work-from-home requests">
          {readState.requests.map((request) => (
            <li
              key={request.id}
              id={"wfh-request-" + request.id}
              tabIndex={request.id === focusRequestId ? -1 : undefined}
              data-notification-focus={request.id === focusRequestId || undefined}
            >
              <RequestCard
                request={request}
                actionEligibility={actionEligibility}
                busy={busyId === request.id}
                blocked={busyId !== null && busyId !== request.id}
                onReview={async (id, command) => {
                  if (busyId !== null) return;
                  setBusyId(id);
                  try {
                    await onReview(id, command);
                  } finally {
                    setBusyId(null);
                  }
                }}
              />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
