import { useId, useRef, useState, type FormEvent } from "react";
import { Badge, Button, EmptyState, Field, Input, StateMessage } from "../../design-system";
import type { MyWfhRequest, WfhRequestPanelProps, WfhRequestValues } from "./wfh-request-contracts";
import styles from "./WfhRequestPanel.module.css";

function formValues(form: HTMLFormElement): WfhRequestValues {
  const data = new FormData(form);
  return {
    startDate: String(data.get("startDate") ?? ""),
    endDate: String(data.get("endDate") ?? ""),
    reason: String(data.get("reason") ?? ""),
  };
}

function statusTone(status: string): "neutral" | "success" | "warning" {
  if (status === "pending") return "warning";
  if (status === "approved") return "success";
  return "neutral";
}

function displayStatus(status: string): string {
  return status ? status[0].toUpperCase() + status.slice(1) : "Unknown status";
}

export function WfhRequestPanel(props: WfhRequestPanelProps) {
  const id = useId();
  const pendingCancels = useRef(new Set<string>());
  const [pendingCancelIds, setPendingCancelIds] = useState<ReadonlySet<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const form = event.currentTarget;
    try {
      await props.onSubmit(formValues(form), form);
    } catch {
      // The host owns mutation feedback and protected-session recovery.
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(request: MyWfhRequest, source: HTMLButtonElement) {
    if (pendingCancels.current.has(request.id)) return;
    pendingCancels.current.add(request.id);
    setPendingCancelIds(new Set(pendingCancels.current));
    try {
      await props.onCancel(request.id, source);
    } catch {
      // The host owns mutation feedback and protected-session recovery.
    } finally {
      pendingCancels.current.delete(request.id);
      setPendingCancelIds(new Set(pendingCancels.current));
    }
  }

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Availability</p>
          <h2 className={styles.title} id={`${id}-title`}>Request work from home</h2>
          <p className={styles.description}>
            You may continue task work while a request is pending. A WFH check-in stays provisional—not attendance or payroll credit—until approved. Rejection does not change task records.
          </p>
        </div>
      </header>

      <form className={styles.form} onSubmit={(event) => { void submit(event); }}>
        <Field className={styles.startDate} label="Start date" required>
          {(control) => <Input {...control} name="startDate" type="date" required disabled={submitting} />}
        </Field>
        <Field className={styles.endDate} label="End date" required>
          {(control) => <Input {...control} name="endDate" type="date" required disabled={submitting} />}
        </Field>
        <Field className={styles.reason} label="Reason (optional)">
          {(control) => (
            <textarea
              {...control}
              className={styles.reasonInput}
              name="reason"
              maxLength={2000}
              disabled={submitting}
            />
          )}
        </Field>
        <div className={styles.formActions}>
          <Button type="submit" variant="primary" loading={submitting} loadingLabel="Submitting WFH request">
            Submit WFH request
          </Button>
        </div>
      </form>

      <section className={styles.requests} aria-labelledby={`${id}-requests-title`} aria-busy={props.read.status === "loading" || undefined}>
        <h3 className={styles.requestsTitle} id={`${id}-requests-title`}>Your requests</h3>
        {props.read.status === "loading" ? (
          <StateMessage kind="loading" title="Loading your WFH requests">Reading your request history.</StateMessage>
        ) : null}
        {props.read.status === "error" ? (
          <div className={styles.readFailure}>
            <StateMessage kind="error" title="Your WFH requests could not load">{props.read.message}</StateMessage>
            <Button variant="secondary" onClick={props.onRetry}>Retry loading WFH requests</Button>
          </div>
        ) : null}
        {props.read.status === "ready" && !props.read.requests.length ? (
          <EmptyState title="No WFH requests yet" description="Requests you submit will appear here." />
        ) : null}
        {props.read.status === "ready" && props.read.requests.length ? (
          <ul className={styles.requestList}>
            {props.read.requests.map((request) => {
              const cancelling = pendingCancelIds.has(request.id);
              return (
                <li className={styles.requestItem} key={request.id}>
                  <div className={styles.requestSummary}>
                    <span className={styles.requestDates}>
                      <time dateTime={request.startDate}>{request.startDate}</time>
                      <span aria-hidden="true">–</span>
                      <time dateTime={request.endDate}>{request.endDate}</time>
                    </span>
                    <Badge className={styles.status} tone={statusTone(request.status)}>{displayStatus(request.status)}</Badge>
                    {request.reviewReason ? <p className={styles.reviewReason}>{request.reviewReason}</p> : null}
                  </div>
                  {request.canCancel === true ? (
                    <Button
                      variant="secondary"
                      disabled={cancelling}
                      loading={cancelling}
                      loadingLabel="Cancelling WFH request"
                      aria-label={`Cancel WFH request, ${request.startDate} to ${request.endDate}`}
                      onClick={(event) => { void cancel(request, event.currentTarget); }}
                    >
                      {cancelling ? "Cancelling…" : "Cancel request"}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
