import { useEffect, useId, useRef, useState } from "react";
import { Badge, Button, SectionHeading, StateMessage } from "../../design-system";
import type {
  CollaborationRequestDecision,
  CollaborationRequestKind,
  CollaborationRequestReadState,
  CollaborationRequestSummary,
  FocusedCollaborationRequest,
  WorkCollaborationRequestsProps,
} from "./contracts";
import styles from "./WorkCollaborationRequests.module.css";

function requestStatus(request: CollaborationRequestSummary): string {
  return request.status;
}

function isPending(request: CollaborationRequestSummary): boolean {
  return requestStatus(request) === "pending";
}

function outcomeLabel(status: string): string {
  if (status === "accepted") return "Accepted";
  if (status === "declined") return "Declined";
  if (status === "withdrawn") return "Withdrawn";
  if (status === "expired") return "Expired";
  return status ? status.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) : "Resolved";
}

function dateLabel(value: string): { iso: string; label: string } | null {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  return {
    iso: date.toISOString(),
    label: new Intl.DateTimeFormat(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }).format(date),
  };
}

function updateSet<T>(current: ReadonlySet<T>, key: T, add: boolean): ReadonlySet<T> {
  const next = new Set(current);
  if (add) next.add(key);
  else next.delete(key);
  return next;
}

function RequestReadState({
  kind,
  state,
}: {
  kind: CollaborationRequestKind;
  state: Extract<CollaborationRequestReadState, { status: "loading" | "denied" | "error" }>;
}) {
  const label = kind === "reviewer" ? "reviewer" : "handover";
  if (state.status === "loading") {
    return <StateMessage kind="loading" title={`Loading ${label} requests`}>The authorized request list is being loaded.</StateMessage>;
  }

  const title = state.status === "denied"
    ? `${label === "reviewer" ? "Reviewer" : "Handover"} requests are unavailable`
    : `${label === "reviewer" ? "Reviewer" : "Handover"} requests could not be loaded`;
  return (
    <div className={styles.readFailure}>
      <StateMessage kind={state.status === "denied" ? "warning" : "error"} title={title}>
        {state.message || (state.status === "denied"
          ? "Access to this request list is not available right now."
          : "Try again when the request service is available.")}
      </StateMessage>
      {state.onRetry ? <Button variant="secondary" onClick={state.onRetry}>Try again</Button> : null}
    </div>
  );
}

