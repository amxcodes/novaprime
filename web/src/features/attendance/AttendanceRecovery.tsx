import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, Field, Input, Select, StateMessage } from "../../design-system";
import type {
  AttendanceRecoveryProps,
  AttendanceRecoveryState,
  RecoveryCandidate,
  RecoveryCandidatesResponse,
  RecoveryCorrectionValues,
} from "./recovery-contracts";
import {
  attendanceRecoveryStatus,
  beginAttendanceRecoveryRead,
  completeAttendanceRecoveryRead,
  createAttendanceRecoveryState,
  failAttendanceRecoveryRead,
} from "./recovery-model";
import styles from "./AttendanceRecovery.module.css";

const fallbackReadError = "Attendance recovery could not be loaded. Refresh and try again.";

function candidateKey(candidate: RecoveryCandidate): string {
  return `${candidate.personId}:${candidate.businessDate}`;
}

function correctionValues(
  form: HTMLFormElement,
  candidate: RecoveryCandidate,
): RecoveryCorrectionValues {
  const data = new FormData(form);
  return {
    mode: candidate.mode || String(data.get("mode") || ""),
    checkedInAt: String(data.get("checkedInAt") || "").trim(),
    checkedOutAt: String(data.get("checkedOutAt") || "").trim() || null,
    reason: String(data.get("reason") || "").trim(),
  };
}

