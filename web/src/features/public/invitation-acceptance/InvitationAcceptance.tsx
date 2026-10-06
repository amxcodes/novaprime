import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, Field, Input, StateMessage } from "../../../design-system";
import { InvitationAcceptanceError } from "./contracts";
import type { InvitationAcceptanceProps, InvitationAcceptanceValues } from "./contracts";
import styles from "./InvitationAcceptance.module.css";

export interface InvitationFieldErrors {
  name: string;
  email: string;
  password: string;
}

export function validateInvitationFields({
  name,
  email,
  emailTypeMismatch,
  password,
}: {
  name: string;
  email: string;
  emailTypeMismatch: boolean;
  password: string;
}): InvitationFieldErrors {
  const hasName = Boolean(name.trim());
  const hasEmail = Boolean(email.trim());
  return {
    name: hasName ? "" : "Enter your name.",
    email: !hasEmail ? "Enter your email address." : emailTypeMismatch ? "Enter a valid email address." : "",
    password: !password
      ? "Enter your password."
      : password.length < 8
        ? "Use at least 8 characters."
        : "",
  };
}

export function InvitationAcceptance({ onAccept, invitationAvailable, onBackToSignIn, onReturnToNOVA, notice }: InvitationAcceptanceProps) {
  const id = useId();
  const inFlight = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "success" | "warning" | "error"; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (completed) continueRef.current?.focus({ preventScroll: true });
  }, [completed]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || completed) return;

    const trimmedName = name.trim();
    const nextErrors = validateInvitationFields({
      name: trimmedName,
      email: email.trim(),
      emailTypeMismatch: Boolean(emailRef.current?.validity.typeMismatch),
      password,
    });
    setNameError(nextErrors.name);
    setEmailError(nextErrors.email);
    setPasswordError(nextErrors.password);
    setFeedback(null);

    const firstInvalidControl = nextErrors.name
      ? nameRef
      : nextErrors.email
        ? emailRef
        : nextErrors.password
          ? passwordRef
          : null;
    if (firstInvalidControl) {
      requestAnimationFrame(() => firstInvalidControl.current?.focus());
      return;
    }

    const values: InvitationAcceptanceValues = {
      name: trimmedName,
      email: email.trim(),
      password,
    };
    inFlight.current = true;
    setSubmitting(true);
    setFeedback(null);
    try {
      const result = await onAccept(values);
      setPassword("");
      setCompleted(true);
      setFeedback({
        kind: result?.verificationSent === false ? "warning" : "success",
        message: result?.verificationSent === true
          ? "Your account was created. Check your email to verify it before signing in."
          : result?.verificationSent === false
            ? "Your account was created, but no verification email was sent. Ask your administrator to open Settings → Secure system handoffs and provide a one-time verification link."
            : "NOVA accepted your invitation. Select Continue to sign in to see what steps remain.",
      });
    } catch (error) {
      setFeedback({
        kind: error instanceof InvitationAcceptanceError ? error.kind : "error",
        message: error instanceof InvitationAcceptanceError
          ? error.message
          : "NOVA could not accept this invitation. Check your details and try again, or ask your administrator for help.",
      });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.root}>
      <section className={styles.panel} aria-labelledby={`${id}-title`}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Invitation acceptance</p>
          <h1 className={styles.title} id={`${id}-title`}>{invitationAvailable ? "Create your NOVA account." : "This invitation link is incomplete."}</h1>
          <p className={styles.description}>{invitationAvailable
            ? "Choose your own password. Your team will never need to share one with you."
            : "Ask the person who invited you to send a new invitation link."}</p>
        </header>

        {notice?.message ? (
          <div className={styles.feedback}>
            <StateMessage kind={notice.kind}>{notice.message}</StateMessage>
          </div>
        ) : null}

        {feedback ? (
          <div className={styles.feedback}>
            <StateMessage kind={feedback.kind} title={completed ? "Account created" : feedback.kind === "warning" ? "Invitation needs attention" : "Invitation was not accepted"}>
              {feedback.message}
            </StateMessage>
          </div>
        ) : null}

        {!invitationAvailable ? (
          <Button type="button" variant="secondary" onClick={onReturnToNOVA}>Return to NOVA</Button>
        ) : null}

        {invitationAvailable && !completed ? <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
          <Field id={`${id}-name`} label="Your name" error={nameError || undefined} required>
            {(control) => (
              <Input
                {...control}
                ref={nameRef}
                type="text"
                name="name"
                autoComplete="name"
                maxLength={180}
                value={name}
                disabled={submitting || completed}
                onChange={(event) => {
                  setName(event.currentTarget.value);
                  setNameError("");
                  setFeedback(null);
                }}
              />
            )}
          </Field>

          <Field id={`${id}-email`} label="Invited email address" hint="Use the email address your administrator invited." error={emailError || undefined} required>
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
                disabled={submitting || completed}
                onChange={(event) => {
                  setEmail(event.currentTarget.value);
                  setEmailError("");
                  setFeedback(null);
                }}
              />
            )}
          </Field>

          <Field id={`${id}-password`} label="New password" hint="Use at least 8 characters. You can change it later." error={passwordError || undefined} required>
            {(control) => (
              <Input
                {...control}
                ref={passwordRef}
                type="password"
                name="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                disabled={submitting || completed}
                onChange={(event) => {
                  setPassword(event.currentTarget.value);
                  setPasswordError("");
                  setFeedback(null);
                }}
              />
            )}
          </Field>

          <Button className={styles.submit} type="submit" loading={submitting} loadingLabel="Creating your account" disabled={submitting || completed}>
            {completed ? "Invitation accepted" : "Create account"}
          </Button>
        </form>
        : null}

        {invitationAvailable && !completed ? <p className={styles.privacy}>Your password is private to you. NOVA verifies the invitation before creating your account.</p> : null}
        {completed ? <Button ref={continueRef} type="button" variant="secondary" onClick={onBackToSignIn}>Continue to sign in</Button> : null}
      </section>
    </div>
  );
}
