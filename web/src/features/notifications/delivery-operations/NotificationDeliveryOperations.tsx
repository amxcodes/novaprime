import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { Badge, Button, EmptyState, PageHeader, StateMessage, Surface } from "../../../design-system";
import type { NotificationDeliveryOperationsProps, NotificationDeliveryRecord } from "./contracts";
import styles from "./NotificationDeliveryOperations.module.css";

function formatTimestamp(value: string | null): { iso: string; label: string } | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    iso: date.toISOString(),
    label: new Intl.DateTimeFormat(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }).format(date),
  };
}

function readable(value: string): string {
  const label = value.replaceAll("_", " ").replaceAll(".", " · ").trim();
  return label || "Status unavailable";
}

function deliveryTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "sent") return "success";
  if (status === "failed" || status === "dead_letter") return "warning";
  if (status === "processing") return "info";
  return "neutral";
}

function isRequeueableStatus(status: string): boolean {
  // These are the two states accepted by the existing database requeue command.
  // The command still rechecks the current row and remains authoritative.
  return status === "failed" || status === "dead_letter";
}

function DeliveryRecord({
  delivery,
  canRequeue,
  pending,
  busy,
  onRequeue,
}: {
  delivery: NotificationDeliveryRecord;
  canRequeue: boolean;
  pending: boolean;
  busy: boolean;
  onRequeue: NotificationDeliveryOperationsProps["onRequeue"];
}) {
  const id = useId();
  const summaryRef = useRef<HTMLElement>(null);
  const [requestFailed, setRequestFailed] = useState(false);
  const created = formatTimestamp(delivery.createdAt);
  const available = formatTimestamp(delivery.availableAt);
  const sent = formatTimestamp(delivery.sentAt);
  const requeueable = canRequeue && isRequeueableStatus(delivery.status);
  const failed = delivery.status === "failed" || delivery.status === "dead_letter";

  function closeConfirmation(event: MouseEvent<HTMLButtonElement>) {
    const details = event.currentTarget.closest("details");
    if (details) details.open = false;
    summaryRef.current?.focus();
  }

  async function confirmRequeue(event: MouseEvent<HTMLButtonElement>) {
    if (busy) return;
    const details = event.currentTarget.closest("details");
    setRequestFailed(false);
    try {
      await onRequeue(delivery.id);
      if (details) details.open = false;
      summaryRef.current?.focus();
    } catch {
      setRequestFailed(true);
    }
  }

  return (
    <li className={styles.record}>
      <dl className={styles.fields}>
        <div className={`${styles.field} ${styles.eventField}`}>
          <dt>Notification event</dt>
          <dd><code className={styles.eventKey}>{delivery.eventKey || "Unknown event"}</code></dd>
        </div>
        <div className={styles.field}>
          <dt>Delivery status</dt>
          <dd><Badge tone={deliveryTone(delivery.status)}>{readable(delivery.status)}</Badge></dd>
        </div>
        <div className={styles.field}>
          <dt>Attempts</dt>
          <dd>{Number.isSafeInteger(delivery.attempts) && delivery.attempts >= 0 ? delivery.attempts : "Not provided"}</dd>
        </div>
        <div className={`${styles.field} ${styles.timingField}`}>
          <dt>Delivery timing</dt>
          <dd className={styles.timing}>
            <span>{created ? <>Created <time dateTime={created.iso}>{created.label}</time></> : "Created time unavailable"}</span>
            {available ? <span>Available at <time dateTime={available.iso}>{available.label}</time></span> : null}
            {sent ? <span>Sent <time dateTime={sent.iso}>{sent.label}</time></span> : null}
          </dd>
        </div>
        <div className={`${styles.field} ${styles.errorField}`}>
          <dt>Failure summary</dt>
          <dd>
            {failed
              ? <span className={styles.errorSummary}>Delivery failed. Detailed provider response is not shown.</span>
              : <span className={styles.muted}>No failure summary for this delivery.</span>}
          </dd>
        </div>
        <div className={`${styles.field} ${styles.actionField}`}>
          <dt>Action</dt>
          <dd>
            {requeueable ? (
              <details className={styles.confirmation}>
                <summary
                  ref={summaryRef}
                  className={styles.confirmationSummary}
                  onClick={() => setRequestFailed(false)}
                >
                  Requeue
                </summary>
                <div className={styles.confirmationBody} role="group" aria-labelledby={`${id}-confirm-title`}>
                  <p id={`${id}-confirm-title`} className={styles.confirmationText}>
                    Requeue resets the attempt count and may send this notification again. The server will check that it is still eligible.
                  </p>
                  {requestFailed ? (
                    <StateMessage kind="error" title="Requeue was not confirmed">
                      NOVA could not requeue this delivery. Refresh the queue and check its current state.
                    </StateMessage>
                  ) : null}
                  <div className={styles.confirmationActions}>
                    <Button size="compact" loading={pending} loadingLabel="Requeueing delivery" disabled={busy} onClick={(event) => void confirmRequeue(event)}>
                      Confirm requeue
                    </Button>
                    <Button type="button" size="compact" variant="quiet" disabled={busy} onClick={closeConfirmation}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </details>
            ) : (
              <span className={styles.muted}>
                {!canRequeue ? "Inspection only" : "Current status cannot be requeued"}
              </span>
            )}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function NotificationDeliveryOperations({
  readState,
  canRequeue,
  onRequeue,
  onRetryRead,
}: NotificationDeliveryOperationsProps) {
  const [localPendingId, setLocalPendingId] = useState<string | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function requeue(deliveryId: string) {
    setLocalPendingId(deliveryId);
    try {
      await onRequeue(deliveryId);
    } finally {
      if (mounted.current) setLocalPendingId(null);
    }
  }

  const anyPending = localPendingId !== null;

  return (
    <section className={styles.section} aria-label="Notification delivery operations">
      <PageHeader
        level={2}
        eyebrow="Delivery operations"
        title="Notification delivery"
        description="Inspect recent notification delivery attempts and retry eligible failures. This is separate from the employee inbox."
      />

      <Surface as="div" level="plain" className={styles.content}>
        {readState.status === "loading" ? (
          <StateMessage kind="loading" title="Loading recent delivery attempts">NOVA is reading the bounded delivery operations view.</StateMessage>
        ) : null}
        {readState.status === "failed" ? (
          <div className={styles.readError}>
            <StateMessage kind="error" title="Delivery attempts could not load">{readState.message}</StateMessage>
            <Button variant="secondary" onClick={onRetryRead}>Try again</Button>
          </div>
        ) : null}
        {readState.status === "ready" ? (
          <>
            <p className={styles.scopeNote}>
            Showing {readState.deliveries.length} recent {readState.deliveries.length === 1 ? "delivery" : "deliveries"} returned, up to {Math.min(Math.max(Number.isFinite(readState.limit) ? Math.trunc(readState.limit) : 50, 1), 200)}. This bounded view has no paging or total count.
            </p>
            {readState.deliveries.length ? (
              <ol className={styles.records} aria-label="Recent notification delivery attempts">
                {readState.deliveries.map((delivery) => (
                  <DeliveryRecord
                    key={delivery.id}
                    delivery={delivery}
                    canRequeue={canRequeue}
                    pending={localPendingId === delivery.id}
                    busy={anyPending}
                    onRequeue={requeue}
                  />
                ))}
              </ol>
            ) : (
              <EmptyState title="No delivery attempts returned" description="There are no recent notification deliveries in this bounded result." />
            )}
          </>
        ) : null}
      </Surface>
    </section>
  );
}