export function AttendanceRecovery(props: AttendanceRecoveryProps) {
  const id = useId();
  const requestGeneration = useRef(0);
  const mounted = useRef(false);
  const pending = useRef(new Set<string>());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());
  const [state, setState] = useState<AttendanceRecoveryState>(() =>
    createAttendanceRecoveryState(props.initialResult, props.initialReadError));

  useEffect(() => {
    mounted.current = true;
    if (props.initialResult == null) void loadPage(null, false);
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
    };
  }, []);

  async function loadPage(cursor: string | null, append: boolean) {
    if (!props.isCurrentPageRequest()) return;
    const requestId = ++requestGeneration.current;
    setState((current) => beginAttendanceRecoveryRead(current, append));

    let response: RecoveryCandidatesResponse;
    try {
      response = await props.loadCandidates(cursor);
    } catch {
      response = { readError: "REQUEST_FAILED" };
    }

    if (requestId !== requestGeneration.current || !props.isCurrentPageRequest()) return;
    if (response?.readError) {
      const failure = props.makeReadError(response) ?? { kind: "error" as const, message: fallbackReadError };
      setState((current) => failAttendanceRecoveryRead(current, append, failure));
      return;
    }
    setState((current) => completeAttendanceRecoveryRead(current, response, append));
  }

  async function submitCorrection(
    event: FormEvent<HTMLFormElement>,
    candidate: RecoveryCandidate,
  ) {
    event.preventDefault();
    const key = candidateKey(candidate);
    if (pending.current.has(key) || !props.isCurrentPageRequest()) return;
    pending.current.add(key);
    setPendingKeys(new Set(pending.current));
    try {
      await props.onCorrect(event, candidate, correctionValues(event.currentTarget, candidate));
    } finally {
      pending.current.delete(key);
      if (mounted.current) setPendingKeys(new Set(pending.current));
    }
  }

  return (
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>OPERATIONS</p>
          <h2 id={`${id}-title`} className={styles.title}>Attendance recovery</h2>
          <p className={styles.description}>Find eligible recent workdays with missing attendance or an open check-in. Each correction requires a reason and is audited by NOVA.</p>
        </div>
      </header>

      <p className={styles.status} role="status" aria-live="polite" aria-atomic="true">
        {attendanceRecoveryStatus(state)}
      </p>

      {state.status === "loading" ? (
        <StateMessage kind="loading" title="Loading eligible workdays">Reading attendance gaps in the recent 31-day window.</StateMessage>
      ) : null}

      {state.status === "error" ? (
        <div className={styles.readFailure}>
          <StateMessage kind={state.pageFailure?.kind ?? "error"} title="Attendance recovery unavailable">
            {state.pageFailure?.message ?? fallbackReadError}
          </StateMessage>
          <Button variant="secondary" onClick={() => void loadPage(null, false)}>Try again</Button>
        </div>
      ) : null}

      {state.pageFailure && state.status === "ready" ? (
        <div className={styles.readFailure}>
          <StateMessage kind={state.pageFailure.kind} title="Older workdays could not load">
            {state.pageFailure.message}
          </StateMessage>
          {state.nextCursor ? <Button variant="secondary" onClick={() => void loadPage(state.nextCursor, true)}>Retry older workdays</Button> : null}
        </div>
      ) : null}

      {state.status === "ready" && !state.candidates.length ? (
        <p className={styles.empty} role="status">No eligible attendance gaps were found in the recent 31-day window.</p>
      ) : null}

      {state.candidates.length ? (
        <div className={styles.list} aria-busy={state.loadingMore || undefined}>
          {state.candidates.map((candidate) => (
            <RecoveryCandidateForm
              key={candidateKey(candidate)}
              candidate={candidate}
              pending={pendingKeys.has(candidateKey(candidate))}
              businessTimeLabel={props.businessTimeLabel}
              onSubmit={submitCorrection}
            />
          ))}
        </div>
      ) : null}

      {state.nextCursor && state.status === "ready" && !state.pageFailure ? (
        <div className={styles.pagination}>
          <Button variant="secondary" disabled={state.loadingMore} loading={state.loadingMore} loadingLabel="Loading older eligible workdays" onClick={() => void loadPage(state.nextCursor, true)}>
            Load older eligible workdays
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function RecoveryCandidateForm({
  candidate,
  pending,
  businessTimeLabel,
  onSubmit,
}: {
  candidate: RecoveryCandidate;
  pending: boolean;
  businessTimeLabel: AttendanceRecoveryProps["businessTimeLabel"];
  onSubmit: (event: FormEvent<HTMLFormElement>, candidate: RecoveryCandidate) => void;
}) {
  const id = useId();
  const isMissingCheckout = candidate.recoveryReason === "missing_checkout";
  const location = candidate.officeName
    ? `${candidate.officeName} (${candidate.officeTimezone})`
    : candidate.officeTimezone;
  const summary = [
    candidate.personName,
    candidate.businessDate,
    isMissingCheckout ? "check-out missing" : "attendance missing",
    location,
  ].filter(Boolean).join(" · ");
  const current = candidate.checkedInAt
    ? `Recorded check-in ${businessTimeLabel(candidate.checkedInAt, candidate.officeTimezone)}${candidate.checkedOutAt ? ` · check-out ${businessTimeLabel(candidate.checkedOutAt, candidate.officeTimezone)}` : " · no check-out"}`
    : "No attendance times recorded for this business date.";
  const timeHint = `Enter ISO 8601 timestamps with Z or an explicit UTC offset. Values must fall inside this business date in ${candidate.officeTimezone}.`;

  return (
    <details className={styles.candidate}>
      <summary className={styles.summary}>{summary}</summary>
      <p className={styles.current}>{current}</p>
      <form className={styles.form} onSubmit={(event) => onSubmit(event, candidate)} aria-busy={pending || undefined}>
        <Select
          id={`${id}-mode`}
          label="Attendance mode"
          name="mode"
          required
          defaultValue={candidate.mode || "office"}
          disabled={Boolean(candidate.mode) || pending}
          options={[
            { value: "office", label: "Office" },
            { value: "wfh", label: "Work from home" },
          ]}
        />

        <Field className={styles.checkInField} label="Check-in timestamp" required hint={timeHint}>
          {(control) => <Input
            {...control}
            type="text"
            name="checkedInAt"
            defaultValue={candidate.checkedInAt ? new Date(candidate.checkedInAt).toISOString() : ""}
            required
            readOnly={isMissingCheckout}
            placeholder="2026-10-01T09:30:00+05:30"
            pattern="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})"
            disabled={pending}
          />}
        </Field>

        <Field className={styles.checkOutField} label="Check-out timestamp (optional)" hint={timeHint}>
          {(control) => <Input
            {...control}
            type="text"
            name="checkedOutAt"
            defaultValue={candidate.checkedOutAt ? new Date(candidate.checkedOutAt).toISOString() : ""}
            placeholder="2026-10-01T18:30:00+05:30"
            pattern="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})"
            disabled={pending}
          />}
        </Field>

        <Field className={styles.reasonField} label="Correction reason" required>
          {(control) => <textarea
            {...control}
            className={styles.reasonInput}
            name="reason"
            maxLength={2000}
            required
            disabled={pending}
          />}
        </Field>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={pending} loading={pending} loadingLabel="Recording attendance correction">
            Record attendance correction
          </Button>
        </div>
      </form>
    </details>
  );
}
