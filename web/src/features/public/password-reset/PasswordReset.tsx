import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, Field, Input, StateMessage } from "../../../design-system";
import { PasswordResetLinkError } from "./contracts";
import type { PasswordResetProps } from "./contracts";
import styles from "./PasswordReset.module.css";

export function PasswordReset({ onResetPassword, linkAvailable, onRequestNewLink, onBackToSignIn }: PasswordResetProps) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmationError, setConfirmationError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [linkExpired, setLinkExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canReset = linkAvailable && !linkExpired;

  useEffect(() => {
    if (linkExpired) headingRef.current?.focus({ preventScroll: true });
  }, [linkExpired]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || !canReset) return;

    const nextPasswordError = password.length < 8 ? "Use at least 8 characters." : "";
    const nextConfirmationError = !confirmation
      ? "Confirm your new password."
      : password !== confirmation
        ? "The passwords do not match."
        : "";
    setPasswordError(nextPasswordError);
    setConfirmationError(nextConfirmationError);
    setFeedback("");
    if (nextPasswordError || nextConfirmationError) {
      requestAnimationFrame(() => {
        if (nextPasswordError) passwordRef.current?.focus();
        else confirmationRef.current?.focus();
      });
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    try {
      await onResetPassword(password);
      setPassword("");
      setConfirmation("");
    } catch (error) {
      setPassword("");
      setConfirmation("");
      if (error instanceof PasswordResetLinkError) {
        setLinkExpired(true);
        return;
      }
      // Keep provider errors, account state, and raw server details out of the public UI.
      setFeedback("Your password could not be reset. Check your connection and try again.");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  const invalidLink = !linkAvailable || linkExpired;

  return (
    <div className={styles.root}>
      <section className={styles.panel} aria-labelledby={`${id}-title`}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Password recovery</p>
          <h1 ref={headingRef} className={styles.title} id={`${id}-title`} tabIndex={-1}>
            {invalidLink ? "This reset link is no longer valid." : "Choose a new password."}
          </h1>
          <p className={styles.description}>
            {invalidLink
              ? "Request a new password reset link and use the latest email."
              : "After saving it, sign in normally with your new password."}
          </p>
        </header>

        {feedback ? (
          <StateMessage kind="error" title="Password reset could not be completed">{feedback}</StateMessage>
        ) : null}

        {invalidLink ? (
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={onRequestNewLink}>Request a new link</Button>
            <Button type="button" variant="quiet" onClick={onBackToSignIn}>Back to sign in</Button>
          </div>
        ) : (
          <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
            <Field
              id={`${id}-password`}
              label="New password"
              hint="Use at least 8 characters."
              error={passwordError || undefined}
              required
            >
              {(control) => (
                <Input
                  {...control}
                  ref={passwordRef}
                  type="password"
                  name="newPassword"
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  disabled={submitting}
                  onChange={(event) => {
                    setPassword(event.currentTarget.value);
                    setPasswordError("");
                    setFeedback("");
                  }}
                />
              )}
            </Field>

            <Field
              id={`${id}-confirmation`}
              label="Confirm new password"
              error={confirmationError || undefined}
              required
            >
              {(control) => (
                <Input
                  {...control}
                  ref={confirmationRef}
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  minLength={8}
                  value={confirmation}
                  disabled={submitting}
                  onChange={(event) => {
                    setConfirmation(event.currentTarget.value);
                    setConfirmationError("");
                    setFeedback("");
                  }}
                />
              )}
            </Field>

            <Button
              className={styles.submit}
              type="submit"
              loading={submitting}
              loadingLabel="Saving new password"
              disabled={submitting}
            >
              Save new password
            </Button>
          </form>
        )}

        {!invalidLink ? (
          <div className={styles.navigation}>
            <Button type="button" variant="quiet" disabled={submitting} onClick={onBackToSignIn}>
              Back to sign in
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
