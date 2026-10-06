import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, Field, Input, StateMessage } from "../../../design-system";
import {
  FirstRunSetupActionError,
  type FirstRunSetupProps,
  type FirstRunSetupValues,
} from "./contracts";
import type { FirstRunSetupDraft, FirstRunSetupField, FirstRunSetupFieldErrors } from "./validation";
import { toFirstRunSetupValues, validateFirstRunSetup } from "./validation";
import styles from "./FirstRunSetup.module.css";

const emptyErrors: FirstRunSetupFieldErrors = {};

export function FirstRunSetup({ initialPublicOrigin, resumeFounder, onSubmit, onCancel, notice }: FirstRunSetupProps) {
  const id = useId();
  const inFlight = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const organisationRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const originRef = useRef<HTMLInputElement>(null);
  const minutesRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const hourBasedRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<FirstRunSetupDraft>({
    name: resumeFounder?.displayName ?? "",
    organisationName: "",
    email: resumeFounder?.email ?? "",
    password: "",
    publicOrigin: initialPublicOrigin,
    attendanceMode: "hour_based",
    requiredAttendanceMinutes: "480",
    bootstrapToken: "",
  });
  const [errors, setErrors] = useState<FirstRunSetupFieldErrors>(emptyErrors);
  const [feedback, setFeedback] = useState<{ kind: "warning" | "error"; title: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const requiredMinutes = draft.attendanceMode === "hour_based";

  useEffect(() => {
    if (!resumeFounder) return;
    setDraft((current) => ({
      ...current,
      name: resumeFounder.displayName,
      email: resumeFounder.email,
      password: "",
    }));
    setErrors((current) => ({ ...current, name: undefined, email: undefined, password: undefined }));
    setFeedback(null);
  }, [resumeFounder?.email, resumeFounder?.displayName]);

  function update<K extends keyof FirstRunSetupDraft>(key: K, value: FirstRunSetupDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setFeedback(null);
  }

  function focusField(field: FirstRunSetupField) {
    const ref = {
      name: nameRef,
      organisationName: organisationRef,
      email: emailRef,
      password: passwordRef,
      publicOrigin: originRef,
      attendanceMode: hourBasedRef,
      requiredAttendanceMinutes: minutesRef,
      bootstrapToken: tokenRef,
    }[field];
    ref.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    const validation = validateFirstRunSetup(draft, resumeFounder);
    setErrors(validation.errors);
    setFeedback(null);
    const firstInvalid = (Object.keys(validation.errors) as FirstRunSetupField[])[0];
    if (firstInvalid) {
      requestAnimationFrame(() => focusField(firstInvalid));
      return;
    }

    const values: FirstRunSetupValues = toFirstRunSetupValues(
      draft,
      validation.requiredAttendanceMinutes ?? 480,
      resumeFounder,
    );

    inFlight.current = true;
    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (error) {
      if (error instanceof FirstRunSetupActionError) {
        setFeedback({ kind: error.kind, title: error.title, message: error.message });
      } else {
        setFeedback({
          kind: "error",
          title: "Setup could not be completed",
          message: "NOVA could not finish setup. If the founder account may already have been created, contact the deployment operator before retrying.",
        });
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function errorFor(field: FirstRunSetupField) {
    return errors[field] || undefined;
  }

  function changeAttendanceMode(mode: "hour_based" | "scheduled") {
    setDraft((current) => ({ ...current, attendanceMode: mode }));
    setErrors((current) => ({
      ...current,
      attendanceMode: undefined,
      ...(mode === "scheduled" ? { requiredAttendanceMinutes: undefined } : {}),
    }));
    setFeedback(null);
  }

  return (
    <div className={styles.root}>
      <section className={styles.panel} aria-labelledby={`${id}-title`}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>One-time deployment setup</p>
          <h1 className={styles.title} id={`${id}-title`} tabIndex={-1}>
            {resumeFounder ? "Finish workspace setup." : "Create the founding workspace."}
          </h1>
          <p className={styles.description}>
            {resumeFounder
              ? "The founder account is already signed in. Complete the workspace policy and public URL to continue setup."
              : "Create the first owner and workspace. The public URL is used for invitations, password links, Google callbacks, and notifications."}
          </p>
        </header>

        {resumeFounder ? (
          <StateMessage kind="info" title="Founder account confirmed">
            Signed in as {resumeFounder.displayName} ({resumeFounder.email}). This step will continue with that session and will not ask for credentials again.
          </StateMessage>
        ) : null}
        {notice ? <StateMessage kind={notice.kind} title={notice.title}>{notice.message}</StateMessage> : null}
        {feedback ? (
          <StateMessage kind={feedback.kind} title={feedback.title}>{feedback.message}</StateMessage>
        ) : null}
        {Object.keys(errors).length > 0 ? (
          <StateMessage kind="error" title="Review the highlighted fields">
            Correct each marked field, then try again.
          </StateMessage>
        ) : null}

        <form className={styles.form} noValidate aria-busy={submitting || undefined} onSubmit={(event) => void submit(event)}>
          {!resumeFounder ? <section className={styles.group} aria-labelledby={`${id}-founder-heading`}>
            <div className={styles.groupHeader}>
              <h2 className={styles.groupTitle} id={`${id}-founder-heading`}>Founder account</h2>
              <p className={styles.groupDescription}>This account becomes the initial Super Admin.</p>
            </div>
            <div className={styles.grid}>
              <Field id={`${id}-name`} label="Your name" error={errorFor("name")} required>
                {(control) => (
                  <Input {...control} ref={nameRef} name="name" autoComplete="name" maxLength={180} value={draft.name} disabled={submitting}
                    onChange={(event) => update("name", event.currentTarget.value)} />
                )}
              </Field>
              <Field id={`${id}-email`} label="Email address" hint="Use the email address for the founding account." error={errorFor("email")} required>
                {(control) => (
                  <Input {...control} ref={emailRef} name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} inputMode="email" value={draft.email} disabled={submitting}
                    onChange={(event) => update("email", event.currentTarget.value)} />
                )}
              </Field>
              <Field id={`${id}-password`} label="Password" hint="Use at least 8 characters. Keep it private to you." error={errorFor("password")} required>
                {(control) => (
                  <Input {...control} ref={passwordRef} name="password" type="password" autoComplete="new-password" minLength={8} value={draft.password} disabled={submitting}
                    onChange={(event) => update("password", event.currentTarget.value)} />
                )}
              </Field>
            </div>
          </section> : null}

          <section className={styles.group} aria-labelledby={`${id}-workspace-heading`}>
            <div className={styles.groupHeader}>
              <h2 className={styles.groupTitle} id={`${id}-workspace-heading`}>Workspace and attendance</h2>
              <p className={styles.groupDescription}>These settings establish the first organisation policy.</p>
            </div>
            <div className={styles.grid}>
              <Field id={`${id}-organisation`} label="Organisation name" error={errorFor("organisationName")} required>
                {(control) => (
                  <Input {...control} ref={organisationRef} name="organisationName" autoComplete="organization" maxLength={180} value={draft.organisationName} disabled={submitting}
                    onChange={(event) => update("organisationName", event.currentTarget.value)} />
                )}
              </Field>
              <fieldset className={styles.modeField} aria-describedby={errorFor("attendanceMode") ? `${id}-mode-error` : undefined} aria-invalid={Boolean(errorFor("attendanceMode"))}>
                <legend className={styles.modeLegend}>Attendance mode <span aria-hidden="true">*</span></legend>
                <div className={styles.modeOptions}>
                  <label className={styles.modeOption} data-selected={draft.attendanceMode === "hour_based" || undefined}>
                    <input ref={hourBasedRef} type="radio" name={`${id}-attendanceMode`} value="hour_based" checked={draft.attendanceMode === "hour_based"} required disabled={submitting}
                      onChange={() => changeAttendanceMode("hour_based")} />
                    <span className={styles.modeCopy}><strong>Hour-based</strong><small>Measure required duration.</small></span>
                  </label>
                  <label className={styles.modeOption} data-selected={draft.attendanceMode === "scheduled" || undefined}>
                    <input type="radio" name={`${id}-attendanceMode`} value="scheduled" checked={draft.attendanceMode === "scheduled"} required disabled={submitting}
                      onChange={() => changeAttendanceMode("scheduled")} />
                    <span className={styles.modeCopy}><strong>Scheduled</strong><small>Compare against office shifts.</small></span>
                  </label>
                </div>
                {errorFor("attendanceMode") ? <span className={styles.fieldError} id={`${id}-mode-error`}>{errorFor("attendanceMode")}</span> : null}
              </fieldset>
              {requiredMinutes ? (
                <Field id={`${id}-minutes`} label="Required attendance minutes" hint="Use a whole number from 1 to 1,440 per workday." error={errorFor("requiredAttendanceMinutes")} required>
                  {(control) => (
                    <Input {...control} ref={minutesRef} name="requiredAttendanceMinutes" type="number" min={1} max={1440} step={1} inputMode="numeric" value={draft.requiredAttendanceMinutes} disabled={submitting}
                      onChange={(event) => update("requiredAttendanceMinutes", event.currentTarget.value)} />
                  )}
                </Field>
              ) : (
                <p className={styles.modeHint}>Scheduled attendance uses each office calendar shift. Configure office shifts before attendance begins.</p>
              )}
            </div>
            {draft.attendanceMode === "hour_based" ? (
              <p className={styles.policyHint}>Hour-based mode measures required duration and does not invent late or early states. Scheduled mode uses assigned office shifts.</p>
            ) : null}
          </section>

          <section className={styles.group} aria-labelledby={`${id}-deployment-heading`}>
            <div className={styles.groupHeader}>
              <h2 className={styles.groupTitle} id={`${id}-deployment-heading`}>Public address and deployment access</h2>
              <p className={styles.groupDescription}>The setup token is sent only to NOVA’s setup endpoints and is kept in memory for the founder handoff.</p>
            </div>
            <div className={styles.grid}>
              <div className={styles.full}>
                <Field id={`${id}-origin`} label="Public NOVA URL" hint="Enter the exact origin people will open. Hosted deployments need HTTPS; private local testing can use localhost over HTTP. The origin must be approved by the deployment operator." error={errorFor("publicOrigin")} required>
                  {(control) => (
                    <Input {...control} ref={originRef} name="publicOrigin" type="url" autoComplete="url" inputMode="url" placeholder="https://work.example.com" value={draft.publicOrigin} disabled={submitting}
                      onChange={(event) => update("publicOrigin", event.currentTarget.value)} />
                  )}
                </Field>
              </div>
              <div className={styles.full}>
                <Field id={`${id}-token`} label="Deployment setup token" hint="This one-time secret is sent in a request header. It is never written to local storage." error={errorFor("bootstrapToken")} required>
                  {(control) => (
                    <Input {...control} ref={tokenRef} name="bootstrapToken" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={draft.bootstrapToken} disabled={submitting}
                      onChange={(event) => update("bootstrapToken", event.currentTarget.value)} />
                  )}
                </Field>
              </div>
            </div>
          </section>

          {submitting ? <p className={styles.progress} role="status" aria-live="polite">Setting up NOVA. Keep this page open while the first workspace is created.</p> : null}

          <div className={styles.actions}>
            <Button type="submit" loading={submitting} loadingLabel={resumeFounder ? "Resuming workspace setup" : "Setting up NOVA"} disabled={submitting}>
              {resumeFounder ? "Continue workspace setup" : "Create NOVA workspace"}
            </Button>
            <Button type="button" variant="secondary" disabled={submitting} onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
