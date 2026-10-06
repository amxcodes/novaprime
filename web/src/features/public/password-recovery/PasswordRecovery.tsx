import { useId, useRef, useState, type FormEvent } from "react";
import { Button, Field, Input, StateMessage } from "../../../design-system";
import type { PasswordRecoveryProps } from "./contracts";
import styles from "./PasswordRecovery.module.css";

const neutralConfirmation = "If that email is registered, NOVA has requested password recovery. Check your inbox or contact an administrator if email is unavailable.";

export function PasswordRecovery({ onRequestReset, onBackToSignIn }: PasswordRecoveryProps) {
  const id = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [formError, setFormError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;

    const nextEmailError = !email.trim()
      ? "Enter your email address."
      : emailRef.current?.validity.typeMismatch
        ? "Enter a valid email address."
        : "";
    setEmailError(nextEmailError);
    setFormError("");
    setConfirmation("");
    if (nextEmailError) {
      requestAnimationFrame(() => emailRef.current?.focus());
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    try {
      await onRequestReset(email);
      setConfirmation(neutralConfirmation);
    } catch {
      // Do not expose auth-provider codes or account existence in public copy.
      setFormError("Password recovery could not be requested. Check your connection and try again.");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.root}>
      <section className={styles.panel} aria-labelledby={`${id}-title`}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Password recovery</p>
          <h1 className={styles.title} id={`${id}-title`}>Reset your password.</h1>
          <p className={styles.description}>Enter your work email. If it is registered, NOVA will send a secure reset link.</p>
        </header>

        {formError ? (
          <StateMessage kind="error" title="Request could not be completed">{formError}</StateMessage>
        ) : null}
        {confirmation ? <StateMessage kind="success">{confirmation}</StateMessage> : null}

        <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
          <Field
            id={`${id}-email`}
            label="Email address"
            error={emailError || undefined}
            required
          >
            {(control) => (
              <Input
                {...control}
                ref={emailRef}
                type="email"
                name="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="email"
                value={email}
                disabled={submitting}
                onChange={(event) => {
                  setEmail(event.currentTarget.value);
                  setEmailError("");
                  setFormError("");
                  setConfirmation("");
                }}
              />
            )}
          </Field>

          <Button
            className={styles.submit}
            type="submit"
            loading={submitting}
            loadingLabel="Sending reset link"
            disabled={submitting}
          >
            Send reset link
          </Button>
        </form>

        <div className={styles.navigation}>
          <Button type="button" variant="quiet" disabled={submitting} onClick={onBackToSignIn}>
            Back to sign in
          </Button>
        </div>
      </section>
    </div>
  );
}