function RequestCard({
  kind,
  request,
  onResolve,
  onActionFocusChange,
  onResolvedStatusRef,
  onCardRef,
  deepLinked,
}: {
  kind: CollaborationRequestKind;
  request: CollaborationRequestSummary;
  onResolve: WorkCollaborationRequestsProps["onResolve"];
  onActionFocusChange: (requestId: string, focused: boolean) => void;
  onResolvedStatusRef: (requestId: string, element: HTMLDivElement | null) => void;
  onCardRef: (requestId: string, element: HTMLElement | null) => void;
  deepLinked: boolean;
}) {
  const [busyActions, setBusyActions] = useState<ReadonlySet<CollaborationRequestDecision>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const taskTitle = request.title.trim() || "Task assignment";
  const label = kind === "reviewer" ? "reviewer request" : "handover request";
  const created = dateLabel(request.createdAt);
  const expires = dateLabel(request.expiresAt);
  const pending = isPending(request);
  const outcome = outcomeLabel(requestStatus(request));
  const resolved = dateLabel(request.resolvedAt || "");
  const hasAction = pending && (request.canAccept || request.canDecline || request.canWithdraw);

  const resolve = async (decision: CollaborationRequestDecision) => {
    if (busyActions.size) return;
    setError(null);
    setBusyActions((current) => new Set(current).add(decision));
    try {
      await onResolve(kind, request, decision);
    } catch {
      setError("This request could not be updated. Check your access and try again.");
    } finally {
      setBusyActions((current) => updateSet(current, decision, false));
    }
  };

  return (
    <li className={styles.requestItem}>
      <article
        className={styles.requestCard}
        aria-label={`${kind === "reviewer" ? "Reviewer" : "Handover"} request for ${taskTitle}`}
        ref={(element) => onCardRef(request.id, element)}
        tabIndex={deepLinked ? -1 : undefined}
        data-deep-linked={deepLinked || undefined}
      >
        <div className={styles.requestContent}>
          <div className={styles.requestHeading}>
            <h4 className={styles.requestTitle}>{taskTitle}</h4>
            {!pending ? <Badge tone={requestStatus(request) === "accepted" ? "success" : "neutral"}>{outcome}</Badge> : null}
            <Badge tone={request.isRecipient ? "info" : "neutral"}>
              {request.isRecipient
                ? kind === "reviewer" ? "For your review" : "Offered to you"
                : kind === "reviewer" ? "Sent by you" : "Your handover request"}
            </Badge>
          </div>
          <p className={styles.reason}>{request.reason.trim() || "No explanation was provided."}</p>
          <dl className={styles.metadata}>
            <div>
              <dt>Requested</dt>
              <dd>{created ? <time dateTime={created.iso}>{created.label}</time> : "Date unavailable"}</dd>
            </div>
            {pending ? <div>
              <dt>Expires</dt>
              <dd>{expires ? <time dateTime={expires.iso}>{expires.label}</time> : "Date unavailable"}</dd>
            </div> : (
              <>
                <div><dt>Outcome</dt><dd>{outcome}</dd></div>
                <div><dt>Resolved</dt><dd>{resolved ? <time dateTime={resolved.iso}>{resolved.label}</time> : "Date unavailable"}</dd></div>
              </>
            )}
          </dl>
        </div>

        {pending ? <div
          className={styles.requestActions}
          role="group"
          aria-label={`Actions for ${label}`}
          onFocusCapture={() => { onActionFocusChange(request.id, true); }}
          onBlurCapture={(event) => {
            const nextTarget = event.relatedTarget as Node | null;
            if (nextTarget &&
                nextTarget !== document.body && nextTarget !== document.documentElement &&
                !event.currentTarget.contains(nextTarget)) {
              onActionFocusChange(request.id, false);
            }
          }}
        >
          {pending && request.canAccept ? (
            <Button
              size="compact"
              loading={busyActions.has("accept")}
              loadingLabel="Accepting request"
              disabled={busyActions.size > 0}
              aria-label={`Accept ${label} for ${taskTitle}`}
              onClick={(event) => {
                onActionFocusChange(request.id, document.activeElement === event.currentTarget);
                void resolve("accept");
              }}
            >Accept</Button>
          ) : null}
          {pending && request.canDecline ? (
            <Button
              variant="danger"
              size="compact"
              loading={busyActions.has("decline")}
              loadingLabel="Declining request"
              disabled={busyActions.size > 0}
              aria-label={`Decline ${label} for ${taskTitle}`}
              onClick={(event) => {
                onActionFocusChange(request.id, document.activeElement === event.currentTarget);
                void resolve("decline");
              }}
            >Decline</Button>
          ) : null}
          {pending && request.canWithdraw ? (
            <Button
              variant="secondary"
              size="compact"
              loading={busyActions.has("withdraw")}
              loadingLabel="Withdrawing request"
              disabled={busyActions.size > 0}
              aria-label={`Withdraw ${label} for ${taskTitle}`}
              onClick={(event) => {
                onActionFocusChange(request.id, document.activeElement === event.currentTarget);
                void resolve("withdraw");
              }}
            >Withdraw</Button>
          ) : null}
          {pending && !hasAction ? <span className={styles.noAction}>No action is currently available.</span> : null}
        </div> : null}
        {!pending ? (
          <div className={styles.resolvedStatus} ref={(element) => onResolvedStatusRef(request.id, element)} tabIndex={-1}>
            Request resolved: {outcome}.
          </div>
        ) : null}
        {error ? <StateMessage className={styles.actionError} kind="error" title="Request not updated">{error}</StateMessage> : null}
      </article>
    </li>
  );
}

