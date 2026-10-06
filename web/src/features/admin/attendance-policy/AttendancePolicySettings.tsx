import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, EmptyState, Field, Input, SectionHeading, StateMessage } from "../../../design-system";
import type {
  AttendancePolicyDraft,
} from "./policy-model";
import {
  attendancePolicyDraft,
  attendancePolicyReadChanged,
  attendancePolicyReadKey,
  buildAttendancePolicyRequest,
  selectAttendancePolicyMode,
  type AttendancePolicyDraftErrors,
} from "./policy-model";
import type {
  AttendancePolicyMode,
  AttendancePolicyRecord,
  AttendancePolicySettingsProps,
} from "./contracts";
import styles from "./AttendancePolicySettings.module.css";

const modeOptions: ReadonlyArray<{
  value: AttendancePolicyMode;
  title: string;
  description: string;
}> = [
  {
    value: "hour_based",
    title: "Required duration",
    description: "Compare total attendance time with a daily minimum.",
  },
  {
    value: "scheduled",
    title: "Assigned schedule",
    description: "Compare attendance with the shift assigned to each working day.",
  },
];

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours && remainder ? `${hours} hr ${remainder} min`
    : hours ? `${hours} hr`
      : `${remainder} min`;
}

function CurrentPolicy({ policy }: { policy: AttendancePolicyRecord | null }) {
  if (!policy) {
    return (
      <EmptyState
        title="No attendance policy is available"
        description="A policy will be shown here after the first effective date is applied."
        className={styles.emptyPolicy}
      />
    );
  }

  const isHourBased = policy.mode === "hour_based";
  return (
    <div className={styles.policySnapshot} aria-label="Current attendance policy">
      <p className={styles.snapshotLabel}>Current policy</p>
      <strong className={styles.snapshotValue}>
        {isHourBased ? "Required duration" : "Assigned schedule"}
      </strong>
      <p className={styles.snapshotDetail}>
        {isHourBased
          ? `${formatDuration(policy.requiredAttendanceMinutes)} per day · ${policy.requiredAttendanceMinutes} minutes`
          : "Attendance is interpreted against the assigned working calendar."}
      </p>
      <p className={styles.snapshotDate}>Effective {policy.effectiveOn}</p>
    </div>
  );
}

