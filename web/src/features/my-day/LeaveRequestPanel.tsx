import { useId, useRef, useState, type FormEvent } from "react";
import { Button, EmptyState, Field, Input, StateMessage } from "../../design-system";
import { LeavePortionField } from "./LeavePortionField";
import type {
  LeaveRequestPanelProps,
  LeaveRequestPortion,
  LeaveRequestValues,
  MyLeaveRequest,
} from "./leave-request-contracts";
import styles from "./LeaveRequestPanel.module.css";

function formValues(form: HTMLFormElement): LeaveRequestValues {
  const data = new FormData(form);
  const selectedPortion = data.get("portion");
  return {
    leaveType: String(data.get("leaveType") ?? ""),
    startDate: String(data.get("startDate") ?? ""),
    endDate: String(data.get("endDate") ?? ""),
    portion: (selectedPortion === "0.5" ? "0.5" : "1") as LeaveRequestPortion,
    reason: String(data.get("reason") ?? ""),
  };
}

export function LeaveRequestPanel(props: LeaveRequestPanelProps) {
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
      // The host owns command error wording and protected-session recovery.
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(request: MyLeaveRequest, source: HTMLButtonElement) {
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
          <h2 className={styles.title} id={`${id}-title`}>Request leave</h2>
          <p className={styles.description}>
            Use full-day or half-day portions. Approval never rewrites attendance automatically.
          </p>
        </div>
      </header>

      <form className={styles.form} onSubmit={(event) => { void submit(event); }}>
        <Field className={styles.leaveType} label="Leave type" required>
          {(control) => <Input {...control} name="leaveType" defaultValue="annual" required maxLength={80} disabled={submitting} />}
        </Field>

        <Field className={styles.startDate} label="Start date" required>
          {(control) => <Input {...control} name="startDate" type="date" required disabled={submitting} />}
        </Field>

        <Field className={styles.endDate} label="End date" required>
          {(control) => <Input {...control} name="endDate" type="date" required disabled={submitting} />}
        </Field>

        <div className={styles.portion}>
          <LeavePortionField />
        </div>

        <Field className={styles.reason} label="Reason (optional)">
          {(control) => <textarea {...control} className={styles.reasonInput} name="reason" maxLength={2000} disabled={submitting} />}
        </Field>

        <div className={styles.formActions}>
          <Button type="submit" variant="primary" loading={submitting} loadingLabel="Submitting leave request">
            Submit leave request
          </Button>
        </div>
      </form>

      <section className={styles.requests} aria-labelledby={`${id}-requests-title`} aria-busy={props.read.status === "loading" || undefined}>
        <h3 className={styles.requestsTitle} id={`${id}-requests-title`}>Your requests</h3>
        {props.read.status === "loading" ? (
          <StateMessage kind="loading" title="Loading your leave requests">Reading your recent leave request history.</StateMessage>
        ) : null}
        {props.read.status === "error" ? (
          <div className={styles.readFailure}>
            <StateMessage kind="error" title="Your leave requests could not load">{props.read.message}</StateMessage>
            <Button variant="secondary" onClick={props.onRetry}>Retry loading leave requests</Button>
          </div>
        ) : null}
        {props.read.status === "ready" && !props.read.requests.length ? (
          <EmptyState title="No leave requests yet" description="Leave requests you submit will appear here." />
        ) : null}
        {props.read.status === "ready" && props.read.requests.length ? (
          <ul className={styles.requestList}>
            {props.read.requests.map((request) => {
              const cancelling = pendingCancelIds.has(request.id);
              return (
                <li className={styles.requestItem} key={request.id}>
                  <div className={styles.requestSummary}>
                    <span className={styles.requestType}>{request.leaveType}</span>
                    <span className={styles.requestDates}>
                      <time dateTime={request.startDate}>{request.startDate}</time>
                      <span aria-hidden="true">–</span>
                      <time dateTime={request.endDate}>{request.endDate}</time>
                    </span>
                    <span className={styles.requestStatus}>{request.status}</span>
                  </div>
                  {request.canCancel === true ? (
                    <Button
                      variant="secondary"
                      disabled={cancelling}
                      loading={cancelling}
                      loadingLabel="Cancelling leave request"
                      aria-label={`Cancel ${request.leaveType} leave request, ${request.startDate} to ${request.endDate}`}
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