function RequestGroup({
  kind,
  state,
  onResolve,
  focusRequest,
}: {
  kind: CollaborationRequestKind;
  state: CollaborationRequestReadState;
  onResolve: WorkCollaborationRequestsProps["onResolve"];
  focusRequest?: FocusedCollaborationRequest | null;
}) {
  const title = kind === "reviewer" ? "Reviewer requests" : "Handover requests";
  const requestNoun = kind === "reviewer" ? "reviewer requests" : "handover requests";
  const headingId = `${kind}-${useId().replaceAll(":", "")}-collaboration-heading`;
  const requests = state.status === "ready" ? [...state.requests, ...(state.history ?? [])] : [];
  const pendingRequests = requests.filter(isPending);
  const resolvedRequests = requests.filter((request) => !isPending(request));
  const actionFocusRequestId = useRef<string | null>(null);
  const resolvedStatusElements = useRef(new Map<string, HTMLDivElement>());
  const requestCardElements = useRef(new Map<string, HTMLElement>());
  const updateActionFocus = (requestId: string, focused: boolean) => {
    if (focused) actionFocusRequestId.current = requestId;
    else if (actionFocusRequestId.current === requestId) actionFocusRequestId.current = null;
  };
  const updateResolvedStatusRef = (requestId: string, element: HTMLDivElement | null) => {
    if (element) resolvedStatusElements.current.set(requestId, element);
    else resolvedStatusElements.current.delete(requestId);
  };
  const updateRequestCardRef = (requestId: string, element: HTMLElement | null) => {
    if (element) requestCardElements.current.set(requestId, element);
    else requestCardElements.current.delete(requestId);
  };

  useEffect(() => {
    const requestId = actionFocusRequestId.current;
    if (state.status !== "ready" || !requestId || !state.history?.some((request) => request.id === requestId)) return;
    actionFocusRequestId.current = null;
    resolvedStatusElements.current.get(requestId)?.focus();
  }, [state]);

  useEffect(() => {
    if (!focusRequest || focusRequest.kind !== kind || state.status !== "ready") return;
    if (!requests.some((request) => request.id === focusRequest.id)) return;
    requestCardElements.current.get(focusRequest.id)?.focus({ preventScroll: false });
  }, [focusRequest, kind, requests, state.status]);

  return (
    <section className={styles.group} aria-labelledby={headingId}>
      {state.status === "ready" ? (
        <SectionHeading
          level={3}
          className={styles.groupHeading}
          title={<span id={headingId}>{title}</span>}
          description={pendingRequests.length + " pending · " + resolvedRequests.length + " resolved"}
          actions={<Badge tone={pendingRequests.length ? "info" : "neutral"}>{pendingRequests.length}</Badge>}
        />
      ) : (
        <SectionHeading level={3} className={styles.groupHeading} title={<span id={headingId}>{title}</span>} />
      )}

      {state.status !== "ready" ? <RequestReadState kind={kind} state={state} /> : (
        <>
          <p className={styles.scopeNote} role="status">
            Showing {pendingRequests.length} pending and {resolvedRequests.length} resolved {pendingRequests.length + resolvedRequests.length === 1 ? "request" : "requests"} from {state.loadedRecordCount} actor-scoped {state.loadedRecordCount === 1 ? "record" : "records"} returned.
            {state.recordLimit > 0 && state.loadedRecordCount >= state.recordLimit
              ? ` The latest ${state.recordLimit} actor-scoped requests are returned; older requests involving you may not be included.`
              : null}
          </p>
          {focusRequest?.kind === kind && !requests.some((request) => request.id === focusRequest.id) ? (
            <StateMessage kind="warning" title="This collaboration request is unavailable">
              It may have been resolved or may no longer be available under your current access.
            </StateMessage>
          ) : null}
          {pendingRequests.length ? (
            <div className={styles.requestSection}>
              <h4 className={styles.listHeading}>Pending</h4>
              <ul className={styles.requestList} aria-label={`Pending ${requestNoun}`}>
              {pendingRequests.map((request) => (
                <RequestCard key={request.id} kind={kind} request={request} onResolve={onResolve} onActionFocusChange={updateActionFocus} onResolvedStatusRef={updateResolvedStatusRef} onCardRef={updateRequestCardRef} deepLinked={focusRequest?.kind === kind && focusRequest.id === request.id} />
              ))}
              </ul>
            </div>
          ) : (
            <StateMessage className={styles.empty} kind="info" title={`No pending ${requestNoun}`}>
              {state.recordLimit > 0 && state.loadedRecordCount >= state.recordLimit
                ? `None are in the ${state.loadedRecordCount} actor-scoped records returned. Older requests involving you may not be included.`
                : `No pending ${requestNoun} are in the ${state.loadedRecordCount} actor-scoped records returned.`}
            </StateMessage>
          )}
          {resolvedRequests.length ? (
            <div className={styles.requestSection}>
              <h4 className={styles.listHeading}>Resolved</h4>
              <ul className={`${styles.requestList} ${styles.resolvedList}`} aria-label={`Resolved ${requestNoun}`}>
                {resolvedRequests.map((request) => (
                <RequestCard key={request.id} kind={kind} request={request} onResolve={onResolve} onActionFocusChange={updateActionFocus} onResolvedStatusRef={updateResolvedStatusRef} onCardRef={updateRequestCardRef} deepLinked={focusRequest?.kind === kind && focusRequest.id === request.id} />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export function WorkCollaborationRequests({
  reviewerRequests,
  handoverRequests,
  focusRequest,
  onResolve,
}: WorkCollaborationRequestsProps) {
  const headingId = `work-collaboration-${useId().replaceAll(":", "")}`;
  if (!reviewerRequests && !handoverRequests) return null;

  return (
    <section className={styles.page} aria-labelledby={headingId}>
      <SectionHeading
        title={<span id={headingId}>Collaboration requests</span>}
        description="Actions appear only when permitted for an individual request."
      />
      <div className={styles.groups}>
        {reviewerRequests ? <RequestGroup kind="reviewer" state={reviewerRequests} onResolve={onResolve} focusRequest={focusRequest} /> : null}
        {handoverRequests ? <RequestGroup kind="handover" state={handoverRequests} onResolve={onResolve} focusRequest={focusRequest} /> : null}
      </div>
    </section>
  );
}
