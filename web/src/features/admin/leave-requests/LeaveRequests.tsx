import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Badge, Button, EmptyState, Field, StateMessage } from "../../../design-system";
import type {
  LeaveDecision,
  LeaveRequestActionKind,
  LeaveRequestActionState,
  LeaveRequestSummary,
  LeaveRequestsProps,
} from "./contracts";
import styles from "./LeaveRequests.module.css";

const fallbackActionError = "The leave request could not be updated. Refresh the list and try again.";

export function LeaveRequests(props: LeaveRequestsProps) {
  const id = useId();
  const [localAction, setLocalAction] = useState<LeaveRequestActionState>({ status: "idle" });
  const actionLock = useRef(false);
  const action = props.actions.status === "pending"
    ? props.actions
    : localAction.status === "idle" ? props.actions : localAction;
  const busy = action.status === "pending" || actionLock.current;

  useEffect(() => {
    if (props.read.status !== "ready" || !props.focusRequestId ||
        !props.read.requests.some((request) => request.id === props.focusRequestId)) return;
    const target = document.getElementById("leave-request-" + props.focusRequestId);
    if (!(target instanceof HTMLElement)) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "center" });
  }, [props.focusRequestId, props.read]);

  async function runAction(
    requestId: string,
    actionKind: LeaveRequestActionKind,
    successMessage: string,
    callback: () => void | Promise<void>,
  ) {
    if (actionLock.current || props.actions.status === "pending") return;
    actionLock.current = true;
    setLocalAction({ status: "pending", requestId, action: actionKind });
    try {
      await callback();
      setLocalAction({ status: "feedback", kind: "success", message: successMessage });
    } catch (error) {
      const message = props.formatError?.(error)?.trim() || fallbackActionError;
      setLocalAction({ status: "feedback", kind: "error", message });
    } finally {
      actionLock.current = false;
    }
  }

  return (
    <section className={styles.section} aria-labelledby={`${id}-title`} aria-busy={busy || undefined}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Availability</p>
          <h2 className={styles.title} id={`${id}-title`}>Leave review</h2>
          <p className={styles.description}>
            Review pending requests in the scope provided by the server. Attendance conflicts require a separate, audited decision.
          </p>
        </div>
        {props.read.status === "ready" ? (
          <span className={styles.count} aria-label={`${props.read.requests.length} pending leave requests`}>
            {props.read.requests.length} {props.read.requests.length === 1 ? "request" : "requests"}
          </span>
        ) : null}
      </header>

      {action.status === "pending" ? (
        <StateMessage kind="loading" title="Updating leave request">
          {action.action === "resolve-conflict" ? "Saving the leave decision and attendance recovery note." : "Saving the review decision."}
        </StateMessage>
      ) : action.status === "feedback" ? (
        <StateMessage kind={action.kind} title={action.kind === "success" ? "Leave request updated" : "Action not completed"}>
          {action.message}
        </StateMessage>
      ) : null}

      <ReadContent read={props.read}>
        {(requests) => requests.length ? (
          <>
          {props.focusRequestId && !requests.some((request) => request.id === props.focusRequestId) ? (
            <StateMessage kind="info" title="Showing the authorized leave queue">
              That request is not in the pending list currently available to your review scope.
            </StateMessage>
          ) : null}
          <ul className={styles.requestList} aria-label="Pending leave requests">
            {requests.map((request) => (
              <LeaveRequestCard
                key={request.id}
                request={request}
                focused={request.id === props.focusRequestId}
                disabled={busy}
                pendingAction={action.status === "pending" && action.requestId === request.id ? action.action : null}
                onReview={(decision) => runAction(
                  request.id,
                  decision === "approved" ? "approve" : "reject",
                  decision === "approved" ? "Leave approved." : "Leave rejected.",
                  () => props.onReview(request.id, decision),
                )}
                onResolveConflict={(decision, note) => runAction(
                  request.id,
                  "resolve-conflict",
                  decision === "approved"
                    ? "Leave approved; attendance was preserved."
                    : "Leave rejected; attendance was preserved.",
                  () => props.onResolveConflict(request.id, decision, note),
                )}
              />
            ))}
          </ul>
          </>
        ) : (
          <EmptyState
            title="No pending leave requests"
            description={props.focusRequestId
              ? "The linked request is not in the pending list currently available to your review scope."
              : "There are no pending requests in the authorized scope currently supplied to this view."}
          />
        )}
      </ReadContent>
    </section>
  );
}

function ReadContent({
  read,
  children,
}: {
  read: LeaveRequestsProps["read"];
  children: (requests: ReadonlyArray<LeaveRequestSummary>) => ReactNode;
}) {
  switch (read.status) {
    case "loading":
      return <StateMessage kind="loading" title="Loading leave requests">Reading the pending requests available to your current scope.</StateMessage>;
    case "unavailable":
      return <StateMessage kind="info" title="Leave requests unavailable">{read.message}</StateMessage>;
    case "error":
      return <StateMessage kind="error" title="Leave requests could not load">{read.message}</StateMessage>;
    case "ready":
      return children(read.requests);
  }
}