export function AttendancePolicySettings({ access, read, onSchedule }: AttendancePolicySettingsProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const mutationLock = useRef(false);
  const mounted = useRef(false);
  const currentPolicy = read.status === "ready" ? read.policy : null;
  const readyPolicyKey = read.status === "ready" ? attendancePolicyReadKey(currentPolicy) : null;
  const lastAppliedPolicyKey = useRef<string | null>(readyPolicyKey);
  const [draft, setDraft] = useState<AttendancePolicyDraft>(() => attendancePolicyDraft(currentPolicy));
  const [fieldErrors, setFieldErrors] = useState<AttendancePolicyDraftErrors>({});
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (feedback?.kind === "error") errorRef.current?.focus();
  }, [feedback]);

  useEffect(() => {
    if (!attendancePolicyReadChanged(lastAppliedPolicyKey.current, readyPolicyKey)) return;
    lastAppliedPolicyKey.current = readyPolicyKey;
    setDraft(attendancePolicyDraft(currentPolicy));
    setFieldErrors({});
    setFeedback((current) => current?.kind === "success" ? current : null);
  }, [currentPolicy, readyPolicyKey]);

  if (access.status === "hidden") return null;

  const canManage = access.manage === "allowed";
  const update = <K extends keyof AttendancePolicyDraft>(key: K, value: AttendancePolicyDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    setFeedback(null);
  };

  function updateMode(mode: AttendancePolicyMode) {
    setDraft((current) => selectAttendancePolicyMode(
      current,
      mode,
      currentPolicy?.requiredAttendanceMinutes,
    ));
    setFieldErrors((current) => ({
      ...current,
      mode: undefined,
      ...(mode === "scheduled" ? { requiredAttendanceMinutes: undefined } : {}),
    }));
    setFeedback(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || mutationLock.current) return;

    const result = buildAttendancePolicyRequest(draft);
    setFieldErrors(result.errors);
    setFeedback(null);
    if (!result.request) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }

    mutationLock.current = true;
    setPending(true);
    try {
      await onSchedule(result.request);
      if (mounted.current) setFeedback({ kind: "success", message: "Attendance policy scheduled." });
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : "";
      if (mounted.current) {
        setFeedback({
          kind: "error",
          message: message || "The attendance policy could not be scheduled. Check the effective date and try again.",
        });
      }
    } finally {
      mutationLock.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <section className={styles.feature} aria-labelledby={`${id}-title`}>
      <SectionHeading
        title={<span id={`${id}-title`}>Attendance policy</span>}
        description="Choose how the organisation interprets attendance. A new policy takes effect on the date you select; earlier records keep their existing meaning."
      />

      <div className={styles.content}>
        <section className={styles.current} aria-labelledby={`${id}-current-title`}>
          <h3 className={styles.subheading} id={`${id}-current-title`}>In effect now</h3>
          {read.status === "loading" ? (
            <StateMessage kind="loading" title="Loading attendance policy">Reading the authorised organisation settings.</StateMessage>
          ) : read.status === "unavailable" ? (
            <StateMessage kind="warning" title="Current policy is unavailable">
              {read.message || "The current policy could not be read."}
            </StateMessage>
          ) : read.status === "error" ? (
            <StateMessage kind="error" title="Current policy could not load">{read.message}</StateMessage>
          ) : (
            <CurrentPolicy policy={read.policy} />
          )}
        </section>

        {canManage && read.status === "ready" ? (
          <form
            className={styles.form}
            ref={formRef}
            noValidate
            onSubmit={(event) => void submit(event)}
            aria-labelledby={`${id}-form-title`}
          >
            <div className={styles.formHeading}>
              <h3 className={styles.subheading} id={`${id}-form-title`}>Schedule a change</h3>
              <p>Organisation business date and existing policy history are checked when you save.</p>
            </div>

            <fieldset className={styles.modeFieldset} aria-describedby={fieldErrors.mode ? `${id}-mode-error` : undefined}>
              <legend>Attendance calculation</legend>
              <div className={styles.modeChoices}>
                {modeOptions.map((option) => (
                  <label
                    className={styles.modeChoice}
                    data-selected={draft.mode === option.value || undefined}
                    key={option.value}
                  >
                    <input
                      type="radio"
                      name={`${id}-mode`}
                      value={option.value}
                      checked={draft.mode === option.value}
                      disabled={pending}
                      onChange={() => updateMode(option.value)}
                    />
                    <span className={styles.modeCopy}>
                      <strong>{option.title}</strong>
                      <span>{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              {fieldErrors.mode ? <p className={styles.fieldError} id={`${id}-mode-error`}>{fieldErrors.mode}</p> : null}
            </fieldset>

            <div className={styles.policyFields}>
              {draft.mode === "hour_based" ? (
                <Field
                  id={`${id}-minutes`}
                  label="Required attendance minutes"
                  hint="Whole minutes from 1 to 1,440. For example, 480 minutes is 8 hours."
                  error={fieldErrors.requiredAttendanceMinutes}
                  required
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={1440}
                      step={1}
                      value={draft.requiredAttendanceMinutes}
                      disabled={pending}
                      onChange={(event) => update("requiredAttendanceMinutes", event.currentTarget.value)}
                    />
                  )}
                </Field>
              ) : (
                <div className={styles.scheduleNote}>
                  <span className={styles.scheduleMark} aria-hidden="true">↗</span>
                  <p>Scheduled attendance uses each working day’s assigned shift. Configure shifts and working calendars in Availability.</p>
                </div>
              )}
              <Field
                id={`${id}-effective-on`}
                label="Effective from"
                hint="Choose the date the new interpretation should begin. The server validates it against the organisation’s business date and saved policy history."
                error={fieldErrors.effectiveOn}
                required
              >
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={draft.effectiveOn}
                    disabled={pending}
                    onChange={(event) => update("effectiveOn", event.currentTarget.value)}
                  />
                )}
              </Field>
            </div>

            {feedback ? (
              <div className={styles.feedback} ref={errorRef} tabIndex={-1}>
                <StateMessage kind={feedback.kind} title={feedback.kind === "error" ? "Policy not scheduled" : "Policy scheduled"}>
                  {feedback.message}
                </StateMessage>
              </div>
            ) : null}

            <div className={styles.actions}>
              <Button type="submit" loading={pending} loadingLabel="Scheduling attendance policy" disabled={pending}>
                Schedule policy
              </Button>
            </div>
          </form>
        ) : canManage ? (
          <StateMessage kind="info" title="Scheduling is unavailable">
            Read the current attendance policy before scheduling a change.
          </StateMessage>
        ) : (
          <StateMessage kind="info" title="View access only">You can review the current policy but do not have permission to schedule a change.</StateMessage>
        )}
      </div>
    </section>
  );
}