function LeaveRequestCard({
  request,
  focused,
  disabled,
  pendingAction,
  onReview,
  onResolveConflict,
}: {
  request: LeaveRequestSummary;
  focused: boolean;
  disabled: boolean;
  pendingAction: LeaveRequestActionKind | null;
  onReview: (decision: LeaveDecision) => void;
  onResolveConflict: (decision: LeaveDecision, note: string) => void;
}) {
  const id = useId();
  const [decision, setDecision] = useState<LeaveDecision | "">("");
  const [note, setNote] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [noteError, setNoteError] = useState("");
  const conflictNoteId = `${id}-note`;
  const isPending = request.status === "pending" || request.status === "requested";
  const statusTone = isPending ? "warning" : "neutral";
  const title = `${request.leaveType} leave`;
  const canReview = request.canReview === true;
  // Conflicted requests can only use the recovery path; ordinary review is never an escape hatch.
  const hasConflict = request.hasConflict === true;
  const canResolveConflict = request.canResolveConflict === true;

  function submitConflict(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedNote = note.trim();
    if (!decision) {
      setDecisionError("Choose whether to approve or reject the leave request.");
      return;
    }
    setDecisionError("");
    if (!trimmedNote || trimmedNote.length > 2000) {
      setNoteError("Enter a resolution note from 1 to 2,000 characters.");
      return;
    }
    setNoteError("");
    onResolveConflict(decision, trimmedNote);
  }

  return (
    <li
      className={styles.requestItem}
      id={"leave-request-" + request.id}
      tabIndex={focused ? -1 : undefined}
      data-notification-focus={focused || undefined}
    >
      <article className={styles.requestCard} aria-labelledby={`${id}-title`}>
        <div className={styles.requestDetails}>
          <div className={styles.cardHeader}>
            <div className={styles.recordHeading}>
              <h3 className={styles.requestTitle} id={`${id}-title`}>{title}</h3>
              <Badge tone={statusTone} showDot>{statusLabel(request.status)}</Badge>
            </div>
            {hasConflict ? <Badge tone="danger">Attendance conflict</Badge> : null}
          </div>
          <p className={styles.dateRange}>
            <time dateTime={request.startDate}>{request.startDate}</time>
            <span aria-hidden="true"> – </span>
            <time dateTime={request.endDate}>{request.endDate}</time>
          </p>
          <p className={styles.reason}>{request.reason?.trim() || "No reason supplied."}</p>
        </div>

        {!canReview ? (
          <div className={styles.actionNotice}>
            <StateMessage kind="info" title="Review actions unavailable">
              This request is visible in the list, but the server has not marked it eligible for review.
            </StateMessage>
          </div>
        ) : hasConflict ? canResolveConflict ? (
          <ConflictResolutionForm
            id={id}
            disabled={disabled}
            pending={pendingAction === "resolve-conflict"}
            decision={decision}
            note={note}
            noteId={conflictNoteId}
            decisionError={decisionError}
            noteError={noteError}
            onDecision={(value) => { setDecision(value); setDecisionError(""); }}
            onNote={(value) => { setNote(value); setNoteError(""); }}
            onSubmit={submitConflict}
          />
        ) : (
          <div className={styles.actionNotice}>
            <StateMessage kind="warning" title="Attendance recovery access required">
              This conflicted request cannot be decided until an authorized reviewer also has attendance recovery access.
            </StateMessage>
          </div>
        ) : (
          <div className={styles.actions} role="group" aria-label={`Actions for ${title}`}>
            <Button
              variant="primary"
              disabled={disabled}
              loading={pendingAction === "approve"}
              loadingLabel="Saving leave decision"
              onClick={() => onReview("approved")}
            >
              Approve
            </Button>
            <Button
              variant="danger"
              disabled={disabled}
              loading={pendingAction === "reject"}
              loadingLabel="Saving leave decision"
              onClick={() => onReview("rejected")}
            >
              Reject
            </Button>
          </div>
        )}
      </article>
    </li>
  );
}

function ConflictResolutionForm({
  id,
  disabled,
  pending,
  decision,
  note,
  noteId,
  decisionError,
  noteError,
  onDecision,
  onNote,
  onSubmit,
}: {
  id: string;
  disabled: boolean;
  pending: boolean;
  decision: LeaveDecision | "";
  note: string;
  noteId: string;
  decisionError: string;
  noteError: string;
  onDecision: (decision: LeaveDecision) => void;
  onNote: (note: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className={styles.conflictForm} onSubmit={onSubmit} noValidate aria-labelledby={`${id}-resolution-title`}>
      <div className={styles.conflictIntro}>
        <h4 id={`${id}-resolution-title`}>Resolve with attendance preserved</h4>
        <p>Choose the leave outcome and add a note. The decision and note are written to the audit history.</p>
      </div>
      <fieldset
        className={styles.decisionSet}
        disabled={disabled}
        aria-describedby={decisionError ? `${id}-decision-error` : undefined}
      >
        <legend>Leave decision</legend>
        <label className={styles.decisionOption}>
          <input
            type="radio"
            name={`${id}-decision`}
            value="approved"
            checked={decision === "approved"}
            required
            onChange={() => onDecision("approved")}
          />
          <span>Approve leave; preserve attendance</span>
        </label>
        <label className={styles.decisionOption}>
          <input
            type="radio"
            name={`${id}-decision`}
            value="rejected"
            checked={decision === "rejected"}
            required
            onChange={() => onDecision("rejected")}
          />
          <span>Reject leave; preserve attendance</span>
        </label>
      </fieldset>
      {decisionError ? <p className={styles.fieldError} id={`${id}-decision-error`} role="alert">{decisionError}</p> : null}
      <Field
        id={noteId}
        label="Resolution note"
        hint="Required · saved in audit history · up to 2,000 characters."
        error={noteError}
        required
      >
        {(control) => (
          <textarea
            {...control}
            className={styles.noteInput}
            name="note"
            value={note}
            rows={3}
            maxLength={2000}
            disabled={disabled}
            onChange={(event) => onNote(event.currentTarget.value)}
          />
        )}
      </Field>
      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          disabled={disabled}
          loading={pending}
          loadingLabel="Saving conflict decision"
        >
          Resolve conflict
        </Button>
      </div>
    </form>
  );
}

function statusLabel(status: string): string {
  if (status === "requested") return "Requested";
  if (status === "pending") return "Pending";
  return status.replaceAll("_", " ");
}
